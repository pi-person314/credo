# syntax=docker/dockerfile:1.7
# Runner image: Node + Chromium (Playwright) + Docker CLI/Compose (sandboxes run on the host's daemon
# through the mounted socket) + git (checkouts) + Factory Droid CLI (planner).
# Build from the repo root: docker build -f runner/Dockerfile .
FROM docker:27-cli AS dockercli

FROM mcr.microsoft.com/playwright:v1.63.0-noble
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

# Optional build secret "ca": an extra CA for TLS-intercepting proxies (not needed on the VM).
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then cp /run/secrets/ca /usr/local/share/ca-certificates/build-ca.crt && update-ca-certificates; fi; \
    apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Factory Droid CLI for the planner. Non-fatal: without it the planner falls back to canned scenarios.
RUN --mount=type=secret,id=ca,required=false \
    (curl -fsSL https://app.factory.ai/cli | sh && for d in /root/.local/bin /root/.factory/bin; do [ -x "$d/droid" ] && ln -sf "$d/droid" /usr/local/bin/droid; done; droid --version) \
    || echo "WARN: droid CLI not installed; planner will use canned scenarios"

WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY runner/package.json runner/
COPY mocks/runner-mock/package.json mocks/runner-mock/
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --filter @pr-agent/runner...
COPY packages/contracts packages/contracts
COPY runner runner
COPY mocks/fixtures mocks/fixtures
COPY demo-app/manifest.json demo-app/manifest.json

ENV NODE_ENV=production PORT=4100 WORK_DIR=/data/work ARTIFACTS_DIR=/data/artifacts SANDBOX_NETWORK_MODE=attach
EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD curl -fsS http://127.0.0.1:4100/health || exit 1
WORKDIR /repo/runner
CMD ["node", "--import", "tsx", "src/index.ts"]
