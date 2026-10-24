import React from "react";
import { Button, Heading, Inline, Link, Lozenge, Stack, Text } from "@forge/react";
import type { Event, SessionDetail } from "../../contracts";
import { isActive, sandboxLook, sandboxState, verdictLook, verdictText } from "../ui";

type Props = { detail: SessionDetail; events: Event[]; onReset: () => void; resetting: boolean };

// Verdict, PR link, pipeline + sandbox status, Reset.
export const Header = ({ detail, events, onReset, resetting }: Props) => {
  const { session } = detail;
  const verdict = detail.report?.recommendation ?? session.recommendation;
  const sandbox = sandboxState(events);
  return (
    <Stack space="space.100">
      <Inline spread="space-between" alignBlock="center">
        <Heading size="small">
          PR #{session.prNumber}: {session.title}
        </Heading>
        <Button appearance="subtle" iconBefore="refresh" onClick={onReset} isDisabled={resetting || sandbox !== "healthy"}>
          Reset
        </Button>
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
