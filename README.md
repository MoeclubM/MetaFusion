# MetaFusion — 高质量多媒介资产与流媒体平台

> **生产级 · 图书馆级 FRBR 编目 · PB 级对象存储 · 自适应切片流媒体**

---

## 🌟 核心特性

- **📚 图书馆级 FRBR 编目**：`作品 Work → 版本 Release → 载体 Medium → 条目 Track → 资产 Asset` 五级模型，支持中图分类法 (CLC)、ISBN/ISRC、HDR/杜比/无损规格、CUE 分轨等深度元数据。
- **⚡ PB 级双轨存储**：控制面与数据面分离，客户端经预签名 URL 直传 MinIO/S3 并发分片，绕过业务服务；全文件 SHA-256 秒传去重。
- **🎬 多媒介异步转码**：
  - 影视/动画 — 自适应 HLS + 雪碧图 Seek 预览
  - Hi-Res 音频 — 320k 预览流 + 全局持久化播放底栏
  - 图书/漫画 — EPUB/PDF 流式阅读 + 渐进式 WebP 双页阅览
- **🎟️ 邀请制社区**：邀请链防女巫，注册/是否需邀请码由后台 `system_settings` 动态开关。
- **🚀 渐进式部署**：单机 `docker compose up -d` 一键拉起；转码 Worker 与存储可平滑水平扩展至 K8s + Ceph/R2。

---

## 🏗️ 架构拓扑

```
[ Next.js 15 前端 (含 /admin 后台) ] ──> [ Nginx 网关 :80/:443 ]
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
        [ Go 单体 API :8080 ]                      [ MinIO / S3 :9000 ]
          ├── PostgreSQL 16 (FRBR 元数据)            ├── metafusion-master  (原档冷桶)
          ├── Elasticsearch 8 (检索)                  └── metafusion-preview (切片热桶)
          └── Redis 7 (缓存 + Asynq 队列)
                    │
                    ▼
        [ Asynq Worker : FFmpeg / libvips / mediainfo ]
```

---

## 🚀 快速启动

### 1. 准备环境

- Docker Engine ≥ 26 与 Docker Compose ≥ 2.20
- Windows 用户建议使用 WSL2 内的 Docker，或通过 `deploy/deploy.ps1`

### 2. 克隆与配置

```bash
git clone https://github.com/<your-org>/metafusion.git
cd metafusion
cp .env.example .env
# 编辑 .env，填入强随机值：
#   DB_PASSWORD / MINIO_ROOT_PASSWORD / JWT_SECRET 必须修改
# 生成 JWT 示例： openssl rand -base64 32
```

`.env.example` 仅为模板，`JWT_SECRET` / `DB_PASSWORD` / `MINIO_ROOT_PASSWORD` 必须在 `.env` 中覆盖真实值；`docker-compose.yml` 对这三项使用 `${VAR:?must be set}` 强制校验，未设置则启动失败（避免以弱默认值运行）。

### 3. 一键启动

```bash
# Linux / macOS / WSL
docker compose -f deploy/docker-compose.yml up -d

# 或使用一键脚本（自动走 BuildKit 缓存、更新网关、清理悬空层）
bash deploy/deploy.sh fast        # 增量极速更新
bash deploy/deploy.sh dev         # 热重载开发模式（源码挂载）
bash deploy/deploy.sh prod        # 冷启动生产模式

# Windows PowerShell（自动将路径转为 WSL 路径）
.\deploy\deploy.ps1 fast
.\deploy\deploy.ps1 dev
```

### 4. 访问

- **Web 前端**：`http://localhost`（由 `HTTP_PORT` 控制，默认 80；Windows 开发建议 8000）
- **MinIO 控制台**：`http://localhost:9001`（账号/密码见你填入的 `.env`）
- **初始管理员**：部署后由 `02_seed.sql` 创建，**首次登录后请立即修改密码**（默认密码仅用于本地开发，文档不固化明文）。
- **邀请码**：由管理员在 `/admin` → 系统设置 中生成/配置，创世码仅在种子数据中用于本地启动。

---

## 📁 目录结构

```
MetaFusion/
├── backend/               # Go 1.22 服务与 Worker
│   ├── cmd/server/        # API 入口
│   ├── cmd/worker/        # Asynq 转码入口
│   ├── internal/
│   │   ├── auth/          # 认证 / 邀请 / JWT
│   │   ├── catalog/       # FRBR 编目与货架
│   │   ├── community/     # 论坛 (Discourse 风格 ForumPost)
│   │   ├── storage/       # S3 预签名与秒传
│   │   ├── transcoder/    # FFmpeg 管线
│   │   ├── search/        # Elasticsearch 检索
│   │   ├── models/        # GORM 模型
│   │   ├── config/        # 环境配置（无硬编码敏感默认值）
│   │   └── database/      # 连接池与迁移
│   └── Dockerfile         # 多阶段构建 server / worker
├── frontend/              # Next.js 15 前端（含 /admin 管理后台）
│   ├── src/app/           # 路由（home/explore/works/releases/artists/community/admin 等）
│   ├── src/components/    # 播放器、上传、编辑器等
│   ├── src/lib/           # api / auth / player 等
│   └── Dockerfile
├── deploy/                # 部署编排
│   ├── docker-compose.yml      # 生产编排（单机全栈）
│   ├── docker-compose.dev.yml  # 开发覆盖（热重载）
│   ├── nginx.conf              # 网关路由 (/api/* → backend, /* → frontend)
│   ├── deploy.sh / deploy.ps1  # 极速运维脚本
│   └── init_db/                # 01_schema.sql … 16_*.sql
├── docs/
│   └── requirements.md    # 需求与访问模型（元数据开放 / 媒体受控）
└── .github/workflows/     # CI / Dependabot / CodeQL
```

> 历史遗留的顶层 `admin/` 独立应用已合并至 `frontend/src/app/admin`，`deploy/docker-compose.yml` 已移除 `admin-frontend` 服务；`frontend/src/app/upload` 与 `/submit` 已通过 `next.config.mjs redirects` 统一至 `/contribute`。

---

## 🔐 环境变量与安全

| 变量 | 说明 | 示例 |
|---|---|---|
| `DB_PASSWORD` | PostgreSQL 密码 | `openssl rand -base64 24` |
| `MINIO_ROOT_PASSWORD` | MinIO 密码 (≥16 字符) | 同上 |
| `JWT_SECRET` | JWT 签名密钥 (≥32 字符) | `openssl rand -base64 32` |
| `HTTP_PORT` / `HTTPS_PORT` | 网关映射端口 | `80` / `443` |
| `S3_PUBLIC_ENDPOINT` | 浏览器直传用公网端点 | `http://localhost:9000` |

- 永远不要提交 `.env`；模板见 `.env.example`，生产值通过宿主机环境或 Docker secrets 注入。
- Nginx 默认放行 `/api/*` 与 `/*`，预览切片 `/storage/preview/*` 当前由 MinIO 托管，生产建议将其切换为需鉴权的预签名链路（见 `docs/requirements.md` MEDIA-02）。
- Elasticsearch 默认 `xpack.security.enabled=false` 仅适用于本地单机；公网部署请开启认证或置于内网。

---

## 🛠️ 开发

```bash
# 后端（需 Go 1.22）
cd backend && go mod tidy && go run ./cmd/server

# 前端（需 Node 20）
cd frontend && npm install && npm run dev

# 热重载全栈（WSL / Linux）
bash deploy/deploy.sh dev
```

---

## 📈 演进路线

1. **存储**：MinIO → Ceph / S3 / R2，配置生命周期冷热分层。
2. **转码**：Worker 部署至 K8s + KEDA 按队列深度自动扩缩，GPU 节点可选。
3. **元数据**：PostgreSQL 主从 + Citus 分片，ES 集群化。

---

## 📄 许可

见 [LICENSE](./LICENSE)。
