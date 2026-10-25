import { EventEmitter } from "node:events";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import type { Env, LiveFrame } from "@pr-agent/contracts";

export interface AgentFrame extends LiveFrame {
  sessionId: string;
  env: Env;
}

interface Tab {
  context: BrowserContext;
  page: Page;
  cdp?: CDPSession;
  baseUrl: string;
  step?: { scenarioId?: string; step?: string };
  last?: AgentFrame;
}

export const VIEWPORT = { width: 1000, height: 720 };

/** Frames kept per (session, side, scenario) for the live view's Replay. Pages are mostly static, so this covers a scenario. */
const REPLAY_FRAMES = 40;

/**
 * The agent's own browser: one Chromium, one tab per (session, env), streamed as JPEG frames
 * (CDP screencast) for the live view. Emits "frame" with an AgentFrame.
 */
export class AgentBrowser extends EventEmitter {
  private browser?: Promise<Browser>;
  private tabs = new Map<string, Promise<Tab>>();
  /** Frames per `${sessionId}/${env}/${scenarioId}`, for Replay after the scenario has finished. */
  private recordings = new Map<string, AgentFrame[]>();

  private key = (sessionId: string, env: Env) => `${sessionId}/${env}`;

  private launch() {
    this.browser ??= chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }).then((b) => {
      b.on("disconnected", () => {
        this.browser = undefined;
        this.tabs.clear();
      });
      return b;
    });
    return this.browser;
  }

  /** The tab for one sandbox, created on first use. `baseUrl` is the sandbox app as the runner reaches it. */
  async tab(sessionId: string, env: Env, baseUrl: string): Promise<Tab> {
    const k = this.key(sessionId, env);
    let tab = this.tabs.get(k);
    if (tab) {
      const t = await tab;
      if (t.baseUrl === baseUrl && !t.page.isClosed()) return t;
      await t.context.close().catch(() => undefined);
    }
    tab = (async () => {
      const browser = await this.launch();
      const context = await browser.newContext({ viewport: VIEWPORT, baseURL: baseUrl });
      const page = await context.newPage();
      const t: Tab = { context, page, baseUrl };
      await this.screencast(sessionId, env, t).catch(() => undefined);
      return t;
    })();
    this.tabs.set(k, tab);
    return tab;
  }

  async page(sessionId: string, env: Env, baseUrl: string): Promise<Page> {
    return (await this.tab(sessionId, env, baseUrl)).page;
  }

  private async screencast(sessionId: string, env: Env, t: Tab) {
    const cdp = await t.context.newCDPSession(t.page);
    t.cdp = cdp;
    cdp.on("Page.screencastFrame", ({ data, sessionId: frameId }: { data: string; sessionId: number }) => {
      const frame: AgentFrame = { sessionId, env, ts: new Date().toISOString(), jpeg: data, ...t.step };
      t.last = frame;
      if (t.step?.scenarioId && t.step.step !== "done") {
        const k = `${sessionId}/${env}/${t.step.scenarioId}`;
        const list = this.recordings.get(k) ?? [];
        list.push(frame);
        if (list.length > REPLAY_FRAMES) list.splice(0, list.length - REPLAY_FRAMES);
        this.recordings.set(k, list);
      }
      this.emit("frame", frame);
      cdp.send("Page.screencastFrameAck", { sessionId: frameId }).catch(() => undefined);
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
  }

  /** Labels the frames that follow with the scenario and step the agent is on. */
  async setStep(sessionId: string, env: Env, step: { scenarioId?: string; step?: string }) {
    const t = await this.tabs.get(this.key(sessionId, env));
    if (t) t.step = step;
  }

  async lastFrame(sessionId: string, env: Env): Promise<AgentFrame | undefined> {
    const t = await this.tabs.get(this.key(sessionId, env))?.catch(() => undefined);
    return t?.last;
  }

  /** What the agent's browser showed during one scenario on one side (oldest first), for Replay. */
  recording(sessionId: string, env: Env, scenarioId: string): AgentFrame[] {
    return this.recordings.get(`${sessionId}/${env}/${scenarioId}`) ?? [];
  }

  has(sessionId: string, env: Env) {
    return this.tabs.has(this.key(sessionId, env));
  }

  async closeSession(sessionId: string) {
    for (const k of [...this.recordings.keys()]) if (k.startsWith(`${sessionId}/`)) this.recordings.delete(k);
    for (const env of ["base", "head"] as const) {
      const k = this.key(sessionId, env);
      const t = this.tabs.get(k);
      this.tabs.delete(k);
      await t?.then((x) => x.context.close()).catch(() => undefined);
    }
  }

  async close() {
    const b = this.browser;
    this.browser = undefined;
    this.tabs.clear();
    await (await b?.catch(() => undefined))?.close();
  }
}
