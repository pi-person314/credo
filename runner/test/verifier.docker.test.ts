import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppManifest, Scenario, type Event } from "@pr-agent/contracts";
import { config } from "../src/config.js";
import { emitter } from "../src/events.js";
import { AgentBrowser } from "../src/executor/browser.js";
import { Executor } from "../src/executor/executor.js";
import { SandboxManager } from "../src/sandbox/manager.js";
import { Verifier } from "../src/verifier/verifier.js";

// DOCKER_TESTS=1: the fixture scenarios on checkout-demo main vs PR #1 (never merge or fix that PR).
const REPO = process.env.DEMO_REPO ?? "pi-person314/checkout-demo";
const BASE = process.env.DEMO_BASE_SHA ?? "a2e141557298278c0d0c7eb9c7dcf4ed16cded9f";
const HEAD = process.env.DEMO_HEAD_SHA ?? "57be545cef3967229f10007f2ec4cfdbf3238eef";
const root = new URL("../../", import.meta.url).pathname;
const manifest = AppManifest.parse(JSON.parse(readFileSync(join(root, "demo-app/manifest.json"), "utf8")));
const scenarios = (JSON.parse(readFileSync(join(root, "mocks/fixtures/scenarios.json"), "utf8")) as unknown[]).map((s) => Scenario.parse(s));

describe.skipIf(!process.env.DOCKER_TESTS)("executor + verifier (docker)", () => {
  const workDir = mkdtempSync(join(tmpdir(), "runner-"));
  const cfg = { ...config, workDir, artifactsDir: join(workDir, "artifacts"), networkMode: "host" as const };
  const mgr = new SandboxManager(cfg);
  const browser = new AgentBrowser();
  const events: Event[] = [];
  const id = `test_${Date.now()}`;
  const verifier = new Verifier(
    new Executor({ sandboxes: mgr, browser, artifactsDir: cfg.artifactsDir }),
    emitter({ emit: async (e) => void events.push(e) }, id),
  );

  beforeAll(async () => {
    const sbs = await mgr.upBoth(id, { base: { repo: REPO, sha: BASE }, head: { repo: REPO, sha: HEAD, prNumber: 1 } });
    expect([sbs.base.state, sbs.head.state], sbs.base.error ?? sbs.head.error).toEqual(["healthy", "healthy"]);
  }, 400_000);
  afterAll(async () => {
    await browser.close();
    await mgr.teardown(id);
  }, 60_000);

  it.each([
    ["sc_single_pay", "UNCHANGED_PASS"],
    ["sc_concurrent_retry", "NEW_REGRESSION"],
    ["sc_double_click_pay", "NEW_REGRESSION"],
  ])("%s -> %s", async (scenarioId, want) => {
    const scenario = scenarios.find((s) => s.id === scenarioId)!;
    const { diff, runs } = await verifier.verify({ sessionId: id, scenario, manifest });
    expect(diff.classification, JSON.stringify(runs.map((r) => [r.env, r.status, r.assertions]))).toBe(want);
    expect(runs[0]!.artifacts.map((a) => a.kind)).toEqual(expect.arrayContaining(["log", "db"]));
    if (want === "NEW_REGRESSION") expect(runs.filter((r) => r.env === "head")).toHaveLength(3);
  }, 120_000);

  it("emitted run and diff events", () => {
    const types = new Set(events.map((e) => e.type));
    for (const t of ["run.started", "run.assertion", "run.finished", "verify.rerun", "verify.diff"]) expect(types).toContain(t);
  });
});
