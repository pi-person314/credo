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
// Observed page text can hold newlines/tabs; Jira rejects a Bug summary with a newline, so flatten whitespace.
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const show = (v: unknown) => clip(typeof v === "string" ? `"${oneLine(v)}"` : JSON.stringify(v) ?? "nothing", 80);
// ---------- assertions in plain words ----------
// Scenarios refer to saved values with placeholders like "$order.id". Readers never see those:
// "5 rows in charges where orderId=$order.id" is said as "5 charges for the order".

const words = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** "$order.id" -> "the order", "$user.email" -> "the user email". Undefined for anything that is not a placeholder. */
export function placeholderText(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\$[A-Za-z_]/.test(v)) return undefined;
  const parts = v.slice(1).split(/[.[\]]+/).filter(Boolean);
  const kept = parts.filter((p, i) => i === 0 || !/^id$/i.test(p));
  return `the ${words(kept.join(" "))}`;
}

/** A value as a reader says it: a placeholder in words, anything else quoted/JSON. */
const plain = (v: unknown) => placeholderText(v) ?? show(v);

/** Table rows as a noun: "charges", or "charge" for exactly one. */
const rowsOf = (table: string, n?: unknown) => {
  const noun = words(table) || table;
  return n === 1 && /[^su]s$/.test(noun) ? noun.slice(0, -1) : noun;
};

/** where { orderId: "$order.id", status: "paid" } -> "for the order with status "paid"". */
function whereWords(where: Record<string, unknown>): string {
  return Object.entries(where)
    .map(([k, v]) => {
      const ref = placeholderText(v);
      if (ref) return /(^id$|_id$|[a-z0-9]Id$|ID$)/.test(k) ? `for ${ref}` : `with ${words(k)} matching ${ref}`;
      return `with ${words(k)} ${show(v)}`;
    })
    .join(" ");
}

/** JSON path without the "$." root, e.g. "$.charge.status" -> "charge.status". */
const fieldOf = (path: string) => path.replace(/^\$\.?/, "") || "body";

/** UI selector as a name: '[data-testid="order-status"]' / "#order-status" -> "order status". */
const uiName = (selector: string) => {
  const m = selector.match(/^\[data-test(?:id)?=["']?([^"'\]]+)["']?\]$/) ?? selector.match(/^[#.]([\w-]+)$/);
  return m ? words(m[1]!) : selector;
};

/** What a check looks at, without numbers, e.g. "charges count for the order". Also the grouping key for regressions. */
export function describeCheck(a: Assertion): string {
  switch (a.type) {
    case "db_count": {
      const where = whereWords(a.where);
      return `${rowsOf(a.table)} count${where ? ` ${where}` : ""}`;
    }
    case "http_status":
      return `${a.ref} HTTP status`;
    case "json_path":
      return `${a.ref} response ${fieldOf(a.path)}`;
    case "ui_text":
      return uiName(a.selector);
  }
}

/** One assertion as the expected outcome, e.g. "exactly 1 charge for the order". */
export function expectedText(a: Assertion): string {
  switch (a.type) {
    case "db_count": {
      const where = whereWords(a.where);
      return `exactly ${a.equals} ${rowsOf(a.table, a.equals)}${where ? ` ${where}` : ""}`;
    }
    case "http_status":
      return `${a.ref} returns HTTP ${a.equals}`;
    case "json_path":
      return `${a.ref} response ${fieldOf(a.path)} equals ${plain(a.equals)}`;
    case "ui_text":
      return `${uiName(a.selector)} contains ${placeholderText(a.contains) ?? `"${a.contains}"`}`;
  }
}

/** One failed assertion as what was observed, e.g. "5 charges for the order (expected 1)". */
export function failureText(o: AssertionOutcome, a?: Assertion): string {
  const expected = o.expected ?? (a && "equals" in a ? a.equals : undefined);
  if (o.actual === undefined) return `${a ? describeCheck(a) : o.id} failed${o.note ? `: ${o.note}` : ""}`;
  switch (a?.type) {
    case "db_count": {
      const where = whereWords(a.where);
      return `${show(o.actual)} ${rowsOf(a.table, o.actual)}${where ? ` ${where}` : ""} (expected ${show(expected)})`;
    }
    case "http_status":
      return `${a.ref} returned HTTP ${show(o.actual)} (expected ${show(expected)})`;
    case "json_path":
      return `${a.ref} response ${fieldOf(a.path)} was ${show(o.actual)} (expected ${plain(expected)})`;
    case "ui_text":
      return `${uiName(a.selector)} showed ${show(o.actual)} (expected it to contain ${placeholderText(a.contains) ?? `"${a.contains}"`})`;
    default:
      return `${o.id} got ${show(o.actual)} (expected ${show(expected)})`;
  }
}

/** Failed assertions of the latest failing PR run, or [] if the PR run recorded none. */
export function failedOnHead(runs: Run[], scenarioId?: string): AssertionOutcome[] {
  const head = runs
    .filter((r) => r.env === "head" && (!scenarioId || r.scenarioId === scenarioId) && r.assertions.some((x) => x.result === "FAIL"))
    .sort((x, y) => x.attempt - y.attempt);
  return head.at(-1)?.assertions.filter((x) => x.result === "FAIL") ?? [];
}

/** What the PR run observed, e.g. "2 charges for the order (expected 1)". Undefined if no failed assertion was recorded. */
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

// ---------- one row per distinct failure ----------

export type RegressionGroup = {
  /** Scenario ids that fail the same check, first one first. Per-scenario actions (File Bug) use ids[0]. */
  ids: string[];
  /** Headline of the first scenario, e.g. "PR: 5 charges for the order (expected 1)". */
  headline: string;
};

/**
 * Regressions that fail the same check (same assertion kind and target, e.g. "charges count for the order")
 * collapse into one row. A scenario with no recorded failed check stays on its own row. Order is kept.
 */
export function groupRegressions(scenarios: Scenario[], runs: Run[], ids: string[]): RegressionGroup[] {
  const groups = new Map<string, RegressionGroup>();
  for (const id of new Set(ids)) {
    const scenario = scenarios.find((s) => s.id === id);
    const checks = failedOnHead(runs, id).map((o) => {
      const a = scenario?.assertions.find((x) => x.id === o.id);
      return a ? `${a.type}|${describeCheck(a)}` : undefined;
    });
    const key = checks.length && checks.every(Boolean) ? [...new Set(checks)].sort().join("&") : `scenario|${id}`;
    const group = groups.get(key);
    if (group) group.ids.push(id);
    else groups.set(key, { ids: [id], headline: regressionHeadline(scenario, runs, id) });
  }
  return [...groups.values()];
}

/** Jira Bug summary: "Regression: <observed failure> (<scenario id>)", at most 255 characters. */
export function bugSummary(scenario: Scenario, runs: Run[]): string {
  const what = observedFailure(scenario, runs) ?? `${scenario.objective} fails on the PR`;
  const suffix = ` (${scenario.id})`;
  const prefix = "Regression: ";
  return `${prefix}${clip(what, 255 - prefix.length - suffix.length)}${suffix}`;
}
