import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Diff, Run, Scenario, classify, type AssertionResult, type Env } from "@pr-agent/contracts";
import type { Emit } from "./emitter.js";

// The canned event sequence, shared by the HTTP server and the replay CLI.
// sc_concurrent_retry (and any ask) fails on head with 2 charges, everything else passes.

const fixtures = fileURLToPath(new URL("../../fixtures/", import.meta.url));
export const canned = (JSON.parse(readFileSync(fixtures + "scenarios.json", "utf8")) as unknown[]).map((s) => Scenario.parse(s));

export type Shas = Record<Env, string>;
export type Wait = (ms: number) => Promise<void>;

export const waiter = (speed: number): Wait => (ms) => new Promise((r) => setTimeout(r, ms * speed));
const isBroken = (sc: Scenario) => sc.id === "sc_concurrent_retry" || sc.origin === "ask";

function makeRun(sessionId: string, sc: Scenario, env: Env, sha: string, attempt: number, fail: boolean): Run {
  return Run.parse({
    id: `run_${sc.id}_${env}_${attempt}`,
    sessionId,
    scenarioId: sc.id,
    env,
    sha,
    attempt,
    status: fail ? "FAIL" : "PASS",
    durationMs: 600,
    assertions: sc.assertions.map((a) => ({
      id: a.id,
      result: fail ? "FAIL" : "PASS",
      expected: "equals" in a ? a.equals : undefined,
      actual: fail ? 2 : "equals" in a ? a.equals : undefined,
    })),
    artifacts: [{ kind: "db", path: `${sessionId}/${sc.id}/${env}-${attempt}/charges.json` }],
  });
}

/** run.started / run.finished per env (head rerun until 3 attempts when broken), then verify.diff. */
export async function runScenarios(emit: Emit, wait: Wait, sessionId: string, shas: Shas, scenarios: Scenario[]) {
  for (const sc of scenarios) {
    const broken = isBroken(sc);
    const results: Record<Env, AssertionResult[]> = { base: [], head: [] };
    const runIds: string[] = [];
    const attempts: Array<[Env, number]> = broken ? [["base", 1], ["head", 1], ["head", 2], ["head", 3]] : [["base", 1], ["head", 1]];
    for (const [env, attempt] of attempts) {
      if (attempt > 1) await emit("verifier", "verify.rerun", "info", `Rerun ${attempt} of ${sc.id} on ${env}`);
      await emit("executor", "run.started", "start", `${sc.id} on ${env}`, { scenarioId: sc.id, env, attempt });
      await wait(600);
      const run = makeRun(sessionId, sc, env, shas[env], attempt, broken && env === "head");
      results[env].push(run.status);
      runIds.push(run.id);
      await emit("executor", "run.finished", run.status === "FAIL" ? "fail" : "ok", `${sc.id} on ${env}: ${run.status}`, run);
    }
    const classification = classify(results.base[0]!, results.head);
    const diff = Diff.parse({ sessionId, scenarioId: sc.id, base: results.base[0], head: results.head[0], classification, runIds });
    await emit("verifier", "verify.diff", classification === "NEW_REGRESSION" ? "fail" : "ok", `${sc.id}: ${classification}`, diff);
  }
}

/** The whole POST /sessions pipeline: sandboxes -> plan -> run -> verify -> session.complete. */
export async function runSession(emit: Emit, wait: Wait, sessionId: string, shas: Shas, acCount: number) {
  for (const env of ["base", "head"] as const) await emit("sandbox", "sandbox.building", "start", `Building ${env} @ ${shas[env].slice(0, 7)}`, { env });
  await wait(1500);
  for (const env of ["base", "head"] as const) await emit("sandbox", "sandbox.healthy", "ok", `${env} healthy`, { env });
  await emit("planner", "planner.started", "start", `Planning from ${acCount} acceptance criteria`);
  await wait(800);
  await emit("planner", "planner.scenarios", "ok", `${canned.length} scenarios`, canned);
  await emit("planner", "route.decided", "info", "TARGETED_TEST", { route: "TARGETED_TEST" });
  await runScenarios(emit, wait, sessionId, shas, canned);
  await emit("planner", "session.complete", "ok", "First report ready", { route: "TARGETED_TEST" });
}

/** The scenario an ask turns into: a retry after a provider timeout, which double-charges on head. */
export function askScenario(askId: string, prompt: string, issueKey: string): Scenario {
  return Scenario.parse({
    id: `sc_ask_${askId.replace(/[^a-z0-9_]/gi, "").toLowerCase()}`,
    objective: prompt,
    origin: "ask",
    priority: "P0",
    fixture: "cart_one_item",
    knobs: { provider: "timeout", latencyMs: 0 },
    steps: [
      { op: "http", method: "POST", path: "/api/orders", saveAs: "order" },
      { op: "http", method: "POST", path: "/api/pay", body: { orderId: "$order.id" } },
      { op: "wait", ms: 2000 },
      { op: "http", method: "POST", path: "/api/pay", body: { orderId: "$order.id" } },
    ],
    assertions: [{ id: "a1", type: "db_count", table: "charges", where: { orderId: "$order.id" }, equals: 1 }],
    rationale: "Reviewer asked",
    sourceRefs: [`jira:${issueKey}#ac3`],
  });
}

/** POST /sessions/:id/ask: plan one scenario, run it, ask.complete. */
export async function runAsk(emit: Emit, wait: Wait, sessionId: string, shas: Shas, askId: string, prompt: string, issueKey: string) {
  const scenario = askScenario(askId, prompt, issueKey);
  await emit("planner", "planner.started", "start", `Planning ask: ${prompt}`);
  await wait(800);
  await emit("planner", "planner.scenarios", "ok", "1 scenario", [scenario]);
  await runScenarios(emit, wait, sessionId, shas, [scenario]);
  await emit("planner", "ask.complete", "ok", "Ask done", { askId, scenarioIds: [scenario.id] });
}
