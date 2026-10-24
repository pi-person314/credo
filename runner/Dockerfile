FROM mcr.microsoft.com/playwright:v1.49.1-noble
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends docker.io git && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @pr-agent/runner...
CMD ["pnpm", "--filter", "@pr-agent/runner", "start"]
