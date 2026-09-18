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
  <img src="https://img.shields.io/badge/i18n-zh--CN%20%7C%20zh--TW%20%7C%20ja--JP%20%7C%20en--US-blue?style=flat-square" alt="i18n"/>
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
- **自由标签与虚拟货架**：不预置树状分类；货架是数据驱动、后台可配的收录规则（`catalog.shelves`），实体标签只来自上游来源或用户贡献，不充当分类体系。
- **自适应封面与多语言回退链**：1:1、2:3、3:4 封面比例只是展示建议，`cover_aspect` 以接口为准；实体翻译在统一 DTO 的 `translations` 里按 locale 分组（每语种 `title` / `summary` / `aliases`），展示回退链为请求语言 → en-US → original_language → 基础字段。

### 2. 🔐 会话认证与访问控制
- **服务端会话 + RS256 访问令牌**：账号与令牌由独立服务 `metafusion-auth`（`auth` schema）负责——登录签发 RS256 JWT（默认 15 分钟）并写入 HttpOnly Cookie `mf_session`，`POST /api/auth/refresh` 轮转会话，`POST /api/auth/logout-all` 吊销全部会话；目录侧只做**验签**，不保存账号数据、不查对方表。
- **令牌密钥（环境变量）**：私钥只在账号服务——`AUTH_JWT_PRIVATE_KEY`（PKCS#1/PKCS#8 PEM 或其 base64）由 auth 用于**签发**，是**必填项**：未配置时账号服务拒绝启动（本地开发可显式设 `AUTH_JWT_ALLOW_EPHEMERAL_KEY=1` 改用进程内临时密钥，重启即失效且启动会打 WARNING）。目录侧只验签，按 `AUTH_JWT_PUBLIC_KEY`（静态公钥）→ `AUTH_JWKS_URL`（账号服务的 JWKS，默认 `http://auth:8081/api/oidc/jwks`）取公钥；`AUTH_JWT_PRIVATE_KEY` 在目录侧只剩兼容兜底（启动会告警，待移除）。`AUTH_JWT_ISSUER`（默认 `https://findverse.cc/api`）与 `AUTH_JWT_AUDIENCE`（默认 `metafusion`）写入令牌声明。注意：无状态令牌在 `logout-all` 后仍有最长 15 分钟的验签残余窗口，强吊销场景等待会话过期或更换密钥。
- **OAuth 2.0 / OIDC 接入**：由账号服务提供 `/api/oauth/authorize`、`/api/oauth/token`、`/api/oauth/userinfo`、
  `/.well-known/openid-configuration` 与 `/api/oidc/jwks`（其他服务用 JWKS 本地验签）。
- **个人访问令牌（PAT）**：账号服务签发 `mfp_` + 43 位 base62 的长期令牌（明文只在创建响应里出现一次，库里只存 sha256），供调 API 与接 bot 使用。下游（目录 / 互动 / 存储）遇到 `Authorization: Bearer mfp_…` 一律把该令牌交给账号服务的 `POST /api/auth/tokens/introspect` 判定，**不读账号库、不签发**；有效权限 = 用户自身权限 ∩ 该令牌的 scopes，授权判定仍走各服务自己的权限码。内省结果在下游进程内按明文 sha256 缓存 **60 秒**（同键并发只打一次，缓存有上限与逐出），因此**吊销与过期最长 60 秒后才在下游生效**；状态码映射的边界（别按字面"非 200 都当不认"改回去）：只有 `401` / `403` 是账号服务对**令牌本身**的判定，才回 `401 invalid_token`；`503`（账号服务读不动库）、`404`（内省端点还没上线，滚动部署期）、`429`（内省限流）与 5xx / 网络超时都**不是**"令牌无效"的证据，一律回 `503 auth_unavailable`（**不是 401**：依赖故障回 401 会让 bot/CI 误以为凭据问题去换令牌，换令牌解决不了这些故障）；两种映射都 fail-closed，刻意选更诚实的那个。PAT 请求不回落也不产出 `mf_session` Cookie。
- **规划中（未实现）**：Access/Refresh 双 Token 轮转、基于 Redis 的令牌黑名单。
- **文件访问控制**：文件与绑定由独立服务 `metafusion-storage` 负责（`/api/storage/*`）；
  读取口径只有一条——上传者本人或管理员直通，其余人只要任一绑定目标实体可见即可读，
  下载、元数据读取与哈希校验共用该判定。

### 3. 🚀 云原生媒体处理与存储
- **S3 兼容对象存储 (RustFS)**：由存储服务写入 RustFS（`STORAGE_S3_*`），按 sha256 内容寻址与秒传去重，
  支持分片预签名直传与服务端流式上传兜底；元数据与物理资产分离，目录侧不保存物理路径。
- **数据库检索**：`GET /api/catalog/entities?q=...` 由 PostgreSQL 匹配题名与多语言文档（`ILIKE` / 全文索引），OpenSearch 2.14 容器已随 Compose 部署，但**当前 Go 代码尚未接入客户端，规划中的多语言分词与 Facet 聚合未生效**。
- **不做转码（明确取舍）**：不生成 HLS 切片、预览音频、波形图或缩略图；存储服务只收原始文件、做内容寻址与受控下载。

### 4. 🗄️ 独立版本化数据库迁移与运维治理
- **独立迁移引擎 (`mf-migrate`)**：自研 Go 原生数据库迁移工具，集成 PostgreSQL Advisory Lock 机制，彻底杜绝多副本部署时的并发迁移竞争。
- **无缝冷热启动**：支持 `up`、`down`、`status`、`force` 与 `seed`（定义/货架/外部库种子的只增不改增量合并）命令行管理，镜像内置嵌入式 SQL 脚本，部署前后自动完成无损版本升降级。
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
| **文档站** | 独立仓库 `../metafusion-docs` | 展示层 | VitePress 静态文档站（唯一源） |
| **部署编排** | `deploy/`（`docker-compose.yml` 与 dev/prod/metadata 覆盖、`nginx.conf`、`deploy.sh` / `deploy.ps1`、`versions.lock`、`sql/`） | 一键部署 | 单端口边缘网关、全部服务编排、切流/回滚、版本锁与遗留结构清理 |
| **独立子系统** | `../metafusion-auth`、`../metafusion-community`、`../metafusion-storage`、`../metafusion-docs` | 兄弟仓库 | 账号与 RS256 令牌、论坛与互动记录、文件与内容寻址直传、文档站；`../metafusion-api-gateway` 现在只留切流自检脚本，生效的路由矩阵是本仓库 `deploy/nginx.conf` |

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
                                                └──── Redis（常驻但尚未接线）/ OpenSearch（仅 --profile search 启动，未接线）
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

# 账号 / 互动 / 存储 / 文档站的构建上下文在兄弟目录（compose 里的 ../../metafusion-*），
# 部署机上必须与主仓库并列检出，否则这四个服务拉不起来（文档站镜像没有发布方，缺席时靠就地构建）。
cd .. && for r in metafusion-auth metafusion-community metafusion-storage metafusion-docs; do
  git clone https://github.com/MoeclubM/$r.git
done
cd MetaFusion

# 从模板创建环境变量
cp .env.example .env

# 编辑 .env 配置生产级随机密钥 (DB_PASSWORD, RUSTFS_ROOT_PASSWORD, AUTH_JWT_PRIVATE_KEY)；
# AUTH_JWT_PRIVATE_KEY 只给账号服务签发用；目录侧用 AUTH_JWT_PUBLIC_KEY 或 AUTH_JWKS_URL 验签
# （两者都没配时才回退私钥兜底，启动会告警）
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
- **账号来源**：没有预置账号，也不随镜像播种测试用户——首个超级管理员由 `/setup` 向导创建（账号落在账号服务的 `auth.users`）；创建后请立即在「个人设置」修改密码。
- **开发与架构文档站**：`http://<您的IP>:10100/docs`
- **健康探针**：`/healthz`、`/livez` 是网关自身存活（只证明 nginx 在跑，不探上游）；逐上游就绪看 `/health/catalog`、`/health/auth`、`/health/community`、`/health/storage`；目录服务自身就绪是 `/ready`、`/health`。标准 API 基址 `/api`，文档 `/api/docs`

---

## 🤖 开放 API 与 Agent 集成

MetaFusion 采用统一 `/api` 主干（无版本前缀），核心元数据读接口对游客开放，写入需登录会话。

1. **认证方式**：登录后使用会话令牌（`Authorization: Bearer <token>`）或 `mf_session` Cookie；第三方应用可经 `/api/oauth/*` 的 OAuth 2.0 / OIDC 流程接入。个人访问令牌（PAT）由账号服务签发（`mfp_` 前缀），目录侧经 `/api/auth/tokens/introspect` 校验——未给目录服务配置 `AUTH_URL` 时该路径返回 503 `auth_unavailable`。
2. **标准接口（统一基址 `/api`）**：
   - `GET /api/catalog/entities?kind=work&limit=20`
   - `GET /api/catalog/entities?kind=release&limit=20`
   - `GET /api/catalog/entities?q=<keyword>&limit=20`
   - `GET /api/catalog/entities/<UUID>`、`GET /api/catalog/entities/<UUID>/relations`
   - `POST /api/catalog/entities`、`PUT /api/catalog/entities/:id`（写入，请求体为 `{entity, expected_version, edit_note, sources}`）
3. **Agent 自主协同**：支持 LLM 智能体通过 `/api/openapi.json`（OpenAPI 3.0.3）了解契约——它是**公开面，匿名可读**，也是接入方发现端点的唯一来源；交互式文档页 `/api/docs`（Scalar）与 `/api/swagger`（Swagger UI）属管理面，需登录且令牌带 `catalog.lifecycle.manage`。注意：当前**没有** MusicBrainz WS/2 兼容层、`/api/search`、`/api/browse/*` 或一站式 `POST /api/catalog/submit`；详见 [API 概览](https://github.com/MoeclubM/metafusion-docs/blob/main/docs/api-overview.md)。

---

## 🤝 贡献与参与

欢迎任何形式的代码贡献、文档完善与编目建议！
- **代码规范**：所有新增业务需遵循全栈 i18n 零硬编码标准（`zh-CN` / `zh-TW` / `ja-JP` / `en-US` 四语字典同步）；
- **提交规范**：遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范；
- **编目准则**：录入新作品与实体关系时请参考 [IFLA LRM Cataloging Standards](https://github.com/MoeclubM/metafusion-docs/blob/main/docs/curation-guide.md)；
- **GitHub 工具准则**：所有远端仓库操作、分支推送、Issue 跟踪与 Pull Request 管理**统一通过 GitHub CLI (`gh`) 命令行工具执行**。

---

## 📄 开源许可证

本项目基于 [Apache-2.0 许可证](LICENSE) 开源发布。

<p align="center"><sub>Built for collectors and archivists, by the open community. — 守护人类文明中每一份不可磨灭的数字记忆。</sub></p>