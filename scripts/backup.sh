#!/usr/bin/env bash
# ==============================================================================
# MetaFusion 备份：PostgreSQL + 对象存储（S3 API 逐对象）+ 配置快照
# ==============================================================================
# 一次运行产出一份自包含、可校验、可恢复的备份：
#
#   <dest>/runs/<UTC 时间戳>/
#     db/<库名>-<ts>.sql.gz           目录库（各服务共用实例，auth/community/storage 各 schema 都在里面）
#     db/globals-<ts>.sql.gz          角色定义（pg_dumpall --globals-only；含口令哈希，权限 0600）
#     s3/objects/<桶>/<键>            对象本体，逐对象原样落盘（目录结构 = 桶内键路径）
#     s3/objects-inventory-<ts>.tsv   对象清单：桶、键、字节数、sha256、ETag、LastModified（制表符分隔）
#     s3/objects-summary-<ts>.txt     人读摘要：几个桶、共几个对象、共多少字节；空桶逐条记 0
#     s3/buckets-<ts>.txt             桶清单（空桶也在里面，否则"0 个对象"事后无从复核）
#     s3/<卷名>-<ts>.tar.gz           仅 --s3-mode volume-tar 或 --with-volume-tar 时才有（老口径）
#     config/config-<ts>.tar.gz       配置快照：.env 键名（不含值）、编排文件、镜像与挂载清单、各仓 HEAD
#     manifest.txt                    人读清单：版本、对象/行数、大小、耗时、git 提交
#     checksums.sha256                各产物 sha256（restore 前校验）
#     backup.log                      本次运行日志
#   <dest>/latest -> runs/<ts>        最近一次成功备份的软链
#
# 为什么 .env 只记键名：明文密钥不进备份产物（备份会落盘、可能被整目录复制走），由运维单独保管；
# 恢复缺哪一项，config/env-keys.txt 会直接指出来。对象存储凭据只在运行时进 600 临时配置文件。
#
# 为什么对象存储不走 tar 卷（2026-09 教训）：
#   卷里放的是 RustFS 自己的内部结构（.rustfs.sys 子树）。线上两个桶各 0 个对象时，卷里 25 个
#   文件全是元数据，tar 出来"非空"，旧口径只报 tar 体积，于是**空桶被当成了备份成功**；
#   而 storage.assets 里 108 条记录对应的对象字节早已不在（7 张封面永久丢失）。
#   逐对象列举 + 下载 + 每对象 sha256 才能回答"备份了几个对象、共多少字节"，空桶也显式记 0。
#
# 设计约束（2026-09-19 运行时审计）：
# - 服务器 / 只有 ~12G 可用，所以先量体积再写：写前检查剩余空间与备份目录上限，写后核对上限；
#   对象按原样落盘（不压缩），"预计占用"直接取对象总字节——超上限就得换盘或调 --max-gb。
#   备份与数据同盘，是"误删/坏库/误操作"防线，不是磁盘故障防线。
# - 先清后估：主流程先按保留策略清过期备份，再估算本次空间（否则累积到上限后
#   每日备份先因超限失败，永远到不了成功后的清理阶段）；清理时保护最后可恢复副本。
# - 异地副本（仍未具备）：每次成功后把 <dest>/runs/<ts> 同步到远端
#   （例：rsync -a <dest>/runs/<ts>/ user@remote:/srv/mf-backups/runs/<ts>/），
#   远端保留策略与本地独立（不同步删除），同步失败即告警。没有可用远端之前，
#   本地版本先落地、不擅自配置外部存储。
# - RPO/RTO：当前每日 04:30 UTC 一次（timer），灾难 RPO ≈ 24h；业务候选目标
#   （元数据 RPO 1h / RTO 4h）尚未实测验收——不要把“每日备份”说成小时级 RPO。
# - 备份不锁库：pg_dump 只取 ACCESS SHARE 锁，不阻塞写入。
# - 对象侧是逐个 GET 的活快照：对象写入不可变且原子可见，所以每个对象要么完整下到、要么还没出现；
#   大批上传时段仍建议避开（见 docs-local/deploy/backup-restore.md）。
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
# 默认上限 10GiB（审计 O06）：单个对象即可超过 2GiB，旧默认连一份正常备份都装不下；
# 仍是硬上限（超限即拒绝/退出码 3），不是“无穷大”。真实容量按 --dry-run 的对象
# 总字节预算，服务器上以 systemd 单元的显式传值为准（独立磁盘仍是必选项，见下）。
MAX_GB=10
MIN_FREE_GB=3
S3_MODE=objects
WITH_VOLUME_TAR=0
DO_DB=1
DO_S3=1
DO_CONFIG=1
DO_PRUNE=1
DRY_RUN=0
EXTRA_VOLUMES=()

usage() {
  cat <<'EOF'
MetaFusion 备份（PostgreSQL + 对象存储（S3 API 逐对象）+ 配置快照）

用法: scripts/backup.sh [选项]

选项:
  --dest DIR          备份根目录（默认 <仓库父目录>/backups，服务器上即 /root/metafusion/backups）
  --keep-days N       保留最近 N 天每天一份（默认 7）
  --keep-weeks N      更早的备份按周保留 N 份（默认 4）
  --max-gb N          备份根目录容量上限 GiB（默认 10）：写前预估超限即拒绝运行，写后超限退出码 3
  --min-free-gb N     运行前后要求目标文件系统至少保留 N GiB（默认 3）
  --skip-db           跳过 PostgreSQL
  --skip-s3           跳过对象存储（等值于 --s3-mode none）
  --s3-mode MODE      对象存储口径：
                        objects     默认。用 S3 API 列举并逐对象下载，产物含对象清单 + 每对象 sha256
                        volume-tar  老口径：只 tar 数据卷（桶空时产物里没有任何对象字节）
                        none        不备份对象存储
  --with-volume-tar   在 objects 之外**另外**打包一次数据卷（留 RustFS 内部元数据/配置；费空间）
  --s3-endpoint URL   对象存储端点（默认取 rustfs 容器在当前 docker 网络上的 IP:9000）
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
  MF_S3_ENDPOINT       对象存储端点（同 --s3-endpoint；默认按容器 IP 解析）
  MF_S3_ACCESS_KEY / MF_S3_SECRET_KEY  对象存储凭据（默认取 .env 的 RUSTFS_ROOT_USER /
                       RUSTFS_ROOT_PASSWORD，与编排同一份来源）
  MF_S3_REGION / MF_S3_PORT            默认 us-east-1 / 9000
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
    --skip-s3) S3_MODE=none; shift ;;
    --s3-mode) S3_MODE=${2:?--s3-mode 需要 objects|volume-tar|none}; shift 2 ;;
    --with-volume-tar) WITH_VOLUME_TAR=1; shift ;;
    --s3-endpoint) MF_S3_ENDPOINT=${2:?--s3-endpoint 需要 URL}; shift 2 ;;
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
case "$S3_MODE" in
  objects|volume-tar) ;;
  none) DO_S3=0 ;;
  *) echo "--s3-mode 只能是 objects|volume-tar|none（给了: $S3_MODE）" >&2; exit 2 ;;
esac

RUSTFS_VOLUME=${MF_RUSTFS_VOLUME:-deploy_s3_data}

TS=$(mf_stamp_utc)
RUN_DIR="$DEST/runs/$TS"
START_EPOCH=$(date +%s)

# 失败也要留下痕迹：restore/prune 都以 FAILED 标记判断这一份能不能用。
mark_failed() {
  local msg=$1 rc=${2:-1}
  mf_s3_cleanup 2>/dev/null || true
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

# ---- 前置：容器、库身份、卷落点 / S3 端点 ---------------------------------------

# 卷名与落点都从容器实际挂载里解析：编排工程名变了（deploy_ → 其它）也不用改脚本。
resolve_s3_volume() {
  S3_SRC=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$MF_RUSTFS_CONTAINER" 2>/dev/null || true)
  S3_VOL_NAME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$MF_RUSTFS_CONTAINER" 2>/dev/null || true)
  S3_VOL_NAME=${S3_VOL_NAME:-$RUSTFS_VOLUME}
  if [ -z "$S3_SRC" ]; then
    mf_die "拿不到 $MF_RUSTFS_CONTAINER 的 /data 卷落点（容器没起？）"
  fi
  [ -d "$S3_SRC" ] || mf_die "对象存储卷目录不存在: $S3_SRC"
}

preflight() {
  mf_need_cmd docker du df awk sed gzip tar sha256sum stat
  if [ "$DO_DB" = 1 ]; then
    mf_pg_require
  fi
  S3_OBJECTS=0
  S3_OBJECT_BYTES=0
  S3_EMPTY=0
  if [ "$DO_S3" = 1 ]; then
    if [ "$S3_MODE" = volume-tar ]; then
      resolve_s3_volume
    else
      # 逐对象口径：先对端点做一次全量列举（只列举不下载），拿到真实对象数与字节数，
      # 顺便证明"端点可达、凭据可用"——失败就在这里停，不写任何东西。
      local s3pre
      s3pre=$(mktemp -d)
      mf_s3_init "$s3pre"
      mf_s3_totals >"$s3pre/totals.txt"
      while IFS=$'\t' read -r b n by; do
        [ -n "${b:-}" ] || continue
        mf_log "  对象桶        : $b —— $n 个对象，$(mf_human_bytes "$by")"
        S3_OBJECTS=$(( S3_OBJECTS + n ))
        S3_OBJECT_BYTES=$(( S3_OBJECT_BYTES + by ))
      done <"$s3pre/totals.txt"
      mf_s3_cleanup
      rm -rf "$s3pre"
    fi
  fi
  if [ "$WITH_VOLUME_TAR" = 1 ] && [ -z "${S3_SRC:-}" ]; then
    resolve_s3_volume
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
    if [ "$S3_MODE" = volume-tar ]; then
      S3_BYTES=$(mf_dir_bytes "$S3_SRC")
      S3_BYTES=${S3_BYTES:-0}
    else
      # objects 模式：对象按原样落盘，不压缩，所以"对象总字节"就是本次要占的空间。
      S3_BYTES=$S3_OBJECT_BYTES
    fi
  fi
  if [ "$WITH_VOLUME_TAR" = 1 ]; then
    S3_BYTES=$(( S3_BYTES + $(mf_dir_bytes "$S3_SRC" || echo 0) ))
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
  local vol v src
  if [ "$S3_MODE" = objects ]; then
    backup_s3_objects
    if [ "$WITH_VOLUME_TAR" = 1 ]; then
      vol=${S3_VOL_NAME:-${RUSTFS_VOLUME}}
      mf_log "   额外：数据卷 tar（--with-volume-tar：留 RustFS 内部元数据/配置）"
      tar_volume "$vol" "$S3_SRC" "s3/volume-$vol-$TS.tar.gz"
    fi
  else
    vol=${S3_VOL_NAME:-${RUSTFS_VOLUME}}
    mf_log "② 对象存储: 卷 $vol（$S3_SRC）——volume-tar 口径"
    tar_volume "$vol" "$S3_SRC" "s3/$vol-$TS.tar.gz"
    S3_FILE="s3/$vol-$TS.tar.gz"
    S3_FILE_BYTES=$(stat -c %s "${RUN_DIR}/${S3_FILE}")
    mf_log "   → ${S3_FILE} $(mf_human_bytes "${S3_FILE_BYTES}")"
    S3_OBJECTS=-1
    S3_OBJECT_BYTES=-1
    mf_warn "   volume-tar 口径回答不了“备份了几个对象”：桶空时 tar 里只有 RustFS 元数据。要对象清单与逐对象 sha256 请用 --s3-mode objects（默认）"
  fi

  for v in "${EXTRA_VOLUMES[@]}"; do
    src="/var/lib/docker/volumes/$v/_data"
    [ -d "$src" ] || mf_die "额外卷 $v 的落点不存在: $src"
    tar_volume "$v" "$src" "s3/volume-$v-$TS.tar.gz"
  done
}

# ② 对象存储：S3 API 逐对象下载 + 对象清单 + 每对象 sha256。
# 空桶显式记 0（摘要/manifest/备份总账三处），因为“桶本来就是空”与“备份什么都没证明”必须能被区分开。
backup_s3_objects() {
  local b n bytes key size etag lm dest sha got ksha kverdict list
  local stage="$RUN_DIR/s3"
  local inv="$stage/objects-inventory-$TS.tsv"
  local buckets="$stage/buckets-$TS.txt"
  local summary="$stage/objects-summary-$TS.txt"
  local perbucket="$stage/.perbucket.tmp"
  local total_n=0 total_b=0 nbuckets=0
  local etag_checked=0 etag_mismatch=0 key_checked=0 key_mismatch=0

  mf_s3_init "$RUN_DIR"
  mf_log "② 对象存储: S3 API 逐对象备份（端点 ${MF_S3_ENDPOINT}，区域 ${MF_S3_REGION}）"
  mf_s3_list_buckets >"$buckets"
  : >"$perbucket"
  {
    printf '# MetaFusion 对象清单 (objects v1)\n'
    printf '# run: %s\n' "$TS"
    printf '# created_utc: %s\n' "$(mf_iso_utc)"
    printf '# bucket\tkey\tsize_bytes\tsha256\tetag\tlast_modified\tkey_sha256_match\n'
  } >"$inv"

  while IFS= read -r b; do
    [ -n "$b" ] || continue
    case "$b" in
      */*|*..*) mf_die "桶名含 / 或 ..，拒绝按路径落盘: $b" ;;
    esac
    nbuckets=$(( nbuckets + 1 ))
    mkdir -p "$stage/objects/$b"
    list="$stage/.list-$b.tmp"
    mf_s3_list_objects "$b" >"$list"
    n=0
    bytes=0
    while IFS=$'\t' read -r key size etag lm; do
      [ -n "${key:-}" ] || continue
      mf_s3_require_safe_key "$key"
      dest="$stage/objects/$b/$key"
      mkdir -p "$(dirname "$dest")"
      mf_s3_get_object "$b" "$key" "$dest"
      got=$(stat -c %s "$dest")
      # 列举大小与实得字节不符 = 下到半截或远端在变：宁可整份备份失败，也不留一份“看着有对象”的坏备份。
      [ "$got" = "$size" ] || mf_die "对象大小与列举不符: s3://$b/$key 列举 ${size} 字节，实得 ${got} 字节"
      sha=$(mf_sha256_of "$dest")
      kverdict="-"
      ksha=$(mf_s3_key_sha256 "$key")
      if [ -n "$ksha" ]; then
        key_checked=$(( key_checked + 1 ))
        if [ "$ksha" = "$sha" ]; then kverdict=yes; else kverdict=no; key_mismatch=$(( key_mismatch + 1 )); fi
      fi
      # ETag 是单段对象的 md5（多段上传带 -N 后缀，跳过）：多一条“字节与远端一致”的旁证。
      etag=${etag%\"}
      etag=${etag#\"}
      if printf '%s' "$etag" | grep -Eq '^[0-9a-f]{32}$' && command -v md5sum >/dev/null 2>&1; then
        etag_checked=$(( etag_checked + 1 ))
        if [ "$(md5sum "$dest" | awk '{print $1}')" != "$etag" ]; then
          etag_mismatch=$(( etag_mismatch + 1 ))
          mf_warn "  ETag(md5) 与下载内容不符: s3://$b/$key（远端 ETag $etag）"
        fi
      fi
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$b" "$key" "$size" "$sha" "$etag" "$lm" "$kverdict" >>"$inv"
      n=$(( n + 1 ))
      bytes=$(( bytes + size ))
    done <"$list"
    rm -f "$list"
    total_n=$(( total_n + n ))
    total_b=$(( total_b + bytes ))
    printf '%s\t%s\t%s\n' "$b" "$n" "$bytes" >>"$perbucket"
    if [ "$n" = 0 ]; then
      mf_warn "   桶 $b: 0 个对象（空桶——显式报告为 0，不是“成功”的伪装）"
    else
      mf_log "   桶 $b: $n 个对象，$(mf_human_bytes "$bytes")"
    fi
  done <"$buckets"

  S3_OBJECTS=$total_n
  S3_OBJECT_BYTES=$total_b
  S3_INVENTORY_FILE="s3/$(basename "$inv")"
  S3_SUMMARY_FILE="s3/$(basename "$summary")"
  S3_BUCKETS_FILE="s3/$(basename "$buckets")"
  {
    echo "MetaFusion 对象存储备份摘要 (objects v1)"
    echo "run:          $TS"
    echo "created_utc:  $(mf_iso_utc)"
    echo "endpoint:     ${MF_S3_ENDPOINT}"
    echo "mode:         objects（S3 API 逐对象下载；每对象 sha256 见对象清单）"
    echo "buckets:      $nbuckets"
    echo "objects:      $total_n"
    echo "bytes:        $total_b（$(mf_human_bytes "$total_b")）"
    echo "inventory:    $(basename "$inv")"
    echo "buckets_file: $(basename "$buckets")"
    echo
    printf '%-36s %10s %16s\n' "桶" "对象数" "字节数"
    while IFS=$'\t' read -r b n bytes; do
      printf '%-36s %10s %16s\n' "$b" "$n" "$(mf_human_bytes "$bytes")"
    done <"$perbucket"
    echo
    echo "交叉校验：键内嵌 sha256 一致 $(( key_checked - key_mismatch ))/${key_checked}，ETag(md5) 一致 $(( etag_checked - etag_mismatch ))/${etag_checked}"
    if [ "$total_n" = 0 ]; then
      echo
      echo "注意：所有桶合计 0 个对象 / 0 字节。这是显式报告——备份流程成功 ≠ 对象存储里有东西。"
      echo "      若线上本应有对象（storage.assets 有记录），说明对象字节已丢失，别把这份当有效的对象备份。"
    fi
  } >"$summary"
  mv "$perbucket" "$stage/objects-by-bucket-$TS.tsv"
  S3_BY_BUCKET_FILE="s3/objects-by-bucket-$TS.tsv"
  mf_log "   → ${S3_INVENTORY_FILE}（$total_n 个对象）· ${S3_SUMMARY_FILE} · ${S3_BY_BUCKET_FILE}"
  if [ "$total_n" = 0 ]; then
    S3_EMPTY=1
    mf_warn "对象存储备份：所有桶合计 0 个对象（0 字节）——已显式记入摘要、manifest.txt 与备份总账"
  fi
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
      if [ "$S3_MODE" = objects ]; then
        echo "s3_endpoint:      $MF_S3_ENDPOINT (region=$MF_S3_REGION)"
        echo "s3_objects:       ${S3_OBJECTS:-0} 个对象 / $(mf_human_bytes "${S3_OBJECT_BYTES:-0}")（逐对象下载；清单与每对象 sha256 见 ${S3_INVENTORY_FILE:-s3/objects-inventory-$TS.tsv}）"
        if [ "${S3_EMPTY:-0}" = 1 ]; then
          echo "s3_empty:         true（所有桶合计 0 个对象——显式报告，别当成“对象已备份”）"
        fi
      else
        echo "s3_volume:        ${S3_VOL_NAME:-$RUSTFS_VOLUME} ($S3_SRC, $(mf_human_bytes "$S3_BYTES")) [--s3-mode volume-tar：桶空时其中没有对象字节]"
      fi
    fi
    echo "elapsed_seconds:  $elapsed"
    echo
    echo "artifacts:"
    for rel in "${DB_DUMP_FILE:-}" "${GLOBALS_FILE:-}" "${S3_INVENTORY_FILE:-}" "${S3_SUMMARY_FILE:-}" "${S3_BY_BUCKET_FILE:-}" "${S3_BUCKETS_FILE:-}" "${S3_FILE:-}" "${CONFIG_FILE:-}"; do
      if [ -n "$rel" ]; then
        printf '  %-56s %10s  %s\n' "$rel" "$(stat -c %s "$RUN_DIR/$rel")" "$(mf_human_bytes "$(stat -c %s "$RUN_DIR/$rel")")"
      fi
    done
    echo
    if [ "$DO_S3" = 1 ] && [ "$S3_MODE" = objects ]; then
      echo "object_counts:"
      printf '  %-36s %10s %16s\n' "桶" "对象数" "字节数"
      if [ -f "$RUN_DIR/${S3_BY_BUCKET_FILE:-s3/objects-by-bucket-$TS.tsv}" ]; then
        while IFS=$'\t' read -r ob on oby; do
          [ -n "${ob:-}" ] || continue
          printf '  %-36s %10s %16s\n' "$ob" "$on" "$(mf_human_bytes "$oby")"
        done <"$RUN_DIR/${S3_BY_BUCKET_FILE:-s3/objects-by-bucket-$TS.tsv}"
      fi
      echo "  （口径：对象按原样落盘；空桶在上面记 0。逐对象 sha256 见 ${S3_INVENTORY_FILE:-s3/objects-inventory-$TS.tsv}）"
      echo
    fi
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
  printf '%s %s run=%s db=%s dump_bytes=%s s3_mode=%s s3_objects=%s s3_bytes=%s run_bytes=%s elapsed=%ss status=ok\n' \
    "$(mf_iso_utc)" "$(hostname)" "$TS" "$MF_DB_NAME" \
    "${DB_DUMP_BYTES:-0}" "$S3_MODE" "${S3_OBJECTS:-0}" "${S3_OBJECT_BYTES:-0}" \
    "$(mf_dir_bytes "$RUN_DIR")" "$elapsed" >>"$DEST/backup-history.log"
  ln -sfn "runs/$TS" "$DEST/latest"
}

# ---- 主流程 -------------------------------------------------------------------

# 库身份只能在这里解：lib 里的 MF_DB_USER/MF_DB_NAME 默认是空的，不到 .env 取一次，
# pg_dump/psql 就会拿到空用户名与空库名（第一次跑就是这么暴露出来的）。
mf_resolve_db_identity

# 前置清理（审计 O06）：先按保留策略清过期备份，再估算本次空间——否则累积到上限后
# 每日备份先因超限失败，永远到不了成功后的清理阶段。
# 保护最后可恢复副本：可用完整备份（不带 FAILED 标记）≤1 份时跳过前置清理，
# 宁可本次因超限失败，也不删掉唯一可恢复的那份。
if [ "$DO_PRUNE" = 1 ] && [ "$DRY_RUN" = 0 ] && [ -d "$DEST/runs" ]; then
  good_runs=0
  for rundir in "$DEST/runs"/*/; do
    [ -d "$rundir" ] || continue
    [ -f "${rundir}FAILED" ] || good_runs=$((good_runs + 1))
  done
  if [ "$good_runs" -le 1 ]; then
    mf_warn "前置清理跳过：可用完整备份只有 $good_runs 份，先保留最后可恢复副本（本次估算含全部旧备份）"
  else
    mf_log "前置清理：先按保留策略清过期备份（可用 $good_runs 份），再估算本次空间"
    "$SCRIPT_DIR/prune_backups.sh" --dest "$DEST" --keep-days "$KEEP_DAYS" --keep-weeks "$KEEP_WEEKS" --yes || \
      mf_warn "前置清理有告警（见上），继续本次备份"
  fi
fi

preflight

if [ "$DRY_RUN" = 1 ]; then
  mf_log "dry-run: 只做前置检查与计划打印，不写文件"
  if [ "$DO_DB" = 1 ]; then mf_log "  - pg_dump $MF_DB_NAME → $RUN_DIR/db/$MF_DB_NAME-$TS.sql.gz"; fi
  if [ "$DO_S3" = 1 ]; then
    if [ "$S3_MODE" = objects ]; then
      mf_log "  - 逐对象下载 $MF_S3_ENDPOINT（${S3_OBJECTS:-0} 个对象 / $(mf_human_bytes "${S3_OBJECT_BYTES:-0}")）→ $RUN_DIR/s3/objects/<桶>/<键>"
      mf_log "  - 对象清单/摘要 → s3/objects-inventory-$TS.tsv · s3/objects-summary-$TS.txt"
      if [ "${S3_OBJECTS:-0}" = 0 ]; then mf_log "  - 注意：现在 0 个对象，产物会显式记 0（空桶不会被当成“备份成功”）"; fi
    else
      mf_log "  - tar $S3_SRC → $RUN_DIR/s3/${S3_VOL_NAME:-$RUSTFS_VOLUME}-$TS.tar.gz"
    fi
  fi
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
# 凭据只活在备份期间：写完产物就删掉 600 配置，别让它跟着备份目录被复制走。
mf_s3_cleanup
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
