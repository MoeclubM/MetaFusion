# 统一审计留痕（audit log）跨服务契约

状态：**本轮实现**（2026-09-19 起）。本文是四个服务写审计行的**唯一契约**：表结构、动作码、
写入语义、读取面、脱敏规则、测试要求。四个服务各自实现，**DDL 逐字复制**，不做共享 Go 模块
（四仓是独立 module，没有跨仓依赖通道）。

背景（审计 S-24）：账号管理类操作零留痕，只有 OAuth 有一张 `auth.oauth_audit`。本轮把
catalog / auth / community / storage 的**全部写操作**纳入同一张审计表。

## 1. 表结构（唯一来源，逐字复制到四个服务）

```sql
-- 表由部署时的 mf_audit_owner 预建；四个服务的运行角色执行这段 DDL 时整段空转。
-- 为什么必须用 to_regclass 守卫：PostgreSQL 的 CREATE INDEX IF NOT EXISTS 会**先做表所有权检查**、
-- 再看索引是否存在（CREATE TABLE IF NOT EXISTS 不同，它只要求 schema 的 CREATE）。四个服务启动都会执行
-- 整段 DDL，不做守卫的话非 owner 的运行角色会拿到 42501 must be owner of table audit_log，服务直接起不来
-- （2026-09-19 由数据库分离任务真库实测，见 §6.1）。
DO $audit_ddl$
BEGIN
  PERFORM pg_advisory_xact_lock(740205);   -- 四个服务共用的建表锁：先取锁再判断，才能串行化首次建表
  IF to_regclass('audit.audit_log') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS audit;
    CREATE TABLE audit.audit_log (
      id               uuid PRIMARY KEY,
      occurred_at      timestamptz NOT NULL DEFAULT now(),
      service          text NOT NULL,
      action           text NOT NULL,
      actor_user_id    uuid,
      actor_username   text NOT NULL DEFAULT '',
      credential_type  text NOT NULL DEFAULT '',
      actor_ip         text NOT NULL DEFAULT '',
      actor_user_agent text NOT NULL DEFAULT '',
      target_type      text NOT NULL DEFAULT '',
      target_id        text NOT NULL DEFAULT '',
      changes          jsonb NOT NULL DEFAULT '{}'::jsonb,
      result           text NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure')),
      error_code       text NOT NULL DEFAULT '',
      request_method   text NOT NULL DEFAULT '',
      route            text NOT NULL DEFAULT '',
      http_status      int NOT NULL DEFAULT 0,
      request_id       text NOT NULL DEFAULT ''
    );
    CREATE INDEX audit_log_occurred_at_idx ON audit.audit_log(occurred_at DESC);
    CREATE INDEX audit_log_service_action_idx ON audit.audit_log(service, action, occurred_at DESC);
    CREATE INDEX audit_log_actor_idx ON audit.audit_log(actor_user_id, occurred_at DESC);
    CREATE INDEX audit_log_target_idx ON audit.audit_log(target_type, target_id, occurred_at DESC);
  END IF;
END
$audit_ddl$;
```

字段语义：

| 字段 | 语义 | 约定 |
| --- | --- | --- |
| `id` | 自生成的 uuid v4（应用侧生成，不依赖 pgcrypto） | 主键 |
| `occurred_at` | 服务端时间，默认 now() | 排序键 |
| `service` | `catalog` / `auth` / `community` / `storage` | 无 CHECK：新增服务不该要改旧服务的 DDL |
| `action` | 稳定机器码 `域.动作`，如 `user.role_changed` | 只增不改；改名等于改历史 |
| `actor_user_id` | 操作者 id | **不建外键**：账号删了审计还得在（与 `auth.oauth_audit.client_id` 同一理由） |
| `actor_username` | 操作者用户名**快照** | 账号改名/删号后仍可读 |
| `credential_type` | `session` / `pat` / `oauth` / `anonymous` / `system` | 实际可取的值比这一列的设计上限窄：账号服务只能给 `session`（它签发的会话令牌与 OAuth 访问令牌是同密钥同声明的 RS256 JWT，令牌内容区分不了；PAT 不是登录态，`/api/auth/*` 一律不受理），其余服务按 `Principal.FromPAT` 给 `pat` 或 `session`；`oauth` / `system` 目前没有写入方（见 §7） |
| `actor_ip` | 来源 IP（gin `c.ClientIP()`，取网关透传后的值） | |
| `actor_user_agent` | User-Agent，截断到 512 字符 | |
| `target_type` / `target_id` | 被动对象类型与 id（`user` / `entity` / `topic` / `asset`…） | id 一律用字符串，跨服务类型不一 |
| `changes` | 变更前后摘要 JSON，**必须脱敏**（§4） | 单条上限 8 KB |
| `result` | `success` / `failure` | CHECK 约束 |
| `error_code` | 失败时的稳定错误码（与响应体 `error` 字段一致），成功时为空 | |
| `request_method` / `route` | HTTP 方法 + **路由模板**（如 `/api/admin/users/:id/role`） | 存模板不存原始路径：原始路径没有额外信息，模板才可聚合 |
| `http_status` | 响应码 | |
| `request_id` | `X-Request-Id` 头，缺省生成 uuid 并回写同名响应头 | 与网关/应用日志关联 |

**不建**的列与理由：不存请求体原文（脱敏不可靠、体积不可控）；不存响应体（同上）；
不存操作者邮箱（敏感值，§4）。

## 2. 动作码清单

命名：`<域>.<过去式动作>`，全小写 + 下划线。域按业务对象分（`user` / `group` / `settings` /
`invite` / `oauth_client` / `pat` / `session` / `entity` / `relation` / `definition` /
`external_database` / `shelf` / `import` / `proposal` / `module` / `preference` /
`board` / `topic` / `post` / `ban` / `asset` / `binding` / `file` / `moderation`）。

清单按服务分别落在各自实现的 `actions` 注册表里（路由模板 → 动作码），并由
「写路由覆盖守卫测试」（§6.3）保证没有漏网的写端点。

## 3. 写入语义

每个服务自带 `internal/audit` 包（**四份代码同源**，语法按各仓风格微调；因为四仓是独立 module）。
不追求共享 module：那需要新建仓库或 replace 指令，成本高于四份 200 行同源代码。

- `Recorder`：一个后台 goroutine + 有界 channel（容量 1024）。
  - `Record(entry)`：**非阻塞**入队；入队失败（队列满）时打 error 级日志并丢弃，**绝不阻塞业务响应**。
  - 落库失败：error 级日志 + 丢弃，**不回滚业务写入**。
  - `RecordSync(ctx, entry) error`：同步写，仅供测试与"必须强一致"的少数动作使用。
- 中间件 `audit.Middleware(rec, actions)`：挂在服务的写路由之前。
  - 请求进入：构造草稿（service / actor / IP / UA / request_id / method / route / action）。
  - `c.Next()` 返回后：填 `http_status` 与 `result`（<400 → success，否则 failure；
    错误码取 `c.GetString(audit.ErrorCodeKey)`，没有则回落 `http_<status>`），`Record` 入队。
  - 只有注册表里有动作码的请求才写审计；GET 与显式豁免路由不写。
  - `X-Request-Id` 缺省生成并回写响应头。
- 处理器补充被动对象与变更摘要：`audit.Describe(c, audit.Detail{TargetType, TargetID, Changes})`。
  为拿"变更前"值而多做一次读是允许的（只有写端点会多一次读）。

**强一致 vs 最终一致**：本设计选择「审计是旁路，不参与业务事务」。业务成功但审计写失败 →
error 日志 + 丢一行；这比"审计写失败导致业务回滚"可接受（审计的用途是事后追责与排障，不是
业务约束）。例外：**没有任何动作要求强一致**——包括封禁与改角色（这两者已有各自的业务不变量）。
`auth.oauth_audit` 保留原样（它在事务内、与业务同生共死，是 OAuth 子域的历史契约），
本轮**不回填、不迁移**它；新审计表与它是并存关系（见 §7）。

## 4. 脱敏（硬性）

写入前必须过滤，测试用正则断言库里**不存在**口令/令牌/完整邮箱：

- 键名精确黑名单（大小写不敏感）：`password`、`old_password`、`new_password`、
  `password_hash`、`token`、`access_token`、`refresh_token`、`token_hash`、
  `secret`、`client_secret`、`secret_hash`、`authorization`、`cookie`、
  `api_key`、`code_verifier` → 值替换成 `"[redacted]"`。
  （账号服务的实现额外遮了 `code_challenge`：它不是凭据（哈希），多遮一个属**允许偏差**，
  其余三个服务严格按上面这份清单实现。）
- 键名子串黑名单：含 `password` / `secret` / `token` / `hash` 的键一律 `"[redacted]"`。
  **注意子串匹配的副作用**：`hash_verified`、`token_prefix` 这类键名会被整键吃掉（storage 侧真库用例抓到过
  `hash_verified` → `[redacted]`，已改键名）。要保留这类信息就换个不含黑名单词根的键名。
- **邀请码**（`auth.invites.code`）是准凭据：调用方必须用 `audit.MaskSecret(code)`
  写成 `abcd…`（保留前 4 位）后再放进 `changes`。
- **邮箱**：值里任何匹配邮箱正则的字符串 → `a***@domain`（保留首字母与域名）；键名含
  `email` 的字段一律遮罩。审计行里**不出现完整邮箱**。
- 长度：UA 512、单个字符串值 512、`changes` 序列化后 8 KB（超限时截断并加 `"_truncated": true`）。

## 5. 读取面

**唯一读取端点**：`GET /api/admin/audit-logs`（账号服务），权限码 `auth.audit.read`。

| 参数 | 说明 |
| --- | --- |
| `service` | 精确匹配，可重复/逗号分隔 |
| `action` | 精确匹配，可重复/逗号分隔 |
| `actor_user_id` | uuid 精确匹配（非法 uuid → 400 `invalid_query`） |
| `actor` | 操作者用户名前缀匹配（`ILIKE 'x%'`），大小写不敏感 |
| `target_type` / `target_id` | 精确匹配 |
| `result` | `success` / `failure`，其它值 → 400 `invalid_query` |
| `from` / `to` | RFC3339 时间，闭区间；非法 → 400 `invalid_query` |
| `request_id` | 精确匹配（与日志关联） |
| `page` / `per_page` | 默认 1 / 50，`per_page` 上限 200，越界 → 400 `invalid_query` |

响应：`{"items":[…],"total":N,"page":1,"per_page":50}`，排序 `occurred_at DESC, id DESC`（稳定分页）。

响应固定回显请求的 `page` / `per_page`（前端翻页与总页数都据此），`total` 是与 `items` 同一套过滤条件下的行数；过滤器参数为空串等于"不过滤"；`from` 只接受带时区的完整 RFC3339，`from > to` 直接 400 `invalid_query: to`；`changes` 为空对象时 `items[].changes` 是 `{}`（不是 null）。

匿名/系统操作的 `actor_username` 是空串（该列 NOT NULL DEFAULT ''），只有 `credential_type`（`anonymous`）能区分"匿名"与"用户名恰好为空"。

**为什么读取面只在账号服务**：审计表是跨服务的平台表（不属于任何单个服务的领域数据），
必须有恰好一个地方能看全。账号服务已经是"账号与权限"的管理面，且已经托管
`GET /api/admin/oauth/audits`；再加聚合读取面不引入新的跨服务调用。
备选方案（每服务各自一个端点 + 网关聚合）被否决：网关是声明式路由，没有聚合逻辑。

管理台：账号服务 `admin/` 的最小只读页（列表 + 过滤 + 分页），不做导出/图表/详情抽屉。

## 6. 迁移与测试

### 6.1 迁移落点（只追加）

| 仓库 | 落点 | 说明 |
| --- | --- | --- |
| catalog（主仓） | `backend/migrations/000002_audit_log.up.sql`（+ `.down.sql`） | 版本化迁移，`mf-migrate up` 与服务启动同一份 |
| auth | 无版本化迁移：`internal/audit` 的 `Schema` 常量由 `store.Init` 执行 | 照该仓既有做法；`cmd/server/main.go` 启动即执行 |
| community | `migrations/000007_audit_log.up.sql` | 启动与迁移工具读同一份（`internal/store.Init`） |
| storage | `internal/store/migrations/000002_audit_log.up.sql` | 启动时按版本号顺序应用 |

四个服务都**不修改**已应用的迁移文件（改了会让校验和/记账不一致）；四份 DDL **逐字一致**。

### 6.1.1 建表守卫（必须，否则多服务共存部署直接起不来）

建表段必须整段包在 §1 的 `to_regclass` 守卫里。理由与实测：PostgreSQL 的 `CREATE INDEX IF NOT EXISTS` 会
**先做表所有权检查、再看索引是否存在**（`CREATE TABLE IF NOT EXISTS` 不同，它只要求 schema 的 `CREATE`）。
四个服务的启动/迁移路径都会执行整段 DDL，而表由部署时的 `mf_audit_owner` **预建**；不做守卫时非 owner 的
运行角色会拿到 `42501 must be owner of table audit_log`，**四个服务全部起不来**（数据库分离任务真库实测：
预建 owner 后四个服务全挂；不预建、让先启动的服务建表，其余三个全挂）。

守卫后的行为：表已存在 → 整段纯空转（不触发任何所有权检查）；表不存在 → 取 740205 锁后建 schema / 表 / 四条索引。
每个仓都有回归断言钉住这三点：守卫存在、**不得**再出现 `CREATE INDEX IF NOT EXISTS`、锁必须是守卫内的 `PERFORM`。

### 6.1.2 库侧授权（部署时必查）

`audit` schema 与 `audit.audit_log` 由 bootstrap 以 `mf_audit_owner` 预建（owner 唯一）；四个运行角色只有
`USAGE`（schema）+ `SELECT, INSERT`（表），**不依赖「建表后重跑授权脚本」**（表已存在，一次授完）。
`deploy/sql/roles-least-privilege.sql` 另 `REVOKE UPDATE, DELETE, TRUNCATE` 让审计对应用角色只可追加，
`verify-role-isolation.sql` 的 F 段断言这一点。

两条注意：① 若某实例没预建（服务自己建表），那张表的 owner 就是先启动的运行角色，PostgreSQL 的 owner 隐式持权、
`REVOKE` 对它无效，F 段的「不得 UPDATE/DELETE」断言会失败——所以预建不是优化而是前提；
② 审计行的清理/归档只能用 `mf_audit_owner`（应用角色被显式禁止改写/删除）。

### 6.2 真库用例（必须有）
- 每个被审计动作各产生**恰好一行**（按 request_id / 动作码查）；
- 敏感值正则断言：`password`、`mf_pat_`/`mfp_`、`sk_`、完整邮箱正则，在整行
  （`changes` 的文本形式）里**零命中**；
- 失败路径也留痕（result=failure + error_code）；
- 读取面（账号服务）：过滤组合、分页边界、非法参数 400。

### 6.3 写路由覆盖守卫（必须有）
遍历 gin 路由树，取所有 `POST/PUT/PATCH/DELETE` 路由（含 `/api` 组），断言：
每条路由要么在 `actions` 注册表里，要么在**豁免表**里且带一句豁免理由。
新增写端点忘了登记动作码 → 测试失败。

## 7. 已知取舍与未覆盖

- **不含读取操作**：审计只记写操作（含登录/登出这类写会话的动作）；GET 不记。
- **`credential_type` 的 `oauth` / `system` 目前无写入方**：没有服务能可靠判定"这次调用用的是 OAuth 访问令牌"（账号服务签发的两类 JWT 同形），系统内部动作（种子、迁移）也不走 HTTP 写路径。列保留是为了以后有判定依据时不必改表。
- **`auth.oauth_audit` 保留不迁移**：OAuth 子域已有的事务内审计继续写入；新表不复制它的历史行，
  两表并存期间看"完整 OAuth 史"要看两处（记为遗留项，不在本轮合并）。
- **credential_type 在非账号服务是近似值**：catalog / community / storage 只验签，
  无法区分"会话令牌"与"OAuth 令牌"，只能给 `pat` / `session`。
- **不做保留策略与分区**：表会持续增长，清理/归档是运维议题（需要时再加）。
- **审计行对应用角色只可追加**（`deploy/sql/roles-least-privilege.sql` 已 REVOKE UPDATE/DELETE/TRUNCATE），但**不做防篡改的哈希链**：拥有 `mf_audit_owner` 的人仍可改写历史行。清理/归档只能用该 owner 角色。
