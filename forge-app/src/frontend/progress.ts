import type { Ask, Diff, Event, Session, SessionStatus } from "../contracts";
import type { Appearance } from "./ui";

// What the runner is doing right now, derived from the asks in KVS plus the event stream.
// The runner works one thing at a time per session: the pipeline first, then asks in arrival order.

export type AskState =
  | { kind: "queued"; ahead: number }
  | { kind: "planning" }
  | { kind: "running" }
  | { kind: "done"; classes: string[] }
  | { kind: "failed"; reason: string };

type Input = { session: Pick<Session, "status">; asks: Ask[]; diffs: Diff[] };

const RESTING: SessionStatus[] = ["READY", "FAILED"];

const askIdOf = (e: Event) => {
  const id = (e.data as { askId?: unknown } | null | undefined)?.askId;
  return typeof id === "string" ? id : undefined;
};

const scenarioIdsOf = (e: Event) => {
  const ids = (e.data as { scenarioIds?: unknown } | null | undefined)?.scenarioIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
};

const PIPELINE_BUSY: Partial<Record<SessionStatus, string>> = {
  INGESTING: "Busy: reading sources",
  PREPARING: "Busy: building sandboxes",
  PLANNING: "Busy: planning tests",
  RUNNING: "Busy: running tests",
  REPORTING: "Busy: writing report",
};

/** State of every ask, and a short header text while the runner is working (null when idle). */
export function progress(d: Input, events: Event[]): { asks: Map<string, AskState>; busy: string | null } {
  const states = new Map<string, AskState>();
  let current: string | undefined;
  let pipelineDone = false;

  for (const e of events) {
    const askId = askIdOf(e);
    switch (e.type) {
      case "session.complete":
        pipelineDone = true;
        break;
      case "session.failed":
        if (current) states.set(current, { kind: "failed", reason: e.message });
        current = undefined;
        pipelineDone = true;
        break;
      case "sandbox.teardown": {
        // The runner forgot the session: whatever was planning/running and every ask still waiting won't finish.
        const reason = `Not run: ${e.message || "sandboxes shut down"}`;
        if (current) states.set(current, { kind: "failed", reason });
        for (const a of d.asks) if (!states.has(a.id) && a.createdAt <= e.ts) states.set(a.id, { kind: "failed", reason });
        current = undefined;
        pipelineDone = true;
        break;
      }
      case "ask.received":
        if (askId && e.status === "fail") states.set(askId, { kind: "failed", reason: e.message });
        break;
      case "planner.started":
        if (askId) {
          current = askId;
          states.set(askId, { kind: "planning" });
        }
        break;
      case "run.started":
        if (current) states.set(current, { kind: "running" });
        break;
      case "ask.complete": {
        if (!askId) break;
        if (e.status === "fail") {
          states.set(askId, { kind: "failed", reason: e.message.replace(/^Ask failed: /, "") });
        } else {
          const ask = d.asks.find((a) => a.id === askId);
          const ids = scenarioIdsOf(e).length ? scenarioIdsOf(e) : ask?.scenarioId ? [ask.scenarioId] : [];
          const classes = ids.flatMap((id) => d.diffs.filter((x) => x.scenarioId === id).map((x) => x.classification));
          states.set(askId, { kind: "done", classes: classes.length ? classes : [e.message.replace(/^Ask done: /, "")] });
        }
        if (current === askId) current = undefined;
        break;
      }
    }
  }

  // Not started yet: queued behind the running ask (or the pipeline) and every earlier waiting ask.
  const pipelineBusy = !pipelineDone && !RESTING.includes(d.session.status);
  const waiting = d.asks.filter((a) => !states.has(a.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ahead0 = current || pipelineBusy ? 1 : 0;
  waiting.forEach((a, i) => states.set(a.id, { kind: "queued", ahead: ahead0 + i }));

  const running = current ? states.get(current) : undefined;
  const now = running?.kind === "planning" ? "Busy: planning ask" : running?.kind === "running" ? "Busy: running ask" : pipelineBusy ? (PIPELINE_BUSY[d.session.status] ?? "Busy") : waiting.length ? "Busy: starting ask" : null;
  const busy = now && waiting.length && (current || pipelineBusy) ? `${now} · ${waiting.length} queued` : now;
  return { asks: states, busy: sandboxesExpired(events).expired ? null : busy };
}

export function askLabel(s: AskState): string {
  switch (s.kind) {
    case "queued":
      return s.ahead ? `Queued (${s.ahead} ahead)` : "Queued (next)";
    case "planning":
      return "Planning…";
    case "running":
      return "Running on old and new code…";
    case "done":
      return `Done: ${s.classes.join(", ")}`;
    case "failed":
      return `Failed: ${s.reason}`;
  }
}

export function askLook(s: AskState): Appearance {
  if (s.kind === "planning" || s.kind === "running") return "inprogress";
  if (s.kind === "failed") return "removed";
  if (s.kind === "done") return s.classes.includes("NEW_REGRESSION") ? "removed" : "success";
  return "default";
}

/**
 * The runner tore the sandboxes down (idle sweeper, restart) and nothing rebuilt them since.
 * The runner forgets the session on teardown, so knobs, reset and asks can't work until a new run.
 */
export function sandboxesExpired(events: Event[]): { expired: boolean; reason?: string } {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "sandbox.teardown") return { expired: true, reason: e.message };
    if (e.type === "sandbox.building" || e.type === "sandbox.healthy") return { expired: false };
  }
  return { expired: false };
}

/** A runner call that failed because the runner no longer knows the session (404). */
export const isRunnerGone = (error: string) => /runner \w+ \S+ -> 404\b/.test(error);

/** Delay before the next poll after `failures` failed polls in a row: 2s, 4s, 8s ... capped at 60s. */
export const backoffMs = (failures: number) => Math.min(60_000, 2_000 * 2 ** Math.max(0, failures - 1));
