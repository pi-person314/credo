import Resolver from "@forge/resolver";

// Queue consumer for jobs pushed by the github web trigger.
// TODO(A):
//   1. Read the Jira issue (summary, description, acceptance criteria, assignee) with asApp().requestJira.
//   2. Read Confluence pages linked from the issue (remote links) with requestConfluence.
//   3. Read PR files and Greptile bot comments from api.github.com (GITHUB_TOKEN variable).
//   4. Build a Context, save the Session (status PREPARING), append ingest.* events.
//   5. runner.start(context).
const resolver = new Resolver();

resolver.define("ingest", async ({ payload }) => {
  console.log("ingest job", JSON.stringify(payload));
});

export const ingestConsumer = resolver.getDefinitions();
