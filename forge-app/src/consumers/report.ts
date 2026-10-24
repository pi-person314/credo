import type { AsyncEvent } from "@forge/events";
import { onSessionComplete } from "../lib/report";

// Queue consumer for jobs pushed by the runner-events web trigger on session.complete / ask.complete.
// Building and publishing the report is slow (Jira, GitHub), so it runs here and the trigger answers the runner fast.

export async function reportConsumer(event: AsyncEvent) {
  const sessionId = (event.body as { sessionId?: unknown } | undefined)?.sessionId;
  if (typeof sessionId !== "string" || !sessionId) return void console.error("report: bad job");
  try {
    await onSessionComplete(sessionId);
  } catch (err) {
    // Log and drop: a retry would publish again.
    console.error(`report for ${sessionId} failed`, err);
  }
}
