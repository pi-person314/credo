import { z } from "zod";
import type { AppManifest, Env, Knobs } from "@pr-agent/contracts";
import type { SandboxManager } from "../sandbox/manager.js";

/**
 * Quick actions on the live view: the reviewer does the core demo action by hand on one or both sides
 * (fresh order, pay, pay twice at once) and sees the order status and charge count per side. They use
 * the app API from the manifest plus the sandbox test hooks, so they only exist for apps that have them.
 */
export const QuickAction = z.object({
  env: z.enum(["base", "head", "both"]),
  action: z.enum(["order", "pay", "pay_twice", "race"]),
});
export type QuickAction = z.infer<typeof QuickAction>;

/** "race" sets these knobs on both sides first, so two overlapping pays really overlap. */
export const RACE_KNOBS: Knobs = { provider: "slow", latencyMs: 800 };

/**
 * Runs `fn` with RACE_KNOBS on both sides, then puts the knobs the reviewer had back, even if `fn` fails,
 * so "Pay twice on both" does not leave the provider slow for whatever they try next.
 */
export async function withRaceKnobs<T>(set: (k: Knobs) => Promise<void>, before: Knobs, fn: (k: Knobs) => Promise<T>): Promise<T> {
  await set(RACE_KNOBS);
  try {
    return await fn(RACE_KNOBS);
  } finally {
    if (before.provider !== RACE_KNOBS.provider || before.latencyMs !== RACE_KNOBS.latencyMs) await set(before).catch(() => undefined);
  }
}

export interface SideResult {
  env: Env;
  action: QuickAction["action"];
  orderId?: string;
  status?: string;
  /** Charges for this order. */
  charges?: number;
  /** HTTP status of each POST /api/pay, in order. */
  pays: number[];
  /** App page that shows the order, for the Try it yourself preview. */
  page?: string;
  error?: string;
}

/** The newest order in one sandbox and its charges, however it was made (quick action, the app preview, take over). */
export interface LatestOrder {
  orderId: string;
  status?: string;
  charges: number;
}

/** Picks the newest order (highest numeric id, else the last row) and counts its charges. */
export function latestOrder(orders: Record<string, unknown>[] | undefined, charges: Record<string, unknown>[] | undefined): LatestOrder | undefined {
  if (!orders?.length) return undefined;
  const id = (r: Record<string, unknown>) => pick(r, "id", "orderId");
  const num = (r: Record<string, unknown>) => Number(id(r));
  const newest = orders.every((r) => Number.isFinite(num(r))) ? orders.reduce((a, b) => (num(b) > num(a) ? b : a)) : orders[orders.length - 1]!;
  const orderId = String(id(newest));
  const status = pick(newest, "status");
  return {
    orderId,
    status: status === undefined ? undefined : String(status),
    charges: (charges ?? []).filter((c) => String(pick(c, "orderId", "order_id")) === orderId).length,
  };
}

type Hooks = Pick<SandboxManager, "request" | "db" | "seed" | "setKnobs">;

export function hasQuickActions(m: AppManifest | undefined): boolean {
  return !!m && m.api.includes("POST /api/orders") && m.api.includes("POST /api/pay") && m.tables.includes("charges") && m.fixtures.length > 0;
}

const pick = (body: unknown, ...keys: string[]): unknown => {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  for (const k of keys) if (b[k] !== undefined && b[k] !== null) return b[k];
  if (b.order && typeof b.order === "object") return pick(b.order, ...keys);
  return undefined;
};

export class QuickActions {
  /** Last order made by hand, per session and side. */
  private orders = new Map<string, string>();

  constructor(private sb: Hooks) {}

  forget(sessionId: string) {
    for (const k of [...this.orders.keys()]) if (k.startsWith(`${sessionId}/`)) this.orders.delete(k);
  }

  /** Runs one action on one side. Never throws: a failure comes back as `error` so the other side still reports. */
  async run(sessionId: string, env: Env, action: QuickAction["action"], manifest: AppManifest, knobs: Knobs): Promise<SideResult> {
    const out: SideResult = { env, action, pays: [] };
    const key = `${sessionId}/${env}`;
    try {
      // Pay acts on the order the cards show: the newest one in the app, however it was made. Fallback: the last quick-action order.
      let orderId: string | undefined;
      if (action === "pay" || action === "pay_twice") {
        const orders = manifest.tables.includes("orders") ? await this.sb.db(sessionId, env, "orders").catch(() => undefined) : undefined;
        orderId = latestOrder(orders?.rows, [])?.orderId ?? this.orders.get(key);
      }
      if (!orderId) {
        // Fresh cart: seeding also resets the provider, so put the current knobs back.
        await this.sb.seed(sessionId, env, manifest.fixtures[0]!);
        await this.sb.setKnobs(sessionId, env, knobs);
        const r = await this.sb.request(sessionId, env, "POST", "/api/orders");
        const id = pick(r.body, "id", "orderId");
        if (r.status >= 400 || id === undefined) throw new Error(`POST /api/orders -> ${r.status}`);
        orderId = String(id);
        this.orders.set(key, orderId);
      }
      out.orderId = orderId;
      const times = action === "order" ? 0 : action === "pay" ? 1 : 2;
      const pay = () => this.sb.request(sessionId, env, "POST", "/api/pay", { orderId }).then((r) => r.status, () => 0);
      out.pays = await Promise.all(Array.from({ length: times }, pay));
      if (manifest.api.includes("GET /api/orders/:id")) {
        const r = await this.sb.request(sessionId, env, "GET", `/api/orders/${encodeURIComponent(orderId)}`).catch(() => undefined);
        const st = r && r.status < 400 ? pick(r.body, "status") : undefined;
        if (st !== undefined) out.status = String(st);
      }
      out.charges = (await this.sb.db(sessionId, env, "charges", { orderId })).count;
      if (manifest.pages.includes("/orders/:id")) out.page = `/orders/${encodeURIComponent(orderId)}`;
    } catch (err) {
      out.error = err instanceof Error ? err.message : String(err);
    }
    return out;
  }
}
