import { describe, expect, it } from "vitest";
import { NARRATION_JS } from "../src/view/narration.js";

// The narration code runs in the browser as plain JS; load it the same way here.
const N = new Function(NARRATION_JS + "\nreturn CredoNarration;")();

const ev = (type: string, message: string, data?: unknown, status = "info") => ({ ts: "2026-10-25T05:00:00Z", type, status, message, data });
const run = (scenarioId: string, env: string, actual: number, result: string) => ({ scenarioId, env, attempt: 1, status: result, assertions: [{ id: "a1", result, expected: 1, actual }] });
const scenarios = [
  { id: "sc_single_pay", objective: "One pay call makes exactly 1 charge (AC1)", assertions: [{ id: "a1", type: "db_count", table: "charges", equals: 1 }] },
  { id: "sc_concurrent_retry", objective: "5 retries at once make exactly 1 charge", assertions: [{ id: "a1", type: "db_count", table: "charges", equals: 1 }] },
];

describe("narration lines", () => {
  it("narrates a run: one line per test and a verdict with the observed counts", () => {
    const l = new N.Lines();
    const said = [
      ev("sandbox.building", "Building base at abc1234", { env: "base" }),
      ev("sandbox.building", "Building head at def5678", { env: "head" }),
      ev("sandbox.healthy", "base healthy in 20 s", { env: "base" }),
      ev("sandbox.healthy", "head healthy in 21 s", { env: "head" }),
      ev("planner.started", "Factory Droid is planning tests from 3 acceptance criteria, 2 findings, 4 files"),
      ev("planner.scenarios", "2 scenarios by Factory Droid", scenarios, "ok"),
      ev("run.started", "sc_single_pay on base", { scenarioId: "sc_single_pay", env: "base", attempt: 1 }),
      ev("run.started", "sc_single_pay on head", { scenarioId: "sc_single_pay", env: "head", attempt: 1 }),
      ev("run.finished", "", run("sc_single_pay", "base", 1, "PASS")),
      ev("run.finished", "", run("sc_single_pay", "head", 1, "PASS")),
      ev("verify.diff", "sc_single_pay: UNCHANGED_PASS", { scenarioId: "sc_single_pay", classification: "UNCHANGED_PASS" }),
      ev("run.started", "sc_concurrent_retry on base", { scenarioId: "sc_concurrent_retry", env: "base", attempt: 1 }),
      ev("run.started", "sc_concurrent_retry on head", { scenarioId: "sc_concurrent_retry", env: "head", attempt: 1 }),
      ev("run.finished", "", run("sc_concurrent_retry", "base", 1, "PASS")),
      ev("run.finished", "", run("sc_concurrent_retry", "head", 2, "FAIL")),
      ev("verify.rerun", "Rerun 2 of 3", { scenarioId: "sc_concurrent_retry", env: "head", attempt: 2 }),
      ev("run.started", "sc_concurrent_retry on head (attempt 2)", { scenarioId: "sc_concurrent_retry", env: "head", attempt: 2 }),
      ev("run.finished", "", { ...run("sc_concurrent_retry", "head", 5, "FAIL"), attempt: 2 }),
      ev("verify.rerun", "Rerun 3 of 3", { scenarioId: "sc_concurrent_retry", env: "head", attempt: 3 }),
      ev("verify.diff", "sc_concurrent_retry: NEW_REGRESSION", { scenarioId: "sc_concurrent_retry", classification: "NEW_REGRESSION" }),
      ev("knobs.set", "provider=ok latency=0ms on both"),
      ev("session.complete", "First report ready: 1 UNCHANGED_PASS, 1 NEW_REGRESSION", { scenarios: 2 }),
    ]
      .map((e) => l.line(e))
      .filter(Boolean);
    expect(said).toEqual([
      { prio: "low", text: "Building the old and new code." },
      { prio: "low", text: "Both versions are running." },
      { prio: "low", text: "Reading the ticket and planning tests." },
      { prio: "low", text: "Planned 2 tests." },
      { prio: "low", text: "Test 1 of 2: One pay call makes exactly 1 charge." },
      { prio: "high", text: "Passed on both." },
      { prio: "low", text: "Test 2 of 2: 5 retries at once make exactly 1 charge." },
      { prio: "low", text: "It failed on the new code. Running it again to rule out flakiness." },
      // Evidence comes from the first attempt on each side, not the rerun.
      { prio: "high", text: "New regression. Old code made 1 charge, new code made 2 charges." },
      { prio: "high", text: "All tests done: 1 new regression, 1 passed on both." },
    ]);
  });

  it("uses the view's scenario list when the planner event is out of the window, and names the test on a late verdict", () => {
    const l = new N.Lines();
    l.learnScenarios([{ id: "sc_a", objective: "A works" }, { id: "sc_b", objective: "B works" }]);
    expect(l.line(ev("run.started", "", { scenarioId: "sc_b", env: "base", attempt: 1 }))).toEqual({ prio: "low", text: "Test 2 of 2: B works." });
    expect(l.line(ev("verify.diff", "", { scenarioId: "sc_a", classification: "FLAKY" }))!.text).toBe("Test 1 of 2: Flaky: the new code passed some runs and failed others.");
    // Without assertion definitions the evidence is still spoken, just without units.
    l.line(ev("run.finished", "", run("sc_b", "base", 1, "PASS")));
    l.line(ev("run.finished", "", run("sc_b", "head", 3, "FAIL")));
    expect(l.line(ev("verify.diff", "", { scenarioId: "sc_b", classification: "NEW_REGRESSION" }))!.text).toBe("New regression. Old code got 1, new code got 3.");
  });

  it("covers failures, asks and docs-only PRs, and stays quiet on noise", () => {
    const l = new N.Lines();
    expect(l.line(ev("sandbox.failed", "head failed: boom", { env: "head" }))).toEqual({ prio: "high", text: "The new code sandbox failed to start." });
    expect(l.line(ev("planner.started", "Factory Droid is turning the ask into a test: pay 3 times"))!.text).toBe("Turning your question into a test.");
    expect(l.line(ev("ask.complete", "Couldn't turn the ask into a test", {}, "fail"))!.text).toBe("Couldn't turn your question into a test.");
    expect(l.line(ev("ask.complete", "Ask done", {}, "ok"))).toBeNull();
    expect(l.line(ev("session.complete", "Only docs/tests changed: no behavior to test", { scenarios: 0 }))!.text).toBe("Only docs or tests changed, so there's nothing to run.");
    expect(l.line(ev("session.failed", "Error: ENOENT /tmp/x"))!.text).toBe("The run failed. The timeline says why.");
    for (const t of ["run.assertion", "knobs.set", "sandbox.reset", "route.decided", "sandbox.teardown"]) expect(l.line(ev(t, "x"))).toBeNull();
  });

  it("shortens objectives to one spoken sentence", () => {
    expect(N.sentence("Double-clicking Pay shows one paid order [AC1, AC3]")).toBe("Double-clicking Pay shows one paid order.");
    expect(N.sentence("x ".repeat(100)).length).toBeLessThanOrEqual(122);
  });

  it("speaks quick action results side by side", () => {
    expect(
      N.actionLine("both", "race", [
        { env: "base", status: "paid", charges: 1, pays: [200, 409] },
        { env: "head", status: "paid", charges: 2, pays: [200, 200] },
      ]),
    ).toBe("Paid twice at once on both. Old code: paid, 1 charge. New code: paid, 2 charges.");
    expect(N.actionLine("head", "pay", [{ env: "head", error: "nope" }])).toBe("Clicked Pay on the new code. New code: error.");
  });

  it("prefers a natural English voice", () => {
    const v = (name: string, lang: string) => ({ name, lang });
    expect(N.pickVoice([v("Thomas", "fr-FR"), v("Fred", "en-US"), v("Samantha", "en-US")]).name).toBe("Samantha");
    expect(N.pickVoice([v("Daniel", "en-GB"), v("Fred", "en-US")]).name).toBe("Fred");
    expect(N.pickVoice([v("Thomas", "fr-FR")])).toBeUndefined();
  });
});

describe("speaker", () => {
  function setup() {
    let now = 0;
    const timers: Array<() => void> = [];
    const spoken: Array<{ text: string; onend?: () => void }> = [];
    const synth = { speak: (u: { text: string }) => spoken.push(u), cancel: () => (synth.cancelled = true), getVoices: () => [], cancelled: false };
    class Utterance {
      onend?: () => void;
      constructor(public text: string) {}
    }
    const captions: Array<string | null> = [];
    const s = new N.Speaker(synth, Utterance, {
      now: () => now,
      setTimeout: (f: () => void) => timers.push(f),
      clearTimeout: () => undefined,
      onchange: (t: string | null) => captions.push(t),
    });
    const finish = () => spoken[spoken.length - 1]!.onend!();
    return { s, synth, spoken, timers, captions, finish, tick: (ms: number) => (now += ms) };
  }

  it("is silent until turned on", () => {
    const { s, spoken } = setup();
    s.say("hello", "high");
    expect(spoken).toHaveLength(0);
  });

  it("plays one line at a time, in order, and confirms when turned on", () => {
    const { s, spoken, finish, captions } = setup();
    s.enable();
    s.say("Passed on both.", "high");
    s.say("New regression.", "high");
    expect(spoken.map((u) => u.text)).toEqual(["Narration on."]);
    finish();
    finish();
    finish();
    expect(spoken.map((u) => u.text)).toEqual(["Narration on.", "Passed on both.", "New regression."]);
    expect(captions.at(-1)).toBeNull();
  });

  it("replaces queued progress with newer progress and drops stale progress, but keeps every result", () => {
    const { s, spoken, finish, tick } = setup();
    s.enable();
    s.say("Test 1 of 3.", "low");
    s.say("Passed on both.", "high");
    s.say("Test 2 of 3.", "low");
    s.say("Test 3 of 3.", "low");
    s.say("New regression.", "high");
    finish();
    finish();
    expect(spoken.map((u) => u.text)).toEqual(["Narration on.", "Passed on both.", "Test 3 of 3."]);
    tick(10_000);
    s.say("Planned 2 tests.", "low");
    tick(10_000);
    finish();
    finish();
    expect(spoken.map((u) => u.text).slice(3)).toEqual(["New regression."]);
  });

  it("moves on when the browser never reports the end of a line", () => {
    const { s, spoken, timers } = setup();
    s.enable();
    s.say("Passed on both.", "high");
    timers[0]!();
    expect(spoken.map((u) => u.text)).toEqual(["Narration on.", "Passed on both."]);
  });

  it("stops at once when turned off", () => {
    const { s, synth, spoken, finish } = setup();
    s.enable();
    s.say("Passed on both.", "high");
    s.disable();
    expect(synth.cancelled).toBe(true);
    finish();
    expect(spoken).toHaveLength(1);
  });
});
