# 子系统拆分与迁移基准

本文记录 MetaFusion 从"单进程模块化单体"迁移到"按职责划分的独立服务"的路由与数据归属契约。
P0–P5 已落地；运行时行为仍须核对目标实例、实际处理器与已执行迁移。变更契约时同步修改本文与实现。

相关文档：[规范驱动开发需求与架构基准](./spec-driven-requirements.md)、[插件架构 VISION（未实现）](./plugin-decoupling-blueprint.md)。

## 1. 目标运行单元

| 运行单元 | 职责 | 拥有数据（schema） | 对外路径前缀 | 仓库 |
| --- | --- | --- | --- | --- |
| 元数据目录 catalog | 八类实体、动态定义、关系、结构、修订、检索、货架、外部库 | `catalog.*` | `/api/catalog/*`、`/api/importer/*`、`/api/exchange/*`、`/api/capabilities`、`/api/admin/{catalog-definitions,external-databases,shelves,modules}`、`/api/openapi.json`、`/api/version` | MetaFusion（本仓库） |
| 账号 auth | 注册/登录、会话、令牌签发与吊销、OAuth2/OIDC、账号与角色管理、开发者中心（应用自助登记与接入配置） | `auth.*` | `/api/setup`、`/api/auth/*`、`/api/admin/users*`、`/api/oauth/*`、`/api/developer/*`、`/api/oidc/jwks`、`/api/.well-known/openid-configuration` | metafusion-auth |
| 互动 community | 论坛板块/主题/回复/标签、条目短评、个人收藏、私信 | `community.*` | `/api/community/*`、`/api/favorites/*`、`/api/messages/*`、`/api/users/{id}/favorites` | metafusion-community |
| 存储 storage | 物理文件、哈希与去重、对象存储直传、绑定、下载/预览与访问控制 | `storage.*` | `/api/storage/*` | metafusion-storage |
| 边缘网关 gateway | 统一入口、按前缀分流、限流、安全响应头 | 无 | `/`、`/docs`、各 `/api/` 前缀 | 本仓库 `deploy/nginx.conf`（`metafusion-api-gateway` 只留切流自检脚本） |
| 文档 | 全站文档（唯一源） | 无 | 由网关 `/docs` 反代 | metafusion-docs |
| 技能 | 编目技能（curator / lrm-catalog-standards） | 无 | 无（非运行时） | metafusion-skills |

前端（Next.js，本仓库 `frontend/`）不属于任何业务服务，通过网关调用各前缀；`frontend/src/lib/services.ts`
里的 `NEXT_PUBLIC_AUTH_URL` / `NEXT_PUBLIC_FORUM_URL` / `NEXT_PUBLIC_STORAGE_URL` / `NEXT_PUBLIC_DOCS_URL`
是既有的外部化开关，服务切换时优先用它们，而不是改调用点。

## 2. 路由归属（现状）

唯一生效的矩阵是 `deploy/nginx.conf`（compose 的 `gateway` 服务）：实测 **45 条 `location`**（以 `python scripts/check_gateway_matrix.py` 输出为准；2026-09 起陆续接入三个服务管理台、账号自助应用及其静态资源、举报/申诉与私信路径后增长，删掉 `/api/records/` 后），账号前缀用精确匹配与正则逐条分流。
下表按归属归纳路径族；逐条 location 与精确匹配以文件为准。矩阵与本文表格的一致性检查、以及网关矩阵的单一来源归属见 [多项目解耦审计与优化建议](./decoupling-audit-2026-09.md) §6。

| 归属 | 路径 | 现状 |
| --- | --- | --- |
| auth | `GET|POST /api/setup` | metafusion-auth；网关用 `location = /api/setup` 精确匹配 |
| auth | `POST /api/auth/login|refresh|logout|logout-all|register`、`GET /api/auth/me|settings|invite`、`POST /api/auth/invite`、`PUT /api/auth/password` | metafusion-auth（`/api/auth/` 前缀） |
| auth | `GET|POST /api/admin/users`、`PUT /api/admin/users/:id/{role,password,groups}`、`PUT /api/admin/users/:id/ban` | metafusion-auth（`/api/admin/users` 前缀） |
| auth | `GET /api/auth/oauth-grants`、`DELETE /api/auth/oauth-grants/:client_id` | metafusion-auth（账号自助撤回第三方授权；网关 `/api/auth/` 前缀已覆盖） |
| auth | `GET /api/admin/audit-logs` | metafusion-auth（**跨服务审计表的唯一读取面**：catalog/auth/community/storage 都往 `audit.audit_log` 写，只有这里能看全，见 [审计留痕契约](audit-log.md)；与目录侧 `/api/admin/*` 同前缀，网关逐条精确匹配） |
| auth | `GET|POST /api/admin/groups`、`PUT|DELETE /api/admin/groups/:code`、`GET /api/admin/permissions`、`GET|PUT /api/admin/settings`、`GET|POST /api/admin/invites`、`POST /api/admin/invites/:code/revoke` | metafusion-auth；与目录侧 `/api/admin/*` 同前缀，网关逐条精确匹配（漏一条就 404） |
| auth | `/api/oauth/authorize|token|userinfo`、`/api/oidc/jwks`、`/api/.well-known/openid-configuration`、根路径 `/.well-known/{openid-configuration,jwks.json}` | metafusion-auth（令牌只由它签发，discovery 与 JWKS 也只在它这里） |
| auth | `/api/developer/*`（overview、apps、apps/{id}、apps/{id}/rotate-secret） | metafusion-auth（开发者中心：任何登录账号自助登记应用；网关用 `/api/developer/` 前缀整体分流，不与 `/api/admin/oauth/*` 混用） |
| catalog | `/api/catalog/*`（definitions、tags、entities、relations、shelves、compare、me/home-preferences 等）、`/api/importer/*`、`/api/exchange/*`、`/api/capabilities`、`/api/admin/{catalog-definitions,external-databases,shelves,modules}`、`/api/openapi.json` | 本仓库，保留 |
| catalog | `GET /api/notifications`、`GET /api/notifications/unread-count`、`POST /api/notifications/read-all`、`POST /api/notifications/:id/read`、`POST /api/notifications/internal` | 本仓库（站内通知收件箱：`catalog.notifications`，2026-09-20 落地，迁移 `000003_notifications`；读取端按令牌身份收件，跨服务投递端 `internal` 由互动服务凭 `INTERNAL_API_TOKEN` 写入；网关走 `/api/` 兜底分流到目录服务，无需单列 location） |
| catalog | `GET /api/version` | 本仓库：运行中进程的版本身份——构建期注入的版本与 git sha、构建时间、进程启动时间（同一个 `/api/` 兜底 location 分流）；匿名可读，只回身份字段，不含配置、凭据与主机信息，用于发布/回滚后核对"线上跑的是哪一版" |
| community | `/api/community/*`（boards、topics、topic-tags、feed、entities/:id/posts、entities/:id/collections、posts/:id、**reports 与 admin/reports｜admin/appeals**） | metafusion-community（举报与申诉：用户端 `POST /reports`、`GET /reports/mine`、`POST /reports/:id/appeal`；管理端 `GET /admin/reports`、`/{id}`、`/{id}/accept|reject|resolve`、`GET /admin/appeals`、`POST /admin/appeals/:id/review`——同属 `/api/community/` location，不需要新增网关条目） |
| community | `/api/favorites/toggle|status|mine`、`/api/users/:id/favorites` | metafusion-community（`community.favorites`） |
| auth | `GET /api/users/:id` | metafusion-auth（公开账号资料；同前缀多归属，网关用 `^/api/users/[^/]+$` 精确分流） |
| catalog | `GET /api/users/:id/contributions` | 本仓库（用户贡献列表；两段式，不匹配那两条正则，落目录服务兜底） |
| community | `GET /api/users/:id/stats` | metafusion-community（用户互动统计：主题/回复/收藏计数；网关用 `^/api/users/[^/]+/stats$` 分流） |
| community | `GET|POST /api/messages/with/:id`、`PUT /api/messages/with/:id/read`、`GET /api/messages/conversations`、`GET /api/messages/unread` | metafusion-community（私信：读写同一对用户之间的消息 + 收件箱会话列表/未读总数/标记已读；网关用 `/api/messages/` 前缀分流，四条路径同属该前缀） |
| storage | `/api/storage/*`（契约见 `metafusion-docs` 的 `docs/api-storage.md`） | metafusion-storage（契约见 `metafusion-docs` 的 `docs/api-storage.md`） |
| auth | `/api/admin/oauth/*`（客户端治理：核验、提升自有平台、吊销、审计） | metafusion-auth；与目录侧 `/api/admin/*` 同前缀，网关用 `location /api/admin/oauth/` 单独分流 |
| storage | `/storage/preview/*` | 显式 `return 404`（预览改走 `/api/storage/*` 的资源鉴权，不再直代私有桶）；网关为它保留一条 location，属于刻意的退役占位 |
| catalog | `/api/capabilities`、`/api/admin/modules/:id` | 部署态**声明式**能力清单（不再主动探活上游，见 capabilities 文档）+ 开关退役返回 409；目录服务自己也提供 `/health`（与 account/community/storage 同形），`/ready` 仍探数据库 |
| auth | `/admin/account/*` | metafusion-auth 自带的管理台（`admin/` 目录，独立 Next 应用）：页面与静态资源在这里，数据请求走上面已分流的 `/api/*`；网关用 `location /admin/account/` 指 `auth-admin:3000`，无尾斜杠的 `/admin/account` 由 `location =` 301 补齐（否则落主前端得到 404） |
| auth | `/login`、`/setup`、`/auth-user-assets/_next/static/*` | metafusion-auth 自带的账号自助应用（`user/` 目录，独立 Next 应用，无 basePath）：登录/注册/初始化三页，Cookie 会话口径；网关将页面精确转发到 `auth-user:3000`，并把专属静态资源前缀重写到该服务的 `/_next/static/`，避免与主前端同域静态资源冲突。 |
| community | `/admin/community/*` | metafusion-community 自带的管理台（`admin/` 目录，独立 Next 应用）：同上，网关用 `location /admin/community/` 指 `community-admin:3000`；页面路径与主站页面 `/community` 不重叠 |
| storage | `/admin/storage/*` | metafusion-storage 自带的管理台（`admin/` 目录，独立 Next 应用）：同上，网关用 `location /admin/storage/` 指 `storage-admin:3000` |

**网关按前缀分流，不按服务改前端调用点。** `/api/users/*` 是「同前缀、多归属」的典型，靠三条正则各自锚定：
`/api/users/{id}` 归账号服务、`/api/users/{id}/favorites` 与 `/api/users/{id}/stats` 归互动服务、
`/api/users/{id}/contributions` 归目录服务（前三条把对应路径从目录兜底里分流出去，最后一条落兜底）。

### 2.1 网关矩阵、密钥与 UI 的归属（2026-09 审计）

- **网关矩阵**：唯一生效的是 `deploy/nginx.conf`。2026-09 已把 `metafusion-api-gateway` 仓库里的旧矩阵移入 `examples/pre-cutover/` 并标注不参与部署（该仓库现在只有脚本），`cutover-check.sh` 改为**断言服务标记头**、新增离线 `--self-check`。矩阵的自动校验在主仓库：`scripts/check_gateway_matrix.py`（条数、每条 `/api/*` 必须挂限流、矩阵↔本文 §2 表的登记与归属比对）与 `scripts/check_versions.py`（`deploy/versions.lock`）。**仍未做**的是“把矩阵本体搬进网关仓库、主仓库只引用”，见 [审计文档](./decoupling-audit-2026-09.md) §6。
- **密钥边界**：签发私钥只在账号服务。目录侧按 `AUTH_JWT_PUBLIC_KEY`（静态公钥）或 `AUTH_JWKS_URL`（账号服务的 JWKS）取验签公钥，不再从 `AUTH_JWT_PRIVATE_KEY` 派生公钥。证据与判据见 [审计文档](./decoupling-audit-2026-09.md) §2。
- **协议层 SDK**：`metafusion-sdk` 仓库骨架已建（Claims/RS256+JWKS 验签/权限码与 `Can`/错误体与分页/health/request-id，零第三方依赖）。**尚无双端接入**：三个服务仍各自实现，切换是 B2 的后续批次；接入前需核对各服务现行的分页语义。
- **UI 归属**：三个服务各自的管理台（账号 / 互动 / 存储，各自仓库的 `admin/` 目录）已由网关与主编排接入。普通用户页面仍跨主仓库 `frontend/` 与账号服务的 `user/` 应用；社区与资源区块仍耦合在目录详情页。逐域独立发布、共享 UI 层与嵌入契约仍是目标，见 [审计文档](./decoupling-audit-2026-09.md) §7。

## 3. 数据归属与边界

- 每个服务拥有自己的 schema，只读写自己的表；**禁止跨服务 JOIN**。
- 服务间只通过 HTTP 契约与事件交互：
  - storage/community 判定"实体是否可见"必须走 catalog 的实体查询接口，不得直连 catalog 表。
  - 实体合并（`entity.merged`）写入目录的 `catalog.outbox`；**当前没有任何跨服务消费者**（投递函数 `Store.Deliver` 只在测试里被调用），子系统对合并结果的收敛靠同步查询目录接口。
    `deliveries`（consumer + `event_id`）去重与回调按事件 ID 幂等，是**将来引入投递时的契约**而不是现状；投递与拉取的取舍见 [多项目解耦审计与优化建议](./decoupling-audit-2026-09.md) §5。
- 结构来源：目录迁移由 `backend/migrations/*.sql` + `mf-migrate up` 执行，空库内容种子由 `mf-migrate seed` 显式发布；目录 HTTP 进程启动只做 `CheckCompatibleVersion` 只读检查，不再执行 DDL 或种子。互动与存储各自把 DDL 放进仓库内（社区 `migrations/000001_init.up.sql`、存储 `internal/store/migrations/000001_init.up.sql`，均 `go:embed`），启动执行尚未记账的迁移并写入 `<schema>.schema_migrations`。账号服务仍在启动路径执行自身 DDL。四服务的迁移职责尚未完全统一。
  迁移锁须按实际路径区分：目录 `mf-migrate` 用会话级锁 `88481001`；存储迁移用事务级锁 `740204`，互动迁移用事务级锁 `740205`。目录运行写入的 `740202` 与账号写入的 `740203` 不是迁移锁；共享审计表 DDL 另用 `740205` 跨服务串行化。新增迁移入口时先核对现有锁的作用域与顺序，不能直接套用旧键位表。
  “启动只校验、迁移由 owner 单独跑”已在目录服务实现；账号、互动、存储仍需分离启动与迁移（受限角色下 DDL 会遇到权限问题），见 [审计文档](./decoupling-audit-2026-09.md) §4.3。
- **库侧权限边界（2026-09 落地）**：四个服务各有自己的库角色（`mf_catalog` / `mf_auth` / `mf_community` / `mf_storage`），
  只对本域 schema 有权限，越权读写由库直接拒绝；仅有的跨域例外是共享审计表 `audit.audit_log`
  （四个服务只追加）与切流的 community-migrate 工具。授权脚本 `deploy/sql/roles-least-privilege.sql`、
  断言 `deploy/sql/verify-role-isolation.sql`、口径与回滚见 [数据层角色与最小权限](./database-roles.md)。
- 存储系统**不保存**元数据结构（不复制作品/专辑/曲目表）；元数据系统**不保存**对象存储物理路径。
- 绑定的"用途"用 `binding_role` 表达（`track_audio` / `disc_image` / `scans` / `video` …），
  "区间/位置"仍留在元数据侧的 `locator`（TrackContent），两者不重复：文件说"我是谁的什么用途"，目录说"收录在第几轨/什么时间码"。

## 4. 认证边界

- 只有 auth 签发令牌；其余服务**只验签**（RS256，JWKS）。验签信 `sub`/`preferred_username`/`role`，
  以及授权用的 `groups`/`permissions`（auth 按组展开后的权限码集合，admin 组带 `*` 通配）。
- issuer 保持 `https://findverse.cc/api`、audience 保持 `metafusion`，避免存量令牌全部失效。
- 各服务的 JWKS 地址用环境变量注入，现在都指向账号服务：catalog 的 `AUTH_JWKS_URL`、community 的 `COMMUNITY_JWKS_URL`、storage 的
  `STORAGE_JWKS_URL` = `http://auth:8081/api/oidc/jwks`（catalog/community/storage 都不提供 JWKS，只验签；catalog 也可用静态公钥 `AUTH_JWT_PUBLIC_KEY`）。
- 主仓库 `Store.Authenticate` **只做 RS256 验签**；社区和存储服务也在本地验签会话 JWT，PAT 则经账号服务内省。目录不读账号服务的表；续期走账号服务的 `/api/auth/refresh`。
- 业务权限（谁能编辑哪个实体）仍由 catalog 自己判断：auth 只负责把权限码装进组、随令牌下发
  `permissions`；目录侧按码判定（`backend/internal/catalog/permission.go`），令牌没带
  `permissions` 时按历史 `role` 兜底。auth 不介入具体判定。

## 5. 迁移阶段与验收

> **遗留**：收藏"是否公开"仍只有前端只读占位（`settings/page.tsx` 的开关是 `disabled readOnly`，
>   目录侧无字段），接口恒返回 `visible: true`；实现该开关时归互动服务。
> - **运维注意**：文档站镜像没有任何仓库发布。`deploy/docker-compose.prod.yml` 只给它一个镜像名、**保留 `build`**，
>   而 `deploy.sh pull` 带 `--ignore-pull-failures`：镜像缺席时就地从兄弟目录 `../../metafusion-docs` 构建，不会让整条命令失败。

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 | 冻结契约（本文 + 各服务 README 对齐路由与数据归属） | 网关路由表与本文逐条一致 |
| P1 | storage：承接 `/api/storage/*`（CAS、秒传、分片预签名、绑定角色、下载与访问控制、哈希校验） | 网关把 `/api/storage/*` 指向存储服务；存储桶由服务启动时自建 |
| P2 | community：承接论坛/短评/收藏/记录 | 路径与请求/响应形状与拆分前逐字一致；数据在 `community.*` |
| P3 | auth：承接 setup/auth/admin/oauth | 只有 auth 签发令牌，其余服务只验签；账号数据在 `auth.*` |
| P4 | catalog 瘦身 + 网关切流：目录不再承载 `/api/archive`、`/api/playback`、`/api/media`、`/api/community` | 上述前缀不由网关分流；目录侧只剩 RS256 验签，不读别人表、不建跨 schema 外键 |
| P5 | 文档去重：`metafusion-docs` 为唯一源 | 编排从兄弟目录构建文档站，本仓库不再存放 doc 页面 |

各阶段以独立迁移批次验收；回滚前检查数据库兼容性与切流后的新写入，详见 §6。

## 6. 回滚

网关按前缀切换，但回滚不等于只改一张 nginx 表：主仓库已移除部分旧业务处理器，旧版服务也未必理解新 schema 或新数据。
回滚前须核对目标镜像是否仍提供该路径、数据库迁移的向后兼容性、以及切流后该域的新写入；
不能简单把前缀指回主仓库。实际操作按 [切流手册](./cutover-runbook.md) 的版本与数据检查执行。
