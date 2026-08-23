---
title: "认证与 API 密钥"
description: "JWT 与 API Key 访问凭证、注册开关、邀请码与限流规范。"
order: 31
group: "api"
---

# 认证与 API 密钥

## 两种凭证

| 凭证 | 获取方式 | 有效期 | 用途 |
|---|---|---|---|
| JWT Bearer | `POST /auth/login` | 7 天 | 用户网页端会话 |
| API 密钥 (API Key) | `POST /auth/tokens`（需登录态） | 长期有效 | 外部程序、脚本与 Agent 调用平台 API |

二者均可通过 HTTP 请求头携带：

```http
Authorization: Bearer <token>
# 或
X-API-Key: <api_key>
```

## 注册与登录

```http
GET  /api/v1/auth/settings          # 公开：{ registration_enabled, invite_required }
POST /api/v1/auth/register          # { username, email, password, invite_code? }
POST /api/v1/auth/login             # { email_or_username, password } → { user, token }
GET  /api/v1/auth/me                # 需认证
```

- `registration_enabled=false` 时注册关闭
- `invite_required=true` 时必填邀请码
- `invite_required=false` 时邀请码可选

## API 密钥管理

用户可在前台 `/settings?tab=tokens` 或通过接口管理自己的 API 密钥：

```http
GET  /api/v1/auth/tokens            # 列出当前用户的 API 密钥
POST /api/v1/auth/tokens            # 创建新 API 密钥，明文仅在创建时返回一次
DELETE /api/v1/auth/tokens/:id      # 撤销指定的 API 密钥
```

### 创建示例

```bash
# 创建读写密钥 (默认)
curl -X POST /api/v1/auth/tokens \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"name":"my-script","scopes":["read","write"]}'

# 创建只读密钥 (Read-Only)
curl -X POST /api/v1/auth/tokens \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"name":"readonly-agent","scopes":["read"]}'
```

- **只读密钥 (`scopes: ["read"]`)**：仅允许 GET 检索与查询实体，禁止任何创建、修改或删除操作。
- **读写密钥 (`scopes: ["read", "write"]`)**：允许调用前台开放的所有检索与编目提交流程。

## 邀请信息

```http
GET /api/v1/auth/invite  # 需认证 → { invite_code, invited_count, invited_users }
```

`InviteCode` 为 `MF-` 永久码。

## 使用 PAT 调用

```bash
# 读（开放，PAT 可选）
curl "/api/v1/catalog/works?inc=artists&page=1" -H "User-Agent: MyApp/1.0 (you@example.com)"

# 写（需 PAT/JWT）
curl -X POST /api/v1/catalog/works \
  -H "Authorization: Bearer mfp_..." \
  -H "User-Agent: MyApp/1.0 (you@example.com)" \
  -H "Content-Type: application/json" \
  -d '{"title":"新作品","tags":["动画","电影"],"cover_aspect":"2:3","edit_note":"initial import","source_urls":["https://..."]}'
```

## 限流与 User-Agent

- 匿名 60/min，认证 600/min
- 未设置有意义 `User-Agent` 的写入请求返回 400（MusicBrainz 同款要求，便于滥用溯源）
- 响应头含 `X-RateLimit-Limit / Remaining / Reset`
