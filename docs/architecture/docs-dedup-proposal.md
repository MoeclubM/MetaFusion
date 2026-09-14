# 文档站去重提案（P5）

现状：同一批文档存在**两份**，且已经分叉。

| 位置 | 提交数 | 最后更新 | 角色 |
| --- | --- | --- | --- |
| 主仓库 `docs-site/docs` | 持续提交 | 2026-09-14 | 一直在维护，内容与当前实现对齐（含"未实现"提示） |
| `metafusion-docs` 仓库 `docs/` | **1 个提交** | 2026-09-06 | 初始化快照，之后未再同步 |

两边各 26 篇 md：12 篇逐字节相同，14 篇已分叉。**关键证据：新快照不是"更新的版本"**——
它仍写着旧草案里的 `/api/v1/storage/upload/initiate`（不存在的前缀）与旧术语 `CanonicalEntry`，
而主仓库那份已经改成了当前契约并加了状态提示。所以内容方向应当是"主仓库 → metafusion-docs"，不是反过来。

## 分叉明细（行数与独有行统计）

| 文件 | 主仓库行数（最后更新） | 新仓库行数 | 仅在主仓库有 | 仅在新仓库有 |
| --- | --- | --- | --- | --- |
| agent-integration.md | 430（09-14） | 432 | 60 | 48 |
| api-agent.md | 264（09-13） | 250 | 21 | 8 |
| api-auth.md | 66（09-14） | 83 | 42 | 54 |
| api-edit.md | 94（09-14） | 68 | 64 | 40 |
| api-lookup-browse.md | 84（09-14） | 57 | 49 | 26 |
| api-overview.md | 57（09-13） | 45 | 33 | 21 |
| api-search.md | 69（09-13） | 53 | 35 | 22 |
| api-storage.md | 103（09-10） | 92 | 14 | 4 |
| catalog.md | 85（09-14） | 77 | 11 | 3 |
| curation-guide.md | 236（09-12） | 227 | 39 | 30 |
| editing-guide.md | 54（09-11） | 53 | 3 | 2 |
| frbr-model.md | 206（09-14） | 198 | 33 | 25 |
| overview.md | 39（09-14） | 39 | 2 | 2 |
| taxonomy.md | 55（09-14） | 58 | 12 | 15 |

"仅在主仓库有"的行数普遍远大于反向：主仓库是更新的一侧。

**抽样核对结论（逐条看过"仅在新仓库"的内容）**：反向独有的行**全部是旧架构草案**，不是遗漏的新内容。
证据（原文摘录）：

| 文件 | 仅在新仓库的典型行 | 判定 |
| --- | --- | --- |
| api-auth.md | `POST /api/v1/auth/refresh`、`X-API-Key`、`POST /auth/tokens`、"Access 2h + Refresh 7d 双令牌 + Redis 黑名单" | 旧草案：本项目**没有** `/api/v1` 前缀，也没有 PAT/API Key 与 Redis 黑名单（主仓库那份已明确标注"未实现"） |
| api-edit.md | `POST /api/v1/catalog/works|artists|canonical-entries|releases|mediums|tracks|franchises`、`PUT /api/v1/catalog/entity-relations` | 旧草案：v2 已收敛为统一实体入口 `POST /api/catalog/entities` + 动态定义 |
| agent-integration.md | 流程图画布里的 `GET /api/v1/search`、`CanonicalEntry`、`phonographic_copyright` | 旧草案：`CanonicalEntry` 已退役为 `content_unit`/`expression` |
| api-storage.md | `POST /api/v1/storage/upload/initiate` 等 | 旧草案：前缀错，且当前契约已在 metafusion-storage 落地 |
| catalog.md / overview.md / editing-guide.md | `metafusion-catalog` 命名、`CanonicalEntry` 层级表 | 旧术语 |

因此合并时**不需要逐段取舍**：以主仓库内容为准整篇覆盖即可，新仓库的独有行直接丢弃。
下面这张表因此只用于"确认没有意外删掉东西"，不再作为取舍依据。

## 建议方案

**方案 A（推荐）：`metafusion-docs` 作为唯一发布仓库，主仓库不再保留文档副本。**

1. 把主仓库 `docs-site/docs` 的最新内容同步进 `metafusion-docs/docs`（保留后者的 VitePress 配置与构建）；
2. 逐篇复核 14 个分叉文件，确认新快照里"仅在新仓库有"的内容是否还有价值（大概率是过时草案，直接丢弃）；
3. 主仓库移除 `docs-site/`，`deploy/docker-compose.yml` 的 `docs-site` 服务改指向 `metafusion-docs` 的镜像，
   或把该仓库作为 submodule/构建依赖引入；
4. 顺带把 `api-storage.md` 的状态提示从"本页整体未实现"改为"契约已由 metafusion-storage 实现、待切流"。

**方案 B：主仓库继续作为内容源，`metafusion-docs` 只做镜像发布**（CI 单向同步）。
优点是改动小；缺点是仓库里仍有两份内容，只是靠流水线保持一致，仍可能出现"改了一份忘了同步"。

两种方案都不影响当前切流进度；**P5 只需要一个决定：唯一源放在哪一边**。

配套事实：网关把 `/docs/` 反代到 `docs:3001`；主仓库 compose 的文档容器也叫 `metafusion-docs`（同一名字、同一端口），
因此无论选哪个方案，都必须保证**只部署一份**，否则同名容器/端口会冲突。
