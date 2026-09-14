#!/usr/bin/env bash
# ==============================================================================
# MetaFusion 极速部署与智能运维工具 (Smart Fast Deployment Tool)
# ==============================================================================

set -e
cd "$(dirname "$0")"

ACTION=${1:-"fast"}
TARGET=${2:-""}

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
    echo "  pull            - 直接拉取 GHCR 预构建生产镜像并启动 (免本地编译)"
    echo "  migrate [cmd]   - 执行版本化数据库迁移 (up/down/status/force)"
    echo "  restart [svc]   - 快速重启容器 (不重编镜像)"
    echo "  prune           - 清理所有旧镜像与未使用的构建缓存 (释放磁盘)"
    echo "  logs [svc]      - 实时查看容器运行日志"
    echo "  status          - 查看全部容器健康状态"
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
        export DOCKER_BUILDKIT=1
        if [ -n "$TARGET" ]; then
            echo "⚡ 增量更新指定服务 [$TARGET]..."
            docker compose $COMPOSE_ENV build "$TARGET"
            docker compose $COMPOSE_ENV up -d --no-deps "$TARGET"
        else
            echo "⚡ 增量构建并更新全部核心应用服务 (复用 BuildKit 缓存)..."
            docker compose $COMPOSE_ENV build backend frontend
            docker compose $COMPOSE_ENV up -d --remove-orphans
        fi
        echo "🔄 刷新网关 DNS 路由..."
        docker exec metafusion-gateway nginx -s reload >/dev/null 2>&1 || true
        echo "🧹 自动清理悬空层..."
        docker image prune -f >/dev/null 2>&1 || true
        echo "✅ 极速部署完成！"
        ;;

    cutover)
        # 首次把实例从单体切到拆分后的服务：搬数据在前、换网关在后，顺序不可颠倒
        # （搬运必须在单体仍是唯一写入方时完成，见 docs/architecture/cutover-runbook.md）。
        # 日常迭代仍用 ./deploy.sh fast；本动作只走一次，回滚见手册第 1 章。
        export DOCKER_BUILDKIT=1
        echo "🏗️  构建全部服务镜像..."
        docker compose $COMPOSE_ENV -f docker-compose.yml build
        echo "🚀 启动基础设施 (Postgres / Redis / RustFS + 桶初始化)..."
        docker compose $COMPOSE_ENV -f docker-compose.yml up -d postgres redis rustfs storage-init
        echo "🚀 启动各子系统 (账号 / 互动 / 存储 / 目录)..."
        docker compose $COMPOSE_ENV -f docker-compose.yml up -d auth community storage backend
        echo "🗄️  执行目录库版本化迁移..."
        docker compose $COMPOSE_ENV -f docker-compose.yml exec -T -e DB_HOST=postgres backend /app/migrate up
        echo "📦 把主仓库旧表搬进 community schema（幂等，可重复运行补增量）..."
        docker compose $COMPOSE_ENV -f docker-compose.yml run --rm community-migrate -direction forward
        echo "🌐 拉起前端 / 文档站 / 网关（网关等各上游 /ready 通过后才开门）..."
        docker compose $COMPOSE_ENV -f docker-compose.yml up -d --remove-orphans
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
        echo "🏭 启动生产集群模式..."
        export DOCKER_BUILDKIT=1
        docker compose $COMPOSE_ENV -f docker-compose.yml build backend
        echo "🚀 启动数据库与核心基础设施 (Postgres / Redis / RustFS)..."
        docker compose $COMPOSE_ENV up -d postgres redis rustfs
        echo "🗄️ 执行数据库版本化迁移 (Pre-deployment Migrate Up)..."
        docker compose $COMPOSE_ENV exec -T -e DB_HOST=postgres backend /app/migrate up || \
        docker compose $COMPOSE_ENV run --rm backend /app/migrate up
        docker compose $COMPOSE_ENV up -d --build --remove-orphans
        docker image prune -f >/dev/null 2>&1 || true
        echo "✅ 生产环境已启动！"
        ;;

    pull)
        echo "📦 拉取预构建生产容器镜像 (GHCR)..."
        docker compose $COMPOSE_ENV -f docker-compose.yml -f docker-compose.prod.yml pull
        echo "🚀 启动数据库与核心基础设施..."
        docker compose $COMPOSE_ENV up -d postgres redis rustfs
        echo "🗄️ 执行数据库版本化迁移..."
        docker compose $COMPOSE_ENV -f docker-compose.yml -f docker-compose.prod.yml exec -T -e DB_HOST=postgres backend /app/migrate up || \
        docker compose $COMPOSE_ENV -f docker-compose.yml -f docker-compose.prod.yml run --rm backend /app/migrate up
        docker compose $COMPOSE_ENV -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans
        echo "✅ 生产镜像拉取与启动完成！"
        ;;

    migrate)
        CMD=${TARGET:-"up"}
        echo "🗄️ 执行数据库版本化迁移 (mf-migrate $CMD)..."
        docker compose $COMPOSE_ENV exec -T -e DB_HOST=postgres backend /app/migrate "$CMD" || \
        docker compose $COMPOSE_ENV run --rm backend /app/migrate "$CMD"
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
