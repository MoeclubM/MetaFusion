# 数据层角色与最小权限（每服务独立库用户）

本文是**数据层隔离**的口径与落地说明：四个服务（目录 / 账号 / 互动 / 存储）共用同一个 PostgreSQL
实例与同一个库，但**不再共用同一个库用户**。历史问题与取舍见
[解耦审计](./decoupling-audit-2026-09.md) §4（P0：SQL 层零权限隔离，任一服务被攻破即可读写全部数据）。

授权脚本（幂等，唯一授权来源）：

- `deploy/sql/roles-least-privilege.sql`：建角色、接管对象归属、授权、含回滚与 Tier 2 降级段
- `deploy/sql/verify-role-isolation.sql`：断言覆盖率与越权拒绝，失败即非零退出（可进 CI / 切流自检）

## 1. 角色模型

| 服务 | 运行角色（LOGIN，写进连接串） | 结构归属角色（NOLOGIN） | 拥有的 schema |
| --- | --- | --- | --- |
| 目录 catalog | `mf_catalog` | `mf_catalog_owner` | `catalog` |
| 账号 auth | `mf_auth` | `mf_auth_owner` | `auth` |
| 互动 community | `mf_community` | `mf_community_owner` | `community` |
| 存储 storage | `mf_storage` | `mf_storage_owner` | `storage` |
| 共享审计表 | （四个运行角色都写） | `mf_audit_owner` | `audit` |

运行角色一律 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`；对本域 schema
有 `USAGE` + 全部对象的 CRUD/序列/函数权限，对**别人的 schema 一点权限都没有**（含 schema USAGE）。
库 owner（compose 里的 `POSTGRES_USER`，默认 `metafusion`）保留为运维/迁移身份。

## 2. 服务 × 表矩阵（本机真库实测，2026-09-19）

库 = 一个（`metafusion_db`），四个业务 schema + 一个共享审计 schema；下表由 `pg_class` 实测导出
（`docs-local/task-db-roles/_tmp-recon.sql`），不是凭印象：

| schema | 表 | 序列 / 其它 | 谁读写 |
| --- | --- | --- | --- |
| `catalog` | entities, relations, content_units, expressions, release_subjects, mediums, tracks, track_contents, revisions, definitions, shelves, external_databases, outbox, deliveries, user_preferences, notifications（16；`notifications` 由 `000003_notifications` 建出，见迁移基准 §2 的 `/api/notifications/*` 行） | definitions_id_seq, revisions_id_seq, shelves_id_seq；函数 check_parent_cycle() | `mf_catalog` |
| `auth` | users, sessions, oauth_clients, oauth_codes, oauth_tokens, oauth_audit, personal_access_tokens, instance_settings, invites, invite_uses, groups, user_groups（12） | — | `mf_auth` |
| `community` | boards, topics, posts, tags, topic_tags, favorites, direct_messages, schema_migrations（8） | tags_id_seq | `mf_community` |
| `storage` | assets, bindings, schema_migrations（3） | — | `mf_storage` |
| `audit` | audit_log（共享，四个服务只追加） | — | 四个运行角色（SELECT/INSERT） |
| `public` | schema_migrations（目录迁移工具的账本） | — | **库 owner**（运维身份），服务角色零权限 |

服务间**没有**跨 schema 的 SQL：代码检索里 `catalog.`/`auth.`/`community.`/`storage.` 的
跨域命中全部是权限码字符串（如 `community.post.create`）或注释，没有一条跨域查询（四个仓库的
`FROM|JOIN|INSERT|UPDATE` + schema 名逐条核对）。

## 3. 为什么运行角色仍持有本域 DDL（Tier 1 → Tier 2）

目标形态是"运行角色只有 CRUD、结构变更由 owner 单独跑"。**今天做不到**，原因是四个服务的启动路径
都会执行 DDL（catalog `Store.Initialize`、auth `store.Init`、community `store.Init`、
storage `store.Init`），而 PostgreSQL 在 `CREATE SCHEMA IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`
上**先检查权限、再看对象是否存在**：

| 实测（本机真库） | 结果 |
| --- | --- |
| 只给 CRUD 的角色执行 `CREATE TABLE IF NOT EXISTS probe.t`（表已存在） | `ERROR: permission denied for schema probe` |
| schema 的 owner（非库 owner）执行 `CREATE SCHEMA IF NOT EXISTS probe`（schema 已存在） | `ERROR: permission denied for database ...` |
| 只给 CRUD + 库级 CREATE、撤掉 owner 成员身份后启动存储服务 | `storage schema initialization failed: pq: permission denied for database mf_roles_check (42501)`（`deploy/sql` 同目录脚本可复现） |
| 外加 owner 成员身份 | 四个服务全部正常启动并服务真实读接口 |

因此本脚本采用**两段式**：

- **Tier 1（现在启用）**：运行角色是**本域 `*_owner` 的成员**，并额外持有 `CREATE ON DATABASE`
  （`CREATE SCHEMA IF NOT EXISTS` 需要它）。权限边界仍然只在本域 schema 内——P0 要堵的
  "跨服务读写"已完全关闭；残留是"某服务能在自己域内 DDL、能新建自己的 schema"。
- **Tier 2（可选降级，脚本第 6 节）**：等"启动只校验、迁移由 owner 单独跑"落地后，
  `REVOKE <svc>_owner FROM <svc>` + `REVOKE CREATE ON DATABASE`，第 4 节的 CRUD 与
  默认权限立即接管，不需要再补授权清单。

## 4. 跨域例外（谁需要别人的东西，为什么）

| 例外 | 要什么 | 为什么 | 怎么给 |
| --- | --- | --- | --- |
| 共享审计表 `audit.audit_log` | 四个运行角色：`USAGE, CREATE ON SCHEMA audit` + `SELECT, INSERT ON audit.audit_log` | 审计事件按"谁做的"分散在各服务，表却必须集中。刻意**不授** UPDATE/DELETE/TRUNCATE：审计只可追加，清理走运维身份 | 脚本第 4b 节（表存在才授表权限）；**归属**必须一次钉死为 `mf_audit_owner`，见下面 4.1 |
| `community-migrate`（互动的一次性搬运工具） | 读 `modules.*` 与 `catalog.favorites`，写 `community.*` | 切流窗口把单体时代的数据搬进 `community.*` 的**唯一**用途；常驻服务不需要这些权限 | 用它自己的管理身份 `COMMUNITY_MIGRATE_DATABASE_URL`（compose 已留键）；不并入任何运行角色 |
| `deploy/sql/retire-legacy-schemas.sql` | `DROP` 各域遗留对象 | 一次性退役脚本，由运维执行 | 库 owner 身份（脚本第 3 节把四个 owner 角色授给库 owner，否则接管归属后它连 catalog.favorites 都删不掉） |
| 目录迁移账本 `public.schema_migrations` | 表在 `public` | `backend/internal/migrator` 用的是**不带 schema** 的 `schema_migrations`（按 search_path 落 public） | 迁移工具只读 `DB_*`、不读 `DATABASE_URL`，因此它天然以库 owner 身份运行——账本留在运维身份下，这里不给服务角色任何 public 权限 |

> 最后一条是本轮实测发现的边界：把 `mf-migrate` 直接指向运行角色（`DB_USER=mf_catalog`）会得到
> `pq: permission denied for schema public (42501)`。要把它也切到服务角色（需要给
> `backend/internal/config` 加 `DATABASE_URL` 支持），必须同时补 public 的账本权限，见脚本第 6.4 节。

### 4.1 已修复：共享审计表的并发建表守卫（2026-09-19）

四个服务各自执行共享审计表 DDL，账本互不相通。PostgreSQL 即使在 `IF NOT EXISTS` 下也会先检查 `CREATE INDEX` 的表所有权；若其他服务角色执行非自身拥有表的索引语句，会报 `42501 must be owner`。`CREATE TABLE IF NOT EXISTS` 不触发同一检查。修复前，两种顺序都曾实测失败：运维预建归属 `mf_audit_owner` 后服务角色创建索引失败；社区先建表后，其余服务因 schema/表权限或 owner 不符失败。

四仓契约 DDL 在 advisory lock 后仅当表不存在时建表与索引：

```sql
SELECT pg_advisory_xact_lock(740205);
DO $$ BEGIN
  IF to_regclass('audit.audit_log') IS NULL THEN
    CREATE TABLE audit.audit_log (...);
    CREATE INDEX ...;
  END IF;
END $$;
```

守卫已同步到四仓七份 Go/迁移副本及本仓预建脚本；`python scripts/check_audit_schema.py` 检查八个来源。真库复核中，预建 owner 与服务先建两种顺序下四服务均启动成功；`guarded-check.sh` 验证非 owner 的重复迁移空转通过。预建脚本须以运维身份执行契约块，再变更 schema/table owner；不能 `SET ROLE mf_audit_owner`，因为即使 schema 已存在，`CREATE SCHEMA IF NOT EXISTS` 仍要求库级 CREATE。

`verify-role-isolation.sql` 的 F 段继续检查 owner 与写权限；owner 隐式权限不能靠 `REVOKE` 消除，故其失败不能被当作普通权限缺失忽略。

### 4.2 共享对象 DDL 的通用归属规则

上面这条不止影响审计表：**四个服务的迁移账本互相独立**（`catalog` 用 `public.schema_migrations`、
auth 无账本、community/storage 各用自己的 `<schema>.schema_migrations`），因此任何**跨服务共享对象**
（共享 schema/表/扩展/函数）的 DDL 都会在同一个新库上被执行 4 次。只要其中含一条"要求对象所有权"的语句
（`CREATE INDEX`、`ALTER TABLE`、`COMMENT ON`、`CREATE TRIGGER`、`GRANT`…），就先建的 owner 把后面的全挡死。
建议口径（供后续批次采纳）：

1. **共享对象的 DDL 只由一个身份负责**：要么由 `deploy/sql/` 的 bootstrap 一次建出（本脚本第 3b 节就是这条路），
   要么只由某一个服务（例如以审计读取面所在的账号服务）负责，其余服务**只校验不建**；
2. 服务侧的共享对象 DDL 一律写成"对象不存在才执行"的守卫形式（`to_regclass(...) IS NULL` 包裹建表+建索引），
   而不是指望 `IF NOT EXISTS`；
3. 共享对象跨仓复制时要有一致性检查（本仓库已加 `scripts/check_audit_schema.py` 并接进 CI）；
4. 新增共享对象前先问一句"谁会把它建出来、其他服务怎么确认它已在"，把答案写进契约文档。
## 5. 配置键位与身份对照

`deploy/docker-compose.yml` 为每个服务注入一条独立 DSN（留空即回退共用的 `DB_*`，与旧 `.env` 兼容）：

```
CATALOG_DATABASE_URL            → 目录服务进程（cmd/server）
AUTH_DATABASE_URL               → 账号服务
COMMUNITY_DATABASE_URL          → 互动服务
STORAGE_DATABASE_URL            → 存储服务
COMMUNITY_MIGRATE_DATABASE_URL  → community-migrate（一次性，跨域读）
```

| 进程 | 读哪个键 | 身份 |
| --- | --- | --- |
| catalog / auth / community / storage 服务进程 | `DATABASE_URL`（由上面五个键插值）→ 否则 `DB_*` | 各自运行角色 |
| 目录迁移工具 `mf-migrate`（`deploy.sh migrate`） | **只读 `DB_*`**（`backend/internal/config` 目前不读 `DATABASE_URL`） | 库 owner（结构变更身份） |
| auth / community / storage 的迁移（随启动路径） | `DATABASE_URL` → 否则 `DB_*` | 各自运行角色 |
| community-migrate | `DATABASE_URL` 或 `-dsn` | 管理身份 |
| 备份 / 恢复 / 退役脚本 | `POSTGRES_USER` | 库 owner |

键位登记在 `scripts/check_env_matrix.py`（双向检查器）：新键带 `interpolate` 声明，
检查 D 会在"编排里改了键名、`.env` 还配着老名字"时变红。

## 6. 落地步骤（生产）

1. **准备**：生成四个（加搬运工具共五个）随机口令；把五个 DSN 写进服务器 `.env`（键名见上表）。
2. **停机窗口**：需要。脚本会 `ALTER ... OWNER TO` 接管 schema 与全部对象（ACCESS EXCLUSIVE 锁），
   并让角色属性收敛；窗口长度取决于对象数（本机 42 个对象 < 1 秒），建议按"一次 compose 重启"估。
3. **授权**：在部署机上执行
   ```bash
   docker compose --env-file .env -f deploy/docker-compose.yml exec -T postgres \
     psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f - < deploy/sql/roles-least-privilege.sql
   ```
   （口令用 psql 变量传入，不写进仓库；不给变量则只建角色、口令稍后 `ALTER ROLE` 补。）
   **共享审计表默认不由这一步建**（第 3b 节要显式 `-v audit_bootstrap=1`，见第 4 步）；
   默认路径只收敛权限、**不动任何对象归属**——漏看一次不该改变所有权。
4. **审计表归属前置检查（脚本会自己报，别只看 F 段）**：默认路径跑完时，脚本会检测
   "`audit.audit_log` 已存在且 owner ≠ `mf_audit_owner`"（= 表是某个服务先启动时建的），并打印指引框。
   命中时按指引执行一次（幂等、可在服务运行中做）：
   ```bash
   docker compose --env-file .env -f deploy/docker-compose.yml exec -T postgres \
     psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -v audit_bootstrap=1 -f - \
     < deploy/sql/roles-least-privilege.sql
   ```
   **预期输出**：`NOTICE: [3b] 已预建共享审计表（守卫形态）并钉死 owner=mf_audit_owner`；
   此后 `verify-role-isolation.sql` 的 F 段从红转绿，且**不需要重启服务**（契约 DDL 有存在性守卫，
   归属变化不再让服务启动失败）。
5. **重建服务**：`docker compose up -d --force-recreate backend auth community storage`
   （各服务启动路径照常自建自己那份幂等结构；这一步同时验证运行角色够用）。
6. **校验**：跑 `verify-role-isolation.sql`（A/B/C/D/F 全过才是绿的），再做一次功能冒烟
   （目录读、账号 setup/登录、互动板块、存储 ready）。`[F]` 若仍报"owner 是某个服务角色"，
   说明第 4 步没做或没生效——按指引框的命令重跑一次即可，不是授权脚本的问题。
7. **回滚**：`roles-least-privilege.sql` 第 6.2 节（先让服务换回 `DB_*`，再撤权、再删角色；
   顺序反了会让在跑的服务当场 42501）。**授权脚本本身可重复执行**，误撤权限重跑一遍即恢复。

**通用纪律**：迁移新增表或序列后重跑授权脚本（重复第 3 步），使默认权限覆盖新对象；本机已验证目录 000002 新表在重跑前对 `mf_catalog` 无权限、重跑后恢复。共享审计表的权限也须在表创建后授予，否则服务写审计会失败。

## 7. 验证记录（本机真库，可复跑）

| 项 | 命令要点 | 结果 |
| --- | --- | --- |
| 授权与接管 | `apply-roles.sh <db> <owner_dsn>`（本机 WSL PG17） | 幂等；重复执行只收敛权限，二次接管无动作；从"半途失败"状态重跑可恢复 |
| 覆盖率与越权 | `verify-role-isolation.sql` | A/B/C/D/F 全过：每个角色对本域**全部**表有 CRUD、对全部序列有 USAGE/SELECT，对别人的 schema/表零权限，`SET LOCAL ROLE` 后读/写别人的表均 `permission denied` |
| 运行角色启动 | 四个服务二进制 + 各自 DSN（`docs-local/task-db-roles/run-service.ps1`） | 四个服务全部启动成功；`/ready` 200，目录 definitions/entities、账号 setup/settings/JWKS、互动 boards/topics/feed 均 200 且有真实数据 |
| 真库测试套件（受限角色） | catalog `MF_V2_TEST_DSN`、auth `AUTH_TEST_DSN`、community `COMMUNITY_TEST_DSN`、storage `STORAGE_TEST_DSN`，用户分别是四个运行角色 | catalog 311 PASS / 0 FAIL / 0 SKIP；auth 103/0/0；community 80/0/0；storage 88/0/0 |
| 越权被拒 | `probe-denial.sh` | catalog 读写 auth/community/storage 全 `permission denied for schema ...`；四个角色各自读写自己的域成功 |
| 共享审计授权（预建路径） | `case1-2.sh` + `-v audit_bootstrap=1` | `audit` schema 与 `audit.audit_log`（含主键与四条索引）归 `mf_audit_owner`；四个角色 usage/create/sel/ins=t、upd/del=f；verify exit 0 |
| 默认路径（不预建） | `case1-2.sh` 用例 1 | 不动 audit 归属；表未建时 F 段只提示；verify exit 0 |
| 守卫修复验证 | `guarded-check.sh` + 四服务启动复核 | 非 owner 重跑迁移空转通过；预建 owner 与服务先建两种顺序均正常启动（详见 §4.1） |
| 审计 DDL 一致性（CI） | `python scripts/check_audit_schema.py`（+ `--selftest`） | 8 个来源（授权脚本预建段 + 4 份 Go 常量 + 3 份迁移文件）逐条语句与结构一致；负向测试（改一列类型 / 换 `--siblings-root` 注入漂移副本）确定会红并指出差异位置 |

测试套件里"跨域"没有出现：各服务的用例只碰自己的 schema（community/storage 的 `Init` 也只建自己那份）。
两个测试夹具需要 `CREATEDB`（catalog 每个用例新建一次性库、auth 的 `seed_groups` 用例）；
那是**测试期**能力，脚本重跑会把 `NOCREATEDB` 收回来。

## 8. 未做 / 需要别人接手

1. **Tier 2 降级**：目标是启动只校验、迁移由 owner 单独执行（审计 §4.3）。账号、互动、存储启动路径仍执行 DDL；目录迁移已由 `mf-migrate up` 显式执行。本轮未完成前者，落地需改服务代码。
2. **`mf-migrate` 的 DSN 化**：`backend/internal/config` 只读 `DB_*`；统一为 `DATABASE_URL` 需改代码并补 public 账本权限（脚本第 6.4 节）。
3. **共享对象 DDL 的归属口径（见 §4.2）**：新增共享对象时，应明确由哪个身份创建，其余服务只校验；本轮只为审计表落了守卫与一致性检查。
4. **兄弟仓库的角色样例**：`../metafusion-community/sql/roles.example.sql`、`../metafusion-storage/sql/roles.example.sql` 是否删除由各自仓库决定。
5. **每服务独立库**（审计 §4 的第二步）：本轮未实施；已有 DSN 可作为后续切换入口。
