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
  it("drops anything that reaches past the sandbox", () => {
    const evil = {
      services: {
        app: {
          build: { context: ".", dockerfile: "Dockerfile", secrets: ["x"], additional_contexts: { root: "/" } },
          privileged: true,
          cap_add: ["SYS_ADMIN"],
          devices: ["/dev/sda"],
          pid: "host",
          network_mode: "host",
          security_opt: ["seccomp:unconfined"],
          env_file: ["/proc/self/environ"],
          cpus: "64",
          mem_limit: "64g",
          networks: ["outside"],
          volumes: ["/var/run/docker.sock:/var/run/docker.sock", { type: "bind", source: "/", target: "/host" }, { type: "volume", source: "data", target: "/d" }, "data:/x"],
          environment: { A: "1" },
        },
      },
      volumes: { data: { driver: "local", driver_opts: { type: "none", o: "bind", device: "/" } } },
      networks: { outside: { external: true, name: "host" } },
    };
    const out = sandboxCompose(evil, { ...opts, networkMode: "attach" }) as any;
    const app = out.services.app;
    for (const k of ["privileged", "cap_add", "devices", "pid", "network_mode", "security_opt", "env_file", "networks"]) expect(app[k], k).toBeUndefined();
    expect(app.build).toEqual({ context: ".", dockerfile: "Dockerfile" });
    expect(app.volumes).toEqual([{ type: "volume", source: "data", target: "/d" }, "data:/x"]);
    expect(app.cpus).toBe("1");
    expect(app.mem_limit).toBe("768m");
    expect(app.environment).toEqual({ A: "1" });
    expect(out.volumes).toEqual({ data: {} });
    expect(out.networks).toEqual({ default: { internal: true }, outside: { internal: true } });
  });
  it("builds only from inside the repo", () => {
    for (const build of ["/", "../..", { context: ".", dockerfile: "../../etc/Dockerfile" }, "~/x"]) {
      expect(() => sandboxCompose({ services: { app: { build } } }, { ...opts, networkMode: "attach" })).toThrow(/inside the repo/);
    }
  });
  it("needs the app service", () => {
    expect(() => sandboxCompose(demo, { ...opts, appService: "web", networkMode: "host" })).toThrow(/web/);
  });
  it("project names are compose-safe", () => {
    expect(projectName("ses_ABC.42/x", "head")).toBe("sb-ses_abc-42-x-head");
  });
});
