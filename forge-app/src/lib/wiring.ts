import { registerBugHook, registerTransitionHook } from "./actions";
import { approveTransition, fileRegressionBug, proposeTransition, publishReport } from "./publish";
import { registerPublishHook } from "./report";
import { getDiffs, getScenarios, saveReport } from "./store";

// Plugs the publish module into the state core. index.ts imports this once, so every
// Forge function (web triggers, resolvers, Rovo actions) runs with the hooks registered.

registerPublishHook(async ({ session, report }) => {
  const [scenarios, diffs] = await Promise.all([getScenarios(session.id), getDiffs(session.id)]);
  const out = await publishReport(session, report, scenarios, diffs);
  if (out.jira !== "failed" || out.github !== "failed") await saveReport({ ...report, publishedAt: out.publishedAt });
  console.log(`publish ${session.id} ${out.hash}: jira=${out.jira} github=${out.github}`);
  // A blocking regression gets a proposal only. The move itself waits for a human click.
  if (report.recommendation === "BLOCKING_REGRESSION") await proposeTransition(session);
});

registerBugHook(async ({ session, scenario, diff, context, approvedBy }) => {
  const key = await fileRegressionBug(session, scenario, diff, approvedBy);
  const issueUrl = context?.jira?.url;
  const browse = `/browse/${session.issueKey}`;
  return { key, url: issueUrl?.includes(browse) ? issueUrl.replace(browse, `/browse/${key}`) : undefined };
});

registerTransitionHook(async ({ session, approvedBy }) => {
  const res = await approveTransition(session, approvedBy);
  if (!res.ok) throw new Error(res.error);
  return { to: res.transition?.name };
});
