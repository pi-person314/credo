import React from "react";
import { Inline, Link, Lozenge, Stack, Text } from "@forge/react";
import type { IngestSummary } from "../../lib/ingest-summary";
import type { Appearance } from "../ui";

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const Row = ({ label, look, children }: { label: string; look: Appearance; children: React.ReactNode }) => (
  <Inline space="space.100" alignBlock="center" shouldWrap>
    <Lozenge appearance={look}>{label}</Lozenge>
    {children}
  </Inline>
);

// What ingest read for this session, from ingest:<id> (never scrolls out like the event timeline).
export const Sources = ({ ingest }: { ingest?: IngestSummary }) => {
  if (!ingest) return <Text size="small">Sources: still reading the ticket, Confluence, the PR and Greptile…</Text>;
  const { jira, confluence, pr, greptile } = ingest;
  return (
    <Stack space="space.050">
      <Text weight="medium">Sources</Text>
      <Row label="Jira" look={jira.error ? "removed" : "success"}>
        <Text size="small">{jira.error ? `${jira.key}: could not read (${jira.error})` : `${jira.key} + ${n(jira.criteria, "acceptance criterion", "acceptance criteria")}`}</Text>
      </Row>
      <Row label="Confluence" look={confluence.errors.length ? "removed" : confluence.pages.length ? "success" : "default"}>
        {confluence.pages.map((p, i) =>
          p.url ? (
            <Link key={`${p.title}-${i}`} href={p.url} openNewTab>
              {p.title || "Untitled page"}
            </Link>
          ) : (
            <Text key={`${p.title}-${i}`} size="small">
              {p.title || "Untitled page"}
            </Text>
          ),
        )}
        {confluence.pages.length === 0 && confluence.errors.length === 0 ? <Text size="small">none linked</Text> : null}
        {confluence.errors.length ? <Text size="small">failed: {confluence.errors.join("; ")}</Text> : null}
      </Row>
      <Row label="PR" look={pr.error ? "removed" : "success"}>
        <Text size="small">
          {pr.error ? `could not read files (${pr.error})` : n(pr.files, "changed file")}
          {pr.manifest === "default" ? " · no manifest.json, demo manifest used" : ""}
        </Text>
      </Row>
      <Row label="Greptile" look={greptile.errors.length ? "removed" : greptile.findings ? "success" : "default"}>
        <Text size="small">
          {n(greptile.findings, "finding")}
          {greptile.errors.length ? ` · failed: ${greptile.errors.join("; ")}` : ""}
        </Text>
      </Row>
    </Stack>
  );
};
