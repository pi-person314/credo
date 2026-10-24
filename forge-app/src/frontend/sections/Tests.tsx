import React from "react";
import { DynamicTable, EmptyState, Inline, Link, Lozenge, Stack, Text } from "@forge/react";
import type { AssertionResult, Env, Run, SessionDetail } from "../../contracts";
import { artifactUrl, diffLook, resultLook } from "../ui";

type Props = { detail: SessionDetail; viewUrl: string | null };

const head = {
  cells: [
    { key: "scenario", content: "Scenario", isSortable: true },
    { key: "base", content: "Base" },
    { key: "head", content: "PR" },
    { key: "diff", content: "Result", isSortable: true },
    { key: "evidence", content: "Evidence" },
  ],
};

/** Last attempt of a scenario on one env. */
const latestRun = (runs: Run[], scenarioId: string, env: Env) =>
  runs.filter((r) => r.scenarioId === scenarioId && r.env === env).sort((a, b) => b.attempt - a.attempt)[0];

const Result = ({ value }: { value?: AssertionResult }) =>
  value ? <Lozenge appearance={resultLook[value]}>{value}</Lozenge> : <Lozenge>pending</Lozenge>;

const Evidence = ({ runs, url }: { runs: (Run | undefined)[]; url: (path: string) => string | null }) => {
  const links = runs.flatMap((r) =>
    r ? r.artifacts.map((a) => ({ key: `${r.id}:${a.path}`, label: `${r.env} ${a.kind}`, href: url(a.path) })) : [],
  );
  if (links.length === 0) return <Text>—</Text>;
  return (
    <Inline space="space.100" shouldWrap>
      {links.map((l) => (l.href ? <Link key={l.key} href={l.href} openNewTab>{l.label}</Link> : <Text key={l.key}>{l.label}</Text>))}
    </Inline>
  );
};

// Scenario table: base and PR results side by side, the diff class, and evidence files.
export const Tests = ({ detail, viewUrl }: Props) => {
  const ids = [...new Set([...detail.scenarios.map((s) => s.id), ...detail.diffs.map((d) => d.scenarioId)])];
  if (ids.length === 0)
    return <EmptyState header="No scenarios yet" description="The planner is still choosing what to test." />;

  const url = (path: string) => artifactUrl(viewUrl, detail.session.id, path);
  const rows = ids.map((id) => {
    const scenario = detail.scenarios.find((s) => s.id === id);
    const diff = detail.diffs.find((d) => d.scenarioId === id);
    const base = latestRun(detail.runs, id, "base");
    const pr = latestRun(detail.runs, id, "head");
    return {
      key: id,
      isHighlighted: diff?.classification === "NEW_REGRESSION",
      cells: [
        {
          key: scenario?.objective ?? id,
          content: (
            <Stack space="space.025">
              <Text>{scenario?.objective ?? id}</Text>
              <Text size="small">
                {id}
                {scenario ? ` · ${scenario.origin} · ${scenario.priority}` : ""}
              </Text>
            </Stack>
          ),
        },
        { key: "base", content: <Result value={diff?.base ?? base?.status} /> },
        { key: "head", content: <Result value={diff?.head ?? pr?.status} /> },
        {
          key: diff?.classification ?? "~",
          content: diff ? <Lozenge appearance={diffLook[diff.classification]}>{diff.classification}</Lozenge> : <Text>running</Text>,
        },
        { key: "evidence", content: <Evidence runs={[base, pr]} url={url} /> },
      ],
    };
  });

  return <DynamicTable head={head} rows={rows} rowsPerPage={10} />;
};
