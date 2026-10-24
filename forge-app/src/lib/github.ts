import { fetch } from "@forge/api";
import { AppManifest, type ChangedFile, type Finding, type Severity } from "../contracts/index";

// GitHub reads for ingest. Writes (comments, statuses) are in github-write.ts.
// GITHUB_TOKEN is an optional Forge variable; without it calls are unauthenticated (60/h per IP).
const API = "https://api.github.com";
const MAX_FILES = 100;
const PATCH_CHARS = 4000;
// Context is stored in one KVS value (240 KiB cap), so all patches together get a budget too.
const TOTAL_PATCH_CHARS = 100_000;
const FINDING_CHARS = 1000;

export type PrRef = { repo: string; prNumber: number }; // repo is "owner/name"

export function githubHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: accept,
    "User-Agent": "pr-confidence-forge",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`github GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

const STATUS: Record<string, ChangedFile["status"]> = {
  added: "added",
  removed: "removed",
  renamed: "renamed",
  copied: "added",
};

/** Files changed by the PR (first 100), patches capped per file and in total. */
export async function readPrFiles({ repo, prNumber }: PrRef): Promise<ChangedFile[]> {
  const files = await get<any[]>(`/repos/${repo}/pulls/${prNumber}/files?per_page=${MAX_FILES}`);
  let budget = TOTAL_PATCH_CHARS;
  return files.map((f) => {
    const patch = typeof f.patch === "string" && budget > 0 ? f.patch.slice(0, Math.min(PATCH_CHARS, budget)) : undefined;
    budget -= patch?.length ?? 0;
    return {
      path: String(f.filename),
      status: STATUS[f.status] ?? "modified",
      additions: Number(f.additions ?? 0),
      deletions: Number(f.deletions ?? 0),
      patch,
    };
  });
}

const isGreptile = (c: any) => /greptile/i.test(String(c?.user?.login ?? ""));

/** Rough severity from the comment text. Greptile has no structured severity. */
export function severityOf(text: string): Severity {
  if (/\b(critical|security|race|duplicate|double|data loss|vulnerab|deadlock|crash)/i.test(text)) return "high";
  if (/\b(bug|error|incorrect|missing|leak|break|fail)/i.test(text)) return "medium";
  return "low";
}

/** Greptile bot comments (issue comments, review comments, review bodies) as findings. */
export async function readGreptileFindings({ repo, prNumber }: PrRef, sessionId: string, headSha: string) {
  const paths = [
    `/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
    `/repos/${repo}/pulls/${prNumber}/comments?per_page=100`,
    `/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`,
  ];
  const results = await Promise.allSettled(paths.map((p) => get<any[]>(p)));
  const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []));
  const comments = results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).filter(isGreptile);
  const findings: Finding[] = comments
    .filter((c) => String(c.body ?? "").trim())
    .map((c) => {
      const where = c.path ? `${c.path}${c.line ? `:${c.line}` : ""}: ` : "";
      const body = where + String(c.body).trim();
      return {
        id: `fnd_gh_${c.id}`,
        sessionId,
        source: "greptile" as const,
        severity: severityOf(body),
        description: body.length > FINDING_CHARS ? body.slice(0, FINDING_CHARS - 1) + "…" : body,
        url: c.html_url || undefined,
        commitSha: c.commit_id ?? headSha,
      };
    });
  return { findings, errors };
}

/** The app manifest from the repo at `sha`. Tries each path in order; undefined if none parse. */
export async function readManifest(repo: string, sha: string, paths = ["manifest.json", "demo-app/manifest.json"]) {
  for (const path of paths) {
    try {
      const res = await fetch(`${API}/repos/${repo}/contents/${path}?ref=${sha}`, {
        headers: githubHeaders("application/vnd.github.raw+json"),
      });
      if (!res.ok) continue;
      const parsed = AppManifest.safeParse(JSON.parse(await res.text()));
      if (parsed.success) return parsed.data;
    } catch {
      // try the next path
    }
  }
  return undefined;
}
