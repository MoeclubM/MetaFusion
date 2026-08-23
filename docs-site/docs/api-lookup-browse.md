---
title: "Lookup 与 Browse"
description: "实体详情的 inc 展开与按关联枚举的浏览接口。"
order: 32
group: "api"
---

# Lookup 与 Browse

## Lookup — 实体详情

对应网页端详情页，支持 `inc` 与 `fmt=json`。

```http
GET /api/v1/catalog/works/:id?inc=releases+relations+revisions&fmt=json
GET /api/v1/catalog/releases/:id?inc=relations+revisions
GET /api/v1/catalog/artists/:id?inc=works+releases
GET /api/v1/catalog/mediums/:id

# WS/2 兼容别名
GET /api/v1/ws/2/work/:id?inc=releases+artists
GET /api/v1/ws/2/release/:id
GET /api/v1/ws/2/artist/:id
```

`inc` 取值（空格或 `+` 分隔）：

- `artists`：ArtistRelations 展开
- `releases`：首 50 发行版
- `relations`：EntityRelationship 图谱边
- `revisions`：最近 20 条修订
- `tags / mediums / tracks`：按实体类型

示例：

```bash
curl "/api/v1/catalog/works/<work_id>?inc=releases+artists" -H "User-Agent: MyApp/1.0 (you@example.com)" | jq .
```

## Browse — 按关联枚举

对应探索页与关联列表，支持分页与 `inc`。

```http
GET /api/v1/browse/works?artist=<artist_id>&tag=<tag>&page=1&page_size=24&inc=artists
GET /api/v1/browse/releases?artist=<artist_id>&work=<work_id>&inc=work
GET /api/v1/browse/artists?work=<work_id>&collaborator=<artist_id>&q=keyword
```

JS 示例：

```js
const works = await fetch("/api/v1/browse/works?artist=" + artistId + "&inc=artists", {
  headers: { "User-Agent": "MyApp/1.0 (you@example.com)" }
}).then(r => r.json());

const releases = await fetch("/api/v1/browse/releases?work=" + workId).then(r => r.json());
```

## 作品列表的多维筛选（ListWorks）

```http
GET /api/v1/catalog/works?q=keyword&tags=动画,电影&tag_match=all&shelf=<shelf>&language=zh-CN&sort=view_count&page=1&page_size=24&inc=artists
```

与前端 `/explore` 筛选器一一对应，见 [编目体系](/taxonomy)。

## 图谱

```http
GET /api/v1/catalog/works/:id/graph
GET /api/v1/catalog/artists/:id/graph
```

返回 `{ nodes: GraphNode[], links: GraphLink[] }`，用于可视化协作网络。

## 分页

- `page` / `page_size`（catalog/browse，`page_size` ≤ 100）
- 响应含 `total / page / page_size / items`
