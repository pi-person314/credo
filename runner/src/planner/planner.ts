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

  private async generate(prompt: string, context: Context, origin: Origin, max: number, takenIds: string[]): Promise<PlanResult | undefined> {
    if (!this.llm.available()) return undefined;
    const errors: string[] = [];
    let current = prompt;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await this.llm.complete(current);
        const v = validateScenarios(extractJson(text), context.manifest, { origin, max, takenIds });
        errors.push(...v.errors);
        if (v.scenarios.length > 0) return { scenarios: v.scenarios, source: attempt === 1 ? this.llm.name : `${this.llm.name} (retry)`, errors };
        current = retryPrompt(prompt, v.errors.length ? v.errors : ["no scenarios"]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        this.log(`planner attempt ${attempt} failed: ${msg}`);
        current = retryPrompt(prompt, [msg]);
      }
    }
    this.log(`planner gave nothing valid: ${errors.slice(-3).join(" | ")}`);
    return { scenarios: [], source: this.llm.name, errors };
  }

  async plan(context: Context): Promise<PlanResult> {
    const max = BUDGETS.maxScenarios - BUDGETS.maxFollowupScenarios;
    const got = await this.generate(planPrompt(context, max), context, "planner", max, context.priorScenarioIds);
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
