import { z } from "zod";
import { ProviderMode } from "./enums.js";

/** demo-app/manifest.json. The planner reads this to know what it can test. */
export const AppManifest = z.object({
  api: z.array(z.string().regex(/^(GET|POST|PUT|PATCH|DELETE) \//)),
  pages: z.array(z.string().startsWith("/")),
  selectors: z.record(z.string()),
  fixtures: z.array(z.string()).min(1),
  tables: z.array(z.string()),
  providerModes: z.array(ProviderMode),
});
export type AppManifest = z.infer<typeof AppManifest>;

/** Sandbox-only hooks every demo app build must expose. */
export const TEST_HOOKS = {
  reset: "POST /__test/reset",
  seed: "POST /__test/seed", // { fixture }
  provider: "POST /__test/provider", // { mode, latencyMs }
  db: "GET /__test/db/:table", // ?col=value filters
} as const;
