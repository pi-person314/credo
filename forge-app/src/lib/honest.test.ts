import { assert, test } from "vitest";
import type { Run, Scenario } from "../contracts/index";
import { bugSummary, failureText, isVagueAsk, observedFailure, regressionHeadline } from "./honest";

const scenario: Scenario = {
  id: "sc_double_charge",
  objective: "A retried payment produces exactly one charge",
  origin: "planner",
  priority: "P0",
  fixture: "orders_basic",
  steps: [{ op: "wait", ms: 10 }],
  assertions: [
    { id: "a1", type: "http_status", ref: "pay", equals: 200 },
    { id: "a2", type: "db_count", table: "charges", where: { orderId: "$order.id" }, equals: 1 },
  ],
  rationale: "lock removed",
  sourceRefs: [],
};

const run = (env: "base" | "head", attempt: number, a2: number): Run => ({
  id: `run_${env}_${attempt}`,
  sessionId: "s1",
  scenarioId: scenario.id,
  env,
  sha: "abc",
  attempt,
  status: a2 === 1 ? "PASS" : "FAIL",
  durationMs: 1,
  assertions: [
    { id: "a1", result: "PASS", expected: 200, actual: 200 },
    { id: "a2", result: a2 === 1 ? "PASS" : "FAIL", expected: 1, actual: a2 },
  ],
  artifacts: [],
});

test("vague asks are refused, concrete ones pass", () => {
  for (const p of ["?", "test", "  test it  ", "test test test", "retry timeout", "a b c d e f g"]) assert.strictEqual(isVagueAsk(p), true, p);
  for (const p of ["What if the provider times out and the user retries?", "double click pay button twice"]) assert.strictEqual(isVagueAsk(p), false, p);
});

test("observed failure comes from the latest failing PR run", () => {
  const runs = [run("base", 1, 1), run("head", 1, 3), run("head", 2, 2)];
  assert.strictEqual(observedFailure(scenario, runs), "2 rows in charges where orderId=$order.id (expected 1)");
  assert.strictEqual(regressionHeadline(scenario, runs, scenario.id), "PR: 2 rows in charges where orderId=$order.id (expected 1)");
});

test("no failed assertion falls back without inventing one", () => {
  assert.strictEqual(observedFailure(scenario, [run("head", 1, 1)]), undefined);
  assert.strictEqual(regressionHeadline(scenario, [], scenario.id), "Fails on the PR (no failed check recorded)");
  assert.strictEqual(bugSummary(scenario, []), "Regression: A retried payment produces exactly one charge fails on the PR (sc_double_charge)");
});

test("bug summary leads with the failure and stays within 255 chars", () => {
  assert.strictEqual(bugSummary(scenario, [run("head", 1, 2)]), "Regression: 2 rows in charges where orderId=$order.id (expected 1) (sc_double_charge)");
  const long = { ...scenario, assertions: [{ ...scenario.assertions[1], table: "x".repeat(400) }] };
  const s = bugSummary(long, [run("head", 1, 2)]);
  assert.ok(s.length <= 255);
  assert.ok(s.endsWith("… (sc_double_charge)"));
});

test("failure text per assertion type", () => {
  assert.strictEqual(failureText({ id: "a1", result: "FAIL", expected: 200, actual: 500 }, scenario.assertions[0]), "pay returned HTTP 500 (expected 200)");
  assert.strictEqual(
    failureText({ id: "a3", result: "FAIL", actual: "pending" }, { id: "a3", type: "ui_text", selector: "status", contains: "paid" }),
    'status showed "pending" (expected it to contain "paid")',
  );
  assert.strictEqual(failureText({ id: "a2", result: "FAIL", note: "query timed out" }, scenario.assertions[1]), "charges row count failed: query timed out");
});

test("observed page text is flattened to one line (Jira rejects a summary with a newline)", () => {
  const ui: Scenario = { ...scenario, assertions: [{ id: "a3", type: "ui_text", selector: "status", contains: "paid" }] };
  const r: Run = { ...run("head", 1, 2), assertions: [{ id: "a3", result: "FAIL", actual: "Status:\n\t pending" }] };
  assert.strictEqual(failureText(r.assertions[0]!, ui.assertions[0]), 'status showed "Status: pending" (expected it to contain "paid")');
  assert.notMatch(bugSummary(ui, [r]), /[\n\t]/);
});
