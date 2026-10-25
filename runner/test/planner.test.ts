import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Context } from "@pr-agent/contracts";
import { extractJson, unwrap, type Llm } from "../src/planner/droid.js";
import { Planner, decideRoute } from "../src/planner/planner.js";
import { templateAsk } from "../src/planner/fallback.js";
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

describe("success criteria need a success assertion", () => {
  const acs = context.jira!.acceptanceCriteria;
  const opts = { origin: "planner" as const, max: 8, takenIds: [], acceptanceCriteria: acs };
  const recovery = canned.find((s: { id: string }) => s.id === "sc_error_then_retry_succeeds");
  // The real PAY-5 run: AC2 "verified" by a retry that only reached the provider and failed.
  const failureOnly = {
    ...recovery,
    id: "sc_retry_after_error",
    steps: [recovery.steps[0], recovery.steps[1], { ...recovery.steps[1], saveAs: "retry" }],
    assertions: [{ id: "a1", type: "http_status", ref: "retry", equals: 502 }, { id: "a2", type: "db_count", table: "charges", where: {}, equals: 0 }],
    sourceRefs: ["jira:PAY-5#ac2", "jira:PAY-5#ac1"],
  };

  it("drops the success-criterion ref from a failure-only scenario and says how to fix it", () => {
    const v = validateScenarios([failureOnly], context.manifest, opts);
    expect(v.scenarios[0]!.sourceRefs).toEqual(["jira:PAY-5#ac1"]);
    expect(v.coverageErrors).toHaveLength(1);
    expect(v.coverageErrors[0]).toMatch(/sc_retry_after_error.*ac2.*only asserts failure/);
    expect(v.errors).toContain(v.coverageErrors[0]);
  });
  it("flags a positive assertion while the provider is still failing", () => {
    const stuck = { ...recovery, id: "sc_stuck", steps: recovery.steps.filter((st: { path?: string }) => st.path !== "/__test/provider") };
    const v = validateScenarios([stuck], context.manifest, opts);
    expect(v.scenarios[0]!.sourceRefs).toEqual([]);
    expect(v.coverageErrors[0]).toMatch(/still "error".*__test\/provider/);
  });
  it("accepts the recovery path: error -> provider ok -> retry -> paid, 1 charge", () => {
    const v = validateScenarios([recovery], context.manifest, opts);
    expect(v.errors).toEqual([]);
    expect(v.scenarios[0]!.sourceRefs).toEqual(["jira:PAY-5#ac2"]);
  });
  it("leaves failure checks on non-success criteria alone", () => {
    const v = validateScenarios([{ ...failureOnly, sourceRefs: ["jira:PAY-5#ac3"] }], context.manifest, opts);
    expect(v.coverageErrors).toEqual([]);
    expect(v.scenarios[0]!.sourceRefs).toEqual(["jira:PAY-5#ac3"]);
  });
  it("allows only POST /__test/provider with a manifest mode", () => {
    const hook = (body: unknown, method = "POST") => ({ ...recovery, steps: [recovery.steps[0], { op: "http", method, path: "/__test/provider", body }, recovery.steps[3], recovery.steps[4]] });
    const v = validateScenarios([hook({ mode: "chaos" }), hook({ mode: "ok" }, "GET"), hook({ mode: "ok", latencyMs: -1 })], context.manifest, opts);
    expect(v.scenarios).toEqual([]);
    expect(v.errors.join("\n")).toMatch(/body\.mode[\s\S]*takes POST[\s\S]*latencyMs/);
  });
  it("every canned scenario and the error ask template pass the check", () => {
    expect(validateScenarios(canned, context.manifest, opts).coverageErrors).toEqual([]);
    const t = templateAsk("What if the provider errors and the user retries?", "PAY-5", context.manifest, 1)!;
    const v = validateScenarios([t], context.manifest, { ...opts, origin: "ask" });
    expect(v.errors).toEqual([]);
    expect(v.scenarios[0]!.sourceRefs).toEqual(["jira:PAY-5#ac2"]);
  });
  it("Planner asks Droid again when it over-claims, and keeps the fix", async () => {
    const llm = fake(JSON.stringify([failureOnly, canned[1]]), JSON.stringify([recovery, canned[1]]));
    const r = await new Planner(llm).plan(context);
    expect(r.source).toBe("fake (retry)");
    expect(llm.prompts[1]).toMatch(/rejected[\s\S]*sc_retry_after_error.*ac2/);
    expect(r.scenarios.map((s) => s.id)).toContain("sc_error_then_retry_succeeds");
  });
  it("Planner keeps the first answer, minus the false claim, when the retry is no better", async () => {
    const r = await new Planner(fake(JSON.stringify([failureOnly]), "nope")).plan(context);
    expect(r.source).toBe("fake");
    expect(r.scenarios[0]!.sourceRefs).toEqual(["jira:PAY-5#ac1"]);
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
    expect(r.scenarios).toHaveLength(4);
    expect(r.scenarios[1]!.sourceRefs).toContain("jira:PAY-5#ac1");
  });
  it("answers asks with a template when the planner is off", async () => {
    const r = await new Planner(off).ask(context, "What if the provider times out and the user retries?", []);
    expect(r.source).toBe("template");
    expect(r.scenarios[0]).toMatchObject({ origin: "ask", knobs: { provider: "timeout" } });
    const e = await new Planner(off).ask(context, "What if the provider errors and the user retries?", []);
    expect(e.scenarios[0]!.steps.map((st) => (st.op === "http" ? st.path : st.op))).toContain("/__test/provider");
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
