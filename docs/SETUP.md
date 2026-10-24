# Setup

Everything you need before writing code: where things run, every secret, and every account.

## Where things run

| Part | Where | Why |
|---|---|---|
| Forge app (`forge-app/`) | Atlassian cloud, deployed with `forge deploy` | Required by the challenge. Forge can't run Docker. |
| Runner + sandboxes (`runner/`, `demo-app/`) | **Any machine with Docker**: a laptop or the Azure VM | Needs Docker to build base and PR stacks. |

**Laptop instead of Azure works.** Forge lives in Atlassian's cloud, so it has to reach the runner over public HTTPS. On a laptop that means a tunnel:

```bash
cp .env.example .env    # fill it in, see below
docker compose -f infra/compose.yml --profile tunnel up --build
# copy the https://<random>.trycloudflare.com URL from the tunnel logs
cd forge-app && forge variables set RUNNER_URL https://<random>.trycloudflare.com && forge deploy
```

Trade-offs:
- The laptop must be awake and online whenever the agent runs. That includes recording the video and live judging.
- The quick-tunnel URL changes on every restart, so you re-set `RUNNER_URL` and redeploy each time. For a stable URL, use a named Cloudflare tunnel (free account) or ngrok with a reserved domain.
- The domain has to be listed in `forge-app/manifest.yml` under `permissions.external.fetch.backend` (and `frames` for the live view). Try `*.trycloudflare.com` first. If Forge rejects the wildcard, put the exact host in.
- A laptop is fine for building and for the video. Move to the Azure VM only if you want it always on, or you're going for an Azure prize.

## Secrets and settings

### Forge app: `forge variables`
Set from `forge-app/`. `--encrypt` hides the value. Then run `forge deploy` again.

| Name | Encrypt | What |
|---|---|---|
| `RUNNER_URL` | no | Public HTTPS URL of the runner (tunnel or VM) |
| `RUNNER_TOKEN` | yes | Shared secret with the runner. Any long random string: `openssl rand -hex 24` |
| `GITHUB_TOKEN` | yes | PAT that reads PR files + comments and writes PR comments + commit statuses |
| `GITHUB_WEBHOOK_SECRET` | yes | The same string you type into the GitHub webhook settings |

### Runner: `.env` (copy `.env.example`)

| Name | What |
|---|---|
| `RUNNER_TOKEN` | Same value as the Forge variable |
| `EVENTS_URL` | The `runner-events` web trigger URL. Run `forge webtrigger` after `forge install` and pick `runner-events` |
| `GITHUB_TOKEN` | PAT with read access to the demo repo, to clone base and head |
| `FACTORY_API_KEY` | Factory Droid key for the planner (check Factory's docs for the exact variable their SDK reads) |
| `ARTIFACTS_DIR` | Where traces and screenshots go. Default `/data/artifacts` |
| `SANDBOX_IDLE_TTL_MIN` | Minutes before idle sandboxes shut down. Default `30` |
| `DOMAIN` | VM only, for Caddy HTTPS |

### GitHub webhook (on the demo repo)
Settings → Webhooks → Add webhook:
- **Payload URL**: the `github-webhook` URL from `forge webtrigger`
- **Content type**: `application/json`
- **Secret**: the same value as `GITHUB_WEBHOOK_SECRET`
- **Events**: only "Pull requests"

## Accounts and logins

| Service | Who | What to do |
|---|---|---|
| **Atlassian** | both | Make an Atlassian account. Create an [API token with scopes](https://id.atlassian.com/manage-profile/security/api-tokens), pick **Forge**, keep the default scopes. Then `npm i -g @forge/cli@latest` and `forge login`. |
| **Demo site** | A creates, invites B | `forge site provision` gives a free Jira + Confluence site. Invite your teammate as an admin from the site's admin settings. Check that Rovo is on. |
| **Forge app** | A registers | `cd forge-app && forge register` once, then commit the `app.id` line in `manifest.yml`. To let B deploy too, add them as a contributor in the [developer console](https://developer.atlassian.com/console/myapps/). |
| **GitHub** | both | This repo is for our code. Make a **separate demo repo** for the checkout app, so the agent tests PRs there. Create a fine-grained PAT on the demo repo with Contents: read, Pull requests: read/write, Commit statuses: read/write. |
| **Greptile** | B | Sign in with GitHub and install it on the **demo repo** so it comments on the bug PR. |
| **Factory** | B | Create an account, get a Droid API key, and confirm hackathon credits at the Factory table. |
| **Cloudflare** | nobody | Quick tunnels need no account. A named, stable tunnel needs a free account. |
| **Azure** | optional | Only if you move the runner to a VM. Check Azure for Students credits. |
| **Docker** | B (A for runner-mock: no) | Docker Desktop or Docker Engine on whoever runs the runner. runner-mock needs only Node. |

## Jira data for the demo

On the demo site:
- Project **PAY**, issue **PAY-12** "Simplify payment retry logic", with an **Acceptance criteria** section:
  1. A customer is never charged twice for one order
  2. Retries after a provider error succeed
  3. A provider timeout leaves the order pending
- A Confluence page **Payments retry spec**, linked from PAY-12 (Link → Confluence page).
- The bug PR's title starts with `PAY-12:` so the agent finds the ticket.

## Order of setup

1. Both: Node 22 or 24, `corepack enable`, `pnpm install`, Forge CLI, `forge login`.
2. A: `forge site provision`, invite B, `forge register`, `forge deploy`, `forge install --demo-site --product jira`, `forge webtrigger`.
3. B: demo repo + Greptile + Factory key. Fill `.env`, then start the runner with the tunnel.
4. A: set the Forge variables with the tunnel URL and redeploy. Add the GitHub webhook to the demo repo.
5. Open a PR titled `PAY-12: ...` on the demo repo and watch the panel on PAY-12.
