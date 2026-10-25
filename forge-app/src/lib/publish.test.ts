import { assert, test } from "vitest";
import type { Diff, Report, Run, Scenario } from "../contracts/index";
import { diffSummary } from "./adf";
import { statusFor } from "./publish";

const scenario = (id: string): Scenario => ({
  id,
  objective: "Overlapping payments create exactly one charge",
  origin: "planner",
  priority: "P0",
  fixture: "orders_basic",
  steps: [{ op: "wait", ms: 10 }],
  assertions: [{ id: "a1", type: "db_count", table: "charges", where: { orderId: "$order.id" }, equals: 1 }],
  rationale: "lock removed",
  sourceRefs: [],
});
const headFail = (id: string): Run => ({
  id: `run_${id}`, sessionId: "s1", scenarioId: id, env: "head", sha: "abc", attempt: 1, status: "FAIL", durationMs: 1,
  assertions: [{ id: "a1", result: "FAIL", expected: 1, actual: 4 }], artifacts: [],
});
const diff = (id: string, classification: Diff["classification"]) =>
  ({ sessionId: "s1", scenarioId: id, base: "PASS", head: classification === "NEW_REGRESSION" ? "FAIL" : "PASS", classification, runIds: [] }) as Diff;

const ids = ["sc_a", "sc_b", "sc_c"];
const scenarios = [...ids, "sc_ok"].map(scenario);
const runs = ids.map(headFail);
const diffs = [...ids.map((id) => diff(id, "NEW_REGRESSION")), diff("sc_ok", "UNCHANGED_PASS")];
const report = { recommendation: "BLOCKING_REGRESSION", coverage: [], notRun: 0, failed: 3, passed: 1 } as unknown as Report;

test("three scenarios failing the same check count as one regression", () => {
  assert.strictEqual(diffSummary(report, diffs, 1), "4 scenarios (base vs PR): 1 regression, failing in 3 scenarios, 1 unchanged pass.");
  assert.strictEqual(diffSummary(report, diffs), "4 scenarios (base vs PR): 3 regressions, 1 unchanged pass.");
  const { state, description } = statusFor(report, diffs, scenarios, runs);
  assert.strictEqual(state, "failure");
  assert.strictEqual(description, "1 regression vs base, failing in 3 of 4 scenarios. PR: 4 charges for the order (expected 1)");
});

test("commit status description fits GitHub's 140 characters", () => {
  const long = scenarios.map((s) => ({ ...s, assertions: [{ ...s.assertions[0]!, table: "x".repeat(200) }] })) as Scenario[];
  assert.ok(statusFor(report, diffs, long, runs).description.length <= 140);
});
