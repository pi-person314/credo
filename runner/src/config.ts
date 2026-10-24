import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { BUDGETS } from "@pr-agent/contracts";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

/** How the runner reaches sandbox apps. */
export type NetworkMode =
  | "host" // runner on the host (dev:cli, tests): apps publish a random port on 127.0.0.1
  | "attach"; // runner in a container with the Docker socket: it joins each sandbox's internal network

const workDir = resolve(process.env.WORK_DIR ?? (existsSync("/.dockerenv") ? "/data/work" : join(process.cwd(), ".work")));

export const config = {
  port: num(process.env.PORT, 4100),
  host: process.env.HOST ?? "0.0.0.0",
  token: process.env.RUNNER_TOKEN ?? "change-me",
  eventsUrl: process.env.EVENTS_URL ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  factoryApiKey: process.env.FACTORY_API_KEY ?? "",
  /** Public base URL of the runner, used in links it hands out. */
  publicUrl: (process.env.PUBLIC_URL ?? (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : "")).replace(/\/$/, ""),
  workDir,
  artifactsDir: resolve(process.env.ARTIFACTS_DIR ?? join(workDir, "artifacts")),
  idleTtlMin: num(process.env.SANDBOX_IDLE_TTL_MIN, BUDGETS.sandboxIdleTtlMin),
  networkMode: (process.env.SANDBOX_NETWORK_MODE ?? (existsSync("/.dockerenv") ? "attach" : "host")) as NetworkMode,
  /** This container's id or name, for `docker network connect` in attach mode. */
  selfContainer: process.env.RUNNER_CONTAINER ?? hostname(),
  /** Overrides the clone URL (e.g. a local path in tests). Default: https://github.com/<repo>.git */
  repoUrlOverride: process.env.SANDBOX_REPO_URL ?? "",
  sandbox: {
    appService: process.env.SANDBOX_APP_SERVICE ?? "app",
    appPort: num(process.env.SANDBOX_APP_PORT, 3000),
    healthPath: process.env.SANDBOX_HEALTH_PATH ?? "/healthz",
    buildTimeoutSec: num(process.env.SANDBOX_BUILD_TIMEOUT_SEC, 300),
    cpus: process.env.SANDBOX_CPUS ?? "1",
    memory: process.env.SANDBOX_MEMORY ?? "768m",
    /** Extra CA certificate trusted inside sandbox builds (TLS-intercepting proxies). Path on the runner. */
    caCert: process.env.SANDBOX_CA_CERT ?? "",
  },
};

export type Config = typeof config;
