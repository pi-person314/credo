import {
  coverage,
  recommend,
  type AcCoverage,
  type Context,
  type Diff,
  type Event,
  type Finding,
  type Report,
  type Scenario,
  type Session,
} from "../contracts/index";
import { diffSummary } from "./adf";
import { appendEvents, getContext, getDiffs, getScenarios, getSession, saveReport, updateSession } from "./store";

// Report = coverage + verdict from contracts/rules.ts, plus a markdown body for Jira / GitHub.
// Publishing lives in another module; it plugs in with registerPublishHook.

export type PublishInput = { session: Session; report: Report; context?: Context };
export type PublishHook = (input: PublishInput) => Promise<void>;

let publishHook: PublishHook = async () => undefined;

/** The integrator wires Jira comment + GitHub comment/status here. */
export function registerPublishHook(fn: PublishHook) {
  publishHook = fn;
}

/** A finding counts as tested if a scenario that ran points at "<source>:<id>" (or the bare id). */
function testedFindingIds(findings: Finding[], scenarios: Scenario[], diffs: Diff[]) {
  const ran = new Set(diffs.filter((d) => d.classification !== "INCONCLUSIVE").map((d) => d.scenarioId));
  const refs = new Set(scenarios.filter((s) => ran.has(s.id)).flatMap((s) => s.sourceRefs));
  return findings.filter((f) => refs.has(`${f.source}:${f.id}`) || refs.has(f.id)).map((f) => f.id);
}

function risks(findings: Finding[], tested: string[], diffs: Diff[], acs: AcCoverage[]) {
  return [
    ...diffs.filter((d) => d.classification === "NEW_REGRESSION").map((d) => `Regression: ${d.scenarioId} passes on base, fails on PR`),
    ...diffs.filter((d) => d.classification === "FLAKY" || d.classification === "INCONCLUSIVE").map((d) => `${d.classification}: ${d.scenarioId}`),
    ...acs.filter((a) => a.status === "UNTESTED").map((a) => `Untested AC${a.index}: ${a.text}`),
    ...findings.filter((f) => f.severity !== "low" && !tested.includes(f.id)).map((f) => `Untested ${f.severity} finding (${f.source}): ${f.description}`),
  ];
}

/** PR-side counts. A FLAKY or INCONCLUSIVE diff counts as inconclusive even if the PR run passed, matching AC coverage. */
function counts(scenarios: Scenario[], diffs: Diff[]) {
  const c = { passed: 0, failed: 0, inconclusive: 0, notRun: 0 };
  for (const s of scenarios) {
    const d = diffs.find((x) => x.scenarioId === s.id);
    const head = d?.head ?? "NOT_RUN";
    if (d && (d.classification === "FLAKY" || d.classification === "INCONCLUSIVE")) c.inconclusive++;
    else if (head === "PASS") c.passed++;
    else if (head === "FAIL") c.failed++;
    else if (head === "INCONCLUSIVE") c.inconclusive++;
    else c.notRun++;
  }
  return c;
}

function markdown(session: Session, r: Omit<Report, "markdown">, scenarios: Scenario[], diffs: Diff[]) {
  const objective = (id: string) => scenarios.find((s) => s.id === id)?.objective ?? id;
  return [
    `**PR Confidence: ${r.recommendation}** for PR #${session.prNumber} (${session.baseSha.slice(0, 7)} → ${session.headSha.slice(0, 7)})`,
    diffSummary(r, diffs),
    "",
    "**Acceptance criteria**",
    ...(r.coverage.length ? r.coverage.map((a) => `- AC${a.index} ${a.status}: ${a.text}`) : ["- none found on the ticket"]),
    "",
    "**Scenarios (base / PR)**",
    ...(diffs.length ? diffs.map((d) => `- ${objective(d.scenarioId)}: ${d.base} / ${d.head} → ${d.classification}`) : ["- none ran"]),
    ...(r.risks.length ? ["", "**Not proven / risks**", ...r.risks.map((x) => `- ${x}`)] : []),
    "",
    "_This is not a merge approval. A human decides._",
  ].join("\n");
}

/** Compute and save report:<id>. Undefined if the session is unknown. */
export async function buildReport(sessionId: string): Promise<Report | undefined> {
  const [session, context, scenarios, diffs] = await Promise.all([
    getSession(sessionId),
    getContext(sessionId),
    getScenarios(sessionId),
    getDiffs(sessionId),
  ]);
  if (!session) return undefined;
  const findings = context?.findings ?? [];
  const acs = coverage(session.issueKey, context?.jira?.acceptanceCriteria ?? [], scenarios, diffs);
  const tested = testedFindingIds(findings, scenarios, diffs);
  const base = {
    sessionId,
    ...counts(scenarios, diffs),
    risks: risks(findings, tested, diffs, acs),
    coverage: acs,
    recommendation: recommend(diffs, findings, acs, tested),
  };
  const report: Report = { ...base, markdown: markdown(session, base, scenarios, diffs) };
  await saveReport(report);
  return report;
}

/** Called on session.complete and ask.complete: report, session READY, report.ready event, publish. */
export async function onSessionComplete(sessionId: string) {
  const report = await buildReport(sessionId);
  if (!report) return console.warn(`report skipped: no session ${sessionId}`);
  const session = await updateSession(sessionId, { status: "READY", recommendation: report.recommendation });
  const event: Event = {
    sessionId,
    ts: new Date().toISOString(),
    actor: "reporter",
    type: "report.ready",
    status: "ok",
    message: `Report: ${report.recommendation}`,
    data: report,
  };
  await appendEvents(sessionId, [event]);
  if (!session) return;
  try {
    await publishHook({ session, report, context: await getContext(sessionId) });
  } catch (err) {
    console.error(`publish for ${sessionId} failed`, err);
  }
}
