import { fetch } from "@forge/api";
import { TOKEN_HEADER, type Context, type Knobs } from "../contracts/index";

// Every runner call returns fast; results come back as Events on the runner-events web trigger.
// RUNNER_URL and RUNNER_TOKEN are Forge variables: forge variables set --encrypt RUNNER_TOKEN <value>
const base = () => process.env.RUNNER_URL ?? "";
const headers = () => ({ "content-type": "application/json", [TOKEN_HEADER]: process.env.RUNNER_TOKEN ?? "" });

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base()}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`runner ${method} ${path} -> ${res.status}`);
  return res.status === 202 ? undefined : res.json();
}

export const runner = {
  start: (context: Context) => call("POST", "/sessions", { context }),
  ask: (sessionId: string, askId: string, prompt: string) => call("POST", `/sessions/${sessionId}/ask`, { askId, prompt }),
  knobs: (sessionId: string, knobs: Knobs) => call("POST", `/sessions/${sessionId}/knobs`, knobs),
  reset: (sessionId: string) => call("POST", `/sessions/${sessionId}/reset`),
  status: (sessionId: string) => call("GET", `/sessions/${sessionId}/status`),
};
