import type { WebTriggerRequest } from "@forge/api";
import { Event, TOKEN_HEADER } from "../contracts/index";
import { header, respond } from "../lib/http";
import { appendEvents } from "../lib/store";

/** Runner -> Forge. Body is one Event or an array. */
export async function runnerEvents(req: WebTriggerRequest) {
  if (header(req.headers, TOKEN_HEADER) !== process.env.RUNNER_TOKEN) return respond(401);
  const raw = JSON.parse(req.body);
  const events = (Array.isArray(raw) ? raw : [raw]).map((e: unknown) => Event.parse(e));
  const bySession = new Map<string, Event[]>();
  for (const e of events) bySession.set(e.sessionId, [...(bySession.get(e.sessionId) ?? []), e]);
  for (const [sessionId, list] of bySession) await appendEvents(sessionId, list);

  // TODO(A): project events into state:
  //   planner.scenarios -> scenarios:<id>, run.finished -> runs:<id>, verify.diff -> diffs:<id>
  //   session.complete / ask.complete -> compute coverage + recommend, post Jira + GitHub, report:<id>
  return respond(200, { received: events.length });
}
