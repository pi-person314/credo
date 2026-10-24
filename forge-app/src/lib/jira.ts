import api, { route } from "@forge/api";
import type { JiraIssue } from "../contracts/index";

// Jira reads for ingest. Writes (comments, bugs, transitions) live elsewhere.

type Adf = { type?: string; text?: string; content?: Adf[]; attrs?: Record<string, unknown> };

const BLOCKS = new Set(["paragraph", "heading", "codeBlock", "blockquote", "panel", "rule"]);

function render(n: Adf, indent: string): string {
  const kids = () => (n.content ?? []).map((c) => render(c, indent)).join("");
  switch (n.type) {
    case "text":
      return n.text ?? "";
    case "hardBreak":
      return "\n";
    case "mention":
    case "emoji":
      return String(n.attrs?.text ?? "");
    case "inlineCard":
      return String(n.attrs?.url ?? "");
    case "bulletList":
    case "orderedList": {
      const items = (n.content ?? []).map((li, i) => {
        const mark = n.type === "orderedList" ? `${i + 1}. ` : "- ";
        return indent + mark + render(li, indent + "  ").trim();
      });
      return items.join("\n") + "\n";
    }
    default:
      return n.type && BLOCKS.has(n.type) ? kids() + "\n" : kids();
  }
}

/** Atlassian Document Format -> plain text. List items become "- " / "1. " lines, blocks become lines. */
export function adfToText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return render(node as Adf, "").replace(/\n{3,}/g, "\n\n").trim();
}

const AC_HEADING = /^\s*(#+\s*|\*+\s*|h\d\.\s*)?acceptance criteria\b\s*:?\s*(\**)\s*$/i;
const ITEM = /^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s+(.+)$/;
const OTHER_HEADING = /^\s*(#+\s|h\d\.\s|[A-Z][\w /-]{2,40}:\s*$)/;

/** Bullet or numbered items under an "Acceptance criteria" line. Stops at the next heading or prose. */
export function parseAcceptanceCriteria(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => AC_HEADING.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  let indent = -1; // sub-bullets stay part of their parent criterion
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    const item = line.match(ITEM);
    const depth = line.length - line.trimStart().length;
    if (item && (indent < 0 || depth <= indent)) {
      indent = indent < 0 ? depth : indent;
      out.push(item[1].trim());
    } else if (item) continue;
    else if (out.length > 0 || OTHER_HEADING.test(line)) break;
  }
  return out;
}

/** Items from a free-form custom field value (string or ADF). */
function criteriaFromField(value: unknown): string[] {
  const text = adfToText(value);
  const items = text.split("\n").map((l) => l.match(ITEM)?.[1] ?? l).map((l) => l.trim());
  return items.filter(Boolean);
}

/** Browse URL from the issue's REST self link, when it points at the site. */
function browseUrl(self: unknown, key: string) {
  try {
    const u = new URL(String(self));
    return u.hostname.endsWith(".atlassian.net") ? `${u.origin}/browse/${key}` : undefined;
  } catch {
    return undefined;
  }
}

/** Read an issue as the app. Throws on HTTP errors. */
export async function readIssue(key: string): Promise<JiraIssue> {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}?expand=names`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`jira issue ${key} -> ${res.status}`);
  const issue = await res.json();
  const fields = issue.fields ?? {};
  const description = adfToText(fields.description);
  let acceptanceCriteria = parseAcceptanceCriteria(description);
  if (acceptanceCriteria.length === 0) {
    const names: Record<string, string> = issue.names ?? {};
    const acField = Object.keys(names).find((id) => /acceptance criteria/i.test(names[id]) && fields[id]);
    if (acField) acceptanceCriteria = criteriaFromField(fields[acField]);
  }
  const a = fields.assignee;
  return {
    key: issue.key ?? key,
    summary: fields.summary ?? "",
    description,
    acceptanceCriteria,
    assignee: a?.accountId ? { accountId: a.accountId, displayName: a.displayName ?? "" } : undefined,
    url: browseUrl(issue.self, issue.key ?? key),
  };
}

export type RemoteLink = { url: string; title: string; globalId?: string; appType?: string };

/** Remote links on an issue (Confluence pages, web links). Returns [] on failure. */
export async function readRemoteLinks(key: string): Promise<RemoteLink[]> {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}/remotelink`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`jira remote links ${key} -> ${res.status}`);
  const links: any[] = await res.json();
  return links
    .filter((l) => l?.object?.url)
    .map((l) => ({
      url: String(l.object.url),
      title: String(l.object.title ?? ""),
      globalId: l.globalId,
      appType: l.application?.type,
    }));
}
