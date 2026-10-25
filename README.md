# Credo

**Merge with confidence.** Credo is an AI agent that lives inside Jira and proves whether a pull request does what its ticket asks, before anyone merges it.

Built for Cal Hacks, Atlassian Agentic Workforce Challenge, Track 1: *Agents that do the work*.

## The problem

Coding agents open pull requests faster than people can review them. A diff can look harmless and still break the one thing the ticket cared about. Code review reads the change, but nobody runs it against the acceptance criteria. That QA pass, the repro and the bug report are still manual work.

## What Credo does

When a PR opens for a Jira ticket, Credo:

1. **Reads the context**: the ticket and its acceptance criteria, the Confluence specs linked from it, the PR diff, and Greptile's review.
2. **Plans tests** with Factory Droid for the behavior the PR changes, each one tied to an acceptance criterion.
3. **Runs them on both versions**: two throwaway Docker sandboxes, one on the old code (**base**) and one on the new code (**PR**), with the same data.
4. **Compares and reports** inside the Jira ticket: a verdict, a status for every acceptance criterion, and evidence for every result.
5. **Does the follow-up work**: comments on the ticket and the PR, sets a GitHub commit status that blocks the merge on a regression, and files a linked Bug with repro steps when a human says so.

Credo never calls a PR "safe". It shows what it verified, what failed and what it didn't test. Humans still decide.

## Inside the ticket

The **Credo** panel on the Jira issue has:

- **Verdict**: `BLOCKING_REGRESSION`, `NEEDS_REVIEW` or `NO_BLOCKERS_FOUND`, with the failure in plain words, e.g. "PR: 2 charges for the order (expected 1)". **Run again** starts a fresh run on the same PR head.
- **Acceptance criteria**: each criterion as `VERIFIED`, `FAILED`, `INCONCLUSIVE` or `UNTESTED`, with the tests behind it and the sources Credo read.
- **Live sandbox**: base and PR running side by side. Watch the agent's browser, ▶ Replay any test, click through both apps yourself or take over the agent's browser, and flip failure knobs (provider `ok`, `slow`, `timeout`, `error`) on both at once.
- **Tests**: every test with its base and PR result and evidence (HTTP log, DB rows, screenshot, Playwright trace). Any test exports as a Playwright `.spec.ts`.
- **Ask**: request a new test in plain English ("What if the provider times out and the user retries?"). It runs on both sides and lands in the report.
- **Activity**: a timeline and an audit log of every write the agent made.

The same agent is in **Rovo chat**: check the verification status, ask for a test, set knobs, or file the regression Bug after you confirm.

**Human in the loop.** Filing a Bug and moving the ticket back to In Progress each need a human click in the panel or a confirmation in Rovo. Every write is audited.

## How it works

```
GitHub PR ──webhook──► Forge app (Atlassian cloud)
                        ingest Jira + Confluence + GitHub + Greptile
                        issue panel · Rovo agent · KVS state · audit log
                        publish: Jira comment / Bug · GitHub comment + status
                              │ start, ask, knobs           ▲ events
                              ▼                             │
                       Runner (Azure VM, Docker, behind Caddy)
                        orchestrator · Droid planner · sandbox manager
                        executor · verifier · live view · evidence
                        sb-<id>-base  (app + Postgres + fake provider) @ baseSha
                        sb-<id>-head  (app + Postgres + fake provider) @ headSha
```

**Forge talks to people and Atlassian; the runner does the heavy work.** Forge functions stay short: every runner call returns at once, and the runner streams events back to a Forge web trigger.

- **Ingest** (Forge queue consumer): finds the Jira key in the PR title or branch, reads the context, stores the session in Forge KVS and starts the runner.
- **Plan**: Factory Droid gets the ticket, criteria, specs, findings, diff and the app's manifest, and writes JSON scenarios. They are validated against a schema, retried once on error, and fall back to canned scenarios.
- **Run**: steps are `http`, `parallel`, `ui` (Playwright) and `wait`; checks are `db_count`, `http_status`, `json_path` and `ui_text`. New failures are rerun twice before they count.
- **Compare**: each test gets a label from its base and PR results.

| base \ PR | PASS | FAIL |
|---|---|---|
| **PASS** | `UNCHANGED_PASS` | `NEW_REGRESSION` (mixed reruns: `FLAKY`) |
| **FAIL** | `IMPROVEMENT` | `EXISTING_FAILURE` |

Errors and timeouts are `INCONCLUSIVE`, never a pass. A confirmed `NEW_REGRESSION` makes the verdict `BLOCKING_REGRESSION`; anything flaky, inconclusive or untested makes it `NEEDS_REVIEW`.

- **Safety**: sandboxes run on internal networks with CPU and memory caps, no host ports and none of the runner's secrets, and only an allowlist of compose settings from the PR is kept. They shut down after 30 idle minutes.

## The demo

Jira ticket [PAY-5](https://one-atlas-fdzb.atlassian.net/browse/PAY-5) says payment retries must never charge twice. An agent opens [checkout-demo PR #1](https://github.com/pi-person314/checkout-demo/pull/1) to "simplify payment retries", which quietly removes the payment lock. Credo runs both versions: base makes 1 charge, the PR makes 2 or more. AC1 fails, the verdict is a blocking regression, the PR's `Credo` status turns red, and one click files the Bug. The race reproduces 10 times out of 10.

## Repo

```
packages/contracts/  shared types, scenario schema, runner API, events, verdict rules (TypeScript + zod)
forge-app/           Forge app: manifest, web triggers, queue consumers, issue panel, Rovo agent and actions
runner/              orchestrator, Droid planner, sandbox manager, executor, verifier, live view
infra/               runner image, compose, edge Caddy, deploy script
mocks/               fake runner and fixtures for building each half on its own
demo-app/            manifest of the checkout app (the app lives in pi-person314/checkout-demo)
```

Stack: Atlassian Forge (UI Kit, Rovo, KVS, queues, web triggers), Jira and Confluence REST, GitHub, Greptile, Factory Droid, Docker, Playwright, Node 22, TypeScript, zod, Azure.

## Run it

Needs Node 22 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm check:contracts

# the runner pipeline locally, without Forge
pnpm --filter @pr-agent/runner dev:cli --context ../mocks/fixtures/context.json

# the Forge app
cd forge-app && npm install && forge deploy && forge install --product jira
```

Accounts, secrets, the Azure VM and the GitHub webhook are in [docs/SETUP.md](docs/SETUP.md). The full design is in [docs/SPEC.md](docs/SPEC.md).
