import { readFileSync } from "node:fs";
import { Context } from "@pr-agent/contracts";
import { ConsoleSink } from "./sink.js";

// Run the pipeline without core: pnpm dev:cli --context ../mocks/fixtures/context.json
const i = process.argv.indexOf("--context");
const file = i > -1 ? process.argv[i + 1] : "../mocks/fixtures/context.json";
const context = Context.parse(JSON.parse(readFileSync(file!, "utf8")));
const sink = new ConsoleSink();

await sink.emit({
  sessionId: context.session.id,
  ts: new Date().toISOString(),
  actor: "planner",
  type: "planner.started",
  status: "info",
  message: `Loaded context for PR #${context.session.prNumber} (${context.findings.length} findings)`,
});
// TODO(B): sandboxes -> plan -> run -> verify -> session.complete, emitting events through `sink`.
