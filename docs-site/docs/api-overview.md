---
title: "API 概览"
description: "MusicBrainz WS/2 风格的开放 API：Lookup / Browse / Search 与 OpenAPI。"
order: 30
group: "api"
---

# API 概览

MetaFusion 提供 MusicBrainz WS/2 风格的开放编目 API，适合自建应用与 Agent 接入。**所有网页端功能均可经 API 复现。**

## 基础信息

- **Base URL**：`/api/v1`（网关透传至 `backend:8080`）
- **OpenAPI 规范**：[GET /api/v1/openapi.json](/api/v1/openapi.json)（OpenAPI 3.1 格式，含完整 Paths 与 Schemas）
- **PAT 管理**：登录后在 [设置 → PAT 令牌](/settings?tab=tokens) 页面创建长期调用凭证
- **User-Agent 要求**：所有请求建议携带有意义的 `User-Agent: MyApp/1.0 (you@example.com)`，写入请求未设置将返回 400
- **限流**：匿名 60/min，认证 600/min，响应头 `X-RateLimit-*`

## 三元组

| 能力 | 对应网页 | 认证 |
|---|---|---|
| **Lookup**：单实体详情 + `inc` 展开 | 详情页 | 读开放，写需认证 |
| **Browse**：按关联实体枚举 | 探索/关联列表 | 开放 |
| **Search**：全文检索（OpenSearch/SQL 降级） | 搜索 | 开放 |

## 访问模型

- **元数据开放**：`catalog/*`、`search`、`community` 读接口、`taxonomy` 等无需鉴权，可被搜索引擎收录
- **媒体与写入受控**：`storage/*`、`catalog` 写入、`community` 写入、私信等需 `Authorization: Bearer <JWT|PAT>`

## 认证方式

见 [认证与 PAT](/api-auth)：

- **JWT Bearer**：`POST /auth/login` 获取，Access Token 2h + Refresh Token 7d
- **PAT `mfp_`**：登录后 `POST /auth/tokens` 创建，长期，支持 `scopes: read/write/edit/upload/community/admin`

两种凭证均写入 `Authorization: Bearer <token>`，也支持 `X-API-Key: mfp_...`。

## 快速试玩（无需登录）

```bash
curl "/api/v1/search?q=攻壳机动队&type=work&limit=3" -H "User-Agent: MyApp/1.0 (you@example.com)"
curl "/api/v1/catalog/works/<id>?inc=releases+artists" -H "User-Agent: MyApp/1.0 (you@example.com)"
curl "/api/v1/browse/works?artist=<artist_id>&inc=artists" -H "User-Agent: MyApp/1.0 (you@example.com)"
```

## 分页与展开

- 分页：`page`（默认 1）、`page_size`（默认 20，最大 100）、`limit/offset`（search）
- 展开：`inc=artists+releases+relations+revisions`（`+` 或空格分隔）
- 格式：`fmt=json`（目前仅 JSON）

## 错误与审计

- 401：未认证（L1 资源）
- 400：参数错误 / 缺少 User-Agent
- 429：限流
- 所有 L1 写入与媒体资产（CAS / AssetRegistry）访问经 `admin_audit_logs` 记录 `actor/target/ip/ua`

下一节：[认证与 PAT](/api-auth)
