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


# ---------------------------------------------------------------------------
# 对象存储（S3 协议）：逐对象备份 / 恢复 / 演练共用
# ---------------------------------------------------------------------------
# 为什么不 tar 卷：RustFS 在卷里放的是自己的内部结构（.rustfs.sys 子树），桶空时 tar 出来的
# 是"非空但 0 个对象"的产物——既证明不了备份了什么，也无法逐对象校验。2026-09 线上实测：
# 两个桶各 0 个对象，而卷里 25 个文件全是元数据，backup.sh 只报了 tar 体积，看着像成功。
# 走 S3 API 才有"对象清单 + 每对象 sha256 + 桶名/键路径"，空桶也能被显式报告为 0 个对象。
#
# 签名用 curl 自带的 --aws-sigv4（curl >= 7.75）：宿主不必额外装 mc / aws-cli / rclone，
# 也就没有"备份关键路径依赖某个第三方镜像拉不拉得到"这种可用性问题。
# 凭据只写进 600 的 curl 配置文件（不进 argv、故不进 ps），该文件随 run 目录一起删除。

MF_S3_REGION=${MF_S3_REGION:-us-east-1}
MF_S3_PORT=${MF_S3_PORT:-9000}
MF_S3_ENDPOINT=${MF_S3_ENDPOINT:-}
MF_S3_CURL_CFG=${MF_S3_CURL_CFG:-}
MF_S3_TIMEOUT=${MF_S3_TIMEOUT:-1800}
MF_S3_PAGE_SIZE=${MF_S3_PAGE_SIZE:-1000}

mf_s3_need_tools() {
  mf_need_cmd curl docker awk sed stat sha256sum
  curl --help all 2>/dev/null | grep -q -- '--aws-sigv4' || \
    mf_die "curl 不支持 --aws-sigv4（需要 curl >= 7.75）：$(curl --version 2>/dev/null | head -n1)"
}

# 端点解析：优先 MF_S3_ENDPOINT；否则取 rustfs 容器在当前网络上的 IP——编排不发布宿主端口，
# 宿主只能走容器 IP。容器名与 IP 都在运行时解析，不写死。
mf_s3_resolve_endpoint() {
  if [ -n "${MF_S3_ENDPOINT}" ]; then
    MF_S3_ENDPOINT=${MF_S3_ENDPOINT%/}
    return 0
  fi
  local ip
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "${MF_RUSTFS_CONTAINER}" 2>/dev/null | awk '{print $1}')
  if [ -z "${ip}" ]; then
    mf_die "解析不到容器 ${MF_RUSTFS_CONTAINER} 的 IP（容器没起？或显式给 MF_S3_ENDPOINT=http://host:port）"
  fi
  MF_S3_ENDPOINT="http://${ip}:${MF_S3_PORT}"
}

# $1 = 存放凭据配置的目录（一般是本次 run 目录，随 run 一起删）
mf_s3_init() {
  local dir=$1 ak sk esc_ak esc_sk
  mf_s3_need_tools
  mf_s3_resolve_endpoint
  ak=${MF_S3_ACCESS_KEY:-$(mf_env_value RUSTFS_ROOT_USER)}
  sk=${MF_S3_SECRET_KEY:-$(mf_env_value RUSTFS_ROOT_PASSWORD)}
  if [ -z "${ak}" ] || [ -z "${sk}" ]; then
    mf_die "读不到对象存储凭据：${MF_ENV_FILE} 需要 RUSTFS_ROOT_USER / RUSTFS_ROOT_PASSWORD（与编排同一份来源），或用 MF_S3_ACCESS_KEY / MF_S3_SECRET_KEY 覆盖"
  fi
  MF_S3_CURL_CFG=${dir}/.s3-curl.cfg
  # curl 配置值里的 " 与 \ 需要转义；口令含这两个字符时照原样写进去会被解析成别的值。
  esc_ak=$(printf '%s' "${ak}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  esc_sk=$(printf '%s' "${sk}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  umask 077
  {
    printf '# MetaFusion 备份用的临时 curl 配置：凭据放这里而不是 argv（不进 ps）。用完即删。\n'
    printf 'silent\nshow-error\nconnect-timeout = 15\n'
    printf 'user = "%s:%s"\n' "${esc_ak}" "${esc_sk}"
    printf 'aws-sigv4 = "aws:amz:%s:s3"\n' "${MF_S3_REGION}"
  } >"${MF_S3_CURL_CFG}"
  chmod 600 "${MF_S3_CURL_CFG}" 2>/dev/null || true
  unset ak sk esc_ak esc_sk
}

mf_s3_cleanup() {
  if [ -n "${MF_S3_CURL_CFG}" ] && [ -f "${MF_S3_CURL_CFG}" ]; then
    rm -f "${MF_S3_CURL_CFG}"
  fi
  MF_S3_CURL_CFG=""
}

# 所有请求都从这里发：-K 读凭据，其余参数原样透传。
mf_s3_curl() {
  [ -n "${MF_S3_CURL_CFG}" ] || mf_die "内部错误：先调 mf_s3_init"
  curl --config "${MF_S3_CURL_CFG}" --max-time "${MF_S3_TIMEOUT}" --retry 2 --retry-delay 2 "$@"
}

mf_s3_error_of() {  # 从 S3 错误响应里抠出 Code/Message（失败提示用）
  printf '%s' "$1" | tr -d '\n' | sed -n 's#.*<Code>\([^<]*\)</Code>.*<Message>\([^<]*\)</Message>.*#\1: \2#p'
}

# XML 转义还原：&amp; 必须最后处理，否则 &amp;lt; 会先变成 < 再被当成实体。
mf_s3_xml_unescape() {
  sed -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&quot;/"/g' -e "s/&apos;/'/g" -e 's/&amp;/\&/g'
}

# url 编码：unreserved 与 /（路径分隔）保留，其余按字节 %XX。
mf_s3_urlencode() {
  local s=$1 out= c hex i
  LC_ALL=C
  for (( i=0; i<${#s}; i++ )); do
    c=${s:i:1}
    case "${c}" in
      [A-Za-z0-9.~_-]|/) out+=${c} ;;
      *) printf -v hex '%%%02X' "'${c}"; out+=${hex} ;;
    esac
  done
  printf '%s' "${out}"
}

mf_s3_list_buckets() {  # stdout：每行一个桶名（没有桶时无输出）
  local body
  if ! body=$(mf_s3_curl "${MF_S3_ENDPOINT}/"); then
    mf_die "列举桶失败（端点 ${MF_S3_ENDPOINT}）：端点不可达，或签名被拒"
  fi
  case "${body}" in
    *"<Error>"*) mf_die "列举桶返回错误：$(mf_s3_error_of "${body}")" ;;
  esac
  printf '%s' "${body}" | tr -d '\n' | sed 's#</Bucket>#\n#g' \
    | sed -n 's#.*<Name>\(.*\)</Name>.*#\1#p' | mf_s3_xml_unescape
}

# 键路径安全：备份目录里按 桶/键 落盘，含 .. 或空段的键会写到目录之外。
mf_s3_require_safe_key() {
  local key=$1 seg
  case "${key}" in
    '') mf_die "对象键为空（无法落盘/清单化）" ;;
    /*) mf_die "对象键以 / 开头，拒绝按路径落盘: ${key}" ;;
    *$'\n'*|*$'\r'*) mf_die "对象键含换行，无法清单化" ;;
  esac
  local IFS=/
  for seg in ${key}; do
    case "${seg}" in
      ''|.|..) mf_die "对象键含空段/./..，拒绝按路径落盘: ${key}" ;;
    esac
  done
}

# 内容寻址键（存储服务写的 objects/<xx>/<sha256>/<名>）：键里内嵌 sha256，可交叉校验字节。
mf_s3_key_sha256() {
  if [[ $1 =~ ^objects/[^/]+/([0-9a-f]{64})/ ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi
  # 必须显式 return 0：键不匹配这个布局时，[[ ]] 的假值会让调用处（ksha=$(...)）在 set -e 下中止整次备份。
  return 0
}

mf_s3_list_objects() {  # $1=桶 → TSV：key<TAB>size<TAB>etag<TAB>last_modified
  local bucket=$1 token="" body truncated
  while :; do
    if [ -n "${token}" ]; then
      body=$(mf_s3_curl -G --data-urlencode "continuation-token=${token}" \
        --data-urlencode "list-type=2" --data-urlencode "max-keys=${MF_S3_PAGE_SIZE}" \
        "${MF_S3_ENDPOINT}/${bucket}") || mf_die "列举对象失败（桶 ${bucket}，续传页）"
    else
      body=$(mf_s3_curl -G --data-urlencode "list-type=2" \
        --data-urlencode "max-keys=${MF_S3_PAGE_SIZE}" \
        "${MF_S3_ENDPOINT}/${bucket}") || mf_die "列举对象失败（桶 ${bucket} 不存在，或端点不可达）"
    fi
    case "${body}" in
      *"<Error>"*) mf_die "列举桶 ${bucket} 的对象返回错误：$(mf_s3_error_of "${body}")" ;;
      *"<ListBucketResult"*) ;;
      *) mf_die "列举桶 ${bucket} 的对象返回了非 S3 响应（$(printf '%s' "${body}" | head -c 120)）" ;;
    esac
    # 桶内对象可能远超一页：先按 </Contents> 切块，逐块抠 Key/Size/ETag/LastModified。
    # 空桶与"列举失败"必须区分开：这里任何异常都 mf_die，绝不降级成"0 个对象"。
    while IFS= read -r block; do
      case "${block}" in
        *"<Key>"*) ;;
        *) continue ;;
      esac
      printf '%s\n' "${block}" | awk '
        {
          key = ""; size = ""; etag = ""; lm = ""
          if (match($0, /<Key>[^<]*<\/Key>/))                   key  = substr($0, RSTART + 5,  RLENGTH - 11)
          if (match($0, /<Size>[0-9]+<\/Size>/))                size = substr($0, RSTART + 6,  RLENGTH - 13)
          if (match($0, /<ETag>[^<]*<\/ETag>/))                 etag = substr($0, RSTART + 6,  RLENGTH - 13)
          if (match($0, /<LastModified>[^<]*<\/LastModified>/)) lm   = substr($0, RSTART + 14, RLENGTH - 29)
          printf "%s\t%s\t%s\t%s\n", key, size, etag, lm
        }' | mf_s3_xml_unescape
    done < <(printf '%s' "${body}" | tr -d '\n' | sed 's#</Contents>#\n#g')
    truncated=$(printf '%s' "${body}" | tr -d '\n' | sed -n 's#.*<IsTruncated>\(.*\)</IsTruncated>.*#\1#p')
    token=$(printf '%s' "${body}" | tr -d '\n' | sed -n 's#.*<NextContinuationToken>\(.*\)</NextContinuationToken>.*#\1#p' | mf_s3_xml_unescape)
    if [ "${truncated}" = "true" ] && [ -n "${token}" ]; then
      continue
    fi
    break
  done
}

mf_s3_get_object() {  # $1=桶 $2=键 $3=落盘路径
  if ! mf_s3_curl -o "$3" "${MF_S3_ENDPOINT}/$1/$(mf_s3_urlencode "$2")"; then
    rm -f "$3"
    mf_die "下载对象失败: s3://$1/$2"
  fi
}

mf_s3_put_object() {  # $1=桶 $2=键 $3=本地文件
  mf_s3_curl -X PUT --upload-file "$3" "${MF_S3_ENDPOINT}/$1/$(mf_s3_urlencode "$2")" >/dev/null \
    || mf_die "上传对象失败: $3 → s3://$1/$2"
}

mf_s3_bucket_exists() {  # $1=桶；存在返回 0
  # 不能只看 curl 退出码：不带 --fail 时 HTTP 404 也是 0，会把"桶不存在"读成"存在"。
  local code
  code=$(mf_s3_curl -o /dev/null -I -w '%{http_code}' "${MF_S3_ENDPOINT}/$1") || return 1
  [ "$code" = "200" ]
}

mf_s3_make_bucket() {  # $1=桶
  mf_s3_curl -X PUT -o /dev/null "${MF_S3_ENDPOINT}/$1" || mf_die "创建桶失败: $1"
}

mf_s3_delete_object() {  # $1=桶 $2=键
  mf_s3_curl -X DELETE -o /dev/null "${MF_S3_ENDPOINT}/$1/$(mf_s3_urlencode "$2")" || mf_die "删除对象失败: s3://$1/$2"
}

mf_s3_delete_bucket() {  # $1=桶（必须已空）
  mf_s3_curl -X DELETE -o /dev/null "${MF_S3_ENDPOINT}/$1" || mf_die "删除桶失败: $1（桶未空？）"
}

mf_s3_object_size() {  # $1=桶 $2=键 → 字节数（走 HEAD，不下载本体；对象不存在/无权限时返回非零）
  # 同样不能只看退出码：404 的错误响应体也带 Content-Length，会读出一个假的"对象大小"。
  local hdr code n
  hdr=$(mf_s3_curl -I -D - -o /dev/null -w '\n%{http_code}' "${MF_S3_ENDPOINT}/$1/$(mf_s3_urlencode "$2")") || return 1
  code=$(printf '%s' "${hdr}" | tail -n1)
  [ "$code" = "200" ] || return 1
  n=$(printf '%s' "${hdr}" | tr -d '\r' | awk 'tolower($1)=="content-length:" {print $2}' | head -n1)
  printf '%s' "${n}"
}

# 逐桶对象数与总字节（只列举，不下载）：前置容量估算与"空桶"判据都用它。
# stdout：bucket<TAB>count<TAB>bytes，每桶一行。
mf_s3_totals() {
  local b count bytes
  while IFS= read -r b; do
    [ -n "${b}" ] || continue
    count=0
    bytes=0
    while IFS=$'\t' read -r _key size _etag _lm; do
      [ -n "${size}" ] || continue
      count=$(( count + 1 ))
      bytes=$(( bytes + size ))
    done < <(mf_s3_list_objects "${b}")
    printf '%s\t%s\t%s\n' "${b}" "${count}" "${bytes}"
  done < <(mf_s3_list_buckets)
}
