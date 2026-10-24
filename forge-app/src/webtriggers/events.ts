import type { WebTriggerRequest } from "@forge/api";
import { Queue } from "@forge/events";
import { kvs } from "@forge/kvs";
import { Event, TOKEN_HEADER } from "../contracts/index";
import { header, respond } from "../lib/http";
import { projectEvents } from "../lib/state";
import { appendEvents } from "../lib/store";

const reportQueue = new Queue({ key: "report" });

// The runner's sink aborts a POST after 10 s and retries it, so a retried session.complete must not
// queue a second report. One marker per completing event: its ts is the same on every retry.
const reportingKey = (sessionId: string, ts: string) => `reporting:${sessionId}:${ts}`;

/** Runner -> Forge. Body is one Event or an array. Answers fast; the report runs on the report queue. */
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
  let queueFailed = false;
  for (const [sessionId, list] of bySession) {
    // Separate steps: a failed timeline append must not stop the projections, or the reverse.
    try {
      await appendEvents(sessionId, list);
    } catch (err) {
      console.error(`appendEvents for ${sessionId} failed`, err);
    }
    try {
      await projectEvents(sessionId, list);
    } catch (err) {
      console.error(`projectEvents for ${sessionId} failed`, err);
    }
    // A finished pipeline or ask changes results: queue a report rebuild and publish.
    for (const e of list) {
      if (e.type !== "session.complete" && e.type !== "ask.complete") continue;
      const key = reportingKey(sessionId, e.ts);
      try {
        if (await kvs.get(key)) continue;
        await kvs.set(key, true);
        try {
          await reportQueue.push({ body: { sessionId } });
        } catch (err) {
          await kvs.delete(key); // let the runner's retry queue it
          throw err;
        }
      } catch (err) {
        queueFailed = true;
        console.error(`queueing report for ${sessionId} failed`, err);
      }
    }
  }
  // Only a lost report is worth a runner retry; the timeline and projections are best effort.
  return queueFailed ? respond(500, { error: "could not queue report" }) : respond(200, { received: events.length });
}
