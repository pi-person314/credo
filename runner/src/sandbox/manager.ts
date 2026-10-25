import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { Env, Knobs, SandboxState, StatusResponse } from "@pr-agent/contracts";
import type { Config } from "../config.js";
import { exec } from "../util/exec.js";
import { SANDBOX_LABEL, findComposeFile, projectName, sandboxCompose } from "./compose.js";
import { RepoCache } from "./git.js";

export interface SandboxSpec {
  repo: string;
  sha: string;
  prNumber?: number;
}

export interface Sandbox {
  sessionId: string;
  env: Env;
  sha: string;
  project: string;
  state: SandboxState;
  /** Base URL of the app as the runner sees it, e.g. http://127.0.0.1:49153 */
  url?: string;
  error?: string;
  /** Last lines of build/up output, for evidence when a build fails. */
  log: string[];
  dir: string;
}

export interface SandboxManagerOptions {
  /** Called on every build/up output line. */
  onLog?: (sb: Sandbox, line: string) => void;
}

const ENVS: Env[] = ["base", "head"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Owns the sb-<session>-<env> compose stacks: checkout at a SHA, build, health check, test hooks
 * (seed / knobs / db), idle teardown.
 */
export class SandboxManager {
  private sandboxes = new Map<string, Sandbox>();
  private lastActivity = new Map<string, number>();
  private sweeper?: NodeJS.Timeout;
  readonly repos: RepoCache;

  constructor(private cfg: Config, private opts: SandboxManagerOptions = {}) {
    this.repos = new RepoCache({ workDir: cfg.workDir, githubToken: cfg.githubToken, urlOverride: cfg.repoUrlOverride });
  }

  private key = (sessionId: string, env: Env) => `${sessionId}/${env}`;

  get(sessionId: string, env: Env): Sandbox | undefined {
    return this.sandboxes.get(this.key(sessionId, env));
  }

  /** The sandbox if it is healthy, otherwise throws. */
  healthy(sessionId: string, env: Env): Sandbox & { url: string } {
    const sb = this.get(sessionId, env);
    if (!sb || sb.state !== "healthy" || !sb.url) throw new Error(`${env} sandbox is ${sb?.state ?? "down"}`);
    return sb as Sandbox & { url: string };
  }

  status(sessionId: string): StatusResponse {
    return { base: this.get(sessionId, "base")?.state ?? "down", head: this.get(sessionId, "head")?.state ?? "down" };
  }

  touch(sessionId: string) {
    this.lastActivity.set(sessionId, Date.now());
  }

  /** When the session's sandboxes were last used (ms epoch); the idle sweeper counts from here. */
  lastActive(sessionId: string): number | undefined {
    return this.lastActivity.get(sessionId);
  }

  sessions(): string[] {
    return [...new Set([...this.sandboxes.values()].map((s) => s.sessionId))];
  }

  private compose(sb: Sandbox, args: string[], onLine?: (l: string) => void, timeoutMs = 120_000) {
    return exec("docker", ["compose", "-p", sb.project, "-f", join(sb.dir, "sandbox.compose.json"), ...args], {
      cwd: sb.dir,
      onLine,
      timeoutMs,
      // The compose file comes from the PR: "${GITHUB_TOKEN}" in it must not interpolate the runner's secrets.
      cleanEnv: true,
    });
  }

  /** Builds and starts one sandbox. Resolves when it is healthy; on failure the sandbox state is "failed" and it rejects. */
  async up(sessionId: string, env: Env, spec: SandboxSpec): Promise<Sandbox> {
    this.touch(sessionId);
    const project = projectName(sessionId, env);
    const dir = join(this.cfg.workDir, "sandboxes", project, "src");
    const sb: Sandbox = { sessionId, env, sha: spec.sha, project, state: "building", log: [], dir };
    const prev = this.get(sessionId, env);
    this.sandboxes.set(this.key(sessionId, env), sb);
    const log = (line: string) => {
      sb.log.push(line);
      if (sb.log.length > 200) sb.log.shift();
      this.opts.onLog?.(sb, line);
    };
    try {
      if (prev) await this.down(prev);
      log(`checkout ${spec.repo}@${spec.sha.slice(0, 7)}`);
      await this.repos.checkout(spec.repo, spec.sha, dir, spec.prNumber);
      const file = findComposeFile(dir);
      if (!file) throw new Error("repo has no compose file at its root");
      const composed = sandboxCompose(parse(readFileSync(file, "utf8")) as Record<string, unknown>, {
        ...this.cfg.sandbox,
        networkMode: this.cfg.networkMode,
        sessionId,
        env,
      });
      if (this.cfg.sandbox.caCert) trustCa(dir, composed, this.cfg.sandbox.caCert);
      writeFileSync(join(dir, "sandbox.compose.json"), JSON.stringify(composed, null, 2));
      const timeout = this.cfg.sandbox.buildTimeoutSec;
      await this.compose(sb, ["up", "-d", "--build", "--wait", "--wait-timeout", String(timeout)], log, (timeout + 60) * 1000);
      sb.url = await this.resolveUrl(sb);
      await this.waitHealthy(sb);
      sb.state = "healthy";
      log(`healthy at ${sb.url}`);
      return sb;
    } catch (err) {
      sb.state = "failed";
      sb.error = err instanceof Error ? err.message : String(err);
      log(`failed: ${sb.error}`);
      throw err;
    }
  }

  /** Both sandboxes in parallel. Never rejects; check the returned states. */
  async upBoth(sessionId: string, specs: Record<Env, SandboxSpec>): Promise<Record<Env, Sandbox>> {
    await Promise.allSettled(ENVS.map((env) => this.up(sessionId, env, specs[env])));
    return { base: this.get(sessionId, "base")!, head: this.get(sessionId, "head")! };
  }

  private async resolveUrl(sb: Sandbox): Promise<string> {
    const { appService, appPort } = this.cfg.sandbox;
    if (this.cfg.networkMode === "host") {
      const { stdout } = await this.compose(sb, ["port", appService, String(appPort)]);
      const port = stdout.trim().split("\n")[0]?.split(":").pop();
      if (!port) throw new Error(`no published port for ${appService}`);
      return `http://127.0.0.1:${port}`;
    }
    const network = `${sb.project}_default`;
    const r = await exec("docker", ["network", "connect", network, this.cfg.selfContainer], { allowFail: true });
    if (r.code !== 0 && !/already exists|already attached/i.test(r.stderr)) throw new Error(`docker network connect: ${r.stderr.trim()}`);
    return `http://${sb.project}-${appService}-1:${appPort}`;
  }

  private async waitHealthy(sb: Sandbox, timeoutMs = 60_000) {
    const until = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < until) {
      try {
        const res = await fetch(`${sb.url}${this.cfg.sandbox.healthPath}`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
        last = `HTTP ${res.status}`;
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
      }
      await sleep(500);
    }
    throw new Error(`health check ${this.cfg.sandbox.healthPath} never passed (${last})`);
  }

  /** Calls a test hook (or any route) inside one sandbox. */
  async request(sessionId: string, env: Env, method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const sb = this.healthy(sessionId, env);
    this.touch(sessionId);
    const res = await fetch(`${sb.url}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {}
    return { status: res.status, body: parsed };
  }

  private async hookBoth(sessionId: string, path: string, body?: unknown) {
    const out = await Promise.all(ENVS.map((env) => this.request(sessionId, env, "POST", path, body)));
    const bad = out.find((r) => r.status >= 400);
    if (bad) throw new Error(`${path} -> ${bad.status} ${JSON.stringify(bad.body)}`);
    return out;
  }

  /** Same fixture on one sandbox. Also resets the provider to ok. */
  async seed(sessionId: string, env: Env, fixture: string) {
    const r = await this.request(sessionId, env, "POST", "/__test/seed", { fixture });
    if (r.status >= 400) throw new Error(`seed ${fixture} on ${env} -> ${r.status} ${JSON.stringify(r.body)}`);
  }

  async setKnobs(sessionId: string, env: Env, knobs: Knobs) {
    const r = await this.request(sessionId, env, "POST", "/__test/provider", { mode: knobs.provider, latencyMs: knobs.latencyMs });
    if (r.status >= 400) throw new Error(`knobs on ${env} -> ${r.status} ${JSON.stringify(r.body)}`);
  }

  /** Knobs always hit both sandboxes. */
  setKnobsBoth(sessionId: string, knobs: Knobs) {
    return this.hookBoth(sessionId, "/__test/provider", { mode: knobs.provider, latencyMs: knobs.latencyMs });
  }

  /** Reseeds both to the same fixture. */
  resetBoth(sessionId: string, fixture?: string) {
    return fixture ? this.hookBoth(sessionId, "/__test/seed", { fixture }) : this.hookBoth(sessionId, "/__test/reset");
  }

  /** Rows of a table inside one sandbox, via GET /__test/db/:table?col=value. */
  async db(sessionId: string, env: Env, table: string, where: Record<string, unknown> = {}) {
    const qs = new URLSearchParams(Object.entries(where).map(([k, v]) => [k, String(v)])).toString();
    const r = await this.request(sessionId, env, "GET", `/__test/db/${encodeURIComponent(table)}${qs ? `?${qs}` : ""}`);
    if (r.status >= 400) throw new Error(`db ${table} on ${env} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as { table: string; count: number; rows: Record<string, unknown>[] };
  }

  private async down(sb: Sandbox) {
    if (this.cfg.networkMode === "attach") {
      await exec("docker", ["network", "disconnect", "-f", `${sb.project}_default`, this.cfg.selfContainer], { allowFail: true });
    }
    await exec("docker", ["compose", "-p", sb.project, "down", "-v", "--remove-orphans", "--timeout", "2"], { allowFail: true, timeoutMs: 60_000 });
    sb.state = "down";
    sb.url = undefined;
  }

  async teardown(sessionId: string) {
    const list = ENVS.map((env) => this.get(sessionId, env)).filter((s): s is Sandbox => !!s);
    await Promise.all(list.map((sb) => this.down(sb)));
    for (const env of ENVS) this.sandboxes.delete(this.key(sessionId, env));
    this.lastActivity.delete(sessionId);
    rmSync(join(this.cfg.workDir, "sandboxes", projectName(sessionId, "base")), { recursive: true, force: true });
    rmSync(join(this.cfg.workDir, "sandboxes", projectName(sessionId, "head")), { recursive: true, force: true });
  }

  /** Tears down sessions idle for longer than SANDBOX_IDLE_TTL_MIN. `onIdle` runs before each teardown. */
  startSweeper(onIdle: (sessionId: string) => Promise<void> | void, everyMs = 60_000) {
    this.sweeper = setInterval(async () => {
      const cutoff = Date.now() - this.cfg.idleTtlMin * 60_000;
      for (const id of this.sessions()) {
        if ((this.lastActivity.get(id) ?? 0) < cutoff) {
          await onIdle(id);
          await this.teardown(id).catch(() => undefined);
        }
      }
    }, everyMs);
    this.sweeper.unref();
  }

  stopSweeper() {
    clearInterval(this.sweeper);
  }

  /** Removes sandboxes left over from an earlier runner process (it keeps state in memory only). */
  async removeOrphans(): Promise<string[]> {
    const { stdout } = await exec("docker", ["ps", "-a", "--filter", `label=${SANDBOX_LABEL}=1`, "--format", '{{.Label "com.docker.compose.project"}}'], {
      allowFail: true,
    });
    const known = new Set([...this.sandboxes.values()].map((s) => s.project));
    const projects = [...new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean))].filter((p) => !known.has(p));
    for (const p of projects) {
      await exec("docker", ["network", "disconnect", "-f", `${p}_default`, this.cfg.selfContainer], { allowFail: true });
      await exec("docker", ["compose", "-p", p, "down", "-v", "--remove-orphans", "--timeout", "2"], { allowFail: true, timeoutMs: 60_000 });
    }
    mkdirSync(join(this.cfg.workDir, "sandboxes"), { recursive: true });
    return projects;
  }
}

/**
 * For networks with a TLS-intercepting proxy (SANDBOX_CA_CERT): copies the CA into each build context and
 * builds from a copy of the Dockerfile that trusts it right after every FROM, so `npm ci` and friends work.
 */
function trustCa(dir: string, composed: Record<string, unknown>, caCert: string) {
  const services = composed.services as Record<string, { build?: string | { context?: string; dockerfile?: string } }>;
  for (const svc of Object.values(services)) {
    if (!svc.build) continue;
    const build = typeof svc.build === "string" ? { context: svc.build } : { ...svc.build };
    const ctx = join(dir, build.context ?? ".");
    const dockerfile = join(ctx, build.dockerfile ?? "Dockerfile");
    if (!existsSync(dockerfile)) continue;
    copyFileSync(caCert, join(ctx, ".sandbox-ca.crt"));
    const trusted = readFileSync(dockerfile, "utf8").replace(
      /^(FROM\s.+)$/gim,
      "$1\nCOPY .sandbox-ca.crt /usr/local/share/ca-certificates/sandbox-ca.crt\nENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/sandbox-ca.crt",
    );
    writeFileSync(join(ctx, "Dockerfile.sandbox"), trusted);
    svc.build = { ...build, dockerfile: "Dockerfile.sandbox" };
  }
}
