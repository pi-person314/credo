import { Scenario, type AppManifest, type Assertion, type Origin, type ProviderMode, type Step } from "@pr-agent/contracts";

export interface Validated {
  scenarios: Scenario[];
  errors: string[];
  /** Honesty problems (a success criterion mapped to a scenario that can't show success): worth one retry. */
  coverageErrors: string[];
}

/** The one test hook a scenario may call: switch the fake provider mid-scenario (e.g. error -> ok before a retry). */
export const PROVIDER_HOOK = "/__test/provider";

/** Criteria phrased as "X succeeds / works / completes" need a scenario that ends in success. */
export const SUCCESS_AC = /\b(succeed(s|ed)?|success(ful(ly)?)?|works?|working|complete[sd]?)\b/i;
const FAILURE_VALUE = /fail|error|declin|timeout|timed.?out|cancel|reject|denied|unpaid|pending/i;

/** An assertion that something good happened (2xx, a success status, a row exists), not just that nothing bad did. */
export function isPositive(a: Assertion): boolean {
  switch (a.type) {
    case "http_status":
      return a.equals >= 200 && a.equals < 300;
    case "db_count":
      return a.equals >= 1;
    case "json_path":
      return a.equals === true || (typeof a.equals === "string" && a.equals !== "" && !FAILURE_VALUE.test(a.equals));
    case "ui_text":
      return a.contains !== "" && !FAILURE_VALUE.test(a.contains);
  }
}

/** Provider modes over the scenario: the knobs, then each POST /__test/provider step (with its step index). */
function providerSwitches(s: Scenario): { modes: ProviderMode[]; lastSwitch: number } {
  const modes: ProviderMode[] = [s.knobs?.provider ?? "ok"];
  let lastSwitch = -1;
  s.steps.forEach((st, i) => {
    const body = st.op === "http" && st.path === PROVIDER_HOOK ? (st.body as { mode?: ProviderMode } | undefined) : undefined;
    if (body?.mode) {
      modes.push(body.mode);
      lastSwitch = i;
    }
  });
  return { modes, lastSwitch };
}

/** Criteria about recovering from a failure ("retries after a provider error succeed") need the failure to happen. */
const RECOVERY_AC = /\b(error|errors|timeout|times? ?out|timed.?out|retr(y|ies|ied)|fail(s|ed|ure)?)\b/i;
const FAILING: ProviderMode[] = ["error", "timeout"];

/**
 * Why scenario s can't verify success criterion ac, or undefined when it can. A positive http_status/json_path only
 * counts when its ref was saved after the last provider switch; db_count and ui_text are end-state checks.
 */
function successGap(s: Scenario, ac: string): string | undefined {
  if (!s.assertions.some(isPositive)) {
    return "only asserts failure behavior; add a positive end state (e.g. retry http_status 200, GET /api/orders/$order.id status \"paid\", exactly 1 charge)";
  }
  const { modes, lastSwitch } = providerSwitches(s);
  const mode = modes[modes.length - 1]!;
  if (FAILING.includes(mode)) {
    return `provider is still "${mode}" at the end, so nothing can succeed; add {"op":"http","method":"POST","path":"${PROVIDER_HOOK}","body":{"mode":"ok","latencyMs":0}} before the retry`;
  }
  const savedAfter = new Set(
    s.steps.flatMap((st, i) => (i <= lastSwitch ? [] : st.op === "http" ? [st.saveAs] : st.op === "parallel" ? [st.step.saveAs] : [])).filter(Boolean),
  );
  const proves = s.assertions.some(
    (a) => isPositive(a) && (a.type === "db_count" || a.type === "ui_text" || savedAfter.has(a.ref)),
  );
  if (!proves) return `its success checks only cover steps before the provider switched back to "${mode}"; assert on a step saved after it (e.g. the retry)`;
  if (RECOVERY_AC.test(ac) && !modes.some((m) => FAILING.includes(m))) {
    return `the criterion is about recovering from a failure but the provider never errors or times out; set knobs.provider to "error" (or "timeout") and switch it back with ${PROVIDER_HOOK} before the retry`;
  }
  return undefined;
}

/** "POST /api/orders/:id" -> matcher for method + concrete path ("$refs" count as one segment). */
function routeMatchers(routes: string[]) {
  return routes.map((r) => {
    const [method, path] = r.split(" ") as [string, string];
    const re = new RegExp(`^${path.replace(/:[^/]+/g, "[^/]+").replace(/\//g, "\\/")}(\\?.*)?$`);
    return (m: string, p: string) => (method === m || method === undefined) && re.test(p);
  });
}

/**
 * Parses planner output against the Scenario schema and the app manifest. Bad scenarios are dropped with a
 * reason (fed back to the planner on retry); good ones get the origin forced, unique ids, and a priority order.
 */
export function validateScenarios(
  raw: unknown,
  manifest: AppManifest,
  opts: { origin: Origin; max: number; takenIds: string[]; acceptanceCriteria?: string[] },
): Validated {
  const errors: string[] = [];
  const coverageErrors: string[] = [];
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { scenarios?: unknown }).scenarios) ? (raw as { scenarios: unknown[] }).scenarios : [raw];
  const api = routeMatchers(manifest.api);
  const pages = routeMatchers(manifest.pages.map((p) => `GET ${p}`));
  const taken = new Set(opts.takenIds);
  const out: Scenario[] = [];

  for (const [i, item] of list.entries()) {
    const withOrigin = item && typeof item === "object" ? { ...(item as object), origin: opts.origin } : item;
    const parsed = Scenario.safeParse(withOrigin);
    const label = (item as { id?: string })?.id ?? `#${i + 1}`;
    if (!parsed.success) {
      errors.push(`${label}: ${parsed.error.issues.slice(0, 3).map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
      continue;
    }
    const s = parsed.data;
    const problems: string[] = [];
    if (!manifest.fixtures.includes(s.fixture)) problems.push(`unknown fixture "${s.fixture}" (use ${manifest.fixtures.join(", ")})`);
    if (s.knobs && !manifest.providerModes.includes(s.knobs.provider)) problems.push(`unknown provider mode "${s.knobs.provider}"`);
    for (const st of s.steps) {
      if (st.op === "parallel" && st.step.path === PROVIDER_HOOK) problems.push(`${st.step.path}: test hooks can't run in parallel`);
      if (st.op !== "http" || st.path !== PROVIDER_HOOK) continue;
      const body = (st.body ?? {}) as { mode?: unknown; latencyMs?: unknown };
      if (st.method !== "POST") problems.push(`${PROVIDER_HOOK} takes POST`);
      if (!manifest.providerModes.includes(body.mode as ProviderMode)) problems.push(`${PROVIDER_HOOK}: body.mode must be one of ${manifest.providerModes.join(", ")}`);
      const ms = body.latencyMs ?? 0;
      if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 0 || ms > 30_000) problems.push(`${PROVIDER_HOOK}: body.latencyMs must be 0-30000`);
    }
    const steps = s.steps.flatMap((st): Step[] => (st.op === "parallel" ? [st, st.step] : [st]));
    const saved = new Set<string>();
    for (const st of steps) {
      if (st.op === "http") {
        if (st.path === PROVIDER_HOOK) {
          // Checked above; it's a sandbox hook, not an app route.
        } else if (st.path.startsWith("/__test")) problems.push(`${st.path}: test hooks are off limits (only POST ${PROVIDER_HOOK})`);
        else if (!api.some((m) => m(st.method, st.path.replace(/\$[\w.]+/g, "x")))) problems.push(`${st.method} ${st.path} is not in the manifest api`);
        if (st.saveAs) saved.add(st.saveAs);
      }
      if (st.op === "ui" && st.action === "goto" && !pages.some((m) => m("GET", st.target.replace(/\$[\w.]+/g, "x")))) {
        problems.push(`goto ${st.target} is not a manifest page`);
      }
    }
    for (const a of s.assertions) {
      if (a.type === "db_count" && !manifest.tables.includes(a.table)) problems.push(`${a.id}: unknown table "${a.table}"`);
      if ((a.type === "http_status" || a.type === "json_path") && !saved.has(a.ref)) problems.push(`${a.id}: ref "${a.ref}" is not a saveAs name`);
    }
    if (problems.length) {
      errors.push(`${s.id}: ${problems.join("; ")}`);
      continue;
    }
    // A success criterion only counts as covered by a scenario that can show success: drop the ref otherwise.
    const acs = opts.acceptanceCriteria ?? [];
    const dropped: string[] = [];
    for (const r of s.sourceRefs) {
      const n = Number(r.match(/^jira:[^#]+#ac(\d+)$/)?.[1] ?? 0);
      const ac = acs[n - 1] ?? "";
      if (n <= 0 || !SUCCESS_AC.test(ac)) continue;
      const gap = successGap(s, ac);
      if (!gap) continue;
      dropped.push(r);
      coverageErrors.push(`${s.id}: mapped to ${r} (a success criterion) but ${gap}`);
    }
    let id = s.id;
    for (let n = 2; taken.has(id); n++) id = `${s.id}_${n}`;
    taken.add(id);
    out.push({ ...s, id, sourceRefs: s.sourceRefs.filter((r) => !dropped.includes(r)) });
  }

  const order = { P0: 0, P1: 1, P2: 2 } as const;
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  if (out.length > opts.max) errors.push(`only the first ${opts.max} scenarios are kept`);
  return { scenarios: out.slice(0, opts.max), errors: [...errors, ...coverageErrors], coverageErrors };
}
