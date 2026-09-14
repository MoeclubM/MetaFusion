# 子系统拆分与迁移基准

本文是 MetaFusion 从"单进程模块化单体"迁移到"按职责划分的独立服务"的**唯一契约来源**。
状态：**执行中**。任何仓库的迁移改动都必须与本文一致；与本文冲突的实现以本文为准，或先改本文再改代码。

相关文档：[规范驱动开发需求与架构基准](./spec-driven-requirements.md)、[插件架构 VISION（未实现）](./plugin-decoupling-blueprint.md)。

## 1. 目标运行单元

| 运行单元 | 职责 | 拥有数据（schema） | 对外路径前缀 | 仓库 |
| --- | --- | --- | --- | --- |
| 元数据目录 catalog | 八类实体、动态定义、关系、结构、修订、检索、货架、外部库 | `catalog.*` | `/api/catalog/*`、`/api/openapi.json` | MetaFusion（本仓库） |
| 账号 auth | 注册/登录、会话、令牌签发与吊销、OAuth2/OIDC、账号与角色管理 | `auth.*` | `/api/setup`、`/api/auth/*`、`/api/admin/users*`、`/api/oauth/*`、`/api/oidc/jwks`、`/api/.well-known/openid-configuration` | metafusion-auth |
| 互动 community | 论坛板块/主题/回复/标签、条目短评、个人收藏、评分与进度 | `community.*` | `/api/community/*`、`/api/favorites/*`、`/api/records/*`、`/api/users/{id}/favorites` | metafusion-community |
| 存储 storage | 物理文件、哈希与去重、对象存储直传、绑定、下载/预览与访问控制 | `storage.*` | `/api/storage/*` | metafusion-storage |
| 边缘网关 gateway | 统一入口、按前缀分流、限流、安全响应头 | 无 | `/`、`/docs` | metafusion-api-gateway |
| 文档 | 全站文档（唯一源） | 无 | 由网关 `/docs` 反代 | metafusion-docs |
| 技能 | 编目技能（curator / lrm-catalog-standards） | 无 | 无（非运行时） | metafusion-skills |

前端（Next.js，本仓库 `frontend/`）不属于任何业务服务，通过网关调用各前缀；`frontend/src/lib/services.ts`
里的 `NEXT_PUBLIC_AUTH_URL` / `NEXT_PUBLIC_FORUM_URL` / `NEXT_PUBLIC_STORAGE_URL` / `NEXT_PUBLIC_DOCS_URL`
是既有的外部化开关，服务切换时优先用它们，而不是改调用点。

## 2. 路由归属（迁移目标）

| 归属 | 路径 | 现状（本仓库） |
| --- | --- | --- |
| auth | `GET|POST /api/setup` | `catalog/http.go` |
| auth | `POST /api/auth/login|refresh|logout|change-password|logout-all`、`GET /api/auth/me|settings`、`PUT /api/auth/password` | 同上 |
| auth | `GET|POST /api/admin/users`、`PUT /api/admin/users/:id/role|password` | 同上 |
| auth | `/api/oauth/clients|authorize|token|userinfo`、`/api/oidc/jwks`、`/api/.well-known/openid-configuration` | 同上 |
| catalog | `/api/catalog/*`（definitions、tags、entities、relations、shelves、compare、importer、me/home-preferences 等） | 同上，保留 |
| community | `/api/community/*`（boards、topics、topic-tags、feed、entities/:id/posts、entities/:id/collections、posts/:id） | `modules/forum.go`、`modules/modules.go` |
| community | `/api/favorites/toggle|status|mine`、`/api/users/:id/favorites` | 已迁入 metafusion-community（`community.favorites`）；主仓库 `catalog/favorites.go` 待 P4 下线 |
| community | `/api/records/entities/:id` | `modules/modules.go` |
| storage | `/api/storage/*`（见 `docs-site/docs/api-storage.md` 的设计契约） | 不存在；现状是 `/api/archive/*`、`/api/playback/*`、`/api/media/*` |
| 待定 | `/api/exchange/*`（导入/导出提案） | `modules/modules.go`；归属元数据侧写入能力，迁移期留在本仓库 |
| 待定 | `/api/capabilities`、`/api/admin/modules/:id` | 模块开关是部署关注点；catalog 收敛为只读聚合，逐服务给出 `/health` |

**网关按前缀分流，不按服务改前端调用点。** 只有 `/api/users/{id}/favorites` 与用户资料同前缀，
网关用精确正则 `^/api/users/[^/]+/favorites$` 单独分流到 community。

## 3. 数据归属与边界

- 每个服务拥有自己的 schema，只读写自己的表；**禁止跨服务 JOIN**。
- 服务间只通过 HTTP 契约与事件交互：
  - storage/community 判定"实体是否可见"必须走 catalog 的实体查询接口（当前单体内的等价能力见
    `moduleapi.Catalog` 的 `Lookup`/`LookupMany`/`RelatedEntities`），不得直连 catalog 表。
  - 实体合并（`entity.merged`）的引用改写：各服务各自订阅并做消费去重（现有 `modules.consumed` 模式），
    迁移期事件仍由 catalog outbox 投递，跨服务通道（HTTP 推送或消息系统）在 P4 前确定。
- 存储系统**不保存**元数据结构（不复制作品/专辑/曲目表）；元数据系统**不保存**对象存储物理路径。
- 绑定的"用途"用 `binding_role` 表达（`track_audio` / `disc_image` / `scans` / `video` …），
  "区间/位置"仍留在元数据侧的 `locator`（TrackContent），两者不重复：文件说"我是谁的什么用途"，目录说"收录在第几轨/什么时间码"。

## 4. 认证边界

- 只有 auth 签发令牌；其余服务**只验签**（RS256，JWKS）。验签只信 `sub`/`preferred_username`/`role`。
- issuer 保持 `https://findverse.cc/api`、audience 保持 `metafusion`，避免存量令牌全部失效。
- 各服务的 JWKS 地址用环境变量注入（迁移期指向 catalog 的 `/api/oidc/jwks`，auth 上线后指向 auth）。
- 主仓库 `Store.Authenticate` **只做 RS256 验签**（已于 2026-09-14 取消 `auth.sessions` 查库兜底）：
  目录不读账号服务的表。存量不透明令牌的兜底由各服务问账号服务（`AUTH_URL`），
  续期仍走账号服务的 `/api/auth/refresh`（短期访问令牌，否则用户会被强制下线）。
- 业务权限（谁能编辑哪个实体）仍由 catalog 自己判断，auth 不介入。

## 5. 迁移阶段与验收

> **进度**：P0–P4 已在开发实例上落地；P5（文档去重）未开始。
>
> - **P1 已完成**：metafusion-storage 实现 `/api/storage/*`（内容寻址、秒传与分片预签名直传、`binding_role` 绑定、
>   统一读取可见性、哈希校验）；网关把 `/api/storage/*` 指向 storage。存储桶改由服务启动时自建，
>   不再依赖 `minio/mc` 初始化容器（该镜像已从 Docker Hub 撤下）。
> - **P2 已完成**：metafusion-community 承接论坛/短评/互动记录/收藏，路径与请求响应形状与单体逐字一致；
>   幂等搬运工具 `cmd/migrate` 与互动服务共用镜像，切流时由编排直接调用。
> - **P3 已完成**：metafusion-auth 承接账号/会话/OAuth2.0/OIDC 与 RS256 签发验签，表在既有独立 `auth` schema，
>   **无需数据搬运**。
> - **P4 已完成（2026-09-14，开发实例）**：`./deploy.sh cutover` 一次完成构建 → 起服务 → 目录库迁移 →
>   搬运旧表（forward 全量核对）→ 拉起网关；网关矩阵 18 条 location 逐前缀验证 `X-MetaFusion-Service`
>   分别落到 catalog/auth/community/storage；随后 `./deploy.sh retire` 删除 `modules` / `media` schema、
>   `catalog.favorites` 与手工迁移遗留的临时备份表。库里最终只剩 `catalog` / `auth` / `community` / `storage`。
> - **P4 代码侧已完成**：`modules`/`moduleapi`/`moduledeps` 三个包、账号实现（`identity.go`/`favorites.go`、
>   账号与收藏路由、`token.go` 的签发侧，约 900 行）全部删除；目录侧只剩 RS256 验签（只持公钥）。
>   结构基线不再创建 `auth.*` 与 `catalog.favorites`，也不再播种第一方 OAuth 客户端
>   （种子随 auth schema 归账号服务）；修订作者名改为写入快照，目录侧不再有任何跨 schema 的 JOIN 或写入。
> - **迁移收敛（2026-09-14）**：历史 15 个迁移合并为单一基线 `000001_catalog_core`，与目录服务启动读同一份文件；
>   提交历史里的 000002–000015 只对"需要从旧库升级"的实例有意义，测试实例直接重建即可。
> - **遗留**：收藏"是否公开"仍只有前端只读占位（`settings/page.tsx` 的开关是 `disabled readOnly`，
>   目录侧无字段），迁移后的接口恒返回 `visible: true`；实现该开关时归互动服务。
> - **P5 未开始**：`metafusion-docs` 与主仓库 `docs-site` 仍是两份；主仓库 `docs-site/docs/api-storage.md`
>   已于 2026-09 改写为真实契约，去重时以哪一份为唯一源仍需拍板。

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 | 冻结契约（本文 + 各服务 README 对齐路由与数据归属） | 网关路由表与本文逐条一致 |
| P1 | storage：实现 `/api/storage/*`（CAS、秒传、分片预签名、绑定角色、下载、预览、哈希校验） | ✅ 新仓库 `go build/vet/test` 通过；本仓库 archive/media 端点保持可用，未切流 |
| P2 | community：迁移论坛/短评/收藏/记录，**保留现有 `/topics`、`/boards` 契约与请求/响应形状** | ✅ 论坛/短评/记录已迁（16 条路由与单体逐字一致，`go build/vet/test` 通过）；收藏随 P3 迁移 |
| P3 | auth：迁出 setup/auth/admin/oauth；catalog 改为只验签 | ✅ 服务侧完成（30 条路径与单体一致 + OIDC 标准根路径；`go build/vet/test` 通过，含令牌闭环与 PKCE 单测）。切流与单体只验签在 P4 执行 |
| P4 | catalog 瘦身 + 网关切流：下线 `/api/archive`、`/api/playback`、`/api/media`、`/api/community` 与 `modules` 包 | ✅ 全部完成：已切流并逐前缀验证；旧 schema/表已删；**账号实现与路由已从单体删除，目录只剩验签** |
| P5 | 文档去重：`metafusion-docs` 为唯一源，本仓库 `docs-site` 移除/compose 收敛 | 只有一份 md；`docker compose config` 通过 |

每个阶段独立提交、独立可回退；不回滚别人的改动，也不做双向写入。

## 6. 现有脚手架必须修正的偏差

| 仓库 | 偏差 | 修正 |
| --- | --- | --- |
| metafusion-community | 路由写成 `/threads`、`/categories`、`/entities/:id/rate`；模型用 `Category/Thread/Post(floor)` | 改为现有契约 `/boards`、`/topics`、`/topic-tags`、`community_post_number`，模型含双语板块名与标签 |
| metafusion-auth | discovery 在根路径、JWKS 路径 `/.well-known/jwks.json`、issuer 无 `/api`；缺 `/api/setup`、`/api/admin/users`、OAuth 客户端管理 | 与第 2 节路径一致；issuer 与 catalog 现值一致 |
| metafusion-storage | ~~模型用 GORM；路由与文档的 `/api/storage/bind` 不一致~~ | ✅ 已改为 `database/sql`，路由以 `docs-site/docs/api-storage.md` 的契约为准 |
| metafusion-auth / -community | 无 `go.sum`，`go build` 直接失败 | 补齐依赖锁（`GOPROXY=https://goproxy.cn,direct go mod tidy`）；storage 已完成 |
| metafusion-docs | 26 篇 md 与本仓库 `docs-site` 重复，其中 14 篇已分叉 | P5 去重，先确认唯一源 |
| metafusion-api-gateway | ~~缺 `/.well-known/` 路由；`/api/storage/*` 指向未实现服务~~ | ✅ 已重排：每个前缀一行上游、补齐 discovery/setup/oauth/oidc、未实现的服务不接线上流量 |

## 7. 回滚

网关按前缀切换，切换点只有 nginx 一张表；任一阶段出问题只需把前缀指回主仓库，数据由各服务独立 schema 承担，
迁移期不做双向写入，因此不存在冲突合并问题。
