# MetaFusion 内部文档索引

本目录是 MetaFusion 项目内部架构、规范与需求文档入口。整体体系分工如下：

| 目录 / 文件 | 定位 | 读者 |
|---|---|---|
| [`requirements.md`](requirements.md) | 产品需求文档（PRD）：可见性边界、邀请制风控、功能需求与验收标准 | 产品 / 开发 |
| [`architecture/multi-project-decoupling-spec.md`](architecture/multi-project-decoupling-spec.md) | **多项目解耦与微服务架构规范（VISION，未实现）**：以元数据系统为主项目，规划账号、论坛、资源、网关与文档站的解耦边界 | 架构 / 全员 |
| [`architecture/plugin-decoupling-blueprint.md`](architecture/plugin-decoupling-blueprint.md) | 插件系统与 DAG 依赖拓扑架构规范（VISION，未实现）：规划 12 个原生内置插件集；当前实际为进程内可选模块 | 开发 / 后端 |
| [`architecture/catalog-core-implementation.md`](architecture/catalog-core-implementation.md) | 纯净元数据目录内核实现：固定实体骨架、动态定义引擎与数据不变量 | 开发 / 后端 |
| [`../docs-site/`](../docs-site/) | 面向公众的独立文档站（VitePress）：实体模型、编目指南、REST API 全套文档、法务页 | 所有人 / 外部开发者 |
| [`../AGENTS.md`](../AGENTS.md) | Agent / 贡献者协作准则（Git 规范、编目最高准则、gh cli 流程） | AI Agent / 贡献者 |
| [metafusion-skills](https://github.com/MoeclubM/metafusion-skills) | 编目标准技能独立仓库（metafusion-curator + lrm-catalog-standards） | AI Agent / 考据员 |

---

## 核心架构概览（当前单仓库实现）

> 以下为**现状**。第 2-5 项描述的多仓库微服务拆分属于 VISION，尚未实现，详见 [`architecture/multi-project-decoupling-spec.md`](architecture/multi-project-decoupling-spec.md)。

1. **元数据系统为主项目 (`MetaFusion`)**：
   - 包含八大固定实体骨架（Agent, Collection, Work, ContentUnit, Expression, Release, Medium, Track）与动态定义引擎（类型、属性、关系、受控词表、视图模板）；
   - 极简自洽：仅依赖 PostgreSQL 即可 100% 完整运行，无商业出版证明的个人创作（写真/独立游戏/翻唱）零阻碍建档；
   - 核心不反向持有物理文件或社区帖子。
2. **认证与网关（当前同仓库/同进程）**：
   - `/api/auth/*` 与 OAuth 2.0 / OIDC 端点（`/api/oauth/*`）在 `backend/internal/catalog` 内实现，由 Nginx 边缘网关统一反代；**不是独立 `metafusion-auth` 微服务**。
3. **资源存储与媒体（当前为可选模块）**：
   - S3/RustFS 对象存储由 `backend/internal/modules` 的 `archive` / `playback` / `media` 模块承载，状态存于 `modules.settings`；**不是独立 `metafusion-storage` 微服务**。
4. **社区与论坛（当前为可选模块）**：
   - 实体帖子、集合互动由 `community` 模块提供（`/api/community/*`）；**不是独立 `metafusion-community` 微服务**。
5. **文档站系统 (`metafusion-docs`)**：
   - VitePress 静态工程，承载对外规范、API 文档与 Agent 接入指引（位于本仓库 `docs-site/`）。

---

## 协作与工具准则

- 所有远端 GitHub 仓库管理、Issue 跟踪与 Pull Request 流程**必须通过 GitHub CLI (`gh`) 命令行工具执行**。
- 文档与代码同 PR 更新；架构与实体行为变化先同步更新本文档与 docs-site 对应章节。
