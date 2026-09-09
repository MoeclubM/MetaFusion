# MetaFusion 多项目解耦与子系统拆分架构规范 (Multi-Project Decoupling Specification)

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
| **`metafusion-auth`** | `MoeclubM/metafusion-auth` | 独立身份服务 | 用户中心、密码/邮箱安全、RBAC 角色权限、OAuth2.0/OIDC 授权中心、JWT 派发与吊销 | PostgreSQL (Auth DB) + Redis (Session/Blacklist) |
| **`metafusion-storage`** | `MoeclubM/metafusion-storage` | 独立资源服务 | 物理文件归档、S3/RustFS 分布式对象存储接入、SHA-256/ED2K 指纹校验、种子生成与磁力链聚合、下载配额与限速控制 | S3 兼容存储 (RustFS/MinIO) + PostgreSQL (Storage DB) |
| **`metafusion-community`** | `MoeclubM/metafusion-community` | 独立社区服务 | 讨论版块、主题帖 (Thread)、楼层回复 (Post)、动态评分、点赞与用户互动 | PostgreSQL (Community DB) + Redis (计数与热门流) |
| **`metafusion-api`** | `MoeclubM/metafusion-api-gateway` | 边缘路由中枢 | 统一域名调度、SSL/TLS 终止、反向代理、路由分流、全域速率限制、统一聚合 OpenAPI 网关 | Nginx / Envoy / Cloudflare |
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

### 3.2 身份与授权契约 (OAuth2 / JWT Protocol)
- **Token 规范**：`metafusion-auth` 派发符合 RFC 7519 的标准 JWT，Payload 包含：
  ```json
  {
    "sub": "user-uuid-1234",
    "username": "MoeCaa",
    "roles": ["curator", "uploader"],
    "scopes": ["catalog:read", "catalog:edit", "storage:download", "community:post"],
    "exp": 1780000000
  }
  ```
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

1. **第一阶段（当前）**：
   - 模块化单体架构，完成元数据核心系统内部的固定骨架（Agent, Work, Expression, Release, Medium, Track）与动态定义引擎搭建；
   - 前端条目详情页按 Tab 完成对存储、论坛的解耦跳转设计；
   - 编写完成多项目解耦技术规范与架构契约。
2. **第二阶段**：
   - 抽取 `backend/internal/auth` 为独立微服务 `metafusion-auth`，实现独立的 Auth DB 与 JWT 签名校验，完成全站 OAuth 统一；
   - 将 `docs-site` 独立为独立仓库 `metafusion-docs`，配置独立 CI/CD 与静态部署。
3. **第三阶段**：
   - 将 `backend/internal/storage` 独立为 `metafusion-storage`，部署专用的对象存储管理中枢与下载授权网关；
   - 将社区论坛独立为 `metafusion-community`，挂载主题讨论与动态打分系统；
   - 通过 `metafusion-api-gateway` 完成全域单域名路由映射与微服务聚合。

