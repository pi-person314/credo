import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NetworkMode } from "../config.js";

export const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
export const SANDBOX_LABEL = "pr-agent.sandbox";

export function findComposeFile(dir: string): string | undefined {
  return COMPOSE_FILES.map((f) => join(dir, f)).find((p) => existsSync(p));
}

export interface SandboxComposeOptions {
  appService: string;
  appPort: number;
  networkMode: NetworkMode;
  sessionId: string;
  env: string;
  cpus: string;
  memory: string;
}

type Service = Record<string, unknown> & {
  build?: unknown;
  volumes?: unknown[];
  labels?: Record<string, string> | string[];
};

/**
 * The only service keys a sandbox keeps. The compose file comes from the PR under test, so anything that
 * reaches past the sandbox is dropped rather than denied one by one: privileged, cap_add, devices, pid,
 * network_mode, security_opt, env_file (reads runner files), extends, secrets, deploy, ports, container_name...
 */
const SERVICE_KEYS = new Set([
  "image", "build", "environment", "command", "entrypoint", "working_dir", "user", "depends_on", "healthcheck",
  "volumes", "labels", "expose", "restart", "init", "stop_signal", "stop_grace_period", "tmpfs",
]);
const BUILD_KEYS = new Set(["context", "dockerfile", "args", "target"]);

/** A path inside the checkout: relative, no "..", no "~". */
const insideRepo = (p: unknown) => typeof p === "string" && !/^[/~]/.test(p) && !p.split(/[\\/]/).includes("..");

function sandboxBuild(build: unknown): unknown {
  const b = typeof build === "string" ? { context: build } : build && typeof build === "object" ? (build as Record<string, unknown>) : {};
  const out = Object.fromEntries(Object.entries(b).filter(([k]) => BUILD_KEYS.has(k)));
  out.context ??= ".";
  if (!insideRepo(out.context) || (out.dockerfile !== undefined && !insideRepo(out.dockerfile))) {
    throw new Error("compose build context and dockerfile must stay inside the repo");
  }
  return out;
}

/** Named volumes only (no bind mounts, no host paths). */
function namedVolumes(volumes: unknown[]): unknown[] {
  return volumes.filter((v) => {
    if (typeof v === "string") return /^[A-Za-z0-9][\w.-]*:/.test(v); // "name:/path", not "./x:/y" or "/x:/y"
    const o = v as { type?: string; source?: string };
    return (o.type ?? "volume") === "volume" && typeof o.source === "string" && /^[A-Za-z0-9][\w.-]*$/.test(o.source);
  });
}

/** Top-level volumes/networks keep their names only: no driver, driver_opts (host binds) or external. */
const namesOnly = (src: unknown, extra: Record<string, unknown> = {}) =>
  Object.fromEntries(Object.keys((src ?? {}) as Record<string, unknown>).map((k) => [k, { ...extra }]));

/**
 * Turns the demo repo's own compose file into a sandbox: an allowlist of service keys (no host ports, fixed
 * names, bind mounts, privileges or host namespaces), builds only from inside the repo, fixed CPU/memory caps,
 * and labels so the runner can find its sandboxes.
 * In attach mode every network is internal (no internet, no host); the runner joins it to reach the app.
 * In host mode the app publishes a random port on 127.0.0.1 instead.
 */
export function sandboxCompose(src: Record<string, unknown>, o: SandboxComposeOptions): Record<string, unknown> {
  const services = (src.services ?? {}) as Record<string, Service>;
  if (!services[o.appService]) throw new Error(`compose file has no "${o.appService}" service (set SANDBOX_APP_SERVICE)`);
  const out: Record<string, Service> = {};
  for (const [name, svc] of Object.entries(services)) {
    const s: Service = Object.fromEntries(Object.entries(svc ?? {}).filter(([k]) => SERVICE_KEYS.has(k)));
    if (s.build !== undefined) s.build = sandboxBuild(s.build);
    if (Array.isArray(s.volumes)) s.volumes = namedVolumes(s.volumes);
    else delete s.volumes;
    const labels = Array.isArray(s.labels)
      ? Object.fromEntries(s.labels.map((l) => String(l).split("=", 2) as [string, string]))
      : { ...(s.labels ?? {}) };
    s.labels = { ...labels, [SANDBOX_LABEL]: "1", [`${SANDBOX_LABEL}.session`]: o.sessionId, [`${SANDBOX_LABEL}.env`]: o.env };
    s.cpus = o.cpus;
    s.mem_limit = o.memory;
    if (name === o.appService && o.networkMode === "host") s.ports = [`127.0.0.1::${o.appPort}`];
    out[name] = s;
  }
  const result: Record<string, unknown> = { services: out };
  if (src.volumes) result.volumes = namesOnly(src.volumes);
  if (o.networkMode === "attach") {
    result.networks = { default: { internal: true }, ...namesOnly(src.networks, { internal: true }) };
  } else if (src.networks) {
    result.networks = namesOnly(src.networks);
  }
  return result;
}

/** Compose project names: lowercase letters, digits, dashes, underscores. */
export function projectName(sessionId: string, env: string): string {
  const id = sessionId.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^[-_]+/, "").slice(0, 40);
  return `sb-${id}-${env}`;
}
