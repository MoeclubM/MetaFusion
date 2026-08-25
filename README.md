# <img src="frontend/public/mark.svg" width="28" height="28" alt="MetaFusion"/> MetaFusion

<p align="center">
  <strong>全球化开放元数据与高保真多媒介典藏协作平台</strong><br/>
  电影 · 剧集 · 动漫 · 音乐 · 有声书 · 图书 · 漫画 · 画册 — 一处归档，全域互联，跨端畅播
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-black?style=flat-square" alt="License"/></a>
  <img src="https://img.shields.io/badge/Go-1.25-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go"/>
  <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js&logoColor=white" alt="Next.js"/>
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
- **五级层级结构**：采用 `Work（作品）→ CanonicalEntry（表现层典范）→ Release（发行版本）→ Medium（物理/数字载体）→ Track（单曲/分集/章节）→ AssetFile（CAS 资产）`。
- **纯净实体题名**：作品主标题坚决剥离季数、介质、规格等非本质限定词；版本与载体规格由 Release / Medium 精确承载，杜绝重复冗余。
- **多维标签与虚拟货架**：彻底废弃传统死板的单一树状分类，由「形态（Format）+ 制作媒介（Medium）+ 流派（Genre）+ 企划宇宙（Theme）」动态聚合生成虚拟货架。
- **自适应封面与多语言回退链**：支持 1:1、2:3、3:4 自然宽高比封面与自适应渲染；基于 `work_translations` 构建多语言回退链（`User Locale → en-US → original_language → Default`）。

### 2. 🔐 双 Token 认证与企业级安全风控
- **双 Token 体系**：短生命周期 Access Token（2小时）搭配可轮转 Refresh Token（7天），前端实现 401 自动静默无感拦截与并发防抖重试。
- **毫秒级 Token 撤销**：基于 Redis 维护黑名单，支持主动登出立即失效、全局会话吊销与跨设备安全风控。
- **个人访问令牌 (PAT)**：为第三方开发者与自动化 AI Agent 提供长期、权限可收敛的独立访问密钥。
- **媒体访问控制**：所有二进制资产（母盘原档、HLS 流分片、预览音频、图像缩略图）均通过短期预签名安全下发，保障版权与防盗链。

### 3. 🚀 云原生高性能媒体中枢与搜索引擎
- **S3 兼容对象存储 (RustFS)**：集成高性能 RustFS 引擎，支持基于 SHA-256 哈希的内容寻址存储（CAS）与秒传机制，客户端直传直取，不占用业务服务器带宽。
- **全域毫秒级检索 (OpenSearch 2.x)**：支持多语言分词、模糊纠错、拼音/罗马音联想与 Facet 多维聚合，并在搜索引擎离线时无缝降级为数据库全文检索。
- **异步分布式转码流水线**：基于 Go Asynq + Redis + FFmpeg 构建分布式转码 Worker，支持视频自适应码率 HLS 切片、雪碧图关键帧气泡、320k 预览音频提取与 WebP 图像无损压缩。

### 4. 🗄️ 独立版本化数据库迁移与运维治理
- **独立迁移引擎 (`mf-migrate`)**：自研 Go 原生数据库迁移工具，集成 PostgreSQL Advisory Lock 机制，彻底杜绝多副本部署时的并发迁移竞争。
- **无缝冷热启动**：支持 `up`、`down`、`status`、`force` 命令行管理，镜像内置嵌入式 SQL 脚本，部署前后自动完成无损版本升降级。
- **单端口边缘网关**：内置优化配置的 Nginx 边缘网关，对外仅需暴露单端口（默认 `10100`），无缝兼容宿主机外部反向代理（Nginx / Caddy / Cloudflare）接管 HTTPS。

---

## 🏗️ 系统架构全景

```
[ 客户端 / 浏览器 / 移动端 / 自动化 Agent ]
                     │  (HTTP / HTTPS)
                     ▼
         ┌──────────────────────┐
         │  Edge Gateway Nginx  │ (宿主机暴露端口: 10100)
         └──────────┬───────────┘
                    │
   ┌────────────────┼────────────────┬────────────────┐
   ▼                ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Next.js 15  │ │  Next.js 14  │ │  Go Backend  │ │   RustFS     │
│   Frontend   │ │  Docs Site   │ │  REST API    │ │ (S3 Storage) │
│ (Port: 3000) │ │ (Port: 3001) │ │ (Port: 8080) │ │ (Port: 9000) │
└──────────────┘ └──────────────┘ └──────┬───────┘ └──────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
             ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
             │ PostgreSQL 16│     │   Redis 7    │     │OpenSearch 2.x│
             │  Relational  │     │ Cache/Queue/ │     │ Search/Facet │
             │  & Metadata  │     │  Blacklist   │     │  Analytics   │
             └──────────────┘     └──────┬───────┘     └──────────────┘
                                         │ (Asynq Tasks)
                                         ▼
                                  ┌──────────────┐
                                  │ Transcoder   │
                                  │ Worker       │
                                  │(FFmpeg/vips) │
                                  └──────────────┘
```

---

## 🛠️ 技术栈清单

- **后端核心 (Backend)**：Go 1.25, Gin, GORM, Asynq, Golang-JWT/v5, go-redis/v9
- **前端系统 (Frontend)**：Next.js 15 (App Router, Standalone), React, Tailwind CSS, Lucide Icons, TypeScript
- **文档站点 (Docs Site)**：Next.js 14 / VitePress SSG/SSR
- **数据库 (Storage & DB)**：PostgreSQL 16, Redis 7 (Alpine), RustFS (S3-compatible Object Storage)
- **检索引擎 (Search Engine)**：OpenSearch 2.14.0
- **媒体处理 (Media Pipeline)**：FFmpeg, libvips, mediainfo
- **容器与网关 (Infra)**：Docker, Docker Compose v2, Nginx 1.25 Alpine

---

## 🚀 快速上手与部署

### 1. 环境准备
- 操作系统：Linux / macOS / Windows (WSL2)
- 运行依赖：[Docker](https://docs.docker.com/get-docker/) 与 [Docker Compose](https://docs.docker.com/compose/)
- 建议配置：2 核 CPU / 4 GB 以上可用内存

### 2. 获取代码与配置环境

```bash
# 克隆仓库
git clone https://github.com/MoeclubM/MetaFusion.git
cd MetaFusion

# 从模板创建环境变量
cp .env.example .env

# 编辑 .env 配置生产级随机密钥 (JWT_SECRET, DB_PASSWORD, MINIO_ROOT_PASSWORD)
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

### 4. 访问服务

- **前端主站与管理后台**：`http://<您的IP>:10100/`（反代域名：`http://findverse.cc/`）
- **开发与架构文档站**：`http://<您的IP>:10100/docs`
- **后端 API 健康状态**：`http://<您的IP>:10100/api/v1/health`

---

## 🤖 开放 API 与 Agent 集成

MetaFusion 原生遵循 **API-First** 设计哲学，所有网页功能均具备 100% 对应的 RESTful 接口。

1. **生成访问凭证**：登录后在 **个人中心 → 设置 → 开发者** 页面生成个人访问令牌（PAT）。
2. **MusicBrainz 风格接口**：
   - `GET /api/v1/catalog/lookup?entity=work&id=<UUID>&inc=artists,releases`
   - `GET /api/v1/catalog/browse?entity=release&artist=<UUID>`
   - `GET /api/v1/search?q=<keyword>&type=all&page=1&limit=20`
3. **Agent 自主协同**：支持 LLM 智能体通过标准 OpenAPI/Swagger 文档与认证协议自主完成元数据校验、批量抓取入库与自动修订。

---

## 🤝 贡献与参与

欢迎任何形式的代码贡献、文档完善与编目建议！
- **代码规范**：所有新增业务需遵循全栈 i18n 零硬编码标准（`zh-CN.json` / `en-US.json`）；
- **提交规范**：遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范；
- **编目准则**：录入新作品与实体关系时请参考 [IFLA LRM Cataloging Standards](docs-site/docs/curation-guide.md)。

---

## 📄 开源许可证

本项目基于 [AGPL-3.0 许可证](LICENSE) 开源发布。

<p align="center"><sub>Built for collectors and archivists, by the open community. — 守护人类文明中每一份不可磨灭的数字记忆。</sub></p>
