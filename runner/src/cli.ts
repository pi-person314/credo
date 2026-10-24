import { readFileSync } from "node:fs";
import { Context, Scenario } from "@pr-agent/contracts";
import { projectName } from "./sandbox/compose.js";
import { Verifier } from "./verifier/verifier.js";
import { Executor } from "./executor/executor.js";
import { emitter } from "./events.js";
import { createRuntime } from "./runtime.js";
import { ConsoleSink } from "./sink.js";

// The whole pipeline without Forge, events printed to the console:
//   pnpm --filter @pr-agent/runner dev:cli --context ../mocks/fixtures/context.json [--keep] [--ask "..."]
// Prove the race N times on already-planned scenarios (no planner):
//   pnpm --filter @pr-agent/runner dev:cli --scenarios ../mocks/fixtures/scenarios.json --only sc_concurrent_retry --repeat 10
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

const context = Context.parse(JSON.parse(readFileSync(opt("context") ?? "../mocks/fixtures/context.json", "utf8")));
const id = context.session.id;
const rt = createRuntime({ sink: new ConsoleSink(), log: (m) => console.log(`  planner: ${m}`) });

let code = 0;
try {
  const scenariosFile = opt("scenarios");
  if (scenariosFile) {
    // Fixed scenarios, repeated: the 10/10 check for the demo bug.
    const only = opt("only");
    const repeat = Number(opt("repeat") ?? 1);
    const scenarios = (JSON.parse(readFileSync(scenariosFile, "utf8")) as unknown[]).map((s) => Scenario.parse(s)).filter((s) => !only || s.id === only);
    const { session } = context;
    const sbs = await rt.sandboxes.upBoth(id, {
      base: { repo: session.repo, sha: session.baseSha },
      head: { repo: session.repo, sha: session.headSha, prNumber: session.prNumber },
    });
    if (sbs.base.state !== "healthy" || sbs.head.state !== "healthy") throw new Error(`sandboxes: ${sbs.base.error ?? ""} ${sbs.head.error ?? ""}`);
    const quiet = { emit: async () => undefined };
    const verifier = new Verifier(new Executor({ sandboxes: rt.sandboxes, browser: rt.browser, artifactsDir: rt.cfg.artifactsDir }), emitter(quiet, id));
    const tally = new Map<string, Record<string, number>>();
    for (let i = 1; i <= repeat; i++) {
      for (const scenario of scenarios) {
        const { diff, runs } = await verifier.verify({ sessionId: id, scenario, manifest: context.manifest });
        const t = tally.get(scenario.id) ?? {};
        t[diff.classification] = (t[diff.classification] ?? 0) + 1;
        tally.set(scenario.id, t);
        const actual = (env: string) => runs.find((r) => r.env === env)?.assertions.map((a) => JSON.stringify(a.actual)).join(",");
        console.log(`#${i} ${scenario.id}: ${diff.classification}  (base ${actual("base")}, PR ${actual("head")})`);
      }
    }
    console.log("\nTally:");
    for (const [sc, t] of tally) console.log(`  ${sc}: ${Object.entries(t).map(([k, v]) => `${k} ${v}/${repeat}`).join(", ")}`);
  } else {
    rt.orchestrator.start(context);
    await rt.orchestrator.idle(id);
    const ask = opt("ask");
    if (ask) {
      rt.orchestrator.ask(id, "ask_cli", ask);
      await rt.orchestrator.idle(id);
    }
    const s = rt.orchestrator.get(id);
    console.log(`\nSession ${id}: ${s.status}${s.error ? ` (${s.error})` : ""}`);
    for (const d of s.diffs) {
      const sc = s.scenarios.find((x) => x.id === d.scenarioId);
      console.log(`  ${d.classification.padEnd(17)} ${d.scenarioId}  base ${d.base}, PR ${d.head}  ${sc?.sourceRefs.join(" ") ?? ""}`);
    }
    console.log(`  artifacts: ${rt.cfg.artifactsDir}/${id}/`);
    if (s.status === "FAILED") code = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
} finally {
  if (!flag("keep")) {
    await rt.browser.closeSession(id);
    await rt.sandboxes.teardown(id);
  } else {
    const st = ["base", "head"].map((e) => `${e} ${rt.sandboxes.get(id, e as "base")?.url}`).join(", ");
    console.log(`Sandboxes kept: ${st}. Remove with: docker compose -p ${projectName(id, "base")} down -v; docker compose -p ${projectName(id, "head")} down -v`);
  }
  await rt.close();
}
process.exit(code);
