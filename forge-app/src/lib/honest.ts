import type { Assertion, AssertionOutcome, Run, Scenario } from "../contracts/index";

// Honest wording shared by the panel, the Jira and GitHub reports, the filed Bug and Rovo.
// Pure functions only (no Forge imports), so the panel bundle and the unit tests can use them.

// ---------- vague test requests ----------

export const VAGUE_ASK =
  "Describe the situation to test, e.g. 'What if the provider times out and the user retries?'";

/** True when a test request is too short or has too few real words to plan a scenario from. */
export function isVagueAsk(prompt: string): boolean {
  const text = prompt.trim();
  const words = new Set((text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 1));
  return text.length < 12 || words.size < 3;
}

// ---------- what broke ----------

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const show = (v: unknown) => clip(typeof v === "string" ? `"${v}"` : JSON.stringify(v) ?? "nothing", 80);
const whereText = (where: Record<string, unknown>) =>
  Object.entries(where)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");

/** One failed assertion as what was observed, e.g. "2 rows in charges where orderId=$order.id (expected 1)". */
export function failureText(o: AssertionOutcome, a?: Assertion): string {
  const expected = o.expected ?? (a && "equals" in a ? a.equals : undefined);
  if (o.actual === undefined) return `${a ? describeCheck(a) : o.id} failed${o.note ? `: ${o.note}` : ""}`;
  switch (a?.type) {
    case "db_count": {
      const where = whereText(a.where);
      return `${show(o.actual)} rows in ${a.table}${where ? ` where ${where}` : ""} (expected ${show(expected)})`;
    }
    case "http_status":
      return `${a.ref} returned HTTP ${show(o.actual)} (expected ${show(expected)})`;
    case "json_path":
      return `${a.ref} ${a.path} was ${show(o.actual)} (expected ${show(expected)})`;
    case "ui_text":
      return `${a.selector} showed ${show(o.actual)} (expected it to contain "${a.contains}")`;
    default:
      return `${o.id} got ${show(o.actual)} (expected ${show(expected)})`;
  }
}

const describeCheck = (a: Assertion) =>
  a.type === "db_count" ? `${a.table} row count` : a.type === "ui_text" ? a.selector : `${a.ref}${a.type === "json_path" ? ` ${a.path}` : ""}`;

/** Failed assertions of the latest failing PR run, or [] if the PR run recorded none. */
export function failedOnHead(runs: Run[], scenarioId?: string): AssertionOutcome[] {
  const head = runs
    .filter((r) => r.env === "head" && (!scenarioId || r.scenarioId === scenarioId) && r.assertions.some((x) => x.result === "FAIL"))
    .sort((x, y) => x.attempt - y.attempt);
  return head.at(-1)?.assertions.filter((x) => x.result === "FAIL") ?? [];
}

/** What the PR run observed, e.g. "2 rows in charges where orderId=$order.id (expected 1)". Undefined if no failed assertion was recorded. */
export function observedFailure(scenario: Scenario | undefined, runs: Run[], scenarioId = scenario?.id): string | undefined {
  const failed = failedOnHead(runs, scenarioId);
  if (!failed.length) return undefined;
  return failed.map((o) => failureText(o, scenario?.assertions.find((a) => a.id === o.id))).join("; ");
}

/** Lead line for a regression: the observed failure, or a plain note when the PR run recorded no failed check. */
export function regressionHeadline(scenario: Scenario | undefined, runs: Run[], scenarioId: string): string {
  const seen = observedFailure(scenario, runs, scenarioId);
  return seen ? `PR: ${seen}` : "Fails on the PR (no failed check recorded)";
}

/** Jira Bug summary: "Regression: <observed failure> (<scenario id>)", at most 255 characters. */
export function bugSummary(scenario: Scenario, runs: Run[]): string {
  const what = observedFailure(scenario, runs) ?? `${scenario.objective} fails on the PR`;
  const suffix = ` (${scenario.id})`;
  const prefix = "Regression: ";
  return `${prefix}${clip(what, 255 - prefix.length - suffix.length)}${suffix}`;
}
