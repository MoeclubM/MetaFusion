#!/usr/bin/env bash
# ==============================================================================
# MetaFusion 恢复：从备份目录恢复 PostgreSQL（可选恢复对象存储卷与角色定义）
# ==============================================================================
# 对象存储恢复（--restore-s3）：
#   - objects 口径的备份：按 s3/objects-inventory-*.tsv 逐对象 PUT 回各自的原桶（桶不存在则建），
#     每个对象上传后用 HEAD 核对字节数；不写卷、不停服务。非交互环境需要 --yes。
#   - volume-tar 口径（旧备份）：仍走"停 rustfs → 解包卷 → 拉起"，期间对象存储不可用。
#
# 安全设计（每一步都是"别把线上库覆盖掉"的护栏）：
#   1. 默认恢复到 --db 指定的库；目标是 .env 里的生产库名时必须再加 --allow-production；
#   2. 目标库非空时：不加 --force 直接拒绝（退出码 3）；加了 --force 还要输入库名确认
#      （非交互要 --yes），并先把旧内容 pg_dump 到 <dest>/pre-restore/ —— 覆盖前永远留一手；
#   3. 覆盖 = DROP DATABASE ... WITH (FORCE) + CREATE DATABASE，不在旧库上叠着恢复；
#   4. 恢复前校验 checksums.sha256（除非 --skip-verify）；带 FAILED 标记的备份一律拒绝；
#   5. --dry-run 只打印将要执行的命令，不连库、不写盘。
#
# 用法：scripts/restore.sh --help
# ==============================================================================

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/mf-backup-lib.sh
. "$SCRIPT_DIR/lib/mf-backup-lib.sh"

DEST=${MF_BACKUP_DIR:-$(dirname "$MF_REPO_ROOT")/backups}
RUN_SPEC=""
DUMP_FILE=""
LIST_ONLY=0
TARGET_DB=""
CREATE_DB=0
FORCE=0
ALLOW_PRODUCTION=0
ASSUME_YES=0
PRE_DUMP_DIR=""
NO_PRE_DUMP=0
SKIP_VERIFY=0
SINGLE_TX=0
RESTORE_ROLES=0
RESTORE_S3=0
S3_VOLUME=${MF_RUSTFS_VOLUME:-deploy_s3_data}
COUNTS="catalog.entities,catalog.relations"
DRY_RUN=0

usage() {
  cat <<'EOF'
MetaFusion 恢复（默认恢复到 --db 指定的库；覆盖非空库需要显式确认）

用法: scripts/restore.sh [选择备份] [目标与安全开关]

选择备份:
  --dest DIR             备份根目录（默认 <仓库父目录>/backups，服务器上即 /root/metafusion/backups）
  --list                 列出可用备份（大小/年龄/是否 FAILED/内含库）后退出
  --run <时间戳|路径>    指定一轮备份（默认用 <dest>/latest，没有就用最新一份）
  --file <x.sql.gz>      直接指定 dump 文件（跳过清单与校验和）

目标与安全:
  --db NAME              目标库名（默认 .env 的 DB_NAME）
  --create               目标库不存在时允许创建
  --force                目标库非空时允许覆盖（会先自动备份旧内容，再 DROP + CREATE）
  --allow-production     允许目标是生产库名（.env 的 DB_NAME）；不加则直接拒绝
  --yes                  跳过交互确认（必须与 --force 同用；非交互环境必需）
  --pre-dump-dir DIR     覆盖前旧内容的落点（默认 <dest>/pre-restore）
  --no-pre-dump          不自动备份旧内容（危险，只给确认可弃的库用）

其它:
  --skip-verify          不校验 checksums.sha256（默认校验）
  --single-transaction   用 psql -1 恢复（失败整体回滚；大库更慢）
  --restore-roles        同时恢复 db/globals-*.sql.gz 里的角色定义
  --restore-s3           同时恢复对象存储。objects 口径的备份（默认）走 S3 API 逐对象回传，
                         不停服务、不改卷；旧口径（--s3-mode volume-tar）的备份才停 rustfs 解包
  --s3-volume NAME       对象存储卷名（默认 deploy_s3_data，仅在 --restore-s3 时用）
  --counts "a.b,c.d"     恢复后打印行数的表（默认 catalog.entities,catalog.relations）
  --dry-run              只打印计划与将要执行的命令
  -h, --help             显示本帮助

退出码: 0 成功；1 执行失败；2 参数错误；3 被安全检查拒绝（目标非空/生产库/备份不完整）
       4 校验和不匹配
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST=${2:?--dest 需要一个目录参数}; shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    --run) RUN_SPEC=${2:?--run 需要时间戳或路径}; shift 2 ;;
    --file) DUMP_FILE=${2:?--file 需要文件路径}; shift 2 ;;
    --db) TARGET_DB=${2:?--db 需要库名}; shift 2 ;;
    --create) CREATE_DB=1; shift ;;
    --force) FORCE=1; shift ;;
    --allow-production) ALLOW_PRODUCTION=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --pre-dump-dir) PRE_DUMP_DIR=${2:?--pre-dump-dir 需要目录}; shift 2 ;;
    --no-pre-dump) NO_PRE_DUMP=1; shift ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    --single-transaction) SINGLE_TX=1; shift ;;
    --restore-roles) RESTORE_ROLES=1; shift ;;
    --restore-s3) RESTORE_S3=1; shift ;;
    --s3-volume) S3_VOLUME=${2:?--s3-volume 需要卷名}; shift 2 ;;
    --counts) COUNTS=${2:?--counts 需要表名列表}; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

refuse() { mf_log "拒绝: $*"; exit 3; }

# ---- 选择与校验 ----------------------------------------------------------------

# 目录名（<YYYYMMDDTHHMMSSZ>）→ epoch；名字不合法返回非零，调用方按"跳过"处理。
run_epoch_from_name() {
  local n=$1 d
  case "$n" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) return 1 ;;
  esac
  d="${n:0:4}-${n:4:2}-${n:6:2}T${n:9:2}:${n:11:2}:${n:13:2}Z"
  date -u -d "$d" +%s 2>/dev/null || return 1
}

list_runs() {
  if [ ! -d "$DEST/runs" ]; then
    mf_log "没有备份目录: $DEST/runs"
    return 0
  fi
  printf '%-18s %10s %8s %-8s %s\n' "备份" "大小" "年龄天" "状态" "内含 dump"
  local name path status dump epoch age
  while IFS= read -r name; do
    path="$DEST/runs/$name"
    [ -d "$path" ] || continue
    status="ok"
    if [ -f "$path/FAILED" ]; then status="FAILED"; fi
    dump=$(ls -1 "$path/db" 2>/dev/null | grep -v '^globals-' | tr '\n' ' ')
    age="-"
    if epoch=$(run_epoch_from_name "$name"); then
      age=$(( ( $(date -u +%s) - epoch ) / 86400 ))
    fi
    printf '%-18s %10s %8s %-8s %s\n' "$name" "$(mf_human_bytes "$(mf_dir_bytes "$path")")" "$age" "$status" "$dump"
  done < <(ls -1 "$DEST/runs" 2>/dev/null | sort -r)
  if [ -L "$DEST/latest" ]; then
    mf_log "latest → $(readlink "$DEST/latest")"
  fi
}

resolve_run() {
  if [ -n "$RUN_SPEC" ]; then
    if [ -d "$RUN_SPEC" ]; then
      RUN_DIR=$(cd "$RUN_SPEC" && pwd)
    elif [ -d "$DEST/runs/$RUN_SPEC" ]; then
      RUN_DIR="$DEST/runs/$RUN_SPEC"
    else
      mf_die "找不到备份: $RUN_SPEC（用 --list 看有哪些）"
    fi
  elif [ -L "$DEST/latest" ] && [ -d "$DEST/latest" ]; then
    RUN_DIR=$(cd "$DEST/latest" && pwd)
  else
    local newest
    newest=$(ls -1 "$DEST/runs" 2>/dev/null | sort -r | head -n1)
    [ -n "$newest" ] || mf_die "备份目录里没有任何备份: $DEST/runs"
    RUN_DIR="$DEST/runs/$newest"
  fi
  mf_log "使用备份: $RUN_DIR"
}

verify_run() {
  if [ -f "$RUN_DIR/FAILED" ]; then
    refuse "这份备份带 FAILED 标记（不完整），不能用来恢复：$RUN_DIR"
  fi
  if [ "$SKIP_VERIFY" = 1 ]; then
    mf_warn "已跳过 checksum 校验（--skip-verify）"
    return 0
  fi
  if [ -f "$RUN_DIR/checksums.sha256" ]; then
    mf_log "校验产物完整性（sha256）..."
    if ( cd "$RUN_DIR" && sha256sum -c --quiet checksums.sha256 ); then
      mf_log "校验通过: checksums.sha256"
    else
      mf_log "错误: 校验和不匹配——备份损坏或被改动，不要用它恢复"
      exit 4
    fi
  else
    mf_warn "这份备份没有 checksums.sha256（旧格式？），跳过校验"
  fi
}

pick_dump() {
  if [ -n "$DUMP_FILE" ]; then
    [ -f "$DUMP_FILE" ] || mf_die "指定的 dump 不存在: $DUMP_FILE"
    return 0
  fi
  local cands n
  cands=$(find "$RUN_DIR/db" -maxdepth 1 -type f -name '*.sql.gz' ! -name 'globals-*' 2>/dev/null | sort)
  [ -n "$cands" ] || mf_die "$RUN_DIR/db 下没有可恢复的 dump"
  n=$(printf '%s\n' "$cands" | wc -l)
  if [ "$n" != "1" ]; then
    mf_die "这份备份里有多个 dump，用 --file 指定其中一个: $(printf '%s ' $cands)"
  fi
  DUMP_FILE="$cands"
  GLOBALS_FILE=$(find "$RUN_DIR/db" -maxdepth 1 -type f -name 'globals-*.sql.gz' 2>/dev/null | sort | head -n1)
}

# ---- 目标库安全检查（这里是"别覆盖生产库"的核心） ------------------------------

# 维护库上的 DDL：dry-run 只打印，真跑才执行。
sql_admin() {
  if [ "$DRY_RUN" = 1 ]; then
    mf_log "  [dry-run] psql -d postgres -c: $1"
  else
    mf_pg_admin_psql "$1" >/dev/null
  fi
}

prepare_target() {
  local exists=0 tables=0 pre
  if mf_pg_db_exists "$TARGET"; then
    exists=1
    tables=$(mf_pg_table_count "$TARGET")
  fi

  if [ "$TARGET" = "$PROD_DB" ] && [ "$ALLOW_PRODUCTION" != 1 ]; then
    refuse "目标是生产库名 $PROD_DB（.env 的 DB_NAME）。确要覆盖请显式加 --allow-production，并先确认服务已停写；演练请换 scratch 库名"
  fi

  if [ "$exists" = 1 ] && [ "$tables" -gt 0 ]; then
    if [ "$FORCE" != 1 ]; then
      refuse "目标库 $TARGET 非空（$tables 张表）：不加 --force 不会覆盖。演练请用新库名，例如 --db metafusion_restore_check --create"
    fi
    if [ "$ASSUME_YES" != 1 ]; then
      if [ -t 0 ]; then
        printf '目标库 %s 有 %s 张表，恢复会 DROP 并重建。输入库名确认: ' "$TARGET" "$tables"
        read -r answer
        if [ "$answer" != "$TARGET" ]; then mf_log "输入不匹配，已取消"; exit 0; fi
      else
        mf_die "非交互环境覆盖非空库需要 --yes"
      fi
    fi
    if [ "$NO_PRE_DUMP" != 1 ]; then
      mkdir -p "$PRE_DUMP_DIR"
      chmod 700 "$PRE_DUMP_DIR" 2>/dev/null || true
      pre="$PRE_DUMP_DIR/$TARGET-$(mf_stamp_utc).sql.gz"
      mf_log "覆盖前自动备份旧内容: $pre"
      if [ "$DRY_RUN" = 1 ]; then
        mf_log "  [dry-run] docker exec $MF_PG_CONTAINER pg_dump -U $MF_DB_USER -d $TARGET | gzip -9 > $pre"
      else
        docker exec "$MF_PG_CONTAINER" pg_dump -U "$MF_DB_USER" -d "$TARGET" | gzip -9 >"$pre"
        mf_log "旧内容已备份（$(mf_human_bytes "$(stat -c %s "$pre")")）"
      fi
    else
      mf_warn "按 --no-pre-dump 跳过了旧内容备份"
    fi
    sql_admin "DROP DATABASE IF EXISTS \"$TARGET\" WITH (FORCE)"
    sql_admin "CREATE DATABASE \"$TARGET\""
  elif [ "$exists" = 1 ]; then
    mf_log "目标库 $TARGET 已存在但为空（0 张表），直接恢复"
  else
    if [ "$CREATE_DB" != 1 ]; then
      refuse "目标库 $TARGET 不存在：用 --create 让脚本建库（演练用新库名，别撞生产库）"
    fi
    sql_admin "CREATE DATABASE \"$TARGET\""
  fi
}

# ---- 恢复执行 ------------------------------------------------------------------

do_restore() {
  # -q 只压掉 CREATE TABLE 这类命令回显；报错仍走 stderr，日志里只剩进度与结果。
  local flags=(-U "$MF_DB_USER" -d "$TARGET" -v ON_ERROR_STOP=1 -q) start elapsed
  if [ "$SINGLE_TX" = 1 ]; then flags+=(-1); fi
  if [ "$DRY_RUN" = 1 ]; then
    mf_log "  [dry-run] gunzip -c $DUMP_FILE | docker exec -i $MF_PG_CONTAINER psql ${flags[*]}"
    return 0
  fi
  mf_log "开始恢复 $(basename "$DUMP_FILE") → 库 $TARGET"
  start=$(date +%s)
  if gunzip -c "$DUMP_FILE" | docker exec -i "$MF_PG_CONTAINER" psql "${flags[@]}"; then
    elapsed=$(( $(date +%s) - start ))
    mf_log "恢复完成（耗时 ${elapsed}s）"
  else
    mf_die "恢复失败：psql 非零退出（ON_ERROR_STOP=1；报错见上一条 SQL）"
  fi
}

do_roles() {
  if [ -z "${GLOBALS_FILE:-}" ]; then
    refuse "--restore-roles：这份备份里没有 globals-*.sql.gz"
  fi
  mf_log "恢复角色定义: $GLOBALS_FILE"
  if [ "$DRY_RUN" = 1 ]; then
    mf_log "  [dry-run] gunzip -c $GLOBALS_FILE | docker exec -i $MF_PG_CONTAINER psql -U $MF_DB_USER -d postgres"
    return 0
  fi
  gunzip -c "$GLOBALS_FILE" | docker exec -i "$MF_PG_CONTAINER" psql -U "$MF_DB_USER" -d postgres -v ON_ERROR_STOP=1 >/dev/null
  mf_log "角色定义已恢复（角色已存在时会因 ON_ERROR_STOP 报错，属预期：只在重建实例时需要）"
}

do_s3() {
  local inv
  inv=$(find "$RUN_DIR/s3" -maxdepth 1 -type f -name 'objects-inventory-*.tsv' 2>/dev/null | sort | head -n1)
  if [ -n "$inv" ]; then
    do_restore_objects "$inv"
    return 0
  fi
  do_s3_volume
}

# 逐对象回传：objects 口径的恢复路径（不停服务、不改卷）。
do_restore_objects() {
  local inv=$1 b key size sha _etag _lm _kmatch f got n=0 bad=0 total cfgdir made=" "
  total=$(grep -c -v '^#' "$inv" || true)
  mf_log "恢复对象存储（逐对象）: $total 个对象 → 各自的原桶（清单 $(basename "$inv")）"
  if [ "$DRY_RUN" = 1 ]; then
    mf_log "  [dry-run] 缺的桶先 PUT 建桶，再逐个 PUT 对象，每个对象上传后 HEAD 核对字节数"
    mf_log "  [dry-run] 例: $RUN_DIR/s3/objects/<桶>/<键> → s3://<桶>/<键>"
    return 0
  fi
  if [ "$ASSUME_YES" != 1 ]; then
    if [ -t 0 ]; then
      printf '将把 %s 个对象回传到对象存储的原桶（同名键会被覆盖）。输入 yes 继续: ' "$total"
      read -r answer
      if [ "$answer" != "yes" ]; then mf_log "已取消"; exit 0; fi
    else
      mf_die "非交互环境回传对象需要 --yes"
    fi
  fi
  cfgdir=$(mktemp -d)
  mf_s3_init "$cfgdir"
  while IFS=$'\t' read -r b key size sha _etag _lm _kmatch; do
    case "$b" in '#'*|'') continue ;; esac
    [ -n "${key:-}" ] || continue
    mf_s3_require_safe_key "$key"
    f="$RUN_DIR/s3/objects/$b/$key"
    if [ ! -f "$f" ]; then
      mf_s3_cleanup; rm -rf "$cfgdir"
      mf_die "备份里少了对象本体: s3://$b/$key（清单与产物不同步，先用 restore_objects_drill.sh 查）"
    fi
    case "$made" in
      *" $b "*) ;;
      *)
        if ! mf_s3_bucket_exists "$b"; then
          mf_s3_make_bucket "$b"
          mf_log "   建桶 $b"
        fi
        made="$made$b " ;;
    esac
    mf_s3_put_object "$b" "$key" "$f"
    got=$(mf_s3_object_size "$b" "$key" || echo -)
    if [ "$got" = "$size" ]; then
      n=$(( n + 1 ))
    else
      bad=$(( bad + 1 ))
      mf_warn "回传后字节数不符: s3://$b/$key 期望 $size，HEAD 得到 $got"
    fi
  done <"$inv"
  mf_s3_cleanup
  rm -rf "$cfgdir"
  mf_log "对象回传完成：$n/$total 个对象字节数核对通过，不一致 $bad 个"
  if [ "$bad" != 0 ]; then mf_die "有对象回传后核对失败（见上）"; fi
  mf_log "提示：回传只是把字节放回桶；目录库里的 storage.assets 记录是否与对象对得上，另跑一次 storage 服务的校验"
}

do_s3_volume() {
  local archive src
  archive=$(find "$RUN_DIR/s3" -maxdepth 1 -type f -name "$S3_VOLUME-*.tar.gz" 2>/dev/null | sort | head -n1)
  if [ -z "$archive" ]; then
    archive=$(find "$RUN_DIR/s3" -maxdepth 1 -type f -name '*.tar.gz' 2>/dev/null | sort | head -n1)
  fi
  if [ -z "$archive" ]; then
    refuse "--restore-s3：这份备份里既没有对象清单（objects 口径）也没有卷 tar.gz"
  fi
  src=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$MF_RUSTFS_CONTAINER" 2>/dev/null || true)
  if [ -z "$src" ]; then
    refuse "拿不到 $MF_RUSTFS_CONTAINER 的 /data 卷落点（容器没起？先起容器再恢复）"
  fi
  mf_log "恢复对象存储卷 $S3_VOLUME: $(basename "$archive") → $src"
  if [ "$DRY_RUN" = 1 ]; then
    mf_log "  [dry-run] docker stop $MF_RUSTFS_CONTAINER; tar -xzf $archive --numeric-owner -C $src; docker start $MF_RUSTFS_CONTAINER"
    return 0
  fi
  mf_log "  停 $MF_RUSTFS_CONTAINER（期间对象存储不可用），解包后自动拉起"
  docker stop "$MF_RUSTFS_CONTAINER" >/dev/null
  if tar -xzf "$archive" --numeric-owner -C "$src"; then
    docker start "$MF_RUSTFS_CONTAINER" >/dev/null
    mf_log "对象存储卷已恢复，容器已拉起"
  else
    docker start "$MF_RUSTFS_CONTAINER" >/dev/null || mf_warn "rustfs 容器拉起失败，请手工检查"
    mf_die "解包失败：卷可能半恢复，请用同一份 tar 重跑或从 pre-restore 还原"
  fi
}

print_counts() {
  local db=$1 t
  mf_log "恢复后行数（库 $db）:"
  for t in ${COUNTS//,/ }; do
    mf_require_table_ref "$t"
    printf '  %-28s %s\n' "$t" "$(mf_pg_scalar "$db" "select count(*) from $t")"
  done
}

# ---- 主流程 -------------------------------------------------------------------

if [ "$LIST_ONLY" = 1 ]; then
  list_runs
  exit 0
fi

mf_need_cmd docker gunzip sha256sum tar find
mf_pg_require
mf_resolve_db_identity
PROD_DB="$MF_DB_NAME"
TARGET=${TARGET_DB:-$MF_DB_NAME}
mf_require_ident "$TARGET"
if [ -z "$PRE_DUMP_DIR" ]; then PRE_DUMP_DIR="$DEST/pre-restore"; fi

resolve_run
verify_run
pick_dump

mf_log "计划: 恢复 $(basename "$DUMP_FILE") → 库 $TARGET（实例 $MF_PG_CONTAINER，用户 $MF_DB_USER）"

prepare_target
do_restore
if [ "$RESTORE_ROLES" = 1 ]; then do_roles; fi
if [ "$DRY_RUN" != 1 ]; then print_counts "$TARGET"; fi
if [ "$RESTORE_S3" = 1 ]; then do_s3; fi

if [ "$DRY_RUN" = 1 ]; then
  mf_log "dry-run 结束：没有改动任何库与卷"
  exit 0
fi
mf_log "恢复结束：库 $TARGET 就绪。回切生产时请确认应用连的就是它，并跑一次 /ready 健康检查"