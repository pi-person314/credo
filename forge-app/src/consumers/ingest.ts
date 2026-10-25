import { randomUUID } from "node:crypto";
import type { AsyncEvent } from "@forge/events";
import { z } from "zod";
import {
  AppManifest,
  Context,
  findJiraKey,
  type ChangedFile,
  type ConfluencePage,
  type Event,
  type Finding,
  type JiraIssue,
  type Session,
} from "../contracts/index";
import { readLinkedPages } from "../lib/confluence";
import { ingestLogLine, type IngestSummary } from "../lib/ingest-summary";
import { readGreptileFindings, readManifest, readPrFiles } from "../lib/github";
import { readIssue, readRemoteLinks } from "../lib/jira";
import { runner } from "../lib/runner";
import { appendEvents, saveContext, saveIngestSummary, saveSession, sessionForIssue } from "../lib/store";

// Queue consumer for jobs pushed by the github web trigger.
// Every source is best effort: a failed read becomes a "fail" event, not a failed session.
// Only a runner failure fails the session.

/** Queue payload from webtriggers/github.ts. */
export const IngestJob = z.object({
  issueKey: z.string().optional(),
  repo: z.string().regex(/^[^/]+\/[^/]+$/), // "owner/name"
  owner: z.string().optional(),
  name: z.string().optional(),
  prNumber: z.number().int(),
  prUrl: z.string().url().optional(),
  title: z.string(),
  branch: z.string().default(""),
  prBody: z.string().default(""),
  baseSha: z.string(),
  headSha: z.string(),
  cloneUrl: z.string().optional(),
  action: z.string().optional(),
});
export type IngestJob = z.input<typeof IngestJob>;

/** Used when the repo has no valid manifest.json. Same as demo-app/manifest.json. */
const DEFAULT_MANIFEST: AppManifest = {
  api: ["POST /api/orders", "POST /api/pay", "GET /api/orders/:id"],
  pages: ["/cart", "/checkout", "/orders/:id"],
  selectors: { payButton: "[data-test=pay]", status: "[data-test=order-status]" },
  fixtures: ["cart_one_item", "cart_two_items"],
  tables: ["orders", "charges"],
  providerModes: ["ok", "slow", "timeout", "error"],
};

const errMsg = (e: unknown) => String((e as Error)?.message ?? e);

function event(sessionId: string, type: Event["type"], status: Event["status"], message: string, data?: unknown): Event {
  return { sessionId, ts: new Date().toISOString(), actor: "ingest", type, status, message, data };
}

async function ingestPr(s: Session, job: z.output<typeof IngestJob>) {
  let files: ChangedFile[] = [];
  let error: string | undefined;
  const events: Event[] = [];
  try {
    files = await readPrFiles(job);
    events.push(event(s.id, "ingest.pr", "ok", `PR #${s.prNumber}: ${files.length} changed files`, { files: files.map((f) => f.path) }));
  } catch (e) {
    error = errMsg(e);
    events.push(event(s.id, "ingest.pr", "fail", `Could not read PR files: ${error}`));
  }
  const manifest = await readManifest(job.repo, job.headSha);
  if (!manifest) events.push(event(s.id, "ingest.pr", "info", "No manifest.json in the repo, using the demo manifest"));
  return { files, error, manifest: manifest ?? DEFAULT_MANIFEST, defaultManifest: !manifest, events };
}

async function ingestJira(s: Session) {
  try {
    const jira = await readIssue(s.issueKey);
    const n = jira.acceptanceCriteria.length;
    const msg = `${jira.key}: ${jira.summary} (${n} acceptance ${n === 1 ? "criterion" : "criteria"})`;
    return { jira, error: undefined, events: [event(s.id, "ingest.jira", n ? "ok" : "info", msg, { acceptanceCriteria: jira.acceptanceCriteria })] };
  } catch (e) {
    const error = errMsg(e);
    return { jira: undefined, error, events: [event(s.id, "ingest.jira", "fail", `Could not read ${s.issueKey}: ${error}`)] };
  }
}

async function ingestConfluence(s: Session, jira?: JiraIssue) {
  let pages: ConfluencePage[] = [];
  try {
    const links = await readRemoteLinks(s.issueKey);
    const siteHost = jira?.url ? new URL(jira.url).hostname : undefined;
    const read = await readLinkedPages(links, siteHost);
    pages = read.pages;
    const status = read.errors.length ? "fail" : pages.length ? "ok" : "info";
    const msg = `${pages.length} linked Confluence page${pages.length === 1 ? "" : "s"}`;
    const data = { titles: pages.map((p) => p.title), errors: read.errors };
    return { pages, errors: read.errors, events: [event(s.id, "ingest.confluence", status, msg, data)] };
  } catch (e) {
    const error = errMsg(e);
    return { pages, errors: [error], events: [event(s.id, "ingest.confluence", "fail", `Could not read linked pages: ${error}`)] };
  }
}

async function ingestGreptile(s: Session, job: z.output<typeof IngestJob>) {
  const { findings, errors } = await readGreptileFindings(job, s.id, s.headSha);
  const status = errors.length ? "fail" : findings.length ? "ok" : "info";
  const msg = `${findings.length} Greptile finding${findings.length === 1 ? "" : "s"}`;
  return { findings, errors, events: [event(s.id, "ingest.greptile", status, msg, errors.length ? { errors } : undefined)] };
}

/** A redelivered job for a PR head we already started. */
async function alreadyStarted(issueKey: string, job: z.output<typeof IngestJob>) {
  const prev = await sessionForIssue(issueKey);
  return prev && prev.repo === job.repo && prev.prNumber === job.prNumber && prev.headSha === job.headSha && prev.status !== "FAILED";
}

async function failSession(session: Session, message: string) {
  await appendEvents(session.id, [event(session.id, "session.failed", "fail", message)]);
  await saveSession({ ...session, status: "FAILED", error: message });
}

export async function ingest(raw: unknown) {
  const parsed = IngestJob.safeParse(raw);
  if (!parsed.success) return void console.error("ingest: bad job", parsed.error.message);
  const job = parsed.data;
  const issueKey = job.issueKey ?? findJiraKey(job.title, job.branch);
  if (!issueKey) return void console.warn("ingest: no Jira key", job.title);
  if (await alreadyStarted(issueKey, job)) return void console.log("ingest: duplicate job", job.repo, job.headSha);

  let session: Session = {
    id: `ses_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    repo: job.repo,
    prNumber: job.prNumber,
    prUrl: job.prUrl,
    title: job.title,
    baseSha: job.baseSha,
    headSha: job.headSha,
    issueKey,
    status: "INGESTING",
    createdAt: new Date().toISOString(),
  };
  await saveSession(session);

  const [pr, jira, greptile] = await Promise.all([ingestPr(session, job), ingestJira(session), ingestGreptile(session, job)]);
  const confluence = await ingestConfluence(session, jira.jira);
  await appendEvents(session.id, [...pr.events, ...jira.events, ...confluence.events, ...greptile.events]);
  const summary: IngestSummary = {
    at: new Date().toISOString(),
    jira: { key: issueKey, criteria: jira.jira?.acceptanceCriteria.length ?? 0, error: jira.error },
    confluence: { pages: confluence.pages.map((p) => ({ title: p.title, url: p.url })), errors: confluence.errors },
    pr: { files: pr.files.length, error: pr.error, manifest: pr.defaultManifest ? "default" : "repo" },
    greptile: { findings: greptile.findings.length, errors: greptile.errors },
  };
  await saveIngestSummary(session.id, summary);
  console.log(ingestLogLine(session.id, summary));

  session = { ...session, status: "PREPARING" };
  await saveSession(session);
  try {
    const context = Context.parse({
      session,
      prBody: job.prBody,
      changedFiles: pr.files,
      jira: jira.jira,
      confluence: confluence.pages,
      findings: greptile.findings satisfies Finding[],
      manifest: pr.manifest,
      priorScenarioIds: [],
    });
    // The report reads findings, acceptance criteria and the issue from context:<id>.
    await saveContext(context);
    await runner.start(context);
  } catch (e) {
    await failSession(session, `Could not start the runner: ${errMsg(e)}`);
  }
}

/** Queue consumer (@forge/events v2+ function consumer). The job is in event.body. */
export async function ingestConsumer(event: AsyncEvent) {
  try {
    await ingest(event.body);
  } catch (e) {
    // KVS failures land here. Log and drop: a retry would create a second session.
    console.error("ingest failed", errMsg(e));
  }
}
