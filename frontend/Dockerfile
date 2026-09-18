# syntax=docker/dockerfile:1
# ==============================================================================
# MetaFusion Frontend - Next.js standalone on Bun 1.4 (Fast BuildKit Cache)
# ==============================================================================
FROM oven/bun:1.4-alpine AS base

FROM base AS deps
WORKDIR /app
# Bun 兼容 npm 锁文件，优先使用 bun.lockb
# 锁文件必须一起 COPY：库里入的是 bun.lock（bun 1.2+ 的文本格式），原来的 glob 写的是
# bun.lockb*（匹配不到 bun.lock），于是镜像每次都在没有锁的情况下重新解析依赖树——
# 同一个提交可能装出不同的传递依赖。bun 在没有锁时会照旧装最新满足版本（Dockerfile 末尾
# 的 || bun install 保留为兜底）。
COPY package.json bun.lock* ./
RUN --mount=type=cache,target=/root/.bun \
    bun install --frozen-lockfile 2>/dev/null || bun install

FROM base AS builder
WORKDIR /app
ARG BACKEND_ORIGIN=http://backend:8080
ENV BACKEND_ORIGIN=$BACKEND_ORIGIN
# NEXT_PUBLIC_* 会被 Next 在**构建期**内联进产物，因此只能走 build arg（运行期 env 无效）。
# 留空 = 各服务的页面入口退回同源路径（现状）；服务自带 UI（审计 D1）后在编排里传值。
ARG NEXT_PUBLIC_AUTH_URL=
ARG NEXT_PUBLIC_FORUM_URL=
ARG NEXT_PUBLIC_RESOURCE_STATION_URL=
ARG NEXT_PUBLIC_STORAGE_URL=
ARG NEXT_PUBLIC_DOCS_URL=
ENV NEXT_PUBLIC_AUTH_URL=$NEXT_PUBLIC_AUTH_URL
ENV NEXT_PUBLIC_FORUM_URL=$NEXT_PUBLIC_FORUM_URL
ENV NEXT_PUBLIC_RESOURCE_STATION_URL=$NEXT_PUBLIC_RESOURCE_STATION_URL
ENV NEXT_PUBLIC_STORAGE_URL=$NEXT_PUBLIC_STORAGE_URL
ENV NEXT_PUBLIC_DOCS_URL=$NEXT_PUBLIC_DOCS_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1
# Bun 1.4 原生跑 Next 构建（比 Node 快 3-5 倍）
RUN --mount=type=cache,target=/app/.next/cache \
    bun run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
RUN mkdir -p .next && chown nextjs:nodejs .next
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
# Next standalone 的 server.js 为 Node 产物，Bun 可直接以 Node 兼容模式运行
CMD ["bun", "server.js"]
