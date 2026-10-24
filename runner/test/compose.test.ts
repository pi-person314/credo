import { describe, expect, it } from "vitest";
import { projectName, sandboxCompose } from "../src/sandbox/compose.js";

const demo = {
  name: "checkout-demo",
  services: {
    app: { build: ".", ports: ["${APP_PORT:-3000}:3000"], environment: { ENABLE_TEST_HOOKS: "1" }, depends_on: { db: { condition: "service_healthy" } } },
    db: { image: "postgres:16-alpine", container_name: "db", volumes: ["./init.sql:/docker-entrypoint-initdb.d/init.sql", "pg:/var/lib/postgresql/data"] },
  },
  volumes: { pg: {} },
};
const opts = { appService: "app", appPort: 3000, sessionId: "ses_1", env: "base", cpus: "1", memory: "768m" } as const;

describe("sandboxCompose", () => {
  it("host mode: random loopback port for the app only, no fixed names or bind mounts", () => {
    const out = sandboxCompose(demo, { ...opts, networkMode: "host" }) as any;
    expect(out.services.app.ports).toEqual(["127.0.0.1::3000"]);
    expect(out.services.db.ports).toBeUndefined();
    expect(out.services.db.container_name).toBeUndefined();
    expect(out.services.db.volumes).toEqual(["pg:/var/lib/postgresql/data"]);
    expect(out.services.app.labels["pr-agent.sandbox"]).toBe("1");
    expect(out.services.app.mem_limit).toBe("768m");
    expect(out.networks).toBeUndefined();
    expect(out.name).toBeUndefined();
  });
  it("attach mode: no ports, internal networks", () => {
    const out = sandboxCompose(demo, { ...opts, networkMode: "attach" }) as any;
    expect(out.services.app.ports).toBeUndefined();
    expect(out.networks).toEqual({ default: { internal: true } });
  });
  it("needs the app service", () => {
    expect(() => sandboxCompose(demo, { ...opts, appService: "web", networkMode: "host" })).toThrow(/web/);
  });
  it("project names are compose-safe", () => {
    expect(projectName("ses_ABC.42/x", "head")).toBe("sb-ses_abc-42-x-head");
  });
});
