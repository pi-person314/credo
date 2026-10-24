import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AppManifest, Scenario } from "@pr-agent/contracts";
import { toPlaywrightSpec } from "../src/export/playwright.js";

const manifest = AppManifest.parse(JSON.parse(readFileSync(new URL("../../demo-app/manifest.json", import.meta.url), "utf8")));
const scenarios = (JSON.parse(readFileSync(new URL("../../mocks/fixtures/scenarios.json", import.meta.url), "utf8")) as unknown[]).map((s) => Scenario.parse(s));

describe("toPlaywrightSpec", () => {
  it("writes seed, knobs, parallel calls with refs, and the row-count check", () => {
    const spec = toPlaywrightSpec(scenarios.find((s) => s.id === "sc_concurrent_retry")!, manifest);
    expect(spec).toContain('fixture: "cart_one_item"');
    expect(spec).toContain('{"mode":"slow","latencyMs":800}');
    expect(spec).toContain('Array.from({ length: 5 }, () => call(request, "POST", "/api/pay", { data: { "orderId": ref("order", "id") } }))');
    expect(spec).toContain('expect((await db(request, "charges", { "orderId": ref("order", "id") })).count, "a1").toBe(1);');
    expect(spec).not.toContain("page");
  });
  it("maps manifest selector names for UI steps", () => {
    const spec = toPlaywrightSpec(scenarios.find((s) => s.id === "sc_double_click_pay")!, manifest);
    expect(spec).toContain('await page.locator("[data-test=pay]").first().dblclick();');
    expect(spec).toContain('toContainText("paid"');
  });
});
