import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AskRunnerRequest, KnobsRequest, StartRequest, TOKEN_HEADER } from "@pr-agent/contracts";
import { Conflict, NotFound } from "./orchestrator/orchestrator.js";
import type { Runtime } from "./runtime.js";

// Browser-facing routes (embedded in Jira) carry a signed ?t= token instead of the header.
const browserRoute = (url: string) => /^\/(health|view|preview|live|artifacts)(\/|$|\?)/.test(url);

/** The Runner API from packages/contracts/src/api.ts. Every call returns fast; work is reported as events. */
export function buildServer(rt: Runtime, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 5 * 1024 * 1024 });
  const { orchestrator } = rt;

  app.addHook("onRequest", async (req, reply) => {
    if (browserRoute(req.url)) return;
    if (req.headers[TOKEN_HEADER] !== rt.cfg.token) return reply.code(401).send({ error: "bad token" });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid body", issues: err.issues.slice(0, 5) });
    if (err instanceof NotFound) return reply.code(404).send({ error: err.message });
    if (err instanceof Conflict) return reply.code(409).send({ error: err.message });
    if ((err as { statusCode?: number }).statusCode) return reply.code((err as { statusCode: number }).statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  });

  app.get("/health", async () => ({ ok: true, service: "runner", sessions: orchestrator.list().length }));

  app.post("/sessions", async (req, reply) => {
    const { context } = StartRequest.parse(req.body);
    orchestrator.start(context);
    return reply.code(202).send({ sessionId: context.session.id });
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/ask", async (req, reply) => {
    const { askId, prompt } = AskRunnerRequest.parse(req.body);
    orchestrator.ask(req.params.id, askId, prompt);
    return reply.code(202).send({ askId });
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/knobs", async (req) => {
    const knobs = KnobsRequest.parse(req.body);
    await orchestrator.knobs(req.params.id, knobs);
    return { ok: true, knobs };
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/reset", async (req) => {
    await orchestrator.reset(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/status", async (req) => orchestrator.status(req.params.id));

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (req) => {
    await orchestrator.teardown(req.params.id);
    return { ok: true };
  });

  return app;
}
