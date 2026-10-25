import { invoke } from "@forge/bridge";
import type { Event, Knobs, SessionDetail } from "../contracts";
import type { IngestSummary } from "../lib/ingest-summary";

// Typed wrappers around the panel resolvers (PanelResolvers in contracts/api.ts).
// Payloads match docs/SPEC.md section 8.

/** Action resolvers return { ok: false, error } instead of throwing; turn that into a throw so callers see the failure. */
const action = (key: string, payload: Record<string, unknown>) =>
  invoke(key, payload).then((r) => {
    const res = r as { ok?: boolean; error?: string } | null;
    if (res && typeof res === "object" && res.ok === false) throw new Error(res.error || `${key} failed`);
    return res;
  });

/** What getSession returns: SessionDetail plus the Forge-only extras the panel reads (SessionView in lib/actions.ts). */
export type PanelDetail = SessionDetail & { ingest?: IngestSummary };

export const getSession = (issueKey?: string) =>
  invoke<PanelDetail | null>("getSession", { issueKey }).then((d) => (d as PanelDetail | null) ?? null);

export const getEvents = (sessionId: string, after?: string) =>
  invoke<Event[]>("getEvents", { sessionId, after }).then((e) => (Array.isArray(e) ? (e as Event[]) : []));

export const ask = (sessionId: string, prompt: string) => action("ask", { sessionId, prompt });

export const setKnobs = (sessionId: string, knobs: Knobs) => action("setKnobs", { sessionId, ...knobs });

export const reset = (sessionId: string) => action("reset", { sessionId });

/** Starts a fresh run of the same PR head; the panel switches to the new session when ingest saves it. */
export const rerun = (sessionId: string) => action("rerun", { sessionId });

/** Click = human approval. */
export const fileBug = (sessionId: string, scenarioId: string) => action("fileBug", { sessionId, scenarioId });

/** Click = human approval. */
export const approveTransition = (sessionId: string) => action("approveTransition", { sessionId });

/** Signed runner /view URL. Accepts a bare string or { url } from the resolver. */
export const getViewUrl = (sessionId: string) =>
  invoke<string | { url?: string }>("getViewUrl", { sessionId }).then((r) =>
    typeof r === "string" ? r : ((r as { url?: string } | null)?.url ?? null),
  );

/** Error text for a failed invoke, safe to show. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
