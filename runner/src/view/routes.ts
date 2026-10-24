import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Env, KnobsRequest, viewPath, type LiveFrame } from "@pr-agent/contracts";
import { VIEWPORT } from "../executor/browser.js";
import { signSessionToken, verifySessionToken } from "@pr-agent/contracts/token";
import type { AgentFrame } from "../executor/browser.js";
import { toPlaywrightSpec } from "../export/playwright.js";
import type { Runtime } from "../runtime.js";
import { viewPage } from "./page.js";

/** P1 take-over: the reviewer drives the agent's browser from the live view. x/y are 0..1 of the frame. */
const Input = z.object({
  env: z.enum(["base", "head", "both"]),
  action: z.enum(["click", "dblclick", "type", "press", "scroll", "goto"]),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  text: z.string().max(500).optional(),
  key: z.enum(["Enter", "Tab", "Backspace", "Escape", "ArrowUp", "ArrowDown"]).optional(),
  dy: z.number().min(-5000).max(5000).optional(),
  path: z.string().startsWith("/").max(500).optional(),
});

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

// Hop-by-hop and framing headers we never pass through the preview proxy.
const DROP_REQ = new Set(["host", "connection", "content-length", "accept-encoding", "cookie", "x-token", "upgrade", "keep-alive", "transfer-encoding"]);
const DROP_RES = new Set(["connection", "content-length", "content-encoding", "transfer-encoding", "x-frame-options", "content-security-policy", "keep-alive"]);

/**
 * Browser-facing routes, embedded in the Jira panel. All carry the signed session token (?t=, or a path
 * segment for the preview so the app's relative URLs keep it): /view, /view/:id/state, /view/:id/knobs,
 * /view/:id/reset, /preview, /live (WebSocket), /artifacts. Plus GET /sessions/:id/view-url for Forge (x-token).
 */
export async function viewRoutes(app: FastifyInstance, rt: Runtime) {
  const { orchestrator, sandboxes, browser, memory, cfg } = rt;
  const ok = (id: string, t: string | undefined) => verifySessionToken(cfg.token, id, t);
  const deny = (reply: FastifyReply) => reply.code(403).type("text/plain").send("Link expired or invalid. Reopen the live sandbox from the Jira panel.");

  await app.register(websocket);

  app.get<{ Params: { id: string } }>("/sessions/:id/view-url", async (req) => {
    const t = signSessionToken(cfg.token, req.params.id);
    return { url: `${cfg.publicUrl}${viewPath(req.params.id, t)}`, token: t };
  });

  // P1: a scenario as a standalone Playwright test. x-token for Forge, ?t= for links in the panel/view.
  const spec = (id: string, scenarioId: string, reply: FastifyReply) => {
    const s = orchestrator.get(id);
    const sc = s.scenarios.find((x) => x.id === scenarioId);
    if (!sc) return reply.code(404).send({ error: `unknown scenario ${scenarioId}` });
    return reply
      .type("text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${sc.id}.spec.ts"`)
      .send(toPlaywrightSpec(sc, s.context.manifest));
  };
  app.get<{ Params: { id: string; scenarioId: string } }>("/sessions/:id/scenarios/:scenarioId/spec", async (req, reply) =>
    spec(req.params.id, req.params.scenarioId, reply),
  );
  app.get<{ Params: { id: string; scenarioId: string }; Querystring: { t?: string } }>("/view/:id/spec/:scenarioId", async (req, reply) => {
    if (!ok(req.params.id, req.query.t)) return deny(reply);
    return spec(req.params.id, req.params.scenarioId.replace(/\.spec\.ts$/, ""), reply);
  });

  app.get<{ Params: { id: string }; Querystring: { t?: string } }>("/view/:id", async (req, reply) => {
    const { id } = req.params;
    if (!ok(id, req.query.t)) return deny(reply);
    return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(viewPage(id, req.query.t!));
  });

  app.get<{ Params: { id: string }; Querystring: { t?: string; after?: string } }>("/view/:id/state", async (req, reply) => {
    const { id } = req.params;
    if (!ok(id, req.query.t)) return deny(reply);
    const s = orchestrator.has(id) ? orchestrator.get(id) : undefined;
    const status = sandboxes.status(id);
    const counts: Record<string, { orders?: number; charges?: number }> = {};
    for (const env of ["base", "head"] as const) {
      if (status[env] !== "healthy") continue;
      const tables = s?.context.manifest.tables ?? [];
      counts[env] = {};
      for (const t of ["orders", "charges"] as const) {
        if (tables.includes(t)) counts[env]![t] = await sandboxes.db(id, env, t).then((r) => r.count).catch(() => undefined);
      }
    }
    return {
      sessionId: id,
      status: s?.status ?? "UNKNOWN",
      title: s?.context.session.title,
      startPage: s?.context.manifest.pages.find((p) => !p.includes(":")) ?? "/",
      busy: (s?.busy ?? 0) > 0,
      sandboxes: status,
      shas: s ? { base: s.context.session.baseSha, head: s.context.session.headSha } : undefined,
      knobs: s?.knobs,
      counts,
      scenarios: s?.scenarios.map((x) => ({ id: x.id, objective: x.objective, origin: x.origin, sourceRefs: x.sourceRefs })) ?? [],
      diffs: s?.diffs ?? [],
      events: memory.events(id, req.query.after).slice(-60),
    };
  });

  app.post<{ Params: { id: string }; Querystring: { t?: string } }>("/view/:id/knobs", async (req, reply) => {
    if (!ok(req.params.id, req.query.t)) return deny(reply);
    const knobs = KnobsRequest.parse(req.body);
    await orchestrator.knobs(req.params.id, knobs);
    return { ok: true, knobs };
  });

  app.post<{ Params: { id: string }; Querystring: { t?: string } }>("/view/:id/reset", async (req, reply) => {
    if (!ok(req.params.id, req.query.t)) return deny(reply);
    await orchestrator.reset(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Querystring: { t?: string } }>("/view/:id/input", async (req, reply) => {
    const { id } = req.params;
    if (!ok(id, req.query.t)) return deny(reply);
    const input = Input.parse(req.body);
    const s = orchestrator.get(id);
    if (s.busy > 0) return reply.code(409).send({ error: "The agent is driving right now. Take over when it finishes." });
    const envs = input.env === "both" ? (["base", "head"] as const) : ([input.env] as const);
    await Promise.all(
      envs.map(async (env) => {
        const sb = sandboxes.healthy(id, env);
        const page = await browser.page(id, env, sb.url);
        await browser.setStep(id, env, { step: `reviewer: ${input.action}${input.text ? ` "${input.text}"` : input.path ? ` ${input.path}` : ""}` });
        const x = (input.x ?? 0.5) * VIEWPORT.width;
        const y = (input.y ?? 0.5) * VIEWPORT.height;
        if (input.action === "click") await page.mouse.click(x, y);
        else if (input.action === "dblclick") await page.mouse.dblclick(x, y);
        else if (input.action === "type") await page.keyboard.type(input.text ?? "", { delay: 20 });
        else if (input.action === "press") await page.keyboard.press(input.key ?? "Enter");
        else if (input.action === "scroll") await page.mouse.wheel(0, input.dy ?? 300);
        else if (input.action === "goto") await page.goto(input.path ?? "/", { timeout: 10_000 });
      }),
    );
    sandboxes.touch(id);
    return { ok: true };
  });

  // Agent browser frames. First message is the latest frame so a new viewer isn't blank.
  app.get<{ Params: { id: string; env: string }; Querystring: { t?: string } }>("/live/:id/:env", { websocket: true }, async (socket, req) => {
    const { id } = req.params;
    const env = Env.safeParse(req.params.env);
    if (!env.success || !ok(id, req.query.t)) return socket.close(4403, "forbidden");
    const send = (f: AgentFrame) => {
      const frame: LiveFrame = { ts: f.ts, scenarioId: f.scenarioId, step: f.step, jpeg: f.jpeg };
      if (socket.readyState === socket.OPEN && socket.bufferedAmount < 2_000_000) socket.send(JSON.stringify(frame));
    };
    const last = await browser.lastFrame(id, env.data);
    if (last) send(last);
    const onFrame = (f: AgentFrame) => f.sessionId === id && f.env === env.data && send(f);
    browser.on("frame", onFrame);
    socket.on("close", () => browser.off("frame", onFrame));
  });

  // Clickable sandbox app. The token is a path segment so the app's relative links and fetches keep it.
  app.get<{ Params: { id: string; env: string; token: string } }>("/preview/:id/:env/:token", async (req, reply) => reply.redirect(`${req.url.split("?")[0]}/`));

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.all<{ Params: { id: string; env: string; token: string; "*": string } }>("/preview/:id/:env/:token/*", async (req, reply) => {
      const { id, token } = req.params;
      const env = Env.safeParse(req.params.env);
      if (!env.success || !ok(id, token)) return deny(reply);
      const sb = sandboxes.get(id, env.data);
      if (!sb || sb.state !== "healthy" || !sb.url) return reply.code(503).type("text/plain").send(`${env.data} sandbox is ${sb?.state ?? "down"}`);
      sandboxes.touch(id);
      return proxy(req, reply, `${sb.url}/${req.params["*"]}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`, sb.url, `/preview/${id}/${env.data}/${token}`);
    });
  });

  app.get<{ Params: { id: string; "*": string }; Querystring: { t?: string } }>("/artifacts/:id/*", async (req, reply) => {
    const { id } = req.params;
    if (!ok(id, req.query.t)) return deny(reply);
    const root = resolve(cfg.artifactsDir, id);
    const file = resolve(root, req.params["*"]);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return reply.code(404).send({ error: "not found" });
    return reply
      .type(TYPES[extname(file)] ?? "application/octet-stream")
      .header("cache-control", "private, max-age=3600")
      .send(createReadStream(file));
  });
}

async function proxy(req: FastifyRequest, reply: FastifyReply, target: string, origin: string, prefix: string) {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQ.has(k) && typeof v === "string") headers[k] = v;
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined;
  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? (req.body as Buffer) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return reply.code(502).type("text/plain").send(`sandbox unreachable: ${err instanceof Error ? err.message : err}`);
  }
  reply.code(res.status);
  res.headers.forEach((v, k) => {
    if (DROP_RES.has(k)) return;
    // Absolute redirects to the sandbox's internal address go back through the proxy.
    if (k === "location" && v.startsWith(origin)) v = prefix + v.slice(origin.length);
    else if (k === "location" && v.startsWith("/")) v = prefix + v;
    reply.header(k, v);
  });
  return reply.send(Buffer.from(await res.arrayBuffer()));
}
