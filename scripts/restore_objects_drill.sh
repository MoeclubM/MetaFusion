#!/usr/bin/env bash
# ==============================================================================
# MetaFusion 对象存储恢复演练：把备份里的对象恢复出来，逐对象 sha256 比对，验完清理
# ==============================================================================
# 为什么要有这个脚本：库侧早有 restore_drill.sh，对象存储原来只有"tar 卷解包后 diff 一下"——
# 桶空的时候那次 diff 是"文件全一致"，看着通过，其实一个对象都没验（2026-09 的 7 张封面就是这么丢的）。
# 现在的口径：
#   ① 备份侧自查：s3/objects/** 的每个文件 sha256 必须与对象清单逐条一致，且文件数与清单条数一致；
#   ② 恢复侧验证：把对象恢复进**临时桶**（--mode s3）或临时目录（--mode local），再逐个读回、
#      sha256 与清单比对——"能恢复"才算数，不是"备份文件在"就算数；
#   ③ 验完清理：临时桶与临时目录默认都删（--keep 才留）；临时桶名带时间戳，演练可重复执行。
# 建议与库演练一起每月跑：scripts/backup.sh && scripts/restore_objects_drill.sh --yes
#
# 用法：scripts/restore_objects_drill.sh --help
# ==============================================================================

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/mf-backup-lib.sh
. "$SCRIPT_DIR/lib/mf-backup-lib.sh"

DEST=${MF_BACKUP_DIR:-$(dirname "$MF_REPO_ROOT")/backups}
RUN_SPEC=""
MODE=s3
TEMP_BUCKET=""
TEMP_DIR=""
KEEP=0
SKIP_VERIFY=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
MetaFusion 对象存储恢复演练（恢复对象 → 逐对象 sha256 比对 → 清理）

用法: scripts/restore_objects_drill.sh [选项]

选项:
  --dest DIR          备份根目录（默认 <仓库父目录>/backups）
  --run <ts|路径>     指定备份（默认 <dest>/latest，没有就用最新一份）
  --mode s3|local     恢复落点：
                        s3     默认。恢复进临时桶（写对象存储，顺带验证 S3 通路）
                        local  只落临时目录（对象存储不可达时的最小验证；不写任何桶）
  --temp-bucket NAME  临时桶名（默认 mf-restore-check-<小写时间戳>；已存在则拒绝，绝不覆盖别人的桶）
  --temp-dir DIR      临时目录（默认 mktemp -d）
  --keep             演练后保留临时桶与临时目录（排查用）
  --skip-verify      不校验 checksums.sha256（默认校验）
  --yes               非交互确认（定时演练用）
  -h, --help          显示本帮助

退出码: 0 演练通过；1 演练失败（不一致/恢复失败）；2 参数错误；3 被安全检查拒绝
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST=${2:?--dest 需要一个目录参数}; shift 2 ;;
    --run) RUN_SPEC=${2:?--run 需要时间戳或路径}; shift 2 ;;
    --mode) MODE=${2:?--mode 需要 s3|local}; shift 2 ;;
    --temp-bucket) TEMP_BUCKET=${2:?--temp-bucket 需要桶名}; shift 2 ;;
    --temp-dir) TEMP_DIR=${2:?--temp-dir 需要目录}; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$MODE" in s3|local) ;; *) echo "--mode 只能是 s3|local（给了: $MODE）" >&2; exit 2 ;; esac

refuse() { mf_log "拒绝: $*"; exit 3; }

mf_need_cmd docker sha256sum stat find awk sed

# ---- 选备份 -------------------------------------------------------------------

resolve_run() {
  if [ -n "$RUN_SPEC" ]; then
    if [ -d "$RUN_SPEC" ]; then
      RUN_DIR=$(cd "$RUN_SPEC" && pwd)
    elif [ -d "$DEST/runs/$RUN_SPEC" ]; then
      RUN_DIR="$DEST/runs/$RUN_SPEC"
    else
      mf_die "找不到备份: $RUN_SPEC（用 scripts/restore.sh --list 看有哪些）"
    fi
  elif [ -L "$DEST/latest" ] && [ -d "$DEST/latest" ]; then
    RUN_DIR=$(cd "$DEST/latest" && pwd)
  else
    local newest
    newest=$(ls -1 "$DEST/runs" 2>/dev/null | sort -r | head -n1)
    [ -n "$newest" ] || mf_die "备份目录里没有任何备份: $DEST/runs"
    RUN_DIR="$DEST/runs/$newest"
  fi
}

resolve_run
mf_log "使用备份: $RUN_DIR"
if [ -f "$RUN_DIR/FAILED" ]; then
  refuse "这份备份带 FAILED 标记（不完整），不能用来演练/恢复"
fi

INV=$(find "$RUN_DIR/s3" -maxdepth 1 -type f -name 'objects-inventory-*.tsv' 2>/dev/null | sort | head -n1)
if [ -z "$INV" ]; then
  refuse "这份备份里没有对象清单（s3/objects-inventory-*.tsv）：旧口径（--s3-mode volume-tar）的产物无法逐对象比对。改用 objects 口径重跑备份后再演练"
fi
BUCKETS_FILE=$(find "$RUN_DIR/s3" -maxdepth 1 -type f -name 'buckets-*.txt' 2>/dev/null | sort | head -n1)

if [ "$SKIP_VERIFY" = 1 ]; then
  mf_warn "已跳过 checksums.sha256 校验（--skip-verify）"
elif [ -f "$RUN_DIR/checksums.sha256" ]; then
  mf_log "① 校验产物完整性（sha256sum -c checksums.sha256）"
  if ( cd "$RUN_DIR" && sha256sum -c --quiet checksums.sha256 ); then
    mf_log "   checksums.sha256 全部通过（含每个对象本体）"
  else
    mf_die "校验和不匹配：备份已损坏或被改动，停止演练"
  fi
else
  mf_warn "这份备份没有 checksums.sha256（旧格式？），跳过整体校验"
fi

TS_LOWER=$(mf_stamp_utc | tr 'A-Z' 'a-z')
if [ -z "$TEMP_BUCKET" ]; then TEMP_BUCKET="mf-restore-check-$TS_LOWER"; fi
if [ -z "$TEMP_DIR" ]; then TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mf-restore-drill-XXXXXX"); fi
mkdir -p "$TEMP_DIR"
RESTORE_ROOT="$TEMP_DIR/restored"
# 规范化清单先建空文件：0 个对象的备份下，下面是"只追加"的循环，空文件不会自己出现。
: >"$TEMP_DIR/inventory.tsv"

START=$(date +%s)
TEMP_BUCKET_CREATED=0
FAILED=0

# 清理：验完就删（--keep 保留排查；失败时保留临时桶并在日志里说清怎么删）。
cleanup() {
  local rc=$?
  if [ "$MODE" = s3 ] && [ "$TEMP_BUCKET_CREATED" = 1 ]; then
    if [ "$KEEP" = 1 ]; then
      mf_log "--keep：保留临时桶 $TEMP_BUCKET（排查完手工清空对象再删桶）"
    elif [ "$rc" = 0 ]; then
      mf_log "⑤ 清理临时桶 $TEMP_BUCKET"
      while IFS=$'\t' read -r tkey _r; do
        [ -n "${tkey:-}" ] || continue
        mf_s3_delete_object "$TEMP_BUCKET" "$tkey"
      done < <(mf_s3_list_objects "$TEMP_BUCKET" || true)
      if mf_s3_delete_bucket "$TEMP_BUCKET"; then
        mf_log "   临时桶已删除"
      else
        mf_warn "临时桶 $TEMP_BUCKET 删除失败，请手工处理"
      fi
    else
      mf_warn "演练失败：保留临时桶 $TEMP_BUCKET 供排查（内容只是备份对象的副本，不是线上对象）"
    fi
  fi
  if [ "$KEEP" = 1 ]; then
    mf_log "--keep：保留临时目录 $TEMP_DIR"
  else
    rm -rf "$TEMP_DIR"
  fi
  mf_s3_cleanup
  exit "$rc"
}
trap cleanup EXIT

if [ "$MODE" = s3 ]; then
  if [ "$ASSUME_YES" != 1 ] && [ -t 0 ]; then
    printf '将把对象恢复到临时桶 %s（写对象存储），验完删除。输入 yes 继续: ' "$TEMP_BUCKET"
    read -r answer
    if [ "$answer" != "yes" ]; then mf_log "已取消"; exit 0; fi
  fi
  mf_s3_init "$TEMP_DIR"
fi

mf_log "=== 对象存储恢复演练开始 $(mf_iso_utc) ==="
mf_log "模式=$MODE 备份=$RUN_DIR 临时桶=${TEMP_BUCKET:-无} 临时目录=$TEMP_DIR"


# ---- ② 备份侧自查：清单 ↔ 产物逐条一致 ------------------------------------------

mf_log "② 备份侧自查：对象清单 ↔ s3/objects 产物"
DECLARED=0
DECLARED_BYTES=0
BAD_HASH=0
BAD_SIZE=0
MISSING=0
while IFS=$'\t' read -r b key size sha _etag _lm _kmatch; do
  case "$b" in '#'*|'') continue ;; esac
  [ -n "${key:-}" ] || continue
  DECLARED=$(( DECLARED + 1 ))
  DECLARED_BYTES=$(( DECLARED_BYTES + size ))
  printf '%s\t%s\t%s\t%s\n' "$b" "$key" "$size" "$sha" >>"$TEMP_DIR/inventory.tsv"
done <"$INV"
if [ "$DECLARED" = 0 ]; then
  mf_warn "对象清单里 0 个对象——本次演练没有可校验的对象（空桶如实报 0）"
fi

declare -a INV_BUCKETS=()
if [ -n "$BUCKETS_FILE" ]; then
  while IFS= read -r b; do
    [ -n "${b:-}" ] || continue
    INV_BUCKETS+=("$b")
  done <"$BUCKETS_FILE"
else
  mf_warn "备份里没有 buckets-*.txt，桶集合退化为清单里出现过的桶（空桶会漏掉）"
fi
if [ "${#INV_BUCKETS[@]}" = 0 ] && [ "$DECLARED" -gt 0 ]; then
  while IFS=$'\t' read -r b _k _s _h; do
    case "$b" in '#'*|'') continue ;; esac
    case " ${INV_BUCKETS[*]} " in *" $b "*) ;; *) INV_BUCKETS+=("$b") ;; esac
  done <"$TEMP_DIR/inventory.tsv"
fi

LOCAL_FILES=0
LOCAL_BYTES=0
if [ -d "$RUN_DIR/s3/objects" ]; then
  while IFS= read -r f; do
    LOCAL_FILES=$(( LOCAL_FILES + 1 ))
    LOCAL_BYTES=$(( LOCAL_BYTES + $(stat -c %s "$f") ))
  done < <(find "$RUN_DIR/s3/objects" -type f | sort)
fi
if [ "$LOCAL_FILES" != "$DECLARED" ]; then
  FAILED=1
  mf_warn "对象数不符：清单声明 $DECLARED 个，s3/objects 下有 $LOCAL_FILES 个文件"
fi
if [ "$LOCAL_BYTES" != "$DECLARED_BYTES" ]; then
  FAILED=1
  mf_warn "对象总字节不符：清单声明 $DECLARED_BYTES，产物合计 $LOCAL_BYTES"
fi

while IFS=$'\t' read -r b key size sha; do
  [ -n "${key:-}" ] || continue
  f="$RUN_DIR/s3/objects/$b/$key"
  if [ ! -f "$f" ]; then
    MISSING=$(( MISSING + 1 ))
    mf_warn "清单里有、产物里没有: s3://$b/$key"
    continue
  fi
  got=$(stat -c %s "$f")
  if [ "$got" != "$size" ]; then
    BAD_SIZE=$(( BAD_SIZE + 1 ))
    mf_warn "大小不符: s3://$b/$key 清单 $size 字节，产物 $got 字节"
  fi
  real=$(mf_sha256_of "$f")
  if [ "$real" != "$sha" ]; then
    BAD_HASH=$(( BAD_HASH + 1 ))
    mf_warn "sha256 不符: s3://$b/$key 清单 $sha，产物 $real"
  fi
done <"$TEMP_DIR/inventory.tsv"
if [ "$(( MISSING + BAD_SIZE + BAD_HASH ))" != 0 ]; then
  FAILED=1
else
  mf_log "   备份侧自查通过：$DECLARED 个对象 / $(mf_human_bytes "$DECLARED_BYTES")，逐对象 sha256 与清单一致"
fi

# ---- ③ 恢复：临时桶（或临时目录）-----------------------------------------------

if [ "$MODE" = s3 ]; then
  mf_log "③ 恢复对象到临时桶 $TEMP_BUCKET，再逐个读回比对"
  if mf_s3_bucket_exists "$TEMP_BUCKET"; then
    refuse "临时桶 $TEMP_BUCKET 已存在，拒绝复用（换 --temp-bucket）"
  fi
  mf_s3_make_bucket "$TEMP_BUCKET"
  TEMP_BUCKET_CREATED=1
  mf_log "   临时桶已创建"
else
  mf_log "③ 恢复对象到临时目录 $RESTORE_ROOT，再逐个读回比对"
fi

UPLOADED=0
VERIFIED=0
VERIFY_BAD=0
for b in "${INV_BUCKETS[@]}"; do
  n=0
  by=0
  mkdir -p "$RESTORE_ROOT/$b"
  while IFS=$'\t' read -r ib key size sha; do
    [ "$ib" = "$b" ] || continue
    src="$RUN_DIR/s3/objects/$b/$key"
    [ -f "$src" ] || continue
    if [ "$MODE" = s3 ]; then
      mf_s3_put_object "$TEMP_BUCKET" "$b/$key" "$src"
    else
      dest="$RESTORE_ROOT/$b/$key"
      mkdir -p "$(dirname "$dest")"
      cp -p "$src" "$dest"
    fi
    UPLOADED=$(( UPLOADED + 1 ))
    n=$(( n + 1 ))
    by=$(( by + size ))
    # 逐个读回再比对：这才是"能恢复"的证据（只看备份目录里文件还在不算数）。
    back="$TEMP_DIR/readback/$b/$key"
    mkdir -p "$(dirname "$back")"
    if [ "$MODE" = s3 ]; then
      mf_s3_get_object "$TEMP_BUCKET" "$b/$key" "$back"
    else
      cp -p "$RESTORE_ROOT/$b/$key" "$back"
    fi
    rsha=$(mf_sha256_of "$back")
    rsize=$(stat -c %s "$back")
    if [ "$rsha" = "$sha" ] && [ "$rsize" = "$size" ]; then
      VERIFIED=$(( VERIFIED + 1 ))
    else
      VERIFY_BAD=$(( VERIFY_BAD + 1 ))
      mf_warn "读回不一致: s3://$b/$key 清单 $sha/$size，读回 $rsha/$rsize"
    fi
    rm -f "$back"
  done <"$TEMP_DIR/inventory.tsv"
  if [ "$n" = 0 ]; then
    mf_log "   桶 $b: 0 个对象（空桶，显式报告为 0）"
  else
    mf_log "   桶 $b: 恢复 $n 个对象 / $(mf_human_bytes "$by")（逐个读回比对）"
  fi
done

if [ "$MODE" = s3 ]; then
  TB_COUNT=0
  while IFS=$'\t' read -r _k _r; do
    [ -n "${_k:-}" ] || continue
    TB_COUNT=$(( TB_COUNT + 1 ))
  done < <(mf_s3_list_objects "$TEMP_BUCKET")
  if [ "$TB_COUNT" != "$DECLARED" ]; then
    FAILED=1
    mf_warn "临时桶对象数不符：备份 $DECLARED 个，临时桶列出 $TB_COUNT 个"
  else
    mf_log "   临时桶列出 $TB_COUNT 个对象，与备份数量一致"
  fi
fi
if [ "$VERIFY_BAD" != 0 ] || [ "$UPLOADED" != "$DECLARED" ]; then
  FAILED=1
fi

# ---- ④ 结论 -------------------------------------------------------------------

ELAPSED=$(( $(date +%s) - START ))
echo
printf '%-32s %10s %14s %s\n' "桶" "对象数" "字节数" "结果"
for b in "${INV_BUCKETS[@]}"; do
  n=0
  by=0
  while IFS=$'\t' read -r ib _k size _sha; do
    if [ "$ib" = "$b" ]; then n=$(( n + 1 )); by=$(( by + size )); fi
  done <"$TEMP_DIR/inventory.tsv"
  verdict="校验通过"
  if [ "$n" = 0 ]; then verdict="0 个对象（空桶，显式报告）"; fi
  printf '%-32s %10s %14s %s\n' "$b" "$n" "$(mf_human_bytes "$by")" "$verdict"
done
mf_log "对象合计: 清单 $DECLARED 个 / $(mf_human_bytes "$DECLARED_BYTES")；恢复 $UPLOADED 个；读回校验通过 $VERIFIED 个；不一致 $VERIFY_BAD 个"
if [ "$DECLARED" = 0 ]; then
  mf_warn "本次备份里 0 个对象：流程通过，但没有任何对象被验证——对象存储确实是空的，别把它读成“对象备份有效”"
fi
if [ "$FAILED" = 0 ]; then
  mf_log "④ 演练通过：备份里的对象可完整恢复，逐对象 sha256 与清单一致（耗时 ${ELAPSED}s）"
  exit 0
fi
mf_log "④ 演练失败：见上面的差异（耗时 ${ELAPSED}s）"
exit 1
