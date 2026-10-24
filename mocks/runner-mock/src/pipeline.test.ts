import { describe, expect, it } from "vitest";
import { Diff, Run, type Event } from "@pr-agent/contracts";
import { memoryEmitter } from "./emitter.js";
import { parseEnv } from "./env.js";
import { canned, runAsk, runSession, waiter } from "./pipeline.js";

const shas = { base: "a".repeat(40), head: "b".repeat(40) };

describe("canned session", () => {
  it("emits the spec sequence with one NEW_REGRESSION", async () => {
    const events: Event[] = [];
    await runSession(memoryEmitter("ses_t", events), waiter(0), "ses_t", shas, 3);
    const types = events.map((e) => e.type);
    expect(types.slice(0, 5)).toEqual(["sandbox.building", "sandbox.building", "sandbox.healthy", "sandbox.healthy", "planner.started"]);
    expect(types.at(-1)).toBe("session.complete");
    const diffs = events.filter((e) => e.type === "verify.diff").map((e) => Diff.parse(e.data));
    expect(diffs).toHaveLength(canned.length);
    expect(diffs.filter((d) => d.classification === "NEW_REGRESSION")).toHaveLength(1);
    expect(diffs.filter((d) => d.classification === "UNCHANGED_PASS")).toHaveLength(canned.length - 1);
    for (const e of events.filter((e) => e.type === "run.finished")) Run.parse(e.data);
  });

  it("ask ends with ask.complete", async () => {
    const events: Event[] = [];
    await runAsk(memoryEmitter("ses_t", events), waiter(0), "ses_t", shas, "ask_1", "retry after timeout", "PAY-12");
    expect(events.at(-1)?.data).toEqual({ askId: "ask_1", scenarioIds: ["sc_ask_ask_1"] });
  });
});

describe("parseEnv", () => {
  it("handles comments, quotes and export", () => {
    expect(parseEnv("# c\nA=1\nexport B='two'\nC=\"x y\"\nD=v # note\n\nbad line")).toEqual({ A: "1", B: "two", C: "x y", D: "v" });
  });
});
