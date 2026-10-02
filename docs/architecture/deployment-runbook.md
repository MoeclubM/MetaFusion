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

## 备份与升级

1. 确认 tracked 文件无他人待提交修改，目标实例与清单一致。升级前用 `scripts/backup.sh --no-prune` 生成数据库、角色、配置和对象备份，保留最后可恢复副本。
2. 校验 `checksums.sha256`，用 `scripts/restore_drill.sh --run <backup-run> --scratch <isolated-db> --tables <affected-tables> --yes` 在独立库恢复并核对；对象演练按存储运行约定执行。
3. 涉及 JSON、来源或归属契约切换时，停止所有旧目录写入进程，记录受影响表行数和既有行指纹。备份后仍有写入时，备份不是切换时的完整快照，须在停写窗口补齐。
4. 执行匹配发布的升级。`pull` 顺序为显式 `up` → 回读账本 → `seed` → `check-refs` → 启动服务 → 校验并切换网关。

```bash
IMAGE_TAG=sha-<short-sha> deploy/deploy.sh pull
```

源码构建使用 `prod`，本地开发使用 `dev` 或 `fast`。旧单体的一次性 `cutover/retire` 入口已移除。尚未完成拆分的实例应使用对应历史发布的搬运工具，完成数据与权限验收后再进入当前路径。

HTTP 启动只做只读兼容检查，不执行 DDL、种子发布或全库回放。手工运维时 `mf-migrate up`、`seed`、`check-refs` 是不同任务；不能通过重启或健康响应推断它们已完成。种子对存量定义、货架和外部库只补缺失项，保留人工配置和停用状态。

`check-refs` 检查属性实体引用、归属、subjects、contents 和关系端点。非零表示有悬挂引用；体检不替代数据库约束、账本或用户事实核验。

## 验收与回退

- `/api/version` 的完整 SHA、容器 `Config.Image` 与清单一致，版本锁无未解释的缺席项。
- 账本无 PENDING、DIRTY、MODIFIED 或未验证摘要；definitions ETag、规则及人工配置符合预期，受影响旧行和修订指纹保持。
- 各服务 `/ready` 就绪，网关仓 `scripts/cutover-check.sh` 验证标记头与归属。宿主未发布业务端口时，服务 URL 取实际容器网络地址，不能使用默认 127.0.0.1。
- 页面和对应写入路径按改动范围验证。浏览器夹具不能证明真实保存成功，回读须匹配实际对象和版本。

网关自检的旧互动表行数检查仅用于数据搬运。普通更新没有搬运时可跳过，并明确记录 SKIP，不记为通过。

网关配置以文件挂载；Git 更新可更换 inode，普通 `up -d` 和旧容器 reload 不保证读到新文件。`deploy.sh` 会先校验候选，再强制重建 gateway 并重载，手工更新也须完成候选校验、重建和 `nginx -t`。

回退先停受影响写入，再使用上一批已验证清单及其兄弟仓组合。当前结构和 JSON 仍兼容上一版时可仅回退镜像；旧写入端会丢字段时须恢复已验证备份，并处理恢复点之后的写入。`down` 拒绝不可逆迁移，`force` 只清 dirty 标记，不等于执行或撤销 SQL。

## 迁移边界与数据库整理

000014 将定义收敛为单行配置；000016 移除业务 types 并规范化关系、偏好和图片时间跨度；000019 增加收录来源与媒体关系规则。它们是不可逆协议迁移，须停掉旧写入端并部署匹配版本。000020 仅移除已无查询依赖的 entities_search、entities_document 索引，保留业务行、定义和历史修订。

已执行 SQL 和 checksum 不重写。基线合并先验证增量升级终态，再分别验收空库和存量库；存量实例保留历史账本，不清空 ledger 或重新编号。未达到合并边界的旧库先使用合并前发布完成升级。

日常整理先核活动连接、长事务、无效/重复索引、约束与悬挂引用，再执行普通 `VACUUM (ANALYZE)` 更新统计和回收死元组。按 schema 限定对象，通过新迁移删除经核实的旧结构；零扫描次数不足以判定索引无用。不默认删除修订、审计、outbox、账号或资源绑定，也不把 `VACUUM FULL`、删除卷或全局镜像清理当作例行维护。
