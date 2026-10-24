import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { SandboxManager } from "../src/sandbox/manager.js";

// Real Docker + the real checkout-demo repo. DOCKER_TESTS=1 pnpm --filter @pr-agent/runner test
// Base = main, head = PR #1 (removes the payment lock). Never merge or fix that PR.
const REPO = process.env.DEMO_REPO ?? "pi-person314/checkout-demo";
const BASE = process.env.DEMO_BASE_SHA ?? "a2e141557298278c0d0c7eb9c7dcf4ed16cded9f";
const HEAD = process.env.DEMO_HEAD_SHA ?? "57be545cef3967229f10007f2ec4cfdbf3238eef";

describe.skipIf(!process.env.DOCKER_TESTS)("sandbox manager (docker)", () => {
  const mgr = new SandboxManager({ ...config, workDir: mkdtempSync(join(tmpdir(), "runner-")), networkMode: "host" });
  const id = `test_${Date.now()}`;
  afterAll(() => mgr.teardown(id), 60_000);

  it("builds base and head, and the race shows 1 vs more charges", async () => {
    const sbs = await mgr.upBoth(id, { base: { repo: REPO, sha: BASE }, head: { repo: REPO, sha: HEAD, prNumber: 1 } });
    expect(sbs.base.state, sbs.base.error).toBe("healthy");
    expect(sbs.head.state, sbs.head.error).toBe("healthy");

    const charges: Record<string, number> = {};
    for (const env of ["base", "head"] as const) {
      await mgr.seed(id, env, "cart_one_item");
      await mgr.setKnobs(id, env, { provider: "slow", latencyMs: 800 });
      const order = (await mgr.request(id, env, "POST", "/api/orders", {})).body as { id: number };
      await Promise.all(Array.from({ length: 5 }, () => mgr.request(id, env, "POST", "/api/pay", { orderId: order.id })));
      charges[env] = (await mgr.db(id, env, "charges", { orderId: order.id })).count;
    }
    expect(charges.base).toBe(1);
    expect(charges.head).toBeGreaterThan(1);
    expect(mgr.status(id)).toEqual({ base: "healthy", head: "healthy" });
  }, 400_000);
});
