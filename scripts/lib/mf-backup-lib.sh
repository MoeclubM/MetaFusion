#!/usr/bin/env bash
# MetaFusion 备份 / 恢复脚本共用函数。
#
# 被 scripts/backup.sh、scripts/restore.sh、scripts/prune_backups.sh、scripts/restore_drill.sh
# source；单独执行没有意义，因此不带 --help。
#
# 约定：连接对象一律通过 MF_PG_CONTAINER / MF_RUSTFS_CONTAINER / MF_DB_USER / MF_DB_NAME /
# MF_ENV_FILE 覆盖；脚本不写死主机名与凭据。

set -euo pipefail

MF_LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MF_SCRIPTS_DIR=$(cd "$MF_LIB_DIR/.." && pwd)
MF_REPO_ROOT=$(cd "$MF_SCRIPTS_DIR/.." && pwd)

MF_ENV_FILE=${MF_ENV_FILE:-$MF_REPO_ROOT/.env}
MF_PG_CONTAINER=${MF_PG_CONTAINER:-metafusion-postgres}
MF_RUSTFS_CONTAINER=${MF_RUSTFS_CONTAINER:-metafusion-rustfs}
MF_DB_USER=${MF_DB_USER:-}
MF_DB_NAME=${MF_DB_NAME:-}
MF_LOG_FILE=${MF_LOG_FILE:-}

mf_iso_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }
mf_stamp_utc() { date -u +%Y%m%dT%H%M%SZ; }

# 日志同时进 stdout 与 MF_LOG_FILE（备份时指向本次 run 目录；systemd 侧另有 journal）。
mf_log() {
  local line
  line="$(mf_iso_utc) $*"
  printf '%s\n' "$line"
  if [ -n "$MF_LOG_FILE" ]; then
    printf '%s\n' "$line" >>"$MF_LOG_FILE" || true
  fi
}
mf_warn() { mf_log "警告: $*"; }
mf_die() { mf_log "错误: $*"; exit 1; }

mf_need_cmd() {
  local c
  for c in $*; do
    command -v "$c" >/dev/null 2>&1 || mf_die "缺少命令: $c"
  done
}

mf_human_bytes() {
  awk -v b="${1:-0}" 'BEGIN{
    split("B KiB MiB GiB TiB", u, " "); i = 1
    while (b >= 1024 && i < 5) { b /= 1024; i++ }
    printf (i == 1 ? "%d %s" : "%.1f %s"), b, u[i]
  }'
}

mf_dir_bytes() { du -sb "${1:-.}" 2>/dev/null | cut -f1; }
mf_free_bytes() { df -Pk "$1" 2>/dev/null | awk 'NR==2{print $4 * 1024}'; }

# .env 读取只取需要的键值，不 source 整份文件（不执行 .env 内容、不把全部密钥读进环境）。
mf_env_value() {
  local key=$1 file=${MF_ENV_FILE:-$MF_REPO_ROOT/.env}
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" "$file" | head -n1 | tr -d '"' | sed -e "s/^'//" -e "s/'\$//"
}

# 未显式给 DB_USER / DB_NAME 时按 .env 兜底，再退回编排默认值。
mf_resolve_db_identity() {
  if [ -z "$MF_DB_USER" ]; then
    MF_DB_USER=$(mf_env_value DB_USER)
    MF_DB_USER=${MF_DB_USER:-metafusion}
  fi
  if [ -z "$MF_DB_NAME" ]; then
    MF_DB_NAME=$(mf_env_value DB_NAME)
    MF_DB_NAME=${MF_DB_NAME:-metafusion_db}
  fi
}

mf_pg_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$MF_PG_CONTAINER" 2>/dev/null || echo false)" = "true" ]
}

mf_pg_require() {
  command -v docker >/dev/null 2>&1 || mf_die "缺少命令: docker"
  mf_pg_running || mf_die "容器 $MF_PG_CONTAINER 未运行（这台机器上没有在跑的目录库实例？）"
}

# 只做标识符白名单校验：库名/表名要拼进 SQL，拼之前先挡住注入与手滑。
mf_require_ident() {
  case "$1" in
    '') mf_die "标识符为空" ;;
    *[!A-Za-z0-9_]*) mf_die "标识符含非法字符（只允许字母数字下划线）: $1" ;;
  esac
}

mf_require_table_ref() {
  case "$1" in
    *.*) ;;
    *) mf_die "表名要写成 schema.table 形式: $1" ;;
  esac
  mf_require_ident "${1%%.*}"
  mf_require_ident "${1#*.}"
}

mf_pg_psql() {  # $1=库名 $2=SQL；-tA 单值输出
  docker exec "$MF_PG_CONTAINER" psql -U "$MF_DB_USER" -d "$1" -Atc "$2" 2>/dev/null
}

mf_pg_admin_psql() {  # 连 postgres 维护库：建库/删库只能从这里发
  docker exec "$MF_PG_CONTAINER" psql -U "$MF_DB_USER" -d postgres -Atc "$1"
}

mf_pg_db_exists() {
  mf_require_ident "$1"
  [ "$(mf_pg_admin_psql "select 1 from pg_database where datname = '$1'")" = "1" ]
}

# "非空"的口径：除系统 schema 外还有任何基表。空库可直接恢复；非空库必须先备份再重建。
mf_pg_table_count() {
  mf_require_ident "$1"
  local n
  n=$(docker exec "$MF_PG_CONTAINER" psql -U "$MF_DB_USER" -d "$1" -Atc \
    "select count(*) from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog','information_schema')" 2>/dev/null || echo 0)
  printf '%s' "${n:-0}"
}

mf_pg_scalar() {  # $1=库名 $2=SQL（单值）；查不到返回空串，不因 set -e 中断
  mf_pg_psql "$1" "$2" || true
}

mf_sha256_of() { sha256sum "$1" | awk '{print $1}'; }
