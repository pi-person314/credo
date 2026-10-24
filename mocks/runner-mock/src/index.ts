import Fastify from "fastify";
import { AskRunnerRequest, KnobsRequest, StartRequest, TOKEN_HEADER, type Env, type SandboxState } from "@pr-agent/contracts";
import { config } from "./env.js";
import { httpEmitter } from "./emitter.js";
import { runAsk, runSession, waiter, type Shas } from "./pipeline.js";

// Fake runner for Person A. Same API as runner/, canned behavior (see pipeline.ts).
// EVENTS_URL = the Forge runner-events web trigger URL (`forge webtrigger` prints it; works with `forge tunnel`).
// `pnpm replay --session <id> --issue <KEY>` posts the same events without Forge calling us (replay.ts).

type Sb = { base: SandboxState; head: SandboxState; shas: Shas; issueKey: string };
const sessions = new Map<string, Sb>();
const wait = waiter(config.speed);
const emitFor = (id: string) => httpEmitter(id, config.eventsUrl, config.token);
const background = (label: string, work: Promise<unknown>) => void work.catch((e) => console.error(`${label} failed`, e));

const app = Fastify({ logger: true });

// Forge may send an empty JSON body on /reset; treat it as {} instead of a 400.
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  try {
    done(null, body ? JSON.parse(body as string) : {});
  } catch (e) {
    done(e as Error, undefined);
  }
});

app.addHook("onRequest", async (req, reply) => {
  if (/^\/(health|view|preview)/.test(req.url)) return;
  if (req.headers[TOKEN_HEADER] !== config.token) return reply.code(401).send();
});

app.get("/health", async () => ({ ok: true, service: "runner-mock" }));

app.post("/sessions", async (req, reply) => {
  const parsed = StartRequest.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
  const { session, jira } = parsed.data.context;
  const sb: Sb = { base: "building", head: "building", shas: { base: session.baseSha, head: session.headSha }, issueKey: session.issueKey };
  sessions.set(session.id, sb);
  background(
    `session ${session.id}`,
    runSession(
      async (...args) => {
        if (args[1] === "sandbox.healthy") sb.base = sb.head = "healthy";
        return emitFor(session.id)(...args);
      },
      wait,
      session.id,
      sb.shas,
      jira?.acceptanceCriteria.length ?? 0,
    ),
  );
  return reply.code(202).send({ ok: true });
});

app.post<{ Params: { id: string } }>("/sessions/:id/ask", async (req, reply) => {
  const parsed = AskRunnerRequest.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
  const id = req.params.id;
  const sb = sessions.get(id);
  const { askId, prompt } = parsed.data;
  background(`ask ${askId}`, runAsk(emitFor(id), wait, id, sb?.shas ?? { base: "base", head: "head" }, askId, prompt, sb?.issueKey ?? "PAY-12"));
  return reply.code(202).send({ ok: true });
});

app.post<{ Params: { id: string } }>("/sessions/:id/knobs", async (req, reply) => {
  const parsed = KnobsRequest.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
  const knobs = parsed.data;
  await emitFor(req.params.id)("sandbox", "knobs.set", "ok", `provider=${knobs.provider} latency=${knobs.latencyMs}ms`, knobs);
  return { ok: true };
});

app.post<{ Params: { id: string } }>("/sessions/:id/reset", async (req) => {
  await emitFor(req.params.id)("sandbox", "sandbox.reset", "ok", "Both sandboxes reseeded", { envs: ["base", "head"] });
  return { ok: true };
});

app.get<{ Params: { id: string } }>("/sessions/:id/status", async (req) => {
  const sb = sessions.get(req.params.id);
  return { base: sb?.base ?? "down", head: sb?.head ?? "down" };
});

app.delete<{ Params: { id: string } }>("/sessions/:id", async (req) => {
  sessions.delete(req.params.id);
  await emitFor(req.params.id)("sandbox", "sandbox.teardown", "ok", "Sandboxes removed");
  return { ok: true };
});

// Stand-in for the live view page the Jira panel embeds.
app.get<{ Params: { id: string } }>("/view/:id", async (req, reply) => {
  const pane = (env: Env, charges: number) =>
    `<section style="flex:1;border:1px solid #ccc;border-radius:6px;padding:12px"><b>${env}</b>` +
    `<p data-test="order-status">paid</p><p>Charges: <b>${charges}</b></p><button data-test="pay">Pay $24.00</button></section>`;
  const id = req.params.id.replace(/[^\w-]/g, "");
  return reply.type("text/html").send(
    `<!doctype html><body style="font-family:sans-serif;margin:0;padding:12px"><p>Live sandbox (mock) · ${id}</p>` +
      `<div style="display:flex;gap:12px">${pane("base", 1)}${pane("head", 2)}</div></body>`,
  );
});

app.listen({ host: "0.0.0.0", port: config.port });
