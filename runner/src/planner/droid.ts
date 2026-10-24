import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "../util/exec.js";

/** Anything that turns a prompt into model text. */
export interface Llm {
  readonly name: string;
  available(): boolean;
  complete(prompt: string): Promise<string>;
}

export interface DroidOptions {
  apiKey: string;
  bin?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Factory Droid in headless mode: `droid exec "<prompt>"`, read-only (no --auto), in an empty
 * directory so it can't wander into our files. FACTORY_API_KEY authenticates it.
 */
export class DroidLlm implements Llm {
  readonly name = "droid";
  constructor(private o: DroidOptions) {}

  available() {
    return !!this.o.apiKey;
  }

  async complete(prompt: string): Promise<string> {
    const cwd = mkdtempSync(join(tmpdir(), "droid-"));
    try {
      const args = ["exec", ...(this.o.model ? ["--model", this.o.model] : []), "--output-format", "json", prompt];
      const r = await exec(this.o.bin ?? "droid", args, {
        cwd,
        env: { FACTORY_API_KEY: this.o.apiKey },
        timeoutMs: this.o.timeoutMs ?? 120_000,
        allowFail: true,
      });
      // Older CLIs may not know --output-format json: retry with plain text.
      if (r.code !== 0 && /output-format|unknown option/i.test(r.stderr)) {
        const t = await exec(this.o.bin ?? "droid", ["exec", ...(this.o.model ? ["--model", this.o.model] : []), prompt], {
          cwd,
          env: { FACTORY_API_KEY: this.o.apiKey },
          timeoutMs: this.o.timeoutMs ?? 120_000,
        });
        return t.stdout;
      }
      if (r.code !== 0) throw new Error(`droid exec exited ${r.code}: ${(r.stderr || r.stdout).trim().slice(-500)}`);
      return unwrap(r.stdout);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
}

/** `--output-format json` wraps the answer ({ result: "..." } or similar); plain text passes through. */
export function unwrap(stdout: string): string {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return trimmed;
    if (parsed && typeof parsed === "object") {
      for (const k of ["result", "text", "output", "content", "message", "response"]) {
        const v = (parsed as Record<string, unknown>)[k];
        if (typeof v === "string") return v;
      }
    }
  } catch {}
  return trimmed;
}

/** The first top-level JSON array (or object) in model text, ignoring prose and ``` fences. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  for (const [open, close] of [["[", "]"], ["{", "}"]] as const) {
    const start = body.indexOf(open);
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    for (let i = start; i < body.length; i++) {
      const ch = body[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error("no JSON array in planner output");
}
