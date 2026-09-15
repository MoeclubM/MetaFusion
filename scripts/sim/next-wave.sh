#!/bin/bash
# 在服务器上开一个波次：优先覆盖进度最少的账号；已有波次在跑时直接退出（互斥）。
set -uo pipefail
REPO=/root/metafusion
APP=/root/mf-sim/app
LOGS=/root/mf-sim/logs
OPS=${OPS:-200}
CONC=${CONC:-6}
cd "$REPO" && git fetch origin --quiet && git reset --hard origin/main | tail -1
cp -f "$REPO"/scripts/sim/*.mjs "$APP"/
if docker ps --format "{{.Names}}" | grep -q mf-wave; then
  echo "已有波次在跑，退出"; docker ps --format "{{.Names}} | {{.Status}}" | grep mf-wave; exit 0
fi
source /root/mf-sim/env.sh
echo "=== 各账号累计成功数 ==="
declare -A TOT
for n in 01 02 03 04 05 06 07 08 09 10; do
  c=$(cat "$LOGS"/run-*-sim$n.jsonl 2>/dev/null | grep -o "\"status\":200" | wc -l | tr -d " ")
  TOT[$n]=${c:-0}
  printf "  sim%s=%s\n" "$n" "${TOT[$n]}"
done
SELECT=$(for n in 01 02 03 04 05 06 07 08 09 10; do echo "${TOT[$n]} $n"; done | sort -n | head -$CONC | awk '{printf "%d,", $2+0}' | sed "s/,$//")
WAVE="w$(date +%H%M%S)"
echo "=== 本轮账号: $SELECT（波次 $WAVE，每人 $OPS 次，并发 $CONC） ==="
nohup docker run --name "mf-wave-$WAVE" --rm -v "$APP":/app -v "$LOGS":/logs -w /app -u root -e MF_BASE="$MF_BASE" -e MF_USER_PASS="$MF_USER_PASS" -e MF_CONCURRENCY="$CONC" -e MF_LOG_DIR=/logs -e MF_AGENTS="$SELECT" mcr.microsoft.com/playwright:v1.49.1-jammy bash -lc "node sim.mjs $CONC $OPS 1 $WAVE" > "$LOGS/$WAVE.out" 2>&1 &
echo $! > /root/mf-sim/wave.pid
sleep 60
docker ps --format "{{.Names}} | {{.Status}}" | grep mf-wave || echo "(容器未起)"
tail -3 "$LOGS/$WAVE.out"
