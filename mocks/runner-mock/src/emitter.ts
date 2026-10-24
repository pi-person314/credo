import { Event, TOKEN_HEADER, type Actor, type EventType } from "@pr-agent/contracts";

/** Builds, validates and delivers one Event. Resolves false if it was not delivered. */
export type Emit = (actor: Actor, type: EventType, status: Event["status"], message: string, data?: unknown) => Promise<boolean>;

const build = (sessionId: string, ...[actor, type, status, message, data]: Parameters<Emit>) =>
  Event.parse({ sessionId, ts: new Date().toISOString(), actor, type, status, message, data });

/** Posts each event to the Forge runner-events web trigger. Callers await it, so order is kept. */
export function httpEmitter(sessionId: string, eventsUrl: string, token: string): Emit {
  return async (...args) => {
    const event = build(sessionId, ...args);
    try {
      const res = await fetch(eventsUrl, {
        method: "POST",
        headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) console.warn(`events endpoint rejected ${event.type}: ${res.status}`);
      return res.ok;
    } catch {
      console.warn(`events endpoint unreachable, dropped ${event.type}`);
      return false;
    }
  };
}

/** Collects events in memory (tests). */
export function memoryEmitter(sessionId: string, into: Event[]): Emit {
  return async (...args) => {
    into.push(build(sessionId, ...args));
    return true;
  };
}
