# 多项目解耦审计与优化建议（2026-09）

> 范围声明：本文只记录**当前可观察的耦合**、建议做法与可验证判据，不改既有架构文档的结论；与既有结论冲突时以既有文档为准，但要先按本文的证据改文档。
> 关联文档：[子系统拆分与迁移基准](./service-split-migration.md)（路由与数据归属的唯一契约）、[多项目解耦规范](./multi-project-decoupling-spec.md)、[能力清单与模块开关](./capabilities-and-module-toggles.md)、[架构优化建议](./optimization-recommendations.md)、[架构评估结论（2026-09）](./architecture-assessment-2026-09.md)。
> 数据约束：本文不含实例数据——不写真实条目名；示例一律用占位符（`<repo>`、`<prefix>`、`<code>`）或代码里的真实标识符。
> 审计方式：5 个并行只读子代理（主仓库 backend、`metafusion-auth`、`metafusion-community` + `metafusion-storage`、`frontend`、`deploy`/网关/契约面），结论由主代理二次核对；核对面见 §0.2。
> 状态：**审计完成**。两项决议已确认（§8.2 的 D1、D2），其余为推荐值待评审；B0（本文与契约文档）已交付，B1–B6 待排期。

## 0. 结论摘要

"项目拆得不行"的三点质疑，逐条结论：

1. **"看似拆开了，实则相互依赖"** —— **编译期确实拆开了，缝隙全在进程之间**。各子系统仓库对主仓库 module path 零命中，各自 `go.mod` 独立、无 `replace`/`go.work`（§1）。但运行时存在**双向环**：`community`/`storage` 每次可见性判定、绑定与下载都要同步问 catalog（`../metafusion-community/internal/catalog/client.go:56`、`../metafusion-storage/internal/handler/files.go:47`），而 catalog 又反向探活 `community`/`storage`（`backend/internal/capabilities/registry.go:43-48,110-125`）——目录服务并不能在"外围全挂"时独立自洽。
2. **"还共享一个库"** —— 实质是**同一个 PostgreSQL 实例、同一个 DB 用户、同一个库名**（`deploy/docker-compose.yml:106-110,146-150,180-184,221-225,245-249` 全部复用同一个 `DB_NAME`），`auth`/`community`/`storage` schema 只是命名约定：全仓 `CREATE ROLE`/`GRANT`/`ROW LEVEL SECURITY` 零命中，跨 schema 误写没有库侧门槛。此外还有一处**共享密钥**：签发私钥同时注入 catalog 与 auth（§2）。不是共享 Go 依赖库。
3. **"UI 还只在主项目里面"** —— 成立且是结构性的：`metafusion-auth`/`-community`/`-storage` 顶层无任何前端目录，四域 UI 全在主仓库 `frontend/`（单 Next 应用，写入时实测 123 个 ts/tsx）；而"外部化开关"是**死开关**：`NEXT_PUBLIC_*` 全仓只有 `frontend/src/lib/services.ts` 引用，compose/Dockerfile/CI 都没有注入点（§7.1），所以真实切流只发生在 nginx 改一行。

四条最硬的证据（建议优先处理）：

| 证据 | 位置 | 为什么硬 |
| --- | --- | --- |
| 目录进程持有**签发私钥** | `backend/internal/catalog/token.go:66-100` + `deploy/docker-compose.yml:121-126` | 只验签的进程拿到了签发所需的密钥材料；轮换要同时改两个进程 |
| `entity.merged` **没有消费者** | 写入 `backend/internal/catalog/store.go:402`；投递函数 `backend/internal/catalog/lifecycle.go:129` 只被 `store_test.go` 调用 | 注释说"广播"（`backend/internal/catalog/merge.go:259-262`），实现里跨服务收敛靠调用方同步拉取 |
| **权限码 5 份手抄** | 实测引号内码计数：catalog 6、auth 17、community 4、storage 2、前端 14（`frontend/src/lib/permissions.ts`） | 加码/改码要同步 5 处，漏一处表现为"后台分配了但服务不认" |
| **验签实现 3 份** | catalog 188 行（标准库、读私钥）、community 352 行、storage 329 行；community 与 storage 的 `internal/auth/auth.go` 去空白后约 90% 行相同（实测 382 行里 342 行命中） | 同一件事三种实现，且已经漂移（错误码 `unauthorized` 与 `authentication_required` 并存） |

## 0.1 审计快照

| 仓库 | HEAD（短） | 备注 |
| --- | --- | --- |
| MetaFusion（主仓库） | `056fedf` | 工作区含并发代理的未提交改动（`frontend/`、`docs/` 多文件），本文实测数字以写入时刻为准 |
| metafusion-auth | `0c42a7e` | |
| metafusion-community | `b9dd96f` | |
| metafusion-storage | `6b0a9f7` | |
| metafusion-api-gateway | `1922de3` | 仓库内矩阵已与线上分叉（§6.1） |
| metafusion-docs | `cc0031b` | 唯一文档源 |
| metafusion-importer | `276f5b3` | 零依赖 CLI，未被编排、文档与技能引用（§11 第 5 条） |

## 0.2 核对命令（可复现）

```powershell
# 网关矩阵条数（文档 §2 表要与它一致）
(Select-String -Path deploy/nginx.conf -Pattern '^\s*location').Count
# 权限码份数（各仓库引号内码去重计数）
@('backend/internal/catalog/permission.go','frontend/src/lib/permissions.ts',
  '../metafusion-auth/internal/store/access.go',
  '../metafusion-community/internal/auth/permission.go',
  '../metafusion-storage/internal/auth/permission.go') | ForEach-Object {
  (Get-Content $_ -Raw | Select-String -Pattern '"[a-z]+[.][a-z._]+"' -AllMatches).Matches.Value | Sort-Object -Unique
}
# 前端规模与四语字典键数（键集合必须四语一致）
(Get-ChildItem frontend/src -Recurse -File -Include *.ts,*.tsx).Count
Get-ChildItem frontend/src/messages/*.json | ForEach-Object {
  (Get-Content $_ -Raw | ConvertFrom-Json).PSObject.Properties.Name.Count }
# 兄弟仓库 HEAD
git -C ../metafusion-auth rev-parse --short HEAD   # 其余仓库同理
```

## 1. 耦合分级总览

| 维度 | 判定 | 一句话依据 |
| --- | --- | --- |
| 编译期 | **低** | 各仓库 module path 独立，无 `replace`/`go.work`/跨仓库 import；重复的只是第三方依赖版本 |
| 运行时 | **高** | `community`/`storage` 对 catalog/auth 同步强依赖（未变）；~~catalog 反向探活~~、~~共享签发私钥~~ 已于 2026-09-16 消除（§2、§5） |
| 数据层 | **高** | 同实例/同库/同 DB 用户；无 role、无 GRANT、无 RLS（待 B4）；~~无迁移版本~~ → community 已改版本化迁移，storage 待办；跨 owner 运维脚本未动 |
| 部署编排 | **高** | compose 跨仓库构建上下文、无 commit 锁；网关矩阵双份且已分叉；多个服务没有镜像发布方 |
| 契约 | **高** | 权限码 5 份、验签 3 份、各仓库路由清单各写各的（前端权限码与 `kinds` 已于 2026-09-16 改生成物） |
| UI | **高** | 单应用承载四域、无包边界；`NEXT_PUBLIC_*` 死开关；跨域耦合落在同一页面组件里；字典单文件 |

## 2. 密钥与身份边界

### 2.1 现状

- （**2026-09-16 已修**：目录改为 `AUTH_JWT_PUBLIC_KEY` → `AUTH_JWKS_URL` → 私钥兜底的优先级，私钥只剩兼容路径；以下为审计时现状）catalog 侧自己实现 RS256 验签：`backend/internal/catalog/token.go:66-100` 从 `AUTH_JWT_PRIVATE_KEY` 读 RSA 私钥（PEM 或其 base64），**只为取公钥**，支持 PKCS#1/PKCS#8；`token.go:3-8` 的注释写明"目录进程拿不到也不需要签发路径"。
- `deploy/docker-compose.yml` 把**同一把私钥**注入 backend（`:121-126`）与 auth（`:146-150`）；`.env.example` 的注释自陈"同一把私钥会注入 backend 与 auth……两边不一致会让已登录用户立刻掉线"。
- `community`/`storage` 走另一条路：静态公钥或 JWKS 拉取 + 缓存（`../metafusion-community/internal/auth/auth.go:95-137`、`../metafusion-community/internal/config/config.go:17-19,36`；`../metafusion-storage/internal/auth/auth.go` 同形）。catalog 侧没有任何 JWKS 客户端（`grep -i jwks backend` 只命中两处测试与 `token.go:167` 的注释）。
- issuer/audience 靠约定一致：代码默认值与 compose 默认值都是 `https://findverse.cc/api` 加 `metafusion`（`backend/cmd/server/main.go:61`、`deploy/docker-compose.yml:125-126,151`）。

### 2.2 问题

1. **密钥暴露面等于服务数**：只需验签的目录进程持有签发私钥材料。
2. **无法轮换**：catalog 只认环境变量里的那一把（`token.go:70-100`），换钥匙必须在同一窗口里改 compose 并重启 catalog 与 auth；community/storage 反而能靠 JWKS 的 `kid` 刷新平滑轮换。
3. **同一件事三种实现**：口径分叉只能靠注释要求"逐字一致"（`backend/internal/catalog/token.go:30,36-37`）。

### 2.3 建议做法

只有 auth 持有私钥；其余服务只持公钥（静态 PEM 或 JWKS）。catalog 的验签改为 SDK 提供的 JWKS 实现（照 `../metafusion-community/internal/auth/auth.go` 的"静态优先 + JWKS 缓存 + 未知 `kid` 强制刷新"），删除私钥解析路径；compose 不再向 backend 注入 `AUTH_JWT_PRIVATE_KEY`，改为可选 `AUTH_JWT_PUBLIC_KEY` 或 JWKS 地址。

### 2.4 待办

| 待办项 | 涉及文件 | 可验证判据 |
| --- | --- | --- |
| 目录改公钥/JWKS 验签 | `backend/internal/catalog/token.go`、`backend/cmd/server/main.go` | 只注入公钥时 `go test ./internal/catalog` 通过，用 auth 签发的真实令牌写入接口返回 200 |
| compose 移除私钥下发 | `deploy/docker-compose.yml`、`.env.example` | 目录容器 env 中不存在 `AUTH_JWT_PRIVATE_KEY`；置空后启动日志不再索要它 |
| 轮换演练 | `docs-local/deploy/*` | 换一把新钥匙并发布 auth 后，目录与两个子系统无需重启即可在下一次 JWKS 刷新内恢复验签 |

## 3. 协议层单源化（新仓库 metafusion-sdk）

### 3.1 现状

| 契约点 | 现状 | 证据 |
| --- | --- | --- |
| JWT 验签 | 3 份实现：catalog 188 行（标准库）、community 352 行、storage 329 行；后两者去空白后约 90% 行相同 | `backend/internal/catalog/token.go`、两个子系统的 `internal/auth/auth.go` |
| Claims 字段名 | 三份结构体靠注释要求逐字一致（`sub`、`preferred_username`、`role`、`groups`、`permissions`） | 同上 |
| 权限码 | 5 份：catalog 6、auth 17、community 4、storage 2、前端 14（引号内去重计数） | `backend/internal/catalog/permission.go:13-25`、`../metafusion-auth/internal/store/access.go`、两个子系统的 `internal/auth/permission.go`、`frontend/src/lib/permissions.ts` |
| 错误响应 | 形状 `{error: 机器码}` 手抄；形状手抄。2026-09-16 复核：原报告说的 `unauthorized` 漂移**不成立**——两个服务的 401 码都是 `authentication_required`（community 全仓 0 处 `unauthorized`） | 各服务 handler 层 |
| 分页参数 | 同一服务并存 `limit/offset` 与 `page/page_size`（子代理核对，未二次复核） | community 侧 handler 层 |
| 实体骨架 `kinds` | 曾前端手抄 8 个 kind 字面量；**2026-09-16 已改生成物**（来源 `backend/migrations/000001_catalog_core.up.sql` 的 CHECK） | `frontend/src/components/catalog/api.ts:4-13`、`backend/internal/catalog/http.go:253` |
| 服务标记头 | 各服务各写一份同名响应头，用于逐前缀核对 | `backend/cmd/server/main.go:78` 注释 |

### 3.2 问题

契约没有单一来源：新增权限码、改 claims 字段名、统一错误码，都要在 2–5 个仓库之间按注释手抄；现有测试只覆盖各自的一半（例如只冻结 claim 键名，不比对码表）。前端的二次手抄已经出现"常量存在但调用点仍写裸串"的情况。

### 3.3 建议做法

新建**轻量协议层**仓库 `metafusion-sdk`（Go module，semver tag 引入），只放协议不放业务：

| 放进 SDK | 明确不放 |
| --- | --- |
| `Claims` 结构与解析、RS256 验签（静态公钥 + JWKS 缓存 + `kid` 刷新） | 数据库访问、迁移执行 |
| 会话兜底 client（`GET /api/auth/me` 形状） | 各服务业务模型与写侧 DTO 语义 |
| 权限码常量（按服务分包）+ `Can` 辅助 | 权限判定规则本身（仍由各服务的业务规则决定） |
| `{error}` 响应与状态码映射、分页参数解析（双写法兼容）、`/health` 与 `/ready` handler、服务标记头、request-id 中间件 | UI、日志后端、编排 |

同时把**权限码与 `kinds` 骨架**做成机器可读的单一来源（SDK 常量 + 从 `/api/openapi.json` 导出的清单），前端只提交生成物。

### 3.4 待办

| 待办项 | 涉及文件 | 可验证判据 |
| --- | --- | --- |
| 建 `metafusion-sdk`（v0.x） | 新仓库 | **已建仓（2026-09-16，本地）**：`go build/vet/test` 全绿（52 个用例）；**尚无远端、无 tag、无服务接入** |
| 三服务切换（未开始） | `backend/internal/catalog/token.go`、两个子系统的 `internal/auth/auth.go` | 删除本地实现后各仓库 `go test ./...` 全绿；令牌在三个服务上验签结论一致（过期、错 issuer、错 audience、错算法四个反例） |
| 权限码单源 + 前端生成物 | 上述 5 个权限码文件 | **前端已完成（2026-09-16）**：判据 = `cd frontend && node scripts/generate-contracts.mjs --check`；后端侧单源（SDK 切换）未开始 |
| 错误码与分页统一 | 各服务 handler 层 | **community 已完成（2026-09-16）**：分页解析收敛到 `internal/handler/paging.go`、兼容期与换算写进注释、真库用例证明两种写法窗口等价；错误码本已一致 |

## 4. 数据层边界

### 4.1 现状

- 五个运行单元共用同一 PostgreSQL 实例、同一 DB 用户、同一库名：`deploy/docker-compose.yml` 的 `backend:106-110`、`auth:146-150`、`community:180-184`、`community-migrate:221-225`、`storage:245-249`，实例定义在 `:284-293`。
- schema 由各服务启动时自建：`backend/migrations/000001_catalog_core.up.sql:8-11`、`../metafusion-auth/internal/store/store.go:36`、`../metafusion-community/internal/store/store.go:12`、`../metafusion-storage/internal/store/store.go:25`。
- 库侧没有任何隔离手段：主仓库与子系统仓库里 `CREATE ROLE`、`GRANT`、`ROW LEVEL SECURITY`、`search_path` 零命中。
- ~~子系统没有版本化迁移~~ → **2026-09-16 已改**：`community` 与 `storage` 各自把 DDL 搬进仓库内 `migrations/000001_init.up.sql`（`go:embed`），启动执行同一份幂等基线并记账到 `<schema>.schema_migrations`；主仓库仍走 `mf-migrate` 加单一基线 `backend/migrations/000001_catalog_core.up.sql`。
  迁移约定（两服务一致）：文件 `internal/store/migrations/000001_init.up.sql`（storage）或 `migrations/000001_init.up.sql`（community）、账本 `<schema>.schema_migrations(version, applied_at[, name, checksum])`、事务级 advisory lock 键位 **catalog 740202 / auth 740203 / storage 740204**（社区目前不取 advisory lock；键位必须查表分配，重复会串行化两个服务）。
- 运维脚本跨 owner 操作别的域的库：`deploy/sql/retire-legacy-schemas.sql` 会按行数核对并 DROP 社区侧表，由 `deploy/deploy.sh` 调用。

### 4.2 问题

1. "独立 schema"是**命名约定**而不是权限边界：任何持有库凭据的进程都能写任意 schema，误写不会被库拦下。
2. 故障域与生命周期绑定：备份、恢复、连接数、升级窗口、数据卷都是整库粒度（`deploy/docker-compose.yml:300` 单卷），退役脚本需要跨域协调。
3. 子系统改表没有可回滚基线：启动即改库，出错时没有"迁移前结构"可对照。

### 4.3 建议做法

分两步走，先"能隔离"，再"能分库"：

1. **每服务一个 DB 角色**，只授自己 schema 的 `USAGE`/`SELECT`/`INSERT`/`UPDATE`/`DELETE`；迁移用各自的角色执行；运维脚本按域归位（社区侧退役动作交回 `metafusion-community`）。
2. **每服务一个 `DATABASE_URL`**（不再由 `DB_HOST`/`DB_USER`/`DB_NAME` 片段拼），使"同实例不同角色"与"独立实例"只差一个连接串；编排里给出各服务独立库名的注释示例。
3. **子系统迁移版本化**：仓库内 `migrations/` 加版本表，把当前结构登记为基线。**实现口径（2026-09-16）**：启动仍执行同一份**幂等**基线文件（不是“只校验”），因为受限角色下 `CREATE TABLE IF NOT EXISTS` 会先要 schema 的 CREATE 权限，
  只授 CRUD 的角色即使结构已建好也会 `permission denied for schema <x>`。要真正“启动只校验、迁移用 owner 单独跑”，需要额外一个显式迁移入口（二进制/命令）并改 Dockerfile 与编排——**未做**，见 §12。

### 4.4 待办

| 待办项 | 涉及文件 | 可验证判据 |
| --- | --- | --- |
| 角色与授权 | `deploy/docker-compose.yml`、各服务 `internal/config/config.go`、新增初始化 SQL | 用 community 角色执行 `INSERT INTO catalog.*` 被拒（`permission denied`）；两服务正常读写自己的 schema |
| `DATABASE_URL` 化 | 同上 | 给某服务指到独立库后只改环境变量即可启动，代码零改动 |
| 迁移版本化 | 两个子系统的 `internal/store/store.go`、新增 `migrations/` | **部分完成（2026-09-16）**：文件化 + 账本 + 幂等已落地并有真库用例（`community`/`storage`）；原判据“新实例启动不执行 DDL”**未达成**，需显式迁移入口（见 §4.3 第 3 条口径） |
| 运维脚本归位 | `deploy/sql/retire-legacy-schemas.sql`、`docs-local/deploy/*` | 主仓库脚本不再 DROP 非 `catalog` schema 的对象；社区侧退役动作在其仓库内可复现 |

## 5. 调用链与事件契约

### 5.1 现状

- 同步强依赖（fail-closed）：`community` 每次实体可见性都问 catalog（`../metafusion-community/internal/catalog/client.go:56`），`storage` 的绑定与下载鉴权同理（`../metafusion-storage/internal/handler/files.go:47`）。catalog 不可用时表现为 404，而不是"降级只读"。
- **反向探活（2026-09-16 已修：改声明式、目录出站请求为 0）**：catalog 后台每 30 秒探一次上游 `/health` 生成 `/api/capabilities` 的 `healthy`（`backend/internal/capabilities/registry.go:43-48,110-125`）；而 catalog 自己只提供 `/healthz` 与 `/ready`（`backend/cmd/server/main.go:115-116`）——口径不一致，换个服务复用同一探测器会恒判不健康。
- **事件没有消费者**：`entity.merged` 写入 outbox（`backend/internal/catalog/store.go:402`，表结构 `backend/migrations/000001_catalog_core.up.sql:114-118`），投递函数 `Store.Deliver`（`backend/internal/catalog/lifecycle.go:129`）只在 `store_test.go` 有调用点；`backend/internal/catalog/merge.go:259-262` 的注释却写"通过 outbox 的 entity.merged 事件广播"，实际跨服务收敛是调用方主动拉取。
- 两个能力共用同一个上游变量：`community` 与 `records` 都用 `COMMUNITY_URL`（`registry.go:45-46`）。

### 5.2 问题

目录服务宣称"仅依赖 PostgreSQL 即可完整运行"，但它同时持有对外探活与聚合职责；事件契约只存在于注释里，第三方无法据此实现消费者；子系统对目录的同步依赖没有缓存与降级语义说明，故障表现（404、空列表）与设计意图不一致。

### 5.3 建议做法

1. **去掉反向探活**：`/api/capabilities` 的 `enabled` 改为**声明式**（部署配置声明哪些子系统在场），`healthy` 由网关或运维面读取各服务 `/health`；目录进程不再持有上游地址，前端按 `id` 判断的方式保持不变。
2. **统一健康口径**：catalog 补 `/health`（或把探测器路径改为可配置），网关的探针按四个上游的 `/ready` 汇总。
3. **事件契约二选一并写清**：要么实现跨服务投递（推送或队列），要么在文档与注释里如实写"事件由消费方按游标拉取"，删除"广播"表述。
4. **同步依赖的降级语义写入契约**：逐端点写明 catalog/auth 不可用时的行为（community 侧现有静默降级：条目 meta 缺失即跳过、关联合集静默为空），并给出可观察的告警点。

### 5.4 待办

| 待办项 | 涉及文件 | 可验证判据 |
| --- | --- | --- |
| capabilities 声明式化 | `backend/internal/capabilities/*`、`deploy/docker-compose.yml`、`docs/architecture/capabilities-and-module-toggles.md` | 停掉 community 容器后 `/api/capabilities` 的 `community.healthy` 与容器状态一致，且目录进程无出站请求 |
| 健康口径统一 | `backend/cmd/server/main.go`、`deploy/nginx.conf` | `/health` 与 `/ready` 在四个上游都返回 2xx；聚合探针能指出具体哪个上游不健康 |
| 事件契约澄清 | `backend/internal/catalog/lifecycle.go`、`merge.go`、`backend/migrations/000001_catalog_core.up.sql` | 文档、注释与实际调用方一致；若选择投递，新增一个跨服务消费的集成测试 |
| 降级语义写入契约 | `./service-split-migration.md`、两个子系统的 handler 层 | 契约里逐端点写明 catalog/auth 不可用时的状态码与前端表现；抽查 2 个端点与文档一致 |

## 6. 网关与部署编排

### 6.1 现状

- 生效的矩阵是主仓库 `deploy/nginx.conf`：**审计时实测 25 条 `location`**（核对命令见 §0.2），其中账号前缀用 6 条精确匹配加 2 条正则逐条分流。**2026-09-16 补限流与探针后为 33 条**，见 §6.4。
- ~~契约文档 §2 称"18 条 location"且表格漏收两条 location~~ **已修（2026-09-16）**：契约文档现在写 33 条，且由 `scripts/check_gateway_matrix.py` 在 CI 里与实现逐条比对。
- **第二份矩阵**：`../metafusion-api-gateway/nginx.conf` 仍把账号前缀指向 `catalog:8080`，且没有 `/api/developer/`；而编排里的服务名是 `backend`，不存在 `catalog` 服务。~~该仓库没有 CI~~ **已修（2026-09-16）**：旧矩阵移入 `examples/pre-cutover/` 并标注不可部署，仓库新增 CI（`bash -n` + `--self-check`），见 §7 完成表。
- 限流只挂在两处：`deploy/nginx.conf:83,94`（auth 前缀）；`/api/community/`、`/api/records/`、`/api/oauth/`、`/api/oidc/`、`/api/developer/`、`/api/storage/` 均未挂 `limit_req`（zone 在 `:40-41` 已经定义）。
- 网关探针段 `deploy/nginx.conf:331` 把 `/healthz|livez|ready|live|health` 全部转给 `backend:8080`，注释却写"网关自身探针，不代表任何上游可用"；而 catalog 当时没有 `/health`，该路径实测 404。**已修（2026-09-16）**：`backend/cmd/server/main.go` 提供 `GET /health`（返回 `{status:live,service:metafusion-catalog}`），网关探针拆成网关自身与逐上游两类。
- 部署面仍是单体式：`deploy/docker-compose.yml` 用 `../../metafusion-*` 作构建上下文（`:139`、`:173`、`:216`、`:238` 等），全仓无 commit 锁；`.github/workflows/release.yml` 只发布 backend/migrator/frontend 三个镜像，`docs-site`、`auth`、`community`、`storage` 没有发布方，而 `deploy/docker-compose.prod.yml` 却按预构建镜像拉取。
- 切流自检脚本 `cutover-check.sh` 的服务标记断言当前传的是占位符（子代理核对，未二次复核），等于不校验。

### 6.2 问题

1. 路由矩阵有两份且已分叉，"哪份生效"取决于部署路径；矩阵与文档表格都没有自动一致性检查——已经发生过"新前缀漏加 location 就静默落回目录服务"的情形。
2. 网关既是唯一入口，又是主仓库里的一个部署文件：矩阵与切流脚本现已收敛到 `metafusion-api-gateway`（**2026-09-16**：仓库与最小 CI 已就位，旧矩阵归档；主仓库保留生效矩阵 `deploy/nginx.conf`），但网关自身仍缺覆盖矩阵行为的测试。
3. 发布面不完整：多个运行单元没有镜像发布渠道，拉取路径下只能就地构建或被跳过。
4. 缺限流、健康聚合与版本锁，使"拆分后的自治"无法按服务灰度或回滚。

### 6.3 建议做法

1. **矩阵单一来源归 `metafusion-api-gateway`**（与"每个运行单元一个仓库"一致）：把矩阵与切流自检收敛到该仓库，加最小 CI（配置语法检查 + 矩阵与文档表格一致性断言 + 前缀标记断言）；主仓库 compose 改为从该仓库挂载。迁移分三步，任一步都可停：①两处矩阵做到字节一致 → ②加等价断言 → ③compose 切挂载、删主仓库副本。**进度（2026-09-16）**：旧矩阵已归档到网关仓库 `examples/pre-cutover/`（不再可部署，等价于把“两份生效矩阵”降为一份），矩阵↔文档与限流的不变量已由 `scripts/check_gateway_matrix.py` 在 CI 强制；**第 ③ 步未做**（矩阵本体仍在主仓库）。
2. **文档表格与矩阵自动比对**：`service-split-migration.md` §2 的行集合必须等于 nginx 的 location 集合（含精确匹配与正则），进 CI。
3. **补齐网关能力**：给 community/records/oauth/oidc/developer/storage 前缀挂限流；健康探针按上游 `/ready` 聚合；`cutover-check.sh` 真正断言服务标记头。
4. **发布与版本对齐**：每个服务在自己的仓库发布镜像；新增 `deploy/versions.lock` 记录各仓库 commit，部署前校验检出 sha。
5. **元数据-only 编排**：`deploy/docker-compose.metadata.yml` 与 `deploy/nginx.metadata.conf` 下前端仍会发账号/社区/存储请求（`/login`、`/setup`、`/account` 等 404/502），要么补齐"上游未部署则隐藏入口"的降级，要么在编排注释里写明该组合只用于目录侧。

### 6.4 待办

| 待办项 | 涉及文件 | 可验证判据 |
| --- | --- | --- |
| 矩阵单源化（三步） | `deploy/nginx.conf`、`../metafusion-api-gateway/` 下的矩阵与脚本、新增 CI | **部分完成（2026-09-16）**：旧矩阵已归档且不可部署、`cutover-check.sh` 断言标记并带 `--self-check`、网关仓库有了 CI；第 ③ 步（矩阵搬进网关仓库）未做 |
| 文档表格自动比对 | `./service-split-migration.md`、CI 脚本 | **已完成（2026-09-16）**：`python scripts/check_gateway_matrix.py`（含限流不变量与归属比对），并接进主仓库 CI；接入三个服务管理台后为 42 条 location 对 43 条文档路径、0 个问题（2026-09） |
| 限流与健康补齐 | `deploy/nginx.conf` | **已完成（2026-09-16）**：所有 `/api/*` location 一律自带 `limit_req`（脚本强制），探针拆成 `/healthz|/livez|/live`（网关自身）与 `/health/<service>`（逐上游 `/ready`）；本机无 nginx，`nginx -t` 与 429 复现留给 CI/部署 |
| 发布渠道与版本锁 | `.github/workflows/release.yml`、各服务仓库 CI、`deploy/versions.lock` | **一半完成（2026-09-16）**：`deploy/versions.lock` + `scripts/check_versions.py`（接进 CI）已就位，前端的 `NEXT_PUBLIC_*` 也改由 `release.yml` 的 build args 注入；**镜像发布渠道仍缺**（docs-site/auth/community/storage 无发布方），部署脚本里的锁校验未接 |
| 元数据-only 编排降级 | `deploy/nginx.metadata.conf`、`frontend/src/lib/services.ts` | **部分完成（2026-09-16）**：metadata 栈补了安全头/限流/`/healthz` 与 `/health/catalog`；前端不再拼账号服务的页面地址（`AUTH_PAGES_ENABLED`/`FORUM_PAGES_ENABLED`=false）；**仍未做**“上游未部署则藏入口”的完整性（页面级 API 仍会打到不存在的上游） |

## 7. UI 归属

### 7.1 现状

- 单 Next 应用承载四域：写入时实测 `frontend/src` 共 123 个 `ts/tsx`；按路径归属的分域统计为 catalog 42 文件 14072 行、auth 20 文件 4486 行、community 5 文件 1878 行、storage 3 文件 887 行、共享层（`components/ui`、`components/common`、`i18n`、部分 `lib`）30 文件 4543 行，其余是站点页与混合页。
- 子系统仓库零前端：`metafusion-auth`、`metafusion-community`、`metafusion-storage` 顶层没有前端目录，也没有 `.tsx`/`.html`/`.css` 资源；账号侧唯一的 HTML 是服务端渲染的 OAuth 同意页（`../metafusion-auth/internal/handler/consent.go`）。
- "外部化开关"曾是死开关：`NEXT_PUBLIC_*` 只在 `frontend/src/lib/services.ts` 引用，compose/Dockerfile/CI 没有注入点。**2026-09-16 已补上注入链**：`frontend/Dockerfile` 声明 ARG/ENV、`deploy/docker-compose.yml` 的 `frontend.build.args` 传值、`release.yml` 从仓库变量 `vars.NEXT_PUBLIC_*` 传给镜像构建（构建期内联）。默认仍为空 → 前端按同源网关路径工作，与当前部署一致。
- 开关的 http 分支曾指向不存在的页面（账号服务只有 JSON API + 同意页）：**2026-09-16 已改**，`services.ts` 用 `AUTH_PAGES_ENABLED`/`FORUM_PAGES_ENABLED`（均 false）门控，服务没有页面路由就不生成外部页面地址，退回同源路径。
- 跨域耦合落在页面里：`frontend/src/components/catalog/EntityDetailView.tsx` 同时嵌 auth 跳转、community 收藏、storage 上传下载；`frontend/src/app/admin/page.tsx` 一页混目录定义与账号管理。
- 契约副本在前端（**2026-09-16 已消灭手抄**）：`frontend/scripts/generate-contracts.mjs` 从四个仓库源码提取 17 个权限码（catalog 6 / auth 5 / community 4 / storage 2）与 `kinds`（来源 `backend/migrations/000001_catalog_core.up.sql` 的 CHECK），产出 `permissions.generated.ts` 与 `kinds.generated.ts`，脚本带反手抄守卫与 `--check`；**遗留**：9 处裸串权限码仍在 `app/admin/components/tabs/**`（属他人正在改的文件，未动）。
- 跨域巨型客户端（**2026-09-16 已拆**）：`frontend/src/lib/api.ts` 1664 行拆成 `lib/api/{client,auth,community,catalog,admin,importer}.ts`，原文件保留为 barrel（32 个 import 点零改动）；同时删掉 15 个指向已下线端点的死声明。**遗留**：私信（`components/community/DirectMessageModal.tsx`）与插件（`components/importer/OmniImportModal.tsx`）两组死调用仍在。
- 字典单文件混全部域：`frontend/src/messages/{zh-CN,en-US,zh-TW,ja-JP}.json`，写入时实测**四语各 3049 键且键集合完全一致**（`admin` 前缀 876 键，占 29%）；`frontend/src/i18n/getMessages.ts` 静态 import 四个整文件。

### 7.2 问题

1. 界面层没有边界：任何服务改一个字段、加一个错误码，都要动主仓库前端并整体重发，前端成了所有服务的发布闸门。
2. 目录站的"仅元数据"部署形态与实际界面不一致：详情页硬依赖另三个服务的客户端代码。
3. 拆分 UI 的瓶颈不在组件而在共享上下文与字典：`useI18n` 被大量文件引用、四语字典是单文件、鉴权上下文是全局 Provider，而 `NEXT_PUBLIC_*` 又没有构建期注入点。

### 7.3 建议做法（目标形态：每个服务自带 UI）

**机制选择：独立应用 + 同域路径 + Web Component 嵌入契约**，不引入 Module Federation——本项目没有"运行时共享依赖"的需求，引入它只会把构建复杂度换成另一个耦合点。

| 步骤 | 内容 | 说明 |
| --- | --- | --- |
| 共享层先行 | `packages/` 下的 i18n、ui-kit、session-client、主题 token；字典按域拆文件后合并；鉴权会话与 locale 传递约定 | 字典与 Context 是拆分的真实前置条件 |
| 逐域拆出 | auth（20 文件 4486 行，边界最清晰：login、setup、account、settings、invites、developer、管理台账号页签）→ community（短评、论坛、收藏）→ storage（下载与条目资源区） | 每步都是"独立应用 + 网关路径"；catalog 前端保留 `/` 与详情页 |
| 嵌入契约 | 目录详情页的社区与资源区块改为挂载自定义元素（属性传实体 id 与 locale，事件回传登录需求，鉴权走同域 cookie 或显式令牌） | 目标是"目录站不 import 别的应用的内部代码" |
| 降级 | 上游未部署时隐藏入口（沿用 `hasResourceStation()` 的现成思路，扩展到 auth 与 community） | 元数据-only 部署不再出现死链 |

拆分顺序与代价（实测规模）：auth 4486 行 → community 1878 行 → storage 887 行；共享层 4543 行必须先行。前端内部先做无风险的分域重构：`lib/api.ts` 按域拆模块、`app/admin/page.tsx` 的账号页签移出、详情页跨域区块改插槽、`NEXT_PUBLIC_*` 要么补齐构建期注入点要么删掉外部态分支。

### 7.4 待办

| 待办项 | 涉及文件 | 可验证判据 |
| --- | --- | --- |
| 字典按域拆 + 四语键对齐 | `frontend/src/messages/*.json`、`frontend/src/i18n/*` | 拆分后四语键集合仍完全一致（脚本断言差集为空）；页面文案抽查无缺键回退 |
| 抽共享前端包 | 新增 `packages/*`、`frontend/src/components/ui`、`frontend/src/i18n` | 包内不引用任何服务的业务 API；被两个以上应用引用时可独立构建 |
| 前端内部分域 | `frontend/src/lib/api.ts`、`frontend/src/app/admin/page.tsx`、`frontend/src/components/catalog/EntityDetailView.tsx` | `tsc --noEmit` 通过；单文件不再混多个服务端点 |
| 开关二选一 | `frontend/src/lib/services.ts`、`frontend/Dockerfile`、`deploy/*.yml` | 若保留：`NEXT_PUBLIC_*` 作为构建参数注入，外链指向配置域名；若删除：仓库内不再有外部态分支与死代码 |
| 嵌入契约小样 | 目录详情页与一个新应用 | 目录站构建产物不含目标应用的客户端代码；目标应用未部署时嵌区块隐藏而非报错 |

**已落地（2026-09）**：三个服务各自的管理台——`metafusion-auth/admin`、`metafusion-community/admin`、`metafusion-storage/admin`（各自仓库构建、各自发布，基础路径 `/admin/account`、`/admin/community`、`/admin/storage`）——已经按本节的机制（独立应用 + 同域路径）接进网关与主编排：网关三条前缀 location 加无尾斜杠的 301，编排三个 `*-admin` 服务，契约登记在 [service-split-migration.md](./service-split-migration.md) §2。
**仍未开始**：§7.4 其余各项——共享层（字典按域拆、UI kit、会话客户端）、主控制台里四个域页面（`/account`、`/community`、`/downloads` 形态）与嵌入契约小样。也就是说：管理台这一段先落地，共享层与整页拆分没有因此提前完成。

## 8. 目标架构

### 8.1 所有权矩阵（目标态）

| 运行单元 | 代码仓库 | 数据 | API 前缀 | UI 路径 | 文档源 |
| --- | --- | --- | --- | --- | --- |
| 元数据目录 catalog | MetaFusion | 独立 DB 角色 + `catalog` schema | `/api/catalog/*`、`/api/importer/*`、`/api/exchange/*`、`/api/capabilities`、`/api/admin/{catalog-definitions,external-databases,shelves}` | `/` 与详情页 | `metafusion-docs` |
| 账号 auth | metafusion-auth | 独立角色 + `auth` schema | `/api/setup`、`/api/auth/*`、`/api/admin/{users,groups,permissions,settings,invites,oauth}`、`/api/oauth/*`、`/api/oidc/*`、`/api/developer/*` | `/account`、`/developer`、`/login`、`/setup` | 同上 |
| 互动 community | metafusion-community | 独立角色 + `community` schema | `/api/community/*`、`/api/favorites/*`、`/api/records/*`、`/api/users/{id}/favorites` | `/community` | 同上 |
| 存储 storage | metafusion-storage | 独立角色 + `storage` schema + 对象存储 | `/api/storage/*` | `/downloads` | 同上 |
| 网关 gateway | metafusion-api-gateway | 无 | 全前缀分流 + 聚合探针 | — | 同上 |
| 协议层 SDK | metafusion-sdk（新） | 无 | — | — | 本文 §3 |
| 前端共享层 | 主仓库 `packages/`（新） | 无 | — | — | 本文 §7 |

### 8.2 决议

**已确认（本轮用户决议）**

- **D1 — UI 归属：每个服务自带 UI**。目标态是四个前端应用加网关按路径聚合；先做共享层（字典、UI kit、会话客户端），再按 auth → community → storage 顺序拆；目录详情页对社区与资源区块改用嵌入契约（§7.3）。
- **D2 — 共享代码：新建轻量协议层 SDK 仓库**。只放协议与契约，按 semver tag 引入；业务模型、数据库访问、各服务的判定规则都不进 SDK（§3.3）。

**推荐（待评审）**

- **D3 — 只有 auth 持签发私钥**，其余服务只持公钥或走 JWKS（§2）。
- **D4 — 网关矩阵唯一来源归 `metafusion-api-gateway`**，主仓库只做编排引用；备选是"保持主仓库为源、删除网关仓库里的矩阵"——两条路都必须让矩阵与文档表格自动比对（§6）。
- **D5 — capabilities 去反向探活**：目录不再持有上游地址，`enabled` 声明式，`healthy` 由网关或运维面探测（§5）。
- **D6 — 数据层先分角色、再分库**：每服务独立 DB 角色与 `DATABASE_URL`，子系统迁移版本化（§4）。
- **D7 — 事件契约二选一**（投递或拉取），不允许"注释说广播、实现无消费者"（§5）。
- **D8 — 契约单源加生成物**：权限码、`kinds`、错误码、分页口径由 SDK 与 `/api/openapi.json` 生成，前端只提交生成物（§3）。

## 9. 分批路线

| 批次 | 内容 | 前置 | 风险 |
| --- | --- | --- | --- |
| B0 | 本文与契约文档同步（路由表、capabilities 决议、解耦规范差异说明） | — | 低（纯文档） |
| B1 | 契约单源与生成物：权限码、`kinds`、OpenAPI 清单加前端生成物，两端 CI 断言 | B0 | 低—中（5 个仓库要挂同一份校验） |
| B2 | 密钥收口与 SDK 落地：目录改公钥/JWKS、三服务切换 SDK、compose 去掉私钥下发 | B1（权限码先进 SDK） | 中（令牌兼容窗口：保留一版兜底，切换期两把钥匙并存） |
| B3 | 部署面收敛：矩阵单源化三步、限流与健康、切流脚本真断言、镜像发布渠道、`versions.lock` | B2（矩阵里含 JWKS 路径） | 中（网关是唯一入口，须灰度：先复制矩阵再加断言，最后切挂载） |
| B4 | 数据层隔离：角色与授权、`DATABASE_URL` 化、子系统迁移版本化、运维脚本归位 | B2（连接串配置先进 SDK） | 中—高（需要一次停机窗口与回滚脚本，先在非生产环境验一遍） |
| B5 | UI 前置共享层：字典按域拆、UI kit、会话客户端、嵌入契约小样 | 无（可与 B1–B4 并行） | 中（字典影响全部页面，必须用四语键断言兜底） |
| B6 | 逐域拆 UI：auth → community → storage；目录详情页改嵌入；`NEXT_PUBLIC_*` 定案 | B5 | 高（跨应用会话、CSP、locale 传递；每域独立发布与回滚） |

每批要求：独立提交、独立可回退；B2、B3、B4 在提交信息里写明切换窗口与回退动作。

## 10. 非目标与不做

- 不做转码、不做媒体分析（沿用 `./storage-operations.md` 的既有结论）。
- 不在本轮引入消息队列或服务网格：事件契约先澄清语义（B2 之后再按需决定承载物）。
- 不把前端拆成 Module Federation 之类的微前端运行时：D1 选择"独立应用 + 同域路径 + Web Component"。
- 不为了"看起来更独立"而复制代码或数据：凡是要复制 DTO 或表结构的建议，都必须先证明单一来源不可行。
- 不删既有文档，不改 `service-split-migration.md` 已生效的路径契约（只补齐与实现不一致的部分）。
- 不读不写任何实例密钥与生产数据；本文所有判据都在本地或开发实例可验证。

## 11. 未验证项与假设

未验证（写作时的只读审计边界）：

1. 未启动任何服务、未连数据库、未跑 `go test` 或 `next build`；"降级行为"结论来自代码路径，未在实例上复现。
2. 未读 `.env` 与任何密钥值；私钥实际来源与长度未确认，只确认了变量名与注入点。
3. 以下条目来自子代理报告、本次**未二次复核**：账号侧额外支持受众集合与 `jti` 注销、发布工作流的镜像矩阵细节。
   （已在 2026-09-16 核实并结案：错误码漂移**不成立**；切流脚本传占位标记**属实且已修**；community 侧分页两套口径**属实且已写明并加用例**。）
4. 未核对 `metafusion-api-gateway` 仓库的矩阵是否曾被部署（只确认它与主仓库矩阵不一致）。
5. 未验证 `metafusion-importer` 是否有人使用；它未被编排、文档与技能引用。
6. 前端"独立部署"未实测；只确认 `frontend/next.config.mjs` 使用 `output: "standalone"`。

2026-09-16 实施批次新增的未验证项：

7. **本机没有 docker/nginx**：`deploy/docker-compose*.yml` 的 `config` 校验、两个 nginx 配置的 `nginx -t`、以及限流 429 的复现都没在本机跑过（CI 的 compose-lint job 会跑前两项）。
8. **`proxy_pass $上游变量/ready` 是新用法**（此前 `deploy/` 下 0 处）：语义按 nginx 文档推断（变量形式下 URI 原样传递），首次部署应实测 `curl -i /healthz` 与 `/health/<service>`。`/healthz` 语义也变了（旧行为转发给目录服务），**外部监控若拿它当目录存活必须改成 `/health/catalog`**。
9. **SDK 未被任何服务接入**（无 `go.work`/`replace`/tag），因此“切换后三服务构建测试全绿”没有证据；`go test -race` 未跑（Windows 需 CGO+gcc）。
10. **`sql/roles.example.sql` 未启用**：只做了语法与授权语义验证，“越权被拒（`permission denied`）”未在实例实测；而且它在当前“启动执行幂等基线”的口径下**会挡住启动**（见 §4.3 第 3 条）。
11. **真库用例必须 `-p 1`**：community/storage 的 handler 与 store 包共用同一个测试库，`storage` 的 `store` 包清理会删掉 handler 包的资产（在改动前的 HEAD 上同样可复现，已在其 CI 里改成 `-p 1`）。

假设：

1. 数字以写入时刻实测为准（主仓库工作区有并发改动，前端行数与字典键数会变动：本文为 123 个 `ts/tsx`、字典 3049 键）。
2. D3–D8 是推荐值，评审通过后再改代码；未通过前，实现以现有文档为准。
3. 拆分顺序（auth → community → storage）按"边界清晰度 + 代码量"排序；产品优先级变化可调整顺序，但共享层（B5）不可后置。

## 12. 本轮落地进展（2026-09-16 实施批次）

按 B1–B4 拆成 6 个工作包并行实施（互不重叠的文件所有权 + 按明确路径提交，全部本地提交、未推送）；CI 接线、compose 构建参数与文档同步由父代理收口 = **本文件所在的提交**。

| 批次 | 已落地 | 提交 |
| --- | --- | --- |
| B2 密钥与健康 | catalog 三级验签来源（静态公钥 → JWKS → 私钥兼容兜底 + 启动告警），私钥不再下发给 backend；capabilities 去探活改声明式（出站请求 0 有测试钉住）；目录补 `/health`；outbox 注释如实化；compose/.env.example 同步 | 主仓库 `69423ee` |
| B1 契约单源 + 前端分域 | 权限码与 `kinds` 生成物（反手抄守卫 + `--check`）；`lib/api.ts` 拆成 6 个域模块（barrel 保持 32 个调用点不动）；删 15 个死声明；`services.ts` 页面开关门控；Dockerfile / compose / release 三层注入 `NEXT_PUBLIC_*` | 主仓库 `1edfaae` |
| B3 网关与部署 | 所有 `/api/*` 挂限流（脚本强制的不变量）；探针拆成网关自身与逐上游；`scripts/check_gateway_matrix.py`（33/33 + 限流 + 归属，负例 4/4）与 `scripts/check_versions.py` + `deploy/versions.lock`；`deploy/nginx.metadata.conf` 补安全头/限流/探针；网关仓库收敛为脚本仓库并加 CI；`cutover-check.sh` 断言标记 + `--self-check` | 主仓库 `27433d4`；网关仓库 `34389e2`、`850d777` |
| B2 前置 SDK | `metafusion-sdk` 骨架（Claims/验签/JWKS/会话兜底/权限码/错误体与分页/health/request-id；52 用例，零第三方依赖）+ CI | SDK 仓库 `75799ea`、`59f2233` |
| B4 数据层准备 | community/storage 迁移文件化 + 版本账本（幂等、真库用例）；两处 `sql/roles.example.sql`；`records` 与 `community` 变量拆分；`-p 1` 进 storage CI | community `06a3f48`、`316efaf`、`0eaaee4`、`399a9bb`；storage `05db308`、`d7dbca6`、`7bf29a9`；auth `e2e700b`、`b3b74bc` |
| B5 / B6 UI 拆分 | **部分落地**：三个服务自带的管理台（独立应用 + 同域路径 + 网关三条前缀 location + 编排三个 `*-admin` 服务）已接入；**共享层与主控制台逐域拆页未开始** | — |

仍待办（按投入产出排序）：

1. **SDK 接入三个服务**（B2 收尾）：删各自的 `internal/auth` 与权限码副本、收口 `unauthorized`、删私钥兜底路径；SDK 仓库尚未建远端与 tag（需要用户授权）。
2. **B4 正式启用**：每服务 DB 角色 + `DATABASE_URL` 拆分 + 显式迁移入口（否则受限角色会挡住启动，见 §4.3 第 3 条）——需要停机窗口与回滚脚本。
3. **矩阵本体搬进网关仓库**（B3 第 ③ 步）与**镜像发布渠道**（docs-site/auth/community/storage）。
4. **B5 → B6 UI 拆分**：字典按域拆、共享 UI 包、嵌入契约小样，然后 auth → community → storage 逐域独立。三个服务自带的管理台已在网关层落地（见 §7.4），但它们只让服务有了独立**管理**界面，共享层与主控制台的整页拆分仍未开始。
5. **遗留死代码**：私信与插件两组前端死调用、`app/admin/components/tabs/**` 里的 9 处裸串权限码（都在并发改动中的文件里，需等其作者落地后再清）。
6. **部署前必做**：刷新 `deploy/versions.lock`（兄弟仓库 HEAD 会随并发提交前进）、`nginx -t` 与 `/health/<service>` 实测、外部监控把 `/healthz` 改成 `/health/catalog`。
