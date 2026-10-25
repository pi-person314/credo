import { describe, expect, it } from "vitest";
import type { AppManifest, Env, Knobs } from "@pr-agent/contracts";
import { QuickActions, RACE_KNOBS, hasQuickActions, withRaceKnobs } from "../src/view/actions.js";

const manifest: AppManifest = {
  api: ["POST /api/orders", "POST /api/pay", "GET /api/orders/:id"],
  pages: ["/cart", "/checkout", "/orders/:id"],
  selectors: {},
  fixtures: ["cart_one_item"],
  tables: ["orders", "charges"],
  providerModes: ["ok", "slow", "timeout", "error"],
};
const knobs: Knobs = { provider: "slow", latencyMs: 800 };

/** A fake checkout app per side: "head" has the bug (every pay charges), "base" charges once. */
function fakeApp() {
  const calls: string[] = [];
  const db: Record<Env, { orders: number; charges: { orderId: string }[] }> = { base: { orders: 0, charges: [] }, head: { orders: 0, charges: [] } };
  const hooks = {
    seed: async (_id: string, env: Env, fixture: string) => {
      calls.push(`${env} seed ${fixture}`);
      db[env] = { orders: 0, charges: [] };
    },
    setKnobs: async (_id: string, env: Env, k: Knobs) => void calls.push(`${env} knobs ${k.provider}`),
    request: async (_id: string, env: Env, method: string, path: string, body?: unknown) => {
      calls.push(`${env} ${method} ${path}`);
      if (method === "POST" && path === "/api/orders") return { status: 201, body: { id: ++db[env].orders } };
      if (method === "POST" && path === "/api/pay") {
        const orderId = String((body as { orderId: string }).orderId);
        if (env === "head" || !db[env].charges.some((c) => c.orderId === orderId)) db[env].charges.push({ orderId });
        return { status: 200, body: {} };
      }
      if (method === "GET" && path.startsWith("/api/orders/")) return { status: 200, body: { id: 1, status: "paid" } };
      return { status: 404, body: {} };
    },
    db: async (_id: string, env: Env, _table: string, where: Record<string, unknown> = {}) => {
      const rows = db[env].charges.filter((c) => c.orderId === String(where.orderId));
      return { table: "charges", count: rows.length, rows };
    },
  };
  return { hooks, calls };
}

describe("quick actions", () => {
  it("only exist for apps with the order/pay API and a charges table", () => {
    expect(hasQuickActions(manifest)).toBe(true);
    expect(hasQuickActions({ ...manifest, tables: ["orders"] })).toBe(false);
    expect(hasQuickActions(undefined)).toBe(false);
  });

  it("pay twice shows the double charge on the PR side only", async () => {
    const { hooks } = fakeApp();
    const qa = new QuickActions(hooks as never);
    const [b, h] = await Promise.all([qa.run("s", "base", "race", manifest, knobs), qa.run("s", "head", "race", manifest, knobs)]);
    expect(b).toMatchObject({ env: "base", orderId: "1", status: "paid", charges: 1, pays: [200, 200], page: "/orders/1" });
    expect(h).toMatchObject({ env: "head", charges: 2 });
  });

  it("a fresh order reseeds and puts the knobs back; pay reuses the last order", async () => {
    const { hooks, calls } = fakeApp();
    const qa = new QuickActions(hooks as never);
    const o = await qa.run("s", "head", "order", manifest, knobs);
    expect(o).toMatchObject({ orderId: "1", charges: 0, pays: [] });
    expect(calls.slice(0, 3)).toEqual(["head seed cart_one_item", "head knobs slow", "head POST /api/orders"]);
    calls.length = 0;
    const p = await qa.run("s", "head", "pay", manifest, knobs);
    expect(p).toMatchObject({ orderId: "1", charges: 1, pays: [200] });
    expect(calls).not.toContain("head POST /api/orders");
    qa.forget("s");
    expect((await qa.run("s", "head", "pay", manifest, knobs)).orderId).toBe("1");
    expect(calls).toContain("head POST /api/orders");
  });

  it("reports a failure instead of throwing", async () => {
    const { hooks } = fakeApp();
    const qa = new QuickActions({ ...hooks, request: async () => ({ status: 500, body: "boom" }) } as never);
    const r = await qa.run("s", "base", "pay", manifest, knobs);
    expect(r.error).toMatch(/POST \/api\/orders -> 500/);
  });

  it("pay twice on both runs on slow knobs, then puts the reviewer's knobs back", async () => {
    const set: Knobs[] = [];
    const before: Knobs = { provider: "error", latencyMs: 0 };
    const seen = await withRaceKnobs(async (k) => void set.push(k), before, async (k) => k);
    expect(seen).toEqual(RACE_KNOBS);
    expect(set).toEqual([RACE_KNOBS, before]);
  });

  it("restores the knobs even when the race fails, and skips the restore when nothing changed", async () => {
    const set: Knobs[] = [];
    const before: Knobs = { provider: "ok", latencyMs: 0 };
    await expect(withRaceKnobs(async (k) => void set.push(k), before, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(set).toEqual([RACE_KNOBS, before]);
    set.length = 0;
    await withRaceKnobs(async (k) => void set.push(k), { ...RACE_KNOBS }, async () => 1);
    expect(set).toEqual([RACE_KNOBS]);
  });
});
