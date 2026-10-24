import api, { route } from "@forge/api";
import type { ConfluencePage } from "../contracts/index";
import type { RemoteLink } from "./jira";

// Confluence reads for ingest: pages linked from the Jira issue, as short plain-text excerpts.

export const EXCERPT_CHARS = 2000;
const MAX_PAGES = 5;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Confluence storage format (XHTML) -> plain text. */
export function storageToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|h\d|li|tr|div|ul|ol|table)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Page id from a Confluence link: /wiki/spaces/X/pages/<id>/..., ?pageId=<id>, or the app link globalId. */
export function confluencePageId(link: RemoteLink, siteHost?: string): string | undefined {
  const fromGlobal = link.globalId?.match(/pageId=(\d+)/)?.[1];
  if (fromGlobal && link.appType === "com.atlassian.confluence") return fromGlobal;
  let u: URL;
  try {
    u = new URL(link.url);
  } catch {
    return undefined;
  }
  if (siteHost ? u.hostname !== siteHost : !u.hostname.endsWith(".atlassian.net")) return undefined;
  if (!u.pathname.startsWith("/wiki/")) return undefined;
  return u.pathname.match(/\/pages\/(\d+)/)?.[1] ?? u.searchParams.get("pageId") ?? fromGlobal;
}

/** One page by id, v2 API, body as storage. Throws on HTTP errors. */
export async function readPage(id: string, fallbackUrl?: string): Promise<ConfluencePage> {
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${id}?body-format=storage`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`confluence page ${id} -> ${res.status}`);
  const page = await res.json();
  const text = storageToText(page.body?.storage?.value ?? "");
  const base = page._links?.base;
  const webui = page._links?.webui;
  return {
    id: String(page.id ?? id),
    title: page.title ?? "",
    excerpt: text.length > EXCERPT_CHARS ? text.slice(0, EXCERPT_CHARS - 1) + "…" : text,
    url: base && webui ? `${base}${webui}` : fallbackUrl,
  };
}

/** Pages behind the issue's Confluence remote links. Skips links that fail; reports them in `errors`. */
export async function readLinkedPages(links: RemoteLink[], siteHost?: string) {
  const ids = new Map<string, string>();
  for (const l of links) {
    const id = confluencePageId(l, siteHost);
    if (id && !ids.has(id)) ids.set(id, l.url);
  }
  const pages: ConfluencePage[] = [];
  const errors: string[] = [];
  for (const [id, url] of [...ids].slice(0, MAX_PAGES)) {
    try {
      pages.push(await readPage(id, url));
    } catch (e) {
      errors.push(String((e as Error).message ?? e));
    }
  }
  return { pages, errors };
}
