#!/usr/bin/env bash
# Deploys the runner to the Azure VM: ships the current git HEAD (no .git, no .env), then builds and
# (re)starts only the runner container. The edge Caddy (/opt/pr-agent/edge) is left alone; see infra/edge/.
#
#   VM_KEY=~/.ssh/pr-agent infra/deploy.sh            # from the repo, on a machine that can SSH to the VM
#
# The VM keeps its secrets in $VM_DIR/.env (copy .env.example and fill it in once).
set -euo pipefail
HOST=${VM_HOST:-azureuser@pr-agent-saksham-20261024.westus2.cloudapp.azure.com}
DIR=${VM_DIR:-/opt/pr-agent/app}
SSH=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${VM_KEY:+-i "$VM_KEY"} "$HOST")

cd "$(git rev-parse --show-toplevel)"
REV=$(git rev-parse --short HEAD)
[ -z "$(git status --porcelain)" ] || echo "note: uncommitted changes are NOT deployed (git archive HEAD)"

echo "==> shipping $REV to $HOST:$DIR"
"${SSH[@]}" "sudo mkdir -p '$DIR' && sudo chown \"\$(id -u):\$(id -g)\" '$DIR'"
git archive --format=tar HEAD | "${SSH[@]}" "tar -x -C '$DIR' && echo '$REV' > '$DIR/REVISION'"

if ! "${SSH[@]}" "test -s '$DIR/.env'"; then
  echo "!! $DIR/.env is missing on the VM. Copy .env.example there, fill it in, and run this again." >&2
  exit 1
fi

echo "==> building and starting the runner"
"${SSH[@]}" "cd '$DIR' && docker compose -f infra/compose.yml up -d --build --remove-orphans runner && docker compose -f infra/compose.yml ps runner"

echo "==> health"
for i in $(seq 1 30); do
  if "${SSH[@]}" "curl -fsS http://127.0.0.1:4100/health"; then echo; echo "deployed $REV"; exit 0; fi
  sleep 2
done
echo "!! runner did not become healthy; logs:" >&2
"${SSH[@]}" "docker logs --tail 50 pr-agent-runner" >&2
exit 1
