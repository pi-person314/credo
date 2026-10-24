import { z } from "zod";
import { Finding, Session } from "./domain.js";
import { AppManifest } from "./manifest.js";

export const ChangedFile = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "removed", "renamed"]),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().optional(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

export const JiraIssue = z.object({
  key: z.string(),
  summary: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  assignee: z.object({ accountId: z.string(), displayName: z.string() }).optional(),
  url: z.string().url().optional(),
});
export type JiraIssue = z.infer<typeof JiraIssue>;

export const ConfluencePage = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: z.string(), // first ~2k chars of the body, plain text
  url: z.string().url().optional(),
});
export type ConfluencePage = z.infer<typeof ConfluencePage>;

/** Everything the Forge app gathered for a PR. Sent to runner POST /sessions. */
export const Context = z.object({
  session: Session,
  prBody: z.string().default(""),
  changedFiles: z.array(ChangedFile),
  jira: JiraIssue.optional(),
  confluence: z.array(ConfluencePage).default([]),
  findings: z.array(Finding),
  manifest: AppManifest,
  /** Scenario ids already run, so asks and follow-ups don't repeat them. */
  priorScenarioIds: z.array(z.string()).default([]),
});
export type Context = z.infer<typeof Context>;
