import {
  BUDGETS,
  type Context,
  type Diff,
  type Env,
  type Knobs,
  type Route,
  type Run,
  type Scenario,
  type SessionStatus,
  type StatusResponse,
} from "@pr-agent/contracts";
import { emitter, type Emit } from "../events.js";
import type { AgentBrowser } from "../executor/browser.js";
import { Executor } from "../executor/executor.js";
import type { Planner } from "../planner/planner.js";
import { decideRoute } from "../planner/planner.js";
import type { SandboxManager } from "../sandbox/manager.js";
import type { Sink } from "../sink.js";
import { Verifier } from "../verifier/verifier.js";

/** Activity text for who wrote the scenarios: "written by Factory Droid", or the fallback that was used instead. */
export const plannedBy = (source: string) =>
  source.startsWith("droid") ? `written by Factory Droid${source.includes("retry") ? " (after one retry)" : ""}` : `from the ${source} fallback (Factory Droid unavailable)`;

export interface SessionState {
  context: Context;
  status: SessionStatus;
  route?: Route;
  scenarios: Scenario[];
  runs: Run[];
  diffs: Diff[];
  /** Planned but not run (budget). */
  skipped: string[];
  knobs: Knobs;
  startedAt: number;
  error?: string;
  /** Pipeline and asks run one after another on the same sandboxes. */
  chain: Promise<unknown>;
  /** > 0 while the pipeline or an ask is driving the sandboxes (the reviewer can't take over then). */
  busy: number;
  emit: Emit;
}

export interface OrchestratorDeps {
  sandboxes: SandboxManager;
  planner: Planner;
  sink: Sink;
  artifactsDir: string;
  browser?: AgentBrowser;
}

export class NotFound extends Error {}
export class Conflict extends Error {}

const ENVS: Env[] = ["base", "head"];
const DEFAULT_KNOBS: Knobs = { provider: "ok", latencyMs: 0 };

/**
 * The runner's pipeline: sandboxes -> plan -> run on both -> verify -> follow-ups -> session.complete.
 * Every public method returns quickly; work is reported as events.
 */
export class Orchestrator {
  private sessions = new Map<string, SessionState>();
  private executor: Executor;

  constructor(private d: OrchestratorDeps) {
    this.executor = new Executor({ sandboxes: d.sandboxes, browser: d.browser, artifactsDir: d.artifactsDir });
  }

  get(id: string): SessionState {
    const s = this.sessions.get(id);
    if (!s) throw new NotFound(`unknown session ${id}`);
    return s;
  }

  has(id: string) {
    return this.sessions.has(id);
  }

  list(): string[] {
    return [...this.sessions.keys()];
  }

  /** Starts the whole pipeline in the background. A second start for the same id replaces the session. */
  start(context: Context): SessionState {
    const id = context.session.id;
    const prev = this.sessions.get(id);
    const state: SessionState = {
      context,
      status: "PREPARING",
      scenarios: [],
      runs: [],
      diffs: [],
      skipped: [],
      knobs: DEFAULT_KNOBS,
      startedAt: Date.now(),
      chain: Promise.resolve(),
      busy: 0,
      emit: emitter(this.d.sink, id),
    };
    this.sessions.set(id, state);
    state.chain = (prev ? prev.chain.catch(() => undefined) : Promise.resolve())
      .then(() => this.driving(state, () => this.pipeline(state)))
      .catch((err) => this.fail(state, err));
    return state;
  }

  /** Waits for everything queued on a session so far (CLI and tests). */
  async idle(id: string) {
    let chain: Promise<unknown> | undefined;
    while (chain !== this.sessions.get(id)?.chain) {
      chain = this.sessions.get(id)?.chain;
      await chain?.catch(() => undefined);
    }
  }

  private async driving<T>(s: SessionState, fn: () => Promise<T>): Promise<T> {
    s.busy++;
    try {
      return await fn();
    } finally {
      s.busy--;
    }
  }

  private async fail(s: SessionState, err: unknown) {
    s.status = "FAILED";
    s.error = err instanceof Error ? err.message : String(err);
    await s.emit("agent", "session.failed", "fail", s.error);
  }

  private async ensureSandboxes(s: SessionState): Promise<void> {
    const { session } = s.context;
    const id = session.id;
    const st = this.d.sandboxes.status(id);
    if (st.base === "healthy" && st.head === "healthy") return;
    const specs = {
      base: { repo: session.repo, sha: session.baseSha },
      head: { repo: session.repo, sha: session.headSha, prNumber: session.prNumber },
    };
    for (const env of ENVS) await s.emit("sandbox", "sandbox.building", "start", `Building ${env} at ${specs[env].sha.slice(0, 7)}`, { env, sha: specs[env].sha });
    await Promise.all(
      ENVS.map(async (env) => {
        const t0 = Date.now();
        try {
          await this.d.sandboxes.up(id, env, specs[env]);
          await s.emit("sandbox", "sandbox.healthy", "ok", `${env} healthy in ${Math.round((Date.now() - t0) / 1000)} s`, { env, sha: specs[env].sha });
        } catch (err) {
          const sb = this.d.sandboxes.get(id, env);
          await s.emit("sandbox", "sandbox.failed", "fail", `${env} failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`, {
            env,
            sha: specs[env].sha,
            log: sb?.log.slice(-40),
          });
        }
      }),
    );
    const after = this.d.sandboxes.status(id);
    if (after.base !== "healthy" || after.head !== "healthy") throw new Error(`sandboxes not healthy (base ${after.base}, head ${after.head})`);
    await this.d.sandboxes.resetBoth(id);
    // Open the agent's browser on the app's first page so the live view has something to show right away.
    const first = s.context.manifest.pages.find((p) => !p.includes(":"));
    if (this.d.browser && first) {
      for (const env of ENVS) {
        const url = this.d.sandboxes.get(id, env)?.url;
        if (url) void this.d.browser.page(id, env, url).then((p) => p.goto(first, { timeout: 10_000 })).catch(() => undefined);
      }
    }
    if (s.knobs.provider !== "ok" || s.knobs.latencyMs) await this.d.sandboxes.setKnobsBoth(id, s.knobs);
  }

  private async pipeline(s: SessionState) {
    const { context } = s;
    s.status = "PREPARING";
    await this.ensureSandboxes(s);

    s.route = decideRoute(context);
    await s.emit("planner", "route.decided", "info", s.route, { route: s.route });
    if (s.route === "STATIC_ONLY") {
      s.status = "READY";
      await s.emit("agent", "session.complete", "ok", "Only docs/tests changed: no behavior to test", { route: s.route, scenarios: 0 });
      return;
    }

    s.status = "PLANNING";
    const acs = context.jira?.acceptanceCriteria.length ?? 0;
    await s.emit("planner", "planner.started", "start", `Factory Droid is planning tests from ${acs} acceptance criteria, ${context.findings.length} findings, ${context.changedFiles.length} files`);
    const plan = await this.d.planner.plan(context, s.startedAt + BUDGETS.firstReportMs);
    await s.emit("planner", "planner.scenarios", plan.scenarios.length ? "ok" : "fail", `${plan.scenarios.length} scenarios ${plannedBy(plan.source)}`, plan.scenarios);
    if (!plan.scenarios.length) throw new Error(`planner produced no scenarios: ${plan.errors.slice(-2).join("; ")}`);

    s.status = "RUNNING";
    await this.runAll(s, plan.scenarios, true);

    const over = Date.now() - s.startedAt > BUDGETS.firstReportMs;
    if (!over) {
      const follow = await this.d.planner.followups(context, s.scenarios, s.diffs);
      if (follow.scenarios.length) {
        await s.emit("planner", "planner.scenarios", "ok", `${follow.scenarios.length} follow-up scenarios ${plannedBy(follow.source)}`, follow.scenarios);
        await this.runAll(s, follow.scenarios, true);
      }
    }

    s.status = "READY";
    const counts = countBy(s.diffs.map((d) => d.classification));
    await s.emit("agent", "session.complete", "ok", `First report ready: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "no results"}`, {
      route: s.route,
      scenarios: s.scenarios.length,
      classifications: counts,
      skipped: s.skipped,
    });
  }

  private async runAll(s: SessionState, scenarios: Scenario[], budgeted: boolean) {
    for (const scenario of scenarios) {
      // Past the first-report budget or the scenario cap: not run (session.complete lists them as skipped).
      const overBudget = budgeted && Date.now() - s.startedAt > BUDGETS.firstReportMs;
      if (overBudget || (s.scenarios.length >= BUDGETS.maxScenarios && scenario.origin !== "ask")) {
        s.skipped.push(scenario.id);
        continue;
      }
      s.scenarios.push(scenario);
      const verifier = new Verifier(this.executor, s.emit);
      const { runs, diff } = await verifier.verify({ sessionId: s.context.session.id, scenario, manifest: s.context.manifest, sessionKnobs: s.knobs });
      s.runs.push(...runs);
      s.diffs.push(diff);
      this.d.sandboxes.touch(s.context.session.id);
    }
  }

  /** A reviewer's plain-English test: plan 1 scenario, run it on both, label it. Queued behind the pipeline. */
  ask(id: string, askId: string, prompt: string) {
    const s = this.get(id);
    this.d.sandboxes.touch(id);
    s.chain = s.chain
      .catch(() => undefined)
      .then(() => this.driving(s, async () => {
        await this.ensureSandboxes(s);
        await s.emit("planner", "planner.started", "start", `Factory Droid is turning the ask into a test: ${prompt}`, { askId });
        const priorIds = [...s.context.priorScenarioIds, ...s.scenarios.map((x) => x.id)];
        const plan = await this.d.planner.ask({ ...s.context, priorScenarioIds: priorIds }, prompt, s.scenarios);
        await s.emit("planner", "planner.scenarios", plan.scenarios.length ? "ok" : "fail", `${plan.scenarios.length} scenario for the ask ${plannedBy(plan.source)}`, plan.scenarios);
        await this.runAll(s, plan.scenarios, false);
        const diffs = s.diffs.filter((d) => plan.scenarios.some((x) => x.id === d.scenarioId));
        await s.emit("planner", "ask.complete", plan.scenarios.length ? "ok" : "fail", plan.scenarios.length ? `Ask done: ${diffs.map((d) => `${d.scenarioId} ${d.classification}`).join(", ")}` : "Couldn't turn the ask into a test", {
          askId,
          scenarioIds: plan.scenarios.map((x) => x.id),
        });
      }))
      .catch(async (err) => {
        await s.emit("planner", "ask.complete", "fail", `Ask failed: ${err instanceof Error ? err.message : err}`, { askId, scenarioIds: [] });
      });
  }

  async knobs(id: string, knobs: Knobs) {
    const s = this.get(id);
    this.assertHealthy(id);
    s.knobs = knobs;
    await this.d.sandboxes.setKnobsBoth(id, knobs);
    await s.emit("sandbox", "knobs.set", "ok", `provider=${knobs.provider} latency=${knobs.latencyMs}ms on both`, knobs);
  }

  async reset(id: string) {
    const s = this.get(id);
    this.assertHealthy(id);
    s.knobs = DEFAULT_KNOBS;
    await this.d.sandboxes.resetBoth(id);
    await s.emit("sandbox", "sandbox.reset", "ok", "Both sandboxes reseeded, provider ok");
  }

  status(id: string): StatusResponse {
    return this.d.sandboxes.status(id);
  }

  async teardown(id: string, reason = "Sandboxes removed") {
    const s = this.sessions.get(id);
    await this.d.browser?.closeSession(id);
    await this.d.sandboxes.teardown(id);
    this.sessions.delete(id);
    await (s?.emit ?? emitter(this.d.sink, id))("sandbox", "sandbox.teardown", "ok", reason);
  }

  private assertHealthy(id: string) {
    const st = this.d.sandboxes.status(id);
    if (st.base !== "healthy" || st.head !== "healthy") throw new Conflict(`sandboxes are not ready (base ${st.base}, head ${st.head})`);
  }
}

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
