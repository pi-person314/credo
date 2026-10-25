import React, { useState } from "react";
import { Button, ErrorMessage, Inline, Label, Lozenge, Stack, Text, TextArea } from "@forge/react";
import type { SessionDetail } from "../../contracts";
import { isVagueAsk, VAGUE_ASK } from "../../lib/honest";
import { askLabel, askLook, type AskState } from "../progress";

type Props = {
  detail: SessionDetail;
  states: Map<string, AskState>;
  disabled: boolean;
  /** Resolves to null when the ask was queued, or the reason it was refused (shown under the box). */
  onAsk: (prompt: string) => Promise<string | null>;
};

const MAX_ASKS = 8;

// Plain-English test request -> new scenario -> runs on base and PR -> new row in Tests.
export const Ask = ({ detail, states, disabled, onAsk }: Props) => {
  // The box is uncontrolled (defaultValue, no value prop). A controlled UI Kit TextArea echoes every keystroke
  // back through the bridge as a new `value`; under fast typing a stale echo overwrites newer keystrokes.
  // `prompt` only mirrors what was typed; bumping `box` remounts the box empty after a successful send.
  const [prompt, setPrompt] = useState("");
  const [box, setBox] = useState(0);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const text = prompt.trim();

  const send = async () => {
    if (isVagueAsk(text)) return setRefusal(VAGUE_ASK);
    setSending(true);
    const error = await onAsk(text);
    setSending(false);
    setRefusal(error);
    if (!error) {
      setPrompt("");
      setBox((n) => n + 1);
    }
  };

  return (
    <Stack space="space.100">
      <Label labelFor="ask-box">Ask for a test</Label>
      <TextArea
        key={`ask-box-${box}`}
        id="ask-box"
        placeholder="What if the provider times out and the user retries?"
        defaultValue=""
        maxLength={500}
        isInvalid={refusal !== null}
        onChange={(e) => {
          setPrompt(String(e.target.value));
          setRefusal(null);
        }}
        isDisabled={disabled || sending}
      />
      {refusal ? <ErrorMessage>{refusal}</ErrorMessage> : null}
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
