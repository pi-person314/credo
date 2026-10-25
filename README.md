# PR Confidence

A Forge app for Jira (Atlassian Agentic Workforce Challenge, Track 1). When a PR opens for a Jira ticket, the agent reads the ticket, its acceptance criteria, linked Confluence specs, the diff, and Greptile's review. It then runs the risky behavior on the old code (**base**) and the new code (**PR**) side by side in Docker sandboxes.

Everything shows up inside the Jira ticket:
- a status for each acceptance criterion
- evidence for every result
- a **live sandbox** where you watch the agent's browser, click around yourself, flip failure knobs, and ask for new tests in plain English (panel or Rovo chat)

On a regression it files a linked Bug with repro steps. Workflow changes wait for a human's OK, and every write goes in an audit log.

Full spec: [docs/SPEC.md](docs/SPEC.md) · Setup, secrets and accounts: [docs/SETUP.md](docs/SETUP.md)

Demo: Jira ticket [PAY-5](https://one-atlas-fdzb.atlassian.net/browse/PAY-5) · bug PR [checkout-demo #1](https://github.com/pi-person314/checkout-demo/pull/1)

## Status

| Area | Owner | State |
|---|---|---|
| Shared contracts (`packages/contracts`) | both | ✅ v0.2: types, scenario format, runner API, events, coverage + verdict rules, 22 tests |
| `forge-app` (Jira panel, Rovo agent, web triggers, KVS, publish) | A | ✅ P0 deployed to development: ingest (Jira, Confluence, GitHub files, Greptile, manifest), event projection into KVS, report + verdict, Jira/GitHub publish, guarded Bug + transition, issue panel with live view Frame, Rovo actions. Works end to end on PAY-5: panel shows the verdict, Jira report comment, GitHub PR comment and `PR Confidence` status post |
| `mocks/runner-mock` | A | ✅ fake runner: full canned pipeline + asks, posts events to the Forge web trigger; `replay` CLI posts the sequence directly |
| `runner` (orchestrator, planner, sandboxes, executor, verifier, live view) | B | ✅ deployed on the Azure VM: full pipeline + Runner API + dev:cli; Droid planner; demo bug NEW_REGRESSION 10/10; live view page |
| `demo-app` | B | ✅ lives in [pi-person314/checkout-demo](https://github.com/pi-person314/checkout-demo); bug PR #1 |
| `infra` (compose: laptop + tunnel or Azure VM + Caddy) | B | ✅ runner image, compose (127.0.0.1:4100), edge Caddyfile, deploy script; the GitHub Actions deploy workflow deploys the runner to the VM and the smoke test passes |

## Changelog

- **Honest results** (forge-app): vague test requests ("?", "test", under 12 characters or fewer than 3 words) are refused with a prompt to describe the situation, in the panel (red notice) and in Rovo. Regressions now lead with what the PR run observed, e.g. "PR: 2 rows in charges where orderId=$order.id (expected 1)", with the scenario goal as secondary text, in the panel, the Jira report, the GitHub comment, Rovo's get-verification and filed Bugs (summary "Regression: <observed failure> (<scenario id>)"). The Rovo prompt asks for a concrete scenario on vague requests and quotes observed failures. forge-app gets `npm test` (node:test + tsx), run in CI.
- **First full run on the real demo** (forge-app, runner, infra): checkout-demo PR #1 → GitHub webhook → Forge ingest reads PAY-5, the Confluence page "Payments retry spec" and Greptile's review → the runner on the Azure VM (pr-agent-saksham-20261024.westus2.cloudapp.azure.com) runs base vs PR → the PAY-5 panel shows "Blocking regression" → Jira report comment, GitHub PR comment and a red `PR Confidence` commit status. Greptile is installed on checkout-demo and posted a P1 "Overlapping retries charge twice" review on PR #1, which ingest picks up. The Factory Droid planner wrote the scenarios (ids like `sc_concurrent_payment_is_idempotent`, not in the canned fallback): route TARGETED_TEST, 5 scenarios, 1 NEW_REGRESSION, 3 UNCHANGED_PASS, 1 INCONCLUSIVE. The report's counts and "what was not tested" wording are fixed, and a failed panel action now shows a red error instead of a green success notice. Greptile comments are read as plain text (badges, links and the diagram dropped) and ranked by their P0-P3 badge, so its P1 finding counts as high; a regression planned from a Greptile finding says "Greptile flagged this too."
- **Publish fixes** (forge-app): Jira rejected the report comment (400 INVALID_INPUT) because ADF documents put `version` under `attrs`; it now sits at the top of the doc, which also fixes filed Bug descriptions. Jira and GitHub errors now carry the API's response text, in the panel's Activity tab and in `forge logs`. Found on the first real run (checkout-demo PR #1 → PAY-5).
- **Demo ticket is PAY-5** (demo data): the ticket lives on the demo site one-atlas-fdzb as PAY-5 (Jira numbers new projects from 1), with the reworded AC3 and a link to the Confluence page "Payments retry spec" (space PAY). The fixture, canned scenarios, docs and tests now say PAY-5, and the bug PR's title starts with `PAY-5:`.
- **Forge P0** (forge-app, mocks): ingest builds the Context from the PR, Jira issue + acceptance criteria, linked Confluence pages, Greptile comments and the repo manifest, then starts the runner. Runner events are projected into KVS (scenarios, runs, diffs, asks, sandbox state); `session.complete` / `ask.complete` build the report and publish it as a Jira comment, a GitHub PR comment and the `PR Confidence` commit status (edited in place, never posted twice). A blocking regression proposes moving the issue back to In Progress; the move and any regression Bug need a human click (panel) or confirmation (Rovo). The issue panel shows verdict, criteria, sandbox knobs + embedded live view, tests with evidence, asks, activity and audit. Manifest adds the `live-view` resource, the runner host under `external.frames` and `read:page:confluence`. `runner-mock replay` posts the canned sequence to the web trigger.
- **AC3 reworded** (demo data): PAY-12's third acceptance criterion now matches checkout-demo: "A provider timeout marks the order payment_failed and creates no charge" (was "leaves the order pending", which failed on base and PR alike). Same change in the fixture, its Confluence excerpt, and docs/SETUP.md; the Jira ticket is edited by hand.
- **GITHUB_TOKEN without VM access** (infra): the deploy workflow copies the repo secret `VM_GITHUB_TOKEN` into the VM's `.env` (over stdin) and recreates the runner when it changed.
- **VM smoke test** (infra): `infra/smoke.sh` runs the demo session (checkout-demo PR #1) on the VM against the local runner and prints its events and diffs; the RUNNER_TOKEN never leaves the VM. From GitHub: Actions → deploy → Run workflow with `smoke` (add `probe_only` to skip the redeploy, `keep` to leave the sandboxes up for the live view).
- **First Forge deploy** (forge-app): app registered (`app.id` in the manifest), deployed to development and installed on the demo Jira + Confluence site. Fixes needed to get there: panel icon, real runner host in `external.fetch`, emit on for Forge's bundler, contracts copy drops `.js` from relative imports. Web triggers now refuse every request while `RUNNER_TOKEN` / `GITHUB_WEBHOOK_SECRET` are unset, and a bad event body returns 400 instead of crashing.
- **Take over the agent's browser** (runner, P1): in the live view, tick "Take over" and click, double-click, scroll or type on either screen (or both at once); `POST /view/:id/input?t=`. Refused while the agent is running a test.
- **Export as .spec.ts** (runner, P1): any scenario as a standalone Playwright test (`GET /sessions/:id/scenarios/:scenarioId/spec` with x-token, or the `.spec.ts` link in the live view). Exported specs pass on base and fail on the PR for the race scenarios.
- **Infra** (runner image + VM): image on Playwright 1.63 with Docker CLI/Compose, git and the Droid CLI; compose runs only the runner on `127.0.0.1:4100` in attach mode (joins each sandbox's internal network); `infra/edge/Caddyfile` for the VM's edge Caddy; `infra/deploy.sh` ships `git HEAD` over SSH and restarts the runner; CI builds the image.
- **Live view** (runner): `/view/:id?t=` page for the Jira panel: Watch the agent (CDP screencast over `WS /live/:id/:env`) or Try it yourself (both apps through `/preview/:id/:env/<token>/`), knobs + reset for both, live charge/order counts, test table, activity feed. `/artifacts/:id/*?t=` serves evidence. `GET /sessions/:id/view-url` (x-token) returns a signed URL for Forge's `getViewUrl`.
- **Orchestrator + Runner API + CLI** (runner): `POST /sessions` runs sandboxes → route → plan → run both → verify → follow-ups → `session.complete` in the background; asks queue behind it (and rebuild sandboxes after idle teardown); knobs/reset hit both; status; teardown; idle sweeper; orphan cleanup on start. Events go to the Forge web trigger in order with retries. `dev:cli` runs it all locally; `--scenarios … --repeat 10` is the 10/10 check (base 1 charge, PR 5, every time). `mocks/fixtures/context.json` now points at checkout-demo PR #1.
- **Droid planner** (runner): prompts Factory Droid (`droid exec`, read-only) with the ticket, acceptance criteria, Confluence, findings, diff and manifest; validates the JSON against the Scenario schema and the manifest, retries once with the errors, falls back to canned scenarios (pipeline) or keyword templates (asks). Follow-ups: one round, up to 3, only after a surprise. Docs-only PRs route to STATIC_ONLY.
- **Executor + verifier** (runner): runs scenario steps (`http`, `parallel`, `ui` via Playwright, `wait`) with `$name.path` references, checks `db_count` / `http_status` / `json_path` / `ui_text`, saves evidence (HTTP log, DB rows, screenshot, Playwright trace), streams the agent's browser as JPEG frames, reruns PR failures twice and labels each diff. Docker test: the 3 fixture scenarios give UNCHANGED_PASS, NEW_REGRESSION, NEW_REGRESSION on checkout-demo PR #1.
- **Sandbox manager** (runner): checks out base and head at their SHAs, turns the demo repo's compose file into an isolated `sb-<session>-<env>` stack (no host ports, internal network, CPU/mem caps), waits for health, seeds, sets knobs, reads DB rows, tears down after idle TTL. Docker test proves base 1 charge vs PR 5.
- **Signed session token** (contracts): `signSessionToken` / `verifySessionToken` in `@pr-agent/contracts/token` for the runner's `?t=` links. Forge's `getViewUrl` signs with `RUNNER_TOKEN`.
- **Setup guide**: docs/SETUP.md (every env var, account and login), compose profiles to run the runner on a laptop through a Cloudflare tunnel or on a VM.
- **Scaffold + contracts (Forge)**: pnpm workspace, shared zod contracts with tests, Forge app skeleton (web triggers, queue consumer, issue panel, Rovo agent + actions), contracts sync into the Forge app, runner stub, runner mock, compose + Caddy draft, CI.

## Layout

```
packages/contracts/   shared types and rules (both, change by PR only)
forge-app/            A   Forge app: manifest.yml, web triggers, queue consumer, panel, Rovo actions (npm, not in the pnpm workspace)
  src/contracts/          generated copy of packages/contracts (pnpm sync:contracts)
mocks/runner-mock/    A   fake runner for building the Forge app alone
runner/               B   orchestrator, planner, sandbox manager, executor, verifier, live view page
demo-app/             B   checkout app with the double-charge bug
infra/                B   compose.yml, Caddyfile, azure-vm.sh
mocks/fixtures/       B   context.json, scenarios.json
scripts/              sync-contracts.mjs
docs/SPEC.md          final spec
```

## Run it

Needs Node 22 or 24 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm check:contracts
```

**Person A: Forge app**

```bash
npm i -g @forge/cli@latest && forge login     # API token with Forge scopes
forge site provision                          # demo site
cd forge-app && npm install
forge register                                # once; fills app.id in manifest.yml
forge variables set --encrypt RUNNER_TOKEN change-me
forge variables set RUNNER_URL https://<runner-host>
forge variables set --encrypt GITHUB_TOKEN <pat>
forge variables set --encrypt GITHUB_WEBHOOK_SECRET <secret>
forge deploy && forge install --demo-site --product jira
forge webtrigger                              # copy the runner-events URL
forge tunnel                                  # live reload while building

# in another terminal, the fake runner:
EVENTS_URL=<runner-events url> pnpm dev:runner-mock
```

After changing `packages/contracts`, run `pnpm sync:contracts` and commit `forge-app/src/contracts`.

**Person B: runner**

```bash
pnpm --filter @pr-agent/runner dev:cli --context ../mocks/fixtures/context.json   # pipeline without Forge
pnpm dev:runner                                                                  # API on :4100
```

Full runner with Docker: `cp .env.example .env`, fill it in, then `docker compose -f infra/compose.yml --profile tunnel up --build` on a laptop. On the Azure VM: `VM_KEY=<key> infra/deploy.sh` (runner on 127.0.0.1:4100 behind the edge Caddy). See [docs/SETUP.md](docs/SETUP.md).

Docker tests (real sandboxes, checkout-demo main vs PR #1): `DOCKER_TESTS=1 pnpm --filter @pr-agent/runner test`. The 10/10 check: `pnpm --filter @pr-agent/runner dev:cli --scenarios ../mocks/fixtures/scenarios.json --repeat 10`.

## How we work

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: stay in your folders, change contracts only by PR, merge to `main` at least every 6 hours, and update this README on every merge.
