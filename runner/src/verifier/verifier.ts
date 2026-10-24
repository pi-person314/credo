import { BUDGETS, classify, type AppManifest, type AssertionResult, type Diff, type Env, type Knobs, type Run, type Scenario } from "@pr-agent/contracts";
import type { Emit } from "../events.js";
import type { Executor } from "../executor/executor.js";

export interface VerifyInput {
  sessionId: string;
  scenario: Scenario;
  manifest: AppManifest;
  sessionKnobs?: Knobs;
}

export interface VerifyResult {
  runs: Run[];
  diff: Diff;
}

/**
 * Runs a scenario on base and head at the same time, reruns a PR failure (up to BUDGETS.maxAttempts in
 * total) before calling it a regression, and labels the difference with the shared classify() rule.
 */
export class Verifier {
  constructor(private executor: Executor, private emit: Emit) {}

  private async runOnce(input: VerifyInput, env: Env, attempt: number): Promise<Run> {
    const { scenario } = input;
    await this.emit("executor", "run.started", "start", `${scenario.id} on ${env}${attempt > 1 ? ` (attempt ${attempt})` : ""}`, {
      scenarioId: scenario.id,
      env,
      attempt,
    });
    const run = await this.executor.run({
      ...input,
      env,
      attempt,
      onAssertion: (o) =>
        void this.emit("executor", "run.assertion", o.result === "PASS" ? "ok" : o.result === "FAIL" ? "fail" : "info", `${scenario.id} ${env} ${o.id}: ${o.result}`, {
          scenarioId: scenario.id,
          env,
          attempt,
          ...o,
        }),
    });
    await this.emit("executor", "run.finished", run.status === "PASS" ? "ok" : run.status === "FAIL" ? "fail" : "info", `${scenario.id} on ${env}: ${run.status}${summary(run)}`, run);
    return run;
  }

  async verify(input: VerifyInput): Promise<VerifyResult> {
    const { scenario, sessionId } = input;
    const [base, head1] = await Promise.all([this.runOnce(input, "base", 1), this.runOnce(input, "head", 1)]);
    const runs: Run[] = [base, head1];
    const headResults: AssertionResult[] = [head1.status];
    if (base.status === "PASS" && head1.status === "FAIL") {
      for (let attempt = 2; attempt <= BUDGETS.maxAttempts; attempt++) {
        await this.emit("verifier", "verify.rerun", "info", `Rerun ${attempt} of ${BUDGETS.maxAttempts} for ${scenario.id} on head`, {
          scenarioId: scenario.id,
          env: "head",
          attempt,
        });
        const r = await this.runOnce(input, "head", attempt);
        runs.push(r);
        headResults.push(r.status);
      }
    }
    const classification = classify(base.status, headResults);
    const diff: Diff = { sessionId, scenarioId: scenario.id, base: base.status, head: head1.status, classification, runIds: runs.map((r) => r.id) };
    const bad = classification === "NEW_REGRESSION" || classification === "EXISTING_FAILURE";
    await this.emit("verifier", "verify.diff", bad ? "fail" : classification === "UNCHANGED_PASS" || classification === "IMPROVEMENT" ? "ok" : "info", `${scenario.id}: ${classification}`, diff);
    return { runs, diff };
  }
}

/** " (charges 1 → expected 1)"-style detail for the first failing or interesting assertion. */
function summary(run: Run): string {
  const a = run.assertions.find((x) => x.result !== "PASS") ?? run.assertions[0];
  if (!a) return "";
  if (a.result === "NOT_RUN" || a.result === "INCONCLUSIVE") return a.note ? ` (${a.note})` : "";
  return ` (${a.id}: got ${JSON.stringify(a.actual)}, want ${JSON.stringify(a.expected)})`;
}
