import { kvs } from "@forge/kvs";
import type {
  Ask,
  AuditEntry,
  Context,
  Diff,
  Event,
  Knobs,
  Report,
  Run,
  SandboxState,
  Scenario,
  Session,
} from "../contracts/index";

// All app state lives in Forge KVS. Key layout is in docs/SPEC.md section 8.
// KVS values have a size limit, so events are stored in chunks of EVENTS_PER_CHUNK.
const EVENTS_PER_CHUNK = 50;

export const keys = {
  session: (id: string) => `session:${id}`,
  issue: (issueKey: string) => `issue:${issueKey}`,
  eventsHead: (id: string) => `events:${id}:head`,
  events: (id: string, chunk: number) => `events:${id}:${chunk}`,
  scenarios: (id: string) => `scenarios:${id}`,
  runs: (id: string) => `runs:${id}`,
  diffs: (id: string) => `diffs:${id}`,
  asks: (id: string) => `asks:${id}`,
  report: (id: string) => `report:${id}`,
  audit: (issueKey: string) => `audit:${issueKey}`,
  // Not in the spec table: Forge-only extras the panel and report need.
  context: (id: string) => `context:${id}`, // Context sent to the runner (findings, acceptance criteria)
  sandbox: (id: string) => `sandbox:${id}`, // SandboxStatus below
};

/** Live sandbox state, projected from sandbox.* and knobs.set events. */
export type SandboxStatus = { base: SandboxState; head: SandboxState; knobs: Knobs };
export const DEFAULT_SANDBOX: SandboxStatus = { base: "down", head: "down", knobs: { provider: "ok", latencyMs: 0 } };

// ---------- session ----------

export async function saveSession(session: Session) {
  await kvs.set(keys.session(session.id), session);
  await kvs.set(keys.issue(session.issueKey), session.id);
}

export const getSession = (id: string) => kvs.get<Session>(keys.session(id));

export async function sessionForIssue(issueKey: string): Promise<Session | undefined> {
  const id = await kvs.get<string>(keys.issue(issueKey));
  return id ? getSession(id) : undefined;
}

/** Read-modify-write a session. No-op if it doesn't exist. */
export async function updateSession(id: string, patch: Partial<Session>) {
  const session = await getSession(id);
  if (!session) return undefined;
  const next = { ...session, ...patch, id };
  await kvs.set(keys.session(id), next);
  return next;
}

// ---------- context (written by ingest) ----------

export const saveContext = (context: Context) => kvs.set(keys.context(context.session.id), context);
export const getContext = (id: string) => kvs.get<Context>(keys.context(id));

// ---------- lists keyed by session ----------

const list = async <T>(key: string) => (await kvs.get<T[]>(key)) ?? [];

/** Insert or replace items by `idOf`, keeping order of first arrival. */
async function upsert<T>(key: string, items: T[], idOf: (x: T) => string) {
  const current = await list<T>(key);
  const byId = new Map(current.map((x) => [idOf(x), x]));
  for (const x of items) byId.set(idOf(x), x);
  const next = [...byId.values()];
  await kvs.set(key, next);
  return next;
}

export const getScenarios = (id: string) => list<Scenario>(keys.scenarios(id));
export const upsertScenarios = (id: string, items: Scenario[]) => upsert(keys.scenarios(id), items, (s) => s.id);

export const getRuns = (id: string) => list<Run>(keys.runs(id));
export const upsertRuns = (id: string, items: Run[]) => upsert(keys.runs(id), items, (r) => r.id);

// One diff per scenario: a later verify.diff for the same scenario replaces the earlier one.
export const getDiffs = (id: string) => list<Diff>(keys.diffs(id));
export const upsertDiffs = (id: string, items: Diff[]) => upsert(keys.diffs(id), items, (d) => d.scenarioId);

export const getAsks = (id: string) => list<Ask>(keys.asks(id));
export const upsertAsks = (id: string, items: Ask[]) => upsert(keys.asks(id), items, (a) => a.id);

export const getReport = (id: string) => kvs.get<Report>(keys.report(id));
export const saveReport = (report: Report) => kvs.set(keys.report(report.sessionId), report);

export const getSandbox = async (id: string) => (await kvs.get<SandboxStatus>(keys.sandbox(id))) ?? DEFAULT_SANDBOX;
export async function updateSandbox(id: string, patch: Partial<SandboxStatus>) {
  const next = { ...(await getSandbox(id)), ...patch };
  await kvs.set(keys.sandbox(id), next);
  return next;
}

// ---------- events ----------

export async function appendEvents(sessionId: string, events: Event[]) {
  // TODO(A): not concurrency-safe. Fine for one demo session; use a transaction or Forge SQL if needed.
  let head = (await kvs.get<number>(keys.eventsHead(sessionId))) ?? 0;
  let chunk = (await kvs.get<Event[]>(keys.events(sessionId, head))) ?? [];
  for (const e of events) {
    if (chunk.length >= EVENTS_PER_CHUNK) {
      await kvs.set(keys.events(sessionId, head), chunk);
      head += 1;
      chunk = [];
    }
    chunk.push(e);
  }
  await kvs.set(keys.events(sessionId, head), chunk);
  await kvs.set(keys.eventsHead(sessionId), head);
}

/**
 * Events in arrival order. `after` is a cursor: a number skips that many events (the count the
 * caller already has), an ISO timestamp keeps only events with a later `ts`.
 */
export async function readEvents(sessionId: string, after?: number | string): Promise<Event[]> {
  const head = await kvs.get<number>(keys.eventsHead(sessionId));
  if (head === undefined) return [];
  const skip = typeof after === "number" && after > 0 ? after : 0;
  const out: Event[] = [];
  for (let c = Math.floor(skip / EVENTS_PER_CHUNK); c <= head; c++) {
    out.push(...((await kvs.get<Event[]>(keys.events(sessionId, c))) ?? []));
  }
  const fromIndex = skip - Math.floor(skip / EVENTS_PER_CHUNK) * EVENTS_PER_CHUNK;
  const rest = out.slice(fromIndex);
  return typeof after === "string" ? rest.filter((e) => e.ts > after) : rest;
}

// ---------- audit ----------

export async function appendAudit(issueKey: string, entry: AuditEntry) {
  const current = await list<AuditEntry>(keys.audit(issueKey));
  await kvs.set(keys.audit(issueKey), [...current, entry].slice(-100));
}

export const getAudit = (issueKey: string) => list<AuditEntry>(keys.audit(issueKey));
