---
title: "Lookup 与 Browse"
description: "实体详情与按关联枚举的浏览接口。"
order: 32
group: "api"
---

::: warning 文档与实现存在差异（一手提示）
本页基于未实现的 WS/2 + Browse 范式，以下端点/参数**不存在**：

- `GET /api/catalog/releases/:id`（无按 kind 的 Release 详情路由；用 `GET /api/catalog/entities/:id`）
- `GET /api/ws/2/*` 全部别名（从未实现）
- `GET /api/browse/*` 全部端点（用 `/api/catalog/entities` 的关联 id 过滤替代）
- `inc=` 展开参数、`page` / `page_size` 分页、`fmt=json`（真实参数为 `q / kind / type / status / work_id / content_unit_id / release_id / medium_id / parent_id / field / value / limit / offset`）
- `GET /api/catalog/works`、`GET /api/catalog/works/:id`、`/works/:id/graph`、`/catalog/taxonomy`、`/catalog/relation-types`、`/catalog/artists/:id`、`/catalog/franchises/:id`、`/catalog/mediums/:id`、`/catalog/canonical-entries/:id`（旧兼容层已全部删除）

**真实可用**：`GET /api/catalog/entities`（带过滤/分页）、`GET /api/catalog/entities/:id`、`/resolve`、`/relations`、`/occurrences`、`/revisions`、`GET /api/catalog/tags`（标签频次聚合）。词表与类型请使用 `GET /api/catalog/definitions`。以 [OpenAPI](/api/openapi.json) 为准。
:::

# Lookup 与 Browse

## Lookup — 实体详情

```http
GET /api/catalog/entities/:id       # 通用实体详情
GET /api/catalog/entities/:id/resolve
GET /api/catalog/entities/:id/relations   # 响应含关系对端实体表
GET /api/catalog/entities/:id/occurrences   # 按 kind 收敛：expression=自身，content_unit/work=其表达
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

## 多维筛选

```http
GET /api/catalog/entities?q=keyword&kind=work&limit=24&offset=0
```

完整筛选参数为 `kind / type / status / q / field / value / work_id / content_unit_id / release_id / medium_id / parent_id / tags`。见 [编目体系](/taxonomy)。

## 图谱

独立 graph 端点不存在。用 `GET /api/catalog/entities/:id/relations` 的返回（关系边 + 对端实体表）在客户端构建 `{ nodes, links }` 拓扑。

## 分页

- `limit` / `offset`（`/api/catalog/entities`，`limit` 有服务端上限）
