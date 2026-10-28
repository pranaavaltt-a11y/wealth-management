#!/usr/bin/env bash
# Run the D6 load-test matrix: workers x users, 2 minutes each, results in docs/results/loadtest/.
# Uses the Locust service by default; set LOCUST="python -m locust" to run Locust from the host instead.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=docs/results/loadtest
mkdir -p "$OUT"
DURATION=${DURATION:-120s}
LOCUST=${LOCUST:-}
run() {  # workers users label [extra env]
  local workers=$1 users=$2 label=$3; shift 3
  docker compose up -d --no-build --scale agent-worker="$workers" "$@" >/dev/null 2>&1
  sleep 8
  docker compose exec -T redis redis-cli DEL q:runs >/dev/null
  echo "== $label: workers=$workers users=$users"
  if [ -n "$LOCUST" ]; then
    $LOCUST -f loadtest/locustfile.py --host http://localhost:8000 --headless -u "$users" -r 2 -t "$DURATION" \
      --csv "$OUT/$label" --only-summary >/dev/null 2>&1 || true
  else
    docker compose --profile loadtest run --rm locust --headless -u "$users" -r 2 -t "$DURATION" \
      --csv "/mnt/results/loadtest/$label" --only-summary >/dev/null 2>&1 || true
  fi
  grep full_run "$OUT/${label}_stats.csv" || true
  sleep 15  # let in-flight runs drain
}
for u in 2 4 6; do run 1 "$u" "w1_u$u"; done
for u in 2 4 6 8 12; do run 3 "$u" "w3_u$u"; done
WORKER_CONCURRENCY=4 run 3 12 "w3c4_u12"
UNIQUE=0 run 3 4 "w3_u4_cached"
