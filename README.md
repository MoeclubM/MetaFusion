# <img src="frontend/public/mark.svg" width="28" height="28" alt="MetaFusion"/> MetaFusion

<p align="center">
  <strong>全球化开放元数据与高保真多媒介典藏协作平台</strong><br/>
  电影 · 剧集 · 动漫 · 音乐 · 有声书 · 图书 · 漫画 · 画册 — 一处归档，全域互联，跨端畅播
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-black?style=flat-square" alt="License"/></a>
  <img src="https://img.shields.io/badge/Go-1.25-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go"/>
  <img src="https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js&logoColor=white" alt="Next.js"/>
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/OpenSearch-2.14-005ECC?style=flat-square&logo=opensearch&logoColor=white" alt="OpenSearch"/>
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker"/>
  <img src="https://img.shields.io/badge/i18n-zh--CN%20%7C%20en--US-blue?style=flat-square" alt="i18n"/>
</p>

<p align="center">
  <a href="#-设计理念与定位">设计理念</a> •
  <a href="#-核心架构与特性">核心特性</a> •
  <a href="#-系统架构全景">架构全景</a> •
  <a href="#-快速上手与部署">部署指南</a> •
  <a href="#-开放-api-与-agent-集成">API 与 Agent</a> •
  <a href="docs/requirements.md">产品需求文档 (PRD)</a>
</p>

---

## 📖 平台定位

> **「元数据全量开放，高保真媒体安全受控」**  
> MetaFusion 将**国家图书馆级的严谨编目标准**与**现代云原生流媒体的高效体验**融为一体。无论是影视 4K 原盘、黑胶无损抓轨，还是绝版同人漫画与典藏画集，都能在统一的 IFLA LRM 实体知识网络中被精确描述、拓扑关联、版本溯源与一键流式点播。

---

## ✨ 核心特性

### 1. 🏛️ 国际图书馆级 LRM 混合编目模型
- **固定八实体骨架**：`Agent（责任者）· Collection（集合）· Work（作品）· ContentUnit（内容单元）· Expression（内容表达）· Release（发行版）· Medium（物理/数字载体）· Track（收录位置）`，资产文件（AssetFile）独立承载哈希与绑定。
- **纯净实体题名**：作品主标题坚决剥离季数、介质、规格等非本质限定词；版本与载体规格由 Release / Medium 精确承载，杜绝重复冗余。
- **自由标签与虚拟货架**：彻底废弃传统死板的单一树状分类，由「形态（Format）+ 制作媒介（Medium）+ 流派（Genre）+ 企划宇宙（Theme）」动态聚合生成虚拟货架。
- **自适应封面与多语言回退链**：支持 1:1、2:3、3:4 自然宽高比封面与自适应渲染；基于 `work_translations` 构建多语言回退链（`User Locale → en-US → original_language → Default`）。

### 2. 🔐 会话认证与访问控制
- **服务端会话 + RS256 访问令牌**：账号与令牌由独立服务 `metafusion-auth`（`auth` schema）负责——登录签发 RS256 JWT（默认 15 分钟）并写入 HttpOnly Cookie `mf_session`，`POST /api/auth/refresh` 轮转会话，`POST /api/auth/logout-all` 吊销全部会话；目录侧只做**验签**，不保存账号数据、不查对方表。
- **令牌密钥（环境变量）**：`AUTH_JWT_PRIVATE_KEY` 为 PKCS#1/PKCS#8 PEM（或其 base64）RSA 私钥，**目录与账号服务共用同一把**（切流后由账号服务签发、其余服务只验签），未配置时生成进程内临时密钥（重启即失效）；`AUTH_JWT_ISSUER`（默认 `https://findverse.cc/api`）与 `AUTH_JWT_AUDIENCE`（默认 `metafusion`）写入令牌声明。注意：无状态令牌在 `logout-all` 后仍有最长 15 分钟的验签残余窗口，强吊销场景等待会话过期或更换密钥。
- **OAuth 2.0 / OIDC 接入**：由账号服务提供 `/api/oauth/authorize`、`/api/oauth/token`、`/api/oauth/userinfo`、
  `/.well-known/openid-configuration` 与 `/api/oidc/jwks`（其他服务用 JWKS 本地验签）。
- **规划中（未实现）**：Access/Refresh 双 Token 轮转、基于 Redis 的令牌黑名单、个人访问令牌（PAT）——当前均无对应实现，请勿据此开发。
- **文件访问控制**：文件与绑定由独立服务 `metafusion-storage` 负责（`/api/storage/*`）；
  读取口径只有一条——上传者本人或管理员直通，其余人只要任一绑定目标实体可见即可读，
  下载、元数据读取与哈希校验共用该判定。

### 3. 🚀 云原生媒体处理与存储
- **S3 兼容对象存储 (RustFS)**：由存储服务写入 RustFS（`STORAGE_S3_*`），按 sha256 内容寻址与秒传去重，
  支持分片预签名直传与服务端流式上传兜底；元数据与物理资产分离，目录侧不保存物理路径。
- **数据库检索**：`GET /api/catalog/entities?q=...` 由 PostgreSQL 匹配题名与多语言文档（`ILIKE` / 全文索引），OpenSearch 2.14 容器已随 Compose 部署，但**当前 Go 代码尚未接入客户端，规划中的多语言分词与 Facet 聚合未生效**。
- **不做转码（明确取舍）**：不生成 HLS 切片、预览音频、波形图或缩略图；存储服务只收原始文件、做内容寻址与受控下载。
  原 `media` 模块（`ffprobe` 探针、预览转码）随模块层退役，不再补。

### 4. 🗄️ 独立版本化数据库迁移与运维治理
- **独立迁移引擎 (`mf-migrate`)**：自研 Go 原生数据库迁移工具，集成 PostgreSQL Advisory Lock 机制，彻底杜绝多副本部署时的并发迁移竞争。
- **无缝冷热启动**：支持 `up`、`down`、`status`、`force` 命令行管理，镜像内置嵌入式 SQL 脚本，部署前后自动完成无损版本升降级。
- **单端口边缘网关**：内置优化配置的 Nginx 边缘网关，对外仅需暴露单端口（默认 `10100`），无缝兼容宿主机外部反向代理（Nginx / Caddy / Cloudflare）接管 HTTPS。

---

## 🏗️ 系统架构全景：元数据目录主系统 + 独立子系统

本仓库收敛为**元数据目录 + 前端 + 文档站 + 一键部署编排**。账号、互动、存储已拆成独立服务仓库，
由边缘网关按 `/api/*` 前缀分流；各服务各自持有自己的 schema，不建跨 schema 外键、不 JOIN 别人的表，
跨服务只按实体 UUID 走 HTTP 契约。

### 1. 仓库内实际组件 (Repository Components)

| 组件 | 实现位置 | 定位 | 核心职责 |
|---|---|---|---|
| **元数据目录** | `backend/internal/catalog`、`backend/cmd/server` | **主系统** | 八大固定实体骨架、动态定义引擎、关系图谱、版本对比、修订历史、`/api/exchange/*` 导入导出 |
| **前端** | `frontend/` | 展示层 | Next.js 主站与管理中台 |
| **文档站** | 独立仓库 `../metafusion-docs` | 展示层 | VitePress 静态文档站（唯一源，本仓库不再存放 doc 页面） |
| **部署编排** | `deploy/`（`docker-compose.yml`、`nginx.conf`、`deploy.sh`、`sql/`） | 一键部署 | 单端口边缘网关、全部服务编排、切流/回滚与遗留结构清理 |
| **独立子系统** | `../metafusion-auth`、`../metafusion-community`、`../metafusion-storage`、`../metafusion-api-gateway` | 兄弟仓库 | 账号与 RS256 令牌、论坛与互动记录、文件与内容寻址直传、路由矩阵 |

> **解耦保障**：目录库只存实体本体与关系图谱，**不持有物理文件路径或社区帖子**；各服务的表在自己的 schema 里，
> 互相只按实体 UUID 走 HTTP。目录服务停摆不影响互动/存储自身数据的完整性，反之亦然。
> 边界与迁移顺序见 [子系统拆分与迁移契约](docs/architecture/service-split-migration.md)，
> 切流与回滚见 [切流手册](docs/architecture/cutover-runbook.md)。

### 2. 请求拓扑

```
                    [ 客户端 / Web 前端 / 移动端 / 自动化 Agent ]
                                      │
                                      ▼
                          ┌─────────────────────────┐
                          │  Nginx 边缘网关 (单端口) │  按前缀分流；TLS 由外层反代接管
                          └────────────┬────────────┘
        ┌───────────────┬──────────────┼───────────────┬────────────────┐
        ▼               ▼              ▼               ▼                ▼
  /api/catalog/*   /api/auth/*  /api/community/*  /api/storage/*    前端 / 文档站
   元数据目录        账号服务        互动服务         存储服务        Next.js / VitePress
        │               │              │               │
        └───────────────┴──── PostgreSQL 16 ────┬──────┘
                          catalog / auth / community / storage 四个 schema
                                                ├──── RustFS (S3 兼容，仅内网可达；桶由存储服务启动时自建)
                                                └──── Redis / OpenSearch (常驻但尚未接线，见切流手册第 4 节)
```

> 各服务仓库的当前落地状态与「子项目各司其职」的边界，见
> [子系统拆分与迁移契约](docs/architecture/service-split-migration.md) 与
> [多项目解耦规范](docs/architecture/multi-project-decoupling-spec.md)。

---

## 🛠️ 技术栈清单

- **后端核心 (Backend)**：Go 1.25, Gin, Golang-JWT/v5（对象存储走 S3 协议，客户端库为 minio-go——它只是 S3 SDK，服务端是 RustFS）
- **前端系统 (Frontend)**：Next.js 14 (App Router), React 18, Tailwind CSS, Lucide Icons, TypeScript
- **文档站点 (Docs Site)**：VitePress 静态站 (SSG)
- **数据库 (Storage & DB)**：PostgreSQL 16, Redis 7 (Alpine，Compose 已部署；Go 代码尚未接入), RustFS (S3-compatible Object Storage)
- **检索引擎 (Search Engine)**：OpenSearch 2.14.0（Compose 已部署；Go 代码尚未接入，当前检索走 PostgreSQL）
- **媒体处理**：不做转码（无 FFmpeg 依赖）；上传/下载契约见 [资源上传与下载](https://github.com/MoeclubM/metafusion-docs/blob/main/docs/upload-download.md)
- **容器与网关 (Infra)**：Docker, Docker Compose v2, Nginx 1.25 Alpine

---

## 🚀 快速上手与部署

### 1. 环境准备
- 操作系统：Linux / macOS / Windows (WSL2)
- 运行依赖：[Docker](https://docs.docker.com/get-docker/) 与 [Docker Compose](https://docs.docker.com/compose/)
- 建议配置：2 核 CPU / 4 GB 以上可用内存

### 2. 获取代码与配置环境

```bash
# 克隆主仓库
git clone https://github.com/MoeclubM/MetaFusion.git
cd MetaFusion

# 账号 / 互动 / 存储三个子系统的构建上下文在兄弟目录（compose 里的 ../../metafusion-*），
# 部署机上必须与主仓库并列检出，否则这三个服务拉不起来。
cd .. && for r in metafusion-auth metafusion-community metafusion-storage; do
  git clone https://github.com/MoeclubM/$r.git
done
cd MetaFusion

# 从模板创建环境变量
cp .env.example .env

# 编辑 .env 配置生产级随机密钥 (DB_PASSWORD, RUSTFS_ROOT_PASSWORD, AUTH_JWT_PRIVATE_KEY；
# AUTH_JWT_PRIVATE_KEY 必须在目录服务与账号服务之间共用同一把 RSA 私钥，否则登录后立刻掉线)
```

### 3. 一键启动部署

仓库提供全自动智能部署脚本 `deploy/deploy.sh`（Windows 对应 `deploy/deploy.ps1`）：

#### 选项 A：生产环境冷启动与迁移 (推荐)
```bash
# 自动启动基础依赖、执行数据库版本迁移并拉起全量服务集群
bash deploy/deploy.sh prod
```

#### 选项 B：极速增量热更新模式 (代码迭代)
```bash
# 基于 BuildKit 缓存秒级重编并无缝重启指定服务（或全部服务）
bash deploy/deploy.sh fast
# 或指定单个微服务:
bash deploy/deploy.sh fast backend
```

#### 选项 C：拉取 GHCR 预构建镜像 (快速上线)
```bash
# 直接拉取 GitHub Container Registry 构建好的生产镜像运行
bash deploy/deploy.sh pull
```

#### 选项 D：独立执行数据库迁移
```bash
# 检查当前版本与待迁移脚本状态
bash deploy/deploy.sh migrate status

# 执行最新升级迁移 / 回滚上一版本
bash deploy/deploy.sh migrate up
bash deploy/deploy.sh migrate down
```

#### 选项 E：首次从单体切到拆分后的服务 (只走一次)
```bash
# 构建全部镜像 → 起基础设施与各子系统 → 目录库迁移 → 搬运旧表数据 → 最后拉起网关
bash deploy/deploy.sh cutover

# 切流验证通过后，清掉拆分前的遗留 schema 与临时表（不可逆，先自动核对搬运行数）
bash deploy/deploy.sh retire
```

两者都在部署机（开发服务器）上执行，不在本机跑；步骤、判据与回滚见 [切流手册](docs/architecture/cutover-runbook.md)。

### 4. 访问服务与初始开箱 (OOBE)

- **前端主站与管理中台**：`http://<您的IP>:10100/`（反代域名：`http://findverse.cc/`）
- **首次部署初始化向导 (OOBE)**：`http://<您的IP>:10100/setup`
  - 新实例首次启动后，访问 `/setup` 即可按向导自主创建初始超级管理员（Super Admin）账号并配置实例准入策略；
  - 登录页面在未检测到管理员时也会提供明显的初始化引导入口。
- **预置开发环境账号**（仅限载入测试种子时）：
  - 超级管理员：`admin` / `admin@metafusion.internal`，默认密码：`AdminPassword2026!`
  - 首席档案员：`archivist_prime` / `archivist@metafusion.internal`，默认密码：`AdminPassword2026!`
  - *生产环境登录后请立即进入「个人设置」修改初始密码。*
- **开发与架构文档站**：`http://<您的IP>:10100/docs`
- **后端 API 健康状态**：`http://<您的IP>:10100/healthz`（就绪探针 `/ready`，标准 API 基址 `/api`，文档 `/api/docs`）

---

## 🤖 开放 API 与 Agent 集成

MetaFusion 采用统一 `/api` 主干（无版本前缀），核心元数据读接口对游客开放，写入需登录会话。

1. **认证方式**：登录后使用会话令牌（`Authorization: Bearer <token>`）或 `mf_session` Cookie；第三方应用可经 `/api/oauth/*` 的 OAuth 2.0 / OIDC 流程接入。**个人访问令牌（PAT）当前未实现**。
2. **标准接口（统一基址 `/api`）**：
   - `GET /api/catalog/entities?kind=work&limit=20`
   - `GET /api/catalog/entities?kind=release&limit=20`
   - `GET /api/catalog/entities?q=<keyword>&limit=20`
   - `GET /api/catalog/entities/<UUID>`、`GET /api/catalog/entities/<UUID>/relations`
   - `POST /api/catalog/entities`、`PUT /api/catalog/entities/:id`（写入，请求体为 `{entity, expected_version, edit_note, sources}`）
3. **Agent 自主协同**：支持 LLM 智能体通过 `/api/openapi.json`（OpenAPI 3.0.3）与 `/api/docs` 交互式文档了解契约。注意：当前**没有** MusicBrainz WS/2 兼容层、`/api/search`、`/api/browse/*` 或一站式 `POST /api/catalog/submit`；详见 [API 概览](docs-site/docs/api-overview.md)。

---

## 🤝 贡献与参与

欢迎任何形式的代码贡献、文档完善与编目建议！
- **代码规范**：所有新增业务需遵循全栈 i18n 零硬编码标准（`zh-CN.json` / `en-US.json`）；
- **提交规范**：遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范；
- **编目准则**：录入新作品与实体关系时请参考 [IFLA LRM Cataloging Standards](docs-site/docs/curation-guide.md)；
- **GitHub 工具准则**：所有远端仓库操作、分支推送、Issue 跟踪与 Pull Request 管理**统一通过 GitHub CLI (`gh`) 命令行工具执行**。

---

## 📄 开源许可证

本项目基于 [Apache-2.0 许可证](LICENSE) 开源发布。

<p align="center"><sub>Built for collectors and archivists, by the open community. — 守护人类文明中每一份不可磨灭的数字记忆。</sub></p>