# 能力清单与模块开关

## 1. 能力清单（`GET /api/capabilities`）

响应形状为 `{modules:[{id,version,dependencies,enabled,healthy}]}`：前端与定义编辑器都按 `id` 判断某项能力是否可用
（`CatalogProvider` 把 `modules` 放进全局 context）。形状保持稳定，前端不需要为能力来源变化改代码。

清单是**部署态聚合**，由 `backend/internal/capabilities` 提供，与"哪个服务被部署了"一一对应：

| id | 承载 | `enabled` / `healthy` 的判定 |
| --- | --- | --- |
| `exchange` | 目录服务本进程 | 恒为 true |
| `community` | 账号之外的互动服务 | 取决于是否配置 `COMMUNITY_URL`；健康取该服务 `/health` 探测结果 |
| `records` | 互动服务 | 同 `community` |
| `storage` | 存储服务 | 取决于是否配置 `STORAGE_URL`；健康取该服务 `/health` 探测结果 |

- 探测只问 `/health`：它是各服务都提供、且不依赖数据库的存活端点，2 秒超时。
- 探测在后台每 30 秒刷新一次，请求路径只读缓存 —— 目录接口不能因为某个外围服务挂掉而变慢。
- 能力在不在由部署决定，不由后台开关决定；网关的前缀分流与这份清单是两件事。

## 2. `PUT /api/admin/modules/:id` 是墓碑端点

恒定返回 `409`，响应体 `{"error":"module_toggle_retired","hint":"…"}`。

保留该路径是刻意的：旧前端拿到的是明确原因，而不是一个看不懂的 404。运行时开关与 `modules.settings` 表都不存在，
依赖级联与循环检测也随进程内模块层一起没有承载物。

## 3. 决议与待定

**决议（推荐，待评审）**：目录服务不再主动探活上游。`enabled` 改为部署态声明，`healthy` 由网关或运维面读取各服务 `/health` 聚合；
目录进程不再持有 `COMMUNITY_URL`/`STORAGE_URL` 这类上游地址，`community` 与 `records` 也不再共用同一个变量。前端按 `id` 判断的消费方式保持不变。
理由、判据与分批见 [多项目解耦审计与优化建议](./decoupling-audit-2026-09.md) §5。

**仍待定**：

- 管理台是隐藏模块面板，还是改成服务健康只读面板？（后者需要前端改动，但运维价值更高）
- 健康聚合落在网关还是独立的运维面？（前者不需要新进程，但 nginx 不做 JSON 聚合）

