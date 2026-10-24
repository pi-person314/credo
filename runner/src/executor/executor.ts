import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Page } from "playwright-core";
import type {
  AppManifest,
  ArtifactRef,
  Assertion,
  AssertionOutcome,
  AssertionResult,
  Env,
  HttpStep,
  Knobs,
  Run,
  Scenario,
  Step,
} from "@pr-agent/contracts";
import type { AgentBrowser } from "./browser.js";
import { deepEqual, getPath, resolveRefs, type Saved, type Vars } from "./values.js";

/** What the executor needs from the sandbox manager (an interface so tests can fake it). */
export interface SandboxApi {
  healthy(sessionId: string, env: Env): { url: string; sha: string };
  seed(sessionId: string, env: Env, fixture: string): Promise<void>;
  setKnobs(sessionId: string, env: Env, knobs: Knobs): Promise<void>;
  db(sessionId: string, env: Env, table: string, where?: Record<string, unknown>): Promise<{ count: number; rows: Record<string, unknown>[] }>;
}

export interface RunInput {
  sessionId: string;
  env: Env;
  attempt: number;
  scenario: Scenario;
  manifest: AppManifest;
  /** The reviewer's knobs, restored after the run so "Try it yourself" keeps them. */
  sessionKnobs?: Knobs;
  onStep?: (step: string) => void;
  onAssertion?: (outcome: AssertionOutcome) => void;
}

export interface ExecutorOptions {
  sandboxes: SandboxApi;
  browser?: AgentBrowser;
  artifactsDir: string;
  scenarioTimeoutMs?: number;
  stepTimeoutMs?: number;
}

const DEFAULT_KNOBS: Knobs = { provider: "ok", latencyMs: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class StepError extends Error {}

/** Runs one scenario on one sandbox, the same way every time, and collects evidence. */
export class Executor {
  constructor(private o: ExecutorOptions) {}

  async run(input: RunInput): Promise<Run> {
    const { sessionId, env, attempt, scenario } = input;
    const sb = this.o.sandboxes.healthy(sessionId, env);
    const started = Date.now();
    const dir = join(this.o.artifactsDir, sessionId, scenario.id, `${env}-${attempt}`);
    mkdirSync(dir, { recursive: true });
    const artifacts: ArtifactRef[] = [];
    const save = (kind: ArtifactRef["kind"], name: string, data: string | Buffer) => {
      writeFileSync(join(dir, name), data);
      artifacts.push({ kind, path: relative(this.o.artifactsDir, join(dir, name)) });
    };

    const vars: Vars = new Map();
    const http: unknown[] = [];
    const usesUi = scenario.steps.some((s) => s.op === "ui") || scenario.assertions.some((a) => a.type === "ui_text");
    let page: Page | undefined;
    let outcomes: AssertionOutcome[] = [];
    let error: string | undefined;

    const timeoutMs = this.o.scenarioTimeoutMs ?? 60_000;
    const work = async () => {
      input.onStep?.(`seed ${scenario.fixture}`);
      await this.o.sandboxes.seed(sessionId, env, scenario.fixture);
      await this.o.sandboxes.setKnobs(sessionId, env, scenario.knobs ?? DEFAULT_KNOBS);
      if (this.o.browser && usesUi) {
        page = await this.o.browser.page(sessionId, env, sb.url);
        await page.context().tracing.start({ screenshots: true, snapshots: true }).catch(() => undefined);
      }
      for (const [i, step] of scenario.steps.entries()) {
        const label = `${i + 1}/${scenario.steps.length} ${describeStep(step)}`;
        input.onStep?.(label);
        await this.o.browser?.setStep(sessionId, env, { scenarioId: scenario.id, step: label });
        await this.step(step, { url: sb.url, vars, http, page, manifest: input.manifest });
      }
      for (const a of scenario.assertions) {
        const out = await this.assert(a, { sessionId, env, vars, page, manifest: input.manifest });
        outcomes.push(out);
        input.onAssertion?.(out);
      }
    };

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        work(),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new StepError(`scenario timed out after ${timeoutMs} ms`)), timeoutMs))),
      ]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      const done = new Set(outcomes.map((o) => o.id));
      outcomes = [
        ...outcomes,
        ...scenario.assertions.filter((a) => !done.has(a.id)).map((a) => ({ id: a.id, result: "NOT_RUN" as const, note: error })),
      ];
    } finally {
      clearTimeout(timer);
    }

    // Evidence: HTTP log, the rows of every table the scenario checks, and the agent's screen.
    save("log", "http.json", JSON.stringify({ error, requests: http }, null, 2));
    const tables = [...new Set(["orders", ...scenario.assertions.flatMap((a) => (a.type === "db_count" ? [a.table] : []))])].filter((t) =>
      input.manifest.tables.includes(t),
    );
    const db: Record<string, unknown> = {};
    for (const t of tables) db[t] = await this.o.sandboxes.db(sessionId, env, t).then((r) => r.rows).catch((e: Error) => ({ error: e.message }));
    save("db", "db.json", JSON.stringify(db, null, 2));
    if (page) {
      await page.screenshot({ fullPage: true }).then((png) => save("screenshot", "screenshot.png", png)).catch(() => undefined);
      const tracePath = join(dir, "trace.zip");
      await page.context().tracing.stop({ path: tracePath }).then(() => artifacts.push({ kind: "trace", path: relative(this.o.artifactsDir, tracePath) })).catch(() => undefined);
    } else if (this.o.browser) {
      // HTTP-only scenario: show the order it touched in the agent's browser so the live view isn't blank.
      const orderId = findOrderId(vars);
      if (orderId !== undefined && input.manifest.pages.some((p) => p.startsWith("/orders/"))) {
        const p = await this.o.browser.page(sessionId, env, sb.url).catch(() => undefined);
        await p?.goto(`/orders/${orderId}`, { timeout: 5000 }).then(() => p.waitForTimeout(400)).catch(() => undefined);
        await p?.screenshot().then((png) => save("screenshot", "screenshot.png", png)).catch(() => undefined);
      }
    }
    await this.o.browser?.setStep(sessionId, env, { scenarioId: scenario.id, step: "done" });
    await this.o.sandboxes.setKnobs(sessionId, env, input.sessionKnobs ?? DEFAULT_KNOBS).catch(() => undefined);

    return {
      id: `run_${sessionId}_${scenario.id}_${env}_${attempt}`,
      sessionId,
      scenarioId: scenario.id,
      env,
      sha: sb.sha,
      attempt,
      status: overall(outcomes, !!error),
      durationMs: Date.now() - started,
      assertions: outcomes,
      artifacts,
    };
  }

  private async step(step: Step, c: { url: string; vars: Vars; http: unknown[]; page?: Page; manifest: AppManifest }): Promise<void> {
    switch (step.op) {
      case "http": {
        const res = await this.http(step, c);
        if (step.saveAs) c.vars.set(step.saveAs, res);
        return;
      }
      case "parallel": {
        const all = await Promise.all(Array.from({ length: step.count }, () => this.http(step.step, c)));
        if (step.step.saveAs) c.vars.set(step.step.saveAs, all);
        return;
      }
      case "ui": {
        if (!c.page) throw new StepError("ui step but the agent browser is not available");
        const timeout = this.o.stepTimeoutMs ?? 10_000;
        if (step.action === "goto") {
          await c.page.goto(resolveRefs(step.target, c.vars), { timeout, waitUntil: "load" });
          await c.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
          return;
        }
        const loc = c.page.locator(selector(step.target, c.manifest)).first();
        if (step.action === "click") await loc.click({ timeout });
        else if (step.action === "dblclick") await loc.dblclick({ timeout });
        else await loc.fill(resolveRefs(step.value ?? "", c.vars), { timeout });
        return;
      }
      case "wait":
        await sleep(step.ms);
        return;
    }
  }

  private async http(step: HttpStep, c: { url: string; vars: Vars; http: unknown[] }): Promise<Saved> {
    const path = resolveRefs(step.path, c.vars);
    const body = step.body === undefined ? undefined : resolveRefs(step.body, c.vars);
    const t0 = Date.now();
    const res = await fetch(`${c.url}${path}`, {
      method: step.method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...step.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.o.stepTimeoutMs ?? 10_000),
    }).catch((err: Error) => {
      c.http.push({ method: step.method, path, body, error: err.message, ms: Date.now() - t0 });
      throw new StepError(`${step.method} ${path} failed: ${err.message}`);
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {}
    c.http.push({ method: step.method, path, body, status: res.status, response: parsed, ms: Date.now() - t0 });
    return { status: res.status, body: parsed };
  }

  private async assert(
    a: Assertion,
    c: { sessionId: string; env: Env; vars: Vars; page?: Page; manifest: AppManifest },
  ): Promise<AssertionOutcome> {
    const out = (result: AssertionResult, expected: unknown, actual: unknown, note?: string): AssertionOutcome => ({
      id: a.id,
      result,
      expected,
      actual,
      ...(note ? { note } : {}),
    });
    try {
      switch (a.type) {
        case "db_count": {
          const where = resolveRefs(a.where, c.vars) as Record<string, unknown>;
          const { count } = await this.o.sandboxes.db(c.sessionId, c.env, a.table, where);
          return out(count === a.equals ? "PASS" : "FAIL", a.equals, count, `${a.table} rows where ${JSON.stringify(where)}`);
        }
        case "http_status": {
          const saved = c.vars.get(a.ref);
          if (!saved) return out("INCONCLUSIVE", a.equals, undefined, `no saved response "${a.ref}"`);
          const statuses = Array.isArray(saved) ? saved.map((s) => s.status) : [saved.status];
          const ok = statuses.every((s) => s === a.equals);
          return out(ok ? "PASS" : "FAIL", a.equals, statuses.length === 1 ? statuses[0] : statuses);
        }
        case "json_path": {
          const saved = c.vars.get(a.ref);
          if (!saved) return out("INCONCLUSIVE", a.equals, undefined, `no saved response "${a.ref}"`);
          const body = Array.isArray(saved) ? saved.map((s) => s.body) : saved.body;
          const actual = getPath(body, a.path);
          const expected = resolveRefs(a.equals, c.vars);
          return out(deepEqual(actual, expected) ? "PASS" : "FAIL", expected, actual);
        }
        case "ui_text": {
          if (!c.page) return out("INCONCLUSIVE", a.contains, undefined, "agent browser not available");
          const loc = c.page.locator(selector(a.selector, c.manifest)).first();
          // UI text settles after async fetches: give it a few seconds to match before failing.
          let text = "";
          const until = Date.now() + 5000;
          do {
            text = ((await loc.textContent({ timeout: 2000 }).catch(() => null)) ?? "").trim();
            if (text.toLowerCase().includes(a.contains.toLowerCase())) return out("PASS", a.contains, text);
            await sleep(250);
          } while (Date.now() < until);
          return out("FAIL", a.contains, text);
        }
      }
    } catch (err) {
      return out("INCONCLUSIVE", undefined, undefined, err instanceof Error ? err.message : String(err));
    }
  }
}

/** Manifest selector names ("payButton") map to selectors; anything else is used as is. */
export function selector(target: string, manifest: AppManifest): string {
  return manifest.selectors[target] ?? target;
}

export function overall(outcomes: AssertionOutcome[], crashed: boolean): AssertionResult {
  if (outcomes.some((o) => o.result === "FAIL")) return "FAIL";
  if (crashed || outcomes.length === 0 || outcomes.some((o) => o.result !== "PASS")) return "INCONCLUSIVE";
  return "PASS";
}

export function describeStep(step: Step): string {
  switch (step.op) {
    case "http":
      return `${step.method} ${step.path}`;
    case "parallel":
      return `${step.count}× ${step.step.method} ${step.step.path} at once`;
    case "ui":
      return `${step.action} ${step.target}`;
    case "wait":
      return `wait ${step.ms} ms`;
  }
}

function findOrderId(vars: Vars): unknown {
  for (const saved of vars.values()) {
    const s = Array.isArray(saved) ? saved[0] : saved;
    const body = s?.body as Record<string, unknown> | undefined;
    if (body && typeof body === "object") {
      if ("orderId" in body) return body.orderId;
      if ("id" in body && "status" in body) return body.id;
    }
  }
  return undefined;
}
