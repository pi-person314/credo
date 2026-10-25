import { asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { createHash } from "node:crypto";
import type { Route } from "@forge/api";
import type { Actor, AuditEntry, Diff, EventType, Recommendation, Report, Run, Scenario, Session } from "../contracts/index";
import { bugAdf, greptileNote, diffSummary, notTested, reportAdf, VERDICT_LABEL, type Evidence } from "./adf";
import { hasGithubToken, postPrComment, setCommitStatus, updatePrComment, type StatusState } from "./github-write";
import { signSessionToken } from "../contracts/token";
import { appendAudit, appendEvents, keys } from "./store";

// Every write the agent makes in Jira or GitHub. Each one lands in the audit log and the timeline.
// Writes that change the ticket's workflow (transitions) only run in approveTransition, after a human click.
const pubKeys = {
  published: (id: string, hash: string) => `published:${id}:${hash}`, // { jira?: true, github?: true }
  comments: (id: string) => `comments:${id}`, // { jira?: string, github?: number } so later reports edit in place
  bug: (id: string, scenarioId: string) => `bug:${id}:${scenarioId}`, // filed Bug key
  transition: (id: string) => `transition:${id}`, // proposed { id, name }
};

export type Outcome = "posted" | "updated" | "already" | "skipped" | "failed";
type Transition = { id: string; name: string };

async function jira<T>(method: string, path: Route, body?: unknown): Promise<T> {
  const res = await asApp().requestJira(path, {
    method,
    headers: { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`jira ${method} ${path.value} -> ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const raw = await res.text(); // 201/204 on links and transitions have no body
  return (raw ? JSON.parse(raw) : undefined) as T;
}

async function audit(session: Session, entry: Omit<AuditEntry, "ts" | "sessionId">) {
  await appendAudit(session.issueKey, { ts: new Date().toISOString(), sessionId: session.id, ...entry });
}

async function emit(session: Session, actor: Actor, type: EventType, ok: boolean, message: string, data?: unknown) {
  await appendEvents(session.id, [{ sessionId: session.id, ts: new Date().toISOString(), actor, type, status: ok ? "ok" : "fail", message, data }]);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Jira site URL for links, e.g. https://team.atlassian.net. Undefined if the lookup fails. */
async function siteUrl() {
  try {
    return (await jira<{ baseUrl: string }>("GET", route`/rest/api/3/serverInfo`)).baseUrl;
  } catch {
    return undefined;
  }
}

/** Stable hash of what the report says, so the same report is never posted twice. */
export function reportHash(report: Report, diffs: Diff[]) {
  const { publishedAt: _p, markdown: _m, ...rest } = report;
  const d = diffs.map((x) => [x.scenarioId, x.classification]).sort();
  return createHash("sha256").update(JSON.stringify([rest, d])).digest("hex").slice(0, 16);
}

// ---------- Report ----------

// Commit status per verdict. NEEDS_REVIEW is "pending": nothing confirmed broken, but a person has to
// look before it counts as done, and pending holds a required check without claiming a failure.
// NO_BLOCKERS_FOUND is "success" with a description that still points at what was not tested.
function statusFor(report: Report, diffs: Diff[]): { state: StatusState; description: string } {
  const regressions = diffs.filter((d) => d.classification === "NEW_REGRESSION").length;
  const untested = report.coverage.filter((c) => c.status === "UNTESTED").length;
  const byVerdict: Record<Recommendation, { state: StatusState; description: string }> = {
    BLOCKING_REGRESSION: { state: "failure", description: `${regressions} regression(s) vs base. ${report.failed} failed, ${report.passed} passed.` },
    NEEDS_REVIEW: { state: "pending", description: `Needs review: ${report.inconclusive} inconclusive, ${untested} AC untested.` },
    NO_BLOCKERS_FOUND: { state: "success", description: `No blockers found in ${report.passed} checks. See report for what was not tested.` },
  };
  return byVerdict[report.recommendation];
}

/** GitHub PR comment body. The hidden marker lets people (and us) find it. */
export function reportMarkdown(session: Session, report: Report, scenarios: Scenario[], diffs: Diff[], issueUrl?: string) {
  const name = (id: string) => scenarios.find((s) => s.id === id)?.objective ?? id;
  const issue = issueUrl ? `[${session.issueKey}](${issueUrl})` : session.issueKey;
  const regressions = diffs.filter((d) => d.classification === "NEW_REGRESSION");
  const rows = report.coverage.map((c) => `| AC${c.index} | ${c.text.replace(/\|/g, "\\|")} | **${c.status}** | ${c.scenarioIds.join(", ") || "none"} |`);
  return [
    `<!-- pr-confidence:session=${session.id} -->`,
    `### Credo: ${VERDICT_LABEL[report.recommendation]}`,
    `Checked \`${session.headSha.slice(0, 7)}\` against base \`${session.baseSha.slice(0, 7)}\` for ${issue}.`,
    diffSummary(report, diffs),
    "",
    "#### Acceptance criteria",
    rows.length ? ["| # | Criterion | Status | Scenarios |", "|---|---|---|---|", ...rows].join("\n") : "No acceptance criteria found on the issue.",
    "",
    "#### Regressions",
    regressions.length
      ? regressions.map((d) => `- \`${d.scenarioId}\` ${name(d.scenarioId)}: passes on base, fails on this PR (confirmed on rerun).${greptileNote(scenarios, d.scenarioId)}`).join("\n")
      : "None found in the scenarios that ran.",
    "",
    "#### What was not tested",
    notTested(report).map((t) => `- ${t}`).join("\n"),
    "",
    "_This report lists what was checked. A person still decides whether to merge._",
  ].join("\n");
}

async function publishJira(session: Session, report: Report, scenarios: Scenario[], diffs: Diff[], prior?: string) {
  const body = { body: reportAdf(session, report, scenarios, diffs) };
  if (prior) {
    try {
      return (await jira<{ id: string }>("PUT", route`/rest/api/3/issue/${session.issueKey}/comment/${prior}`, body)).id;
    } catch {
      // Someone deleted our comment. Post a fresh one.
    }
  }
  return (await jira<{ id: string }>("POST", route`/rest/api/3/issue/${session.issueKey}/comment`, body)).id;
}

async function publishGithub(session: Session, report: Report, scenarios: Scenario[], diffs: Diff[], prior?: number) {
  const issueUrl = await siteUrl().then((u) => (u ? `${u}/browse/${session.issueKey}` : undefined));
  const md = reportMarkdown(session, report, scenarios, diffs, issueUrl);
  const id = (prior && (await updatePrComment(session.repo, prior, md).catch(() => undefined))) || (await postPrComment(session.repo, session.prNumber, md));
  const { state, description } = statusFor(report, diffs);
  await setCommitStatus(session.repo, session.headSha, state, description, issueUrl ?? session.prUrl);
  return { id, state, description };
}

/**
 * Post the report: Jira comment, GitHub PR comment, and the "Credo" commit status on headSha.
 * The first report creates the comments; later reports edit them. The same report is never posted twice.
 * Never throws: each side is audited as ok or failed on its own.
 */
export async function publishReport(session: Session, report: Report, scenarios: Scenario[], diffs: Diff[]) {
  const hash = reportHash(report, diffs);
  const done = (await kvs.get<{ jira?: boolean; github?: boolean }>(pubKeys.published(session.id, hash))) ?? {};
  const ids = (await kvs.get<{ jira?: string; github?: number }>(pubKeys.comments(session.id))) ?? {};
  const reason = `report ${hash}: ${report.recommendation}`;
  let jiraOut: Outcome = "already";
  let githubOut: Outcome = "already";

  if (!done.jira) {
    try {
      const updating = ids.jira !== undefined;
      ids.jira = await publishJira(session, report, scenarios, diffs, ids.jira);
      jiraOut = updating ? "updated" : "posted";
      done.jira = true;
      await audit(session, { action: "jira.comment", target: session.issueKey, reason, result: "ok", inputs: { commentId: ids.jira } });
      await emit(session, "reporter", "publish.jira", true, `Report posted to ${session.issueKey}`);
    } catch (e) {
      jiraOut = "failed";
      console.warn(`publish ${session.id}: Jira comment failed: ${errText(e)}`);
      await audit(session, { action: "jira.comment", target: session.issueKey, reason: `${reason} (${errText(e)})`, result: "failed" });
      await emit(session, "reporter", "publish.jira", false, `Jira comment failed: ${errText(e)}`);
    }
  }

  const prTarget = session.prUrl ?? `${session.repo}#${session.prNumber}`;
  if (!done.github && !hasGithubToken()) {
    githubOut = "skipped";
    console.log(`publish ${session.id}: GITHUB_TOKEN not set, skipping GitHub`);
  } else if (!done.github) {
    try {
      const updating = ids.github !== undefined;
      const gh = await publishGithub(session, report, scenarios, diffs, ids.github);
      ids.github = gh.id ?? ids.github;
      githubOut = updating ? "updated" : "posted";
      done.github = true;
      await audit(session, { action: "github.comment", target: prTarget, reason, result: "ok", inputs: { commentId: ids.github } });
      await audit(session, { action: "github.status", target: `${session.repo}@${session.headSha}`, reason: gh.description, result: "ok", inputs: { state: gh.state } });
      await emit(session, "reporter", "publish.github", true, `PR comment and status (${gh.state}) posted`);
    } catch (e) {
      githubOut = "failed";
      console.warn(`publish ${session.id}: GitHub publish failed: ${errText(e)}`);
      await audit(session, { action: "github.comment", target: prTarget, reason: `${reason} (${errText(e)})`, result: "failed" });
      await emit(session, "reporter", "publish.github", false, `GitHub publish failed: ${errText(e)}`);
    }
  }

  await kvs.set(pubKeys.published(session.id, hash), done);
  await kvs.set(pubKeys.comments(session.id), ids);
  return { hash, jira: jiraOut, github: githubOut, publishedAt: new Date().toISOString() };
}

// ---------- Regression Bug ----------

type IssueType = { id: string; name: string; subtask?: boolean };

/** Bug if the project has one, else Task, else the first standard type. */
async function bugType(projectKey: string): Promise<IssueType> {
  let types: IssueType[] = [];
  try {
    const res = await jira<{ issueTypes?: IssueType[]; values?: IssueType[] }>("GET", route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
    types = res.issueTypes ?? res.values ?? [];
  } catch {
    types = (await jira<{ issueTypes?: IssueType[] }>("GET", route`/rest/api/3/project/${projectKey}`)).issueTypes ?? [];
  }
  const named = (n: string) => types.find((t) => t.name.toLowerCase() === n);
  const pick = named("bug") ?? named("task") ?? types.find((t) => !t.subtask);
  if (!pick) throw new Error(`no issue type to create in ${projectKey}`);
  return pick;
}

/** "Relates" if it exists, else the first link type. */
async function linkTypeName() {
  const res = await jira<{ issueLinkTypes: { name: string }[] }>("GET", route`/rest/api/3/issueLinkType`);
  return (res.issueLinkTypes.find((t) => t.name.toLowerCase() === "relates") ?? res.issueLinkTypes[0])?.name;
}

// Artifacts are served by the runner at /artifacts/<sessionId>/<path>?t=<signed token>.
// Bug links outlive the panel's 12 h view token, so these get a longer TTL.
const EVIDENCE_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;
function artifactUrl(sessionId: string, path: string) {
  const rel = path.startsWith(`${sessionId}/`) ? path : `${sessionId}/${path}`;
  const t = signSessionToken(process.env.RUNNER_TOKEN ?? "", sessionId, EVIDENCE_TOKEN_TTL_SEC);
  return `${(process.env.RUNNER_URL ?? "").replace(/\/+$/, "")}/artifacts/${rel}?t=${encodeURIComponent(t)}`;
}

function evidenceFor(session: Session, runs: Run[]): Evidence[] {
  const out: Evidence[] = runs.flatMap((r) =>
    r.artifacts.map((a) => ({ label: `${r.env} attempt ${r.attempt}: ${a.kind} (${a.path.split("/").pop()})`, url: artifactUrl(session.id, a.path) })),
  );
  if (session.prUrl) out.push({ label: `Pull request ${session.repo}#${session.prNumber}`, url: session.prUrl });
  return out;
}

/**
 * File a Bug for a failing scenario in the issue's project, linked to the issue. Call only after a human
 * confirmed (panel click or Rovo "yes"); `actor` is their accountId. Filing the same scenario twice returns
 * the first key. Throws if the Bug could not be created.
 */
export async function fileRegressionBug(session: Session, scenario: Scenario, diff: Diff, actor: string) {
  const existing = await kvs.get<string>(pubKeys.bug(session.id, scenario.id));
  if (existing) return existing;

  const runs = ((await kvs.get<Run[]>(keys.runs(session.id))) ?? []).filter((r) => diff.runIds.includes(r.id));
  const headRuns = runs.filter((r) => r.env === "head");
  const projectKey = session.issueKey.split("-")[0];
  const summary = `Regression from ${session.repo}#${session.prNumber}: ${scenario.objective}`.slice(0, 254);
  const inputs = { scenarioId: scenario.id, classification: diff.classification, runIds: diff.runIds };

  let key: string;
  try {
    const type = await bugType(projectKey);
    const description = bugAdf(session, scenario, diff, headRuns, evidenceFor(session, runs));
    const fields = { project: { key: projectKey }, issuetype: { id: type.id }, summary, description, labels: ["credo"] };
    key = (await jira<{ key: string }>("POST", route`/rest/api/3/issue`, { fields })).key;
  } catch (e) {
    await audit(session, { action: "jira.bug", target: session.issueKey, approvedBy: actor, inputs, reason: `create failed: ${errText(e)}`, result: "failed" });
    await emit(session, "agent", "bug.filed", false, `Bug for ${scenario.id} failed: ${errText(e)}`);
    throw e;
  }
  await kvs.set(pubKeys.bug(session.id, scenario.id), key);

  let linked = "";
  try {
    linked = (await linkTypeName()) ?? "";
    if (linked) await jira("POST", route`/rest/api/3/issueLink`, { type: { name: linked }, inwardIssue: { key }, outwardIssue: { key: session.issueKey } });
  } catch (e) {
    console.log(`link ${key} -> ${session.issueKey} failed: ${errText(e)}`);
    linked = "";
  }
  const reason = `${scenario.id} ${diff.classification}; ${linked ? `linked "${linked}" to ${session.issueKey}` : "not linked"}`;
  await audit(session, { action: "jira.bug", target: key, approvedBy: actor, inputs, reason, result: "ok" });
  await emit(session, "agent", "bug.filed", true, `Filed ${key} for ${scenario.id}`, { key, scenarioId: scenario.id });
  return key;
}

// ---------- Guarded transition ----------

const TARGET_STATUS = "in progress";

/** The issue's transition into "In Progress", matched on the transition or its target status name. */
async function findTransition(issueKey: string): Promise<Transition | undefined> {
  const res = await jira<{ transitions: { id: string; name: string; to?: { name?: string } }[] }>(
    "GET",
    route`/rest/api/3/issue/${issueKey}/transitions`,
  );
  const t = res.transitions.find((x) => x.to?.name?.toLowerCase() === TARGET_STATUS || x.name.toLowerCase() === TARGET_STATUS);
  return t ? { id: t.id, name: t.to?.name ?? t.name } : undefined;
}

/**
 * Propose moving the issue back to In Progress. Changes nothing in Jira: it records the proposal so the
 * panel can show the button. Returns the transition, or undefined if the workflow has none.
 */
export async function proposeTransition(session: Session) {
  const prior = await kvs.get<Transition>(pubKeys.transition(session.id));
  if (prior) return prior;
  let t: Transition | undefined;
  try {
    t = await findTransition(session.issueKey);
  } catch (e) {
    console.log(`transitions for ${session.issueKey} failed: ${errText(e)}`);
  }
  if (!t) return undefined;
  await kvs.set(pubKeys.transition(session.id), t);
  const reason = `${session.recommendation ?? "regression"}: move back to ${t.name} needs a human OK`;
  await audit(session, { action: "jira.transition", target: session.issueKey, inputs: { transitionId: t.id }, reason, result: "proposed" });
  await emit(session, "agent", "transition.proposed", true, `Proposed moving ${session.issueKey} to ${t.name}`, t);
  return t;
}

/** Perform the transition. Only call from a human action; `actor` is their accountId. */
export async function approveTransition(session: Session, actor: string) {
  if (!actor) throw new Error("approveTransition needs the approving user's accountId");
  let t: Transition | undefined;
  try {
    // Look it up again: the issue may have moved since the proposal.
    t = await findTransition(session.issueKey);
    if (!t) throw new Error(`no transition to In Progress from the current status`);
    await jira("POST", route`/rest/api/3/issue/${session.issueKey}/transitions`, { transition: { id: t.id } });
  } catch (e) {
    await audit(session, { action: "jira.transition", target: session.issueKey, approvedBy: actor, inputs: { transitionId: t?.id }, reason: errText(e), result: "failed" });
    await emit(session, "reviewer", "transition.approved", false, `Transition failed: ${errText(e)}`);
    return { ok: false, error: errText(e) };
  }
  await kvs.delete(pubKeys.transition(session.id));
  await audit(session, { action: "jira.transition", target: session.issueKey, approvedBy: actor, inputs: { transitionId: t.id }, reason: `approved move to ${t.name}`, result: "ok" });
  await emit(session, "reviewer", "transition.approved", true, `${session.issueKey} moved to ${t.name}`, t);
  return { ok: true, transition: t };
}

/** The open proposal, if any, so the panel knows whether to show "Move back to In Progress". */
export const pendingTransition = (sessionId: string) => kvs.get<Transition>(pubKeys.transition(sessionId));
