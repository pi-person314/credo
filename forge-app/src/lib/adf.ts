import type { Assertion, Diff, DiffClass, Recommendation, Report, Run, Scenario, Session, Step } from "../contracts/index";

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

/** One assertion as the expected outcome. */
export function describeAssertion(a: Assertion): string {
  switch (a.type) {
    case "db_count":
      return `${a.table} has exactly ${a.equals} row(s) where ${json(a.where)}`;
    case "http_status":
      return `${a.ref} returns HTTP ${a.equals}`;
    case "json_path":
      return `${a.ref} ${a.path} equals ${json(a.equals)}`;
    case "ui_text":
      return `${a.selector} contains "${a.contains}"`;
  }
}

// Counts line, one entry per base-vs-PR classification, so it matches the scenario list a reader sees.
const CLASS_LABEL: [DiffClass, string, string][] = [
  ["NEW_REGRESSION", "regression", "regressions"],
  ["EXISTING_FAILURE", "failing on base and PR", "failing on base and PR"],
  ["FLAKY", "flaky", "flaky"],
  ["INCONCLUSIVE", "inconclusive", "inconclusive"],
  ["IMPROVEMENT", "fixed by PR", "fixed by PR"],
  ["UNCHANGED_PASS", "unchanged pass", "unchanged pass"],
];

/** e.g. "5 scenarios (base vs PR): 1 regression, 1 inconclusive, 3 unchanged pass." */
export function diffSummary(report: Pick<Report, "notRun">, diffs: Diff[]): string {
  const parts = CLASS_LABEL.flatMap(([cls, one, many]) => {
    const n = diffs.filter((d) => d.classification === cls).length;
    return n ? [`${n} ${n === 1 ? one : many}`] : [];
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

/** Jira comment body for a report. */
export function reportAdf(session: Session, report: Report, scenarios: Scenario[], diffs: Diff[]): Node {
  const regressions = diffs.filter((d) => d.classification === "NEW_REGRESSION");
  const unclear = diffs.filter((d) => d.classification === "FLAKY" || d.classification === "INCONCLUSIVE" || d.classification === "EXISTING_FAILURE");
  const pr = session.prUrl ? link(`${session.repo}#${session.prNumber}`, session.prUrl) : text(`${session.repo}#${session.prNumber}`);
  return doc(
    heading(3, `PR Confidence: ${VERDICT_LABEL[report.recommendation]}`),
    panel(
      VERDICT_PANEL[report.recommendation],
      para(text("Checked "), pr, text(" at "), code(short(session.headSha)), text(" against base "), code(short(session.baseSha)), text(".")),
      para(text(diffSummary(report, diffs))),
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
      ? bullets(regressions.map((d) => [code(d.scenarioId), text(` ${objective(scenarios, d.scenarioId)}: passes on base, fails on PR (confirmed on rerun).`)]))
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
  return doc(
    para(text(`Found by PR Confidence while checking ${session.issueKey}. `), session.prUrl ? link(`${session.repo}#${session.prNumber}`, session.prUrl) : text(`${session.repo}#${session.prNumber}`)),
    para(text(`Scenario `), code(scenario.id), text(`: ${scenario.objective}. Base `), code(short(session.baseSha)), text(` ${diff.base}, PR `), code(short(session.headSha)), text(` ${diff.head}.`)),
    heading(4, "Steps to reproduce"),
    para(text(`Start from fixture ${scenario.fixture}.${knobs}`)),
    ordered(scenario.steps.map((s) => [text(describeStep(s))])),
    heading(4, "Expected"),
    bullets(scenario.assertions.map((a) => [text(describeAssertion(a))])),
    heading(4, "Actual on the PR"),
    failed.length
      ? bullets(failed.map((a) => [code(a.id), text(` expected ${json(a.expected)}, got ${json(a.actual)}${a.note ? ` (${a.note})` : ""}`)]))
      : para(text(`Run result ${diff.head}.`)),
    heading(4, "Evidence"),
    evidence.length ? bullets(evidence.map((e) => [link(e.label, e.url)])) : para(text("No artifacts were recorded.")),
  );
}
