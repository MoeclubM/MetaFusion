---
title: "快速开始"
description: "本地一键启动、账号注册、首次浏览与播放。"
order: 2
group: "start"
---

# 快速开始

## 1. 本地一键启动（维护者/自托管）

```bash
git clone https://github.com/MoeclubM/MetaFusion.git
cd MetaFusion
cp .env.example .env
# 编辑 .env：务必覆盖 DB_PASSWORD / MINIO_ROOT_PASSWORD / JWT_SECRET
# 生成示例：openssl rand -base64 32

# Linux / macOS / WSL
docker compose -f deploy/docker-compose.yml up -d
# 或脚本
bash deploy/deploy.sh fast   # 增量极速更新
bash deploy/deploy.sh dev    # 热重载开发（源码挂载）
bash deploy/deploy.sh prod   # 冷启动生产

# Windows PowerShell
.\deploy\deploy.ps1 fast
```

访问：

- Web 前端 `http://localhost`（`HTTP_PORT` 控制）
- 文档站 `http://localhost/docs`（由网关代理至 docs-site:3001）
- MinIO 控制台 `http://localhost:9001`
- API `http://localhost/api/v1/openapi.json`

> `deploy/docker-compose.yml` 对 `DB_PASSWORD` / `MINIO_ROOT_PASSWORD` / `JWT_SECRET` 使用 `${VAR:?must be set}` 强校验，未设置则启动失败，避免以弱默认值运行。

## 2. 注册与登录

1. 打开 `/login`，根据页面的开关提示决定是否需要邀请码（见 [认证与 PAT](/docs/api-auth)）。
2. `GET /api/v1/auth/settings` 对游客公开，前端表单据此动态渲染。
3. 登录成功获得 JWT（7 天），写入 `Authorization: Bearer <JWT>`。

本地种子数据会在 `init_db/02_seed.sql` 创建初始管理员，**首次登录请立即修改密码**。

## 3. 首次浏览（无需登录）

- 首页 `/`：终端式搜索框直接跳至 `/explore?q=...`
- 探索 `/explore`：按 `media_type`（music/anime/game/literature）、分类、标签、排序筛选
- 详情：`/works/:id`、`/releases/:id`、`/artists/:id` 均对游客开放

## 4. 首次播放/下载（需登录）

- 未登录点击播放/下载，前端拦截并弹出登录（`AuthGate` 仅拦截 L1 交互，不全站强制登录）
- 登录后：音频走 `GlobalAudioPlayer` 底栏，视频走 HLS，`GET /storage/download/:asset_id` 返回 2 小时预签名 URL

## 5. 开发者 30 秒

```bash
curl "/api/v1/search?q=攻壳机动队&type=work&limit=3" -H "User-Agent: MyApp/1.0 (you@example.com)"
curl "/api/v1/catalog/works/<id>?inc=releases+artists" -H "User-Agent: MyApp/1.0 (you@example.com)"
```

更多见 [API 概览](/docs/api-overview)。

## 常见坑

- **ES 未就绪**：搜索会自动降级为 SQL `ILIKE`，不阻塞浏览
- **预览 401**：确认已登录且 `Authorization` 透传到 `/storage/preview/*`
- **MinIO 桶 public**：`metafusion-preview` 的 `anonymous set download` 仅为过渡，生产需收紧为预签名
