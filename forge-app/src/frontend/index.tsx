import React, { useState } from "react";
import ForgeReconciler, {
  Button,
  EmptyState,
  Inline,
  SectionMessage,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from "@forge/react";
import type { Knobs } from "../contracts";
import * as api from "./api";
import { isRunnerGone, progress, sandboxesExpired } from "./progress";
import { usePanel } from "./usePanel";
import { sandboxState } from "./ui";
import { Activity } from "./sections/Activity";
import { Ask } from "./sections/Ask";
import { Criteria } from "./sections/Criteria";
import { Header } from "./sections/Header";
import { Regression } from "./sections/Regression";
import { Sandbox } from "./sections/Sandbox";
import { Tests } from "./sections/Tests";

// The Credo issue panel. Layout from docs/SPEC.md section 6.
// UI Kit only: no <div>, no third-party React components.
const RERUN_WAIT_MS = 60_000;
type Notice = { kind: "success" | "error"; text: string } | null;

const Loading = () => (
  <Inline space="space.100" alignBlock="center">
    <Spinner size="small" label="Loading" />
    <Text>Loading Credo…</Text>
  </Inline>
);

const App = () => {
  const { detail, events, viewUrl, error, reconnecting, kick, retry } = usePanel();
  const [notice, setNotice] = useState<Notice>(null);
  const [resetting, setResetting] = useState(false);
  // Run again was clicked on this session at this time; the button waits for the new session (or a minute).
  const [rerunFrom, setRerunFrom] = useState<{ id: string; at: number } | null>(null);
  // Set when a runner call came back 404 (runner forgot the session): which session, and the event count then.
  const [gone, setGone] = useState<{ id: string; at: number } | null>(null);

  if (detail === undefined)
    return error ? (
      <SectionMessage appearance="error" title="Could not load Credo">
        <Stack space="space.100">
          <Text>{error}</Text>
          <Inline>
            <Button onClick={retry}>Retry</Button>
          </Inline>
        </Stack>
      </SectionMessage>
    ) : (
      <Loading />
    );
  if (detail === null)
    return <EmptyState header="No PR yet" description="Open a PR with this issue key in its title or branch." />;

  const id = detail.session.id;
  // Sandboxes torn down (teardown event, or a runner 404 with no rebuild since): show the notice, lock the controls.
  const torn = sandboxesExpired(events);
  const lost = gone?.id === id && !events.slice(gone.at).some((e) => e.type === "sandbox.building" || e.type === "sandbox.healthy");
  const expired = torn.expired ? { reason: torn.reason } : lost ? {} : null;
  // No sandbox events yet (older sessions, events not wired): don't lock the controls.
  const sandboxUp = !expired && (sandboxState(events) === "healthy" || !events.some((e) => e.type.startsWith("sandbox.")));
  const { asks: askStates, busy } = progress(detail, events);

  /** Runs one resolver call, shows the outcome, then polls fast so the result lands quickly. */
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setNotice({ kind: "success", text: ok });
      kick();
      return true;
    } catch (e) {
      const text = api.errorText(e);
      if (isRunnerGone(text)) setGone({ id, at: events.length });
      setNotice({ kind: "error", text });
      return false;
    }
  };

  const onReset = async () => {
    setResetting(true);
    await act(() => api.reset(id), "Both sandboxes reseeded to the same fixture.");
    setResetting(false);
  };
  const rerunning = rerunFrom?.id === id && Date.now() - rerunFrom.at < RERUN_WAIT_MS;
  const onRerun = async () => {
    setRerunFrom({ id, at: Date.now() });
    const ok = await act(() => api.rerun(id), "Starting a fresh run on the same commit. The panel switches to it in a few seconds.");
    if (!ok) setRerunFrom(null);
  };
  const onKnobs = async (k: Knobs) => {
    await act(() => api.setKnobs(id, k), `Provider set to ${k.provider} (${k.latencyMs} ms) on both sandboxes.`);
  };
  // Ask refusals (e.g. a vague request) show under the ask box, not as a notice at the top.
  const onAsk = async (prompt: string) => {
    try {
      await api.ask(id, prompt);
      setNotice({ kind: "success", text: "Test requested. It will show up under Tests." });
      kick();
      return null;
    } catch (e) {
      const text = api.errorText(e);
      if (isRunnerGone(text)) setGone({ id, at: events.length });
      return text;
    }
  };
  const onFileBug = (scenarioId: string) => act(() => api.fileBug(id, scenarioId), "Bug filed and linked to this issue.");
  const onMoveBack = () => act(() => api.approveTransition(id), "Issue moved back to In Progress.");

  return (
    <Stack space="space.200">
      <Header
        detail={detail}
        events={events}
        busy={busy}
        onReset={onReset}
        canReset={sandboxUp && !resetting}
        onRerun={onRerun}
        canRerun={!rerunning}
      />
      {reconnecting ? (
        <SectionMessage appearance="warning" title="Reconnecting…">
          <Stack space="space.100">
            <Text>Showing the last data we loaded. {error ? `Last error: ${error}` : ""}</Text>
            <Inline>
              <Button onClick={retry}>Retry now</Button>
            </Inline>
          </Stack>
        </SectionMessage>
      ) : null}
      {notice ? (
        <SectionMessage appearance={notice.kind === "success" ? "success" : "error"}>
          <Text>{notice.text}</Text>
        </SectionMessage>
      ) : null}
      <Regression detail={detail} onFileBug={onFileBug} onMoveBack={onMoveBack} />
      <Tabs id="pr-confidence-tabs">
        <TabList>
          <Tab>Acceptance criteria</Tab>
          <Tab>Live sandbox</Tab>
          <Tab>Tests</Tab>
          <Tab>Activity</Tab>
        </TabList>
        <TabPanel>
          <Criteria detail={detail} />
        </TabPanel>
        <TabPanel>
          <Sandbox
            viewUrl={viewUrl}
            disabled={!sandboxUp || resetting}
            expired={expired}
            onKnobs={onKnobs}
            onReset={onReset}
            onRerun={onRerun}
            canRerun={!rerunning}
          />
        </TabPanel>
        <TabPanel>
          <Stack space="space.300">
            <Tests detail={detail} viewUrl={viewUrl} />
            <Ask detail={detail} states={askStates} disabled={!sandboxUp} onAsk={onAsk} />
          </Stack>
        </TabPanel>
        <TabPanel>
          <Activity events={events} audit={detail.audit} />
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
