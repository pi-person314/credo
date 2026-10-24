# PR Confidence Agent: Final Spec (v3, Forge)

Cal Hacks · Atlassian Agentic Workforce Challenge · **Track 1: Agents that do the work**

## 1. What it does

A developer opens a pull request for a Jira ticket. Our agent, a Forge app living in Jira:

1. Reads the ticket, its acceptance criteria, linked Confluence spec pages, the PR diff, and Greptile's review comments.
2. Finds behavior the PR changes that nobody has proven works.
3. Starts two copies of the app in Docker: one on the old code (**base**), one on the new code (**PR**).
4. Runs the same tests on both and compares.
5. Shows everything **inside the Jira ticket**: a status for each acceptance criterion, evidence, and a **live sandbox** where the reviewer watches the agent's browser, clicks around, flips failure knobs, and asks for new tests in plain English, from the panel or from Rovo chat.
6. Does the follow-up work: comments on the ticket, files a linked Bug with repro steps if something broke, and posts to the PR. Anything that changes the ticket's workflow waits for a human's OK. Every write goes in an audit log.

It never says a PR is "safe". Humans still decide to merge.

**Why this fits the challenge:** the agent starts from what is already in Jira and Confluence (ticket, acceptance criteria, specs, owners), and it leaves the team with less work: no manual QA pass, no hand-written bug report, no chasing a repro.

## 2. Words we use

| Word | Meaning |
|---|---|
| Session | One review of one PR for one Jira issue, at two pinned commits (`baseSha`, `headSha`). |
| Sandbox | A throwaway Docker stack (app + database + fake payment provider) at one commit. Each session has `base` and `head`. |
| Scenario | One test, written as JSON. The planner writes it; the runner executes it. |
| Assertion | One check in a scenario: `PASS`, `FAIL`, `INCONCLUSIVE`, `NOT_RUN`. |
| Diff | One scenario's result on base vs PR. |
| Coverage | One acceptance criterion's status: `VERIFIED`, `FAILED`, `UNTESTED`, `INCONCLUSIVE`. |
| Ask | A reviewer's plain-English test request (panel or Rovo). |
| Knob | A failure switch applied to both sandboxes, such as "provider times out". |
| Live view | The runner's page showing both sandboxes live, embedded in the Jira panel. |

## 3. Scope

### P0 (must work for the video)
- **Forge app on Jira** (`forge-app/`):
  - Web trigger for GitHub `pull_request` opened / synchronize. Jira key from PR title or branch.
  - Reads the Jira issue, acceptance criteria, assignee, and Confluence pages linked from the issue.
  - **Issue panel "PR Confidence"** (UI Kit): verdict, acceptance-criteria checklist, risks, scenario table (base / PR), evidence links, knobs, reset, ask box, timeline, audit log, and the embedded live view.
  - **Rovo agent** with actions: get status, ask for a test, set knobs, file regression Bug (after confirm).
  - Web trigger that receives runner events. State in Forge KVS.
  - Publishing: Jira comment with the report; linked Bug with repro + evidence (after confirm); GitHub PR comment + commit status.
  - Guardrail: proposing "move back to In Progress" needs a click from a human. Audit log of every write.
- **Runner on an Azure VM** (`runner/`):
  - Runs the whole pipeline: build sandboxes, plan (Factory Droid), run, compare, report results.
  - Two sandboxes from the two SHAs with the same seed.
  - Executes HTTP + Playwright steps, collects trace, screenshot, logs, DB rows.
  - Reruns failures twice and labels each diff.
  - Live view page: the agent's browser on both apps (Chrome screencast over WebSocket) plus clickable previews.
  - Knobs and reset applied to both sandboxes.

### P1 (only if ahead)
- Attach the failure screenshot to the Jira Bug.
- Write a "Verification report" Confluence page.
- Jira trigger: issue moved to "In Review" starts a session.
- Take over the agent's browser, then hand it back.
- Export a scenario as a Playwright `.spec.ts` file.

### Cut
- Our own web app, API server, Postgres, Convex.
- VNC / remote desktop.
- Extra routes and fault types; many sessions at once.

## 4. Architecture

```
 GitHub ──webhook──►┌──────────────── Forge app (Atlassian cloud) ────────────────┐
                    │ webtrigger: github   → queue → ingest Jira + Confluence      │
                    │ webtrigger: events   ← runner events → KVS                   │
                    │ issue panel (UI Kit) · Rovo agent + actions · audit log      │
                    │ publish: Jira comment / Bug · GitHub comment + status        │
                    └──────────┬──────────────────────────▲─────────────────────────┘
                     start/ask/knobs (HTTPS)            events (HTTPS)
                    ┌──────────▼──────────────────────────┴─────────────────────────┐
                    │ Azure VM · Docker                                              │
                    │  caddy (HTTPS) → runner: orchestrator · Droid planner ·        │
                    │                  sandbox manager · executor · verifier ·      │
                    │                  live view page · artifacts                   │
                    │  sb-<id>-base  (app, postgres, fakepay)  @ baseSha            │
                    │  sb-<id>-head  (app, postgres, fakepay)  @ headSha            │
                    └────────────────────────────────────────────────────────────────┘
```

Rule of thumb: **Forge talks to people and Atlassian. The runner does the heavy work.** Forge functions are short. Every call to the runner returns at once, and the runner reports back with events.

| Part | Owner | Job |
|---|---|---|
| `forge-app` | A | Everything inside Atlassian, plus GitHub webhook in and GitHub publish out. |
| `runner` | B | Everything that runs code: sandboxes, planner, tests, compare, live view, artifacts. |
| `demo-app` | B | The checkout app with the bug. |
| `infra` | B | Azure VM, compose, Caddy. |

## 5. Flow

1. **PR opened** → GitHub calls the Forge `github` web trigger. It checks the signature, replies fast, and puts a job on a Forge queue.
2. **Ingest** (Forge consumer): find the Jira key, read the issue, acceptance criteria, linked Confluence pages, PR files, and Greptile bot comments. Create the session in KVS. Call `runner POST /sessions` with the full context.
3. **Runner pipeline**: build both sandboxes → plan (Droid, with the manifest + scenario schema; validate, retry once, fall back to canned) → route → run each scenario on both → rerun new failures twice → label diffs → up to 3 follow-up scenarios, one round → `session.complete`.
4. **Events**: the runner posts every step to the Forge `events` web trigger. Forge stores them. The panel polls every 2 s.
5. **Report** (Forge, on `session.complete`): compute verdict + coverage, post a Jira comment and a GitHub comment + status. If there's a regression, show "File Bug" and "Move back to In Progress" buttons. Rovo can do the same after the user confirms.
6. **Interactive**: sandboxes stay up 30 min after last activity. Asks (panel or Rovo), knobs, and reset go Forge → runner. Each ask runs on both sandboxes and updates the report.

Budgets per session: 8 scenarios, 3 attempts each, 5 minutes before the first report.

## 6. Interactive sandbox (inside Jira)

The **PR Confidence** issue panel:

- **Header**: verdict lozenge, PR link, sandbox status, Reset.
- **Acceptance criteria**: each line from the ticket with `VERIFIED` / `FAILED` / `UNTESTED` and the scenarios behind it.
- **Live sandbox**: the runner's live view, embedded. Toggle between **Watch the agent** (streamed browser frames + current step) and **Try it yourself** (clickable base and PR pages). Knobs above it: provider `ok / slow / timeout / error`, latency.
- **Tests**: scenario table with base / PR results; each row opens evidence (DB rows, screenshot, trace, logs).
- **Ask**: text box. "What if the provider times out and the user retries?" → new scenario → runs on both → new row.
- **Activity**: timeline + audit log of every agent write.

The same ask works from **Rovo chat** or the Jira Agents panel through the Rovo agent.

Rules:
- Knobs always hit both sandboxes.
- Every ask and result is saved and shows up in the report.
- Reset reseeds both to the same fixture.
- The live view is served by the runner at `/view/<sessionId>?t=<token>`. It uses the runner's own WebSocket and preview proxy, so Forge only has to embed one page.
- **Spike at H0–H2:** confirm Forge lets the panel embed an external page (Custom UI resource via UI Kit `Frame`, with the runner domain in `permissions.external.frames`). Fallback: an "Open live sandbox" button that opens the same page in a new tab.

## 7. Results

| base \ PR | PASS | FAIL |
|---|---|---|
| PASS | `UNCHANGED_PASS` | `NEW_REGRESSION` (after 2 reruns; mixed → `FLAKY`) |
| FAIL | `IMPROVEMENT` | `EXISTING_FAILURE` |

Errors or timeouts → `INCONCLUSIVE`, never a pass.

Coverage per acceptance criterion (scenarios point at it with `sourceRefs: ["jira:PAY-5#ac1"]`):
- `FAILED` if any linked scenario is a `NEW_REGRESSION` or `EXISTING_FAILURE`.
- `INCONCLUSIVE` if any is `FLAKY` / `INCONCLUSIVE`.
- `VERIFIED` if at least one ran and all passed.
- `UNTESTED` if no scenario points at it.

Verdict:
- `BLOCKING_REGRESSION`: any confirmed `NEW_REGRESSION`.
- `NEEDS_REVIEW`: any flaky / inconclusive result, an untested acceptance criterion, or an untested high-risk finding.
- `NO_BLOCKERS_FOUND`: everything ran and passed. Still lists what wasn't tested.

## 8. Contracts (frozen at hour 2)

Source of truth: `packages/contracts` (TypeScript + zod). The runner imports it. The Forge app gets a synced copy at `forge-app/src/contracts/` via `pnpm sync:contracts`, and CI fails if the copy is stale. Forge is kept out of the pnpm workspace so `forge deploy` sees a normal npm `node_modules`.

### Enums
```
Env            = base | head
SessionStatus  = INGESTING | PREPARING | PLANNING | RUNNING | REPORTING | READY | FAILED
Route          = STATIC_ONLY | TARGETED_TEST
AssertionResult= PASS | FAIL | INCONCLUSIVE | NOT_RUN
DiffClass      = UNCHANGED_PASS | NEW_REGRESSION | EXISTING_FAILURE | IMPROVEMENT | FLAKY | INCONCLUSIVE
Coverage       = VERIFIED | FAILED | UNTESTED | INCONCLUSIVE
Recommendation = NO_BLOCKERS_FOUND | NEEDS_REVIEW | BLOCKING_REGRESSION
Origin         = planner | followup | ask | recorded
ProviderMode   = ok | slow | timeout | error
```

### Scenario
```json
{
  "id": "sc_concurrent_retry",
  "objective": "5 retries at once make exactly 1 charge",
  "origin": "planner",
  "priority": "P0",
  "fixture": "cart_one_item",
  "knobs": { "provider": "slow", "latencyMs": 800 },
  "steps": [
    { "op": "http", "method": "POST", "path": "/api/orders", "saveAs": "order" },
    { "op": "parallel", "count": 5,
      "step": { "op": "http", "method": "POST", "path": "/api/pay", "body": { "orderId": "$order.id" } } }
  ],
  "assertions": [
    { "id": "a1", "type": "db_count", "table": "charges", "where": { "orderId": "$order.id" }, "equals": 1 }
  ],
  "rationale": "PR removed the payment lock; retries are untested",
  "sourceRefs": ["jira:PAY-5#ac1", "greptile:c_8812"]
}
```
Step ops: `http`, `parallel`, `ui` (`goto`, `click`, `dblclick`, `fill`), `wait`. Assertions: `db_count`, `http_status`, `json_path`, `ui_text`.

### Context (Forge → runner)
```
Context { session, prBody, changedFiles[], jira { key, summary, description,
          acceptanceCriteria[], assignee?, url }, confluence[{ id, title, excerpt, url }],
          findings[], manifest, priorScenarioIds[] }
```

### Runner API (B builds, Forge calls). Header `x-token: RUNNER_TOKEN`.
```
POST   /sessions               { context }                 → 202  start the whole pipeline
POST   /sessions/:id/ask       { prompt, askId }           → 202
POST   /sessions/:id/knobs     { provider, latencyMs }     → 200
POST   /sessions/:id/reset                                 → 200
GET    /sessions/:id/status                                → { base, head }
DELETE /sessions/:id                                       → 200
GET    /view/:id?t=<token>     live sandbox page (embedded in Jira)
GET    /preview/:id/:env/*     proxied sandbox app (used by the live view)
WS     /live/:id/:env          agent browser frames (used by the live view)
GET    /artifacts/:id/*?t=     evidence files
```

### Events (runner → Forge `events` web trigger), same token
```
Event { sessionId, ts, actor, type, status: start|ok|fail|info, message, data? }
```
Runner types: `sandbox.building`, `sandbox.healthy`, `sandbox.failed`, `sandbox.reset`, `sandbox.teardown`, `planner.started`, `planner.scenarios` (data: Scenario[]), `route.decided`, `run.started`, `run.assertion`, `run.finished` (data: Run), `verify.rerun`, `verify.diff` (data: Diff), `knobs.set`, `ask.complete`, `session.complete`, `session.failed`.
Forge types: `ingest.pr`, `ingest.jira`, `ingest.confluence`, `ingest.greptile`, `ask.received`, `report.ready`, `publish.jira`, `publish.github`, `bug.filed`, `transition.proposed`, `transition.approved`.

### Forge resolver functions (panel → backend)
```
getSession(issueKey)     → SessionDetail | null
getEvents(sessionId, after?) → Event[]
ask(sessionId, prompt)
setKnobs(sessionId, knobs)
reset(sessionId)
fileBug(sessionId, scenarioId)          // human click = approval
approveTransition(sessionId)            // human click = approval
getViewUrl(sessionId)    → signed /view URL
```

### Rovo actions
`get-verification` (GET), `ask-test` (TRIGGER), `set-knobs` (TRIGGER), `file-regression-bug` (TRIGGER, only after the user confirms in chat).

### Forge KVS keys
`session:<id>`, `issue:<issueKey>` → sessionId, `events:<id>:<chunk>`, `scenarios:<id>`, `runs:<id>`, `diffs:<id>`, `asks:<id>`, `report:<id>`, `audit:<issueKey>`.

### Demo app manifest + test hooks (B writes, planner reads)
```json
{
  "api": ["POST /api/orders", "POST /api/pay", "GET /api/orders/:id"],
  "pages": ["/cart", "/checkout", "/orders/:id"],
  "selectors": { "payButton": "[data-test=pay]", "status": "[data-test=order-status]" },
  "fixtures": ["cart_one_item", "cart_two_items"],
  "tables": ["orders", "charges"],
  "providerModes": ["ok", "slow", "timeout", "error"]
}
```
Hooks inside each sandbox only: `POST /__test/reset`, `POST /__test/seed {fixture}`, `POST /__test/provider {mode, latencyMs}`, `GET /__test/db/:table?…`.

## 9. Repo layout

```
pr-agent/
├── packages/contracts/   shared, TS + zod (both, by PR only)
├── forge-app/            A   manifest.yml, src/ (webtriggers, consumer, resolvers, rovo actions, panel), npm
│   └── src/contracts/    generated copy, do not edit
├── runner/               B   orchestrator, planner, sandbox, executor, verifier, live view
├── demo-app/             B   checkout app with the bug
├── infra/                B   compose.yml, Caddyfile, azure-vm.sh
├── mocks/
│   ├── runner-mock/      A   fake runner that posts canned events
│   └── fixtures/         B   context.json, scenarios.json
├── scripts/sync-contracts.mjs
├── docs/SPEC.md
└── README.md             updated on every merge to main
```

## 10. Work split

**Person A: Forge app.** Manifest + scopes + external fetch permissions, GitHub web trigger + queue consumer, Jira / Confluence / GitHub reads, KVS, events web trigger, issue panel (all sections), Rovo agent + actions, report + coverage, Jira comment / Bug / guarded transition, GitHub comment + status, audit log, live-view embed spike, `runner-mock`.

**Person B: runner + sandboxes.** Demo app + bug PR + PAY-5 ticket, Azure VM + compose + Caddy, sandbox manager, preview proxy, knobs + reset, executor, verifier, Droid planner (pipeline + asks), live view page + stream, artifacts with signed links, runner CLI.

Mocks so nobody waits:
- A: `mocks/runner-mock` takes `POST /sessions` and posts canned events to the Forge web trigger (works with `forge tunnel`).
- B: `pnpm --filter @pr-agent/runner dev:cli --context mocks/fixtures/context.json` runs the pipeline and prints events.

## 11. Demo video (3 minutes max)

1. **0:00** The PAY-5 ticket in Jira, with 3 acceptance criteria. Open a PR that "simplifies" retries.
2. **0:20** The PR Confidence panel lights up: reading the ticket, the Confluence spec, and Greptile's note. Sandboxes building.
3. **0:45** Plan: 3 scenarios, each linked to an acceptance criterion.
4. **1:05** Watch the agent: live browser on base and PR. Result: 1 charge vs 2. AC1 goes `FAILED`. Verdict `BLOCKING_REGRESSION`.
5. **1:40** Try it yourself: double-click Pay in both. Flip the provider to `timeout`. In Rovo: "What if the provider times out and the user retries?" A new row runs live.
6. **2:20** Click File Bug: a linked Bug appears with repro steps, evidence, and the assignee. Approve "Move back to In Progress". Show the audit log.
7. **2:45** GitHub PR: red status + comment. End.

The bug must reproduce 10/10: fake provider with fixed latency, 5 parallel calls, row count check.

## 12. Judging map

| Criterion | What we show |
|---|---|
| Creativity | A live, side-by-side sandbox inside a Jira ticket that you can talk to. |
| Usefulness | Acceptance criteria checked automatically; bug filed with repro; less QA and triage work. |
| Technical | Web triggers, queue consumer, KVS, UI Kit panel, Rovo agent + actions, Jira + Confluence REST, guarded writes, audit log. |

## 13. Setup checklist

- [ ] Node 22 or 24. `npm i -g @forge/cli@latest` (v14+). API token with Forge scopes → `forge login`.
- [ ] `forge site provision` → demo site. Confirm Rovo is on for the site.
- [ ] `cd forge-app && forge register && forge deploy && forge install --demo-site --product jira` (add `confluence` too).
- [ ] Jira project PAY, issue PAY-5 with acceptance criteria. Confluence page "Payments retry spec" linked from it.
- [ ] GitHub repo for the demo app, test PR, webhook pointing at the Forge web trigger URL, PAT stored as a Forge encrypted variable.
- [ ] Greptile installed on the demo repo.
- [ ] Factory account + Droid auth; confirm credits.
- [ ] Azure VM (4 vCPU / 16 GB), public DNS name, ports 80/443, Docker.
- [ ] Demo bug reproduces 10/10. Backup recording.

## 14. Risks

| Risk | Plan |
|---|---|
| Forge won't embed the live view | Spike first. Fallback: open it in a new tab from the panel. |
| Forge function time limits | Forge never waits on long work. Runner returns 202 and reports back with events. |
| pnpm vs Forge bundling | `forge-app` uses npm on its own; contracts are copied in. |
| Droid writes bad scenarios | Fixed JSON schema, manifest in prompt, validate + retry, canned fallback. |
| Race doesn't reproduce | Fake provider with fixed latency; prove 10/10 by hour 12. |
| Slow sandbox start | Tiny app, cached image, start building at ingest. First result under 3 min. |
| Rovo not available on the site | Panel ask box does the same thing. |
| Runner has Docker socket | Dedicated VM, demo repo only, sandboxes on internal networks with no secrets. |
