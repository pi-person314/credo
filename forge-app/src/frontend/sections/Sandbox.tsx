import React, { useState } from "react";
import { Box, Button, Frame, Inline, Label, LinkButton, SectionMessage, Select, Stack, Text, Textfield, Toggle, xcss } from "@forge/react";
import type { Knobs, ProviderMode } from "../../contracts";

type Props = {
  viewUrl: string | null;
  disabled: boolean;
  /** Set when the runner tore the sandboxes down (reason = what it said, e.g. "Idle for 30 min: ...") or forgot the session (no reason). */
  expired: { reason?: string } | null;
  onKnobs: (k: Knobs) => Promise<void>;
  onReset: () => void;
  onRerun: () => void;
  canRerun: boolean;
};

const MODES: ProviderMode[] = ["ok", "slow", "timeout", "error"];
const options = MODES.map((m) => ({ label: m, value: m }));

// Knobs (always hit both sandboxes), Reset, and the runner's live view.
// The embed is a Custom UI resource ("live-view") inside UI Kit <Frame>; the link is the fallback.
export const Sandbox = ({ viewUrl, disabled, expired, onKnobs, onReset, onRerun, canRerun }: Props) => {
  const [provider, setProvider] = useState<ProviderMode>("ok");
  const [latency, setLatency] = useState("0");
  const [embed, setEmbed] = useState(true);
  const [saving, setSaving] = useState(false);
  const latencyMs = Math.max(0, Math.min(30_000, Number.parseInt(latency, 10) || 0));

  const apply = async () => {
    setSaving(true);
    await onKnobs({ provider, latencyMs }).finally(() => setSaving(false));
  };

  // Torn down: the runner forgot the session, so knobs and the live view can't work. Keep the link as a fallback.
  if (expired)
    return (
      <Stack space="space.200">
        <SectionMessage appearance="information" title="Sandboxes are shut down">
          <Stack space="space.050">
            <Text>{expired.reason ?? "The runner no longer has this session (it may have restarted)."}</Text>
            <Text size="small">Run again to rebuild them on the same commit.</Text>
          </Stack>
        </SectionMessage>
        <Inline space="space.100">
          <Button appearance="primary" iconBefore="vid-play" onClick={onRerun} isDisabled={!canRerun}>
            {canRerun ? "Run again" : "Starting…"}
          </Button>
          {viewUrl ? (
            <LinkButton href={viewUrl} target="_blank">
              Open live sandbox
            </LinkButton>
          ) : null}
        </Inline>
      </Stack>
    );

  // The embedded live view has its own knobs and reset, which show the current value, so don't repeat them here.
  const embedded = embed && !!viewUrl;
  // Stacks hug their content by default, so without "fill" the embed shrinks to the width of the row above it.
  return (
    <Stack space="space.200" grow="fill">
      {embedded ? null : <Inline space="space.200" alignBlock="end" shouldWrap>
        <Stack space="space.050">
          <Label labelFor="knob-provider">Payment provider</Label>
          <Select
            inputId="knob-provider"
            options={options}
            value={options.find((o) => o.value === provider)}
            onChange={(o: { value: ProviderMode } | null) => o && setProvider(o.value)}
            isDisabled={disabled}
          />
        </Stack>
        <Stack space="space.050">
          <Label labelFor="knob-latency">Latency (ms)</Label>
          <Textfield
            id="knob-latency"
            type="number"
            min={0}
            max={30000}
            value={latency}
            onChange={(e) => setLatency(String(e.target.value))}
            isDisabled={disabled}
          />
        </Stack>
        <Button appearance="primary" onClick={apply} isDisabled={disabled || saving}>
          {saving ? "Applying…" : "Apply to both"}
        </Button>
        <Button iconBefore="refresh" onClick={onReset} isDisabled={disabled}>
          Reset sandboxes
        </Button>
      </Inline>}
      <Inline space="space.200" alignBlock="center" shouldWrap>
        {viewUrl ? (
          <LinkButton href={viewUrl} target="_blank">
            Open live sandbox
          </LinkButton>
        ) : (
          <Text>Live view link appears when the sandboxes are up.</Text>
        )}
        <Toggle id="embed-live" isChecked={embed} onChange={() => setEmbed(!embed)} label="Embed live view" />
        <Text size="small">Embed live view</Text>
      </Inline>
      {embedded ? (
        <Box xcss={xcss({ width: "100%" })}>
          <Frame resource="live-view" height="520px" />
        </Box>
      ) : null}
    </Stack>
  );
};
