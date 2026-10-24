import { Scenario, type AppManifest, type Origin, type Step } from "@pr-agent/contracts";

export interface Validated {
  scenarios: Scenario[];
  errors: string[];
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
export function validateScenarios(raw: unknown, manifest: AppManifest, opts: { origin: Origin; max: number; takenIds: string[] }): Validated {
  const errors: string[] = [];
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
    const steps = s.steps.flatMap((st): Step[] => (st.op === "parallel" ? [st, st.step] : [st]));
    const saved = new Set<string>();
    for (const st of steps) {
      if (st.op === "http") {
        if (st.path.startsWith("/__test")) problems.push(`${st.path}: test hooks are off limits`);
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
    let id = s.id;
    for (let n = 2; taken.has(id); n++) id = `${s.id}_${n}`;
    taken.add(id);
    out.push({ ...s, id });
  }

  const order = { P0: 0, P1: 1, P2: 2 } as const;
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  if (out.length > opts.max) errors.push(`only the first ${opts.max} scenarios are kept`);
  return { scenarios: out.slice(0, opts.max), errors };
}
