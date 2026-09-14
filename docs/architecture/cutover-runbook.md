# 子系统切流手册（P4）

配套文档：[子系统拆分与迁移契约](./service-split-migration.md)。本手册描述**如何把流量从单体切到各服务**，
以及**每一步怎么验、怎么退**。所有命令都在有数据库访问权的运维机上执行。

## 0. 切流前的硬前提

| 前提 | 判据 |
| --- | --- |
| 三个服务已部署且健康 | `curl -fsS http://auth:8081/ready`、`community:8083/ready`、`storage:8082/ready` 均 200 |
| **RSA 私钥一致** | auth 与 catalog 的 `AUTH_JWT_PRIVATE_KEY` 必须同一把密钥：否则切到 auth 后登录签发的令牌在 catalog 侧验签失败，用户会立刻掉线 |
| issuer/audience 一致 | 两处 `AUTH_JWT_ISSUER=https://findverse.cc/api`、`AUTH_JWT_AUDIENCE=metafusion` |
| 数据库可达 | 三个服务与单体连同一个 PostgreSQL 实例（各用自有 schema） |
| 导入演练 | `go run cmd/migrate -dry-run`（metafusion-community）能打印各源表行数，且不写入 |
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

自检脚本靠响应头 `X-MetaFusion-Service` 判断前缀究竟由哪个上游答复（单体没有这个头，会显示 `catalog(无标记)`），
并对 `topics/posts/boards/records/favorites` 五张表做新旧行数对比。**切换瞬间这五个差值应为 0。**

## 1. 切流顺序与逐步操作

按"风险从低到高"排序：先切前端完全没在用的存储，最后切最关键、有实时数据的互动。

### 第 1 步：storage（前端不调用，风险最低）

```bash
# 网关：/api/storage/ 的 3 处 upstream 已是 storage:8082（P1 起就是），无需改动。
# 真正要切的是旧的 archive/playback/media 前缀（当前指单体）：
#   把 /api/archive/、/api/playback/、/api/media/ 三处 upstream 改为 http://storage:8082
docker compose -f deploy/docker-compose.yml up -d --force-recreate gateway
```

验证：`curl -fsS -H "Authorization: Bearer <token>" https://<host>/api/storage/stats` 返回 JSON；
前端**无感**（确认过：前端源码里没有任何 `/archive/`、`/playback/`、`/media/`、`/storage/` 调用）。

回滚：把三处 upstream 指回 `http://catalog:8080`。
数据：单体写 `modules.resources/resource_bindings`，服务写 `storage.assets/bindings`，**两者不互通**；
切流前若单体已有资源行，需先确认这些行是否仍需可见——当前前端不消费，属历史数据。

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
cd metafusion-community && go run cmd/migrate -direction forward -dry-run   # 先看行数
cd metafusion-community && go run cmd/migrate -direction forward             # 再搬

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
cd metafusion-community && go run cmd/migrate -direction back -dry-run
cd metafusion-community && go run cmd/migrate -direction back
# 然后网关四处 upstream 指回 http://catalog:8080
```
顺序不能颠倒：先改网关再搬数据，会让回滚窗口内的新帖在单体侧"消失"。

### 第 4 步：单体下线（切流稳定 24 小时后）

| 移除对象 | 说明 | 代码位置 |
| --- | --- | --- |
| forum / 评论 / 记录 / 收藏 路由 | 约 20 条，已由互动服务承载 | `backend/internal/modules/forum.go`、`modules.go` 与 `backend/internal/catalog/favorites.go` |
| auth / setup / admin / oauth / oidc 路由 | 约 20 条，已由账号服务承载 | `backend/internal/catalog/http.go` 与 `identity.go`、`token.go` |
| `modules`、`moduleapi`、`moduledeps` 三个包 | 约 2600 行 | 见下表 |
| `modules` schema 与 `catalog.favorites` 表 | 仅在确认不再回滚后删除；建议先留观察期 | `backend/migrations` |

待删包清单（已核对 import 引用点）：

| 包 | 文件 | 行数 | 引用点 |
| --- | --- | --- | --- |
| `internal/modules` | `modules.go` | 836 | `cmd/server/main.go` |
| | `forum.go` | 698 | 同上 |
| | `media.go` | 162 | 同上 |
| | `objectstore.go` | 73 | 同上 |
| | `forum_test.go` / `modules_test.go` | 405 | 测试 |
| `internal/moduleapi` | `module.go` | 37 | `cmd/server/main.go`、`internal/modules` |
| `internal/moduledeps` | `dependency.go` | 412 | `internal/modules` |
| `internal/catalog` | `identity.go` / `token.go` / `favorites.go` | 859 | `http.go`（验签中间件保留 `Authenticate` 的无状态分支） |

单体在下线后仍需保留的能力：**验签**（`Store.Authenticate` 的 RS256 分支）与业务权限判定。
会话表兜底可保留到存量令牌自然过期，再决定是否移除。

## 2. 为什么每步都可回滚

| 系统 | 数据布局 | 回滚代价 |
| --- | --- | --- |
| auth | 两边读写**同一个** `auth` schema | 改网关，无数据操作 |
| community / records / favorites | 单体写 `modules.*`、`catalog.favorites`；服务写 `community.*` | 先 `-direction back` 搬运，再改网关 |
| storage | 单体写 `modules.resources`；服务写 `storage.*` | 改网关；旧数据仍在单体表里 |

**单一写入方规则**：任何时刻只允许一侧写入。切流前单体写、服务不接流量；切流后服务写、单体前缀不再被路由到。
跨过窗口不补增量就会出现"看不见的新数据"，这正是 `cmd/migrate` 两个方向都要存在的原因。

## 3. 前端为什么不用改

- 所有 API 调用都走同源 `/api/*`（`fetchApi` 前缀），由网关按前缀分流，因此服务切换对前端透明。
- 前端对受影响前缀的实际调用（已核对）：`/auth/*`（设置页）、`/community/*`（社区页）、`/favorites/*`（收藏按钮与个人主页）、
  `/users/{id}/*`（个人主页）。
- 前端**完全不调用** `/archive/`、`/playback/`、`/media/`、`/storage/`、`/records/`、`/exchange/`，
  这也是存储可以先切、且风险最低的原因。
- 页面级外链（账号页、资源站、文档站）由 `frontend/src/lib/services.ts` 的 `NEXT_PUBLIC_*` 控制，与本次切流无关。

## 4. 未决问题（切流前应拍板）

| 问题 | 现状 | 影响 |
| --- | --- | --- |
| 收藏"是否公开" | 前端只读占位，接口恒 `visible: true` | 不影响切流；实现时归互动服务 |
| `/api/capabilities`、`/api/admin/modules/:id` | 单体按进程内模块开关实现，拆分后模块概念消失 | 切流后管理台的模块开关要么改造成"服务健康探测"，要么下线；需先决定前端怎么显示 |
| `/api/exchange/*` | 仍在单体，写入经 catalog Submit | 归属元数据侧，可随 P4 一起保留在单体，不阻塞切流 |
| `modules` schema 删除时机 | 建议观察 24-48 小时 | 删表不可逆 |
