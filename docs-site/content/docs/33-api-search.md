---
title: "Search 检索"
description: "全文检索：ES 优先、SQL 降级，游客开放。"
order: 33
group: "api"
---

# Search 检索

游客开放，与站内搜索同源。ES 离线时自动降级为 SQL `ILIKE`，不阻塞可用性。

## 接口

```http
GET /api/v1/search?q=keyword&type=work&limit=10&offset=0
GET /api/v1/search?q=久石让&type=artist&limit=10
GET /api/v1/search?q=VIZL&type=release
GET /api/v1/search?q=keyword&type=all&limit=5
```

参数：

| 参数 | 说明 |
|---|---|
| `q` | 必填，Lucene 风格关键词 |
| `type` | `work` \| `artist` \| `release` \| `all`（默认 all） |
| `limit` | 默认 10，最大 50 |
| `offset` | 分页偏移 |

## 在线试玩

```playground
```

## 示例

```bash
curl "/api/v1/search?q=blade+runner&type=work&limit=5" -H "User-Agent: MyApp/1.0 (you@example.com)"

# 中文
curl "/api/v1/search?q=攻壳机动队&type=work&limit=3" -H "User-Agent: MyApp/1.0 (you@example.com)"
```

响应（示意）：

```json
{
  "works": [{ "id": "...", "title": "攻壳机动队", "media_type": "anime" }],
  "artists": [],
  "releases": [],
  "total": 12
}
```

## 与前端联动

- 首页终端搜索框 `EXECUTE` 直接跳至 `/explore?q=...`
- `/explore` 的搜索与 `GET /catalog/works?q=...` 复用同一套索引
- 详情页的关联推荐通过 `Browse` 与图谱实现，非 Search

## SEO

- 元数据页 SSR 可被爬虫收录
- 媒体二进制 URL 带鉴权且 `robots.txt` 禁止直链索引
