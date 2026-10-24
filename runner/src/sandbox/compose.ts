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
  ports?: unknown;
  container_name?: unknown;
  volumes?: unknown[];
  labels?: Record<string, string> | string[];
  networks?: unknown;
};

/**
 * Turns the demo repo's own compose file into a sandbox: no host ports (two sandboxes run side by side),
 * no fixed container names, no bind mounts, CPU/memory caps, and labels so the runner can find its sandboxes.
 * In attach mode every network is internal (no internet, no host); the runner joins it to reach the app.
 * In host mode the app publishes a random port on 127.0.0.1 instead.
 */
export function sandboxCompose(src: Record<string, unknown>, o: SandboxComposeOptions): Record<string, unknown> {
  const services = (src.services ?? {}) as Record<string, Service>;
  if (!services[o.appService]) throw new Error(`compose file has no "${o.appService}" service (set SANDBOX_APP_SERVICE)`);
  const out: Record<string, Service> = {};
  for (const [name, svc] of Object.entries(services)) {
    const s: Service = { ...svc };
    delete s.ports;
    delete s.container_name;
    if (Array.isArray(s.volumes)) {
      s.volumes = s.volumes.filter((v) => {
        const spec = typeof v === "string" ? v : (v as { type?: string; source?: string }).type === "bind" ? "/" : "";
        return !/^[./~]/.test(spec);
      });
    }
    const labels = Array.isArray(s.labels)
      ? Object.fromEntries(s.labels.map((l) => String(l).split("=", 2) as [string, string]))
      : { ...(s.labels ?? {}) };
    s.labels = { ...labels, [SANDBOX_LABEL]: "1", [`${SANDBOX_LABEL}.session`]: o.sessionId, [`${SANDBOX_LABEL}.env`]: o.env };
    s.cpus ??= o.cpus;
    s.mem_limit ??= o.memory;
    if (name === o.appService && o.networkMode === "host") s.ports = [`127.0.0.1::${o.appPort}`];
    out[name] = s;
  }
  const result: Record<string, unknown> = { services: out };
  if (src.volumes) result.volumes = src.volumes;
  if (o.networkMode === "attach") {
    const nets = (src.networks ?? {}) as Record<string, Record<string, unknown> | null>;
    result.networks = Object.fromEntries(
      [["default", null] as const, ...Object.entries(nets)].map(([k, v]) => [k, { ...(v ?? {}), internal: true }]),
    );
  } else if (src.networks) {
    result.networks = src.networks;
  }
  return result;
}

/** Compose project names: lowercase letters, digits, dashes, underscores. */
export function projectName(sessionId: string, env: string): string {
  const id = sessionId.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^[-_]+/, "").slice(0, 40);
  return `sb-${id}-${env}`;
}
