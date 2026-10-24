import React from "react";
import { DynamicTable, EmptyState, Heading, Inline, Lozenge, Stack, Text } from "@forge/react";
import type { AuditEntry, Event } from "../../contracts";
import { eventLook, shortTime } from "../ui";

const MAX_EVENTS = 60;

const auditLook: Record<AuditEntry["result"], "success" | "removed" | "moved"> = {
  ok: "success",
  failed: "removed",
  proposed: "moved",
};

const auditHead = {
  cells: [
    { key: "ts", content: "When", isSortable: true },
    { key: "action", content: "Action" },
    { key: "target", content: "Target" },
    { key: "why", content: "Reason" },
    { key: "by", content: "Approved by" },
    { key: "result", content: "Result" },
  ],
};

const Timeline = ({ events }: { events: Event[] }) => {
  if (events.length === 0) return <Text>No events yet.</Text>;
  return (
    <Stack space="space.075">
      {events
        .slice(-MAX_EVENTS)
        .reverse()
        .map((e, i) => (
          <Inline key={`${e.ts}-${i}`} space="space.100" alignBlock="center">
            <Text size="small">{shortTime(e.ts)}</Text>
            <Lozenge appearance={eventLook[e.status]}>{e.type}</Lozenge>
            <Text size="small">
              {e.actor}: {e.message}
            </Text>
          </Inline>
        ))}
    </Stack>
  );
};

// Timeline of every pipeline event, then the audit log of every write the agent made or proposed.
export const Activity = ({ events, audit }: { events: Event[]; audit: AuditEntry[] }) => (
  <Stack space="space.300">
    <Stack space="space.100">
      <Heading size="xsmall">Timeline</Heading>
      <Timeline events={events} />
    </Stack>
    <Stack space="space.100">
      <Heading size="xsmall">Audit log</Heading>
      {audit.length ? (
        <DynamicTable
          head={auditHead}
          defaultSortKey="ts"
          defaultSortOrder="DESC"
          rows={audit.map((a, i) => ({
            key: `${a.ts}-${i}`,
            cells: [
              { key: a.ts, content: <Text size="small">{shortTime(a.ts)}</Text> },
              { key: "action", content: a.action },
              { key: "target", content: a.target },
              { key: "why", content: a.reason },
              { key: "by", content: a.approvedBy ?? "—" },
              { key: "result", content: <Lozenge appearance={auditLook[a.result]}>{a.result}</Lozenge> },
            ],
          }))}
        />
      ) : (
        <EmptyState header="No writes yet" description="Comments, bugs and transitions the agent makes show up here." />
      )}
    </Stack>
  </Stack>
);
