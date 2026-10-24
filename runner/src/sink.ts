import { TOKEN_HEADER, type Event } from "@pr-agent/contracts";

/** Where runner events go. HttpSink posts to the Forge runner-events web trigger; ConsoleSink prints them for `pnpm dev:cli`. */
export interface Sink {
  emit(event: Event): Promise<void>;
}

export class HttpSink implements Sink {
  constructor(private eventsUrl: string, private token: string) {}
  async emit(event: Event) {
    await fetch(this.eventsUrl, {
      method: "POST",
      headers: { "content-type": "application/json", [TOKEN_HEADER]: this.token },
      body: JSON.stringify(event),
    });
  }
}

export class ConsoleSink implements Sink {
  async emit(event: Event) {
    console.log(`${event.ts}  ${event.type.padEnd(18)} ${event.status.padEnd(5)} ${event.message}`);
  }
}
