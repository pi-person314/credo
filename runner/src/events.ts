import type { Actor, Event, EventType } from "@pr-agent/contracts";
import type { Sink } from "./sink.js";

export type Emit = (actor: Actor, type: EventType, status: Event["status"], message: string, data?: unknown) => Promise<void>;

/** Bound to one session. Never throws: a dead events endpoint must not stop the pipeline. */
export function emitter(sink: Sink, sessionId: string): Emit {
  return async (actor, type, status, message, data) => {
    const event: Event = { sessionId, ts: new Date().toISOString(), actor, type, status, message, ...(data === undefined ? {} : { data }) };
    await sink.emit(event).catch((err) => console.warn(`event ${type} dropped: ${err instanceof Error ? err.message : err}`));
  };
}
