# 保留的兼容层与已知问题（2026-09-19 清理审计结论）

> 死物清理（`git log --oneline --grep=清理`）删的是零引用代码；本页登记**查过但不能删**的项：为什么保留、满足什么条件才可删。新增保留项先记这里，再写代码。

## 1. 留下的字段与列

- `Entity.number`（`backend/internal/catalog/types.go`）：无服务端读语义，但导入管线 6 处在写（`importer.go:2539/2577/3630/3939/4086/4220`，分集匹配与去重依赖）。删字段会连带改匹配逻辑，属行为变更，不在死代码清理内。展示层透传。
- 侧表伴随列（`kind/work_kind/release_kind`）：无显式读写，但复合外键靠 `DEFAULT` 被动填生效；删列即拆 FK。是设计不是残留。
- `Relation.via`：只读路径填充的 transient 字段（`relations.go:393`），写入 DTO 忽略。设计如此。
- 缺键兼容（`definitions.schemes/structure`、`home_shelves.sections`）：老行读时容忍缺失。删兼容分支会炸存量读。

## 2. 留下的观测面（仅测试在用，非死代码）

- `PublicJWK()`、`BreakerState()`（连带 `upstream.Stats()`）、`audit.Dropped()`：生产零调用，但分别是“无私钥材料”契约、`deep=1` 探针排障、满队列不阻塞断言的观测口径。有测试契约钉住，删了等于拆排障手段。

## 3. 留下的兼容路径（有明确移除条件）

- 私钥兜底（`token.go:130-141`）：为已删除的“目录持私钥”服务，启动告警。移除条件：所有实例配好公钥/JWKS 且无 `AUTH_JWT_PRIVATE_KEY` 告警一个发布周期。
- 角色兜底（`permission.go:59-70`）：服务老令牌与未配权限组实例。移除条件：权限组全量下发且老令牌过期（见下 §5 分裂问题一并收敛）。
- importer 拒绝字段（`cover_aspect/notes/catalog_metadata/language` 等）：保留只为 400 明确拒绝，有契约测试钉住。删了等于把明确拒绝变回隐式忽略。
- 409 墓碑（`PUT /api/admin/modules/:id`）：让旧前端拿明确原因而非 404。移除条件：无旧前端版本再打该路径（网关日志一个发布周期零命中）。
- `services.ts` 恒假分支（`*_PAGES_ENABLED=false`）：D1（每服务自带 UI）落地后才打开。删了等于提前做 B6 拆分。
- `catalog.outbox/deliveries` 无消费者：跨服务收敛靠同步拉取，投递函数是将来引入投递时的契约。删了等于关闭合并广播的扩展位。

## 4. 已解决（删了的，记此处免后人重问）

- `entities_search` / `entities_document` 索引：tsvector 索引配 ILIKE 查询、根级 `@>` 零命中，`000004` 已删（往返实测）；检索走 ILIKE 是三期前的刻意最小口径（`store.go:866`）。
- `redirect_id` 列 / `deliveries.delivered_at` / `user_preferences.updated_at`：零读，`000004` 已删；读走 document 镜像。
- `Template.modules`：与 capabilities 的 modules 同名不同概念，后者才是活的。
- `redis` 服务：全栈零引用已摘（`92e83eb`）；README 里的 Redis 令牌黑名单是路线图（规划中），不是部署事实，保留表述。
- 离线脚本（`import_external/run_remote/mirror_external/sim/data`）：`687f2ff` 已移出版本库并忽略；磁盘残留是本地战役运行物，不删本地文件。

## 5. 已知问题（有用但有病，本轮只分析不动行为）

- **老令牌 admin 兜底前后端分裂**：前端 `permissions.ts:57` 放行一切码（含他服务码），后端 `permission.go:63-66` 仅限目录码。改任一侧都是鉴权行为变更，需产品决策（建议：前端收敛到目录码，与后端一致），暂只记录。
- **`/community/collections` 死链已修**：`EntityDetailView:1853` 手拼无路由地址，改走 `getForumEntityUrl`（同条目论坛页）。
