#!/usr/bin/env bash
# ==============================================================================
# MetaFusion 备份保留策略：最近 N 天全留 + 更早每周 1 份共 M 周
# ==============================================================================
# 服务器 / 只有 ~12G 可用且备份与库同盘，所以保留策略不是"顺手清理"，是容量防线：
# 先按时间窗算该留哪些，**把将删清单和释放空间打印出来**，再动手删。
#
# 规则（自上而下，先命中先算）：
#   1. 带 FAILED 标记的备份：不是可用备份，只留 24 小时供排查，之后一律删；
#   2. 最近 --keep-days 天内：全部保留（默认 7 天，保证"回到任意一天"）；
#   3. 更早的：按 ISO 周分组，每周只留最新一份，保留 --keep-weeks 周（默认 4 周）；
#   4. 再早的：删。
#
# 用法：scripts/prune_backups.sh --help
# ==============================================================================

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/mf-backup-lib.sh
. "$SCRIPT_DIR/lib/mf-backup-lib.sh"

DEST=${MF_BACKUP_DIR:-$(dirname "$MF_REPO_ROOT")/backups}
KEEP_DAYS=7
KEEP_WEEKS=4
MAX_GB=""
DRY_RUN=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
MetaFusion 备份保留策略（最近 N 天全留 + 更早每周 1 份共 M 周）

用法: scripts/prune_backups.sh [选项]

选项:
  --dest DIR      备份根目录（默认 <仓库父目录>/backups，服务器上即 /root/metafusion/backups）
  --keep-days N   最近 N 天的备份全部保留（默认 7）
  --keep-weeks N  更早的备份按周各保留最新一份，保留 N 周（默认 4）
  --max-gb N      清理后仍超过 N GiB 则告警并以退出码 3 结束（默认不检查）
  --dry-run       只打印将删除的清单，不删任何东西
  --yes           跳过交互确认（定时任务/自动化用；非交互环境必须显式给）
  -h, --help      显示本帮助

退出码: 0 正常；1 删除失败；2 参数错误；3 清理后仍超 --max-gb
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST=${2:?--dest 需要一个目录参数}; shift 2 ;;
    --keep-days) KEEP_DAYS=${2:?--keep-days 需要数字}; shift 2 ;;
    --keep-weeks) KEEP_WEEKS=${2:?--keep-weeks 需要数字}; shift 2 ;;
    --max-gb) MAX_GB=${2:?--max-gb 需要数字}; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$KEEP_DAYS" in ''|*[!0-9]*) echo "--keep-days 要是非负整数" >&2; exit 2 ;; esac
case "$KEEP_WEEKS" in ''|*[!0-9]*) echo "--keep-weeks 要是非负整数" >&2; exit 2 ;; esac

RUNS_DIR="$DEST/runs"
NOW_EPOCH=$(date -u +%s)
DAILY_CUTOFF=$(( NOW_EPOCH - KEEP_DAYS * 86400 ))
WEEKLY_CUTOFF=$(( NOW_EPOCH - (KEEP_DAYS + KEEP_WEEKS * 7) * 86400 ))
FAILED_GRACE=$(( NOW_EPOCH - 86400 ))

if [ ! -d "$RUNS_DIR" ]; then
  mf_log "保留策略: $RUNS_DIR 不存在，没有可清理的备份（全新目录？）"
  exit 0
fi

# 目录名 → epoch。名字不是 <14 位数字 + T> 时间戳的一律不碰（宁可漏删，不可误删）。
run_epoch() {
  local n=$1 d
  case "$n" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) return 1 ;;
  esac
  d="${n:0:4}-${n:4:2}-${n:6:2}T${n:9:2}:${n:11:2}:${n:13:2}Z"
  date -u -d "$d" +%s 2>/dev/null || return 1
}

run_week() {
  local n=$1 d
  d="${n:0:4}-${n:4:2}-${n:6:2}T${n:9:2}:${n:11:2}:${n:13:2}Z"
  date -u -d "$d" +%G-W%V
}

declare -a DELETE_LIST=()
declare -A WEEK_SEEN=()

mf_log "保留策略: 目录=$DEST 最近 ${KEEP_DAYS} 天全留，更早每周 1 份 × ${KEEP_WEEKS} 周"
printf '%-18s %10s %8s %-8s %s\n' "备份" "大小" "年龄天" "动作" "理由"

# 最新在前排序：每周的代表取"这一周里最新的那份"。
while IFS= read -r name; do
  [ -n "$name" ] || continue
  path="$RUNS_DIR/$name"
  [ -d "$path" ] || continue
  [ -L "$path" ] && continue
  size=$(mf_dir_bytes "$path")
  if ! epoch=$(run_epoch "$name"); then
    printf '%-18s %10s %8s %-8s %s\n' "$name" "$(mf_human_bytes "$size")" "-" "跳过" "目录名不是备份时间戳，不属于本脚本管理范围"
    continue
  fi
  age_days=$(( (NOW_EPOCH - epoch) / 86400 ))
  action="保留"
  reason="最近 ${KEEP_DAYS} 天内"
  if [ -f "$path/FAILED" ] && [ "$epoch" -lt "$FAILED_GRACE" ]; then
    action="删除"; reason="有 FAILED 标记（不完整备份），且已超 24 小时"
  elif [ "$epoch" -lt "$DAILY_CUTOFF" ]; then
    wk=$(run_week "$name")
    if [ "$epoch" -lt "$WEEKLY_CUTOFF" ]; then
      action="删除"; reason="超出 ${KEEP_WEEKS} 周保留窗口"
    elif [ -z "${WEEK_SEEN[$wk]:-}" ]; then
      WEEK_SEEN[$wk]=1
      reason="$wk 周保留的 1 份"
    else
      action="删除"; reason="$wk 周已有更新的 1 份"
    fi
  fi
  printf '%-18s %10s %8s %-8s %s\n' "$name" "$(mf_human_bytes "$size")" "$age_days" "$action" "$reason"
  if [ "$action" = "删除" ]; then
    DELETE_LIST+=("$path")
  fi
done < <(ls -1 "$RUNS_DIR" 2>/dev/null | sort -r)

if [ "${#DELETE_LIST[@]}" -eq 0 ]; then
  mf_log "无需清理：所有备份都在保留窗口内"
  exit 0
fi

TOTAL=0
for p in "${DELETE_LIST[@]}"; do
  TOTAL=$(( TOTAL + $(mf_dir_bytes "$p") ))
done

if [ "$DRY_RUN" = 1 ]; then
  mf_log "dry-run: 将删除 ${#DELETE_LIST[@]} 份备份，可释放 $(mf_human_bytes "$TOTAL")；本次没有删任何东西"
  exit 0
fi

if [ "$ASSUME_YES" != 1 ]; then
  if [ -t 0 ]; then
    printf '确认删除以上 %s 份备份（释放 %s）？输入 yes 继续: ' "${#DELETE_LIST[@]}" "$(mf_human_bytes "$TOTAL")"
    read -r answer
    [ "$answer" = "yes" ] || { mf_log "已取消，未删除任何备份"; exit 0; }
  else
    mf_die "非交互环境需要显式 --yes（先看将删清单：加 --dry-run）"
  fi
fi

mf_log "开始删除 ${#DELETE_LIST[@]} 份备份（$(mf_human_bytes "$TOTAL")）"
for p in "${DELETE_LIST[@]}"; do
  case "$p" in
    "$RUNS_DIR"/*) rm -rf -- "$p" || mf_die "删除失败: $p" ;;
    *) mf_die "拒绝删除 runs 目录之外的路径: $p" ;;
  esac
done
mf_log "删除完成，释放 $(mf_human_bytes "$TOTAL")"

# latest 若指向被删的那一份，重指到现存最新一份，避免恢复脚本拿到空目标。
if [ -L "$DEST/latest" ] && [ ! -e "$DEST/latest" ]; then
  newest=$(ls -1 "$RUNS_DIR" 2>/dev/null | sort -r | head -n1)
  if [ -n "$newest" ]; then
    ln -sfn "runs/$newest" "$DEST/latest"
    mf_log "latest 已重指到 $newest"
  fi
fi

if [ -n "$MAX_GB" ]; then
  MAX_BYTES=$(awk -v g="$MAX_GB" 'BEGIN{printf "%d", g*1024*1024*1024}')
  AFTER=$(mf_dir_bytes "$DEST")
  mf_log "清理后备份目录占用: $(mf_human_bytes "$AFTER") / 上限 $(mf_human_bytes "$MAX_BYTES")"
  if [ "$AFTER" -gt "$MAX_BYTES" ]; then
    mf_warn "备份目录仍超上限：基础数据体积变大，需要换独立磁盘或调小 --keep-days/--keep-weeks"
    exit 3
  fi
fi
exit 0
