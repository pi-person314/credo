import { z } from "zod";

export const RUNNER_EVENT_TYPES = [
  "sandbox.building",
  "sandbox.healthy",
  "sandbox.failed",
  "sandbox.reset",
  "sandbox.teardown",
  "planner.started",
  "planner.scenarios", // data: Scenario[]
  "route.decided",
  "run.started",
  "run.assertion",
  "run.finished", // data: Run
  "verify.rerun",
  "verify.diff", // data: Diff
  "knobs.set",
  "ask.complete", // data: { askId, scenarioIds }
  "session.complete", // data: { route }
  "session.failed",
] as const;

export const FORGE_EVENT_TYPES = [
  "ingest.pr",
  "ingest.jira",
  "ingest.confluence",
  "ingest.greptile",
  "ask.received",
  "report.ready", // data: Report
  "publish.jira",
  "publish.github",
  "bug.filed",
  "transition.proposed",
  "transition.approved",
] as const;

export const EventType = z.enum([...RUNNER_EVENT_TYPES, ...FORGE_EVENT_TYPES]);
export type EventType = z.infer<typeof EventType>;

export const Actor = z.enum(["ingest", "planner", "sandbox", "executor", "verifier", "reporter", "reviewer", "agent"]);
export type Actor = z.infer<typeof Actor>;

export const Event = z.object({
  sessionId: z.string(),
  ts: z.string().datetime(),
  actor: Actor,
  type: EventType,
  status: z.enum(["start", "ok", "fail", "info"]),
  message: z.string(),
  data: z.unknown().optional(),
});
export type Event = z.infer<typeof Event>;

/** One frame from the agent's browser, sent over WS /live/:id/:env (runner-internal, used by the live view page). */
export const LiveFrame = z.object({
  ts: z.string().datetime(),
  scenarioId: z.string().optional(),
  step: z.string().optional(),
  /** base64 JPEG */
  jpeg: z.string(),
});
export type LiveFrame = z.infer<typeof LiveFrame>;
