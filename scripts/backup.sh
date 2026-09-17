#!/usr/bin/env bash
# ==============================================================================
# MetaFusion 备份：PostgreSQL + 对象存储数据卷 + 配置快照
# ==============================================================================
# 一次运行产出一份自包含、可校验、可恢复的备份：
#
#   <dest>/runs/<UTC 时间戳>/
#     db/<库名>-<ts>.sql.gz           目录库（各服务共用实例，auth/community/storage 各 schema 都在里面）
#     db/globals-<ts>.sql.gz          角色定义（pg_dumpall --globals-only；含口令哈希，权限 0600）
#     s3/<卷名>-<ts>.tar.gz           对象存储数据卷快照（资源对象本体）
#     config/config-<ts>.tar.gz       配置快照：.env 键名（不含值）、编排文件、镜像与挂载清单、各仓 HEAD
#     manifest.txt                    人读清单：版本、行数、大小、耗时、git 提交
#     checksums.sha256                各产物 sha256（restore 前校验）
#     backup.log                      本次运行日志
#   <dest>/latest -> runs/<ts>        最近一次成功备份的软链
#
# 为什么 .env 只记键名：明文密钥不进备份产物（备份会落盘、可能被整目录复制走），由运维单独保管；
# 恢复缺哪一项，config/env-keys.txt 会直接指出来。
#
# 设计约束（2026-09-19 运行时审计）：
# - 服务器 / 只有 ~12G 可用，所以先量体积再写：写前检查剩余空间与备份目录上限，写后核对上限；
#   备份与数据同盘，是"误删/坏库/误操作"防线，不是磁盘故障防线（异地副本仍未具备）。
# - 备份不锁库：pg_dump 只取 ACCESS SHARE 锁，不阻塞写入。
# - 对象存储卷是运行中容器的活卷，tar 出来的是近似一致快照（对象写入不可变+原子可见）；
#   大批上传时段请避开，或临时停 rustfs 容器再跑（见 docs-local/deploy/backup-restore.md）。
#
# 用法：scripts/backup.sh --help
# ==============================================================================

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/mf-backup-lib.sh
. "$SCRIPT_DIR/lib/mf-backup-lib.sh"

DEST=${MF_BACKUP_DIR:-$(dirname "$MF_REPO_ROOT")/backups}
KEEP_DAYS=7
KEEP_WEEKS=4
MAX_GB=2
MIN_FREE_GB=3
DO_DB=1
DO_S3=1
DO_CONFIG=1
DO_PRUNE=1
DRY_RUN=0
EXTRA_VOLUMES=()

usage() {
  cat <<'EOF'
MetaFusion 备份（PostgreSQL + 对象存储数据卷 + 配置快照）

用法: scripts/backup.sh [选项]

选项:
  --dest DIR          备份根目录（默认 <仓库父目录>/backups，服务器上即 /root/metafusion/backups）
  --keep-days N       保留最近 N 天每天一份（默认 7）
  --keep-weeks N      更早的备份按周保留 N 份（默认 4）
  --max-gb N          备份根目录容量上限 GiB（默认 2）：写前预估超限即拒绝运行，写后超限退出码 3
  --min-free-gb N     运行前后要求目标文件系统至少保留 N GiB（默认 3）
  --skip-db           跳过 PostgreSQL
  --skip-s3           跳过对象存储卷
  --skip-config       跳过配置快照
  --extra-volume NAME 额外打包的 docker 卷（可重复；如 deploy_storage_data）
  --no-prune          本次不执行保留策略（不删任何旧备份）
  --dry-run           只打印将要做什么，不写任何文件
  -h, --help          显示本帮助

环境变量覆盖（一般不用给）:
  MF_BACKUP_DIR        同 --dest
  MF_ENV_FILE          .env 路径（默认 <仓库>/.env），只读取其中的 DB_USER / DB_NAME
  MF_PG_CONTAINER      目录库容器名（默认 metafusion-postgres）
  MF_RUSTFS_CONTAINER  对象存储容器名（默认 metafusion-rustfs）
  MF_DB_USER/MF_DB_NAME 直接指定库身份，跳过 .env

退出码: 0 成功；1 前置检查/备份失败；2 参数错误；3 备份成功但超出 --max-gb 上限

示例:
  scripts/backup.sh                          # 正常备份 + 按保留策略清理
  scripts/backup.sh --dry-run                # 只看会做什么
  scripts/backup.sh --dest /srv/mf-backups --max-gb 20 --no-prune
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST=${2:?--dest 需要一个目录参数}; shift 2 ;;
    --keep-days) KEEP_DAYS=${2:?--keep-days 需要数字}; shift 2 ;;
    --keep-weeks) KEEP_WEEKS=${2:?--keep-weeks 需要数字}; shift 2 ;;
    --max-gb) MAX_GB=${2:?--max-gb 需要数字}; shift 2 ;;
    --min-free-gb) MIN_FREE_GB=${2:?--min-free-gb 需要数字}; shift 2 ;;
    --skip-db) DO_DB=0; shift ;;
    --skip-s3) DO_S3=0; shift ;;
    --skip-config) DO_CONFIG=0; shift ;;
    --extra-volume) EXTRA_VOLUMES+=("${2:?--extra-volume 需要卷名}"); shift 2 ;;
    --no-prune) DO_PRUNE=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$KEEP_DAYS" in ''|*[!0-9]*) echo "--keep-days 要是非负整数" >&2; exit 2 ;; esac
case "$KEEP_WEEKS" in ''|*[!0-9]*) echo "--keep-weeks 要是非负整数" >&2; exit 2 ;; esac
case "$MAX_GB" in ''|*[!0-9.]*) echo "--max-gb 要是数字" >&2; exit 2 ;; esac
case "$MIN_FREE_GB" in ''|*[!0-9.]*) echo "--min-free-gb 要是数字" >&2; exit 2 ;; esac

RUSTFS_VOLUME=${MF_RUSTFS_VOLUME:-deploy_s3_data}

TS=$(mf_stamp_utc)
RUN_DIR="$DEST/runs/$TS"
START_EPOCH=$(date +%s)

# 失败也要留下痕迹：restore/prune 都以 FAILED 标记判断这一份能不能用。
mark_failed() {
  local msg=$1 rc=${2:-1}
  if [ -n "${RUN_DIR:-}" ] && [ -d "${RUN_DIR:-}" ]; then
    {
      printf 'FAILED %s\n' "$msg"
      printf 'at %s\n' "$(mf_iso_utc)"
    } >"$RUN_DIR/FAILED"
  fi
  mf_log "备份失败: $msg"
  exit "$rc"
}
on_err() {
  local rc=$?
  mark_failed "命令失败（rc=$rc，见 backup.log）" "$rc"
}
trap on_err ERR

# ---- 前置：容器、库身份、卷落点 ------------------------------------------------

preflight() {
  mf_need_cmd docker du df awk sed gzip tar sha256sum stat
  if [ "$DO_DB" = 1 ]; then
    mf_pg_require
  fi
  if [ "$DO_S3" = 1 ]; then
    S3_SRC=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$MF_RUSTFS_CONTAINER" 2>/dev/null || true)
    # 卷名同样从容器实际挂载里解析：编排工程名变了（deploy_ → 其它）也不用改脚本。
    S3_VOL_NAME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$MF_RUSTFS_CONTAINER" 2>/dev/null || true)
    S3_VOL_NAME=${S3_VOL_NAME:-$RUSTFS_VOLUME}
    if [ -z "$S3_SRC" ]; then
      mf_die "拿不到 $MF_RUSTFS_CONTAINER 的 /data 卷落点（容器没起？）"
    fi
    [ -d "$S3_SRC" ] || mf_die "对象存储卷目录不存在: $S3_SRC"
  fi

  local ancestor="$DEST"
  while [ ! -d "$ancestor" ] && [ "$ancestor" != "/" ]; do ancestor=$(dirname "$ancestor"); done
  DEST_ANCESTOR="$ancestor"

  DB_BYTES=0
  if [ "$DO_DB" = 1 ]; then
    DB_BYTES=$(mf_pg_scalar "$MF_DB_NAME" "select pg_database_size(current_database())")
    [ -n "$DB_BYTES" ] || mf_die "读不到库 $MF_DB_NAME 的大小（库不存在或连不上）"
  fi
  S3_BYTES=0
  if [ "$DO_S3" = 1 ]; then
    S3_BYTES=$(mf_dir_bytes "$S3_SRC")
    S3_BYTES=${S3_BYTES:-0}
  fi

  FREE_BYTES=$(mf_free_bytes "$DEST_ANCESTOR")
  FREE_BYTES=${FREE_BYTES:-0}
  # 估算口径：dump 压到库体积的 1/2 已是很保守的上界（实测 36MB 库 → 2.8MB），另留 64MiB 余量。
  REQUIRED_BYTES=$(( DB_BYTES / 2 + S3_BYTES + 64 * 1024 * 1024 ))
  MIN_FREE_BYTES=$(awk -v g="$MIN_FREE_GB" 'BEGIN{printf "%d", g*1024*1024*1024}')
  MAX_BYTES=$(awk -v g="$MAX_GB" 'BEGIN{printf "%d", g*1024*1024*1024}')
  CUR_BYTES=$(mf_dir_bytes "$DEST" || true)
  CUR_BYTES=${CUR_BYTES:-0}

  mf_log "前置检查:"
  mf_log "  备份目录      : $DEST（当前 $(mf_human_bytes "$CUR_BYTES")，上限 $(mf_human_bytes "$MAX_BYTES")）"
  mf_log "  目标文件系统  : $DEST_ANCESTOR 可用 $(mf_human_bytes "$FREE_BYTES")，要求保留 ≥ ${MIN_FREE_GB} GiB"
  mf_log "  预计本次占用  : $(mf_human_bytes "$REQUIRED_BYTES")（库 $(mf_human_bytes "$DB_BYTES") + 对象存储 $(mf_human_bytes "$S3_BYTES") + 余量）"
  if [ "$(( FREE_BYTES - REQUIRED_BYTES ))" -lt "$MIN_FREE_BYTES" ]; then
    mf_die "剩余空间不足：可用 $(mf_human_bytes "$FREE_BYTES")，本次至少需要 $(mf_human_bytes "$REQUIRED_BYTES") 且保留 ${MIN_FREE_GB} GiB（先清磁盘或调 --min-free-gb，别把库盘写满）"
  fi
  if [ "$(( CUR_BYTES + REQUIRED_BYTES ))" -gt "$MAX_BYTES" ]; then
    mf_die "备份目录将超过上限 $(mf_human_bytes "$MAX_BYTES")：当前 $(mf_human_bytes "$CUR_BYTES") + 本次 $(mf_human_bytes "$REQUIRED_BYTES")。先跑 scripts/prune_backups.sh --dry-run 看能清多少，或调 --max-gb"
  fi
}

# ---- 各产物 -------------------------------------------------------------------

backup_db() {
  local base="$MF_DB_NAME-$TS.sql.gz" tmp
  tmp="$RUN_DIR/db/.$base.tmp"
  mf_log "① PostgreSQL: 库 $MF_DB_NAME（$MF_DB_USER@$MF_PG_CONTAINER）"
  docker exec "$MF_PG_CONTAINER" pg_dump -U "$MF_DB_USER" -d "$MF_DB_NAME" | gzip -9 >"$tmp"
  mv "$tmp" "$RUN_DIR/db/$base"
  DB_DUMP_FILE="db/$base"
  DB_DUMP_BYTES=$(stat -c %s "$RUN_DIR/$DB_DUMP_FILE")
  mf_log "   → $DB_DUMP_FILE $(mf_human_bytes "$DB_DUMP_BYTES")"

  local gfile="globals-$TS.sql.gz" gtmp="$RUN_DIR/db/.globals-$TS.sql.gz.tmp"
  docker exec "$MF_PG_CONTAINER" pg_dumpall -U "$MF_DB_USER" --globals-only | gzip -9 >"$gtmp"
  mv "$gtmp" "$RUN_DIR/db/$gfile"
  chmod 600 "$RUN_DIR/db/$gfile"
  GLOBALS_FILE="db/$gfile"
  GLOBALS_BYTES=$(stat -c %s "$RUN_DIR/$GLOBALS_FILE")
  mf_log "   → $GLOBALS_FILE $(mf_human_bytes "$GLOBALS_BYTES")（角色定义，含口令哈希，权限 0600）"
}

tar_volume() {  # $1=卷名 $2=卷落点 $3=产物相对路径
  local name=$1 src=$2 rel=$3 tmp
  tmp="$RUN_DIR/$rel.tmp"
  mf_log "   → 卷 $name $(mf_human_bytes "$(mf_dir_bytes "$src")") → $rel"
  tar -C "$src" -czf "$tmp" .
  mv "$tmp" "$RUN_DIR/$rel"
}

backup_s3() {
  local vol=${S3_VOL_NAME:-$RUSTFS_VOLUME}
  mf_log "② 对象存储: 卷 $vol（$S3_SRC）"
  tar_volume "$vol" "$S3_SRC" "s3/$vol-$TS.tar.gz"
  S3_FILE="s3/$vol-$TS.tar.gz"
  S3_FILE_BYTES=$(stat -c %s "$RUN_DIR/$S3_FILE")
  mf_log "   → $S3_FILE $(mf_human_bytes "$S3_FILE_BYTES")"

  local v src
  for v in "${EXTRA_VOLUMES[@]}"; do
    src="/var/lib/docker/volumes/$v/_data"
    [ -d "$src" ] || mf_die "额外卷 $v 的落点不存在: $src"
    tar_volume "$v" "$src" "s3/volume-$v-$TS.tar.gz"
  done
}

backup_config() {
  local stage="$RUN_DIR/.config-staging"
  mf_log "③ 配置快照（不含 .env 值）"
  mkdir -p "$stage"
  {
    echo "MetaFusion 配置快照"
    echo "run:     $TS"
    echo "created: $(mf_iso_utc)"
    echo "repo:    $MF_REPO_ROOT"
    echo
    echo "包含：.env 的键名清单（不含值）、编排与网关配置、版本锁、镜像/挂载/卷清单、各仓库 git 提交、"
    echo "      目录库版本与统计、磁盘与 docker 占用、systemd 单元（若已安装）。"
    echo "不含：任何明文口令/私钥。.env 本体由运维单独保管，恢复时按 env-keys.txt 补齐。"
  } >"$stage/README.txt"

  if [ -f "$MF_ENV_FILE" ]; then
    {
      echo "# .env 键名清单（只列键名与是否已设置，值一律不落快照）"
      echo "# 文件: $MF_ENV_FILE"
      echo "# 大小: $(stat -c %s "$MF_ENV_FILE") 字节  修改时间: $(stat -c %y "$MF_ENV_FILE")"
      echo "# 恢复时本文件不能替代 .env：运维需从密码库另取真值。"
      echo
      sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$MF_ENV_FILE" | while read -r k; do
        v=$(mf_env_value "$k")
        if [ -n "$v" ]; then echo "$k=<已设置>"; else echo "$k=<空>"; fi
      done
    } >"$stage/env-keys.txt"
  else
    echo "未找到 $MF_ENV_FILE" >"$stage/env-keys.txt"
  fi

  {
    echo "# 本机 metafusion-* 容器（名称|镜像|状态）"
    docker ps -a --filter "name=metafusion-" --format '{{.Names}}|{{.Image}}|{{.Status}}' | sort
    echo
    echo "# 相关镜像与 ID"
    docker images --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.Size}}' | grep -Ei 'metafusion|^deploy-|rustfs|^postgres|^redis|^nginx|opensearch' | sort || true
  } >"$stage/containers.txt" 2>&1

  {
    for c in "$MF_PG_CONTAINER" "$MF_RUSTFS_CONTAINER"; do
      echo "# $c"
      docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}}{{.Source}} -> {{.Destination}}{{println}}{{end}}' "$c" 2>/dev/null
      echo
    done
  } >"$stage/mounts.txt" 2>&1

  {
    echo "# 各仓库提交（恢复代码基线用）"
    for d in "$MF_REPO_ROOT" "$(dirname "$MF_REPO_ROOT")"/metafusion-*; do
      [ -d "$d/.git" ] || continue
      printf '%-52s %s %s\n' "$d" "$(git -C "$d" rev-parse --short HEAD)" "$(git -C "$d" rev-parse --abbrev-ref HEAD)"
    done
  } >"$stage/repos.txt" 2>&1

  {
    echo "# PostgreSQL 服务端版本"
    docker exec "$MF_PG_CONTAINER" postgres --version
    echo
    echo "# 数据库与体积"
    docker exec "$MF_PG_CONTAINER" psql -U "$MF_DB_USER" -d postgres -Atc "select datname||' '||pg_size_pretty(pg_database_size(datname)) from pg_database order by 1"
    echo
    echo "# schema"
    docker exec "$MF_PG_CONTAINER" psql -U "$MF_DB_USER" -d "$MF_DB_NAME" -Atc "select schema_name from information_schema.schemata where schema_name not in ('pg_catalog','information_schema','pg_toast') order by 1"
  } >"$stage/pg.txt" 2>&1

  {
    echo "# df"
    df -h
    echo
    echo "# docker system df"
    docker system df
  } >"$stage/disk.txt" 2>&1

  mkdir -p "$stage/deploy" "$stage/systemd"
  local f
  for f in docker-compose.yml docker-compose.prod.yml docker-compose.dev.yml nginx.conf versions.lock; do
    if [ -f "$MF_REPO_ROOT/deploy/$f" ]; then cp -p "$MF_REPO_ROOT/deploy/$f" "$stage/deploy/"; fi
  done
  for f in /etc/systemd/system/metafusion-*.service /etc/systemd/system/metafusion-*.timer; do
    if [ -f "$f" ]; then cp -p "$f" "$stage/systemd/" 2>/dev/null || true; fi
  done

  tar -czf "$RUN_DIR/config/config-$TS.tar.gz" -C "$stage" .
  rm -rf "$stage"
  CONFIG_FILE="config/config-$TS.tar.gz"
  CONFIG_BYTES=$(stat -c %s "$RUN_DIR/$CONFIG_FILE")
  mf_log "   → $CONFIG_FILE $(mf_human_bytes "$CONFIG_BYTES")"
}
# ---- 清单 / 校验和 / 收尾 ------------------------------------------------------

write_manifest() {
  local elapsed=$(( $(date +%s) - START_EPOCH ))
  {
    echo "MetaFusion 备份清单 (manifest v1)"
    echo "run:              $TS"
    echo "created_utc:      $(mf_iso_utc)"
    echo "host:             $(hostname)"
    echo "repo:             $MF_REPO_ROOT $(git -C "$MF_REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo -)"
    echo "dest:             $DEST"
    echo "db:               $MF_DB_NAME (user=$MF_DB_USER, server=$(docker exec "$MF_PG_CONTAINER" postgres --version 2>/dev/null | awk '{print $3}'), size=$(mf_human_bytes "$DB_BYTES"))"
    if [ "$DO_S3" = 1 ]; then
      echo "s3_volume:        ${S3_VOL_NAME:-$RUSTFS_VOLUME} ($S3_SRC, $(mf_human_bytes "$S3_BYTES"))"
    fi
    echo "elapsed_seconds:  $elapsed"
    echo
    echo "artifacts:"
    for rel in "${DB_DUMP_FILE:-}" "${GLOBALS_FILE:-}" "${S3_FILE:-}" "${CONFIG_FILE:-}"; do
      if [ -n "$rel" ]; then
        printf '  %-56s %10s  %s\n' "$rel" "$(stat -c %s "$RUN_DIR/$rel")" "$(mf_human_bytes "$(stat -c %s "$RUN_DIR/$rel")")"
      fi
    done
    echo
    echo "row_counts:"
    if [ "$DO_DB" = 1 ]; then
      mf_pg_psql "$MF_DB_NAME" "select format('  %-28s %s', 'catalog.entities', (select count(*) from catalog.entities)) union all select format('  %-28s %s', 'catalog.relations', (select count(*) from catalog.relations)) union all select format('  %-28s %s', 'auth.users', (select count(*) from auth.users)) union all select format('  %-28s %s', 'community.boards', (select count(*) from community.boards)) union all select format('  %-28s %s', 'storage.assets', (select count(*) from storage.assets))" || echo "  （行数读取失败：见 backup.log，不影响产物完整性）"
    fi
    echo
    echo "repos:"
    for d in "$MF_REPO_ROOT" "$(dirname "$MF_REPO_ROOT")"/metafusion-*; do
      if [ -d "$d/.git" ]; then
        printf '  %-52s %s\n' "$d" "$(git -C "$d" rev-parse --short HEAD 2>/dev/null || echo -)"
      fi
    done
    echo
    echo "restore:"
    echo "  scripts/restore.sh --list                                # 看有哪些备份"
    echo "  scripts/restore.sh --run $TS --db <目标库> --create     # 恢复到空库（演练用）"
    echo "  scripts/restore.sh --latest --db <目标库> --force          # 覆盖非空库（会先自动备份目标库）"
  } >"$RUN_DIR/manifest.txt"
}

write_checksums() {
  (
    cd "$RUN_DIR"
    # 只对产物做校验和：manifest/日志会随后续步骤变化，纳入会让校验永远不通过。
    find db s3 config -type f ! -name '*.tmp' -print0 | sort -z | xargs -0 sha256sum >checksums.sha256
  )
  mf_log "   → checksums.sha256（$(wc -l <"$RUN_DIR/checksums.sha256") 项）"
}

finish() {
  local elapsed=$(( $(date +%s) - START_EPOCH ))
  local total
  total=$(du -sh "$RUN_DIR" 2>/dev/null | cut -f1)
  mf_log "备份完成: $RUN_DIR（$total，耗时 ${elapsed}s）"
  printf '%s %s run=%s db=%s dump_bytes=%s run_bytes=%s elapsed=%ss status=ok\n' \
    "$(mf_iso_utc)" "$(hostname)" "$TS" "$MF_DB_NAME" \
    "${DB_DUMP_BYTES:-0}" "$(mf_dir_bytes "$RUN_DIR")" "$elapsed" >>"$DEST/backup-history.log"
  ln -sfn "runs/$TS" "$DEST/latest"
}

# ---- 主流程 -------------------------------------------------------------------

# 库身份只能在这里解：lib 里的 MF_DB_USER/MF_DB_NAME 默认是空的，不到 .env 取一次，
# pg_dump/psql 就会拿到空用户名与空库名（第一次跑就是这么暴露出来的）。
mf_resolve_db_identity
preflight

if [ "$DRY_RUN" = 1 ]; then
  mf_log "dry-run: 只做前置检查与计划打印，不写文件"
  if [ "$DO_DB" = 1 ]; then mf_log "  - pg_dump $MF_DB_NAME → $RUN_DIR/db/$MF_DB_NAME-$TS.sql.gz"; fi
  if [ "$DO_S3" = 1 ]; then mf_log "  - tar $S3_SRC → $RUN_DIR/s3/${S3_VOL_NAME:-$RUSTFS_VOLUME}-$TS.tar.gz"; fi
  if [ "$DO_CONFIG" = 1 ]; then mf_log "  - 配置快照 → $RUN_DIR/config/config-$TS.tar.gz"; fi
  mf_log "  - 写 manifest.txt / checksums.sha256、更新 latest"
  if [ "$DO_PRUNE" = 1 ]; then
    "$SCRIPT_DIR/prune_backups.sh" --dest "$DEST" --keep-days "$KEEP_DAYS" --keep-weeks "$KEEP_WEEKS" --dry-run || true
  fi
  mf_log "dry-run 结束：没有写任何文件"
  exit 0
fi

mkdir -p "$RUN_DIR/db" "$RUN_DIR/s3" "$RUN_DIR/config"
chmod 700 "$DEST" "$DEST/runs" "$RUN_DIR" 2>/dev/null || true
LOG_FILE="$RUN_DIR/backup.log"
MF_LOG_FILE="$LOG_FILE"
: >"$LOG_FILE"

mf_log "开始备份: run=$TS host=$(hostname) repo=$MF_REPO_ROOT"

if [ "$DO_DB" = 1 ]; then backup_db; fi
if [ "$DO_S3" = 1 ]; then backup_s3; fi
if [ "$DO_CONFIG" = 1 ]; then backup_config; fi

write_manifest
write_checksums
finish

if [ "$DO_PRUNE" = 1 ]; then
  mf_log "保留策略: 最近 $KEEP_DAYS 天全留 + 更早每周 1 份共 $KEEP_WEEKS 周"
  "$SCRIPT_DIR/prune_backups.sh" --dest "$DEST" --keep-days "$KEEP_DAYS" --keep-weeks "$KEEP_WEEKS" --yes || \
    mf_warn "保留策略执行有告警（见上），备份本身是完整的"
else
  mf_log "保留策略: 本次跳过（--no-prune）"
fi

AFTER_BYTES=$(mf_dir_bytes "$DEST")
mf_log "备份目录当前占用: $(mf_human_bytes "$AFTER_BYTES") / 上限 $(mf_human_bytes "$MAX_BYTES")"
if [ "$AFTER_BYTES" -gt "$MAX_BYTES" ]; then
  mf_warn "备份目录已超上限：清理旧备份（scripts/prune_backups.sh --yes）或调 --max-gb；本次备份本身完整可用"
  exit 3
fi
exit 0
