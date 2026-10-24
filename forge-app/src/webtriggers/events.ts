import type { WebTriggerRequest } from "@forge/api";
import { Event, TOKEN_HEADER } from "../contracts/index";
import { header, respond } from "../lib/http";
import { onSessionComplete } from "../lib/report";
import { projectEvents } from "../lib/state";
import { appendEvents } from "../lib/store";

/** Runner -> Forge. Body is one Event or an array. */
export async function runnerEvents(req: WebTriggerRequest) {
  const token = process.env.RUNNER_TOKEN;
  if (!token || header(req.headers, TOKEN_HEADER) !== token) return respond(401);
  let events: Event[];
  try {
    const raw = JSON.parse(req.body);
    events = (Array.isArray(raw) ? raw : [raw]).map((e: unknown) => Event.parse(e));
  } catch {
    return respond(400, { error: "bad event body" });
  }
  const bySession = new Map<string, Event[]>();
  for (const e of events) bySession.set(e.sessionId, [...(bySession.get(e.sessionId) ?? []), e]);
  for (const [sessionId, list] of bySession) {
    await appendEvents(sessionId, list);
    await projectEvents(sessionId, list);
    // A finished pipeline or ask changes results: rebuild the report and publish it.
    if (list.some((e) => e.type === "session.complete" || e.type === "ask.complete")) {
      try {
        await onSessionComplete(sessionId);
      } catch (err) {
        console.error(`report for ${sessionId} failed`, err);
      }
    }
  }
  return respond(200, { received: events.length });
}
