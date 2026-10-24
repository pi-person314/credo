#!/usr/bin/env bash
# Smoke test on the VM: runs the demo session (mocks/fixtures/context.json, checkout-demo PR #1) against the
# local runner and prints its events and diffs. Reads RUNNER_TOKEN from .env so it never leaves the VM.
#   cd /opt/pr-agent/app && infra/smoke.sh            # tears the sandboxes down at the end
#   KEEP=1 infra/smoke.sh                             # keeps them for the live view
# Exits non-zero if the session fails or no report arrives within TIMEOUT_SEC.
set -euo pipefail
cd "$(dirname "$0")/.."
RUNNER=${RUNNER:-http://127.0.0.1:4100}
TIMEOUT_SEC=${TIMEOUT_SEC:-600}
# The token the running container actually got (compose strips quotes and comments); .env as a fallback.
TOKEN=$(docker exec pr-agent-runner printenv RUNNER_TOKEN 2>/dev/null ||
  grep -E '^RUNNER_TOKEN=' .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//; s/[[:space:]]*$//; s/^["'"'"']//; s/["'"'"']$//')
[ -n "$TOKEN" ] || { echo "RUNNER_TOKEN missing in .env" >&2; exit 1; }
grep -qE '^GITHUB_TOKEN=.+' .env || echo "WARN: GITHUB_TOKEN is empty; private repos can't be fetched"
grep -qE '^FACTORY_API_KEY=.+' .env || echo "WARN: FACTORY_API_KEY is empty; the planner will use canned scenarios"
ID=$(python3 -c 'import json;print(json.load(open("mocks/fixtures/context.json"))["session"]["id"])')

api() { curl -fsS -H "x-token: $TOKEN" -H 'content-type: application/json' "$@"; }
cleanup() { [ -n "${KEEP:-}" ] || api -X DELETE "$RUNNER/sessions/$ID" >/dev/null || true; }
trap cleanup EXIT

python3 -c 'import json,sys;print(json.dumps({"context":json.load(open("mocks/fixtures/context.json"))}))' |
  api -X POST --data @- "$RUNNER/sessions"
echo
T=$(api "$RUNNER/sessions/$ID/view-url" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')

SEEN=$(mktemp)
POLL=$(mktemp --suffix=.py)
cat >"$POLL" <<'EOF'
# Prints new events (and the diffs once done) to stderr; prints ok/fail/"" to stdout.
import json, os, sys
s = json.load(sys.stdin)
path = sys.argv[1]
seen = set(open(path).read().splitlines())
with open(path, "a") as f:
    for e in s.get("events", []):
        key = f"{e['ts']} {e['type']} {e['message']}"
        if key in seen:
            continue
        f.write(key + "\n")
        print(f"{e['ts'][11:19]}  {e['type']:<18} {e['status']:<5} {e['message']}", file=sys.stderr)
        if e["type"] in ("session.complete", "session.failed"):
            open(path + ".done", "w").write("ok" if e["type"] == "session.complete" else "fail")
result = open(path + ".done").read() if os.path.exists(path + ".done") else ("fail" if s.get("status") == "FAILED" else "")
if result:
    for d in s.get("diffs", []):
        print(f"  {d.get('classification', '?'):<18} {d.get('scenarioId', '?')}", file=sys.stderr)
print(result)
EOF
deadline=$(( $(date +%s) + TIMEOUT_SEC ))
while :; do
  after=$(tail -1 "$SEEN" | cut -c1-24)
  result=$(curl -fsS -G "$RUNNER/view/$ID/state" --data-urlencode "t=$T" --data-urlencode "after=$after" | python3 "$POLL" "$SEEN")
  [ "$result" = ok ] && exit 0
  [ "$result" = fail ] && exit 1
  [ "$(date +%s)" -lt "$deadline" ] || { echo "no report after ${TIMEOUT_SEC}s" >&2; exit 1; }
  sleep 5
done
