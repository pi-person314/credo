import { asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { createHash } from "node:crypto";
import type { Route } from "@forge/api";
import type { Actor, AuditEntry, Diff, EventType, Recommendation, Report, Scenario, Session } from "../contracts/index";
import { notTested, reportAdf, VERDICT_LABEL } from "./adf";
import { hasGithubToken, postPrComment, setCommitStatus, updatePrComment, type StatusState } from "./github-write";
import { appendAudit, appendEvents } from "./store";

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
  if (!res.ok) throw new Error(`jira ${method} ${path.value} -> ${res.status}`);
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
    `### PR Confidence: ${VERDICT_LABEL[report.recommendation]}`,
    `Checked \`${session.headSha.slice(0, 7)}\` against base \`${session.baseSha.slice(0, 7)}\` for ${issue}.`,
    `${report.passed} passed, ${report.failed} failed, ${report.inconclusive} inconclusive, ${report.notRun} not run.`,
    "",
    "#### Acceptance criteria",
    rows.length ? ["| # | Criterion | Status | Scenarios |", "|---|---|---|---|", ...rows].join("\n") : "No acceptance criteria found on the issue.",
    "",
    "#### Regressions",
    regressions.length
      ? regressions.map((d) => `- \`${d.scenarioId}\` ${name(d.scenarioId)}: passes on base, fails on this PR (confirmed on rerun).`).join("\n")
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
 * Post the report: Jira comment, GitHub PR comment, and the "PR Confidence" commit status on headSha.
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
      await audit(session, { action: "github.comment", target: prTarget, reason: `${reason} (${errText(e)})`, result: "failed" });
      await emit(session, "reporter", "publish.github", false, `GitHub publish failed: ${errText(e)}`);
    }
  }

  await kvs.set(pubKeys.published(session.id, hash), done);
  await kvs.set(pubKeys.comments(session.id), ids);
  return { hash, jira: jiraOut, github: githubOut, publishedAt: new Date().toISOString() };
}
