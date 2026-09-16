# MetaFusion 内部文档索引

本目录是 MetaFusion 项目内部架构、规范与需求文档入口。整体体系分工如下：

| 目录 / 文件 | 定位 | 读者 |
|---|---|---|
| [`requirements.md`](requirements.md) | 产品需求文档（PRD）：可见性边界、邀请制风控、功能需求与验收标准 | 产品 / 开发 |
| [`architecture/multi-project-decoupling-spec.md`](architecture/multi-project-decoupling-spec.md) | 多项目解耦规范：以元数据系统为主项目，账号、论坛、资源、网关与文档站的解耦边界（**P1–P4 已落地**） | 架构 / 全员 |
| [`architecture/plugin-decoupling-blueprint.md`](architecture/plugin-decoupling-blueprint.md) | 插件系统与 DAG 依赖拓扑规范（**VISION，未实现**）：规划 12 个原生内置插件集；当前实际为独立子系统 + 部署态能力清单（进程内模块层已退役） | 开发 / 后端 |
| [`architecture/catalog-core-implementation.md`](architecture/catalog-core-implementation.md) | 纯净元数据目录内核实现：固定实体骨架、动态定义引擎与数据不变量 | 开发 / 后端 |
| [metafusion-docs](https://github.com/MoeclubM/metafusion-docs) | 面向公众的文档站（VitePress，唯一源）：实体模型、编目指南、REST API 全套文档、法务页 | 所有人 / 外部开发者 |
| [`../AGENTS.md`](../AGENTS.md) | Agent / 贡献者协作准则（Git 规范、编目最高准则、gh cli 流程） | AI Agent / 贡献者 |
| [metafusion-skills](https://github.com/MoeclubM/metafusion-skills) | 编目标准技能独立仓库（metafusion-curator + lrm-catalog-standards） | AI Agent / 考据员 |
| 本地 `docs-local/`（**不进版本库**） | 部署手册与实例状态、服务器连接信息、开发日志与一次性执行报告 | 维护者 / 运维 |

---

## 核心架构概览（当前：元数据主系统 + 独立子系统）

> 以下为**现状**。账号、互动、存储已经拆成独立服务仓库，主仓库收敛为「元数据目录 + 前端 + 文档站 + 部署编排」；
> 契约、边界与数据归属见 [`architecture/service-split-migration.md`](architecture/service-split-migration.md)，
> 切流、回滚与遗留结构清理见 [`architecture/cutover-runbook.md`](architecture/cutover-runbook.md)。

1. **元数据主系统 (`MetaFusion`)**：
   - 八大固定实体骨架（Agent, Collection, Work, ContentUnit, Expression, Release, Medium, Track）与动态定义引擎（类型、属性、关系、受控词表、视图模板）；
   - 仅依赖 PostgreSQL 即可完整运行元数据侧能力；
   - 目录库不反向持有物理文件或社区帖子。
2. **账号服务 (`metafusion-auth`)**：`/api/auth/*`、`/api/setup`、`/api/admin/users`、`/api/oauth/*`、`/api/oidc/*`、`/api/.well-known/*`；
   自有 `auth` schema，RS256 令牌签发与 JWKS；其余服务只验签、不签发。
3. **互动服务 (`metafusion-community`)**：论坛、短评、收藏与互动记录（`/api/community/*`、`/api/records/*`、`/api/favorites/*`、`/api/users/{id}/favorites`）；
   自有 `community` schema；实体可见性问目录服务，不直连目录库。
4. **存储服务 (`metafusion-storage`)**：物理文件、sha256 内容寻址、预签名直传与绑定（`/api/storage/*`）；
   自有 `storage` schema，桶由服务启动时自建。
5. **边缘网关**：`deploy/nginx.conf`（compose 的 `gateway` 服务，单容器 Nginx）按前缀把 `/api/*`
   分流到各服务，只对外暴露一个端口；`metafusion-api-gateway` 仓库只剩切流自检脚本，
   它自带的 nginx.conf 仍是切流前矩阵，不参与部署。
6. **文档站（`metafusion-docs`）**：VitePress 静态工程，独立仓库即唯一源；主仓库不再存放 doc 页面，编排从兄弟目录构建该服务。

**单体侧已完成收敛**：`catalog/identity.go`、`favorites.go` 与账号路由全部删除，`token.go` 只剩验签
（只持公钥、没有签发路径），并且不再创建或写入 `auth` schema（含第一方 OAuth 客户端种子）；
`catalog.favorites` 已从结构基线中移除（收藏归 `community.favorites`）。目录服务只剩实体、关系、定义、检索与货架。

## 协作与工具准则

- 所有远端 GitHub 仓库管理、Issue 跟踪与 Pull Request 流程**必须通过 GitHub CLI (`gh`) 命令行工具执行**。
- 文档与代码同批更新；架构与实体行为变化先同步更新本文档与 `metafusion-docs` 对应章节（两个仓库各自提交）。