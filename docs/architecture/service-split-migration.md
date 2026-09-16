# 子系统拆分与迁移基准

本文是 MetaFusion 从"单进程模块化单体"迁移到"按职责划分的独立服务"的**唯一契约来源**。
状态：**已落地**（P0–P5 全部完成）。任何仓库的迁移改动都必须与本文一致；与本文冲突的实现以本文为准，或先改本文再改代码。

相关文档：[规范驱动开发需求与架构基准](./spec-driven-requirements.md)、[插件架构 VISION（未实现）](./plugin-decoupling-blueprint.md)。

## 1. 目标运行单元

| 运行单元 | 职责 | 拥有数据（schema） | 对外路径前缀 | 仓库 |
| --- | --- | --- | --- | --- |
| 元数据目录 catalog | 八类实体、动态定义、关系、结构、修订、检索、货架、外部库 | `catalog.*` | `/api/catalog/*`、`/api/importer/*`、`/api/exchange/*`、`/api/capabilities`、`/api/admin/{catalog-definitions,external-databases,shelves,modules}`、`/api/openapi.json` | MetaFusion（本仓库） |
| 账号 auth | 注册/登录、会话、令牌签发与吊销、OAuth2/OIDC、账号与角色管理、开发者中心（应用自助登记与接入配置） | `auth.*` | `/api/setup`、`/api/auth/*`、`/api/admin/users*`、`/api/oauth/*`、`/api/developer/*`、`/api/oidc/jwks`、`/api/.well-known/openid-configuration` | metafusion-auth |
| 互动 community | 论坛板块/主题/回复/标签、条目短评、个人收藏、评分与进度 | `community.*` | `/api/community/*`、`/api/favorites/*`、`/api/records/*`、`/api/users/{id}/favorites` | metafusion-community |
| 存储 storage | 物理文件、哈希与去重、对象存储直传、绑定、下载/预览与访问控制 | `storage.*` | `/api/storage/*` | metafusion-storage |
| 边缘网关 gateway | 统一入口、按前缀分流、限流、安全响应头 | 无 | `/`、`/docs`、各 `/api/` 前缀 | 本仓库 `deploy/nginx.conf`（`metafusion-api-gateway` 只留切流自检脚本） |
| 文档 | 全站文档（唯一源） | 无 | 由网关 `/docs` 反代 | metafusion-docs |
| 技能 | 编目技能（curator / lrm-catalog-standards） | 无 | 无（非运行时） | metafusion-skills |

前端（Next.js，本仓库 `frontend/`）不属于任何业务服务，通过网关调用各前缀；`frontend/src/lib/services.ts`
里的 `NEXT_PUBLIC_AUTH_URL` / `NEXT_PUBLIC_FORUM_URL` / `NEXT_PUBLIC_STORAGE_URL` / `NEXT_PUBLIC_DOCS_URL`
是既有的外部化开关，服务切换时优先用它们，而不是改调用点。

## 2. 路由归属（现状）

唯一生效的矩阵是 `deploy/nginx.conf`（compose 的 `gateway` 服务）：实测 **25 条 `location`**，账号前缀用精确匹配与正则逐条分流。
下表按归属归纳路径族；逐条 location 与精确匹配以文件为准。矩阵与本文表格的一致性检查、以及网关矩阵的单一来源归属见 [多项目解耦审计与优化建议](./decoupling-audit-2026-09.md) §6。

| 归属 | 路径 | 现状 |
| --- | --- | --- |
| auth | `GET|POST /api/setup` | metafusion-auth；网关用 `location = /api/setup` 精确匹配 |
| auth | `POST /api/auth/login|refresh|logout|change-password|logout-all|register`、`GET /api/auth/me|settings|invite`、`POST /api/auth/invite`、`PUT /api/auth/password` | metafusion-auth（`/api/auth/` 前缀） |
| auth | `GET|POST /api/admin/users`、`PUT /api/admin/users/:id/{role,password,groups}` | metafusion-auth（`/api/admin/users` 前缀） |
| auth | `GET|POST /api/admin/groups`、`PUT|DELETE /api/admin/groups/:code`、`GET /api/admin/permissions`、`GET|PUT /api/admin/settings`、`GET|POST /api/admin/invites`、`POST /api/admin/invites/:code/revoke` | metafusion-auth；与目录侧 `/api/admin/*` 同前缀，网关逐条精确匹配（漏一条就 404） |
| auth | `/api/oauth/clients|authorize|token|userinfo`、`/api/oidc/jwks`、`/api/.well-known/openid-configuration`、根路径 `/.well-known/{openid-configuration,jwks.json}` | metafusion-auth（令牌只由它签发，discovery 与 JWKS 也只在它这里） |
| auth | `/api/developer/*`（overview、apps、apps/{id}、apps/{id}/rotate-secret） | metafusion-auth（开发者中心：任何登录账号自助登记应用；网关用 `/api/developer/` 前缀整体分流，不与 `/api/admin/oauth/*` 混用） |
| catalog | `/api/catalog/*`（definitions、tags、entities、relations、shelves、compare、me/home-preferences 等）、`/api/importer/*`、`/api/exchange/*`、`/api/capabilities`、`/api/admin/{catalog-definitions,external-databases,shelves,modules}`、`/api/openapi.json` | 本仓库，保留 |
| community | `/api/community/*`（boards、topics、topic-tags、feed、entities/:id/posts、entities/:id/collections、posts/:id） | metafusion-community |
| community | `/api/favorites/toggle|status|mine`、`/api/users/:id/favorites` | metafusion-community（`community.favorites`） |
| community | `/api/records/entities/:id` | metafusion-community |
| storage | `/api/storage/*`（契约见 `metafusion-docs` 的 `docs/api-storage.md`） | metafusion-storage（契约见 `metafusion-docs` 的 `docs/api-storage.md`） |
| auth | `/api/admin/oauth/*`（客户端治理：核验、提升自有平台、吊销、审计） | metafusion-auth；与目录侧 `/api/admin/*` 同前缀，网关用 `location /api/admin/oauth/` 单独分流 |
| storage | `/storage/preview/*` | 显式 `return 404`（预览改走 `/api/storage/*` 的资源鉴权，不再直代私有桶）；网关为它保留一条 location，属于刻意的退役占位 |
| catalog | `/api/capabilities`、`/api/admin/modules/:id` | 部署态只读聚合 + 开关退役返回 409（见 capabilities 文档）；`/health` 由各服务自己提供给聚合探测 |

**网关按前缀分流，不按服务改前端调用点。** 只有 `/api/users/{id}/favorites` 与用户资料同前缀，
网关用精确正则 `^/api/users/[^/]+/favorites$` 单独分流到 community。

### 2.1 网关矩阵、密钥与 UI 的归属（2026-09 审计）

- **网关矩阵**：唯一生效的是 `deploy/nginx.conf`；`metafusion-api-gateway` 仓库里的矩阵是切流前的旧版本（仍把账号前缀指向 `catalog:8080`），**不是部署输入**。把它收敛为唯一来源（或从该仓库删除）与矩阵对文档表格的自动比对，见 [审计文档](./decoupling-audit-2026-09.md) §6。
- **密钥边界**：签发私钥只在账号服务。现状目录侧读 `AUTH_JWT_PRIVATE_KEY` 只为派生公钥，应改为静态公钥或 JWKS（证据见 [审计文档](./decoupling-audit-2026-09.md) §2）。
- **UI 归属**：现状四域 UI 全在主仓库 `frontend/`；目标形态是**每个服务自带 UI**，网关按 `/`、`/account`、`/community`、`/downloads` 聚合，目录详情页对社区与资源区块改用嵌入契约（已定，见 [审计文档](./decoupling-audit-2026-09.md) §7）。

## 3. 数据归属与边界

- 每个服务拥有自己的 schema，只读写自己的表；**禁止跨服务 JOIN**。
- 服务间只通过 HTTP 契约与事件交互：
  - storage/community 判定"实体是否可见"必须走 catalog 的实体查询接口，不得直连 catalog 表。
  - 实体合并（`entity.merged`）写入目录的 `catalog.outbox`；**当前没有任何跨服务消费者**（投递函数 `Store.Deliver` 只在测试里被调用），子系统对合并结果的收敛靠同步查询目录接口。
    `deliveries`（consumer + `event_id`）去重与回调按事件 ID 幂等，是**将来引入投递时的契约**而不是现状；投递与拉取的取舍见 [多项目解耦审计与优化建议](./decoupling-audit-2026-09.md) §5。
- 存储系统**不保存**元数据结构（不复制作品/专辑/曲目表）；元数据系统**不保存**对象存储物理路径。
- 绑定的"用途"用 `binding_role` 表达（`track_audio` / `disc_image` / `scans` / `video` …），
  "区间/位置"仍留在元数据侧的 `locator`（TrackContent），两者不重复：文件说"我是谁的什么用途"，目录说"收录在第几轨/什么时间码"。

## 4. 认证边界

- 只有 auth 签发令牌；其余服务**只验签**（RS256，JWKS）。验签信 `sub`/`preferred_username`/`role`，
  以及授权用的 `groups`/`permissions`（auth 按组展开后的权限码集合，admin 组带 `*` 通配）。
- issuer 保持 `https://findverse.cc/api`、audience 保持 `metafusion`，避免存量令牌全部失效。
- 各服务的 JWKS 地址用环境变量注入，现在都指向账号服务：community 的 `COMMUNITY_JWKS_URL`、storage 的
  `STORAGE_JWKS_URL` = `http://auth:8081/api/oidc/jwks`（catalog/community/storage 都不提供 JWKS，只验签）。
- 主仓库 `Store.Authenticate` **只做 RS256 验签**：
  目录不读账号服务的表。存量不透明令牌的兜底由各服务问账号服务（`AUTH_URL`），
  续期仍走账号服务的 `/api/auth/refresh`（短期访问令牌，否则用户会被强制下线）。
- 业务权限（谁能编辑哪个实体）仍由 catalog 自己判断：auth 只负责把权限码装进组、随令牌下发
  `permissions`；目录侧按码判定（`backend/internal/catalog/permission.go`），令牌没带
  `permissions` 时按历史 `role` 兜底。auth 不介入具体判定。

## 5. 迁移阶段与验收

> **进度**：P0–P5 已全部完成；下表是各阶段的契约与验收判据。
>
> - **遗留**：收藏"是否公开"仍只有前端只读占位（`settings/page.tsx` 的开关是 `disabled readOnly`，
>   目录侧无字段），接口恒返回 `visible: true`；实现该开关时归互动服务。
> - **运维注意**：文档站镜像没有任何仓库发布，而 `deploy/docker-compose.prod.yml` 把它写成预构建镜像，
>   因此 `deploy.sh pull` 前要先在文档仓库构建并推送该镜像，否则该服务拉不到。

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 | 冻结契约（本文 + 各服务 README 对齐路由与数据归属） | 网关路由表与本文逐条一致 |
| P1 | storage：承接 `/api/storage/*`（CAS、秒传、分片预签名、绑定角色、下载与访问控制、哈希校验） | 网关把 `/api/storage/*` 指向存储服务；存储桶由服务启动时自建 |
| P2 | community：承接论坛/短评/收藏/记录 | 路径与请求/响应形状与拆分前逐字一致；数据在 `community.*` |
| P3 | auth：承接 setup/auth/admin/oauth | 只有 auth 签发令牌，其余服务只验签；账号数据在 `auth.*` |
| P4 | catalog 瘦身 + 网关切流：目录不再承载 `/api/archive`、`/api/playback`、`/api/media`、`/api/community` | 上述前缀不由网关分流；目录侧只剩 RS256 验签，不读别人表、不建跨 schema 外键 |
| P5 | 文档去重：`metafusion-docs` 为唯一源 | 编排从兄弟目录构建文档站，本仓库不再存放 doc 页面 |

每个阶段独立提交、独立可回退；不回滚别人的改动，也不做双向写入。

## 6. 回滚

网关按前缀切换，切换点只有 nginx 一张表；任一阶段出问题只需把前缀指回主仓库，数据由各服务独立 schema 承担，
迁移期不做双向写入，因此不存在冲突合并问题。
