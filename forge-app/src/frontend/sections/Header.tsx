import React from "react";
import { Button, Heading, Inline, Link, Lozenge, Stack, Text } from "@forge/react";
import type { Event, SessionDetail } from "../../contracts";
import { isActive, sandboxLook, sandboxState, verdictLook, verdictText } from "../ui";

type Props = {
  detail: SessionDetail;
  events: Event[];
  busy: string | null;
  onReset: () => void;
  canReset: boolean;
  onRerun: () => void;
  canRerun: boolean;
};

// Verdict, PR link, pipeline + sandbox status, what the runner is busy with, Reset, Run again.
export const Header = ({ detail, events, busy, onReset, canReset, onRerun, canRerun }: Props) => {
  const { session } = detail;
  const verdict = detail.report?.recommendation ?? session.recommendation;
  const sandbox = sandboxState(events);
  return (
    <Stack space="space.100">
      <Inline spread="space-between" alignBlock="center">
        <Heading size="small">
          PR #{session.prNumber}: {session.title}
        </Heading>
        <Inline space="space.050">
          <Button appearance="subtle" iconBefore="refresh" onClick={onReset} isDisabled={!canReset}>
            Reset
          </Button>
          <Button appearance="subtle" iconBefore="vid-play" onClick={onRerun} isDisabled={!canRerun}>
            {canRerun ? "Run again" : "Starting…"}
          </Button>
        </Inline>
      </Inline>
      <Inline space="space.100" alignBlock="center" shouldWrap>
        {verdict ? (
          <Lozenge appearance={verdictLook[verdict]} isBold>
            {verdictText[verdict]}
          </Lozenge>
        ) : (
          <Lozenge appearance="inprogress">Verifying</Lozenge>
        )}
        <Lozenge appearance={isActive(session.status) ? "inprogress" : session.status === "FAILED" ? "removed" : "success"}>
          {session.status}
        </Lozenge>
        {busy ? <Lozenge appearance="inprogress">{busy}</Lozenge> : null}
        <Text>Sandbox</Text>
        <Lozenge appearance={sandboxLook[sandbox]}>{sandbox}</Lozenge>
        {session.prUrl ? (
          <Link href={session.prUrl} openNewTab>
            {session.repo}#{session.prNumber}
          </Link>
        ) : (
          <Text>{session.repo}</Text>
        )}
      </Inline>
      {session.error ? <Text>Error: {session.error}</Text> : null}
    </Stack>
  );
};
