# MetaFusion 核心实现与模块边界

## 表达组合、版本组与收录编辑

固定八实体与四条归属外键继续作为权威结构。整体译本/整季剪辑通过声明 `usage=expression_composition` 的普通关系引用同 Work 的部分 Expression；种子码为 `expression_part`。它必须配置 `scope=work`、`acyclic=true`、`cycle_group=expression_composition`、`unique_position=true`、`aggregate=true`。跨同用途关系的相同部分和相同顺序被拒绝；部分表达可以复用在多个整体中。组合不意味着实际发行收录，Track.contents 仍须按发行事实填写。

普通版/限定版/地区版以 `usage=release_group` 的关系显式指向共同 Work 或 Collection（种子 `edition_of`）。每个 Release 在全部同用途码中只能属于一个版本组。专辑 Work 可直接作组；仅为发行组织建立的 Collection 不制造创作身份。共同 subjects 只产生相关收录；迁移不会根据主 subject 猜版本组。

关系规则模块 `relation_constraints.go` 共用于保存、定义影响和合并回放。作用域是固定单值归属：work 支持 Work/ContentUnit/Expression；release 支持 Release/Medium/Track；medium 支持 Medium/Track。复合发行的 subjects 不作为单 Work 归属。实体属性范围用 `reference_scopes: {"context":"source_work"}` 等声明；字段必须是已允许的 entity 字段，引用端和字段目标层级都必须支持该作用域。`cycle_group` 可将多种 acyclic 关系的存活边合并构图；未分组时维持单码无环口径。

读取投影：`GET /api/catalog/expressions/:id/composition` 返回有序 parts/wholes；`GET /api/catalog/releases/:id/editions` 返回显式 group/editions。两者在 RepeatableRead 事务内读取，带 `definition_etag`，裁剪不可见/终态对端；未分组发行返回 group=null、editions=[]。不另建图谱事实表。

`track_contents.sources` 保存收录的直接证据。POST `/api/catalog/tracks/:id/contents` 增加一条，PUT/DELETE `/api/catalog/tracks/:id/contents/:position` 替换/删除已读位置；请求必须携带 Track 的 expected_version、edit_note、sources，替换可用 inclusion.position 重排。一次修改仍产生 Track 修订与 outbox，旧版本并发写返回 409。旧整实体 PUT 省略来源时保留未改变收录的证据；新/改变的收录用本次编辑证据。单条编辑保留其余不可见历史收录，并裁剪响应。

模板 `match` 支持 exists/equals/contains 的 AND，priority 决定顺序，相同最高优先级回退通用布局；缺少 match 的模板不参与自动选择，仍可在编辑器中手工选用，显式空数组是该 kind 的兜底模板。`blocks` 是受支持区块的有序列表，缺省继承布局、[] 隐藏可选区块。通用详情据此组织目录/组合/收录/署名/关系/资源页签，发行页支持版本组/目录/相关收录/署名/关系的 DOM 顺序；固定事实与修订入口保持可读。creation_form 仅为可选属性与模板选择条件，不决定可写字段或实体身份。

安装与升级使用当前合并基线，见[部署与恢复手册](./deployment-runbook.md)。尚未完成 019 的旧实例先用合并前发布完成停写升级；019 新增收录来源，保留身份、定位、次序和历史快照，不能部署会覆盖来源的旧写入端。种子只补缺失定义与尚未配置的内置模板 match，保留自定义字段、停用状态、已有 match/blocks 和优先级。HTTP 启动只读检查来源列。真实库回归见 `media_upgrade_test.go`（历史 018→020→021、重复 up/seed、保留配置/历史、升级后编辑）。

面向编目者的模型、例子与端点见 [编目教程](https://github.com/MoeclubM/metafusion-docs/blob/main/docs/catalog.md)（文档在独立仓库 `metafusion-docs`）。

核心位于 `backend/internal/catalog`：统一实体注册表（Agent, Collection, Work, ContentUnit, Expression, Release, Medium, Track）、结构侧表、动态定义、修订、outbox 与站内通知收件箱（`catalog.notifications`，安装基线 `000021_catalog_baseline`，读投递见 `/api/notifications/*`）；账号、会话与令牌归 `metafusion-auth`，目录侧只做 RS256 验签、不保存账号数据。普通写事务不取全局锁；需要环与结构完整性校验的写入由 `writeStructural` 使用事务级 advisory lock。乐观版本避免静默覆盖，复合外键和延迟触发器拒绝跨域父子和循环。

关系读取由 `GET /api/catalog/definitions` 的 `relationship_rules` 和 `GET /api/catalog/entities/{id}/links` 提供：固定结构规则只读，普通语义关系由已发布 definitions 与现有关系写入口管理。links 按可见端点分页，从侧表、收录表和 `catalog.relations` 投影，不复制边。固定规则码以 `structure:` 开头，动态语义码以 `relation:` 开头；返回方向、类别、端点、位置、角色、定位、属性及本次读取的 definitions 版本，limit 默认 50、最大 100。

归属与位置的权威来源是结构侧表的 `work_id`、`release_id`、`medium_id`、`parent_id` 和 `content_unit_id`；发行收录来自 `release_subjects`，轨位收录来自 `track_contents`，署名、改编、聚合等语义来自 `catalog.relations`。固定边须在所属实体或收录写入口编辑。当前 links 不提供逐边证据或历史规则版本；旧外键没有保存这些信息，未来须先在权威写入处设计来源记录与迁移。新增结构写入仍须有现有骨架无法表达的带来源样本，见[演进方案](./metadata-structure-evolution-plan.md)。媒体样本与身份判断见[媒体编目与前端复核](./media-catalog.md)。

作品目录共用 ContentUnit、Expression 与聚合关系读取结果；没有可见内容时隐藏，失败时显示重试，同题名 Expression 标为“内容表达”。通用游戏不推断为独立游戏；Bangumi 来源类型映射为 `game` 预览标记，不在实体上虚构业务类型。旧误分类须有来源再更正，定义种子须按部署流程显式执行。

`cmd/server/main.go` 作为纯净的单一启动入口：核心依赖 PostgreSQL；OpenSearch 是可选的实体搜索候选索引，不影响目录启动与编辑。配置 `OPENSEARCH_URL` 后，后台先从目录实体表建立索引，再按 `entity.*` 事件消费同事务写入的 `catalog.outbox`；消费者用 PostgreSQL advisory lock 保证多后端副本只有一个索引器，bulk 写入等待 refresh 以缩短可见性延迟。索引文档覆盖题名、翻译、摘要、别名、标签和外部 ID，状态代际变更时自动清理并重建候选索引；搜索候选仍由 PostgreSQL 复核子串命中、外部 ID、可见性、筛选并读取实体。索引未就绪/不可用、查询无索引命中、结构关系/自定义字段筛选或匹配量超过 10,000 时回退原 PostgreSQL 搜索。未配置时检索完全走 PostgreSQL。Redis 与 S3 不由目录核心强制初始化。

外围能力（账号、互动、存储）由独立服务承担：它们不持有指向核心表的外键，只能通过 HTTP 契约查询实体与提交提案。合并事件包含旧 ID 和目标 ID；outbox 与修订同事务写入、去重按事件 ID 幂等。OpenSearch 是目前唯一生产 outbox 消费者；跨业务服务事件仍靠同步查询目录接口收敛，见迁移基准 §3。

前端 `/catalog` 使用独立 CatalogProvider，根布局不挂载全局播放器。资源、社区与个人记录组件动态导入，先检查能力再请求自己的 API。外部图片以带来源的核心引用保存，文件模块关闭不影响封面。

`pictures[]` 是有序数组：**数组顺序即展示顺序、首张即当前展示封面**，服务端不重排。`taken_at` 是图自身的拍摄／发布时间；可选 `version_label` 标识并存或先后的正确图像版本。`usage_period: {begin?, end?}` 以内嵌时间跨度记录已知使用期，借鉴 IFLA LRM E11 Time-span；仅知一端可只填一端，不新增目录实体。使用期可重叠，不替代首图选择。旧主视觉应保留在同一实体的图集中；版别专属封面放在对应 Release，不把 Work 图复制成 Release 的权威图片。"哪张是封面"在前端只有 `src/lib/cover.ts` 一处判定（`coverPicture` / `coverUrl`）。每张图还可选 `role`（`picture_role` 词表）与 `asset_id`（存储资产 UUID，配 `binding_role=cover_image`）；重复 URL、数量、用途与区间由 `validation.go` 校验，见 `docs/requirements.md` 的 MEDIA-05。迁移 `000016` 把旧平面 `in_use_from` / `in_use_until` 搬入 `usage_period`，非数组图片或冲突时间跨度列 ID 并中止，不把脏图片静默视为无图。

`000016` 也是一次性元数据协议切换：实体及其修订快照、出站事件、幂等响应不再携带业务 `types`；定义文档删除 `types`，以字段的 `applicable_kinds` 表示可写层级，并移除关系定义、场景方案中的业务类型筛选。八种 `kind`、关系码 `type` 与字段值结构 `type` 保持原义。迁移与匹配的新后端/前端须停写同步切换；旧服务不能在迁移后继续写旧 JSON。定义 ETag 在迁移时更新，OpenSearch 消费者需按新契约重建索引，不能仅依赖已消费 outbox 的历史事件。

同一次迁移把 `catalog.user_preferences.home_shelves` 中缺失或为 `null` 的 `order`、`hidden`、`sections` 归一为 `[]`，保留其它键值；非对象偏好或非数组值列出用户 ID 并中止。空库尚无 `definition_config` 行时不补旧定义，须先执行 `mf-migrate up`，再由匹配新契约的 `mf-migrate seed` 播种；不得让旧版服务在迁移后写回旧 `types`。

定义关系还在本次切换中规范化：旧种子已有的空 `participant_slot` 按 `Defaults().relSlot` 中冻结的关系码映射回填；自定义关系码的空槽位无法确定，迁移列码中止。旧 `credit_declared=false` 的文档中，`group=credits` 的既有关系按旧合并逻辑补 `counts_as_credit=true`；原来明确为 `true` 的文档保留每条关系的布尔决定。迁移随后删除 `credit_declared`，运行时不再回填。关系 `type` 仍是关系码，不得误删。

导入器对已有实体仍只在**完全无图**时补图，不会自动覆盖或提升主图；编辑者可以追加新图、保留旧图并把当前图移至首位。若上游同一 URL 的内容会原地变化，热链无法保存旧像素，需先将旧版作为独立自托管资产留存，再更新主图。日期与版本名不能代替对实际图像字节的保存。

部署使用标准 `deploy/docker-compose.yml`。API 统一使用 `/api` 单一命名空间。
