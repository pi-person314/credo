import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebTriggerRequest } from "@forge/api";
import { Queue } from "@forge/events";
import { findJiraKey } from "../contracts/index";
import { header, respond } from "../lib/http";

const ingest = new Queue({ key: "ingest" });

function validSignature(req: WebTriggerRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig = header(req.headers, "x-hub-signature-256") ?? "";
  const want = "sha256=" + createHmac("sha256", secret).update(req.body).digest("hex");
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

/** GitHub pull_request webhook. Verify, filter, enqueue. GitHub wants a reply within ~10 s. */
export async function githubWebhook(req: WebTriggerRequest) {
  if (!validSignature(req)) return respond(401, { error: "bad signature" });
  if (header(req.headers, "x-github-event") !== "pull_request") return respond(204);

  const event = JSON.parse(req.body);
  if (!["opened", "synchronize", "reopened"].includes(event.action)) return respond(204);

  const pr = event.pull_request;
  const issueKey = findJiraKey(pr.title, pr.head.ref);
  if (!issueKey) return respond(202, { skipped: "no Jira key in title or branch" });

  await ingest.push({
    body: {
      issueKey,
      repo: event.repository.full_name,
      prNumber: pr.number,
      prUrl: pr.html_url,
      title: pr.title,
      prBody: pr.body ?? "",
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      cloneUrl: event.repository.clone_url,
    },
  });
  return respond(202, { queued: issueKey });
}
