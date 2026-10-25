import type { Context } from "../contracts/index";

// What ingest read for a session, kept in its own KVS key (ingest:<id>) so the panel's Sources block
// never depends on the event window. Pure: the panel imports the type, ingest builds and logs it.

export type IngestSummary = {
  at: string;
  jira: { key: string; criteria: number; error?: string };
  confluence: { pages: { title: string; url?: string }[]; errors: string[] };
  pr: { files: number; error?: string; manifest: "repo" | "default" };
  greptile: { findings: number; errors: string[] };
};

/** Summary rebuilt from a stored Context, for sessions ingested before ingest:<id> existed. Errors are unknown there. */
export function summaryFromContext(c: Context, at = c.session.createdAt): IngestSummary {
  return {
    at,
    jira: c.jira ? { key: c.jira.key, criteria: c.jira.acceptanceCriteria.length } : { key: c.session.issueKey, criteria: 0, error: "not read" },
    confluence: { pages: (c.confluence ?? []).map((p) => ({ title: p.title, url: p.url })), errors: [] },
    pr: { files: c.changedFiles.length, manifest: "repo" },
    greptile: { findings: c.findings.length, errors: [] },
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One log line with counts only (no titles, bodies or error text that could carry API responses). */
export function ingestLogLine(sessionId: string, s: IngestSummary): string {
  return [
    `ingest ${sessionId} ${s.jira.key}:`,
    s.jira.error ? "jira failed," : `jira ${plural(s.jira.criteria, "AC")},`,
    `confluence ${plural(s.confluence.pages.length, "page")}${s.confluence.errors.length ? ` (${plural(s.confluence.errors.length, "error")})` : ""},`,
    s.pr.error ? "pr files failed," : `pr ${plural(s.pr.files, "file")}${s.pr.manifest === "default" ? " (default manifest)" : ""},`,
    `greptile ${plural(s.greptile.findings, "finding")}${s.greptile.errors.length ? ` (${plural(s.greptile.errors.length, "error")})` : ""}`,
  ].join(" ");
}
