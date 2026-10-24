import { sessionForIssue } from "../lib/store";
import * as actions from "../lib/actions";

// Rovo agent actions. Inputs arrive as top-level payload fields; Rovo also adds payload.context.
// Each one calls the same lib/actions.ts function as the panel resolver, and returns short JSON
// the agent can read back to the user.

type Payload = { issueKey?: string; context?: { jira?: { issueKey?: string } }; [k: string]: unknown };
type InvocationContext = { principal?: { accountId?: string } };

const keyOf = (p: Payload) => (p.issueKey ?? p.context?.jira?.issueKey ?? "").trim().toUpperCase();

/** Session for the issue, or the reply Rovo should give when there is none. */
async function session(p: Payload) {
  const issueKey = keyOf(p);
  if (!issueKey) return { issueKey, error: "Which Jira issue? Give the key, e.g. PAY-5." };
  const s = await sessionForIssue(issueKey);
  return s ? { issueKey, id: s.id } : { issueKey, error: `No PR verification found for ${issueKey}.` };
}

export async function rovoGetVerification(payload: Payload) {
  const s = await session(payload);
  if (!s.id) return s;
  const d = await actions.loadDetail(s.id);
  if (!d) return { issueKey: s.issueKey, error: "Session not found." };
  const objective = (id: string) => d.scenarios.find((x) => x.id === id)?.objective ?? id;
  return {
    issueKey: s.issueKey,
    pr: d.session.prUrl ?? `#${d.session.prNumber}`,
    status: d.session.status,
    verdict: d.report?.recommendation ?? "no report yet",
    acceptanceCriteria: d.report?.coverage.map((a) => `AC${a.index} ${a.status}: ${a.text}`) ?? d.criteria.map((t, i) => `AC${i + 1} pending: ${t}`),
    results: d.diffs.map((x) => `${x.scenarioId} (${objective(x.scenarioId)}): base ${x.base}, PR ${x.head} -> ${x.classification}`),
    risks: d.report?.risks ?? [],
    sandboxes: `base ${d.sandbox.base}, PR ${d.sandbox.head}; provider ${d.sandbox.knobs.provider} ${d.sandbox.knobs.latencyMs}ms`,
    note: "Not a merge approval. A human decides.",
  };
}

export async function rovoAskTest(payload: Payload) {
  const s = await session(payload);
  if (!s.id) return s;
  const res = await actions.askTest(s.id, payload.prompt);
  return res.ok
    ? { issueKey: s.issueKey, queued: true, askId: res.ask.id, note: "Runs on base and PR; the result appears in the PR Confidence panel." }
    : { issueKey: s.issueKey, queued: false, error: res.error };
}

export async function rovoSetKnobs(payload: Payload) {
  const s = await session(payload);
  if (!s.id) return s;
  const res = await actions.setKnobs(s.id, { provider: payload.provider, latencyMs: payload.latencyMs });
  return res.ok ? { issueKey: s.issueKey, ok: true, knobs: res.knobs, note: "Applied to both sandboxes." } : { issueKey: s.issueKey, ok: false, error: res.error };
}

// The agent prompt only calls this after the user said yes in chat; that user is the approver.
export async function rovoFileBug(payload: Payload, context?: InvocationContext) {
  const s = await session(payload);
  if (!s.id) return s;
  const approver = context?.principal?.accountId;
  const res = await actions.fileBug(s.id, String(payload.scenarioId ?? ""), approver);
  return res.ok ? { issueKey: s.issueKey, created: true, bug: res.key, url: res.url } : { issueKey: s.issueKey, created: false, error: res.error };
}
