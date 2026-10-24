/** A saved HTTP result. `parallel` steps save an array of them. */
export interface Saved {
  status: number;
  body: unknown;
}
export type Vars = Map<string, Saved | Saved[]>;

/** "a.b[0].c", "$.a.b.0", "a.b.0" -> ["a", "b", "0", "c"] */
export function pathParts(path: string): string[] {
  return path
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
}

export function getPath(value: unknown, path: string | string[]): unknown {
  let cur = value;
  for (const p of Array.isArray(path) ? path : pathParts(path)) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** "$order.id" -> body.id of the step saved as "order". "$pays.0.status" indexes into a parallel result. */
function lookup(ref: string, vars: Vars): unknown {
  const [name, ...rest] = ref.split(".");
  const saved = vars.get(name!);
  if (saved === undefined) throw new Error(`unknown reference $${name}`);
  if (Array.isArray(saved)) {
    if (rest.length === 0) return saved.map((s) => s.body);
    const [i, ...more] = rest;
    return getPath(saved[Number(i)]?.body, more);
  }
  return getPath(saved.body, rest);
}

const WHOLE = /^\$([A-Za-z_][\w]*(?:\.[\w]+)*)$/;
const INLINE = /\$([A-Za-z_][\w]*(?:\.[\w]+)*)/g;

/** Replaces "$name.path" references anywhere in a JSON value. A whole-string reference keeps the value's type. */
export function resolveRefs<T>(value: T, vars: Vars): T {
  if (typeof value === "string") {
    const whole = value.match(WHOLE);
    if (whole) return lookup(whole[1]!, vars) as T;
    return value.replace(INLINE, (_, ref: string) => String(lookup(ref, vars))) as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, vars)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, vars)])) as T;
  }
  return value;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Loose on number vs numeric string ("1" from a query vs 1 from JSON).
  if ((typeof a === "number" && typeof b === "string") || (typeof a === "string" && typeof b === "number")) return String(a) === String(b);
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
