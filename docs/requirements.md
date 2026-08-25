# MetaFusion 产品需求文档（PRD）

> 最后更新：2026-08-20 | 状态：已确认 | 维护人：MoeClubM

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

关联记忆：[[auth-open-registration]]、[[homepage-hero-footer-branding]]、[[forum-boards-three-default]]

---

## 2. 访问模型（Access Model）

### 2.1 两级可见性

**L0 — 开放（无需登录，允许游客与搜索引擎）**
- 作品（Work）详情、发行版（Release）元数据、载体（Medium）与曲目（Track）结构、创作者（Artist）档案、标签（Tag）与虚拟货架（Virtual Shelf）体系、CanonicalEntry 结构（完全无 `media_type` 冗余）
- 搜索（`/api/v1/search`、`/api/v1/catalog/*` 列表与详情，基于 OpenSearch 2.x 构建）、社区帖子列表与详情的文字部分
- 首页、探索页、榜单等聚合页
- 封面缩略图（支持自适应自然宽高比与 `cover_aspect` 属性控制，低分辨率预览封面可视为元数据的一部分，是否开放由 `system_settings.preview_requires_auth` 另行控制，默认开放）

**L1 — 登录可见（需 `Authorization: Bearer <JWT>`，游客命中返回 401 并引导登录）**
- 任何 `asset_files` 二进制：`GET /api/v1/storage/download/:asset_id` 预签名下载链接、`masters/*` 原档、`previews/*` HLS 切片（`index.m3u8` / `segment_*.ts`）、音频 `preview.m4a`、图像 `preview.webp`、波形/字幕/CUE/Log 附属文件
- 上传链路：`POST /api/v1/storage/upload/initiate`、`POST /api/v1/storage/upload/complete`、`POST /api/v1/catalog/submit`
- 社区写入：发帖、回帖、评注
- 个人数据：邀请信息、已邀请用户列表

> 原则：**元数据可爬、媒体不可爬**。Nginx 对 `/storage/preview/*` 与 RustFS (S3 兼容) 预签名链接的透传必须校验 JWT，不得因直链外泄绕过鉴权。

### 2.2 邀请制的真实目的

- **风控**：抑制批量注册、机器爬取媒体、女巫刷取与垃圾内容。
- **合规缓冲**：为媒体内容的二次分发提供可追溯的邀请链（`users.invited_by`），便于事后审计与封禁溯源。
- **非功能性**：不作为付费墙、不作为内容分级依据、不与 Karma/积分挂钩（当前无 Karma 系统，若未来引入需另行 PRD）。
- **可开关**：`system_settings.registration_enabled`（总闸）与 `invite_required`（是否强制邀请）由 `admin`/`archivist` 在后台 `系统设置` 中动态切换；`GET /api/v1/auth/settings` 对游客公开，供前端表单动态渲染。

---

## 3. 功能需求

### 3.1 认证与注册

| ID | 需求 | 说明 |
|---|---|---|
| AUTH-01 | 注册开关 | `registration_enabled=false` 时 `POST /auth/register` 拒绝，文案 `auth.registration_closed`，前端禁用提交并展示 amber 提示 |
| AUTH-02 | 邀请开关 | `invite_required=true` 时注册必填 `invite_code` 并经 `resolveInviterID` 校验（`users.invite_code` → `invitations.code` → 专属邀请码 → admin 回退）；`false` 时 `invite_code` 可选，填则校验、不填则直注 |
| AUTH-03 | 登录与双 Token | `email_or_username + password`，`banned` 账号拒绝；采用 Access Token (2h) + Refresh Token (7d) 架构，支持 Redis 实时黑名单撤销与 PAT 长期令牌 |
| AUTH-04 | 邀请链 | 注册成功写入 `users.invited_by`，`InviteCode` 为 `MF-` 永久码，`GET /auth/invite` 返回 `invite_code / invited_count / invited_users` |

### 3.2 元数据开放

| ID | 需求 | 说明 |
|---|---|---|
| META-01 | 游客可浏览 | `GET /catalog/works`、`GET /catalog/works/:id`、`GET /catalog/releases/:id`、`GET /catalog/artists/:id`、`GET /community/boards`、`GET /community/topics` 等无需鉴权 |
| META-02 | 搜索开放 | `GET /search` 对游客开放，OpenSearch 离线时降级为 SQL `ILIKE`，不得因鉴权导致搜索引擎无法收录 |
| META-03 | 多语言开放 | `work_translations` 等翻译表随元数据一并开放，`?locale` 仅影响展示语言，不影响可见性 |

### 3.3 媒体受控

| ID | 需求 | 说明 |
|---|---|---|
| MEDIA-01 | 下载需登录 | `GET /storage/download/:asset_id` 强制 `AuthMiddleware`，返回 2h 预签名 URL，`response-content-disposition` 带文件名 |
| MEDIA-02 | 预览需登录 | HLS、音频、图像预览的 S3 Key 仅通过受控接口换取，未登录请求返回 401，前端 `GlobalAudioPlayer`/`VideoPlayer` 在 401 时弹出登录 |
| MEDIA-03 | 秒传不绕过鉴权 | `InitiateUpload` 的 SHA-256 秒传命中仍需登录，秒传仅复用 `s3_key/technical_specs`，不复用他人鉴权 |
| MEDIA-04 | 封面策略 | 列表缩略图可开放，原图/高分辨率预览图受控；具体阈值由 `system_settings` 扩展 |

### 3.4 社区与论坛

- 读开放、写需登录；`comment` 分区 `show_in_feed=false` 不进入 `board_code=all` 信息流（见 [[forum-boards-three-default]]）。
- 语种过滤 `language=zh-CN/en-US` 对游客同样生效（见 [[forum-language-i18n-multilingual]]）。

---

## 4. 非功能与合规

- **审计**：所有 `L1` 写入与 `asset_files` 访问经 `admin_audit_logs` 记录 `actor/target/ip/ua`。
- **速率限制**：对 `L1` 预签名接口与上传初始化施加速率限制（待实现，网关层）。
- **SEO**：元数据页 SSR 可被爬虫收录，媒体二进制 URL 必须带鉴权且 `robots.txt` 禁止直链索引。
- **版权提示**：媒体预览/下载页需展示版权与合规提示，下载行为需二次确认。

---

## 5. 前后端落地要点（不含代码改动，仅约束）

- **前端**：`AuthGate` 仅拦截 `L1` 交互（播放、下载、上传、发帖），不得全站强制登录；游客访问元数据页不弹登录，仅在触发媒体操作时引导。
- **后端**：`catalog` 与 `community` 读接口保持公开；`storage` 全量加 `AuthMiddleware`；`search` 保持公开。
- **网关**：`deploy/nginx.conf` 对 `/storage/preview/*` 的反代需透传并校验 `Authorization`，RustFS `metafusion-preview` 桶不得设为 `public`（当前 `anonymous set download` 仅为过渡，需收紧）。

---

## 6. 与邀请相关的演进

- 邀请码保持 `MF-` 永久码 + `InvitesRemaining` 模型，未来若调整配额或引入 Karma，仅改 `system_settings` 与配额逻辑，不改变“邀请=风控”的定性。
- 若需临时开放注册（如活动期），仅切换 `invite_required=false`，无需改代码或改文案。

---

## 7. 验收标准

- [ ] 游客可直接打开任意 Work/Release/Artist 详情与搜索结果，200 正常，无登录跳转
- [ ] 游客点击播放/下载/上传，收到 401 并弹出登录，登录后可正常预览/下载
- [ ] 后台关闭 `invite_required` 后游客可无邀请注册，开启后必填邀请码
- [ ] 后台关闭 `registration_enabled` 后注册按钮禁用并提示“注册已关闭”
- [ ] 直接构造 `previews/<asset_id>/hls/index.m3u8` 直链未带 JWT 时返回 401

---

## 8. 变更记录

- 2026-08-20：初版，纠偏“私库”表述，确立“元数据开放、媒体登录可见”与邀请风控定位。
