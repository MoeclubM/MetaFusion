#!/usr/bin/env bash
# ==============================================================================
# MetaFusion 极速部署与智能运维工具 (Smart Fast Deployment Tool)
# ==============================================================================

set -e
cd "$(dirname "$0")"

# --skip-version-check 是运维紧急开关（见 check_version_lock）：它可能出现在任意位置，
# 因此先把位置参数里的它摘掉，剩下的仍是 [action] [target]。
SKIP_VERSION_CHECK=0
POSITIONAL=()
for arg in "$@"; do
    case "$arg" in
        --skip-version-check) SKIP_VERSION_CHECK=1 ;;
        *) POSITIONAL+=("$arg") ;;
    esac
done
set -- "${POSITIONAL[@]}"

ACTION=${1:-"fast"}
TARGET=${2:-""}

# 版本 tag 的保留个数（每个镜像留几个可回退锚点）。tag 只是镜像的第二个名字，不额外占磁盘；
# 但名字会无限增长，所以在 tag_release_images 里撤掉更老的（同一份层数据仍在，容器用的
# :local 滚动标签从不参与清理）。要留更多历史就设 MF_IMAGE_TAG_KEEP。
IMAGE_TAG_KEEP=${MF_IMAGE_TAG_KEEP:-3}

# 自动定位 .env（项目根目录 ../.env 或当前 deploy/.env）
ENV_FILE=""
if [ -f "../.env" ]; then
  ENV_FILE="../.env"
elif [ -f ".env" ]; then
  ENV_FILE=".env"
fi

if [ -n "$ENV_FILE" ]; then
  COMPOSE_ENV="--env-file $ENV_FILE"
  echo "📦 使用环境文件: $ENV_FILE"
else
  COMPOSE_ENV=""
  echo "⚠️  未找到 .env，将依赖 docker-compose 内置默认值（仅适用于开发）"
  echo "   请执行: cp ../.env.example ../.env 并填入真实密钥"
fi

# 网关的 nginx.conf 是以文件挂载进容器的：compose 只看服务定义，不看被挂载文件的
# 内容，所以改完路由矩阵后 `up -d` 不会重建网关，必须显式 reload 才生效。
# 用 nginx -t 先校验再 reload，配置写错时保留旧配置继续服务，不会把入口打挂。
function reload_gateway() {
    if ! docker exec metafusion-gateway true >/dev/null 2>&1; then
        return 0
    fi
    # nginx.conf 是**单文件 bind mount**：绑的是 inode。git pull/reset 会用新文件替换旧文件，
    # 容器里挂的仍是旧 inode，此时 nginx -s reload 只会重新读旧内容——表现为"改了路由却不生效"。
    # 因此先按新文件重建容器，再做语法检查与重载。
    if [ -f "$(dirname "$0")/nginx.conf" ]; then
        docker compose $COMPOSE_ENV -f docker-compose.yml up -d --force-recreate --no-deps gateway >/dev/null 2>&1 || true
    fi
    if docker exec metafusion-gateway nginx -t >/dev/null 2>&1; then
        docker exec metafusion-gateway nginx -s reload >/dev/null 2>&1 && echo "🔄 网关已重建并重载路由矩阵"
    else
        echo "⚠️  网关配置校验失败：保留旧配置（运行 docker exec metafusion-gateway nginx -t 查看原因）"
    fi
}

# 兄弟仓库是构建输入：编排按 ../metafusion-* 的**当前检出**构建，而 deploy/versions.lock 记的是
# 上一次验证过的那次提交。不比对就会把没验证过的代码推上线，回滚时也说不清当时部署的是哪一份。
# 比对由 scripts/check_versions.py 提供（逐条 git rev-parse HEAD，兄弟目录缺席会 SKIP）。
# 紧急情况用 ./deploy.sh <action> --skip-version-check 显式跳过：跳过原因会打进日志，
# 不是静默放行。
function check_version_lock() {
    if [ "$SKIP_VERSION_CHECK" = "1" ]; then
        echo "⚠️  已跳过版本锁校验（--skip-version-check）：本次部署不保证兄弟仓库是 versions.lock 里的提交"
        return 0
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        echo "❌ 本机没有 python3，无法校验版本锁；确认环境后可用 --skip-version-check 显式跳过" >&2
        exit 1
    fi
    echo "🔒 校验部署版本锁 (deploy/versions.lock)..."
    if ! python3 ../scripts/check_versions.py; then
        echo "❌ 兄弟仓库与 deploy/versions.lock 不一致：先把锁刷到本次要部署的提交再继续" >&2
        echo "   紧急放行（会写进日志）：./deploy.sh $ACTION --skip-version-check" >&2
        exit 1
    fi
}

# /api/version 的构建期身份来源：把当前提交与版本交给 compose（backend 的 build args）。
# 只有构建期注入才靠得住——容器里没有 .git（.dockerignore 排除），运行期再读环境变量会随重启漂移。
# 刻意不标 dirty：部署树里有未提交文件是常态，标了几乎永远是 dirty，反而没人会看这一行。
function export_version_identity() {
    local root_dir sha tag
    root_dir="$(dirname "$0")/.."
    if [ -z "${METAFUSION_GIT_SHA:-}" ] && command -v git >/dev/null 2>&1; then
        sha=$(git -C "$root_dir" rev-parse --short=12 HEAD 2>/dev/null || true)
        [ -n "$sha" ] && export METAFUSION_GIT_SHA="$sha"
    fi
    if [ -z "${METAFUSION_VERSION:-}" ] && command -v git >/dev/null 2>&1; then
        tag=$(git -C "$root_dir" describe --tags --exact-match 2>/dev/null || true)
        [ -n "$tag" ] && export METAFUSION_VERSION="$tag"
    fi
    echo "🏷️  版本身份（写进 /api/version）：git=${METAFUSION_GIT_SHA:-unknown} version=${METAFUSION_VERSION:-unknown}"
}


# 每批部署给镜像补版本 tag。**没有版本 tag 就没有快速回退**：容器用的是滚动标签
# （metafusion-*:local 与编排生成的 deploy-<svc>:latest），下一次部署直接覆盖它们，
# 上一版镜像随即变成无主镜像被 prune 掉 —— v0.3.0 之前就是这样，回退只剩「按 tag 重建」（10-20 分钟）。
# 口径与 /api/version 的版本身份一致：METAFUSION_VERSION（git describe 的精确 tag），
# 没有 tag 时退回短 sha，保证每批都有锚点。回退命令见 docs/architecture/cutover-runbook.md。
function tag_release_images() {
    local ver="${METAFUSION_VERSION:-}"
    if [ -z "$ver" ] || [ "$ver" = "unknown" ]; then
        ver="${METAFUSION_GIT_SHA:-}"
    fi
    if [ -z "$ver" ]; then
        echo "⚠️  无法确定版本标识（既无 git tag 也无 sha）：跳过镜像版本 tag（本批没有可回退锚点）"
        return 0
    fi

    # 只给**本仓库/兄弟仓库构建的镜像**打 tag：仓库名要么是 metafusion-*（compose 里显式 image:
    # 的那几个服务），要么是 <compose 项目名>-*（frontend / docs / 三个管理台由 compose 生成
    # deploy-<svc>）。postgres / redis / nginx / rustfs / opensearch 是别人的发布物，给它们贴
    # 本项目的版本号等于把"这个 tag 代表一次发布"说成谎话，也会让保留策略去管别人的镜像；
    # 网关虽然用 nginx:1.25-alpine，但它的配置是 bind mount，本来就没有镜像可回退。
    local project="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
    local in_use imgs img repo tagged=0
    in_use="$(docker ps -a --format "{{.Image}}" | sort -u)"
    imgs="$(docker compose $COMPOSE_ENV -f docker-compose.yml ps -q 2>/dev/null | xargs -r docker inspect -f "{{.Config.Image}}" 2>/dev/null | sort -u)"
    if [ -z "$imgs" ]; then
        echo "⚠️  没读到本项目容器镜像：跳过镜像版本 tag"
        return 0
    fi
    for img in $imgs; do
        repo="${img%%:*}"
        [ -z "$repo" ] && continue
        case "$repo" in
            metafusion-*|"$project"-*) ;;
            *) continue ;;
        esac
        if ! docker image inspect "$img" >/dev/null 2>&1; then continue; fi
        if [ "$repo:$ver" != "$img" ]; then
            docker tag "$img" "$repo:$ver" >/dev/null 2>&1 && { echo "🏷️  镜像 tag：$img -> $repo:$ver"; tagged=$((tagged + 1)); }
        fi
        prune_release_tags "$repo" "$in_use"
    done
    echo "✅ 版本 tag 完成：$tagged 个镜像带 $ver（每个镜像保留最近 $IMAGE_TAG_KEEP 个版本）"
    echo "   回退：docker tag <repo>:<旧版本> <repo>:local && docker compose up -d --no-deps --force-recreate <svc>"
}

# 保留策略：每个镜像只留最近 IMAGE_TAG_KEEP 个版本 tag，更老的撤 tag（镜像层数据不动、
# 容器用的 :local / :latest 滚动标签永不参与）。候选只认「版本形态」的名字：vX.Y.Z 或 12 位短 sha。
function prune_release_tags() {
    local repo="$1" in_use="$2" i=0 t sorted
    # 判定用 bash 通配，不用 awk/grep 正则：目标机的 awk 是 mawk 1.3.4，**不支持 {n} 区间**，
    # 写 /:(v[0-9]|[0-9a-f]{12})$/ 这种正则会静默不匹配（首版就是这么漏掉清理的，实测才发现）。
    # 排序按镜像构建时间倒序（CreatedAt 字典序即时间序，构建全在同一台机器同一时区）。
    # sort -Vr 对 sha 无意义：sha 的字母序与新旧无关，2026-09-19 曾把刚打的本批锚判成"最老"
    # 全撤（10 个新锚 0 残留）。"构建时间新=最新"的反例在本流程不存在：版本 tag 只打给当前构建，
    # 从不给新镜像贴旧版本号。
    sorted="$(docker images --format "{{.Repository}}:{{.Tag}} {{.CreatedAt}}" "$repo" 2>/dev/null \
        | while IFS= read -r line; do
              t="${line%% *}"; created="${line#* }"
              case "$t" in
                  *:v[0-9]*|*:[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) printf '%s %s\n' "$created" "$t" ;;
              esac
          done | sort -r | while IFS= read -r cline; do printf '%s\n' "${cline##* }"; done)"
    for t in $sorted; do
        i=$((i + 1))
        [ "$i" -le "$IMAGE_TAG_KEEP" ] && continue
        case "$in_use" in
            *"$t"*) echo "   ↳ 保留 $t（正被容器使用，不撤）"; continue ;;
        esac
        docker rmi "$t" >/dev/null 2>&1 && echo "   ↳ 撤掉更老的版本 tag $t（只留最近 $IMAGE_TAG_KEEP 个）"
    done
}

# 迁移必须用**当前镜像里**的迁移器：迁移是编译进二进制的（embed），用运行中的旧容器
# 执行会报"已是最新"而漏掉新迁移。--entrypoint 覆盖服务入口（镜像是 /app/server，
# 直接 run 会把参数交给它而不是迁移器）；--no-deps 不连带拉起依赖，只跑这一个一次性容器。
#
# 第二个及以后的参数是**额外的 compose 文件**（如 -f docker-compose.prod.yml）：pull 路径上
# 要跑的是拉下来那份镜像里的迁移器，而不是本地那张旧标签。
function run_migrate() {
    local cmd=${1:-up}
    shift || true
    docker compose $COMPOSE_ENV -f docker-compose.yml "$@" run --rm --no-deps --entrypoint /app/migrate backend "$cmd"
}

# 部署流程里唯一的迁移入口：跑完 up 必须回读账本确认，读不出来、还有 PENDING 或出现 DIRTY
# 就非零退出。"迁移没跑却报部署成功"是必须避免的失败模式：compose run 只替换 CMD、不换
# ENTRYPOINT，少了 --entrypoint 参数会被交给 /app/server，一条迁移都不会执行
# （backend/Dockerfile 的 server 阶段是 ENTRYPOINT ["/app/server"]）。
function migrate_up_checked() {
    echo "🗄️  执行目录库版本化迁移..."
    run_migrate up "$@"

    local status
    if ! status=$(run_migrate status "$@"); then
        echo "❌ 迁移后读不到迁移账本：无法确认结构已落地，部署中止" >&2
        exit 1
    fi
    echo "$status"
    if printf '%s\n' "$status" | grep -q 'PENDING'; then
        echo "❌ 仍有未应用的迁移（上面标为 PENDING）：部署中止" >&2
        exit 1
    fi
    if printf '%s\n' "$status" | grep -q 'DIRTY'; then
        echo "❌ 存在脏迁移（上面标为 DIRTY）：先人工确认再部署" >&2
        exit 1
    fi
    if ! printf '%s\n' "$status" | grep -q 'APPLIED'; then
        echo "❌ 迁移账本里没有任何已应用版本：迁移未生效，部署中止" >&2
        exit 1
    fi
    echo "✅ 迁移已确认：账本无 PENDING / DIRTY"
}

function print_usage() {
    echo "================================================================="
    echo "  MetaFusion 极速部署与运维脚本"
    echo "================================================================="
    echo "用法: ./deploy.sh [action] [service_name]"
    echo ""
    echo "操作模式 (Actions):"
    echo "  fast [service]  - 增量极速更新指定服务 (默认)，自动复用构建缓存 (几秒内完成)"
    echo "  cutover         - 首次从单体切到拆分后的服务 (搬数据 → 换网关，只走一次)"
    echo "  retire          - 清理拆分前的遗留 schema 与临时表 (切流稳定后跑一次)"
    echo "  dev             - 启动热重载开发模式 (源码挂载，修改代码免构建秒级生效)"
    echo "  prod            - 完整生产模式冷启动"
    echo "  pull            - 拉取 GHCR 预构建镜像 (backend/frontend) 并启动；账号/互动/存储/文档站就地构建"
    echo "  migrate [cmd]   - 执行版本化数据库迁移 (up/down/status/force)"
    echo "  restart [svc]   - 快速重启容器 (不重编镜像)"
    echo "  prune           - 清理所有旧镜像与未使用的构建缓存 (释放磁盘)"
    echo "  logs [svc]      - 实时查看容器运行日志"
    echo "  status          - 查看全部容器健康状态"
    echo ""
    echo "全局开关:"
    echo "  --skip-version-check - 跳过 versions.lock 校验（仅紧急放行，日志会写明）"
    echo "================================================================="
}

case "$ACTION" in
    dev)
        echo "🚀 启动本地热重载开发模式 (Zero-Rebuild Dev Mode)..."
        export DOCKER_BUILDKIT=1
        docker compose $COMPOSE_ENV -f docker-compose.yml -f docker-compose.dev.yml up -d
        echo "✅ 开发环境已就绪！源码已挂载，代码修改即时热重载生效。"
        ;;

    fast)
        check_version_lock
        export_version_identity
        export DOCKER_BUILDKIT=1
        if [ -n "$TARGET" ]; then
            echo "⚡ 增量更新指定服务 [$TARGET]..."
            docker compose $COMPOSE_ENV build "$TARGET"
            docker compose $COMPOSE_ENV up -d --no-deps "$TARGET"
        else
            echo "⚡ 增量构建并更新全部服务 (复用 BuildKit 缓存)..."
            # 不带服务名即构建**所有**带 build 段的服务：拆分后子系统在兄弟仓库，
            # 只写 backend frontend 会让互动/存储/账号停留在旧镜像。
            docker compose $COMPOSE_ENV build
            docker compose $COMPOSE_ENV up -d --remove-orphans
        fi
        reload_gateway
        # 先补版本 tag 再清悬空层：本批镜像有了名字就不会被当成无主镜像清掉，
        # 也让"回退到上一版"变成换 tag + recreate（见 tag_release_images 的注释）。
        tag_release_images
        echo "🧹 自动清理悬空层..."
        docker image prune -f >/dev/null 2>&1 || true
        echo "✅ 极速部署完成！"
        ;;

    cutover)
        check_version_lock
        export_version_identity
        # 首次把实例从单体切到拆分后的服务：搬数据在前、换网关在后，顺序不可颠倒
        # （搬运必须在单体仍是唯一写入方时完成，见 docs/architecture/cutover-runbook.md）。
        # 日常迭代仍用 ./deploy.sh fast；本动作只走一次，回滚见手册第 1 章。
        export DOCKER_BUILDKIT=1
        echo "🏗️  构建全部服务镜像..."
        docker compose $COMPOSE_ENV -f docker-compose.yml build
        echo "🚀 启动基础设施 (Postgres / RustFS + 桶初始化)..."
        docker compose $COMPOSE_ENV -f docker-compose.yml up -d postgres rustfs
        echo "🚀 启动各子系统 (账号 / 互动 / 存储 / 目录)..."
        docker compose $COMPOSE_ENV -f docker-compose.yml up -d auth community storage backend
        migrate_up_checked
        echo "📦 把主仓库旧表搬进 community schema（幂等，可重复运行补增量）..."
        docker compose $COMPOSE_ENV -f docker-compose.yml run --rm community-migrate -direction forward
        echo "🌐 拉起前端 / 文档站 / 网关（网关等各上游 /ready 通过后才开门）..."
        docker compose $COMPOSE_ENV -f docker-compose.yml up -d --remove-orphans
        reload_gateway
        echo "🧹 自动清理悬空层..."
        docker image prune -f >/dev/null 2>&1 || true
        echo "✅ 切流完成；自检：GATEWAY=https://<host> ../metafusion-api-gateway/scripts/cutover-check.sh"
        ;;

    retire)
        # 切流稳定后执行一次：清掉拆分前的遗留 schema 与手工迁移的临时表。
        # 删除前由 SQL 自身核对"目标行数不少于源表行数"，搬不全就中止并回滚整个事务。
        echo "🧹 清理拆分前的遗留结构 (modules / media / catalog.favorites / 临时备份表)..."
        docker compose $COMPOSE_ENV exec -T postgres sh -c \
            'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f -' \
            < sql/retire-legacy-schemas.sql
        echo "✅ 清理完成（剩余 schema 见上面的核对输出）"
        ;;

    prod)
        check_version_lock
        export_version_identity
        echo "🏭 启动生产集群模式..."
        export DOCKER_BUILDKIT=1
        docker compose $COMPOSE_ENV -f docker-compose.yml build backend
        echo "🚀 启动数据库与核心基础设施 (Postgres / RustFS)..."
        docker compose $COMPOSE_ENV up -d postgres rustfs
        migrate_up_checked
        docker compose $COMPOSE_ENV up -d --build --remove-orphans
        reload_gateway
        tag_release_images
        docker image prune -f >/dev/null 2>&1 || true
        echo "✅ 生产环境已启动！"
        ;;

    pull)
        check_version_lock
        export_version_identity
        echo "📦 拉取预构建生产容器镜像 (GHCR)..."
        # --ignore-buildable：账号/互动/存储仍从兄弟仓库构建，镜像名是本地标签
        #   （metafusion-auth:local 之类），去 registry 拉必然失败；跳过它们，
        #   只拉 prod 覆盖里真正预构建的 backend / frontend。
        # --ignore-pull-failures：单个镜像缺席（例如尚未发布的 docs-site）不该让整条
        #   命令以非零码中断——后面的 up -d 会用本地镜像或就地构建兜底。
        docker compose $COMPOSE_ENV -f docker-compose.yml -f docker-compose.prod.yml pull --ignore-buildable --ignore-pull-failures
        echo "🚀 启动数据库与核心基础设施..."
        docker compose $COMPOSE_ENV up -d postgres rustfs
        migrate_up_checked -f docker-compose.prod.yml
        docker compose $COMPOSE_ENV -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans
        echo "✅ 生产镜像拉取与启动完成！"
        ;;

    migrate)
        CMD=${TARGET:-"up"}
        if [ "$CMD" = "up" ]; then
            # up 走带校验的入口；down/status/force 是运维手工动作，保持原样。
            migrate_up_checked
        else
            echo "🗄️ 执行数据库版本化迁移 (mf-migrate $CMD)..."
            run_migrate "$CMD"
        fi
        ;;

    restart)
        if [ -n "$TARGET" ]; then
            echo "🔄 重启服务 [$TARGET]..."
            docker compose $COMPOSE_ENV restart "$TARGET"
        else
            echo "🔄 重启全部服务..."
            docker compose $COMPOSE_ENV restart
        fi
        echo "✅ 重启完毕！"
        ;;

    prune)
        echo "🧹 正在深度清理 Docker 磁盘占用..."
        docker image prune -f
        docker builder prune -f --keep-storage 1GB
        echo "📊 当前 Docker 存储概览:"
        docker system df
        ;;

    logs)
        if [ -n "$TARGET" ]; then
            docker compose $COMPOSE_ENV logs -f "$TARGET"
        else
            docker compose $COMPOSE_ENV logs -f
        fi
        ;;

    status)
        docker compose $COMPOSE_ENV ps
        ;;

    help|--help|-h)
        print_usage
        ;;

    *)
        echo "❌ 未知命令: $ACTION"
        print_usage
        exit 1
        ;;
esac