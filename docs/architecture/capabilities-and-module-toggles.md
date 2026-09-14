# 能力清单与模块开关的归宿（P4 决策稿）

## 0. 落地结果（已完成，2026-09）

采用**方案 A**，已在切流时落地：

- `GET /api/capabilities` 保留原响应形状，数据来源改为「上游是否配置（`COMMUNITY_URL` / `STORAGE_URL`）+ 后台 `/health` 探测」，
  实现从 `modules.Manager` 移到 `backend/internal/capabilities`；前端只需继续读同一个 id（当前唯一门控是 `community`）。
- `PUT /api/admin/modules/:id` 退役，返回 `409 module_toggle_retired`；运行时开关与 `modules.settings` 表一并消失。
- `modules` / `moduleapi` / `moduledeps` 三个包与 `modules` schema 已删除（schema 由 `./deploy.sh retire` 清理）。

下面是当时的决策过程，保留以便追溯「为什么这样改」。

切流前必须回答的问题：单体里的 `/api/capabilities` 与 `PUT /api/admin/modules/:id` 在拆分后代表什么。
本文只描述现状、消费者与候选方案，**不改动运行时行为**。

## 1. 现状

| 端点 | 实现 | 语义 |
| --- | --- | --- |
| `GET /api/capabilities` | `modules.Manager.Manifests()` | 返回进程内注册的六个模块（`archive`、`playback`、`media`、`community`、`records`、`exchange`）的 `{id,version,dependencies,enabled,healthy}` |
| `PUT /api/admin/modules/:id` | `Manager.Set` + `modules.settings` 表 | 运行时启停模块，并按 `moduledeps`（412 行）做依赖级联与循环检测 |

模块开关不只是展示：没有启用的模块，其路由会在 `guard` 里直接拒绝。

## 2. 谁在消费（已核对前端调用点）

| 调用点 | 用途 | 影响面 |
| --- | --- | --- |
| `frontend/src/components/catalog/CatalogProvider.tsx:28` | 把 `modules` 放进全局 context | 多处 UI 依赖"某能力是否可用" |
| `frontend/src/app/admin/page.tsx:83` | 管理台模块面板列表 | 展示 enabled/healthy |
| `frontend/src/app/admin/page.tsx:176` | 切换模块开关 | 写入 |
| `frontend/src/components/catalog/DefinitionsEditor.tsx:406` | 定义编辑器里切换模块 | 写入 |

也就是说：**这两个端点是对前端的公开契约**，直接删会破坏目录界面与管理台。

## 3. 拆分后的语义问题

拆分后文件与下载由 metafusion-storage 承载（能力 id 统一为 `storage`；原 `archive`/`playback`/`media` 三项里的后两项是转码与媒体分析，已明确不做）、`community/records` 由 metafusion-community 承载，
它们不再是"进程内可开关的模块"，而是**独立部署单元**：服务没部署就没有该能力，服务挂了能力就不可用。

继续保留"运行时开关"会产生双重语义：把 `community` 关掉只关掉了单体里那份实现，
而 community 服务仍在跑、网关仍可能把流量送过去——这与"各司其职"直接冲突。

## 4. 候选方案

### 方案 A（推荐）：能力清单改为部署态聚合，开关退役

- `GET /api/capabilities` 保留**同一响应形状** `{modules:[{id,version,dependencies,enabled,healthy}]}`，
  但数据来源改为：探测 `AUTH_URL`/`COMMUNITY_URL`/`STORAGE_URL` 的 `/health`（1–2 秒超时），
  加上本进程的 `catalog`；`enabled` 表示"已配置该上游"，`healthy` 表示探测结果。
  形状不变 ⇒ **前端零改动**。
- `PUT /api/admin/modules/:id` 退役：返回 `409 module_toggle_retired`，管理台把该面板改为"服务健康"只读视图
  （或用 `NEXT_PUBLIC_*` 开关在未引入健康视图前先隐藏面板）。
- `moduledeps`（412 行）随单体 `modules` 包一起删除；依赖治理能力在部署编排层体现。

判据：`curl -s /api/capabilities | jq '.modules[].id'` 在切流前后都能拿到前端认识的 id 集合。

### 方案 B：保留运行时开关，引入控制面

需要网关或 catalog 持有"服务开关"配置并影响分流（例如 nginx 映射表热更新）。
复杂度高、且与"独立系统"目标相悖，仅在确实需要"在线摘除某能力"时才值得做。

### 方案 C：两个端点直接删除

最干净，但必须同步改造前端（CatalogProvider 的 `modules` 退化、管理台面板报错），
属于"破坏性变更"，与当前"不破坏既有契约"的约束冲突。

## 5. 落地顺序（全部已完成）

1. ~~P4 切流完成后，catalog 的 `Manifests()` 改为聚合实现（README/OpenAPI 同步）~~ —— 已完成（`internal/capabilities`）；
2. ~~管理台模块面板改为只读健康视图~~ —— 未改前端：面板沿用同一份清单数据，写入路径返回 409 后按错误提示处理；
3. ~~单体删除 `modules`/`moduleapi`/`moduledeps` 三个包与 `modules.settings` 表~~ —— 已完成（三个包删除，表由 `./deploy.sh retire` 清理）。

## 6. 需要拍板

- 管理台是隐藏模块面板，还是改成"服务健康"只读面板？（后者需要前端改动，但运维价值更高）
- `/api/capabilities` 是否允许由 catalog 承担聚合职责（引入对三个服务的浅探测）？
  若不希望 catalog 依赖其他服务，替代做法是把该端点整个挪到网关（前端改一个 base 配置）。
