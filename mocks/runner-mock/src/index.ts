import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import {
  AskRunnerRequest,
  KnobsRequest,
  Scenario,
  StartRequest,
  TOKEN_HEADER,
  classify,
  type Actor,
  type AssertionResult,
  type Env,
  type Event,
  type EventType,
  type Run,
  type SandboxState,
} from "@pr-agent/contracts";

// Fake runner for Person A. Same API as runner/, canned behavior:
// sc_concurrent_retry (and any ask) fails on head with 2 charges, everything else passes.
// EVENTS_URL = the Forge runner-events web trigger URL (`forge webtrigger` prints it; works with `forge tunnel`).

const EVENTS_URL = process.env.EVENTS_URL ?? "http://localhost:4000/events";
const TOKEN = process.env.RUNNER_TOKEN ?? "change-me";
const fixtures = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const canned = (JSON.parse(readFileSync(fixtures + "scenarios.json", "utf8")) as unknown[]).map((s) => Scenario.parse(s));

type Sb = { base: SandboxState; head: SandboxState; shas: Record<Env, string>; issueKey: string };
const sessions = new Map<string, Sb>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function emit(sessionId: string, actor: Actor, type: EventType, status: Event["status"], message: string, data?: unknown) {
  const event: Event = { sessionId, ts: new Date().toISOString(), actor, type, status, message, data };
  await fetch(EVENTS_URL, {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN },
    body: JSON.stringify(event),
  }).catch(() => console.warn(`events endpoint unreachable, dropped ${type}`));
}

async function runScenarios(id: string, scenarios: Scenario[]) {
  const shas = sessions.get(id)?.shas ?? { base: "base", head: "head" };
  for (const sc of scenarios) {
    const broken = sc.id === "sc_concurrent_retry" || sc.origin === "ask";
    const results: Record<Env, AssertionResult[]> = { base: [], head: [] };
    const runIds: string[] = [];
    const attempts: Array<[Env, number]> = broken ? [["base", 1], ["head", 1], ["head", 2], ["head", 3]] : [["base", 1], ["head", 1]];
    for (const [env, attempt] of attempts) {
      if (attempt > 1) await emit(id, "verifier", "verify.rerun", "info", `Rerun ${attempt} of ${sc.id} on ${env}`);
      await emit(id, "executor", "run.started", "start", `${sc.id} on ${env}`);
      await sleep(600);
      const fail = broken && env === "head";
      const run: Run = {
        id: `run_${sc.id}_${env}_${attempt}`,
        sessionId: id,
        scenarioId: sc.id,
        env,
        sha: shas[env],
        attempt,
        status: fail ? "FAIL" : "PASS",
        durationMs: 600,
        assertions: sc.assertions.map((a) => ({
          id: a.id,
          result: fail ? "FAIL" : "PASS",
          expected: "equals" in a ? a.equals : undefined,
          actual: fail ? 2 : "equals" in a ? a.equals : undefined,
        })),
        artifacts: [{ kind: "db", path: `${id}/${sc.id}/${env}-${attempt}/charges.json` }],
      };
      results[env].push(run.status);
      runIds.push(run.id);
      await emit(id, "executor", "run.finished", fail ? "fail" : "ok", `${sc.id} on ${env}: ${run.status}`, run);
    }
    const classification = classify(results.base[0]!, results.head);
    await emit(id, "verifier", "verify.diff", classification === "NEW_REGRESSION" ? "fail" : "ok", `${sc.id}: ${classification}`, {
      sessionId: id, scenarioId: sc.id, base: results.base[0], head: results.head[0], classification, runIds,
    });
  }
}

const app = Fastify({ logger: true });

app.addHook("onRequest", async (req, reply) => {
  if (/^\/(health|view|preview)/.test(req.url)) return;
  if (req.headers[TOKEN_HEADER] !== TOKEN) return reply.code(401).send();
});

app.get("/health", async () => ({ ok: true, service: "runner-mock" }));

app.post("/sessions", async (req, reply) => {
  const { context } = StartRequest.parse(req.body);
  const id = context.session.id;
  sessions.set(id, { base: "building", head: "building", shas: { base: context.session.baseSha, head: context.session.headSha }, issueKey: context.session.issueKey });
  void (async () => {
    for (const env of ["base", "head"] as const) await emit(id, "sandbox", "sandbox.building", "start", `Building ${env}`, { env });
    await sleep(1500);
    const sb = sessions.get(id)!;
    sb.base = sb.head = "healthy";
    for (const env of ["base", "head"] as const) await emit(id, "sandbox", "sandbox.healthy", "ok", `${env} healthy`, { env });
    await emit(id, "planner", "planner.started", "start", `Planning from ${context.jira?.acceptanceCriteria.length ?? 0} acceptance criteria`);
    await sleep(800);
    await emit(id, "planner", "planner.scenarios", "ok", `${canned.length} scenarios`, canned);
    await emit(id, "planner", "route.decided", "info", "TARGETED_TEST");
    await runScenarios(id, canned);
    await emit(id, "planner", "session.complete", "ok", "First report ready", { route: "TARGETED_TEST" });
  })();
  return reply.code(202).send();
});

app.post<{ Params: { id: string } }>("/sessions/:id/ask", async (req, reply) => {
  const { askId, prompt } = AskRunnerRequest.parse(req.body);
  const id = req.params.id;
  const issueKey = sessions.get(id)?.issueKey ?? "PAY-12";
  const scenario: Scenario = {
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
  };
  void (async () => {
    await emit(id, "planner", "planner.started", "start", `Planning ask: ${prompt}`);
    await sleep(800);
    await emit(id, "planner", "planner.scenarios", "ok", "1 scenario", [scenario]);
    await runScenarios(id, [scenario]);
    await emit(id, "planner", "ask.complete", "ok", "Ask done", { askId, scenarioIds: [scenario.id] });
  })();
  return reply.code(202).send();
});

app.post<{ Params: { id: string } }>("/sessions/:id/knobs", async (req) => {
  const knobs = KnobsRequest.parse(req.body);
  await emit(req.params.id, "sandbox", "knobs.set", "ok", `provider=${knobs.provider} latency=${knobs.latencyMs}ms`, knobs);
  return { ok: true };
});

app.post<{ Params: { id: string } }>("/sessions/:id/reset", async (req) => {
  await emit(req.params.id, "sandbox", "sandbox.reset", "ok", "Both sandboxes reseeded");
  return { ok: true };
});

app.get<{ Params: { id: string } }>("/sessions/:id/status", async (req) => {
  const sb = sessions.get(req.params.id);
  return { base: sb?.base ?? "down", head: sb?.head ?? "down" };
});

app.delete<{ Params: { id: string } }>("/sessions/:id", async (req) => {
  sessions.delete(req.params.id);
  await emit(req.params.id, "sandbox", "sandbox.teardown", "ok", "Sandboxes removed");
  return { ok: true };
});

// Stand-in for the live view page the Jira panel embeds.
app.get<{ Params: { id: string } }>("/view/:id", async (req, reply) => {
  const pane = (env: Env, charges: number) =>
    `<section style="flex:1;border:1px solid #ccc;border-radius:6px;padding:12px"><b>${env}</b>` +
    `<p data-test="order-status">paid</p><p>Charges: <b>${charges}</b></p><button data-test="pay">Pay $24.00</button></section>`;
  return reply.type("text/html").send(
    `<!doctype html><body style="font-family:sans-serif;margin:0;padding:12px"><p>Live sandbox (mock) · ${req.params.id}</p>` +
      `<div style="display:flex;gap:12px">${pane("base", 1)}${pane("head", 2)}</div></body>`,
  );
});

app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 4100) });
