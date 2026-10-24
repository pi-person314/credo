import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DroidLlm, extractJson } from "../src/planner/droid.js";

// A stand-in `droid` that checks the flags we rely on and answers like --output-format json.
const dir = mkdtempSync(join(tmpdir(), "fakedroid-"));
const bin = join(dir, "droid");
writeFileSync(
  bin,
  `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
if (a[0] !== "exec" || a[a.indexOf("-f") + 1] !== "prompt.md" || !process.env.FACTORY_API_KEY) { console.error("bad call " + a.join(" ")); process.exit(2); }
const prompt = fs.readFileSync("prompt.md", "utf8");
const result = "Sure:\\n\`\`\`json\\n" + JSON.stringify([{ echo: prompt }]) + "\\n\`\`\`";
console.log(a.includes("--output-format") ? JSON.stringify({ type: "result", result }) : result);
`,
);
chmodSync(bin, 0o755);

describe("DroidLlm", () => {
  it("passes the prompt as a file with the API key and unwraps JSON output", async () => {
    const out = await new DroidLlm({ apiKey: "fk-test", bin }).complete("plan 3 tests");
    expect(extractJson(out)).toEqual([{ echo: "plan 3 tests" }]);
  });
  it("reports a failing CLI", async () => {
    await expect(new DroidLlm({ apiKey: "", bin }).complete("x")).rejects.toThrow(/exited 2/);
  });
});
