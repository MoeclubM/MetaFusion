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

多值过滤：`kinds` / `types` 可用逗号分隔或重复出现，命中任一即返回。用于关系编辑器的对端候选
（`kind` 与动态业务类型同时约束），命中在服务端完成，不会因先取固定条数而被截断：

```http
GET /api/catalog/entities?kinds=work,collection&types=album,song&limit=24
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

完整筛选参数为 `kind / kinds / type / types / status / q / field / value / work_id / content_unit_id / release_id / medium_id / parent_id / tags / limit / offset`。见 [编目体系](/taxonomy)。

### 嵌套字段筛选（field 点分路径）

`field` 支持点分路径，沿 definitions 递归解析：`group` 逐层下钻，`list` 中途节点按"任一元素命中"
（`jsonb_array_elements` 的 `EXISTS`）比较，叶子保持与单层一致的等值语义（`->>` 文本比较）。
要求叶子 `searchable` 为 true 且链路上所有字段 `enabled`，否则返回 `field_not_searchable`；
未知路径返回 `unknown_field`。单层 `field=value` 行为不变。

```http
GET /api/catalog/entities?field=attachments.store&value=<agent_id>
GET /api/catalog/entities?field=store_bonuses.channel&value=animate&kind=release
```

结构属性伪字段命中收录/发行对象表而非实体 attributes，编译成 `EXISTS` 子查询：

- `locator.<子字段>`：收录位置（`catalog.track_contents.locator`），列表语境 `kind=track`
- `inclusion_attributes.<子字段>`：收录附加属性（`catalog.track_contents.attributes`），`kind=track`
- `subject_attributes.<子字段>`：发行对象附加属性（`catalog.release_subjects.attributes`），`kind=release`

```http
GET /api/catalog/entities?kind=track&field=locator.path&value=/disc1/chapter01
GET /api/catalog/entities?kind=track&field=inclusion_attributes.translator&value=<agent_id>
GET /api/catalog/entities?kind=release&field=subject_attributes.seq&value=1
```

`kind` 与伪字段归属显式不匹配时（如 `kind=release` 配 `locator.path`）谓词恒假、返回空集，
而不是报错；不传 `kind` 时按 `EXISTS` 自然过滤。子字段是否可用以
`GET /api/catalog/definitions` 为准（含后台新增的子字段）。

## 图谱

独立 graph 端点不存在。用 `GET /api/catalog/entities/:id/relations` 的返回（关系边 + 对端实体表）在客户端构建 `{ nodes, links }` 拓扑。

## 分页

- `limit` / `offset`（`/api/catalog/entities`，`limit` 有服务端上限）
