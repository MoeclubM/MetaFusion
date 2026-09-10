---
title: "Lookup 与 Browse"
description: "实体详情的 inc 展开与按关联枚举的浏览接口。"
order: 32
group: "api"
---

::: warning 文档与实现存在差异（一手提示）
本页基于未实现的 WS/2 + Browse 范式，以下端点/参数**不存在**：

- `GET /api/catalog/releases/:id`（无按 kind 的 Release 详情路由；用 `GET /api/catalog/entities/:id`）
- `GET /api/ws/2/*` 全部别名（从未实现）
- `GET /api/browse/*` 全部端点（用 `/api/catalog/entities` 的关联 id 过滤替代）
- `inc=` 展开参数、`page` / `page_size` 分页、`fmt=json`（真实参数为 `q / kind / type / status / work_id / content_unit_id / release_id / medium_id / parent_id / field / value / limit / offset`）
- `GET /api/catalog/artists/:id/graph`（仅存在 `GET /api/catalog/works/:id/graph`）

**真实可用**：`GET /api/catalog/entities`（带过滤/分页）、`GET /api/catalog/entities/:id`、`/resolve`、`/relations`、`/occurrences`、`/revisions`；此外还有只读兼容路由 `GET /api/catalog/works/:id`、`/artists/:id`、`/franchises/:id`、`/mediums/:id`、`/canonical-entries/:id`、`/taxonomy`、`/tags`、`/relation-types`。以 [OpenAPI](/api/openapi.json) 为准。
:::

# Lookup 与 Browse

## Lookup — 实体详情

对应网页端详情页，支持 `inc` 与 `fmt=json`。

```http
GET /api/catalog/works/:id          # 兼容层：前端详情页形状
GET /api/catalog/entities/:id       # 通用实体详情（推荐）
GET /api/catalog/entities/:id/relations
GET /api/catalog/entities/:id/occurrences
GET /api/catalog/entities/:id/revisions
```

`inc` 取值（空格或 `+` 分隔）：**当前实现不支持 `inc`，以下仅为旧设计说明，请勿使用**。

- `artists`：ArtistRelations 展开
- `releases`：首 50 发行版
- `relations`：EntityRelationship 图谱边
- `revisions`：最近 20 条修订
- `tags / mediums / tracks`：按实体类型

示例：

```bash
curl "/api/catalog/entities/<id>" -H "User-Agent: MyApp/1.0 (you@example.com)" | jq .
curl "/api/catalog/entities/<id>/relations" -H "User-Agent: MyApp/1.0 (you@example.com)" | jq .
```

## Browse — 按关联枚举

对应探索页与关联列表。**当前实现不支持 `/api/browse/*`**，请用 `/api/catalog/entities` 的过滤参数：

```http
GET /api/catalog/entities?kind=work&q=keyword&limit=24&offset=0
GET /api/catalog/entities?kind=release&work_id=<work_id>&limit=24
GET /api/catalog/entities?kind=medium&release_id=<release_id>
```

JS 示例：

```js
const works = await fetch("/api/catalog/entities?kind=work&q=" + encodeURIComponent(keyword), {
  headers: { "User-Agent": "MyApp/1.0 (you@example.com)" }
}).then(r => r.json());

const releases = await fetch("/api/catalog/entities?kind=release&work_id=" + workId).then(r => r.json());
```

## 作品列表的多维筛选（ListWorks）

```http
GET /api/catalog/works?q=keyword&limit=24&offset=0
```

`/api/catalog/works` 为前端兼容层；完整筛选请使用 `/api/catalog/entities` 的 `kind / type / status / field / value / work_id / content_unit_id / release_id / medium_id / parent_id` 参数。见 [编目体系](/taxonomy)。

## 图谱

```http
GET /api/catalog/works/:id/graph
```

返回 `{ nodes: GraphNode[], links: GraphLink[] }`，用于可视化协作网络。**注意：Artist 图谱端点不存在。**

## 分页

- `limit` / `offset`（`/api/catalog/entities`，`limit` 有服务端上限）
- `/api/catalog/works` 兼容层另有自身的分页字段
