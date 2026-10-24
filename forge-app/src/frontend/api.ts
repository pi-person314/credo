import { invoke } from "@forge/bridge";
import type { Event, Knobs, SessionDetail } from "../contracts";

// Typed wrappers around the panel resolvers (PanelResolvers in contracts/api.ts).
// Payloads match docs/SPEC.md section 8.

export const getSession = (issueKey?: string) =>
  invoke<SessionDetail | null>("getSession", { issueKey }).then((d) => (d as SessionDetail | null) ?? null);

export const getEvents = (sessionId: string, after?: string) =>
  invoke<Event[]>("getEvents", { sessionId, after }).then((e) => (Array.isArray(e) ? (e as Event[]) : []));

export const ask = (sessionId: string, prompt: string) => invoke("ask", { sessionId, prompt });

export const setKnobs = (sessionId: string, knobs: Knobs) => invoke("setKnobs", { sessionId, ...knobs });

export const reset = (sessionId: string) => invoke("reset", { sessionId });

/** Click = human approval. */
export const fileBug = (sessionId: string, scenarioId: string) => invoke("fileBug", { sessionId, scenarioId });

/** Click = human approval. */
export const approveTransition = (sessionId: string) => invoke("approveTransition", { sessionId });

/** Signed runner /view URL. Accepts a bare string or { url } from the resolver. */
export const getViewUrl = (sessionId: string) =>
  invoke<string | { url?: string }>("getViewUrl", { sessionId }).then((r) =>
    typeof r === "string" ? r : ((r as { url?: string } | null)?.url ?? null),
  );

/** Error text for a failed invoke, safe to show. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
