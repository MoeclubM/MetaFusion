#!/usr/bin/env bash
# ==============================================================================
# MetaFusion 恢复演练：把最近一份备份恢复到 scratch 库，比对行数后删掉 scratch
# ==============================================================================
# 为什么要有这个脚本：备份"存在"不等于备份"能还原"。这个演练跑完整条链路——
# 选备份 → 校验 sha256 → 建 scratch 库 → 恢复 → 与线上库比对关键表行数 → 删 scratch，
# 全程只碰 <scratch> 这一个新库，生产库只被 SELECT count(*) 读。
# 建议每月跑一次（也可挂 systemd timer），把输出留档。
#
# 用法：scripts/restore_drill.sh --help
# ==============================================================================

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/mf-backup-lib.sh
. "$SCRIPT_DIR/lib/mf-backup-lib.sh"

DEST=${MF_BACKUP_DIR:-$(dirname "$MF_REPO_ROOT")/backups}
RUN_SPEC=""
SCRATCH="metafusion_restore_check"
TABLES="catalog.entities,catalog.relations"
KEEP=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
MetaFusion 恢复演练（恢复最新备份到 scratch 库 → 比对行数 → 删除 scratch）

用法: scripts/restore_drill.sh [选项]

选项:
  --dest DIR       备份根目录（默认 <仓库父目录>/backups）
  --run <ts|路径>  指定备份（默认 <dest>/latest，没有就用最新一份）
  --scratch NAME   scratch 库名（默认 metafusion_restore_check；不得等于生产库名）
  --tables "a.b,c.d" 要比对行数的表（默认 catalog.entities,catalog.relations）
  --keep           演练后保留 scratch 库（排查用；否则删除）
  --yes            非交互确认（定时演练用；默认需要终端确认）
  -h, --help       显示本帮助

退出码: 0 演练通过；1 演练失败（恢复/比对）；2 参数错误；3 被安全检查拒绝
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST=${2:?--dest 需要一个目录参数}; shift 2 ;;
    --run) RUN_SPEC=${2:?--run 需要时间戳或路径}; shift 2 ;;
    --scratch) SCRATCH=${2:?--scratch 需要库名}; shift 2 ;;
    --tables) TABLES=${2:?--tables 需要表名列表}; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

refuse() { mf_log "拒绝: $*"; exit 3; }

mf_need_cmd docker gunzip sha256sum tar find
mf_pg_require
mf_resolve_db_identity
PROD_DB="$MF_DB_NAME"
if [ "$SCRATCH" = "$PROD_DB" ]; then
  refuse "scratch 库名不能等于生产库名 $PROD_DB（演练只允许写新库）"
fi
mf_require_ident "$SCRATCH"

if [ "$ASSUME_YES" != 1 ] && [ -t 0 ]; then
  printf '将把备份恢复到 scratch 库 %s（该库若已存在会先删掉重建），然后删掉它。输入 yes 继续: ' "$SCRATCH"
  read -r answer
  if [ "$answer" != "yes" ]; then mf_log "已取消"; exit 0; fi
fi

START=$(date +%s)
mf_log "=== 恢复演练开始 $(mf_iso_utc) ==="
mf_log "scratch 库=$SCRATCH 生产库=$PROD_DB 比对表=$TABLES"

# ---- 1. 恢复到 scratch 库（选备份/校验 sha256/安全检查都复用 restore.sh） -------

restore_args=(--dest "$DEST" --db "$SCRATCH" --create --force --yes --no-pre-dump --counts "$TABLES")
if [ -n "$RUN_SPEC" ]; then restore_args+=(--run "$RUN_SPEC"); fi

mf_log "步骤 1/4: 恢复备份到 scratch 库"
if ! "$SCRIPT_DIR/restore.sh" "${restore_args[@]}"; then
  mf_warn "恢复失败（scratch 库名 $SCRATCH；排查后可手工 DROP DATABASE）"
  exit 1
fi

# ---- 2. 行数比对 ---------------------------------------------------------------

mf_log "步骤 2/4: 比对行数（生产库 $PROD_DB vs scratch 库 $SCRATCH）"
printf '%-28s %10s %10s %s\n' "表" "生产库" "scratch" "结果"
FAILED=0
for t in ${TABLES//,/ }; do
  mf_require_table_ref "$t"
  live=$(mf_pg_scalar "$PROD_DB" "select count(*) from $t")
  copy=$(mf_pg_scalar "$SCRATCH" "select count(*) from $t")
  verdict="一致"
  if [ -z "$live" ] || [ -z "$copy" ] || [ "$live" != "$copy" ]; then
    verdict="不一致"
    FAILED=1
  fi
  printf '%-28s %10s %10s %s\n' "$t" "${live:--}" "${copy:--}" "$verdict"
done

# ---- 3. 清理 scratch（演练产物不该留在服务器上） -------------------------------

if [ "$KEEP" = 1 ]; then
  mf_log "步骤 3/4: 保留 scratch 库 $SCRATCH（--keep）"
else
  mf_log "步骤 3/4: 删除 scratch 库 $SCRATCH"
  mf_pg_admin_psql "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null
  if mf_pg_db_exists "$SCRATCH"; then
    mf_warn "scratch 库 $SCRATCH 仍然存在，请手工处理"
    FAILED=1
  fi
fi

# ---- 4. 结论 -------------------------------------------------------------------

ELAPSED=$(( $(date +%s) - START ))
if [ "$FAILED" = 0 ]; then
  mf_log "步骤 4/4: 演练通过——最近一份备份可完整还原（耗时 ${ELAPSED}s）"
  exit 0
fi
mf_log "步骤 4/4: 演练失败——见上面的差异（耗时 ${ELAPSED}s）"
exit 1