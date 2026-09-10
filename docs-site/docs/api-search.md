---
title: "Search 检索"
description: "全文检索：OpenSearch 2.x 驱动、SQL 降级，游客开放。"
order: 33
group: "api"
---

::: warning 文档与实现存在差异（一手提示）
**`GET /api/search` 不存在。** 当前检索为 `GET /api/catalog/entities?q=...`，服务端实现是 PostgreSQL 模糊/全文匹配（`title ILIKE` + `document->'translations'` 文本匹配，见 `backend/internal/catalog/store.go`）。

- 不存在：`GET /api/search?q=&type=&limit=&offset=`
- 不存在响应结构 `{ works, artists, releases, total }`；`/api/catalog/entities` 返回 `{ items, total }`
- OpenSearch 容器虽在 `deploy/docker-compose.yml` 中部署并注入 `ELASTICSEARCH_URL`，但当前 Go 代码中没有任何 OpenSearch 客户端调用，不要把它当作已生效的检索路径

**真实检索**：`GET /api/catalog/entities?q=<关键词>&kind=work&limit=10&offset=0`，以及兼容层 `GET /api/catalog/works?q=<关键词>`。
:::

# Search 检索

游客开放，与站内搜索同源。基于 **OpenSearch 2.x** 构建多语言分词与倒排索引；OpenSearch 离线时自动优雅降级为 SQL `ILIKE`，不阻塞可用性。

## 接口

::: danger 以下接口未实现
```http
GET /api/search?q=keyword&type=work&limit=10&offset=0
GET /api/search?q=久石让&type=artist&limit=10
GET /api/search?q=VIZL&type=release
GET /api/search?q=keyword&type=all&limit=5
```
:::

真实接口：

```http
GET /api/catalog/entities?q=keyword&kind=work&limit=10&offset=0
GET /api/catalog/entities?q=久石让&kind=agent&limit=10
GET /api/catalog/entities?q=VIZL&kind=release&limit=10
GET /api/catalog/works?q=keyword&limit=5
```

参数（`/api/catalog/entities`）：

| 参数 | 说明 |
|---|---|
| `q` | 检索关键词（映射到服务端 `ILIKE` 匹配） |
| `kind` | `agent` \| `collection` \| `work` \| `content_unit` \| `expression` \| `release` \| `medium` \| `track` |
| `type` / `status` | 动态类型与状态过滤 |
| `work_id` / `content_unit_id` / `release_id` / `medium_id` / `parent_id` | 关联过滤 |
| `field` / `value` | 按 `document` 内字段精确过滤 |
| `limit` / `offset` | 分页（`limit` 默认 20） |

## 示例

```bash
curl "/api/catalog/entities?q=blade+runner&kind=work&limit=5" -H "User-Agent: MyApp/1.0 (you@example.com)"

# 中文
curl "/api/catalog/entities?q=攻壳机动队&kind=work&limit=3" -H "User-Agent: MyApp/1.0 (you@example.com)"
```

响应（`/api/catalog/entities` 实际形状）：

```json
{
  "items": [
    {
      "id": "deadbeef-0000-4000-8000-000000000001",
      "kind": "work",
      "title": "攻壳机动队",
      "original_language": "ja",
      "translations": { "zh-CN": { "title": "攻壳机动队" }, "en-US": { "title": "Ghost in the Shell" } },
      "attributes": { "cover_aspect": "2:3" },
      "status": "published"
    }
  ],
  "total": 12
}
```

## 与前端联动

- 首页检索框直接跳至 `/explore?q=...`
- `/explore` 的搜索与 `GET /api/catalog/entities?q=...` 使用同一后端查询
- 详情页的关联推荐通过 `/api/catalog/entities` 的关联 id 过滤与 `GET /api/catalog/entities/:id/relations` 实现，非独立 Search 端点

## SEO

- 元数据页 SSR 可被爬虫收录
- 媒体二进制 URL 带鉴权且 `robots.txt` 禁止直链索引
