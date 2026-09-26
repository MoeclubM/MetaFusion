# 子系统切流手册（P4）

配套文档：[子系统拆分与迁移契约](./service-split-migration.md)。本手册描述**如何把流量从单体切到各服务**，
以及**每一步怎么验、怎么退**。所有命令都在有数据库访问权的运维机上执行。

## 部署目录布局

**推荐：所有仓库平铺在同一个父目录下**（本地 `~/GitHub/`，服务器 `/root/metafusion/`）：

```
/root/metafusion/
├── MetaFusion/                 # 主仓库（含 deploy/）
├── metafusion-auth/
├── metafusion-community/
├── metafusion-storage/
├── metafusion-docs/
└── metafusion-api-gateway/
```

编排按 `../../metafusion-*` 解析构建上下文（相对 `deploy/` 的父目录的父级），所以平铺布局**无需任何配置**；
`scripts/check_versions.py` 也直接可用（锁里的 `../metafusion-x` 就是这套布局）。

**其他布局**（例如把兄弟仓库塞进主仓库内部的 `services/`）：在 `deploy` 同级的 `.env` 里覆盖路径，
并给版本锁自检加 `--siblings-root`：

```bash
# .env（相对 deploy/ 解析）
MF_AUTH_DIR=../services/metafusion-auth
MF_COMMUNITY_DIR=../services/metafusion-community
MF_STORAGE_DIR=../services/metafusion-storage
MF_DOCS_DIR=../services/metafusion-docs
```

```bash
python scripts/check_versions.py --siblings-root services   # 或在环境里设 MF_SIBLINGS_ROOT
```

默认值不变，因此本地开发与 CI 无需任何改动；改了布局只影响部署机。

**移动整个目录是安全的**：compose 的工程名取自 compose 文件所在目录名（`deploy`），卷名是 `deploy_<卷>`
（`deploy_pg_data` 等）。把父目录改名或搬位置不会换工程名，因此**不会重建卷、不会丢数据**；
但容器重建前不要删除旧路径（网关的 `nginx.conf` 等是相对路径挂载）。


## 部署前置检查：悬挂引用体检

升级目录服务**之前**先体检一次：attributes 里的实体引用（如 `publisher`）与关系端点可能指向
已经不存在的行（删除/合并、早期导入脚本留下的欠账）。定义回放会把这些引用全部照亮——
2026-09 的线上事故就是它把启动路径顶成了 CrashLoop。

```bash
# 人读：逐条列出实体/关系、字段与悬挂取值，以及判定所用的定义基准
cd deploy && ./deploy.sh migrate check-refs

# 机读：definition_id / seed_added / references[]（scope/id/kind/field/value/reason）
docker compose -f deploy/docker-compose.yml run --rm --no-deps --entrypoint /app/migrate backend check-refs -json
```

- **退出码**：0 = 没有悬挂引用（可继续部署）；非 0 = 有。因此这条命令可以直接挂进 CI 或发布
  流水线的前置步骤，让"下次部署先发现"替代"崩在现场"。
- **判定基准**是"当前已发布定义 + 本次种子新增项"合并后的文档，也就是下一次启动会发布的定义：
  只按旧文档扫描会漏掉这次新增的 entity 型字段。
- **覆盖范围**：attributes 里声明为 entity 型的字段（含组/列表嵌套）、结构归属与记录级引用
  （`work_id` / `subjects[].work_id` / `contents[].expression_id`）、关系端点与关系属性。
- **怎么修**：把悬挂取值改到正确的行，或确认无用后清掉该属性键。根因是那次删除目标行的操作，
  体检只负责把它照亮；悬挂引用**不阻断**定义发布，但不清掉就会一直跟着每次升级。
- 库还没有已发布定义（刚 `migrate up`、服务从未启动过）时，它退回内置种子判定并打印提示，
  不会把"未初始化的库"判成故障。

## 定义没更新但站点可用：怎么看出来

`000014_single_definition_config` 会将当前生效文档搬到单行配置，再删除旧定义版本表与定义文档快照。此迁移不可逆；执行前保存数据库备份。`deploy.sh prod/pull` 在检测到该迁移待执行时先停止旧目录服务和前端，迁移与种子完成后再启动新镜像。

定义合并（`EnsureSeedDefinitions`）失败不再让服务起不来：定义**非法**时它零写入失败，
保留当前生效文档并降级继续服务；悬挂引用这类**数据欠账**只警告，不阻断保存。

- 启动日志：`ERROR startup degraded: ...`，含 `definition_impact: [...]` 的具体条目。
- `GET /health` 的 `definitions` 块（网关的 `/health` 已指向目录服务）：
  `etag` 是当前生效文档的并发校验标记；`degraded: true` 且 `pending_error` 非空表示
  "站点可用但定义没更新"，`pending_items` 是没生效的种子项数，`dangling_references` 是本次回放
  看到的悬挂引用条数。
- 状态码**刻意保持 200**：降级可用不是"不健康"，回 503 会把编排器拉回"重启到好为止"的循环，
  那正是这次 CrashLoop（整站 502）的成因。监控要区分它请用 `definitions.degraded == true`，
  不要用 HTTP 状态码。
- 修完数据后重新执行内容种子即可补入缺失定义项；失败不会留下草稿或改变 `catalog.definition_config`。

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
因此改完路由矩阵后 `up -d` 不会重建网关，配置改了却不生效。`deploy.sh` 的重载函数会先
`up -d --force-recreate --no-deps gateway`（单文件 bind mount 绑的是 inode，`git pull` 换掉文件后容器里仍是旧 inode），
再做 `nginx -t` 校验与 `nginx -s reload`；校验失败就保留旧配置继续服务。手工操作时也要补这两步：

```bash
docker exec metafusion-gateway nginx -t && docker exec metafusion-gateway nginx -s reload
```

## 0. 切流前的硬前提

| 前提 | 判据 |
| --- | --- |
| 三个服务已部署且健康 | `curl -fsS http://auth:8081/ready`、`community:8083/ready`、`storage:8082/ready` 均 200 |
| **验签公钥对齐** | catalog 按 `AUTH_JWT_PUBLIC_KEY`（静态公钥）或 `AUTH_JWKS_URL`（账号服务 JWKS）验签，二者必配其一（fail closed）。公钥与签发密钥不一致会让已登录用户立刻掉线 |
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
并对 `topics/posts/boards/favorites` 四张表做新旧行数对比。**切换瞬间这四个差值应为 0。**

**表结构等价性已有测试保证**（不需要数据库即可运行）：
- 互动服务：`internal/store/schema_parity_test.go` 冻结了老表六张表的逐列定义（名称/类型/约束/默认值），
  搬运过来的 handler SQL 按老表结构编写，任何漂移都会让该用例失败；
- 账号服务：`internal/store/schema_parity_test.go` 冻结了**线上 `auth` schema 的终态**（含 PKCE 列；主仓库已不再创建 auth schema 的任何对象，这份冻结值是唯一来源），
  保证全新库上建出来的表与线上一致。

因此切流前只需要跑 `go test ./...` 就能确认"新库能承受老代码的 SQL"，不必等真实请求报错。

## 1. 切流顺序与逐步操作

按"风险从低到高"排序：先切前端完全没在用的存储，最后切最关键、有实时数据的互动。

> **已用 `./deploy.sh cutover` 一次性切完的实例不需要再逐步执行这一步；
> 下面三步保留给「有在线数据、必须按前缀分批切」的实例，以及未来回滚演练时的参照。**

### 第 1 步：storage（风险最低）

存储契约是 `/api/storage/*`，网关矩阵里这几处 location 从 P1 起就指向 `http://storage:8082`，
所以这一步**没有「切流」动作**，只需要确认服务健康：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<host>/api/storage/stats   # 401 = 已在鉴权，符合预期
```

注意：前端**会**调用 `/api/storage/*`（上传发起/完成、流式上传、绑定与解绑、实体文件列表，见
`frontend/src/lib/storage.ts` 与 `components/storage/EntityResourceFiles.tsx`），所以存储前缀不是"无流量"，
只是链路短、失败面窄（上传不可用不影响浏览与编目）。

- 单体从来没有 `/api/storage/*`，因此不存在「切回单体」的回滚路径；真要退就是停掉这些 location。
- 网关不为 `/api/archive/`、`/api/playback/`、`/api/media/` 单列 location（落到 `/api/` 兜底），前端也不调用它们。
- 媒体分析（ffprobe 探针、预览转码）没有迁进存储服务，属既有缺口，见第 4 节。
- `modules.resources` / `resource_bindings` 已随 `./deploy.sh retire` 删除，没有数据要搬。

### 第 2 步：auth（零数据迁移，回滚成本最低）

```bash
# 网关：把 auth 域的每条 location 的 upstream 从 catalog:8080 改为 auth:8081：
#   /api/auth/  /api/setup  /api/admin/{users,groups,permissions,settings,invites}
#   /api/oauth/  /api/oidc/  /api/.well-known/  /.well-known/
# （deploy/nginx.conf 现在已经是这个状态；本步只在"按前缀分批切"的实例上还有动作）
docker compose -f deploy/docker-compose.yml up -d --force-recreate gateway
```

验证（按顺序，任一失败即回滚）：
1. `curl -fsS https://<host>/api/setup` → `{"needed":false,"is_initialized":true,"has_admin":true}`
2. 用**已登录浏览器**打开任意页面 → 不掉线（说明 catalog 仍能验签 auth 签发的令牌）
3. 新登录一次 → 成功；`GET /api/auth/me` 返回当前账号
4. `curl -fsS https://<host>/api/.well-known/openid-configuration` 与 `/.well-known/openid-configuration` 返回同一份文档

回滚：这些 upstream 指回 `http://catalog:8080`。**不需要数据操作**——两边读写同一个 `auth` schema。
注意：这条回滚只对"旧镜像里的单体仍带账号路由"成立；当前代码已删除单体账号实现，
现网回滚只能改成"改网关 + 用上一版 catalog 镜像重建"。
注意：若切流后已用 auth 服务改过密码/角色，回滚后单体读同一张表，改动依然生效（这是"同 schema"的好处）。

### 第 3 步：community + favorites（有实时数据，必须按窗口执行）

```bash
# 1) 切换前立刻补增量（此刻单体仍是唯一写入方）
#    搬运工具与互动服务共用同一镜像，因此搬运用的一定是当前部署的代码；
#    它幂等且只读源表，可以随时重跑补增量。
cd deploy
docker compose --env-file ../.env -f docker-compose.yml run --rm community-migrate -direction forward -dry-run
docker compose --env-file ../.env -f docker-compose.yml run --rm community-migrate -direction forward

# 2) 网关：把 /api/community/、/api/favorites/、/api/users/{id}/favorites
#    三处 upstream 改为 http://community:8083
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


## 1.5 日常批次的镜像回退（两行命令）

`./deploy.sh fast` 收尾会给本批镜像补一个**版本 tag**（口径与 `/api/version` 的版本一致：
`git describe --tags` 的精确 tag，没有 tag 时退回 12 位短 sha）。为什么必须有它：容器用的是
滚动标签（`metafusion-*:local` 与编排生成的 `deploy-<svc>:latest`），**下一次部署会直接覆盖它们**，
上一版镜像随即变成无主镜像、被 `docker image prune` 清掉——"回退"就只剩按 tag 重建（10–20 分钟）。
保留策略：每个镜像只留最近 `MF_IMAGE_TAG_KEEP`（默认 3）个版本 tag，更老的撤 tag；tag 只是镜像的
第二个名字，不额外占磁盘。

回退到某个仍保留的版本（以 backend 为例；`--env-file ../.env` 按你的调用习惯补全）：

    cd deploy
    docker tag metafusion-backend:v0.3.0 metafusion-backend:local
    docker compose --env-file ../.env -f docker-compose.yml up -d --no-deps --force-recreate backend
    curl -s http://127.0.0.1:10100/api/version        # 应显示被换上的那一版

验证没问题后回退到本批（把标签换回来即可）：

    docker tag metafusion-backend:v0.3.1 metafusion-backend:local
    docker compose --env-file ../.env -f docker-compose.yml up -d --no-deps --force-recreate backend

两条注意：① **镜像回退不回退数据库结构**——两版之间的迁移必须向后兼容（加列/加表可回退，
删列/改类型不可），换镜像前先确认；② 前端镜像的名字是编排生成的 `deploy-frontend`
（`docker images` 里显示为 `deploy-frontend:vX.Y.Z`），命令同上，服务名换成 `frontend`。

## 2. 为什么每步都可回滚

| 系统 | 数据布局 | 回滚代价 |
| --- | --- | --- |
| auth | 两边读写**同一个** `auth` schema | 改网关；单体账号路由已删除，等于改网关 + 恢复上一版 catalog 镜像 |
| community / favorites | 单体写 `modules.*`、`catalog.favorites`；服务写 `community.*` | 先 `-direction back` 搬运，再改网关 |
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
- 前端不调用 `/archive/`、`/playback/`、`/media/`、`/records/`、`/exchange/`；但**会**调用 `/api/storage/*`
  （上传、绑定、实体文件列表），因此存储这一步的理由是"链路短、失败面窄"，不是"没有流量"。
- 页面级外链（账号页、资源站、文档站）由 `frontend/src/lib/services.ts` 的 `NEXT_PUBLIC_*` 控制，与本次切流无关。
- 三个服务自带的管理台（`/admin/account`、`/admin/community`、`/admin/storage`）是各服务仓库里的独立应用，由网关按前缀反代到 `auth-admin`、`community-admin`、`storage-admin`：它们**不是主前端** `frontend/` 的页面，因此这一步不涉及它们的构建与发布；改了它们的路由后照「网关必须显式重载」一节重建网关容器。

## 4. 还没处理的问题

| 问题 | 现状 | 影响 |
| --- | --- | --- |
| 媒体分析与预览转码 | 存储服务只收原始文件、按权限分发，不做这类处理 | 该能力不提供 |
| 浏览器预签名直传 | 对象存储不发布宿主机端口，当前走服务端流式上传 | 恢复直传要给对象存储一个独立对外域名并设 `STORAGE_S3_PUBLIC_ENDPOINT`（SigV4 覆盖 Host，只加路径前缀不行） |
| Redis | backend 全仓 0 处 Redis 引用（compose 也不再注入缓存/检索地址） | 可以从常驻编排里去掉这个常驻容器，省一份内存 |
| 收藏「是否公开」 | 前端只读占位，接口恒 `visible: true` | 实现该开关时归互动服务 |
