import { TOKEN_HEADER, type Event } from "@pr-agent/contracts";

/** Where runner events go. HttpSink posts to the Forge runner-events web trigger; ConsoleSink prints them for `pnpm dev:cli`. */
export interface Sink {
  emit(event: Event): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Posts events in order, one request at a time, retrying 3 times with backoff. Callers don't wait for
 * delivery (a slow Forge web trigger must not slow the pipeline); `flush()` waits for the queue.
 */
export class HttpSink implements Sink {
  private queue: Promise<void> = Promise.resolve();

  constructor(private eventsUrl: string, private token: string) {}

  async emit(event: Event) {
    this.queue = this.queue.then(() => this.post(event));
  }

  private async post(event: Event) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(this.eventsUrl, {
          method: "POST",
          headers: { "content-type": "application/json", [TOKEN_HEADER]: this.token },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
          if (!res.ok) console.warn(`events endpoint rejected ${event.type}: ${res.status}`);
          return;
        }
      } catch {}
      if (attempt < 4) await sleep(500 * 2 ** (attempt - 1));
    }
    console.warn(`events endpoint unreachable, dropped ${event.type}`);
  }

  flush() {
    return this.queue;
  }
}

export class ConsoleSink implements Sink {
  async emit(event: Event) {
    console.log(`${event.ts}  ${event.type.padEnd(18)} ${event.status.padEnd(5)} ${event.message}`);
  }
}

/** Last N events per session, for the live view's activity feed. */
export class MemorySink implements Sink {
  private bySession = new Map<string, Event[]>();
  private listeners = new Set<(e: Event) => void>();

  constructor(private max = 500) {}

  async emit(event: Event) {
    const list = this.bySession.get(event.sessionId) ?? [];
    list.push(event);
    if (list.length > this.max) list.shift();
    this.bySession.set(event.sessionId, list);
    for (const l of this.listeners) l(event);
  }

  events(sessionId: string, after?: string): Event[] {
    const list = this.bySession.get(sessionId) ?? [];
    return after ? list.filter((e) => e.ts > after) : [...list];
  }

  subscribe(fn: (e: Event) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  forget(sessionId: string) {
    this.bySession.delete(sessionId);
  }
}

export class MultiSink implements Sink {
  constructor(private sinks: Sink[]) {}
  async emit(event: Event) {
    await Promise.all(this.sinks.map((s) => s.emit(event).catch(() => undefined)));
  }
}
