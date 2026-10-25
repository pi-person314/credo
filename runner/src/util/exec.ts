import { spawn } from "node:child_process";

export class ExecError extends Error {
  constructor(public cmd: string, public code: number | null, public stdout: string, public stderr: string) {
    super(`${cmd} exited ${code}: ${(stderr || stdout).trim().split("\n").slice(-8).join("\n")}`);
  }
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  /** Don't throw on a non-zero exit. */
  allowFail?: boolean;
  /** Each output line as it arrives (build logs). */
  onLine?: (line: string) => void;
  /** Start from a bare environment (PATH, HOME, Docker settings) instead of the runner's, which holds secrets. */
  cleanEnv?: boolean;
}

const CLEAN_ENV_KEYS = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "DOCKER_BUILDKIT"];
const cleanEnv = () => Object.fromEntries(CLEAN_ENV_KEYS.flatMap((k) => (process.env[k] === undefined ? [] : [[k, process.env[k]]])));

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a command without a shell. Rejects with ExecError on a non-zero exit unless allowFail. */
export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...(opts.cleanEnv ? cleanEnv() : process.env), ...opts.env }, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    let partial = "";
    const lines = (chunk: string) => {
      if (!opts.onLine) return;
      partial += chunk;
      const parts = partial.split("\n");
      partial = parts.pop() ?? "";
      for (const l of parts) opts.onLine(l);
    };
    child.stdout.setEncoding("utf8").on("data", (d: string) => ((stdout += d), lines(d)));
    child.stderr.setEncoding("utf8").on("data", (d: string) => ((stderr += d), lines(d)));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : undefined;
    child.on("error", (err) => (clearTimeout(timer), reject(err)));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (partial && opts.onLine) opts.onLine(partial);
      const full = `${cmd} ${args.join(" ")}`;
      if (code !== 0 && !opts.allowFail) reject(new ExecError(full, code, stdout, stderr));
      else resolve({ code, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}
