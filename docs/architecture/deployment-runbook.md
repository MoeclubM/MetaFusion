# 部署与恢复手册

本手册维护现行安装、升级、验收和回退流程。服务归属及 API 矩阵见[拆分契约](./service-split-migration.md)，数据库身份见[数据库角色](./database-roles.md)，对象存储与备份边界见[存储运行约定](./storage-operations.md)。实例 SHA、镜像摘要、备份路径和验收结果记在不提交的 `docs-local/deploy/runbook.md`。

## 发布输入

主仓与 auth、community、storage、gateway、docs 仓库平铺在同一父目录，编排按 `deploy/versions.lock` 固定兄弟仓版本。预构建部署使用同 SHA 的 CI、CodeQL 和 Release 成功产物，将 `release-manifest` 构件放到主仓根 `release-manifest.yaml`。

```bash
python3 scripts/check_versions.py
python3 scripts/check_release_manifest.py --strict --expect-tag sha-<short-sha> \
  --expect-sha <full-sha> --expect-lock deploy/versions.lock release-manifest.yaml
```

清单 v2 必须包含 backend、frontend、migrator 的真实 digest。`deploy.sh pull` 按 digest 拉取三个镜像，从锁定检出构建兄弟服务及其 UI；迁移器必须与后端同源。部署要求四个服务各自的 DSN，运行角色与库 owner 分离，私钥仅归 auth；配置检查不得打印凭据。

首次安装先从根目录 `.env.example` 建立本地配置，准备数据库和各域运行身份，按[授权步骤](./database-roles.md#6-授权验收与回退)执行角色脚本并验证隔离。共享审计预建须显式传 `-v audit_bootstrap=1`；普通重跑不会自动收敛其 owner。随后用 `prod/pull` 应用目录迁移与种子、启动服务，验收通过后由 `/setup` 创建首个管理员。不要将未初始化数据库交给 HTTP 进程自动建库。

## 备份与升级

1. 确认 tracked 文件无他人待提交修改，目标实例与清单一致。升级前用 `scripts/backup.sh --no-prune` 生成数据库、角色、配置和对象备份，保留最后可恢复副本。
2. 校验 `checksums.sha256`，用 `scripts/restore_drill.sh --run <backup-run> --scratch <isolated-db> --tables <affected-tables> --yes` 在独立库恢复并核对；对象演练按存储运行约定执行。
3. 涉及 JSON、来源或归属契约切换时，停止所有旧目录写入进程，记录受影响表行数和既有行指纹。备份后仍有写入时，备份不是切换时的完整快照，须在停写窗口补齐。
4. 执行匹配发布的升级。`prod/pull` 准备好当前迁移器后，先停止 `backend`，再执行显式 `up` → 回读账本 → `seed` → `check-refs` → 启动服务 → 校验并切换网关。外部导入或其他目录写入进程也须停写；脚本只负责本编排的 `backend`。

```bash
IMAGE_TAG=sha-<short-sha> deploy/deploy.sh pull
```

源码构建使用 `prod`。`dev` 启动开发覆盖编排，`fast` 增量构建更新；两者均不执行目录迁移、种子和引用检查，只适用于数据库已准备好且契约兼容的环境，详见[开发指南](../development.md)。旧单体的一次性 `cutover/retire` 入口已移除；未完成拆分的实例先使用对应历史发布工具完成搬运与权限验收。

HTTP 启动只做只读兼容检查，不执行 DDL、种子发布或全库回放。手工运维时 `mf-migrate up`、`seed`、`check-refs` 是不同任务；不能通过重启或健康响应推断它们已完成。种子对存量定义、货架和外部库只补缺失项，保留人工配置和停用状态。

`mf-migrate` 的操作超时默认 15 分钟；大库应先在备份恢复库测量 022 建索引和 023 引用规范化的耗时，必要时调整。全局 `-timeout` 必须放在命令前，例如 `mf-migrate -timeout 30m up`、`mf-migrate -timeout 30m check-refs -json`，不接受零或负时长。直接使用 Compose 时同样放在命令前：`docker compose -f deploy/docker-compose.yml run --rm --no-deps backend-migrate -timeout 30m up`，并先停写。

`deploy.sh migrate up/down` 也会先停止 `backend`，完成后不自动启动。迁移、账本、种子或引用检查失败时，保持所有目录写入端停写，核对失败原因、账本与备份并处理；不得仅重启旧后端继续写入新协议数据。

`check-refs` 检查属性实体引用、归属、subjects、contents 和关系端点。非零可能是悬挂引用或检查本身失败，均阻断 `prod/pull` 启动；处理后必须重验通过。体检不替代数据库约束、账本或用户事实核验。

## 验收与回退

- `/api/version` 的完整 SHA、容器 `Config.Image` 与清单一致，版本锁无未解释的缺席项。
- 账本无 PENDING、DIRTY、MODIFIED 或未验证摘要；definitions ETag、规则及人工配置符合预期，受影响旧行和修订指纹保持。
- 各服务 `/ready` 就绪，网关仓 `scripts/cutover-check.sh` 验证标记头与归属。宿主未发布业务端口时，服务 URL 取实际容器网络地址，不能使用默认 127.0.0.1。
- 目录 `/health.search_ready=true`，实际关键词加结构/动态字段过滤及 next_cursor 翻页成功。`/ready` 只证明 PostgreSQL 可用，不能代替搜索验收。
- 页面和对应写入路径按改动范围验证。浏览器夹具不能证明真实保存成功，回读须匹配实际对象和版本。

网关自检的旧互动表行数检查仅用于数据搬运。普通更新没有搬运时可跳过，并明确记录 SKIP，不记为通过。

网关配置以文件挂载；Git 更新可更换 inode，普通 `up -d` 和旧容器 reload 不保证读到新文件。`deploy.sh` 会先校验候选，再强制重建 gateway 并重载，手工更新也须完成候选校验、重建和 `nginx -t`。

回退先停受影响写入，再使用上一批已验证清单及其兄弟仓组合。当前结构和 JSON 仍兼容上一版时可仅回退镜像；旧写入端会丢字段时须恢复已验证备份，并处理恢复点之后的写入。`down` 拒绝不可逆迁移，`force` 只清 dirty 标记，不等于执行或撤销 SQL。

## 迁移边界与数据库整理

安装源已合并为 `000021_catalog_baseline`；历史 001–020 SQL 保存在 `backend/internal/migrator/testdata/legacy_catalog/`，只作回归夹具，不嵌入发布二进制。`baseline.json` 固定历史版本、名称和原始 SHA256，当前基线发布后同样不可改。

- 新空库：执行完整终态 DDL，记账 021；`seed` 单独发布内容种子。
- 已完成 020 的存量库：验证完整历史集合、名称、摘要和 dirty 状态，事务内只新增 021，不重放建表、不删除旧账本、不重写 applied_at 或 checksum。
- 部分旧库、未知版本、缺失或漂移摘要：`up/status` 非零拒绝；先用合并前发布 `f8d66fe` 完成历史升级，并在备份恢复库核实摘要，不能把空摘要自动认领为当前文件。

会话锁 88481001、账本查询和迁移事务使用同一个数据库连接；释放失败的连接丢弃，避免带锁返回连接池。`status` 仍显示保留的旧记录，并显式标注异常。021 的 down 不可逆，回退不能恢复旧 migrator 去重放账本。

历史协议切换（014 定义收敛、016 types/图片时间跨度、019 收录来源）仅由合并前发布升级，旧写入端须在窗口内停止。020 移除 entities_search、entities_document 两个退役索引，业务行和历史修订保持。结构等价、完整旧账本保留、重复 up、异常拒绝及单连接/并发锁验证见 `baseline_test.go`；018 升级和编辑回归继续读取历史夹具。

日常整理先核活动连接、长事务、无效/重复索引、约束与悬挂引用，再执行普通 `VACUUM (ANALYZE)` 更新统计和回收死元组。按 schema 限定对象，通过新迁移删除经核实的旧结构；零扫描次数不足以判定索引无用。不默认删除修订、审计、outbox、账号或资源绑定，也不把 `VACUUM FULL`、删除卷或全局镜像清理当作例行维护。

## 当前引用与搜索协议切换

021 安装基线保持不可变；022 增加结构筛选和 JSONB 反查索引；023 按已发布 definitions 一次性规范化 entity/group/list 声明中的 UUID 引用，涵盖实体、关系、发行 subjects、轨位 contents 的 locator 与属性。普通文本及未知键不改，历史修订保留；改变的当前拥有者只升一次版本，并发出维护 outbox 事件。非法值或规范化后关系冲突中止整条迁移，须在备份恢复库确认问题，不静默删边或重定向引用。运行时只接受规范小写、带连字符的 UUID 引用，并检查 `catalog.schema_contract=23`。024 新增同步身份候选索引与归一函数，不改实体事实、版本或引用协议；新版启动还检查候选函数和有效索引，不能跳过迁移直接换镜像。

切换时停旧写入端，依次执行 up、seed、check-refs，随后启动当前版本与 OpenSearch。新版建立 v3 物理索引并原子切换搜索别名；旧索引不自动删除，确认当前索引及备份后由运维按名称清理。首次重建或故障期间 q 返回503，无关键词浏览仍可用。

四个运行 DSN 均显式必填；DB_* 只供数据库容器、迁移或运维，不能代替运行配置。RustFS 凭据统一使用 `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY`，同步更新备份配置；不再注入旧 ROOT 别名。内置 OpenSearch 单节点配置供起步使用，生产节点数、副本、认证和资源预算须按实测确定，见[核心实现与容量边界](./catalog-core-implementation.md#查询规模费用与接口边界)。

## 目录提交迁移与连接预算

025 catalog_commits 新增持久回执和修订关联，先使用同源 migrator 执行 up，再启动后端；启动检查要求 commits 表与 revisions.commit_id。回执与原始请求不得按短期幂等键清理，恢复不能只回滚实体表。旧事实不被迁移改写。Agent 工具须升级到支持 checkout/commits 的技能；旧写结果仍按原身份与键核验，不能重新创建。

CATALOG_DB_MAX_OPEN_CONNS 默认20（1–256），CATALOG_DB_MAX_IDLE_CONNS 默认10（0–maxOpen），缩小 open 时同步设置 idle。多副本连接总和须给其他服务和运维留预算；提高上限不是容量优化证据。压测仅在独立容量环境运行 bench_catalog_reads.mjs。
