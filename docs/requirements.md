# MetaFusion 产品需求文档（PRD）

> 状态：产品边界文档 | 维护人：MoeClubM
> **维护范围**：产品定位、访问模型（L0/L1）与邀请制风控意图；端点、字段与错误码以 [metafusion-docs](https://github.com/MoeclubM/metafusion-docs) 的 `api-*.md`、服务实现和已执行迁移为准。

## 0. 摘要

MetaFusion 是**元数据开放、媒体按绑定实体可见性受控**的多媒介目录。公开实体所绑定的资产可匿名读取；未绑定或不可见实体所绑定的资产返回 404。上传与绑定等写操作需登录并具备相应权限。邀请制是可配置的风控措施，不是付费墙。

---

## 1. 访问模型（Access Model）

### 1.1 公开访问与受控访问

**L0 — 开放（无需登录，允许游客与搜索引擎）**
- 作品（Work）详情、发行版（Release）元数据、载体（Medium）与曲目（Track）结构、责任者（Agent）档案、标签（Tag）与虚拟货架（Virtual Shelf）体系、内容单元（ContentUnit）/ 表达（Expression）结构（不含 `media_type` 维度）
- 搜索（`/api/catalog/entities?q=...`：标题与译文的子串匹配）、社区帖子列表与详情的文字部分
- 首页、探索页、榜单等聚合页
- 封面缩略图（低分辨率封面视为元数据的一部分）

**L1 — 受控媒体与需登录的写操作**
- 媒体资产二进制：只能经存储服务的内容接口取用，是否可读取决于资产所绑定实体对调用者是否可见。绑定到公开实体的资产可匿名读取；未绑定或实体不可见时返回 `404`。目录库不持有文件物理路径。
- 上传链路：`/api/storage/upload/*` 直传与 `POST /api/storage/bind` 绑定，需登录且持有 `storage.asset.upload`（`member` 组默认持有；缺码 `403 forbidden`）；实体本身用 `POST /api/catalog/entities` 创建
- 社区写入：发帖、回帖、评注
- 个人数据：邀请信息、已邀请用户列表

> 原则：元数据可公开索引；对象存储不得绕过存储服务的绑定实体可见性判定；前端不得全站强制登录。

### 1.2 邀请制的真实目的

- **风控**：抑制批量注册、机器爬取媒体、女巫刷取与垃圾内容。
- **合规缓冲**：为媒体内容的二次分发提供可追溯的邀请链（`auth.invites`：`code` + `max_uses` / `used_count` / 可选 `expires_at` / `revoked` → 核销记录 `auth.invite_uses`，即哪个邀请码邀请了哪个用户），便于事后审计与封禁溯源。
- **非功能性**：不作为付费墙、不作为内容分级依据、不与 Karma/积分挂钩。
- **可开关**：`auth.instance_settings.registration_enabled`（总闸）与 `invite_required`（是否强制邀请）由持 `auth.settings.manage` 的角色在后台 `系统设置` 中动态切换（系统组里只有 `admin` 持 `*`）；`/api/auth/settings` 暴露公开子集，具体字段以该端点实际响应为准。临时开放注册（如活动期）只切 `invite_required=false`，不改代码与文案；调整配额只改 `auth.instance_settings` 与配额逻辑，不改变“邀请=风控”的定性。

---

## 2. 功能需求

### 2.1 认证与注册

| ID | 需求 | 说明 |
|---|---|---|
| AUTH-01 | 注册开关 | `registration_enabled=false` 时 `POST /api/auth/register` 拒绝（错误码 `registration_closed`，前端文案键 `auth.error.registration_closed`）；首管初始化仍走 `/api/setup`，管理员建号走 `/api/admin/users` |
| AUTH-02 | 邀请开关 | `invite_required=true` 时注册必带有效 `invite_code`（缺失报 `invite_required`、无效报 `invalid_invite_code`），核销写入 `auth.invite_uses` 并累计 `auth.invites.used_count`；`false` 时 `invite_code` 可选。开关与配额在后台「系统设置」里改 |
| AUTH-03 | 登录、续期与账号封禁 | `email_or_username + password`，口令错误统一 `invalid_credentials`（401）；访问令牌 15 分钟，续期走 `POST /api/auth/refresh`（用当前 Bearer/Cookie 换发新令牌并轮转服务端会话行）。**账号封禁**：`auth.users.banned` 由 `PUT /api/admin/users/{id}/ban`（需 `auth.users.manage`）维护，被封禁账号的登录与续期一律 `403 account_banned`，封禁同时删除其服务端会话、第三方令牌与未兑换授权码，并让验签路径立即拒绝（不必等令牌自然过期）；不能封自己、不能封掉最后一个可登录的管理员。用户可 `GET /api/auth/oauth-grants` 查看、`DELETE /api/auth/oauth-grants/{client_id}` 撤回自己的第三方授权。**账号服务不签发 `refresh_token`**（第三方令牌到期需重新授权）；**个人访问令牌（PAT）已落地**：账号服务签发 `mfp_` 前缀长期令牌（明文只在创建响应出现一次，库里只存 sha256），目录侧经账号服务的 `POST /api/auth/tokens/introspect` 内省判定（进程内缓存 60 秒；`401`/`403`=令牌无效回 `401 invalid_token`，5xx/超时/限流回 `503 auth_unavailable`）；认证写入类接口按 IP 限流，速率与开关来自实例设置（默认 15 次/分钟） |
| AUTH-04 | 邀请链 | 注册成功写入 `auth.invite_uses`（邀请码 → 用户）；邀请码在后台 `/api/admin/invites` 签发与作废，`code` 形如 `XXXX-XXXX-XXXX-XXXX` |

### 2.2 元数据开放

| ID | 需求 | 说明 |
|---|---|---|
| META-01 | 游客可浏览 | `GET /api/catalog/entities?kind=work`、`GET /api/catalog/entities/:id`、`GET /api/catalog/entities?kind=release`、`GET /api/community/entities/:id/posts`（需部署互动服务）等无需鉴权 |
| META-02 | 搜索开放 | `GET /api/catalog/entities?q=...` 对游客开放（标题/译文的子串匹配），不得因鉴权导致搜索引擎无法收录 |
| META-03 | 多语言开放 | 实体翻译随元数据一并开放：统一 DTO 的 `translations` 按 locale 分组，每语种含 `title` / `summary` / `aliases`；展示语言由客户端 locale 决定，不影响可见性 |

### 2.3 媒体受控

| ID | 需求 | 说明 |
|---|---|---|
| MEDIA-01 | 下载受控 | `GET /api/storage/assets/:id/content` 内联返回内容；`GET /api/storage/download/:assetId` 在对象存储模式下返回预签名 URL。访问权限按资产绑定实体的可见性判定：公开实体的资产可匿名读取；未绑定、不可见或不存在均回 `404 not_found`。 |
| MEDIA-02 | 预览流未实现 | HLS 切片与音频/图像转码预览尚未实现；存储服务只收原始文件、不做转码或媒体分析。 |
| MEDIA-03 | 秒传不绕过鉴权 | `POST /api/storage/upload/initiate` 的 SHA-256 秒传命中仍需登录，秒传只复用已验内容的存储对象，不复用他人的访问授权 |
| MEDIA-04 | 封面策略 | 外部封面按来源与实体展示规则处理；若作为存储资产提供，访问权限按 MEDIA-01 判定。独立的原图分辨率阈值当前未实现 |
| MEDIA-05 | 多图与封面顺序 | 一个实体可挂多张图（`pictures[]`）：**数组顺序就是展示顺序，首张即封面**，服务端保存时不重排，`taken_at` 只是该图自身的时间元信息、不参与排序（顺序在前端只有 `lib/cover.ts` 一处定义，消费点不再各自 `[0]`）。每张图可选 `role`（用途码，取 definitions 的 `picture_role` 词表：主视觉/封面图/海报/角色立绘/人物肖像/标识/剧照/活动现场/内页扫描/界面截图；空=未声明，存量数据全部未声明且照常展示）与 `asset_id`（自托管封面对应的存储资产 UUID，此时 `url` 指向 MEDIA-01 的 `content` 端点）。服务端拒绝：同实体内 URL 重复 `duplicate_picture`、超过 40 张 `too_many_pictures`（每张都进 document 与每次保存的修订快照）、`role` 不在词表 `invalid_term`、`asset_id` 非 UUID `invalid_picture_asset`。目录侧**不跨服务校验** `asset_id` 是否存在或已被封禁（无跨服务事务），取不到对象时前端退化为程序封面而不是破图 |

### 2.4 社区与论坛

- 读开放、写需登录；默认板块 `announcement` / `casual` / `qa` / `reviews` / `bug_report` / `comment`，其中 `comment` 在 `show_in_feed=false` 时不进入 `board_code=all` 信息流。
- 论坛接口不带语种维度：话题列表不接受 `?language=` 筛选，发帖/改帖不传 `language`；数据库列保留（`community.topics.language` 默认空串、不再读写，板块 `names`/`descriptions` 多语言 JSONB 保留），站点 UI 四语不受影响。

---

## 3. 非功能与合规

- **审计**：目录侧每次写入在 `catalog.revisions` 留痕（带 `edit_note` 与来源）；跨服务统一审计表 `audit.audit_log` 已落地，四个服务写操作各记一行。唯一读取路由是账号服务的 `GET /api/admin/audit-logs`，作用域分两档：持 `auth.audit.read` 者按任意条件查全量，其余登录用户被收敛到本人（设置页「我的操作记录」，指定他人一律 403）；口径与"完整"的边界（旁路写入会丢行、`changes` 已脱敏截断）见 [审计留痕契约](architecture/audit-log.md)。
- **速率限制**：网关按 IP 限流（`/api/` 30 r/s、`/api/auth/` 5 r/s），目录服务另有按路由的限额（`routeLimiter`，如列表 120/min、导入预检 10/min）；被限流的路由随响应下发 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`（超限另带 `Retry-After`，实现见 `backend/internal/catalog/http.go`）；匿名/登录差异化配额与统一限流中间件未落地。
- **SEO**：元数据页 SSR 可被爬虫收录。`robots.txt` 仅用于索引控制，不承担媒体访问权限判定。
- **版权提示**：媒体预览/下载页需展示版权与合规提示，下载行为需二次确认。

---

## 4. 验收标准

- [ ] 游客可直接打开任意 Work/Release/Agent 详情与搜索结果，200 正常，无登录跳转
- [ ] 游客可读取绑定到公开实体的资产；未绑定或绑定不可见实体的资产返回 404。未登录上传或绑定返回 401；具备相应权限后可完成操作
- [ ] 后台关闭 `invite_required` 后游客可无邀请注册，开启后必填邀请码
- [ ] 后台关闭 `registration_enabled` 后注册按钮禁用并提示“注册已关闭”
- [ ] 绕过存储服务访问判定的私有对象直链不可读；若其绑定实体公开，访问是否允许仍按 MEDIA-01 判定

---

## 5. 变更记录

- 2026-09-25：删除「定位纠偏」表与已过时的旧端点说明，合并重复的落地约束、邀请演进章节与同口径变更记录，全文按新编号收敛。
- 2026-09-23：按存储服务现行实现修正媒体读取口径——下载权限由绑定实体可见性决定，公开绑定资产不要求登录。
- 2026-08-20：初版，确立元数据开放、媒体受控与邀请风控定位。
