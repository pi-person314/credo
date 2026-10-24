import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Context } from "@pr-agent/contracts";
import { extractJson, unwrap, type Llm } from "../src/planner/droid.js";
import { Planner, decideRoute } from "../src/planner/planner.js";
import { validateScenarios } from "../src/planner/validate.js";

const context = Context.parse(JSON.parse(readFileSync(new URL("../../mocks/fixtures/context.json", import.meta.url), "utf8")));
const canned = JSON.parse(readFileSync(new URL("../../mocks/fixtures/scenarios.json", import.meta.url), "utf8"));

const fake = (...answers: string[]): Llm & { prompts: string[] } => {
  const prompts: string[] = [];
  return { name: "fake", prompts, available: () => true, complete: async (p) => (prompts.push(p), answers.shift() ?? "") };
};
const off: Llm = { name: "off", available: () => false, complete: async () => "" };

describe("model output parsing", () => {
  it("pulls the array out of prose and fences", () => {
    expect(extractJson('Sure!\n```json\n[{"a":"]"}]\n```\nDone')).toEqual([{ a: "]" }]);
    expect(unwrap('{"type":"result","result":"[1]"}')).toBe("[1]");
  });
});

describe("validateScenarios", () => {
  it("drops test hooks, unknown tables and dangling refs, and dedupes ids", () => {
    const bad = [
      { ...canned[0], id: "sc_hook", steps: [{ op: "http", method: "POST", path: "/__test/reset" }] },
      { ...canned[1], assertions: [{ id: "a1", type: "db_count", table: "users", where: {}, equals: 1 }] },
      { ...canned[0], assertions: [{ id: "a1", type: "http_status", ref: "nope", equals: 200 }] },
      canned[0],
    ];
    const v = validateScenarios(bad, context.manifest, { origin: "planner", max: 8, takenIds: ["sc_single_pay"] });
    expect(v.scenarios.map((s) => s.id)).toEqual(["sc_single_pay_2"]);
    expect(v.errors.join("\n")).toMatch(/__test[\s\S]*users[\s\S]*nope/);
  });
});

describe("Planner", () => {
  it("uses valid planner output, P0 first, origin forced", async () => {
    const p = new Planner(fake(JSON.stringify(canned.map((s: object) => ({ ...s, origin: "recorded" })))));
    const r = await p.plan(context);
    expect(r.source).toBe("fake");
    expect(r.scenarios[0]!.priority).toBe("P0");
    expect(r.scenarios.every((s) => s.origin === "planner")).toBe(true);
  });
  it("retries once with the errors", async () => {
    const llm = fake("[]", JSON.stringify([canned[1]]));
    const r = await new Planner(llm).plan(context);
    expect(r.source).toBe("fake (retry)");
    expect(llm.prompts[1]).toMatch(/rejected/);
  });
  it("falls back to canned scenarios", async () => {
    const r = await new Planner(fake("nope", "still nope")).plan(context);
    expect(r.source).toBe("canned");
    expect(r.scenarios).toHaveLength(3);
    expect(r.scenarios[1]!.sourceRefs).toContain("jira:PAY-12#ac1");
  });
  it("answers asks with a template when the planner is off", async () => {
    const r = await new Planner(off).ask(context, "What if the provider times out and the user retries?", []);
    expect(r.source).toBe("template");
    expect(r.scenarios[0]).toMatchObject({ origin: "ask", knobs: { provider: "timeout" } });
  });
  it("skips follow-ups without a surprise", async () => {
    const r = await new Planner(fake("[]")).followups(context, [], [
      { sessionId: "s", scenarioId: "sc_a", base: "PASS", head: "PASS", classification: "UNCHANGED_PASS", runIds: [] },
    ]);
    expect(r.scenarios).toEqual([]);
  });
});

describe("decideRoute", () => {
  it("docs-only PRs are STATIC_ONLY", () => {
    expect(decideRoute({ ...context, changedFiles: [{ path: "README.md", status: "modified", additions: 1, deletions: 0 }] })).toBe("STATIC_ONLY");
    expect(decideRoute(context)).toBe("TARGETED_TEST");
  });
});
