import React, { useState } from "react";
import { Button, Inline, SectionMessage, Stack, Text } from "@forge/react";
import type { SessionDetail } from "../../contracts";
import { regressionHeadline } from "../../lib/honest";
import { hasRegression, regressions, scenarioName } from "../ui";

type Props = {
  detail: SessionDetail;
  onFileBug: (scenarioId: string) => Promise<boolean>;
  onMoveBack: () => Promise<boolean>;
};

const filedFor = (d: SessionDetail, scenarioId: string) =>
  d.audit.some((a) => a.action === "jira.bug" && a.result === "ok" && JSON.stringify(a.inputs ?? "").includes(scenarioId));

const movedBack = (d: SessionDetail) => d.audit.some((a) => a.action === "jira.transition" && a.result === "ok");

// Only shown when the report has a regression. Each click is the human approval for that write.
export const Regression = ({ detail, onFileBug, onMoveBack }: Props) => {
  const [busy, setBusy] = useState<string | null>(null);
  if (!hasRegression(detail)) return null;

  const run = async (key: string, fn: () => Promise<boolean>) => {
    setBusy(key);
    await fn();
    setBusy(null);
  };

  return (
    <SectionMessage appearance="error" title="New regression found">
      <Stack space="space.100">
        {regressions(detail).map((id) => (
          <Inline key={id} space="space.100" alignBlock="center" spread="space-between">
            <Stack space="space.025">
              <Text weight="bold">{regressionHeadline(detail.scenarios.find((s) => s.id === id), detail.runs, id)}</Text>
              <Text size="small">
                {id}: {scenarioName(detail, id)}
              </Text>
            </Stack>
            <Button
              appearance="danger"
              onClick={() => run(id, () => onFileBug(id))}
              isDisabled={busy !== null || filedFor(detail, id)}
            >
              {filedFor(detail, id) ? "Bug filed" : busy === id ? "Filing…" : "File Bug"}
            </Button>
          </Inline>
        ))}
        <Inline>
          <Button onClick={() => run("move", onMoveBack)} isDisabled={busy !== null || movedBack(detail)}>
            {movedBack(detail) ? "Moved to In Progress" : busy === "move" ? "Moving…" : "Move back to In Progress"}
          </Button>
        </Inline>
      </Stack>
    </SectionMessage>
  );
};
