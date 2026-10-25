import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AppManifest, Context, Scenario, classify, coverage, findJiraKey, recommend, type Diff, type Finding } from "../src/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const json = (p: string) => JSON.parse(readFileSync(root + p, "utf8"));

describe("fixtures match the contracts", () => {
  it("demo-app manifest", () => {
    expect(() => AppManifest.parse(json("demo-app/manifest.json"))).not.toThrow();
  });
  it("context fixture", () => {
    expect(() => Context.parse(json("mocks/fixtures/context.json"))).not.toThrow();
  });
  it("scenario fixtures", () => {
    for (const s of json("mocks/fixtures/scenarios.json")) expect(() => Scenario.parse(s)).not.toThrow();
  });
  it("rejects a scenario with no assertions", () => {
    const bad = { ...json("mocks/fixtures/scenarios.json")[0], assertions: [] };
    expect(Scenario.safeParse(bad).success).toBe(false);
  });
});

describe("classify", () => {
  it.each([
    ["PASS", ["PASS"], "UNCHANGED_PASS"],
    ["FAIL", ["PASS"], "IMPROVEMENT"],
    ["FAIL", ["FAIL"], "EXISTING_FAILURE"],
    ["PASS", ["FAIL", "FAIL", "FAIL"], "NEW_REGRESSION"],
    ["PASS", ["FAIL", "PASS", "FAIL"], "FLAKY"],
    ["PASS", ["INCONCLUSIVE"], "INCONCLUSIVE"],
    ["INCONCLUSIVE", ["PASS"], "INCONCLUSIVE"],
    ["PASS", [], "INCONCLUSIVE"],
  ] as const)("base %s, head %j -> %s", (base, head, want) => {
    expect(classify(base, [...head])).toBe(want);
  });
});

describe("recommend", () => {
  const diff = (classification: Diff["classification"]): Diff => ({
    sessionId: "s", scenarioId: "sc_x", base: "PASS", head: "PASS", classification, runIds: [],
  });
  const high: Finding = { id: "f1", sessionId: "s", source: "greptile", severity: "high", description: "x" };

  it("blocks on a regression", () => expect(recommend([diff("NEW_REGRESSION")], [])).toBe("BLOCKING_REGRESSION"));
  it("needs review on flaky", () => expect(recommend([diff("FLAKY")], [])).toBe("NEEDS_REVIEW"));
  it("needs review on untested high risk", () => expect(recommend([diff("UNCHANGED_PASS")], [high])).toBe("NEEDS_REVIEW"));
  it("no blockers when tested", () => expect(recommend([diff("UNCHANGED_PASS")], [high], [], ["f1"])).toBe("NO_BLOCKERS_FOUND"));
  it("needs review on untested AC", () =>
    expect(recommend([diff("UNCHANGED_PASS")], [], [{ index: 1, text: "x", status: "UNTESTED", scenarioIds: [] }])).toBe("NEEDS_REVIEW"));
});

describe("coverage", () => {
  const scenarios = (JSON.parse(readFileSync(root + "mocks/fixtures/scenarios.json", "utf8")) as unknown[]).map((s) => Scenario.parse(s));
  const d = (scenarioId: string, classification: Diff["classification"]): Diff => ({
    sessionId: "s", scenarioId, base: "PASS", head: "PASS", classification, runIds: [],
  });
  const acs = ["never charged twice", "retry after error works", "timeout fails without a charge"];

  it("maps diffs onto acceptance criteria", () => {
    const out = coverage("PAY-5", acs, scenarios, [
      d("sc_single_pay", "UNCHANGED_PASS"),
      d("sc_concurrent_retry", "NEW_REGRESSION"),
      d("sc_double_click_pay", "UNCHANGED_PASS"),
      d("sc_error_then_retry_succeeds", "UNCHANGED_PASS"),
    ]);
    expect(out.map((a) => a.status)).toEqual(["FAILED", "VERIFIED", "UNTESTED"]);
    expect(out[0]!.scenarioIds).toEqual(["sc_single_pay", "sc_concurrent_retry", "sc_double_click_pay"]);
    // The happy path no longer claims AC2: only the recovery scenario (error -> ok -> retry -> paid) verifies it.
    expect(out[1]!.scenarioIds).toEqual(["sc_error_then_retry_succeeds"]);
  });

  // A double-charge regression tagged with AC1 (primary) and AC2 must not fail "retry after error works".
  const sc = (id: string, refs: number[]) =>
    Scenario.parse({ ...scenarios[0], id, sourceRefs: refs.map((n) => `jira:PAY-5#ac${n}`) });
  const tagged = [sc("sc_retry_ok", [2]), sc("sc_concurrent_recovery", [1, 2]), sc("sc_timeout_race", [1, 3])];

  it("fails only the primary criterion of a failing scenario", () => {
    const out = coverage("PAY-5", acs, tagged, [
      d("sc_retry_ok", "UNCHANGED_PASS"),
      d("sc_concurrent_recovery", "NEW_REGRESSION"),
      d("sc_timeout_race", "UNCHANGED_PASS"),
    ]);
    expect(out.map((a) => a.status)).toEqual(["FAILED", "VERIFIED", "VERIFIED"]);
    expect(out[1]!.scenarioIds).toEqual(["sc_retry_ok", "sc_concurrent_recovery"]);
  });

  it("leaves a criterion inconclusive when its only scenario failed on another criterion", () => {
    const out = coverage("PAY-5", acs, tagged, [d("sc_concurrent_recovery", "NEW_REGRESSION"), d("sc_timeout_race", "NEW_REGRESSION")]);
    expect(out.map((a) => a.status)).toEqual(["FAILED", "INCONCLUSIVE", "INCONCLUSIVE"]);
  });
});

describe("findJiraKey", () => {
  it("reads the title first", () => expect(findJiraKey("PAY-5: fix", "feat/OPS-3")).toBe("PAY-5"));
  it("falls back to branch", () => expect(findJiraKey("fix retries", "feat/PAY-5-retry")).toBe("PAY-5"));
  it("returns undefined", () => expect(findJiraKey("fix", "main")).toBeUndefined());
});

describe("session token", () => {
  it("round-trips and rejects tampering, other sessions and expiry", async () => {
    const { signSessionToken, verifySessionToken } = await import("../src/token.js");
    const now = Date.UTC(2026, 9, 24);
    const t = signSessionToken("s3cret", "ses_1", 60, now);
    expect(verifySessionToken("s3cret", "ses_1", t, now)).toBe(true);
    expect(verifySessionToken("s3cret", "ses_2", t, now)).toBe(false);
    expect(verifySessionToken("other", "ses_1", t, now)).toBe(false);
    expect(verifySessionToken("s3cret", "ses_1", t + "x", now)).toBe(false);
    expect(verifySessionToken("s3cret", "ses_1", t, now + 61_000)).toBe(false);
    expect(verifySessionToken("s3cret", "ses_1", undefined, now)).toBe(false);
  });
});
