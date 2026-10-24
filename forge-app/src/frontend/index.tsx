import React, { useEffect, useState } from "react";
import ForgeReconciler, { EmptyState, Heading, Lozenge, Spinner, Stack, Tab, TabList, TabPanel, Tabs, Text } from "@forge/react";
import { invoke } from "@forge/bridge";

// The PR Confidence issue panel. Layout from docs/SPEC.md section 6.
// UI Kit only: no <div>, no third-party React components.
type Detail = { session: { status: string; prNumber: number; recommendation?: string } } | null;

const App = () => {
  const [detail, setDetail] = useState<Detail | undefined>(undefined);

  useEffect(() => {
    const load = () => invoke<Detail>("getSession").then((d) => setDetail(d as Detail));
    load();
    const t = setInterval(load, 2000); // poll; runner events land in KVS
    return () => clearInterval(t);
  }, []);

  if (detail === undefined) return <Spinner />;
  if (detail === null)
    return <EmptyState header="No PR yet" description="Open a PR with this issue key in its title or branch." />;

  return (
    <Stack space="space.200">
      <Heading size="small">PR #{detail.session.prNumber}</Heading>
      <Lozenge appearance="inprogress">{detail.session.recommendation ?? detail.session.status}</Lozenge>
      <Tabs id="pr-confidence-tabs">
        <TabList>
          <Tab>Acceptance criteria</Tab>
          <Tab>Live sandbox</Tab>
          <Tab>Tests</Tab>
          <Tab>Activity</Tab>
        </TabList>
        <TabPanel><Text>TODO(A): AC checklist with VERIFIED / FAILED / UNTESTED.</Text></TabPanel>
        <TabPanel><Text>TODO(A): knobs, reset, embedded live view (or Open in new tab), ask box.</Text></TabPanel>
        <TabPanel><Text>TODO(A): DynamicTable of scenarios with base / PR lozenges and evidence links.</Text></TabPanel>
        <TabPanel><Text>TODO(A): timeline + audit log.</Text></TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
