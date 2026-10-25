import Resolver from "@forge/resolver";
import * as actions from "../lib/actions";
import { getSession } from "../lib/store";

// Backend for the issue panel. Names match PanelResolvers in contracts/api.ts.
// Logic lives in lib/actions.ts so the Rovo actions do the same thing.
const resolver = new Resolver();

type P = Record<string, unknown>;
type Ctx = { extension?: unknown };
const str = (v: unknown) => (typeof v === "string" ? v : "");

// The issue comes from Forge's invocation context, never from the payload: the panel can only
// see and act on sessions of the issue it is rendered on. Writes run asApp, so this check is the guard.
const contextIssueKey = (context: Ctx) => (context.extension as { issue?: { key?: string } } | undefined)?.issue?.key ?? "";

/** The payload's sessionId if it belongs to the panel's issue, else undefined. */
async function ownSessionId(payload: unknown, context: Ctx) {
  const issueKey = contextIssueKey(context);
  const sessionId = str((payload as P | undefined)?.sessionId);
  if (!issueKey || !sessionId) return undefined;
  const session = await getSession(sessionId);
  return session?.issueKey === issueKey ? session.id : undefined;
}

const denied = { ok: false as const, error: "session not found for this issue" };

resolver.define("getSession", async ({ context }) => {
  const issueKey = contextIssueKey(context);
  return issueKey ? actions.detailForIssue(issueKey) : null;
});

resolver.define("getEvents", async ({ payload, context }) => {
  const sessionId = await ownSessionId(payload, context);
  if (!sessionId) return [];
  const { after } = payload as P;
  const cursor = typeof after === "number" || typeof after === "string" ? after : undefined;
  return actions.listEvents(sessionId, cursor);
});

resolver.define("ask", async ({ payload, context }) => {
  const sessionId = await ownSessionId(payload, context);
  return sessionId ? actions.askTest(sessionId, (payload as P).prompt) : denied;
});

resolver.define("setKnobs", async ({ payload, context }) => {
  const sessionId = await ownSessionId(payload, context);
  if (!sessionId) return denied;
  const { provider, latencyMs } = payload as P;
  return actions.setKnobs(sessionId, { provider, latencyMs });
});

resolver.define("reset", async ({ payload, context }) => {
  const sessionId = await ownSessionId(payload, context);
  return sessionId ? actions.resetSandboxes(sessionId) : denied;
});

resolver.define("rerun", async ({ payload, context }) => {
  const sessionId = await ownSessionId(payload, context);
  return sessionId ? actions.rerun(sessionId) : denied;
});

// The click itself is the approval; the clicking user is recorded as approver.
resolver.define("fileBug", async ({ payload, context }) => {
  const sessionId = await ownSessionId(payload, context);
  return sessionId ? actions.fileBug(sessionId, str((payload as P).scenarioId), context.accountId) : denied;
});

resolver.define("approveTransition", async ({ payload, context }) => {
  const sessionId = await ownSessionId(payload, context);
  return sessionId ? actions.approveTransition(sessionId, context.accountId) : denied;
});

resolver.define("getViewUrl", async ({ payload, context }) => {
  const sessionId = await ownSessionId(payload, context);
  if (!sessionId) return null;
  const res = await actions.viewUrl(sessionId);
  if (!res.ok) console.warn(`getViewUrl: ${res.error}`);
  return res.ok ? res.url : null;
});

export const handler = resolver.getDefinitions();
