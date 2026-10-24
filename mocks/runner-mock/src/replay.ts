import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Context } from "@pr-agent/contracts";
import { config } from "./env.js";
import { httpEmitter, type Emit } from "./emitter.js";
import { runAsk, runSession, waiter } from "./pipeline.js";

// Posts the canned POST /sessions sequence straight to EVENTS_URL, without Forge calling the mock.
// Smoke test for the deployed runner-events web trigger.
//   pnpm --filter @pr-agent/runner-mock replay --session <id> --issue <KEY> [--ask "<prompt>"] [--fast]

const USAGE = 'usage: replay --session <id> --issue <KEY> [--ask "<prompt>"] [--fast]';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--" && a !== "replay"),
  options: {
    session: { type: "string" },
    issue: { type: "string" },
    ask: { type: "string" },
    fast: { type: "boolean", default: false },
  },
});

if (!values.session || !values.issue) {
  console.error(USAGE);
  process.exit(2);
}

const sessionId = values.session;
const fixture = fileURLToPath(new URL("../../fixtures/context.json", import.meta.url));
const ctx = Context.parse(JSON.parse(readFileSync(fixture, "utf8")));
const shas = { base: ctx.session.baseSha, head: ctx.session.headSha };
const wait = waiter(values.fast ? 0 : config.speed);

let sent = 0;
let failed = 0;
const post = httpEmitter(sessionId, config.eventsUrl, config.token);
const emit: Emit = async (...args) => {
  const ok = await post(...args);
  ok ? sent++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${args[1].padEnd(18)} ${args[3]}`);
  return ok;
};

console.log(`replaying session ${sessionId} (${values.issue}) to ${new URL(config.eventsUrl).host}`);
await runSession(emit, wait, sessionId, shas, ctx.jira?.acceptanceCriteria.length ?? 0);
if (values.ask) await runAsk(emit, wait, sessionId, shas, `ask_${Date.now()}`, values.ask, values.issue);
console.log(`${sent} delivered, ${failed} failed`);
process.exit(failed ? 1 : 0);
