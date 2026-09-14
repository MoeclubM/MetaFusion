# 子系统切流手册（P4）

配套文档：[子系统拆分与迁移契约](./service-split-migration.md)。本手册描述**如何把流量从单体切到各服务**，
以及**每一步怎么验、怎么退**。所有命令都在有数据库访问权的运维机上执行。

## 一次性切流（已脚本化）

首次把实例切到拆分后的架构，在部署机（开发服务器）上一条命令即可：

```bash
cd deploy && ./deploy.sh cutover
```

它按本手册第 1 章的顺序执行：构建全部镜像 → 起基础设施与账号/互动/存储/目录 →
目录库版本化迁移 → `community-migrate -direction forward` 搬运旧表数据 →
最后拉起网关（网关以各上游 `/ready` 为健康门控，上游没就绪就不开门）。

本手册其余部分说明每一步的判据、数据方向与回滚方式；手工逐步操作时按章节顺序执行，
结论与脚本化路径一致。

**脚本化路径一次切换全部前缀，前提是目标实例没有需要保住的存量互动数据**（开发/测试实例即如此，
旧表数据由 `community-migrate` 一次搬全）。有在线数据、需要按前缀分批切的实例，按第 1 章逐步执行。

### 网关必须显式重载

`deploy/nginx.conf` 是以**文件**挂载进网关容器的，Compose 只比对服务定义、不比对被挂载文件的内容，
因此改完路由矩阵后 `up -d` 不会重建网关，配置改了却不生效。`deploy.sh` 的每个部署动作末尾都会先
`nginx -t` 校验再 `nginx -s reload`；手工操作时也要补这一步：

```bash
docker exec metafusion-gateway nginx -t && docker exec metafusion-gateway nginx -s reload
```

## 0. 切流前的硬前提

| 前提 | 判据 |
| --- | --- |
| 三个服务已部署且健康 | `curl -fsS http://auth:8081/ready`、`community:8083/ready`、`storage:8082/ready` 均 200 |
| **RSA 私钥一致** | auth 与 catalog 的 `AUTH_JWT_PRIVATE_KEY` 必须同一把密钥：否则切到 auth 后登录签发的令牌在 catalog 侧验签失败，用户会立刻掉线 |
| issuer/audience 一致 | 两处 `AUTH_JWT_ISSUER=https://findverse.cc/api`、`AUTH_JWT_AUDIENCE=metafusion` |
| 数据库可达 | 三个服务与单体连同一个 PostgreSQL 实例（各用自有 schema） |
| 导入演练 | `docker compose run --rm community-migrate -direction forward -dry-run` 能打印各源表行数，且不写入 |
| 回滚路径可用 | 网关配置可改（每前缀一行 `set $x_backend`），并能重启 gateway 容器 |
| 服务身份可辨 | 三个服务会在响应头返回 `X-MetaFusion-Service`；切流自检据此确认前缀切到了目标上游 |

### 第 0.5 步：切换前基线（两条命令，建议每次切流都跑）

```bash
# 1) 真实数据库回归（三个服务仓库各跑一次；未设置 *_TEST_DSN 时自动跳过）
cd metafusion-community && COMMUNITY_TEST_DSN="postgres://…/metafusion_community_test" go test ./...
cd metafusion-auth      && AUTH_TEST_DSN="postgres://…/metafusion_auth_test"           go test ./...
cd metafusion-storage   && STORAGE_TEST_DSN="postgres://…/metafusion_storage_test"     go test ./...

# 2) 切流自检（metafusion-api-gateway 仓库；逐项打印 PASS/FAIL/SKIP）
GATEWAY=https://<host> DSNS="postgres://…/metafusion_db" ./scripts/cutover-check.sh
```

自检脚本靠响应头 `X-MetaFusion-Service` 判断前缀究竟由哪个上游答复（单体也有同名标记 `metafusion-catalog`），
并对 `topics/posts/boards/records/favorites` 五张表做新旧行数对比。**切换瞬间这五个差值应为 0。**

**表结构等价性已有测试保证**（不需要数据库即可运行）：
- 互动服务：`internal/store/schema_parity_test.go` 冻结了老表六张表的逐列定义（名称/类型/约束/默认值），
  搬运过来的 handler SQL 按老表结构编写，任何漂移都会让该用例失败；
- 账号服务：`internal/store/schema_parity_test.go` 冻结了主仓库 `auth` schema 的终态（含迁移 000009 的 PKCE 列），
  保证全新库上建出来的表与线上一致。

因此切流前只需要跑 `go test ./...` 就能确认"新库能承受老代码的 SQL"，不必等真实请求报错。

## 1. 切流顺序与逐步操作

按"风险从低到高"排序：先切前端完全没在用的存储，最后切最关键、有实时数据的互动。

> **已用 `./deploy.sh cutover` 一次性切完的实例不需要再逐步执行这一步；
> 下面三步保留给「有在线数据、必须按前缀分批切」的实例，以及未来回滚演练时的参照。**

### 第 1 步：storage（前端不调用，风险最低）

存储契约是 `/api/storage/*`，网关矩阵里这几处 location 从 P1 起就指向 `http://storage:8082`，
所以这一步**没有「切流」动作**，只需要确认服务健康：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<host>/api/storage/stats   # 401 = 已在鉴权，符合预期
```

- 单体从来没有 `/api/storage/*`，因此不存在「切回单体」的回滚路径；真要退就是停掉这些 location。
- 旧的 `/api/archive/`、`/api/playback/`、`/api/media/` 前缀已退役：网关不再为它们单列 location
  （落到 `/api/` 兜底），前端也从不调用它们（已核对源码）。
- 媒体分析（ffprobe 探针、预览转码）没有迁进存储服务，属既有缺口，见第 4 节。
- `modules.resources` / `resource_bindings` 当时为空，且已随 `./deploy.sh retire` 删除，没有数据要搬。

### 第 2 步：auth（零数据迁移，回滚成本最低）

```bash
# 网关：把 6 处 auth 前缀的 upstream 从 catalog:8080 改为 auth:8081：
#   /api/auth/  /api/setup  /api/admin/users  /api/oauth/  /api/oidc/  /api/.well-known/
docker compose -f deploy/docker-compose.yml up -d --force-recreate gateway
```

验证（按顺序，任一失败即回滚）：
1. `curl -fsS https://<host>/api/setup` → `{"needed":false,"is_initialized":true,"has_admin":true}`
2. 用**已登录浏览器**打开任意页面 → 不掉线（说明 catalog 仍能验签 auth 签发的令牌）
3. 新登录一次 → 成功；`GET /api/auth/me` 返回当前账号
4. `curl -fsS https://<host>/api/.well-known/openid-configuration` 与 `/.well-known/openid-configuration` 返回同一份文档

回滚：6 处 upstream 指回 `http://catalog:8080`。**不需要数据操作**——两边读写同一个 `auth` schema。
注意：若切流后已用 auth 服务改过密码/角色，回滚后单体读同一张表，改动依然生效（这是"同 schema"的好处）。

### 第 3 步：community + records + favorites（有实时数据，必须按窗口执行）

```bash
# 1) 切换前立刻补增量（此刻单体仍是唯一写入方）
#    搬运工具与互动服务共用同一镜像，因此搬运用的一定是当前部署的代码；
#    它幂等且只读源表，可以随时重跑补增量。
cd deploy
docker compose --env-file ../.env -f docker-compose.yml run --rm community-migrate -direction forward -dry-run
docker compose --env-file ../.env -f docker-compose.yml run --rm community-migrate -direction forward

# 2) 网关：把 /api/community/、/api/records/、/api/favorites/、/api/users/{id}/favorites
#    四处 upstream 改为 http://community:8083
docker compose -f deploy/docker-compose.yml up -d --force-recreate gateway
```

验证：
1. `curl -fsS https://<host>/api/community/boards` → 板块列表（切流前后条数一致）
2. 打开一个原有主题页 → 标题/回复/标签与切流前一致（楼层号 `post_number` 不变）
3. 个人主页收藏列表 → 条数与切流前一致（说明 forward 导入生效）
4. 发一条测试主题与一条测试短评 → 写入成功；在社区页可见

**回滚（关键）**：先把服务期间写入的行搬回单体，再改网关。
```bash
cd deploy
docker compose --env-file ../.env -f docker-compose.yml run --rm community-migrate -direction back -dry-run
docker compose --env-file ../.env -f docker-compose.yml run --rm community-migrate -direction back
# 然后网关四处 upstream 指回 http://catalog:8080
```
顺序不能颠倒：先改网关再搬数据，会让回滚窗口内的新帖在单体侧消失。

### 第 4 步：下线遗留结构（切流验证通过后，一条命令）

```bash
cd deploy && ./deploy.sh retire
```

删除对象、删除理由与「先核对目标行数再删」的守卫都在 `deploy/sql/retire-legacy-schemas.sql`：
`modules` / `media` 两个 schema、`catalog.favorites`，以及 2026-09-11 手工迁移留下的临时备份表。
执行后库里只应剩下 `catalog` / `auth` / `community` / `storage` 四个业务 schema（脚本末尾会打印核对结果）。

已经下线的对象：

| 移除对象 | 说明 | 时机 |
| --- | --- | --- |
| `modules`、`moduleapi`、`moduledeps` 三个包（约 2900 行） | 模块装配与论坛/资源层，功能已由互动与存储服务承载 | 拆分期随目录包收敛删除 |
| `modules` / `media` schema、`catalog.favorites`、临时备份表 | 已无代码读写 | `./deploy.sh retire` |

**代码侧已完成（2026-09-14）**：删掉 `catalog/identity.go` / `favorites.go` 与全部账号/收藏路由；
`token.go` 收敛为**只持公钥的验签器**（没有签发、续期、注销入口）；`Store.Authenticate` 不再回退查
`auth.sessions`；`schema.sql` 不再建 `auth.*` 与 `catalog.favorites`（后者由迁移 000014 下线），
第一方 OAuth 客户端种子随 auth schema 搬进账号服务；修订历史的作者名改为写入时快照
（迁移 000015），因此目录侧不再有跨 schema 的 JOIN。部署方式：`./deploy.sh migrate up`（新迁移）后 `./deploy.sh fast`。

## 2. 为什么每步都可回滚

| 系统 | 数据布局 | 回滚代价 |
| --- | --- | --- |
| auth | 两边读写**同一个** `auth` schema | 改网关，无数据操作 |
| community / records / favorites | 单体写 `modules.*`、`catalog.favorites`；服务写 `community.*` | 先 `-direction back` 搬运，再改网关 |
| storage | 单体写 `modules.resources`；服务写 `storage.*` | 改网关；旧数据仍在单体表里 |

**单一写入方规则**：任何时刻只允许一侧写入。切流前单体写、服务不接流量；切流后服务写、单体前缀不再被路由到。
跨过窗口不补增量就会出现"看不见的新数据"，这正是 `cmd/migrate` 两个方向都要存在的原因。

> 执行 `./deploy.sh retire` 之后，`modules` / `media` schema 与 `catalog.favorites` 已被删除，
> 互动与存储的「搬回单体」回滚路径随之失效，回滚只剩「改网关 + 恢复上一版镜像」。
> 这也是把这一步放在切流验证通过之后、而不是切流之中的原因。

## 3. 前端为什么不用改

- 所有 API 调用都走同源 `/api/*`（`fetchApi` 前缀），由网关按前缀分流，因此服务切换对前端透明。
- 前端对受影响前缀的实际调用（已核对）：`/auth/*`（设置页）、`/community/*`（社区页）、`/favorites/*`（收藏按钮与个人主页）、
  `/users/{id}/*`（个人主页）。
- 前端**完全不调用** `/archive/`、`/playback/`、`/media/`、`/storage/`、`/records/`、`/exchange/`，
  这也是存储可以先切、且风险最低的原因。
- 页面级外链（账号页、资源站、文档站）由 `frontend/src/lib/services.ts` 的 `NEXT_PUBLIC_*` 控制，与本次切流无关。

## 4. 还没处理的问题

| 问题 | 现状 | 影响 |
| --- | --- | --- |
| ~~单体账号代码~~ | 已完成：账号实现与路由删除，`token.go` 只剩验签，目录不再建/写 `auth` schema | 不需要再处理 |
| `/api/media/*` | ffprobe 探针与预览转码没有迁进存储服务，网关也没有这个前缀 | 该能力当前不可用（既有缺口，不是切流引入） |
| 浏览器预签名直传 | 对象存储不发布宿主机端口，当前走服务端流式上传 | 恢复直传要给对象存储一个独立对外域名并设 `STORAGE_S3_PUBLIC_ENDPOINT`（SigV4 覆盖 Host，只加路径前缀不行） |
| Redis | 常驻但已无代码读取（`REDIS_ADDR` 已从后端配置移除） | 可以从常驻服务里去掉，省一份常驻内存 |
| 收藏「是否公开」 | 前端只读占位，接口恒 `visible: true` | 实现该开关时归互动服务 |

已完成、不再待办：`/api/capabilities` 改为「上游是否配置 + /health 探测」的部署态视图，
`PUT /api/admin/modules/:id` 返回 `409 module_toggle_retired`；`/api/exchange/*` 已随目录包收敛留在单体。