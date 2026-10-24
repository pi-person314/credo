import type {
  AssertionResult,
  Coverage,
  DiffClass,
  Event,
  Recommendation,
  SandboxState,
  SessionDetail,
  SessionStatus,
} from "../contracts";

// Lozenge colours and small derivations shared by the panel sections.

export type Appearance = "default" | "inprogress" | "moved" | "new" | "removed" | "success";

export const verdictLook: Record<Recommendation, Appearance> = {
  NO_BLOCKERS_FOUND: "success",
  NEEDS_REVIEW: "moved",
  BLOCKING_REGRESSION: "removed",
};

export const verdictText: Record<Recommendation, string> = {
  NO_BLOCKERS_FOUND: "No blockers found",
  NEEDS_REVIEW: "Needs review",
  BLOCKING_REGRESSION: "Blocking regression",
};

export const coverageLook: Record<Coverage, Appearance> = {
  VERIFIED: "success",
  FAILED: "removed",
  UNTESTED: "default",
  INCONCLUSIVE: "moved",
};

export const resultLook: Record<AssertionResult, Appearance> = {
  PASS: "success",
  FAIL: "removed",
  INCONCLUSIVE: "moved",
  NOT_RUN: "default",
};

export const diffLook: Record<DiffClass, Appearance> = {
  UNCHANGED_PASS: "success",
  NEW_REGRESSION: "removed",
  EXISTING_FAILURE: "moved",
  IMPROVEMENT: "new",
  FLAKY: "moved",
  INCONCLUSIVE: "moved",
};

export const sandboxLook: Record<SandboxState, Appearance> = {
  down: "default",
  building: "inprogress",
  healthy: "success",
  failed: "removed",
};

export const eventLook: Record<Event["status"], Appearance> = {
  start: "inprogress",
  ok: "success",
  fail: "removed",
  info: "default",
};

/** READY and FAILED are the resting states; everything else is still working. */
export const isActive = (status: SessionStatus) => status !== "READY" && status !== "FAILED";

const sandboxFromEvent: Partial<Record<Event["type"], SandboxState>> = {
  "sandbox.building": "building",
  "sandbox.healthy": "healthy",
  "sandbox.reset": "healthy",
  "sandbox.failed": "failed",
  "sandbox.teardown": "down",
};

/** Latest sandbox state seen in the event stream. */
export function sandboxState(events: Event[]): SandboxState {
  for (let i = events.length - 1; i >= 0; i--) {
    const s = sandboxFromEvent[events[i].type];
    if (s) return s;
  }
  return "down";
}

/** Scenario ids whose diff is a confirmed new regression. */
export const regressions = (d: SessionDetail) =>
  d.diffs.filter((x) => x.classification === "NEW_REGRESSION").map((x) => x.scenarioId);

export const hasRegression = (d: SessionDetail) =>
  regressions(d).length > 0 || d.report?.recommendation === "BLOCKING_REGRESSION";

/** Scenario objective by id, falling back to the id. */
export const scenarioName = (d: SessionDetail, id: string) => d.scenarios.find((s) => s.id === id)?.objective ?? id;

/** Runner evidence URL, built from the signed view URL (same origin, same token). */
export function artifactUrl(viewUrl: string | null, sessionId: string, path: string): string | null {
  if (!viewUrl) return null;
  try {
    const u = new URL(viewUrl);
    const t = u.searchParams.get("t") ?? "";
    return `${u.origin}/artifacts/${sessionId}/${path}?t=${encodeURIComponent(t)}`;
  } catch {
    return null;
  }
}

export const shortTime = (ts: string) => new Date(ts).toLocaleTimeString();
