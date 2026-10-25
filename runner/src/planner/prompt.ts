import { acRef, type Context, type Diff, type Scenario } from "@pr-agent/contracts";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (truncated)` : s);

const FORMAT = `Scenario JSON format (the runner executes exactly this, nothing else):
{
  "id": "sc_<lowercase_snake>",            // unique, matches ^sc_[a-z0-9_]+$
  "objective": "<one line: what must hold>",
  "origin": "planner" | "followup" | "ask",
  "priority": "P0" | "P1" | "P2",
  "fixture": "<one of the manifest fixtures>",   // the app is reset to this before the run
  "knobs": { "provider": "ok"|"slow"|"timeout"|"error", "latencyMs": <0-30000> },  // optional, whole scenario
  "steps": [                                 // 1-20
    { "op": "http", "method": "GET"|"POST"|..., "path": "/api/...", "body": {...}, "saveAs": "<name>" },
    { "op": "http", "method": "POST", "path": "/__test/provider", "body": { "mode": "ok", "latencyMs": 0 } },  // switch the provider mid-scenario
    { "op": "parallel", "count": <2-20>, "step": { "op": "http", ... , "saveAs": "<name>" } },
    { "op": "ui", "action": "goto", "target": "/page" },
    { "op": "ui", "action": "click"|"dblclick", "target": "<manifest selector name or CSS selector>" },
    { "op": "ui", "action": "fill", "target": "<selector>", "value": "<text>" },
    { "op": "wait", "ms": <0-30000> }
  ],
  "assertions": [                            // 1-10
    { "id": "a1", "type": "db_count", "table": "<manifest table>", "where": { "orderId": "$order.id" }, "equals": <n> },
    { "id": "a2", "type": "http_status", "ref": "<saveAs name>", "equals": <status> },
    { "id": "a3", "type": "json_path", "ref": "<saveAs name>", "path": "status", "equals": <json> },
    { "id": "a4", "type": "ui_text", "selector": "<selector name or CSS>", "contains": "<text>" }
  ],
  "rationale": "<why this test, citing the risk>",
  "sourceRefs": ["jira:<KEY>#ac<N>", "greptile:<finding id>"]
}
"$name.path" in a value means a field of the response saved as "name" (e.g. "$order.id").
A parallel step's saveAs holds all responses; http_status on it checks every one.
Rules:
- Only use the API routes, pages, selectors, fixtures and tables in the manifest. Never call /__test routes, except
  POST /__test/provider { "mode": <manifest provider mode>, "latencyMs": <0-30000> } as a top-level step to change the
  provider mode mid-scenario ("knobs" only sets the starting mode).
- A criterion phrased as "X succeeds", "works" or "completes" needs a scenario that proves the success, not just that
  the failure is handled. For "retries after a provider error succeed": knobs provider "error" -> pay (fails) ->
  POST /__test/provider { "mode": "ok" } -> pay again -> GET /api/orders/$order.id, and assert the retry is 200, the
  order status is "paid" and exactly 1 charge row exists. Never map a success criterion to a scenario that only asserts
  failure behavior (error statuses, 0 charges); map that one to the criterion it does check, or to none.
- Every scenario must point at the acceptance criterion it checks with "jira:<KEY>#ac<N>" (N is 1-based) when one applies.
  List first the criterion its checks would break (a charge count check -> the "never charged twice" criterion). A
  failing scenario only fails its first criterion; add others only if the scenario also proves them when it passes.
- Write deterministic checks: database row counts and status codes beat UI text. Races need a slow provider (e.g. slow, 800 ms) and parallel calls.
- The same scenario runs on the old code and the new code; write what SHOULD be true per the ticket and spec, not what the new code does.
- Answer with a JSON array of scenarios only. No prose, no markdown fences.`;

function contextBlock(c: Context): string {
  const key = c.jira?.key ?? c.session.issueKey;
  const acs = (c.jira?.acceptanceCriteria ?? []).map((t, i) => `  ${acRef(key, i + 1)}: ${t}`).join("\n") || "  (none)";
  const findings = c.findings.map((f) => `  ${f.source}:${f.id} [${f.severity}] ${f.description}`).join("\n") || "  (none)";
  const pages = c.confluence.map((p) => `  "${p.title}": ${clip(p.excerpt, 1500)}`).join("\n") || "  (none)";
  const files = c.changedFiles
    .map((f) => `--- ${f.path} (${f.status}, +${f.additions} -${f.deletions})\n${f.patch ? clip(f.patch, 4000) : "(no patch)"}`)
    .join("\n");
  return `Pull request: ${c.session.repo}#${c.session.prNumber} "${c.session.title}"
${clip(c.prBody, 1500)}

Jira ${key}: ${c.jira?.summary ?? ""}
${clip(c.jira?.description ?? "", 1500)}
Acceptance criteria:
${acs}

Confluence:
${pages}

Review findings (refer to them in sourceRefs as "<source>:<id>"):
${findings}

App manifest (everything you can use):
${JSON.stringify(c.manifest, null, 2)}

Changed files:
${clip(files, 12_000)}`;
}

export function planPrompt(c: Context, max: number): string {
  return `You are the test planner of a PR verification agent. Find the behavior this PR changes that nobody has proven
works, and write ${Math.min(3, max)} to ${max} scenarios that check it against the ticket's acceptance criteria.
Cover every acceptance criterion you can. Put the riskiest behavior first as P0.

${contextBlock(c)}

${FORMAT}`;
}

export function askPrompt(c: Context, prompt: string, prior: Scenario[]): string {
  return `You are the test planner of a PR verification agent. A reviewer asked for a new test in plain English.
Write exactly 1 scenario (origin "ask") that answers it. Don't repeat these existing scenarios: ${prior.map((s) => s.id).join(", ") || "none"}.

Reviewer: "${prompt}"

${contextBlock(c)}

${FORMAT}`;
}

export function followupPrompt(c: Context, scenarios: Scenario[], diffs: Diff[], max: number): string {
  const results = diffs.map((d) => `  ${d.scenarioId}: base ${d.base}, PR ${d.head} -> ${d.classification}`).join("\n");
  return `You are the test planner of a PR verification agent. The first round found surprises. Write up to ${max}
follow-up scenarios (origin "followup") that pin down the cause or check neighbouring behavior (other retry paths,
timeouts, errors, the UI). Don't repeat: ${scenarios.map((s) => s.id).join(", ")}.

First round:
${results}

Scenarios already run:
${clip(JSON.stringify(scenarios), 6000)}

${contextBlock(c)}

${FORMAT}`;
}

export function retryPrompt(original: string, errors: string[]): string {
  return `${original}

Your previous answer was rejected:
${errors.map((e) => `- ${e}`).join("\n")}
Answer again with a corrected JSON array only.`;
}
