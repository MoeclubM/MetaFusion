---
title: "Search 检索"
description: "全文检索：OpenSearch 2.x 驱动、SQL 降级，游客开放。"
order: 33
group: "api"
---

# Search 检索

游客开放，与站内搜索同源。基于 **OpenSearch 2.x** 构建多语言分词与倒排索引；OpenSearch 离线时自动优雅降级为 SQL `ILIKE`，不阻塞可用性。

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
| `q` | 必填，检索关键词 |
| `type` | `work` \| `artist` \| `release` \| `franchise` \| `all`（默认 work） |
| `limit` | 默认 25，最大 100 |
| `offset` | 分页偏移 |

## 示例

```bash
curl "/api/v1/search?q=blade+runner&type=work&limit=5" -H "User-Agent: MyApp/1.0 (you@example.com)"

# 中文
curl "/api/v1/search?q=攻壳机动队&type=work&limit=3" -H "User-Agent: MyApp/1.0 (you@example.com)"
```

响应（示意）：

```json
{
  "works": [
    {
      "id": "deadbeef-0000-4000-8000-000000000001",
      "title": "攻壳机动队",
      "original_title": "GHOST IN THE SHELL",
      "tags": ["动画", "电影", "科幻", "赛博朋克"],
      "cover_aspect": "2:3",
      "release_year": 1995
    }
  ],
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
