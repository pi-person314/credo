import { kvs } from "@forge/kvs";
import type { AuditEntry, Event, Session } from "../contracts/index";

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
};

export async function saveSession(session: Session) {
  await kvs.set(keys.session(session.id), session);
  await kvs.set(keys.issue(session.issueKey), session.id);
}

export async function sessionForIssue(issueKey: string): Promise<Session | undefined> {
  const id = await kvs.get<string>(keys.issue(issueKey));
  return id ? kvs.get<Session>(keys.session(id)) : undefined;
}

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

export async function appendAudit(issueKey: string, entry: AuditEntry) {
  const list = (await kvs.get<AuditEntry[]>(keys.audit(issueKey))) ?? [];
  await kvs.set(keys.audit(issueKey), [...list, entry].slice(-100));
}
