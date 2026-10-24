import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Scenario, acRef, type AppManifest } from "@pr-agent/contracts";

const FIXTURES = fileURLToPath(new URL("../../../mocks/fixtures/scenarios.json", import.meta.url));

/** Points "jira:PAY-5#acN" refs at the session's issue. */
const retarget = (s: Scenario, issueKey: string): Scenario => ({
  ...s,
  sourceRefs: s.sourceRefs.map((r) => r.replace(/^jira:[A-Z][A-Z0-9]+-\d+#/, `jira:${issueKey}#`)),
});

/** The canned scenarios in mocks/fixtures/scenarios.json, used when the planner is down or writes nothing valid. */
export function cannedScenarios(issueKey: string, manifest: AppManifest, file = FIXTURES): Scenario[] {
  if (!existsSync(file)) return [];
  const list = (JSON.parse(readFileSync(file, "utf8")) as unknown[]).map((s) => Scenario.parse(s));
  return list
    .filter((s) => manifest.fixtures.includes(s.fixture))
    .map((s) => ({ ...retarget(s, issueKey), rationale: `${s.rationale} (canned: planner unavailable)` }));
}

const order = (saveAs = "order") => ({ op: "http" as const, method: "POST" as const, path: "/api/orders", saveAs });
const pay = (saveAs?: string) => ({ op: "http" as const, method: "POST" as const, path: "/api/pay", body: { orderId: "$order.id" }, ...(saveAs ? { saveAs } : {}) });
const charges = (id: string, equals: number) => ({ id, type: "db_count" as const, table: "charges", where: { orderId: "$order.id" }, equals });

/**
 * Keyword templates for a reviewer's ask when the planner is down. Written for the checkout manifest
 * (orders / pay / charges); returns undefined for other apps.
 */
export function templateAsk(prompt: string, issueKey: string, manifest: AppManifest, n: number): Scenario | undefined {
  if (!manifest.api.includes("POST /api/pay") || !manifest.tables.includes("charges")) return undefined;
  const p = prompt.toLowerCase();
  const id = (slug: string) => `sc_ask_${n}_${slug}`;
  const base = { origin: "ask" as const, priority: "P0" as const, fixture: manifest.fixtures[0]!, objective: prompt, rationale: `Reviewer asked: "${prompt}" (template: planner unavailable)` };

  if (/times? ?out|timed out|hang/.test(p)) {
    return {
      ...base,
      id: id("timeout_retry"),
      knobs: { provider: "timeout", latencyMs: 0 },
      steps: [order(), pay("first"), { op: "wait", ms: 2000 }, pay("retry")],
      assertions: [charges("a1", 0), { id: "a2", type: "http_status", ref: "retry", equals: 504 }],
      sourceRefs: [acRef(issueKey, 3), acRef(issueKey, 1)],
    };
  }
  if (/error|500|fail|declin/.test(p)) {
    return {
      ...base,
      id: id("error_no_charge"),
      knobs: { provider: "error", latencyMs: 0 },
      steps: [order(), pay("first")],
      assertions: [charges("a1", 0), { id: "a2", type: "http_status", ref: "first", equals: 502 }],
      sourceRefs: [acRef(issueKey, 2)],
    };
  }
  if (/double|click|button|ui|browser/.test(p) && manifest.selectors.payButton) {
    return {
      ...base,
      id: id("double_click"),
      knobs: { provider: "slow", latencyMs: 800 },
      steps: [
        { op: "ui", action: "goto", target: "/checkout" },
        { op: "ui", action: "dblclick", target: "payButton" },
        { op: "wait", ms: 1500 },
      ],
      assertions: [{ id: "a1", type: "ui_text", selector: "status", contains: "paid" }, { id: "a2", type: "db_count", table: "charges", where: {}, equals: 1 }],
      sourceRefs: [acRef(issueKey, 1)],
    };
  }
  const count = Number(p.match(/\b(\d{1,2})\b/)?.[1] ?? 0);
  if (/concurren|parallel|at once|same time|retr|twice|race/.test(p)) {
    return {
      ...base,
      id: id("concurrent"),
      knobs: { provider: "slow", latencyMs: 800 },
      steps: [order(), { op: "parallel", count: Math.min(20, Math.max(2, count || 5)), step: pay() }],
      assertions: [charges("a1", 1)],
      sourceRefs: [acRef(issueKey, 1)],
    };
  }
  return {
    ...base,
    id: id("single_pay"),
    steps: [order(), pay("pay")],
    assertions: [{ id: "a1", type: "http_status", ref: "pay", equals: 200 }, charges("a2", 1)],
    sourceRefs: [acRef(issueKey, 2)],
  };
}
