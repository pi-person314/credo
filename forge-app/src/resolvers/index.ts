import Resolver from "@forge/resolver";
import { sessionForIssue } from "../lib/store";

// Backend for the issue panel. Names match PanelResolvers in contracts/api.ts.
const resolver = new Resolver();

resolver.define("getSession", async ({ context }) => {
  const issueKey = (context.extension as { issue?: { key?: string } }).issue?.key;
  if (!issueKey) return null;
  const session = await sessionForIssue(issueKey);
  // TODO(A): return the full SessionDetail (findings, scenarios, runs, diffs, asks, report, audit).
  return session ? { session } : null;
});

// TODO(A): getEvents, ask, setKnobs, reset, fileBug, approveTransition, getViewUrl

export const handler = resolver.getDefinitions();
