---
title: "认证与 PAT"
description: "JWT 与 mfp_ 令牌、注册开关、邀请码与限流。"
order: 31
group: "api"
---

# 认证与 PAT

## 两种凭证

| 凭证 | 获取 | 有效期 | 用途 |
|---|---|---|---|
| JWT Bearer | `POST /auth/login` | 7 天 | 短期会话、创建 PAT |
| PAT `mfp_` | `POST /auth/tokens`（需 JWT） | 长期（可设 `expires_at`） | 应用/Agent 长期接入 |

二者均写入：

```http
Authorization: Bearer <token>
# 或
X-API-Key: mfp_...
```

## 注册与登录

```http
GET  /api/v1/auth/settings          # 公开：{ registration_enabled, invite_required }
POST /api/v1/auth/register          # { username, email, password, invite_code? }
POST /api/v1/auth/login             # { email_or_username, password } → { user, token }
GET  /api/v1/auth/me                # 需认证
```

- `registration_enabled=false` 时注册拒绝，文案 `auth.registration_closed`
- `invite_required=true` 时必填 `invite_code`，经 `resolveInviterID` 校验（`users.invite_code` → `invitations.code` → 专属邀请码 → admin 回退）
- `invite_required=false` 时 `invite_code` 可选，填则校验、不填直注

## PAT 管理（需 JWT，PAT 自身不可派生 PAT）

```http
GET  /api/v1/auth/tokens            # 列出
POST /api/v1/auth/tokens            # 创建，明文仅返回一次
DELETE /api/v1/auth/tokens/:id      # 撤销
```

创建示例：

```bash
curl -X POST /api/v1/auth/tokens \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"name":"my-agent","scopes":["read","write"]}'
# => { "token": "mfp_..." }
```

`scopes` 可选：`read / write / edit / upload / community / admin`，前端 `/settings?tab=tokens` 同步管理。

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
  -d '{"title":"新作品","media_type":"anime","edit_note":"initial import","source_urls":["https://..."]}'
```

## 限流与 User-Agent

- 匿名 60/min，认证 600/min
- 未设置有意义 `User-Agent` 的写入请求返回 400（MusicBrainz 同款要求，便于滥用溯源）
- 响应头含 `X-RateLimit-Limit / Remaining / Reset`
