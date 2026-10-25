import React from "react";
import { EmptyState, Inline, Lozenge, Stack, Text } from "@forge/react";
import type { PanelDetail } from "../api";
import { coverageLook, scenarioName } from "../ui";
import { Sources } from "./Sources";

// What ingest read, then one row per acceptance criterion with its coverage and the scenarios behind it.
export const Criteria = ({ detail }: { detail: PanelDetail }) => {
  const rows = detail.report?.coverage ?? [];
  if (rows.length === 0)
    return (
      <Stack space="space.200">
        <Sources ingest={detail.ingest} />
        <EmptyState header="No coverage yet" description="Acceptance criteria appear here once the first report is ready." />
      </Stack>
    );
  return (
    <Stack space="space.150">
      <Sources ingest={detail.ingest} />
      {rows.map((ac) => (
        <Stack key={ac.index} space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance={coverageLook[ac.status]}>{ac.status}</Lozenge>
            <Text weight="medium">
              AC{ac.index}. {ac.text}
            </Text>
          </Inline>
          {ac.scenarioIds.length ? (
            <Text size="small">Scenarios: {ac.scenarioIds.map((id) => scenarioName(detail, id)).join(" · ")}</Text>
          ) : (
            <Text size="small">No scenario points at this criterion.</Text>
          )}
        </Stack>
      ))}
    </Stack>
  );
};
