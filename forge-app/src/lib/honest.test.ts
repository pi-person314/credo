import { assert, test } from "vitest";
import type { Run, Scenario } from "../contracts/index";
import type { Diff, Report, Session } from "../contracts/index";
import { bugSummary, describeCheck, expectedText, failureText, groupRegressions, isVagueAsk, observedFailure, placeholderText, regressionHeadline } from "./honest";
import { bugAdf, regressionRows, reportAdf } from "./adf";

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
  assert.strictEqual(observedFailure(scenario, runs), "2 charges for the order (expected 1)");
  assert.strictEqual(regressionHeadline(scenario, runs, scenario.id), "PR: 2 charges for the order (expected 1)");
});

test("no failed assertion falls back without inventing one", () => {
  assert.strictEqual(observedFailure(scenario, [run("head", 1, 1)]), undefined);
  assert.strictEqual(regressionHeadline(scenario, [], scenario.id), "Fails on the PR (no failed check recorded)");
  assert.strictEqual(bugSummary(scenario, []), "Regression: A retried payment produces exactly one charge fails on the PR (sc_double_charge)");
});

test("bug summary leads with the failure and stays within 255 chars", () => {
  assert.strictEqual(bugSummary(scenario, [run("head", 1, 2)]), "Regression: 2 charges for the order (expected 1) (sc_double_charge)");
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
  assert.strictEqual(failureText({ id: "a2", result: "FAIL", note: "query timed out" }, scenario.assertions[1]), "charges count for the order failed: query timed out");
});

test("observed page text is flattened to one line (Jira rejects a summary with a newline)", () => {
  const ui: Scenario = { ...scenario, assertions: [{ id: "a3", type: "ui_text", selector: "status", contains: "paid" }] };
  const r: Run = { ...run("head", 1, 2), assertions: [{ id: "a3", result: "FAIL", actual: "Status:\n\t pending" }] };
  assert.strictEqual(failureText(r.assertions[0]!, ui.assertions[0]), 'status showed "Status: pending" (expected it to contain "paid")');
  assert.notMatch(bugSummary(ui, [r]), /[\n\t]/);
});

test("assertions are said in plain words, never with $ placeholders", () => {
  assert.strictEqual(placeholderText("$order.id"), "the order");
  assert.strictEqual(placeholderText("$lastOrder.customerEmail"), "the last order customer email");
  assert.strictEqual(placeholderText("paid"), undefined);
  const db = scenario.assertions[1]!;
  assert.strictEqual(failureText({ id: "a2", result: "FAIL", expected: 1, actual: 5 }, db), "5 charges for the order (expected 1)");
  assert.strictEqual(failureText({ id: "a2", result: "FAIL", expected: 2, actual: 1 }, db), "1 charge for the order (expected 2)");
  assert.strictEqual(expectedText(db), "exactly 1 charge for the order");
  const literal = { id: "a4", type: "db_count", table: "charges", where: { order_id: "$order.id", status: "paid" }, equals: 1 } as const;
  assert.strictEqual(describeCheck(literal), 'charges count for the order with status "paid"');
  const jp = { id: "a5", type: "json_path", ref: "pay", path: "$.order.id", equals: "$order.id" } as const;
  assert.strictEqual(failureText({ id: "a5", result: "FAIL", actual: "o_2" }, jp), 'pay response order.id was "o_2" (expected the order)');
  assert.strictEqual(expectedText(jp), "pay response order.id equals the order");
  const ui = { id: "a6", type: "ui_text", selector: '[data-testid="order-status"]', contains: "paid" } as const;
  assert.strictEqual(failureText({ id: "a6", result: "FAIL", actual: "pending" }, ui), 'order status showed "pending" (expected it to contain "paid")');
  assert.strictEqual(expectedText({ id: "a1", type: "http_status", ref: "pay", equals: 200 }), "pay returns HTTP 200");
});

const other = (id: string, objective: string, assertions = scenario.assertions): Scenario => ({ ...scenario, id, objective, assertions });
const headFail = (s: Scenario, actual: number): Run => ({ ...run("head", 1, actual), id: `run_${s.id}`, scenarioId: s.id });

test("regressions failing the same check share one row, others stay apart", () => {
  const a = other("sc_a", "Retry charges once");
  const b = other("sc_b", "Double click charges once");
  const c = other("sc_c", "Pay works", [{ id: "a1", type: "http_status", ref: "pay", equals: 200 }]);
  const cRun: Run = { ...headFail(c, 2), assertions: [{ id: "a1", result: "FAIL", expected: 200, actual: 500 }] };
  const runs = [headFail(a, 5), headFail(b, 2), cRun];
  const groups = groupRegressions([a, b, c], runs, ["sc_a", "sc_b", "sc_c", "sc_none"]);
  assert.deepStrictEqual(groups.map((g) => g.ids), [["sc_a", "sc_b"], ["sc_c"], ["sc_none"]]);
  assert.strictEqual(groups[0]!.headline, "PR: 5 charges for the order (expected 1)");

  const diffs: Diff[] = ["sc_a", "sc_b", "sc_c"].map((id) => ({ sessionId: "s1", scenarioId: id, base: "PASS", head: "FAIL", classification: "NEW_REGRESSION", runIds: [] }) as Diff);
  const rows = regressionRows([a, b, c], runs, diffs);
  assert.strictEqual(rows.length, 2);
  assert.match(rows[0]!.text, /^PR: 5 charges for the order \(expected 1\)\. Seen in 2 scenarios: sc_a \(Retry charges once\); sc_b \(Double click charges once\)\./);
  for (const r of rows) assert.notMatch(r.text, /\$/);
});

test("reports and the Bug never show $ placeholders", () => {
  const session = { id: "s1", issueKey: "PAY-5", repo: "o/r", prNumber: 1, headSha: "h".repeat(40), baseSha: "b".repeat(40) } as Session;
  const report = { recommendation: "BLOCKING_REGRESSION", coverage: [], risks: [], notRun: 0 } as unknown as Report;
  const diff = { sessionId: "s1", scenarioId: scenario.id, base: "PASS", head: "FAIL", classification: "NEW_REGRESSION", runIds: [] } as Diff;
  const runs = [run("head", 1, 5)];
  for (const node of [reportAdf(session, report, [scenario], [diff], runs), bugAdf(session, scenario, diff, runs, [])])
    assert.notInclude(JSON.stringify(node), "$order");
});
