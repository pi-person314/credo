import React, { useState } from "react";
import { Button, Inline, Label, Stack, Text, TextArea } from "@forge/react";
import type { SessionDetail } from "../../contracts";

type Props = { detail: SessionDetail; disabled: boolean; onAsk: (prompt: string) => Promise<boolean> };

// Plain-English test request -> new scenario -> runs on base and PR -> new row in Tests.
export const Ask = ({ detail, disabled, onAsk }: Props) => {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const text = prompt.trim();

  const send = async () => {
    setSending(true);
    const ok = await onAsk(text);
    setSending(false);
    if (ok) setPrompt("");
  };

  return (
    <Stack space="space.100">
      <Label labelFor="ask-box">Ask for a test</Label>
      <TextArea
        id="ask-box"
        placeholder="What if the provider times out and the user retries?"
        value={prompt}
        maxLength={500}
        onChange={(e) => setPrompt(String(e.target.value))}
        isDisabled={disabled || sending}
      />
      <Inline spread="space-between" alignBlock="center">
        <Text size="small">Runs on both the old and new code. {detail.asks.length} asked so far.</Text>
        <Button appearance="primary" onClick={send} isDisabled={disabled || sending || !text}>
          {sending ? "Sending…" : "Run test"}
        </Button>
      </Inline>
      {detail.asks.length ? (
        <Stack space="space.050">
          {detail.asks
            .slice(-5)
            .reverse()
            .map((a) => (
              <Text key={a.id} size="small">
                “{a.prompt}”{a.scenarioId ? ` → ${a.scenarioId}` : " → planning…"}
              </Text>
            ))}
        </Stack>
      ) : null}
    </Stack>
  );
};
