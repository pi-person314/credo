#!/usr/bin/env bash
# Owner: Person B. One-time VM setup (Ubuntu 24.04, 4 vCPU / 16 GB, ports 80/443 open).
# TODO(B): az vm create ... ; then on the VM:
set -euo pipefail
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
echo "Clone the repo, copy .env.example to .env, then: docker compose -f infra/compose.yml up -d --build"
