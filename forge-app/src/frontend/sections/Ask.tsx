import React, { useState } from "react";
import { Button, Inline, Label, Lozenge, Stack, Text, TextArea } from "@forge/react";
import type { SessionDetail } from "../../contracts";
import { askLabel, askLook, type AskState } from "../progress";

type Props = { detail: SessionDetail; states: Map<string, AskState>; disabled: boolean; onAsk: (prompt: string) => Promise<boolean> };

const MAX_ASKS = 8;

// Plain-English test request -> new scenario -> runs on base and PR -> new row in Tests.
export const Ask = ({ detail, states, disabled, onAsk }: Props) => {
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
        <Text size="small">Runs on both the old and new code, one ask at a time. {detail.asks.length} asked so far.</Text>
        <Button appearance="primary" onClick={send} isDisabled={disabled || sending || !text}>
          {sending ? "Sending…" : "Run test"}
        </Button>
      </Inline>
      {detail.asks.length ? (
        <Stack space="space.075">
          {detail.asks
            .slice(-MAX_ASKS)
            .reverse()
            .map((a) => {
              const st = states.get(a.id) ?? { kind: "queued", ahead: 0 };
              return (
                <Inline key={a.id} space="space.100" alignBlock="center" shouldWrap>
                  {/* Lozenges truncate, so a failure's reason goes in the text next to it. */}
                  <Lozenge appearance={askLook(st)}>{st.kind === "failed" ? "Failed" : askLabel(st)}</Lozenge>
                  <Text size="small">
                    “{a.prompt}”{st.kind === "failed" ? ` · ${askLabel(st)}` : ""}
                    {a.scenarioId && st.kind === "done" ? ` → ${a.scenarioId}` : ""}
                  </Text>
                </Inline>
              );
            })}
        </Stack>
      ) : null}
    </Stack>
  );
};
