import Fastify from "fastify";
import { TOKEN_HEADER } from "@pr-agent/contracts";

// Owner: Person B. Implements the Runner API in packages/contracts/src/api.ts.
// The runner owns the whole pipeline: sandboxes -> plan -> run -> verify -> session.complete.
// TODO(B): orchestrator/, planner/, sandbox/, executor/, verifier/, view/ (live view page + /live WS + /preview proxy).

const app = Fastify({ logger: true });
const TOKEN = process.env.RUNNER_TOKEN ?? "change-me";

// Browser-facing routes (embedded in Jira) carry a signed ?t= token instead of the header.
const browserRoute = (url: string) => /^\/(health|view|preview|live|artifacts)(\/|$|\?)/.test(url);

app.addHook("onRequest", async (req, reply) => {
  if (browserRoute(req.url)) return;
  if (req.headers[TOKEN_HEADER] !== TOKEN) return reply.code(401).send();
});

app.get("/health", async () => ({ ok: true, service: "runner" }));

app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 4100) });
