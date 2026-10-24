import { config, type Config } from "./config.js";
import { AgentBrowser } from "./executor/browser.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { DroidLlm, type Llm } from "./planner/droid.js";
import { Planner } from "./planner/planner.js";
import { SandboxManager } from "./sandbox/manager.js";
import { ConsoleSink, HttpSink, MemorySink, MultiSink, type Sink } from "./sink.js";

export interface Runtime {
  cfg: Config;
  sandboxes: SandboxManager;
  browser: AgentBrowser;
  planner: Planner;
  memory: MemorySink;
  http?: HttpSink;
  orchestrator: Orchestrator;
  close(): Promise<void>;
}

/** Wires the runner together. `sink` replaces the default (Forge web trigger if EVENTS_URL, else console). */
export function createRuntime(opts: { cfg?: Config; sink?: Sink; llm?: Llm; log?: (msg: string) => void } = {}): Runtime {
  const cfg = opts.cfg ?? config;
  const log = opts.log ?? ((m: string) => console.log(m));
  const sandboxes = new SandboxManager(cfg);
  const browser = new AgentBrowser();
  const llm = opts.llm ?? new DroidLlm({ apiKey: cfg.factoryApiKey, bin: process.env.DROID_BIN, model: process.env.DROID_MODEL });
  const planner = new Planner(llm, log);
  const memory = new MemorySink();
  const http = cfg.eventsUrl ? new HttpSink(cfg.eventsUrl, cfg.token) : undefined;
  const sink = new MultiSink([memory, opts.sink ?? http ?? new ConsoleSink()]);
  const orchestrator = new Orchestrator({ sandboxes, planner, sink, browser, artifactsDir: cfg.artifactsDir });
  return {
    cfg,
    sandboxes,
    browser,
    planner,
    memory,
    http,
    orchestrator,
    async close() {
      sandboxes.stopSweeper();
      await browser.close();
      await http?.flush();
    },
  };
}
