# 能力清单与模块开关

## 1. 能力清单（`GET /api/capabilities`）

响应形状为 `{modules:[{id,version,dependencies,enabled,healthy}]}`：前端与定义编辑器都按 `id` 判断某项能力是否可用
（`CatalogProvider` 把 `modules` 放进全局 context）。形状保持稳定，前端不需要为能力来源变化改代码。

清单是**部署态声明**，由 `backend/internal/capabilities` 提供，与"哪个服务被部署了"一一对应：

| id | 承载 | `enabled` / `healthy` 的判定 |
| --- | --- | --- |
| `exchange` | 目录服务本进程 | 恒为 true |
| `community` | 互动服务（论坛/短评/收藏/私信） | 取决于是否配置 `COMMUNITY_URL` |
| `storage` | 存储服务 | 取决于是否配置 `STORAGE_URL` |

- **目录进程不发任何出站请求**：`enabled` 就是部署时声明了这个上游，`healthy` 与 `enabled` 同源（声明了即视为在场）。
  真正的存活判断在网关与运维面：`deploy/nginx.conf` 的 `/health/<service>` 逐上游探到各自的 `/ready`；目录服务自己也提供 `/health`。
- 这么定的理由：探活一旦留在目录进程里，目录只依赖 PostgreSQL 即可完整运行这条就名存实亡，而目录接口也不该因外围服务变慢或失败。
  证据与判据见 [多项目解耦审计与优化建议](./decoupling-audit-2026-09.md) §5。
- 互动相关的界面（论坛、短评、收藏）只由 `community` 一条声明控制：历史上与它指向同一上游的
  `records` 能力已随 `/api/records/*` 删除，多保留一条声明就等于给前端留一个没有承载物的入口。
- 能力在不在由部署决定，不由后台开关决定；网关的前缀分流与这份清单是两件事。

## 2. `PUT /api/admin/modules/:id` 是墓碑端点

恒定返回 `409`，响应体 `{"error":"module_toggle_retired","hint":"…"}`。

保留该路径是刻意的：旧前端拿到的是明确原因，而不是一个看不懂的 404。运行时开关与 `modules.settings` 表都不存在，
依赖级联与循环检测也随进程内模块层一起没有承载物。

## 3. 决议与待定

**决议（已落地，2026-09-16）**：目录服务不再主动探活上游。`enabled` 改为部署态声明，健康判断交给网关与运维面的 `/health/<service>` 探针；
每个运行单元一条声明。前端按 `id` 判断的消费方式保持不变。
实现见 `backend/internal/capabilities`（出站请求为 0，有测试钉住）；证据与判据见 [多项目解耦审计与优化建议](./decoupling-audit-2026-09.md) §5。

**仍待定**：

- 管理台是隐藏模块面板，还是改成服务健康只读面板？（后者需要前端改动，但运维价值更高）
- 健康聚合落在网关还是独立的运维面？（前者不需要新进程，但 nginx 不做 JSON 聚合）
