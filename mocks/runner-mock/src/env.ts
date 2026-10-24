import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Reads the repo-root .env (KEY=value lines) into process.env without overriding what's already set.
// ENV_FILE points it elsewhere (e.g. from a git worktree). Values are never logged.

const ENV_FILE = process.env.ENV_FILE ?? fileURLToPath(new URL("../../../.env", import.meta.url));

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2]!;
    const quoted = value.match(/^(["'])(.*)\1$/);
    out[m[1]!] = quoted ? quoted[2]! : value.replace(/\s+#.*$/, "");
  }
  return out;
}

export function loadEnv(file = ENV_FILE) {
  if (!existsSync(file)) return;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) process.env[k] ??= v;
}

loadEnv();

export const config = {
  port: Number(process.env.PORT ?? 4100),
  eventsUrl: process.env.EVENTS_URL || "http://localhost:4000/events",
  token: process.env.RUNNER_TOKEN || "change-me",
  /** Multiplies every canned delay. 0 = post as fast as possible. */
  speed: Number(process.env.MOCK_SPEED ?? 1),
};
