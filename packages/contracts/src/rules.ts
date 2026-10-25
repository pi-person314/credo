import type { AssertionResult, Coverage, DiffClass, Recommendation } from "./enums.js";
import type { AcCoverage, Diff, Finding } from "./domain.js";
import type { Scenario } from "./scenario.js";

/** Session limits from the spec. */
export const BUDGETS = {
  maxScenarios: 8,
  maxAttempts: 3,
  maxFollowupScenarios: 3,
  followupRounds: 1,
  firstReportMs: 5 * 60_000,
  sandboxIdleTtlMin: 30,
} as const;

/**
 * Label one scenario. `headAttempts` holds every PR result in order; a base PASS + PR FAIL
 * is only a NEW_REGRESSION if every rerun also fails.
 */
export function classify(base: AssertionResult, headAttempts: AssertionResult[]): DiffClass {
  const head = headAttempts[0];
  if (!head || base === "INCONCLUSIVE" || base === "NOT_RUN") return "INCONCLUSIVE";
  if (headAttempts.some((r) => r === "INCONCLUSIVE" || r === "NOT_RUN")) return "INCONCLUSIVE";
  if (base === "PASS" && head === "PASS") return "UNCHANGED_PASS";
  if (base === "FAIL" && head === "PASS") return "IMPROVEMENT";
  if (base === "FAIL" && head === "FAIL") return "EXISTING_FAILURE";
  // base PASS, head FAIL
  return headAttempts.every((r) => r === "FAIL") ? "NEW_REGRESSION" : "FLAKY";
}

/** Ref a scenario uses to point at acceptance criterion `index` (1-based) of `issueKey`. */
export const acRef = (issueKey: string, index: number) => `jira:${issueKey}#ac${index}`;

/** The criterion a scenario mainly checks: its first "jira:<KEY>#acN" ref. */
const primaryAc = (s: Scenario) => s.sourceRefs.find((r) => /^jira:[^#]+#ac\d+$/.test(r));

/**
 * Status of each acceptance criterion, from the scenarios that point at it.
 * A failing scenario only fails its primary criterion (its first AC ref). A scenario tagged with several
 * criteria usually fails one specific check (e.g. the charge count), so a double-charge regression must not
 * also mark "retries succeed" FAILED. For its other criteria a failing scenario proves nothing either way:
 * they need a passing scenario to be VERIFIED, and stay INCONCLUSIVE if that failure is all they have.
 */
export function coverage(issueKey: string, criteria: string[], scenarios: Scenario[], diffs: Diff[]): AcCoverage[] {
  const failing = (c: DiffClass) => c === "NEW_REGRESSION" || c === "EXISTING_FAILURE";
  return criteria.map((text, i) => {
    const ref = acRef(issueKey, i + 1);
    const claiming = scenarios.filter((s) => s.sourceRefs.includes(ref));
    const scenarioIds = claiming.map((s) => s.id);
    const evidence = diffs.flatMap((d) => {
      const s = claiming.find((x) => x.id === d.scenarioId);
      return s ? [{ c: d.classification, primary: primaryAc(s) === ref }] : [];
    });
    let status: Coverage = "UNTESTED";
    if (evidence.some((e) => failing(e.c) && e.primary)) status = "FAILED";
    else if (evidence.some((e) => e.c === "FLAKY" || e.c === "INCONCLUSIVE")) status = "INCONCLUSIVE";
    else if (evidence.some((e) => !failing(e.c))) status = "VERIFIED";
    else if (evidence.length > 0) status = "INCONCLUSIVE";
    return { index: i + 1, text, status, scenarioIds };
  });
}

/** Verdict for the report. Never claims a PR is safe. */
export function recommend(
  diffs: Diff[],
  findings: Finding[],
  acs: AcCoverage[] = [],
  testedFindingIds: string[] = [],
): Recommendation {
  if (diffs.some((d) => d.classification === "NEW_REGRESSION")) return "BLOCKING_REGRESSION";
  const unclear = diffs.some((d) => d.classification === "FLAKY" || d.classification === "INCONCLUSIVE");
  const untestedAc = acs.some((a) => a.status === "UNTESTED" || a.status === "INCONCLUSIVE");
  const untestedHighRisk = findings.some((f) => f.severity === "high" && !testedFindingIds.includes(f.id));
  if (unclear || untestedAc || untestedHighRisk) return "NEEDS_REVIEW";
  return "NO_BLOCKERS_FOUND";
}

/** Jira key from PR title first, then branch name. */
export function findJiraKey(title: string, branch = ""): string | undefined {
  const re = /\b[A-Z][A-Z0-9]+-\d+\b/;
  return title.match(re)?.[0] ?? branch.match(re)?.[0];
}
