import type { Assertion, Diff, DiffClass, Recommendation, Report, Run, Scenario, Session, Step } from "../contracts/index";
import { expectedText, failureText, groupRegressions, observedFailure } from "./honest";

// Atlassian Document Format builders for Jira comments and Bug descriptions.
// Wording rule: say what was checked and what was not. Never call a PR safe.
export type Node = { type: string; version?: 1; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: unknown[] };

export const text = (value: string, marks?: unknown[]): Node => ({ type: "text", text: value || " ", ...(marks ? { marks } : {}) });
export const strong = (value: string) => text(value, [{ type: "strong" }]);
export const code = (value: string) => text(value, [{ type: "code" }]);
export const link = (value: string, href: string) => text(value, [{ type: "link", attrs: { href } }]);
export const para = (...content: Node[]): Node => ({ type: "paragraph", content });
export const heading = (level: number, value: string): Node => ({ type: "heading", attrs: { level }, content: [text(value)] });
export const bullets = (items: Node[][]): Node => ({ type: "bulletList", content: items.map((c) => ({ type: "listItem", content: [para(...c)] })) });
export const ordered = (items: Node[][]): Node => ({ type: "orderedList", content: items.map((c) => ({ type: "listItem", content: [para(...c)] })) });
export const panel = (panelType: "info" | "success" | "warning" | "error", ...content: Node[]): Node => ({ type: "panel", attrs: { panelType }, content });
export const doc = (...content: Node[]): Node => ({ type: "doc", version: 1, content });

function table(header: string[], rows: Node[][][]): Node {
  const cell = (type: string, c: Node[]) => ({ type, content: [para(...c)] });
  return {
    type: "table",
    attrs: { isNumberColumnEnabled: false, layout: "default" },
    content: [
      { type: "tableRow", content: header.map((h) => cell("tableHeader", [strong(h)])) },
      ...rows.map((r) => ({ type: "tableRow", content: r.map((c) => cell("tableCell", c)) })),
    ],
  };
}

export const VERDICT_LABEL: Record<Recommendation, string> = {
  BLOCKING_REGRESSION: "Blocking regression found",
  NEEDS_REVIEW: "Needs review",
  NO_BLOCKERS_FOUND: "No blockers found",
};
const VERDICT_PANEL = { BLOCKING_REGRESSION: "error", NEEDS_REVIEW: "warning", NO_BLOCKERS_FOUND: "success" } as const;

const short = (sha: string) => sha.slice(0, 7);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const json = (v: unknown) => clip(JSON.stringify(v), 200);

/** One scenario step as a plain-English repro line. */
export function describeStep(step: Step): string {
  switch (step.op) {
    case "http":
      return `${step.method} ${step.path}${step.body !== undefined ? ` with body ${json(step.body)}` : ""}`;
    case "parallel":
      return `Send ${step.count} at once: ${describeStep(step.step)}`;
    case "ui":
      if (step.action === "goto") return `Open ${step.target}`;
      if (step.action === "fill") return `Fill ${step.target} with "${step.value ?? ""}"`;
      return `${step.action === "dblclick" ? "Double-click" : "Click"} ${step.target}`;
    case "wait":
      return `Wait ${step.ms} ms`;
  }
}

/** One assertion as the expected outcome, in plain words (no "$order.id" placeholders). */
export const describeAssertion = (a: Assertion): string => expectedText(a);

// Counts line, one entry per base-vs-PR classification, so it matches the scenario list a reader sees.
const CLASS_LABEL: [DiffClass, string, string][] = [
  ["NEW_REGRESSION", "regression", "regressions"],
  ["EXISTING_FAILURE", "failing on base and PR", "failing on base and PR"],
  ["FLAKY", "flaky", "flaky"],
  ["INCONCLUSIVE", "inconclusive", "inconclusive"],
  ["IMPROVEMENT", "fixed by PR", "fixed by PR"],
  ["UNCHANGED_PASS", "unchanged pass", "unchanged pass"],
];

/**
 * e.g. "5 scenarios (base vs PR): 1 regression, 1 inconclusive, 3 unchanged pass."
 * `distinctRegressions` (regressions grouped by failed check) counts bugs, not scenarios:
 * "7 scenarios (base vs PR): 1 regression, failing in 3 scenarios, 4 unchanged pass."
 */
export function diffSummary(report: Pick<Report, "notRun">, diffs: Diff[], distinctRegressions?: number): string {
  const parts = CLASS_LABEL.flatMap(([cls, one, many]) => {
    const n = diffs.filter((d) => d.classification === cls).length;
    if (!n) return [];
    if (cls === "NEW_REGRESSION" && distinctRegressions && distinctRegressions < n) {
      return [`${distinctRegressions} ${distinctRegressions === 1 ? one : many}, failing in ${n} scenarios`];
    }
    return [`${n} ${n === 1 ? one : many}`];
  });
  if (report.notRun > 0) parts.push(`${report.notRun} not run`);
  const total = diffs.length + report.notRun;
  return `${total} scenario${total === 1 ? "" : "s"} (base vs PR): ${parts.join(", ") || "none ran"}.`;
}

/** Things nobody checked. Always shown, whatever the verdict. */
export function notTested(report: Report): string[] {
  const out = report.coverage.filter((c) => c.status === "UNTESTED").map((c) => `AC${c.index} has no scenario: ${c.text}`);
  if (report.notRun > 0) out.push(`${report.notRun} scenario result(s) did not run.`);
  // Confirmed regressions have their own section and untested ACs are listed above, so skip those risks.
  out.push(...report.risks.filter((r) => !r.startsWith("Regression:") && !r.startsWith("Untested AC")));
  out.push("Code paths outside the scenarios listed here were not exercised.");
  return out;
}

const objective = (scenarios: Scenario[], id: string) => scenarios.find((s) => s.id === id)?.objective ?? id;

/** " Greptile flagged this too." when the scenario was planned from a Greptile finding. */
export const greptileNote = (scenarios: Scenario[], id: string) =>
  scenarios.find((s) => s.id === id)?.sourceRefs.some((r) => r.startsWith("greptile:")) ? " Greptile flagged this too." : "";

/** Regression line: what the PR run observed first, then the scenario goal. Shared by the Jira and GitHub reports. */
export function regressionText(scenarios: Scenario[], runs: Run[], id: string) {
  const seen = observedFailure(scenarios.find((s) => s.id === id), runs, id);
  const lead = seen ? `PR: ${seen}. Goal: ${objective(scenarios, id)}.` : `${objective(scenarios, id)}.`;
  return `${lead} Passes on base, fails on PR (confirmed on rerun).${greptileNote(scenarios, id)}`;
}

/**
 * Regression rows for the Jira and GitHub reports: scenarios failing the same check share one row,
 * e.g. "PR: 5 charges for the order (expected 1). Seen in 3 scenarios: ...". `ids` is the row's scenarios.
 */
export function regressionRows(scenarios: Scenario[], runs: Run[], diffs: Diff[]): { ids: string[]; text: string }[] {
  const ids = diffs.filter((d) => d.classification === "NEW_REGRESSION").map((d) => d.scenarioId);
  return groupRegressions(scenarios, runs, ids).map((g) => {
    if (g.ids.length === 1) return { ids: g.ids, text: regressionText(scenarios, runs, g.ids[0]!) };
    const seen = observedFailure(scenarios.find((s) => s.id === g.ids[0]), runs, g.ids[0]);
    const list = g.ids.map((id) => `${id} (${objective(scenarios, id)})`).join("; ");
    const greptile = g.ids.some((id) => greptileNote(scenarios, id)) ? " Greptile flagged this too." : "";
    return {
      ids: g.ids,
      text: `${seen ? `PR: ${seen}. ` : ""}Seen in ${g.ids.length} scenarios: ${list}. Each passes on base, fails on PR (confirmed on rerun).${greptile}`,
    };
  });
}

/** Jira comment body for a report. `runs` lets regressions say what broke. */
export function reportAdf(session: Session, report: Report, scenarios: Scenario[], diffs: Diff[], runs: Run[] = []): Node {
  const regressions = regressionRows(scenarios, runs, diffs);
  const unclear = diffs.filter((d) => d.classification === "FLAKY" || d.classification === "INCONCLUSIVE" || d.classification === "EXISTING_FAILURE");
  const pr = session.prUrl ? link(`${session.repo}#${session.prNumber}`, session.prUrl) : text(`${session.repo}#${session.prNumber}`);
  return doc(
    heading(3, `Credo: ${VERDICT_LABEL[report.recommendation]}`),
    panel(
      VERDICT_PANEL[report.recommendation],
      para(text("Checked "), pr, text(" at "), code(short(session.headSha)), text(" against base "), code(short(session.baseSha)), text(".")),
      para(text(diffSummary(report, diffs, regressions.length))),
    ),
    heading(4, "Acceptance criteria"),
    report.coverage.length
      ? table(
          ["#", "Criterion", "Status", "Scenarios"],
          report.coverage.map((c) => [[text(`AC${c.index}`)], [text(c.text)], [strong(c.status)], [text(c.scenarioIds.join(", ") || "none")]]),
        )
      : para(text("No acceptance criteria found on the issue.")),
    heading(4, "Regressions"),
    regressions.length
      ? bullets(regressions.map((r) => [code(r.ids.join(", ")), text(` ${r.text}`)]))
      : para(text("None found in the scenarios that ran.")),
    ...(unclear.length
      ? [heading(4, "Needs a look"), bullets(unclear.map((d) => [code(d.scenarioId), text(` ${objective(scenarios, d.scenarioId)}: ${d.classification} (base ${d.base}, PR ${d.head}).`)]))]
      : []),
    heading(4, "What was not tested"),
    bullets(notTested(report).map((t) => [text(t)])),
    para(text("This report lists what was checked. A person still decides whether to merge.", [{ type: "em" }])),
  );
}

export type Evidence = { label: string; url: string };

/** Description for a regression Bug: repro steps, expected vs actual, evidence. */
export function bugAdf(session: Session, scenario: Scenario, diff: Diff, headRuns: Run[], evidence: Evidence[]): Node {
  const failed = headRuns.flatMap((r) => r.assertions.filter((a) => a.result === "FAIL"));
  const knobs = scenario.knobs ? ` Provider mode ${scenario.knobs.provider}, latency ${scenario.knobs.latencyMs} ms.` : "";
  const observed = observedFailure(scenario, headRuns);
  const assertion = (id: string) => scenario.assertions.find((a) => a.id === id);
  return doc(
    panel("error", para(strong("What broke: "), text(observed ? `on the PR, ${observed}.` : `the PR run ended ${diff.head}; no failed check was recorded.`))),
    para(text(`Found by Credo while checking ${session.issueKey}. `), session.prUrl ? link(`${session.repo}#${session.prNumber}`, session.prUrl) : text(`${session.repo}#${session.prNumber}`)),
    para(text(`Scenario `), code(scenario.id), text(` (goal: ${scenario.objective}). Base `), code(short(session.baseSha)), text(` ${diff.base}, PR `), code(short(session.headSha)), text(` ${diff.head}.`)),
    heading(4, "Steps to reproduce"),
    para(text(`Start from fixture ${scenario.fixture}.${knobs}`)),
    ordered(scenario.steps.map((s) => [text(describeStep(s))])),
    heading(4, "Expected"),
    bullets(scenario.assertions.map((a) => [text(describeAssertion(a))])),
    heading(4, "Actual on the PR"),
    failed.length
      ? bullets(failed.map((a) => [code(a.id), text(` ${failureText(a, assertion(a.id))}${a.note && a.actual !== undefined ? ` (${a.note})` : ""}`)]))
      : para(text(`Run result ${diff.head}.`)),
    heading(4, "Evidence"),
    evidence.length ? bullets(evidence.map((e) => [link(e.label, e.url)])) : para(text("No artifacts were recorded.")),
  );
}
