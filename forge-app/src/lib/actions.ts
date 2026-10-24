import { randomUUID } from "node:crypto";
import {
  AskRequest,
  Knobs,
  SessionDetail,
  viewPath,
  type Ask,
  type AuditEntry,
  type Context,
  type Diff,
  type Event,
  type Report,
  type Run,
  type Scenario,
  type Session,
} from "../contracts/index";
import { signSessionToken } from "../contracts/token";
import { runner } from "./runner";
import {
  appendAudit,
  appendEvents,
  getAsks,
  getAudit,
  getContext,
  getDiffs,
  getReport,
  getRuns,
  getSandbox,
  getScenarios,
  getSession,
  readEvents,
  sessionForIssue,
  updateSandbox,
  upsertAsks,
  type SandboxStatus,
} from "./store";

// Plain functions behind the panel resolvers and the Rovo actions, so both behave the same.
// They return { ok: false, error } instead of throwing, so callers can show the reason.

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

/** SessionDetail plus Forge-only extras the panel shows before the first report. */
export type SessionView = SessionDetail & { sandbox: SandboxStatus; criteria: string[] };

// ---------- hooks the publish module plugs in ----------

export type BugInput = { session: Session; scenario: Scenario; diff: Diff; runs: Run[]; context?: Context; approvedBy: string };
export type BugHook = (input: BugInput) => Promise<{ key: string; url?: string }>;
export type TransitionInput = { session: Session; report?: Report; context?: Context; approvedBy: string };
export type TransitionHook = (input: TransitionInput) => Promise<{ to?: string } | void>;

let bugHook: BugHook | undefined;
let transitionHook: TransitionHook | undefined;

/** Creates the linked Jira Bug. Audit and events are handled here, not in the hook. */
export const registerBugHook = (fn: BugHook) => void (bugHook = fn);
/** Moves the issue back to In Progress. Audit and events are handled here, not in the hook. */
export const registerTransitionHook = (fn: TransitionHook) => void (transitionHook = fn);

// ---------- helpers ----------

export async function recordAudit(session: Session, entry: Omit<AuditEntry, "ts" | "sessionId">) {
  await appendAudit(session.issueKey, { ts: new Date().toISOString(), sessionId: session.id, ...entry });
}

export async function emit(sessionId: string, type: Event["type"], status: Event["status"], message: string, data?: unknown) {
  const actor = type === "ask.received" ? "reviewer" : "agent";
  await appendEvents(sessionId, [{ sessionId, ts: new Date().toISOString(), actor, type, status, message, data }]);
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function withSession<T>(sessionId: string, fn: (s: Session) => Promise<Result<T>>): Promise<Result<T>> {
  const session = await getSession(sessionId);
  return session ? fn(session) : fail(`no session ${sessionId}`);
}

// ---------- reads ----------

export async function loadDetail(sessionId: string): Promise<SessionView | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const [context, scenarios, runs, diffs, asks, report, audit, sandbox] = await Promise.all([
    getContext(sessionId),
    getScenarios(sessionId),
    getRuns(sessionId),
    getDiffs(sessionId),
    getAsks(sessionId),
    getReport(sessionId),
    getAudit(session.issueKey),
    getSandbox(sessionId),
  ]);
  const raw = { session, findings: context?.findings ?? [], scenarios, runs, diffs, asks, report, audit };
  const parsed = SessionDetail.safeParse(raw);
  if (!parsed.success) console.warn(`SessionDetail ${sessionId} off-schema: ${parsed.error.issues[0]?.path.join(".")}`);
  const detail = parsed.success ? parsed.data : (raw as SessionDetail);
  return { ...detail, sandbox, criteria: context?.jira?.acceptanceCriteria ?? [] };
}

export async function detailForIssue(issueKey: string) {
  const session = await sessionForIssue(issueKey);
  return session ? loadDetail(session.id) : null;
}

export const listEvents = (sessionId: string, after?: number | string) => readEvents(sessionId, after);

/** Signed live view URL. The secret stays in Forge; the browser only gets the token. */
export async function viewUrl(sessionId: string): Promise<Result<{ url: string }>> {
  const base = process.env.RUNNER_URL;
  const secret = process.env.RUNNER_TOKEN;
  if (!base || !secret) return fail("RUNNER_URL / RUNNER_TOKEN not set");
  return withSession(sessionId, async (s) => ({ ok: true, url: `${base.replace(/\/$/, "")}${viewPath(s.id, signSessionToken(secret, s.id))}` }));
}

// ---------- sandbox controls ----------

export async function askTest(sessionId: string, prompt: unknown): Promise<Result<{ ask: Ask }>> {
  const req = AskRequest.safeParse({ prompt: typeof prompt === "string" ? prompt.trim() : prompt });
  if (!req.success) return fail("prompt must be 1-500 characters");
  return withSession(sessionId, async (s) => {
    const ask: Ask = { id: `ask_${randomUUID().slice(0, 8)}`, sessionId: s.id, prompt: req.data.prompt, createdAt: new Date().toISOString() };
    await upsertAsks(s.id, [ask]);
    await emit(s.id, "ask.received", "start", `Ask: ${ask.prompt}`, { askId: ask.id });
    try {
      await runner.ask(s.id, ask.id, ask.prompt);
      return { ok: true, ask };
    } catch (err) {
      await emit(s.id, "ask.received", "fail", `Runner rejected the ask: ${errText(err)}`, { askId: ask.id });
      return fail(errText(err));
    }
  });
}

export async function setKnobs(sessionId: string, input: { provider?: unknown; latencyMs?: unknown }): Promise<Result<{ knobs: Knobs }>> {
  const knobs = Knobs.safeParse({ provider: input.provider, latencyMs: input.latencyMs == null ? 0 : Number(input.latencyMs) });
  if (!knobs.success) return fail("provider must be ok, slow, timeout or error; latencyMs 0-30000");
  return withSession(sessionId, async (s) => {
    try {
      await runner.knobs(s.id, knobs.data);
      await updateSandbox(s.id, { knobs: knobs.data }); // knobs.set event confirms it too
      return { ok: true, knobs: knobs.data };
    } catch (err) {
      return fail(errText(err));
    }
  });
}

export async function resetSandboxes(sessionId: string): Promise<Result> {
  return withSession(sessionId, async (s) => {
    try {
      await runner.reset(s.id);
      return { ok: true };
    } catch (err) {
      return fail(errText(err));
    }
  });
}

// ---------- guarded writes (a human click or a confirmed Rovo request) ----------

export async function fileBug(sessionId: string, scenarioId: string, approvedBy: string | undefined): Promise<Result<{ key: string; url?: string }>> {
  if (!approvedBy) return fail("filing a Bug needs a human approver");
  return withSession(sessionId, async (session) => {
    const [scenarios, diffs, runs, audit] = await Promise.all([getScenarios(session.id), getDiffs(session.id), getRuns(session.id), getAudit(session.issueKey)]);
    const scenario = scenarios.find((s) => s.id === scenarioId);
    const diff = diffs.find((d) => d.scenarioId === scenarioId);
    if (!scenario || !diff) return fail(`no result for scenario ${scenarioId}`);
    if (diff.head !== "FAIL") return fail(`${scenarioId} does not fail on the PR (${diff.classification})`);
    // Double click / repeated Rovo confirm: return the Bug already filed.
    const prior = audit.find((a) => a.action === "jira.bug" && a.result === "ok" && (a.inputs as { scenarioId?: string })?.scenarioId === scenarioId);
    if (prior) return { ok: true, key: prior.target };
    if (!bugHook) return fail("Bug filing is not wired yet");

    const inputs = { scenarioId, classification: diff.classification };
    try {
      const bug = await bugHook({ session, scenario, diff, runs: runs.filter((r) => r.scenarioId === scenarioId), context: await getContext(session.id), approvedBy });
      await recordAudit(session, { action: "jira.bug", target: bug.key, approvedBy, inputs: { ...inputs, url: bug.url }, reason: `${diff.classification}: ${scenario.objective}`, result: "ok" });
      await emit(session.id, "bug.filed", "ok", `Filed ${bug.key} for ${scenarioId}`, { scenarioId, ...bug });
      return { ok: true, ...bug };
    } catch (err) {
      await recordAudit(session, { action: "jira.bug", target: session.issueKey, approvedBy, inputs, reason: errText(err), result: "failed" });
      await emit(session.id, "bug.filed", "fail", `Bug for ${scenarioId} failed: ${errText(err)}`, { scenarioId });
      return fail(errText(err));
    }
  });
}

export async function approveTransition(sessionId: string, approvedBy: string | undefined): Promise<Result<{ to?: string }>> {
  if (!approvedBy) return fail("moving the issue needs a human approver");
  return withSession(sessionId, async (session) => {
    const report = await getReport(session.id);
    if (report?.recommendation !== "BLOCKING_REGRESSION") return fail("only proposed when a regression blocks the PR");
    if (!transitionHook) return fail("transitions are not wired yet");
    try {
      const out = (await transitionHook({ session, report, context: await getContext(session.id), approvedBy })) ?? {};
      await recordAudit(session, { action: "jira.transition", target: session.issueKey, approvedBy, inputs: out, reason: "Confirmed regression; moved back for a fix", result: "ok" });
      await emit(session.id, "transition.approved", "ok", `Moved ${session.issueKey}${out.to ? ` to ${out.to}` : ""}`, out);
      return { ok: true, ...out };
    } catch (err) {
      await recordAudit(session, { action: "jira.transition", target: session.issueKey, approvedBy, reason: errText(err), result: "failed" });
      await emit(session.id, "transition.approved", "fail", `Transition failed: ${errText(err)}`);
      return fail(errText(err));
    }
  });
}
