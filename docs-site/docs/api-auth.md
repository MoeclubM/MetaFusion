---
title: "认证与 API 密钥"
description: "JWT 与 API Key 访问凭证、注册开关、邀请码与限流规范。"
order: 31
group: "api"
---

::: warning 文档与实现存在差异（一手提示）
本页描述的部分认证端点**在当前后端不存在**（`backend/internal/catalog/http.go` 未注册）：

- `POST /api/auth/register`、`GET /api/auth/invite`：**不存在**（无公开自助注册与邀请端点）
- `GET|POST|DELETE /api/auth/tokens` 与 `mfp_` 前缀 PAT、`X-API-Key` 请求头：**不存在**（没有个人访问令牌体系）
- `GET /api/system/setup-status`、`POST /api/system/setup`：**不存在**，真实端点是不带 `system/` 前缀的 `GET|POST /api/setup`
- Access/Refresh 双 Token 轮转与 Redis 黑名单：**未实现**；当前为 RS256 短期访问令牌（15 分钟）+ 服务端会话兜底（24 小时），吊销为单实例内存

**真实端点**：`GET /api/setup`、`POST /api/setup`（首管初始化）、`POST /api/auth/login`、`POST /api/auth/refresh`（用当前令牌换发新令牌）、`GET /api/auth/me`、`GET /api/auth/settings`（实例准入能力）、`POST /api/auth/logout`、`PUT /api/auth/password`、`POST /api/auth/change-password`、`POST /api/auth/logout-all`、`GET|POST /api/admin/users`、`PUT /api/admin/users/:id/role|password`，以及 OAuth 2.0 / OIDC 的 `/api/oauth/clients|authorize|token|userinfo` 与 `/.well-known/openid-configuration|/oidc/jwks`。以 [OpenAPI](/api/openapi.json) 为准。
:::

# 认证与 API 密钥

## 两种凭证

| 凭证 | 获取方式 | 有效期 | 用途 |
|---|---|---|---|
| 会话令牌 / Cookie | `POST /api/auth/login` | 服务端会话决定 | 网页端与 API 调用 |
| OAuth 2.0 授权码 | `/api/oauth/authorize` + `POST /api/oauth/token` | 由客户端配置决定 | 第三方应用与 OIDC 接入 |

二者均可通过请求头或 Cookie 携带：

```http
Authorization: Bearer <session-token>
# 或
Cookie: mf_session=<session-token>
```

## 注册、登录与会话维护

::: danger 以下端点在当前实现中不存在
```http
POST /api/auth/register          # 不存在（无公开自助注册）
GET  /api/auth/invite            # 不存在
```
:::

真实端点：

```http
GET  /api/setup                  # 检查是否仍需初始化首管
POST /api/setup                  # { username, password } 创建首个管理员
POST /api/auth/login             # { username, password } → 用户信息 + 会话
POST /api/auth/refresh           # 用当前 Bearer/Cookie 令牌换发新令牌
GET  /api/auth/me                # 需认证：当前账号
GET  /api/auth/settings          # 未登录可读：实例准入能力
POST /api/auth/logout            # 注销当前会话
PUT  /api/auth/password          # 修改密码
POST /api/auth/change-password   # 修改密码（需旧密码）
POST /api/auth/logout-all        # 吊销该用户全部会话
```

登录响应结构以实际实现为准（字段为 `user` / `token` 等，见 `backend/internal/catalog/http.go`），不要依赖本页旧示例中的 `access_token` / `refresh_token` / `expires_in`。

- 账号由管理员通过 `POST /api/admin/users` 创建；不存在 `registration_enabled` / `invite_required` 注册开关端点
- 首次部署未初始化时用 `GET /api/setup` 检查状态，`POST /api/setup` 创建超级管理员

## API 密钥管理

::: danger 未实现
个人访问令牌（PAT）与 `/api/auth/tokens` 端点在当前实现中**不存在**；请使用会话令牌或 OAuth 2.0 客户端凭证。
:::

## 使用令牌调用

```bash
# 读（开放）
curl "/api/catalog/works?limit=10"

# 写（需登录会话）
curl -X POST /api/catalog/entities \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"entity":{"kind":"work","title":"新作品","original_language":"ja","translations":{"zh-CN":{"title":"新作品"}},"attributes":{"cover_aspect":"2:3"}},"expected_version":0,"edit_note":"initial import per official source","sources":[{"kind":"official","citation":"官网","url":"https://example.com"}]}'
```

## 限流

- 仅部分路由限流：`/api/catalog/entities` 120/min、`/api/catalog/compare` 10/min、`/api/setup` 与 `/api/auth/login` 有防爆破限制
- 超限返回 429 与 `Retry-After`；**不存在全站 `X-RateLimit-*` 响应头，也不校验 User-Agent**
