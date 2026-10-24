import { z } from "zod";
import { Diff, Env, Knobs, Route, Run, Scenario, type Event, type SessionStatus } from "../contracts/index";
import { getAsks, updateSandbox, updateSession, upsertAsks, upsertDiffs, upsertRuns, upsertScenarios } from "./store";

// Turns runner events into the state the panel reads. Payloads are checked with safeParse:
// a bad payload is logged and skipped, never thrown, so one broken event can't block the rest.

const EnvData = z.object({ env: Env });
const RouteData = z.object({ route: Route });
const AskDone = z.object({ askId: z.string(), scenarioIds: z.array(z.string()).default([]) });

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, e: Event): T | undefined {
  const r = schema.safeParse(e.data);
  if (!r.success) console.warn(`skip ${e.type} payload for ${e.sessionId}: ${r.error.issues[0]?.message}`);
  return r.success ? r.data : undefined;
}

/** planner.scenarios carries Scenario[]; keep the valid ones. */
function scenariosOf(e: Event): Scenario[] {
  if (!Array.isArray(e.data)) return parse(z.array(Scenario), e) ?? [];
  return e.data.flatMap((s) => parse(Scenario, { ...e, data: s }) ?? []);
}

/** Session status each event moves to. Missing = no change. */
const STATUS_FOR: Partial<Record<Event["type"], SessionStatus>> = {
  "sandbox.building": "PREPARING",
  "planner.started": "PLANNING",
  "run.started": "RUNNING",
  "session.complete": "REPORTING", // onSessionComplete sets READY once the report is saved
  "session.failed": "FAILED",
};

async function projectOne(sessionId: string, e: Event) {
  switch (e.type) {
    case "planner.scenarios": {
      const list = scenariosOf(e);
      if (list.length) await upsertScenarios(sessionId, list);
      break;
    }
    case "run.finished": {
      const run = parse(Run, e);
      if (run) await upsertRuns(sessionId, [run]);
      break;
    }
    case "verify.diff": {
      const diff = parse(Diff, e);
      if (diff) await upsertDiffs(sessionId, [diff]);
      break;
    }
    case "ask.complete": {
      const done = parse(AskDone, e);
      const ask = done && (await getAsks(sessionId)).find((a) => a.id === done.askId);
      if (ask) await upsertAsks(sessionId, [{ ...ask, scenarioId: done.scenarioIds[0] ?? ask.scenarioId }]);
      break;
    }
    case "sandbox.building":
    case "sandbox.healthy":
    case "sandbox.failed": {
      const d = parse(EnvData, e);
      const state = e.type === "sandbox.building" ? "building" : e.type === "sandbox.healthy" ? "healthy" : "failed";
      if (d) await updateSandbox(sessionId, { [d.env]: state });
      break;
    }
    case "sandbox.reset":
      await updateSandbox(sessionId, { knobs: { provider: "ok", latencyMs: 0 } });
      break;
    case "sandbox.teardown":
      await updateSandbox(sessionId, { base: "down", head: "down" });
      break;
    case "knobs.set": {
      const knobs = parse(Knobs, e);
      if (knobs) await updateSandbox(sessionId, { knobs });
      break;
    }
    case "route.decided": {
      const d = parse(RouteData, e);
      if (d) await updateSession(sessionId, { route: d.route });
      break;
    }
  }
  const status = STATUS_FOR[e.type];
  if (status) await updateSession(sessionId, { status, ...(e.type === "session.failed" ? { error: e.message } : {}) });
}

/** Apply events (already stored by appendEvents) to scenarios / runs / diffs / asks / sandbox / session. */
export async function projectEvents(sessionId: string, events: Event[]) {
  for (const e of events) {
    try {
      await projectOne(sessionId, e);
    } catch (err) {
      console.error(`project ${e.type} for ${sessionId} failed`, err);
    }
  }
}
