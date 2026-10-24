import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { exec } from "../util/exec.js";

export interface RepoOptions {
  workDir: string;
  githubToken?: string;
  /** Clone from here instead of https://github.com/<repo>.git (local path or URL). */
  urlOverride?: string;
}

/**
 * One bare repo per GitHub repo under WORK_DIR/repos, fetched by SHA.
 * `checkout` writes a plain copy of the tree at a SHA (no .git) for docker compose to build.
 */
export class RepoCache {
  private locks = new Map<string, Promise<unknown>>();

  constructor(private opts: RepoOptions) {}

  private gitDir(repo: string) {
    return join(this.opts.workDir, "repos", `${repo.replace("/", "__")}.git`);
  }

  private authArgs(): string[] {
    if (!this.opts.githubToken || this.opts.urlOverride) return [];
    const basic = Buffer.from(`x-access-token:${this.opts.githubToken}`).toString("base64");
    return ["-c", `http.https://github.com/.extraheader=Authorization: Basic ${basic}`];
  }

  /** Serialize git work per repo: concurrent fetches into one repo fight over lock files. */
  private serial<T>(repo: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(repo) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(repo, next);
    return next;
  }

  private git(gitDir: string, args: string[], env?: NodeJS.ProcessEnv) {
    return exec("git", [...this.authArgs(), "--git-dir", gitDir, ...args], { env: { GIT_TERMINAL_PROMPT: "0", ...env }, timeoutMs: 180_000 });
  }

  private async hasCommit(gitDir: string, sha: string) {
    const r = await exec("git", ["--git-dir", gitDir, "cat-file", "-e", `${sha}^{commit}`], { allowFail: true });
    return r.code === 0;
  }

  /** Makes sure `sha` is in the local repo. prNumber lets it fall back to refs/pull/N/head (fork PRs). */
  fetch(repo: string, sha: string, prNumber?: number): Promise<void> {
    return this.serial(repo, async () => {
      const gitDir = this.gitDir(repo);
      if (!existsSync(gitDir)) {
        mkdirSync(gitDir, { recursive: true });
        await exec("git", ["init", "--bare", "-q", gitDir]);
        const url = this.opts.urlOverride || `https://github.com/${repo}.git`;
        await exec("git", ["--git-dir", gitDir, "remote", "add", "origin", url]);
      }
      if (await this.hasCommit(gitDir, sha)) return;
      const attempts: string[][] = [
        ["fetch", "-q", "--no-tags", "--depth", "1", "origin", sha],
        ...(prNumber ? [["fetch", "-q", "--no-tags", "origin", `+refs/pull/${prNumber}/head:refs/remotes/origin/pr/${prNumber}`]] : []),
        ["fetch", "-q", "--no-tags", "origin", "+refs/heads/*:refs/remotes/origin/*"],
      ];
      let lastErr: unknown;
      for (const args of attempts) {
        try {
          await this.git(gitDir, args);
          if (await this.hasCommit(gitDir, sha)) return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw new Error(`could not fetch ${repo}@${sha.slice(0, 7)}: ${lastErr instanceof Error ? lastErr.message : "not found"}`);
    });
  }

  /** Writes the tree at `sha` into `dest` (replaced if it exists). */
  async checkout(repo: string, sha: string, dest: string, prNumber?: number): Promise<void> {
    await this.fetch(repo, sha, prNumber);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const gitDir = this.gitDir(repo);
    // Own index file per checkout so base and head can be written at the same time.
    const index = join(dest, "..", `.index-${basename(dest)}`);
    try {
      await exec("git", ["--git-dir", gitDir, "--work-tree", dest, "checkout", "-f", sha, "--", "."], { env: { GIT_INDEX_FILE: index } });
    } finally {
      rmSync(index, { force: true });
    }
  }
}
