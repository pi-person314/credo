import { fetch } from "@forge/api";

// Writes to api.github.com: PR comments and commit statuses.
// GITHUB_TOKEN is a Forge variable: forge variables set --encrypt GITHUB_TOKEN <value>
// Without it every call returns undefined and logs, so Jira publishing still works.
const API = "https://api.github.com";
export const STATUS_CONTEXT = "PR Confidence";

export type StatusState = "error" | "failure" | "pending" | "success";

export const hasGithubToken = () => Boolean(process.env.GITHUB_TOKEN);

async function gh<T>(method: string, path: string, body: unknown): Promise<T | undefined> {
  if (!hasGithubToken()) {
    console.log(`github ${method} ${path} skipped: GITHUB_TOKEN not set`);
    return undefined;
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`github ${method} ${path} -> ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** New comment on the PR conversation. Returns the comment id. */
export async function postPrComment(repo: string, prNumber: number, body: string) {
  const res = await gh<{ id: number }>("POST", `/repos/${repo}/issues/${prNumber}/comments`, { body });
  return res?.id;
}

/** Replace the text of a comment we posted earlier. */
export async function updatePrComment(repo: string, commentId: number, body: string) {
  const res = await gh<{ id: number }>("PATCH", `/repos/${repo}/issues/comments/${commentId}`, { body });
  return res?.id;
}

/** Commit status on `sha`. GitHub caps the description at 140 chars. */
export async function setCommitStatus(repo: string, sha: string, state: StatusState, description: string, targetUrl?: string) {
  const body = { state, context: STATUS_CONTEXT, description: description.slice(0, 140), ...(targetUrl ? { target_url: targetUrl } : {}) };
  const res = await gh<{ id: number }>("POST", `/repos/${repo}/statuses/${sha}`, body);
  return res?.id;
}
