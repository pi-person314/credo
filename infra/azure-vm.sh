#!/usr/bin/env bash
# One-time Azure VM setup, as done for the hackathon (rg-pr-agent / pr-agent-runner, West US 2,
# Ubuntu 24.04, Standard_D4as_v5 = 4 vCPU / 16 GB, 64 GB disk). Run the `az` part from a laptop, the
# rest on the VM. Then deploy with infra/deploy.sh.
set -euo pipefail

if [ "${1:-}" = "create" ]; then
  RG=${RG:-rg-pr-agent} VM=${VM:-pr-agent-runner} LOC=${LOC:-westus2} DNS=${DNS:?set DNS, e.g. pr-agent-yourname}
  az group create -n "$RG" -l "$LOC"
  az vm create -g "$RG" -n "$VM" --image Ubuntu2404 --size Standard_D4as_v5 --os-disk-size-gb 64 \
    --admin-username azureuser --generate-ssh-keys --public-ip-address-dns-name "$DNS"
  az vm open-port -g "$RG" -n "$VM" --port 80,443 --priority 1010
  # SSH: the default rule allows 22 from anywhere. Lock it to your IP with --source-address-prefixes if you prefer.
  az vm auto-shutdown -g "$RG" -n "$VM" --off || true
  echo "Host: $DNS.$LOC.cloudapp.azure.com"
  exit 0
fi

# On the VM:
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
sudo mkdir -p /opt/pr-agent/app /opt/pr-agent/edge && sudo chown -R "$USER" /opt/pr-agent
echo "Next: put infra/edge/Caddyfile in /opt/pr-agent/edge and start Caddy there (host networking, 80/443),"
echo "copy .env.example to /opt/pr-agent/app/.env and fill it in, then run infra/deploy.sh from your laptop."
