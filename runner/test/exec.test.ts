import { describe, expect, it } from "vitest";
import { exec } from "../src/util/exec.js";

describe("exec", () => {
  it("cleanEnv keeps the runner's secrets out of the child", async () => {
    process.env.SECRET_FOR_TEST = "leak";
    try {
      const script = 'echo "${SECRET_FOR_TEST:-none} ${PATH:+path}"';
      expect((await exec("sh", ["-c", script], { cleanEnv: true })).stdout.trim()).toBe("none path");
      expect((await exec("sh", ["-c", script])).stdout.trim()).toBe("leak path");
    } finally {
      delete process.env.SECRET_FOR_TEST;
    }
  });
});
