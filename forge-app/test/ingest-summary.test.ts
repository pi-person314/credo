import { describe, expect, it } from "vitest";
import { ingestLogLine, type IngestSummary } from "../src/lib/ingest-summary";

describe("ingestLogLine", () => {
  it("logs counts only", () => {
    const s: IngestSummary = {
      at: "2026-10-24T12:00:00.000Z",
      jira: { key: "PAY-5", criteria: 3 },
      confluence: { pages: [{ title: "Payments retry spec" }], errors: ["confluence page 9 -> 403"] },
      pr: { files: 4, manifest: "repo" },
      greptile: { findings: 1, errors: [] },
    };
    const line = ingestLogLine("ses_1", s);
    expect(line).toBe("ingest ses_1 PAY-5: jira 3 ACs, confluence 1 page (1 error), pr 4 files, greptile 1 finding");
    expect(line).not.toContain("Payments retry spec");
    expect(line).not.toContain("403");
  });

  it("says which reads failed", () => {
    const s: IngestSummary = {
      at: "2026-10-24T12:00:00.000Z",
      jira: { key: "PAY-5", criteria: 0, error: "404" },
      confluence: { pages: [], errors: [] },
      pr: { files: 0, error: "401", manifest: "default" },
      greptile: { findings: 0, errors: [] },
    };
    expect(ingestLogLine("ses_1", s)).toBe("ingest ses_1 PAY-5: jira failed, confluence 0 pages, pr files failed, greptile 0 findings");
  });
});
