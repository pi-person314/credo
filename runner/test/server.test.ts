import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKEN_HEADER } from "@pr-agent/contracts";
import { config } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";
import { buildServer } from "../src/server.js";

const context = JSON.parse(readFileSync(new URL("../../mocks/fixtures/context.json", import.meta.url), "utf8"));
const off = { name: "off", available: () => false, complete: async () => "" };

function setup() {
  const rt = createRuntime({ cfg: { ...config, token: "t0k" }, sink: { emit: async () => undefined }, llm: off, log: () => undefined });
  // No Docker here: sandboxes "fail" fast so the pipeline ends in session.failed.
  rt.sandboxes.up = async () => {
    throw new Error("no docker in unit tests");
  };
  return { rt, app: buildServer(rt, { logger: false }) };
}
const h = { [TOKEN_HEADER]: "t0k" };

describe("Runner API", () => {
  it("rejects a missing or wrong token, but not /health", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "POST", url: "/sessions", payload: { context } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/sessions/x/status", headers: { [TOKEN_HEADER]: "nope" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("validates bodies", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "POST", url: "/sessions", headers: h, payload: { context: {} } })).statusCode).toBe(400);
  });

  it("starts with 202, reports status, and fails the session when sandboxes don't build", async () => {
    const { app, rt } = setup();
    const res = await app.inject({ method: "POST", url: "/sessions", headers: h, payload: { context } });
    expect(res.statusCode).toBe(202);
    await rt.orchestrator.idle("ses_demo");
    expect(rt.orchestrator.get("ses_demo").status).toBe("FAILED");
    const types = rt.memory.events("ses_demo").map((e) => e.type);
    expect(types).toEqual(["sandbox.building", "sandbox.building", "sandbox.failed", "sandbox.failed", "session.failed"]);
    const status = await app.inject({ method: "GET", url: "/sessions/ses_demo/status", headers: h });
    expect(status.json()).toEqual({ base: "down", head: "down" });
  });

  it("404s unknown sessions and 409s knobs on sandboxes that aren't up", async () => {
    const { app, rt } = setup();
    expect((await app.inject({ method: "POST", url: "/sessions/nope/ask", headers: h, payload: { askId: "a", prompt: "x" } })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: "/sessions", headers: h, payload: { context } });
    await rt.orchestrator.idle("ses_demo");
    const knobs = await app.inject({ method: "POST", url: "/sessions/ses_demo/knobs", headers: h, payload: { provider: "slow", latencyMs: 800 } });
    expect(knobs.statusCode).toBe(409);
    const del = await app.inject({ method: "DELETE", url: "/sessions/ses_demo", headers: h });
    expect(del.statusCode).toBe(200);
  });
});
