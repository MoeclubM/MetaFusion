---
title: "API 概览"
description: "MusicBrainz WS/2 风格的开放 API：Lookup / Browse / Search 与 OpenAPI。"
order: 30
group: "api"
---

::: warning 文档与实现存在差异（一手提示）
MetaFusion **不是** MusicBrainz WS/2 风格 API，下列本页提及的端点/参数在当前实现中**并不存在**：

- `GET /api/ws/2/*`（WS/2 兼容层从未实现）
- `GET /api/search`（现为 `GET /api/catalog/entities?q=...`，服务端为 PostgreSQL 模糊/全文匹配）
- `GET /api/browse/*`（现为 `GET /api/catalog/entities?kind=...&<关联 id 过滤>`）
- `POST /api/auth/tokens`（PAT 管理端点缺失；当前仅有会话 Cookie + Bearer）
- `inc=artists+releases+...` 展开参数与 `page` / `page_size` 分页（现为 `limit` / `offset` 与各实体独立字段）
- `catalog` 写入并非 RESTful 逐实体端点，统一为 `POST|PUT /api/catalog/entities`

**真实主干**：读 `GET /api/catalog/definitions`、`/api/catalog/entities`、`/api/catalog/entities/:id`、`/api/catalog/entities/:id/relations|revisions|occurrences`、`/api/catalog/compare`、`/api/catalog/works`（兼容层）、`/api/catalog/shelves`、`/api/catalog/external-databases`；写 `POST /api/catalog/entities`、`PUT /api/catalog/entities/:id`、`POST /api/catalog/relations`、`PUT|DELETE /api/catalog/relations/:id`、`POST /api/catalog/entities/:id/lifecycle`；收藏 `POST /api/favorites/toggle`、`GET /api/favorites/status`、`GET /api/favorites/mine`、`GET /api/users/:id/favorites`；导入 `POST /api/importer/preview`、`POST /api/importer/import`；认证 `/api/setup`、`/api/auth/*`、`/api/oauth/*`。以 [OpenAPI](/api/openapi.json) 与 `backend/internal/catalog/http.go` 为准。
:::

# API 概览

MetaFusion 提供 MusicBrainz WS/2 风格的开放编目 API，适合自建应用与 Agent 接入。**所有网页端功能均可经 API 复现。**

## 基础信息

- **Base URL**：`/api`（网关统一透传至 `backend:8080`）
- **OpenAPI 规范**：[GET /api/openapi.json](/api/openapi.json)（OpenAPI 3.0.3 规范，含全量 Paths 与 Schemas）
- **交互式文档中心**：[Scalar 交互式参考 (/api/docs)](/api/docs) 与 [Swagger UI (/api/swagger)](/api/swagger)
- **认证**：会话 Cookie（`mf_session`）或 `Authorization: Bearer <session token>`；`/api/oauth/*` 提供 OAuth 2.0 / OIDC 端点
- **限流**：仅在少数重型/敏感路由生效（如 `/api/catalog/entities` 120/min、`/api/catalog/compare` 10/min、`/api/setup` 与 `/api/auth/login` 防爆破），超限返回 429 + `Retry-After`。**不存在全站 `X-RateLimit-*` 响应头**

## 能力分组

| 能力 | 真实端点 | 认证 |
|---|---|---|
| **实体查询** | `GET /api/catalog/entities`（`kind`/`q`/关联 id 过滤） | 开放 |
| **实体详情** | `GET /api/catalog/entities/:id`、`/resolve`、`/relations`、`/occurrences`、`/revisions` | 开放 |
| **写入** | `POST|PUT /api/catalog/entities`、`/api/catalog/relations`、`/lifecycle` | 需登录/管理员 |
| **对比** | `GET /api/catalog/compare?ids=a,b` | 开放 |
| **收藏** | `POST /api/favorites/toggle`、`GET /api/favorites/status`、`/api/favorites/mine`、`/api/users/:id/favorites` | 切换/自列需登录 |

## 访问模型

- **元数据开放**：`/api/catalog/*` 读接口无需鉴权，可被搜索引擎收录
- **写入受控**：实体/关系写入需登录，`lifecycle` 合并/退役需管理员；媒体二进制走可选 `archive` / `playback` 模块，强制登录

## 认证方式

见 [认证与 PAT](/api-auth)：

- **会话**：`POST /api/auth/login` 返回令牌并写入 HttpOnly Cookie `mf_session`（当前实现无 Refresh Token 轮转端点）
- **OAuth 2.0 / OIDC**：`/api/oauth/authorize`、`/api/oauth/token`、`/api/oauth/userinfo`

凭证以 `Authorization: Bearer <token>` 或 Cookie 携带。**不存在 `mfp_` PAT、`X-API-Key` 或 `/api/auth/tokens`。**

## 快速试玩（无需登录）

```bash
curl "/api/catalog/works?limit=3" -H "User-Agent: MyApp/1.0 (you@example.com)"
curl "/api/catalog/entities?q=攻壳机动队&kind=work&limit=3" -H "User-Agent: MyApp/1.0 (you@example.com)"
curl "/api/catalog/entities/<id>" -H "User-Agent: MyApp/1.0 (you@example.com)"
```

## 分页与展开

- 分页：`limit`（默认 20）、`offset`；`/api/catalog/entities` 另有 `kind / type / status / q / field / value / work_id / content_unit_id / release_id / medium_id / parent_id`
- `/api/catalog/works` 兼容层使用自身分页字段，含真实 `COUNT` 总数
- **不存在 `inc` 展开参数与 `page` / `page_size`**；响应统一为 JSON

## 错误与审计

- 401：未认证（需写入或模块资源）
- 400：参数或 payload 错误
- 409：乐观锁版本冲突（写入前需读取当前 `version`）
- 429：命中限流（仅部分路由）
- 写入会生成 revision；具体审计范围以技能契约为准，不要假定所有端点都强制 `edit_note` / `source_urls`

下一节：[认证与 PAT](/api-auth)
