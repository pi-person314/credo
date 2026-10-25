import { assert, test } from "vitest";
import { artifactUrl } from "./ui";

const view = "https://runner.example/view/ses_1?t=tok";

test("evidence links name the session once", () => {
  assert.strictEqual(artifactUrl(view, "ses_1", "ses_1/sc_a/head-3/db.json"), "https://runner.example/artifacts/ses_1/sc_a/head-3/db.json?t=tok");
  assert.strictEqual(artifactUrl(view, "ses_1", "sc_a/head-3/db.json"), "https://runner.example/artifacts/ses_1/sc_a/head-3/db.json?t=tok");
  assert.strictEqual(artifactUrl(null, "ses_1", "ses_1/x"), null);
});
