import Resolver from "@forge/resolver";
import * as actions from "../lib/actions";

// Backend for the issue panel. Names match PanelResolvers in contracts/api.ts.
// Logic lives in lib/actions.ts so the Rovo actions do the same thing.
const resolver = new Resolver();

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const issueKeyOf = (payload: P, context: { extension?: unknown }) =>
  str(payload.issueKey) || ((context.extension as { issue?: { key?: string } } | undefined)?.issue?.key ?? "");

resolver.define("getSession", async ({ payload, context }) => {
  const issueKey = issueKeyOf(payload as P, context);
  return issueKey ? actions.detailForIssue(issueKey) : null;
});

resolver.define("getEvents", async ({ payload }) => {
  const { sessionId, after } = payload as P;
  const cursor = typeof after === "number" || typeof after === "string" ? after : undefined;
  return actions.listEvents(str(sessionId), cursor);
});

resolver.define("ask", async ({ payload }) => {
  const { sessionId, prompt } = payload as P;
  return actions.askTest(str(sessionId), prompt);
});

resolver.define("setKnobs", async ({ payload }) => {
  const { sessionId, provider, latencyMs } = payload as P;
  return actions.setKnobs(str(sessionId), { provider, latencyMs });
});

resolver.define("reset", async ({ payload }) => actions.resetSandboxes(str((payload as P).sessionId)));

// The click itself is the approval; the clicking user is recorded as approver.
resolver.define("fileBug", async ({ payload, context }) => {
  const { sessionId, scenarioId } = payload as P;
  return actions.fileBug(str(sessionId), str(scenarioId), context.accountId);
});

resolver.define("approveTransition", async ({ payload, context }) =>
  actions.approveTransition(str((payload as P).sessionId), context.accountId),
);

resolver.define("getViewUrl", async ({ payload }) => {
  const res = await actions.viewUrl(str((payload as P).sessionId));
  if (!res.ok) console.warn(`getViewUrl: ${res.error}`);
  return res.ok ? res.url : null;
});

export const handler = resolver.getDefinitions();
