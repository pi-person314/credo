import { describe, expect, it } from "vitest";
import type { Session } from "../src/contracts/index";
import { skipReason } from "../src/consumers/ingest";

const prev: Session = {
  id: "ses_old",
  repo: "pi-person314/checkout-demo",
  prNumber: 1,
  title: "PAY-5: Simplify payment retries",
  baseSha: "base",
  headSha: "head",
  issueKey: "PAY-5",
  status: "READY",
  createdAt: "2026-10-25T09:00:00.000Z",
};
const job = { repo: prev.repo, prNumber: 1, headSha: "head" };

describe("skipReason", () => {
  it("drops a webhook redelivery for a head we already ran", () => {
    expect(skipReason(prev, job)).toBe("duplicate job");
  });

  it("runs a new head, a failed run again, or a first run", () => {
    expect(skipReason(prev, { ...job, headSha: "new" })).toBeUndefined();
    expect(skipReason({ ...prev, status: "FAILED" }, job)).toBeUndefined();
    expect(skipReason(undefined, job)).toBeUndefined();
  });

  it("runs Run again on the same head while its session is still the latest", () => {
    expect(skipReason(prev, { ...job, rerunOf: "ses_old" })).toBeUndefined();
  });

  it("drops Run again once a newer session exists (double click, or a push got there first)", () => {
    expect(skipReason({ ...prev, id: "ses_new" }, { ...job, rerunOf: "ses_old" })).toBe("rerun superseded");
    expect(skipReason(undefined, { ...job, rerunOf: "ses_old" })).toBe("rerun superseded");
  });
});
