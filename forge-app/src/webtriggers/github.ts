import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebTriggerRequest } from "@forge/api";
import { Queue } from "@forge/events";
import { findJiraKey } from "../contracts/index";
import type { IngestJob } from "../consumers/ingest";
import { header, respond } from "../lib/http";

const ingest = new Queue({ key: "ingest" });
const ACTIONS = ["opened", "synchronize", "reopened"];

function validSignature(req: WebTriggerRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig = Buffer.from(header(req.headers, "x-hub-signature-256") ?? "");
  const want = Buffer.from("sha256=" + createHmac("sha256", secret).update(req.body ?? "").digest("hex"));
  return sig.length === want.length && timingSafeEqual(sig, want);
}

/** The fields ingest needs, or undefined if the payload is missing any of them. */
function toJob(event: any): IngestJob | undefined {
  const pr = event?.pull_request;
  const repo = event?.repository;
  const [owner, name] = String(repo?.full_name ?? "").split("/");
  if (!pr || !owner || !name || !Number.isInteger(pr.number) || !pr.base?.sha || !pr.head?.sha) return undefined;
  const title = String(pr.title ?? "");
  const branch = String(pr.head.ref ?? "");
  const issueKey = findJiraKey(title, branch);
  if (!issueKey) return undefined;
  return {
    issueKey,
    repo: `${owner}/${name}`,
    owner,
    name,
    prNumber: pr.number,
    prUrl: pr.html_url,
    title,
    branch,
    prBody: pr.body ?? "",
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    cloneUrl: repo.clone_url,
    action: event.action,
  };
}

/** GitHub pull_request webhook. Verify, filter, enqueue. GitHub wants a reply within ~10 s. */
export async function githubWebhook(req: WebTriggerRequest) {
  if (!validSignature(req)) return respond(401, { error: "bad signature" });
  const kind = header(req.headers, "x-github-event");
  if (kind === "ping") return respond(200, { pong: true });
  if (kind !== "pull_request") return respond(200, { ignored: kind ?? "unknown event" });

  let event: any;
  try {
    event = JSON.parse(req.body);
  } catch {
    return respond(400, { error: "bad json" });
  }
  if (!ACTIONS.includes(event?.action)) return respond(200, { ignored: event?.action });

  const job = toJob(event);
  if (!job) return respond(200, { skipped: "no Jira key in title or branch, or incomplete payload" });
  try {
    await ingest.push({ body: job });
  } catch (e) {
    console.error("ingest push failed", (e as Error).message);
    return respond(500, { error: "queue unavailable" }); // GitHub shows it as failed; redeliver from the UI
  }
  return respond(202, { queued: job.issueKey, pr: job.prNumber });
}
