# MetaFusion 多项目解耦与子系统拆分架构规范 (Multi-Project Decoupling Specification)

> **状态：已落地**。账号（`metafusion-auth`）、互动（`metafusion-community`）、存储（`metafusion-storage`）与文档站（`metafusion-docs`）都是独立仓库，主仓库收敛为元数据目录 + 前端 + 部署编排。
> 与本文的差异：实现**没有**引入独立数据库（各服务共用同一 PostgreSQL 实例、各用自有 schema，且不建跨 schema 外键），也没有按域前缀拆 URL 命名空间（仍是统一的 `/api/*`，由网关按前缀分流）。
> 网关本体也不是独立的 `metafusion-api-gateway` 仓库：线上矩阵是本仓库 `deploy/nginx.conf`（compose 的 `gateway` 服务），
> 那个仓库只剩切流自检脚本；下文 §2/§3.1 里"边缘网关 = metafusion-api"的仓库边界按此理解。
> 运行时的权威描述以 AGENTS.md、[子系统拆分与迁移契约](./service-split-migration.md)、[切流手册](./cutover-runbook.md) 与 `backend/internal/catalog/http.go` 为准。
>
> 2026-09 审计的补充决议：UI 目标形态为**每个服务自带 UI**（先抽共享层，再按 auth → community → storage 拆）；共享代码收敛为**新建协议层 SDK 仓库**；两项已定，其余（密钥边界、网关矩阵归属、capabilities 去反向探活、数据层分角色、事件契约）为推荐值待评审。证据、目标架构与分批路线见 [多项目解耦审计与优化建议](./decoupling-audit-2026-09.md) §8.2。

本文档面向 MetaFusion 核心开发与架构运维团队，明确**元数据系统作为主项目（Core Project）**与周边外围子系统（账号、论坛、资源存储、API 网关、文档站）的**项目拆分边界、通信协议契约、数据库隔离方案与 GitHub 多仓库协同规范**。

---

## 1. 架构定位与解耦原则

在传统单体设计中，元数据核心与文件下载、社区讨论、用户账号深度绑定，存在“文件存储不可用拖垮词条浏览”、“论坛并发影响编目审计”等痛点。新架构确立**「主从清晰、单向依赖、无外键跨库、OAuth2 统一身份」**四大核心原则：

1. **元数据系统为主项目（Core First）**：
   - 核心系统仅聚焦于实体模型（Agent, Collection, Work, ContentUnit, Expression, Release, Medium, Track）、动态定义引擎、图谱关系、审核修订与多语言题名。
   - **极致轻量高可用**：仅依赖 PostgreSQL 即可 100% 完整运行，无文件存储、音视频转码、论坛发帖等硬性依赖；没有商业发行、没有出版证明的个人创作（写真、独立游戏、同人翻唱）可零阻碍独立建档。
2. **全域唯一标识单向引用（UUID As Sovereign Anchor）**：
   - 元数据核心为全域实体分配稳定 UUID。外围系统（资源中心、论坛、个人标记）仅通过只读持有该 `entity_id` 进行业务挂载；元数据核心数据库中**绝不反向持有**论坛帖子、文件磁盘路径或上传记录。
3. **数据层物理与逻辑解耦（Database Decoupling）**：
   - 各独立项目拥有独立的数据存储（独立的 Schema 或独立数据库实例），严禁任何跨项目跨库直接 JOIN 或事务锁，各子系统可独立迁移、扩容、备份或重构。
4. **统一认证与服务自治（SSO & Service Autonomy）**：
   - 账号中心作为独立身份提供商（IdP），通过标准 OAuth 2.0 / OIDC 协议向各业务系统派发 JWT 令牌。各子系统仅做无状态公钥签名校验与 Scope 判定，即使网络分区亦能维持本地鉴权可用性。

---

## 2. 六大项目矩阵与职责划分

| 项目代码 | 仓库规划 | 架构定位 | 核心职责 | 存储与基础设施依赖 |
|---|---|---|---|---|
| **`metafusion-catalog`** | `MoeclubM/MetaFusion` (主仓库) | **核心主项目** | 实体骨架建档、动态定义引擎、关系图谱、版本对比、协同审核、修订溯源、基础文本检索 | PostgreSQL (单实例) |
| **`metafusion-auth`** | `MoeclubM/metafusion-auth` | 独立身份服务 | 用户中心、密码/邮箱安全、权限组与权限码、OAuth2.0/OIDC 授权中心、RS256 令牌派发与会话吊销 | PostgreSQL（`auth` schema，与其它服务同实例） |
| **`metafusion-storage`** | `MoeclubM/metafusion-storage` | 独立资源服务 | 物理文件归档、S3/RustFS 对象存储接入、sha256 内容寻址与秒传、绑定与按实体可见性授权下载（不做转码） | S3 兼容存储 (RustFS) + PostgreSQL（`storage` schema） |
| **`metafusion-community`** | `MoeclubM/metafusion-community` | 独立社区服务 | 讨论版块、主题与回复、短评、收藏与互动记录 | PostgreSQL（`community` schema，与其它服务同实例） |
| **`metafusion-api`** | `MoeclubM/metafusion-api-gateway` | 边缘路由中枢 | **生效矩阵不在该仓库**：单端口 Nginx 网关是主仓库 `deploy/nginx.conf`（compose 的 `gateway` 服务），TLS 由外层反代接管；该仓库现在只剩切流自检脚本与归档的旧矩阵 | 主仓库编排（Nginx 1.25 Alpine 容器）；外层反代可换 Cloudflare 等 |
| **`metafusion-docs`** | `MoeclubM/metafusion-docs` | 静态文档站点 | LRM 编目准则、开放 API 交互手册、智能体 Agent 接入协议、开发者指南与法务声明 | VitePress 静态托管 (Node/Bun) |

---

## 3. 跨系统交互契约与边界设计

### 3.1 统一网关路由拓扑 (Gateway Ingress Map)

外部访问统一通过单一域名（如 `https://findverse.cc`）接入，边缘网关根据 URL 路径规则透明代理至各独立子服务：

```
                                  ┌────────────────────────┐
                                  │      Client (Web/App)  │
                                  └───────────┬────────────┘
                                              │ https://findverse.cc
                                              ▼
                                 ┌──────────────────────────┐
                                 │ metafusion-api (Gateway) │
                                 └────────────┬─────────────┘
          ┌─────────────────────┬─────────────┼─────────────────────┬─────────────────────┐
          │ /api/catalog/*      │ /api/auth/* │ /api/storage/*      │ /api/community/*    │ /docs/*
          │ /catalog/*          │ /account/*  │ /downloads/*        │ /community/*        │
          ▼                     ▼             ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ metafusion-      │  │ metafusion-      │  │ metafusion-      │  │ metafusion-      │  │ metafusion-      │
│ catalog (主项目) │  │ auth             │  │ storage          │  │ community        │  │ docs             │
└──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘
```

> 上图的 `/catalog/*`、`/account/*`、`/downloads/*`、`/community/*` 是**页面路径**（由前端 Next.js 承载，或属"每服务自带 UI"的目标形态），
> 当前网关只按 `/api/*` 前缀分流到各服务；生效矩阵以 `deploy/nginx.conf` 为准。

### 3.2 身份与授权契约 (OAuth2 / JWT Protocol)
- **Token 规范**：`metafusion-auth` 派发符合 RFC 7519 的标准 JWT（RS256），Payload 字段名与各服务验签侧逐字一致：
  ```json
  {
    "sub": "user-uuid-1234",
    "preferred_username": "admin",
    "role": "admin",
    "groups": ["admin"],
    "permissions": ["*"],
    "iss": "https://findverse.cc/api",
    "aud": "metafusion",
    "exp": 1780000000
  }
  ```
  `groups` 是组码（展示与审计用），**授权只看 `permissions`**（auth 按组展开后的权限码集合，admin 组为 `*`）。
- **无状态验证**：各子服务本地挂载 Auth 服务的公钥，解析并拦截未授权请求，无需每一次读写均向 Auth 服务发起同步 RPC 调用。

### 3.3 元数据挂载契约 (Data Association Contract)
- **资源中心挂载**：
  `metafusion-storage` 表中存储记录：
  ```sql
  CREATE TABLE file_bindings (
      id UUID PRIMARY KEY,
      target_entity_id UUID NOT NULL, -- 仅保存元数据实体 UUID
      target_kind VARCHAR(32) NOT NULL, -- 如 release / medium / track
      file_hash_sha256 VARCHAR(64) NOT NULL,
      file_size BIGINT NOT NULL,
      storage_uri TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```
- **论坛社区挂载**：
  `metafusion-community` 主题帖记录：
  ```sql
  CREATE TABLE forum_threads (
      id UUID PRIMARY KEY,
      target_entity_id UUID, -- 可选关联的条目 UUID
      title TEXT NOT NULL,
      author_id UUID NOT NULL,
      content TEXT NOT NULL
  );
  ```
- **前端集成**：元数据详情页仅展示“资源存储与下载”和“社区交流”的轻量 Tab 跳转 CTA。若需显示文件数量或帖子数量，前端通过独立客户端异步请求对应的服务端点，避免任何单点阻塞。

---

> 上面的 `file_bindings` / `forum_threads` 是**挂载契约示意**，不是线上表结构：实际表在存储服务的 `storage.assets` / `storage.bindings`（用 `binding_role` 表达用途）
> 与互动服务的 `community.topics` / `community.posts` / `community.favorites`（见各仓库 `migrations/000001_init.up.sql`）。

## 4. GitHub 仓库协同与 `gh cli` 规范

根据项目规范，所有 GitHub 远端操作必须严格通过 GitHub CLI (`gh`) 工具执行，禁止混用不可控的第三方自动化脚本。

### 4.1 子项目建仓与初始化命令范例

使用 `gh repo create` 快速创建解耦后的独立代码仓库：

```bash
# 1. 账号认证中心
gh repo create MoeclubM/metafusion-auth --public --description "MetaFusion 统一身份认证与 IAM 账号中心 (OAuth2.0 / OIDC / JWT)"

# 2. 社区论坛系统
gh repo create MoeclubM/metafusion-community --public --description "MetaFusion 社区交流、讨论版块与动态评分系统"

# 3. 资源存储与下载管理中心
gh repo create MoeclubM/metafusion-storage --public --description "MetaFusion 高保真多媒体资产归档、哈希校验、种子与下载分发中心"

# 4. API 网关中枢
gh repo create MoeclubM/metafusion-api-gateway --public --description "MetaFusion 边缘路由、反向代理与统一 OpenAPI 聚合网关"

# 5. 开发者与编目文档站
gh repo create MoeclubM/metafusion-docs --public --description "MetaFusion 官方架构指南、IFLA LRM 编目标准与开发者 API 站点 (VitePress)"
```

### 4.2 团队协作与 PR / Issue 流水线

- **创建特性或架构议题 (Issue)**：
  ```bash
  gh issue create --repo MoeclubM/MetaFusion --title "feat: 完成多项目解耦架构落地与协议对齐" --body-file .tmp/issue_decoupling.md
  ```
- **提交拉取请求 (Pull Request)**：
  ```bash
  gh pr create --repo MoeclubM/MetaFusion --base main --head codex/catalog-v2-modular --title "feat(arch): 明确元数据主项目架构与多项目解耦规范" --body-file .tmp/pr_decoupling.md
  ```
- **查看与合并 PR**：
  ```bash
  gh pr list --repo MoeclubM/MetaFusion
  gh pr view 34 --repo MoeclubM/MetaFusion
  gh pr merge 34 --merge --repo MoeclubM/MetaFusion
  ```

---

## 5. 迁移演进路线 (Step-by-Step Roadmap)

> 下列阶段是当初的推进顺序，现已全部落地；当前边界与验收判据见 [子系统拆分与迁移基准](./service-split-migration.md)。

1. **第一阶段（早期）**：
   - 模块化单体架构，完成元数据核心系统内部的固定骨架（Agent, Work, Expression, Release, Medium, Track）与动态定义引擎搭建；
   - 前端条目详情页按 Tab 完成对存储、论坛的解耦跳转设计；
   - 编写完成多项目解耦技术规范与架构契约。
2. **第二阶段**：
   - 抽取 `backend/internal/auth` 为独立微服务 `metafusion-auth`，实现独立的 Auth DB 与 JWT 签名校验，完成全站 OAuth 统一；
   - 文档站独立为 `metafusion-docs` 仓库，自带构建与静态部署。
3. **第三阶段**：
   - 将 `backend/internal/storage` 独立为 `metafusion-storage`，部署专用的对象存储管理中枢与下载授权网关；
   - 将社区论坛独立为 `metafusion-community`，挂载主题讨论与动态打分系统；
   - 通过 `metafusion-api-gateway` 完成全域单域名路由映射与微服务聚合。

