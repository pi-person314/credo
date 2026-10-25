import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_HEADER } from "@pr-agent/contracts";
import { signSessionToken } from "@pr-agent/contracts/token";
import { config } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";
import { buildServer } from "../src/server.js";

const artifactsDir = mkdtempSync(join(tmpdir(), "art-"));
mkdirSync(join(artifactsDir, "ses_1", "sc_a", "base-1"), { recursive: true });
writeFileSync(join(artifactsDir, "ses_1", "sc_a", "base-1", "db.json"), '{"charges":[]}');
writeFileSync(join(artifactsDir, "secret.txt"), "nope");

const rt = createRuntime({ cfg: { ...config, token: "t0k", artifactsDir, publicUrl: "https://runner.example" }, sink: { emit: async () => undefined } });
const app = buildServer(rt, { logger: false });
const t = signSessionToken("t0k", "ses_1");

describe("browser routes", () => {
  it("serves the view only with a valid token for that session", async () => {
    const res = await app.inject(`/view/ses_1?t=${t}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect((await app.inject(`/view/ses_2?t=${t}`)).statusCode).toBe(403);
    expect((await app.inject("/view/ses_1")).statusCode).toBe(403);
  });
  it("hands Forge a signed view URL", async () => {
    const res = await app.inject({ url: "/sessions/ses_1/view-url", headers: { [TOKEN_HEADER]: "t0k" } });
    expect(res.json().url).toMatch(/^https:\/\/runner\.example\/view\/ses_1\?t=\d+\./);
  });
  it("serves artifacts inside the session folder only", async () => {
    const ok = await app.inject(`/artifacts/ses_1/sc_a/base-1/db.json?t=${t}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toMatch(/json/);
    expect((await app.inject(`/artifacts/ses_1/..%2Fsecret.txt?t=${t}`)).statusCode).toBe(404);
    expect((await app.inject(`/artifacts/ses_1/sc_a/base-1/db.json`)).statusCode).toBe(403);
  });
  it("preview needs the token segment and a healthy sandbox", async () => {
    expect((await app.inject(`/preview/ses_1/base/bad/cart`)).statusCode).toBe(403);
    expect((await app.inject(`/preview/ses_1/base/${t}/cart`)).statusCode).toBe(503);
  });
  it("state works for an unknown session", async () => {
    const res = await app.inject(`/view/ses_1/state?t=${t}`);
    expect(res.json()).toMatchObject({ status: "UNKNOWN", sandboxes: { base: "down", head: "down" }, quickActions: false, idleTtlMin: config.idleTtlMin });
  });
  it("the page has both modes, the first action and no unescaped boot data", async () => {
    const html = (await app.inject(`/view/ses_1?t=${t}`)).body;
    for (const s of ["Agent's browser", "Try it yourself", 'id="race"', "Timeline", "Take over", "prefers-color-scheme", 'id="narrate" aria-pressed="false"', "CredoNarration"]) expect(html).toContain(s);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe("take over", () => {
  it("needs a token and a known session, and validates input", async () => {
    expect((await app.inject({ method: "POST", url: `/view/ses_1/input`, payload: { env: "base", action: "click" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/view/ses_1/input?t=${t}`, payload: { env: "base", action: "click" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/view/ses_1/input?t=${t}`, payload: { env: "x", action: "click" } })).statusCode).toBe(400);
  });
});

describe("quick actions route", () => {
  it("needs a token and a known session, and validates input", async () => {
    expect((await app.inject({ method: "POST", url: `/view/ses_1/action`, payload: { env: "both", action: "race" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/view/ses_1/action?t=${t}`, payload: { env: "both", action: "nope" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/view/ses_1/action?t=${t}`, payload: { env: "both", action: "race" } })).statusCode).toBe(404);
  });
});

describe("page script", () => {
  it("parses as JavaScript", async () => {
    const html = (await app.inject(`/view/ses_1?t=${t}`)).body;
    const js = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
    expect(() => new Function(js)).not.toThrow();
  });
});

describe("replay", () => {
  it("needs a token and returns empty recordings for an unknown scenario", async () => {
    expect((await app.inject(`/view/ses_1/replay/sc_a`)).statusCode).toBe(403);
    expect((await app.inject(`/view/ses_1/replay/sc_a?t=${t}`)).json()).toEqual({ scenarioId: "sc_a", base: [], head: [] });
  });
});

describe("favicon", () => {
  it("answers without a token", async () => {
    expect((await app.inject("/favicon.ico")).statusCode).toBe(204);
  });
});
