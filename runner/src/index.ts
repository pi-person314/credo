import { createRuntime } from "./runtime.js";
import { buildServer } from "./server.js";

// Owner: Person B. Implements the Runner API in packages/contracts/src/api.ts.
// The runner owns the whole pipeline: sandboxes -> plan -> run -> verify -> session.complete.

const rt = createRuntime();
const app = buildServer(rt);

const removed = await rt.sandboxes.removeOrphans().catch((err) => (app.log.warn(`orphan cleanup failed: ${err}`), []));
if (removed.length) app.log.info(`removed ${removed.length} leftover sandboxes: ${removed.join(", ")}`);
rt.sandboxes.startSweeper((id) => (rt.orchestrator.has(id) ? rt.orchestrator.teardown(id, `Idle for ${rt.cfg.idleTtlMin} min: sandboxes shut down`) : undefined));

if (!rt.cfg.eventsUrl) app.log.warn("EVENTS_URL is not set: events go to the console only");
if (!rt.cfg.factoryApiKey) app.log.warn("FACTORY_API_KEY is not set: the planner uses canned scenarios and templates");
if (rt.cfg.token === "change-me") app.log.warn("RUNNER_TOKEN is the default: set it before exposing the runner");

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, async () => {
    app.log.info(`${sig}: shutting down`);
    await app.close();
    await Promise.allSettled(rt.orchestrator.list().map((id) => rt.orchestrator.teardown(id, "Runner restarted: sandboxes removed")));
    await rt.close();
    process.exit(0);
  });
}

await app.listen({ host: rt.cfg.host, port: rt.cfg.port });
