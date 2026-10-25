import { describe, expect, it } from "vitest";
import type { Ask, Diff, Event, Session } from "../src/contracts";
import { askLabel, backoffMs, isRunnerGone, progress, sandboxesExpired } from "../src/frontend/progress";

let n = 0;
const ev = (type: Event["type"], status: Event["status"], message = "", data?: unknown): Event => ({
  sessionId: "ses_1",
  ts: new Date(Date.UTC(2026, 9, 24, 12, 0, n++)).toISOString(),
  actor: "planner",
  type,
  status,
  message,
  data,
});
const ask = (id: string, minute: number, scenarioId?: string): Ask => ({
  id,
  sessionId: "ses_1",
  prompt: `prompt ${id}`,
  scenarioId,
  createdAt: new Date(Date.UTC(2026, 9, 24, 12, minute)).toISOString(),
});
const diff = (scenarioId: string, classification: Diff["classification"]): Diff => ({
  sessionId: "ses_1",
  scenarioId,
  base: "PASS",
  head: classification === "NEW_REGRESSION" ? "FAIL" : "PASS",
  classification,
  runIds: [],
});
const input = (status: Session["status"], asks: Ask[], diffs: Diff[] = []) => ({ session: { status }, asks, diffs });
const pipelineDone = [ev("planner.started", "start", "Planning from 3 acceptance criteria"), ev("session.complete", "ok", "First report ready")];

describe("progress", () => {
  it("queues asks behind the running pipeline", () => {
    const p = progress(input("RUNNING", [ask("a1", 1), ask("a2", 2)]), [ev("planner.started", "start", "Planning from 3")]);
    expect(askLabel(p.asks.get("a1")!)).toBe("Queued (1 ahead)");
    expect(askLabel(p.asks.get("a2")!)).toBe("Queued (2 ahead)");
    expect(p.busy).toBe("Busy: running tests · 2 queued");
  });

  it("follows one ask through planning, running and done", () => {
    const asks = [ask("a1", 1, "sc_retry"), ask("a2", 2)];
    const planning = [...pipelineDone, ev("ask.received", "start", "Ask: x", { askId: "a1" }), ev("planner.started", "start", "Planning ask: x", { askId: "a1" })];
    let p = progress(input("PLANNING", asks), planning);
    expect(askLabel(p.asks.get("a1")!)).toBe("Planning…");
    expect(askLabel(p.asks.get("a2")!)).toBe("Queued (1 ahead)");
    expect(p.busy).toBe("Busy: planning ask · 1 queued");

    const running = [...planning, ev("planner.scenarios", "ok", "1 scenario"), ev("run.started", "start", "sc_retry on base")];
    p = progress(input("RUNNING", asks), running);
    expect(askLabel(p.asks.get("a1")!)).toBe("Running on old and new code…");
    expect(p.busy).toBe("Busy: running ask · 1 queued");

    const done = [...running, ev("ask.complete", "ok", "Ask done: sc_retry NEW_REGRESSION", { askId: "a1", scenarioIds: ["sc_retry"] })];
    p = progress(input("READY", asks, [diff("sc_retry", "NEW_REGRESSION")]), done);
    expect(askLabel(p.asks.get("a1")!)).toBe("Done: NEW_REGRESSION");
    expect(askLabel(p.asks.get("a2")!)).toBe("Queued (next)");
    expect(p.busy).toBe("Busy: starting ask");
  });

  it("shows failures with their reason", () => {
    const asks = [ask("a1", 1), ask("a2", 2), ask("a3", 3)];
    const p = progress(input("FAILED", asks), [
      ...pipelineDone,
      ev("ask.received", "fail", "Runner rejected the ask: runner POST /sessions/ses_1/ask -> 404", { askId: "a1" }),
      ev("planner.started", "start", "Planning ask", { askId: "a2" }),
      ev("ask.complete", "fail", "Ask failed: sandboxes not healthy", { askId: "a2", scenarioIds: [] }),
      ev("planner.started", "start", "Planning ask", { askId: "a3" }),
      ev("session.failed", "fail", "runner crashed"),
    ]);
    expect(askLabel(p.asks.get("a1")!)).toBe("Failed: Runner rejected the ask: runner POST /sessions/ses_1/ask -> 404");
    expect(askLabel(p.asks.get("a2")!)).toBe("Failed: sandboxes not healthy");
    expect(askLabel(p.asks.get("a3")!)).toBe("Failed: runner crashed");
    expect(p.busy).toBeNull();
  });

  it("is idle when nothing is running", () => {
    expect(progress(input("READY", []), pipelineDone).busy).toBeNull();
  });
});

describe("sandboxesExpired", () => {
  it("is set by a teardown and cleared by a rebuild", () => {
    const teardown = ev("sandbox.teardown", "ok", "Idle for 30 min: sandboxes shut down");
    expect(sandboxesExpired([ev("sandbox.healthy", "ok", "", { env: "base" }), teardown])).toEqual({ expired: true, reason: teardown.message });
    expect(sandboxesExpired([teardown, ev("sandbox.building", "start", "", { env: "base" })]).expired).toBe(false);
    expect(sandboxesExpired([]).expired).toBe(false);
  });

  it("recognises a runner 404", () => {
    expect(isRunnerGone("runner POST /sessions/ses_1/knobs -> 404")).toBe(true);
    expect(isRunnerGone("runner POST /sessions/ses_1/knobs -> 409")).toBe(false);
  });
});

describe("backoffMs", () => {
  it("doubles from 2s and caps at 60s", () => {
    expect([1, 2, 3, 4, 10].map(backoffMs)).toEqual([2_000, 4_000, 8_000, 16_000, 60_000]);
  });
});
