# PR Confidence

A Forge app for Jira (Atlassian Agentic Workforce Challenge, Track 1). When a PR opens for a Jira ticket, the agent reads the ticket, its acceptance criteria, linked Confluence specs, the diff, and Greptile's review. It then runs the risky behavior on the old code (**base**) and the new code (**PR**) side by side in Docker sandboxes.

Everything shows up inside the Jira ticket:
- a status for each acceptance criterion
- evidence for every result
- a **live sandbox** where you watch the agent's browser, click around yourself, flip failure knobs, and ask for new tests in plain English (panel or Rovo chat)

On a regression it files a linked Bug with repro steps. Workflow changes wait for a human's OK, and every write goes in an audit log.

Full spec: [docs/SPEC.md](docs/SPEC.md) · Setup, secrets and accounts: [docs/SETUP.md](docs/SETUP.md)

## Status

| Area | Owner | State |
|---|---|---|
| Shared contracts (`packages/contracts`) | both | ✅ v0.2: types, scenario format, runner API, events, coverage + verdict rules, 21 tests |
| `forge-app` (Jira panel, Rovo agent, web triggers, KVS, publish) | A | 🟡 manifest + module stubs; GitHub webhook verify + enqueue; events web trigger stores events |
| `mocks/runner-mock` | A | ✅ fake runner: full canned pipeline + asks, posts events to the Forge web trigger |
| `runner` (orchestrator, planner, sandboxes, executor, verifier, live view) | B | 🟡 stub: `/health`, token check, event sinks, CLI |
| `demo-app` | B | 🟡 `manifest.json` + requirements only |
| `infra` (compose: laptop + tunnel or Azure VM + Caddy) | B | 🟡 draft |

## Changelog

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

Full runner with Docker: `cp .env.example .env`, fill it in, then `docker compose -f infra/compose.yml --profile tunnel up --build` on a laptop, or `--profile vm up -d --build` on a VM. See [docs/SETUP.md](docs/SETUP.md).

## How we work

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: stay in your folders, change contracts only by PR, merge to `main` at least every 6 hours, and update this README on every merge.
