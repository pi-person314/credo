import { BUDGETS, type Context, type Diff, type Origin, type Route, type Scenario } from "@pr-agent/contracts";
import type { Llm } from "./droid.js";
import { extractJson } from "./droid.js";
import { cannedScenarios, templateAsk } from "./fallback.js";
import { askPrompt, followupPrompt, planPrompt, retryPrompt } from "./prompt.js";
import { validateScenarios } from "./validate.js";

export interface PlanResult {
  scenarios: Scenario[];
  /** "droid", "droid (retry)", "canned", "template" */
  source: string;
  errors: string[];
}

/** A coverage-only retry costs one more Droid call (up to ~120 s): skip it when less than this is left of the budget. */
export const COVERAGE_RETRY_MIN_MS = 150_000;

/** Paths that can't change runtime behavior: docs, tests, CI config. */
const STATIC = /(^|\/)(docs?|test|tests|__tests__|\.github)\/|\.(md|mdx|txt|rst)$|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(^|\/)(LICENSE|CODEOWNERS)$/i;

/** STATIC_ONLY when every changed file is docs/tests/CI; otherwise run targeted tests. */
export function decideRoute(context: Context): Route {
  return context.changedFiles.length > 0 && context.changedFiles.every((f) => STATIC.test(f.path)) ? "STATIC_ONLY" : "TARGETED_TEST";
}

/**
 * Droid writes scenario JSON; we validate it against the schema and the manifest, retry once with the
 * errors, and fall back to canned scenarios (pipeline) or keyword templates (asks).
 */
export class Planner {
  private asks = 0;

  constructor(private llm: Llm, private log: (msg: string) => void = () => undefined) {}

  private async generate(
    prompt: string,
    context: Context,
    origin: Origin,
    max: number,
    takenIds: string[],
    deadline?: number,
  ): Promise<PlanResult | undefined> {
    if (!this.llm.available()) return undefined;
    const errors: string[] = [];
    const acceptanceCriteria = context.jira?.acceptanceCriteria ?? [];
    let current = prompt;
    // Valid scenarios from attempt 1 that over-claimed a success criterion: kept (with the claim dropped) if the retry fails.
    let firstTry: Scenario[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await this.llm.complete(current);
        const v = validateScenarios(extractJson(text), context.manifest, { origin, max, takenIds, acceptanceCriteria });
        errors.push(...v.errors);
        const source = attempt === 1 ? this.llm.name : `${this.llm.name} (retry)`;
        if (v.scenarios.length > 0 && (attempt === 2 || v.coverageErrors.length === 0)) return { scenarios: v.scenarios, source, errors };
        if (v.scenarios.length > 0) {
          firstTry = v.scenarios;
          // The false claims are already dropped; only spend a second Droid call if the first report can still make it.
          if (deadline !== undefined && deadline - Date.now() < COVERAGE_RETRY_MIN_MS) {
            this.log(`planner over-claimed success criteria, no time to ask again (claims dropped): ${v.coverageErrors.join(" | ")}`);
            return { scenarios: firstTry, source, errors };
          }
          this.log(`planner over-claimed success criteria, asking again: ${v.coverageErrors.join(" | ")}`);
        }
        current = retryPrompt(prompt, v.errors.length ? v.errors : ["no scenarios"]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        this.log(`planner attempt ${attempt} failed: ${msg}`);
        current = retryPrompt(prompt, [msg]);
      }
    }
    if (firstTry.length) return { scenarios: firstTry, source: this.llm.name, errors };
    this.log(`planner gave nothing valid: ${errors.slice(-3).join(" | ")}`);
    return { scenarios: [], source: this.llm.name, errors };
  }

  /** deadline: epoch ms by which the first report should be out (the coverage retry is skipped near it). */
  async plan(context: Context, deadline?: number): Promise<PlanResult> {
    const max = BUDGETS.maxScenarios - BUDGETS.maxFollowupScenarios;
    const got = await this.generate(planPrompt(context, max), context, "planner", max, context.priorScenarioIds, deadline);
    if (got?.scenarios.length) return got;
    const canned = cannedScenarios(context.session.issueKey, context.manifest).filter((s) => !context.priorScenarioIds.includes(s.id));
    return { scenarios: canned.slice(0, max), source: "canned", errors: got?.errors ?? ["planner not configured (FACTORY_API_KEY)"] };
  }

  async ask(context: Context, prompt: string, prior: Scenario[]): Promise<PlanResult> {
    const taken = [...context.priorScenarioIds, ...prior.map((s) => s.id)];
    const got = await this.generate(askPrompt(context, prompt, prior), context, "ask", 1, taken);
    if (got?.scenarios.length) return got;
    const t = templateAsk(prompt, context.session.issueKey, context.manifest, ++this.asks);
    let id = t?.id;
    for (let n = 2; id && taken.includes(id); n++) id = `${t!.id}_${n}`;
    return { scenarios: t && id ? [{ ...t, id }] : [], source: "template", errors: got?.errors ?? ["planner not configured (FACTORY_API_KEY)"] };
  }

  /** One round of up to BUDGETS.maxFollowupScenarios, only when the first round had a surprise. */
  async followups(context: Context, scenarios: Scenario[], diffs: Diff[]): Promise<PlanResult> {
    const surprise = diffs.some((d) => d.classification !== "UNCHANGED_PASS");
    const room = Math.min(BUDGETS.maxFollowupScenarios, BUDGETS.maxScenarios - scenarios.length);
    if (!surprise || room <= 0 || !this.llm.available()) return { scenarios: [], source: "none", errors: [] };
    const got = await this.generate(followupPrompt(context, scenarios, diffs, room), context, "followup", room, [
      ...context.priorScenarioIds,
      ...scenarios.map((s) => s.id),
    ]);
    return got ?? { scenarios: [], source: "none", errors: [] };
  }
}
