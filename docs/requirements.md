# MetaFusion 产品需求文档（PRD）

> 最后更新：2026-08-20 | 状态：产品边界已确认（接口细节不在本文件维护） | 维护人：MoeClubM

> **本文件维护范围**：产品定位、访问模型（L0/L1）与邀请制风控意图。正文成文于统一 `/api` 主干与固定八实体骨架落地之前，
> 其中的端点名与请求示例（`Artist`、`CanonicalEntry`、`/api/v1/*`、`/auth/register`、`/api/search`、`/storage/*`、`/catalog/submit`、`/api/archive/*` 等）是当时的旧设计，**不是当前契约**。
> 现行接口：目录读 `GET /api/catalog/entities*`、`GET /api/catalog/definitions`、`GET /api/catalog/compare`；写入 `POST|PUT /api/catalog/entities`、`/api/catalog/relations`、`/api/catalog/entities/:id/lifecycle`；
> 媒体资产走存储服务的 `/api/storage/*`，认证走账号服务的 `/api/auth/*` 与 `/api/oauth/*`。
> 接口契约以 [metafusion-docs](https://github.com/MoeclubM/metafusion-docs) 的 `api-*.md` 为准，实现以 `backend/internal/catalog/http.go` 与 `openapi.go` 的 paths 表为准。

## 0. 摘要

MetaFusion 的正确定位是 **元数据开放、媒体受控** 的多媒介百科与典藏平台，而非封闭私库。所有编目元数据对游客开放可浏览与检索；任何实际媒体二进制（原档下载、HLS/音频/图像预览流、封面原图批量）的访问必须登录后才可见。邀请制是风控手段而非付费墙，用于规避滥用、爬虫、批量外泄与合规风险，且由后台开关动态控制。

本文档锁定该边界，作为后续前端路由守卫、后端接口鉴权、Nginx 网关与审计策略的唯一依据。

---

## 1. 定位纠偏

| 旧表述 | 正确表述 |
|---|---|
| 私库 / Private Archive / 仅登录可见 | 元数据开放百科，媒体登录可见 |
| 邀请 = 身份门槛 / 付费墙替代 | 邀请 = 风控与合规缓冲层，可后台关闭 |
| 元数据与媒体同等鉴权 | 元数据公开可索引，媒体二进制强制鉴权 |

关联约定：开放注册（后台可关）、首页品牌区与页脚、论坛默认板块（`announcement` / `casual` / `qa` / `reviews` / `bug_report` / `comment`，其中 `comment` 不进信息流）

---

## 2. 访问模型（Access Model）

### 2.1 两级可见性

**L0 — 开放（无需登录，允许游客与搜索引擎）**
- 作品（Work）详情、发行版（Release）元数据、载体（Medium）与曲目（Track）结构、责任者（Agent）档案、标签（Tag）与虚拟货架（Virtual Shelf）体系、内容单元（ContentUnit）/ 表达（Expression）结构（完全无 `media_type` 冗余）
- 搜索（`/api/catalog/entities?q=...`：标题与译文的子串匹配）、社区帖子列表与详情的文字部分
- 首页、探索页、榜单等聚合页
- 封面缩略图（比例由前端按封面图自然比例与标签推断，只是展示建议，没有可写的 `cover_aspect` 属性；低分辨率封面可视为元数据的一部分，`preview_requires_auth` 这类独立开关当前未落地）

**L1 — 登录可见（需 `Authorization: Bearer <JWT>`，游客命中返回 401 并引导登录）**
- 任何媒体资产二进制：只能经存储服务的受控内容接口取用（`GET /api/storage/assets/:id/content` 等），目录库不持有文件物理路径。
  当前放行规则是"资产绑定的实体对调用者可见"：绑定已发布实体的资产匿名可取，不可读回 `404`（登录本身不是门槛）
- 上传链路：`/api/storage/upload/*` 直传与 `POST /api/storage/bind` 绑定，需登录且持有 `storage.asset.upload`（`member` 组默认持有；缺码 `403 forbidden`）；实体本身用 `POST /api/catalog/entities` 创建
- 社区写入：发帖、回帖、评注
- 个人数据：邀请信息、已邀请用户列表

> 原则：**元数据可爬、媒体不可爬**。网关对存储服务的媒体路径与 RustFS (S3 兼容) 预签名链接的透传必须校验 JWT，不得因直链外泄绕过鉴权。

### 2.2 邀请制的真实目的

- **风控**：抑制批量注册、机器爬取媒体、女巫刷取与垃圾内容。
- **合规缓冲**：为媒体内容的二次分发提供可追溯的邀请链（`auth.invites` → `auth.invite_uses`：哪个邀请码邀请了哪个用户），便于事后审计与封禁溯源。
- **非功能性**：不作为付费墙、不作为内容分级依据、不与 Karma/积分挂钩（当前无 Karma 系统，若未来引入需另行 PRD）。
- **可开关**：`auth.instance_settings.registration_enabled`（总闸）与 `invite_required`（是否强制邀请）由持 `auth.settings.manage` 的角色在后台 `系统设置` 中动态切换（系统组里只有 `admin` 持 `*`）；`/api/auth/settings` 暴露公开子集，具体字段以该端点实际响应为准。

---

## 3. 功能需求

### 3.1 认证与注册

| ID | 需求 | 说明 |
|---|---|---|
| AUTH-01 | 注册开关 | `registration_enabled=false` 时 `POST /api/auth/register` 拒绝（错误码 `registration_closed`，前端文案键 `auth.error.registration_closed`）；首管初始化仍走 `/api/setup`，管理员建号走 `/api/admin/users` |
| AUTH-02 | 邀请开关 | `invite_required=true` 时注册必带有效 `invite_code`（缺失报 `invite_required`、无效报 `invalid_invite_code`），核销写入 `auth.invite_uses` 并累计 `auth.invites.used_count`；`false` 时 `invite_code` 可选。开关与配额在后台「系统设置」里改 |
| AUTH-03 | 登录、续期与账号封禁 | `email_or_username + password`，口令错误统一 `invalid_credentials`（401）；访问令牌 15 分钟，续期走 `POST /api/auth/refresh`（用当前 Bearer/Cookie 换发新令牌并轮转服务端会话行）。**账号封禁**：`auth.users.banned` 由 `PUT /api/admin/users/{id}/ban`（需 `auth.users.manage`）维护，被封禁账号的登录与续期一律 `403 account_banned`，封禁同时删除其服务端会话、第三方令牌与未兑换授权码，并让验签路径立即拒绝（不必等令牌自然过期）；不能封自己、不能封掉最后一个可登录的管理员。用户可 `GET /api/auth/oauth-grants` 查看、`DELETE /api/auth/oauth-grants/{client_id}` 撤回自己的第三方授权。**账号服务不签发 `refresh_token`**（第三方令牌到期需重新授权），也没有 PAT 长期令牌；认证写入类接口按 IP 限流，速率与开关来自实例设置（默认 15 次/分钟） |
| AUTH-04 | 邀请链 | 注册成功写入 `auth.invite_uses`（邀请码 → 用户）；邀请码在后台 `/api/admin/invites` 签发与作废，`code` 形如 `XXXX-XXXX-XXXX-XXXX` |

### 3.2 元数据开放

| ID | 需求 | 说明 |
|---|---|---|
| META-01 | 游客可浏览 | `GET /api/catalog/entities?kind=work`、`GET /api/catalog/entities/:id`、`GET /api/catalog/entities?kind=release`、`GET /api/community/entities/:id/posts`（需部署互动服务）等无需鉴权 |
| META-02 | 搜索开放 | `GET /api/catalog/entities?q=...` 对游客开放（标题/译文的子串匹配），不得因鉴权导致搜索引擎无法收录 |
| META-03 | 多语言开放 | 实体翻译随元数据一并开放：统一 DTO 的 `translations` 按 locale 分组，每语种含 `title` / `summary` / `aliases`；展示语言由客户端 locale 决定，不影响可见性 |

### 3.3 媒体受控

| ID | 需求 | 说明 |
|---|---|---|
| MEDIA-01 | 下载受控 | `GET /api/storage/assets/:id/content` 内联返回内容（`Content-Disposition: inline`），`GET /api/storage/download/:assetId` 在对象存储模式下返回预签名 URL（`Content-Disposition` 带文件名）；不可读与不存在一律回 `404 not_found`（不区分无权限）。**当前判定的是"资产绑定的实体对调用者是否可见"而不是"调用者是否登录"**：绑定到已发布实体的资产，匿名请求同样能取到内容 |
| MEDIA-02 | 预览需登录 | 媒体预览流（HLS 切片、音频/图像转码预览）当前未落地：存储服务只收原始文件、不做转码与媒体分析。原档同样只经受控接口取用；未绑定实体或绑定实体不可见的资产，匿名请求回 `404`（不是 `401`） |
| MEDIA-03 | 秒传不绕过鉴权 | `POST /api/storage/upload/initiate` 的 SHA-256 秒传命中仍需登录，秒传只复用已验内容的存储对象，不复用他人的访问授权 |
| MEDIA-04 | 封面策略 | 列表缩略图可开放，原图/高分辨率封面受控；具体阈值当前没有独立开关，如需由实例设置（`auth.instance_settings`）扩展 |

### 3.4 社区与论坛

- 读开放、写需登录；`comment` 分区 `show_in_feed=false` 不进入 `board_code=all` 信息流（comment 分区不进入信息流）。
- 语种过滤 `language=zh-CN/en-US` 对游客同样生效（论坛按语种过滤）。

---

## 4. 非功能与合规

- **审计**：目录侧每次写入在 `catalog.revisions` 留痕（带 `edit_note` 与来源）；账号与媒体资产的统一审计表（`admin_audit_logs`）当前未落地。
- **速率限制**：当前在网关按 IP 限流（`/api/` 30 r/s、`/api/auth/` 5 r/s），目录服务另有按路由的限额；匿名/登录差异化配额、统一限流中间件与 `X-RateLimit-*` 响应头均未落地。
- **SEO**：元数据页 SSR 可被爬虫收录，媒体二进制 URL 必须带鉴权且 `robots.txt` 禁止直链索引。
- **版权提示**：媒体预览/下载页需展示版权与合规提示，下载行为需二次确认。

---

## 5. 前后端落地要点（不含代码改动，仅约束）

- **前端**：`AuthGate` 仅拦截 `L1` 交互（播放、下载、上传、发帖），不得全站强制登录；游客访问元数据页不弹登录，仅在触发媒体操作时引导。
- **后端**：`catalog` 读接口公开；存储服务的媒体内容接口强制登录；检索走 `catalog/entities` 的标题/译文子串匹配，没有独立检索端点。
- **网关**：`deploy/nginx.conf` 对存储媒体路径的反代需透传并校验 `Authorization`，RustFS 桶不得设为 `public`。

---

## 6. 与邀请相关的演进

- 邀请码模型是 `auth.invites`（`code` + `max_uses` / `used_count` / 可选 `expires_at` / `revoked`）加 `auth.invite_uses` 核销记录，`code` 形如 `XXXX-XXXX-XXXX-XXXX`；未来若调整配额或引入 Karma，仅改 `auth.instance_settings` 与配额逻辑，不改变“邀请=风控”的定性。
- 若需临时开放注册（如活动期），仅切换 `invite_required=false`，无需改代码或改文案。

---

## 7. 验收标准

- [ ] 游客可直接打开任意 Work/Release/Agent 详情与搜索结果，200 正常，无登录跳转
- [ ] 游客点击播放/下载/上传，收到 401 并弹出登录，登录后可正常预览/下载
- [ ] 后台关闭 `invite_required` 后游客可无邀请注册，开启后必填邀请码
- [ ] 后台关闭 `registration_enabled` 后注册按钮禁用并提示“注册已关闭”
- [ ] 绕过受控内容接口直接构造对象存储直链时无法取到内容

---

## 8. 变更记录

- 2026-08-20：初版，纠偏“私库”表述，确立“元数据开放、媒体登录可见”与邀请风控定位。
