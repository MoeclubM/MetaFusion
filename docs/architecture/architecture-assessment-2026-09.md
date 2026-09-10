# 架构评估结论（2026-09）

> 范围声明：本文为只读架构评估，未修改任何代码、迁移或数据。所有结论以撰写时检出状态为准，证据为源码文件与行号。
> 关联文档：[核心实现与模块边界](./catalog-core-implementation.md)、[通用多媒体架构与前端优化建议](./media-architecture-review.md)、[元数据目录教程](../../docs-site/docs/catalog.md)。

## 0. 评估基线

- 元数据主系统单一新轨：Go 服务 `backend/internal/catalog`，统一入口 `/api`（无版本前缀），前端 Next.js 14 App Router。
- 固定八实体 kind：`agent / collection / work / content_unit / expression / release / medium / track`（`backend/internal/catalog/types.go:9`，数据库 CHECK 见 `backend/internal/catalog/schema.sql:11`）。
- 动态类型/字段/词表/关系/模板由 `catalog.definitions.document`（JSON）驱动（`schema.sql:59-63`），后台 DefinitionsEditor 走 draft → impact → publish（`backend/internal/catalog/definitions.go:30-159`），代码默认值见 `backend/internal/catalog/defaults.go`。
- 旧轨（GORM）`backend/internal/models` + `internal/database` 当前只被 `cmd/worker`（`internal/transcoder`）引用，`cmd/server` 不依赖（见 §2 第 2 条证据）。
- 前端只读兼容层 `backend/internal/catalog/works_compat.go` 与 `legacy_compat.go` 把新轨实体映射为旧前端 JSON 形状，属过渡层。
- 本次新增：关系 `character_in`（`defaults.go:137`）、`credit_for`（`defaults.go:141`）、字段 `credit_role`（`defaults.go:23`）；导入器改拉 `/v0/subjects/{id}/persons`、`/characters`（`importer.go:540-611`）；收藏端点与 `catalog.favorites` 表（`backend/internal/catalog/favorites.go`、`migrations/000003_catalog_favorites.up.sql`）。

## 1. 需求逐条评估

| 需求 | 结论 | 证据与说明 |
| --- | --- | --- |
| (a) 同一专辑多版本（普通版/限定版/地区版，各自曲目与内含特典不同） | **已支持** | 一个专辑 Work 下建多个 Release，版本类型由 `edition_type` 词表承载（`defaults.go:38`，字段接入 release 于 `defaults.go:89`，校验走 `validation.go:254-259`）；各版本曲目差异由各自 Medium/Track 与 `track_contents` 独立表达（`schema.sql:49-53`，写入 `store.go:309-321`）；特典盘用 `medium.role=supplement`（`defaults.go:36`，字段 `defaults.go:93`）；盒内附件 `attachments`、店铺特典 `store_bonuses`（`defaults.go:23`，结构 `defaults.go:60-72`）；多版本结构对比见 `relations.go:482-521`（`Compare` 仅比较 `Comparable` 字段与完整 Release 树）。 |
| (b) CD/黑胶/WebDL/BD 等不同最终载体 | **已支持** | `format` 词表含 `cd/bd/uhd_bd/dvd/vinyl/sacd/cassette/paper/digital/web`（`defaults.go:34`），绑定在 medium（`defaults.go:93`）；`distribution_channel` 区分实体/数字/网络配信（`defaults.go:39`，字段 `defaults.go:89`）。WEDL/REMUX/编码等归档技术面属文件与媒体模块，不塞进核心实体，符合边界。 |
| (c) 单曲既是独立作品又可被多个专辑收录（TrackContent 引用复用） | **已支持** | 单曲本身建 Work（`defaults.go:76` 的 `song` 类型），录音建 Expression；多张 Release 的 Track 通过 `contents[].expression_id` 引用同一 Expression（`types.go:36-40`、`schema.sql:49-53`）；反向反查见 `Occurrences`（`relations.go:424-479`，SQL 同时按 expression/work/content_unit 命中）。写入按 `track_contents` 整组替换（`store.go:314-321`）。 |
| (d) 小说章节关系（content_unit 层级） | **已支持** | `content_units.parent_id` 自引用 + 同 work 复合外键（`schema.sql:20-26`），延迟触发器做无环检测（`schema.sql:75-93`）；`expression.content_unit_id` 关联篇目（`schema.sql:27-32`）；结构字段白名单与 `parent_required` 见 `validation.go:356-370`；页码/章节定位由 `locator`（`page_start/page_end/chapter`，`types.go:27-35`，校验 `validation.go:401-412`）承载。最多四层字段嵌套限制针对 field 定义（`validation.go:164-166`），不影响 content_unit 树深度。 |
| (e) 关系类型与字段可由后台 GUI 扩展而不改代码 | **部分支持** | 已支持：关系/字段/类型/词表/模板均为 definitions JSON，后台 draft→impact→publish 三步（`definitions.go:30-159`），发布前全量既有实体与关系影响预演（`definitions.go:56-107`），校验含端点 kind/type、对称、无环、基数、字段白名单（`validation.go:109-139`、`relations.go:258-322`）；种子全部由 `addRel` 生成（`defaults.go:103-141`）。**限制**：固定 kind 集不可扩展（`types.go:9` + `schema.sql:11` CHECK），无法通过 GUI 新增实体骨架；关系属性只能引用已有 `Fields`，字段类型集固定（`validation.go:174-198`）；字段 code 有保留字黑名单（`validation.go:15`）。 |
| (f) 通用巨型多媒体模型（不为特定媒体建特例） | **已支持** | 无 `media_type` 枚举与树状分类，媒体差异由类型（`defaults.go:76-82`）、模板（`defaults.go:73-75`）、词表、关系线表达；`release_subjects` 支持一个 Release 归属多个 Work（`schema.sql:44-48`，`types.go:41-45`）。所有实体共用 `catalog.entities` 文档列，无按媒体分表。 |

## 2. 缺口与风险

1. **多作品盒装缺显式汇编语义**
   - 现状：跨作品收录只能靠 `release_subjects` 多行声明（`schema.sql:44-48`，role 取自 `release_role`：`primary/compilation/supplement`，`defaults.go:37`）加 `includes` 关系（`defaults.go:134`，collection/work → work/collection）。没有专门的 compilation/boxset 实体或 release 级汇编模型；文档要求“独立汇编 Work”，但 `TrackContent` 强制被收录 Expression 的 Work 必须列入 release subjects（`store.go:335-342`），导致汇编 Work 与母作品语义重叠。
   - 影响：13BD 之类盒装可落库，但“汇编 Work 是否必须存在”“subjects role 该填 compilation 还是 primary”无契约约束，编目行为依赖人工约定，易出现同一实体被反复建模。
   - 建议方向：在文档与技能契约中固化“盒装 = 一 Release + 多 subjects（含一个 role=compilation 的汇编 Work）+ `includes` 边”的推荐范式；若需强约束，再评估是否在 definitions 中引入 compilation 校验（不加表）。

2. **跨 Work 一致性只在应用层、且是全局 EXISTS 扫描**
   - 现状：`Save` 每次写入都执行一次全表 EXISTS 检查，只要库内任意 `track_contents` 的 Expression 所属 Work 未列入对应 Release subjects 就整笔失败（`store.go:335-342`），错误码 `undeclared_release_subject`。数据库层没有等价约束（`track_contents` 仅 FK 到 tracks/expressions，`schema.sql:49-53`）。
   - 影响：1) 数据量大后每次实体写入都全表扫描，性能随库增长退化；2) 一条历史脏数据会阻断所有后续实体写入，且错误信息不指向本次改动；3) 直连 SQL 可绕过。
   - 建议方向：把校验范围收窄到本次涉及的 Release/Expression（例如按 `release_id` 过滤）；存量脏数据需专项排查；长期考虑以触发器或物化校验列替代全局扫描。

3. **旧轨双写已收敛为 worker 专用，但仍是独立事实源**
   - 现状：`internal/models` 与 `internal/database` 仅被 `cmd/worker`（`internal/transcoder`）引用，`cmd/server` 不依赖；`migrations/` 实际只有 `000001`–`000003`，`schema.sql` 内置 shelf/favorites/external_databases 等表。
   - 影响：旧轨不再是 API 写入路径，双写风险基本解除；但旧 GORM 模型仍持有 `Release.work_id NOT NULL`、`canonical_entry_id` 等与新轨冲突的语义，worker 相关表的迁移/初始化路径与新 schema 并存，文档（含根 `AGENTS.md`）仍把 `000006/000007` 当作已执行迁移，与仓库实际不符。
   - 建议方向：明确 worker 只读或写入独立的托管表，逐步移除旧模型；迁移编号引用统一改为“以 `migrations/` 目录实际文件为准”。

4. **旧前端兼容层技术债**
   - 现状：`works_compat.go:3-6`、`legacy_compat.go:3-7` 自述为「页面迁移到 /catalog/entities 后删除」的只读层；路由注册见 `http.go:522-534`（`/catalog/works/:id`、`/works/:id/graph`、`/taxonomy`、`/artists/:id`、`/franchises/:id`、`/mediums/:id`、`/canonical-entries/:id`、`/tags`、`/relation-types`、`/works/:id/comments` 占位）。
   - 影响：1) 兼容层把 definitions 关系名、角色番位、旧 `entity_type` 词表来回映射，任何新关系都要在 `workCompatPayload` 里补分支，否则旧页面看不到；2) 前端仍调用 `/catalog/artists/:id/graph` 等未注册路由（`frontend/src/lib/api.ts:1984`），线上 404；3) `tagsCompat`、`worksCommentsCompat` 返回空/占位数据，形成“接口存在但无数据”的假象。
   - 建议方向：先补齐前端实际调用但后端缺失的兼容路由或让前端改走 `/catalog/entities`；随后按页面粒度退役兼容层，避免兼容层继续吸收新关系语义。

5. **definitions 缺少版本回滚/差异能力**
   - 现状：仅 `draft → published → superseded` 三态（`schema.sql:61`，`definitions.go:151-155`），发布是整份文档替换；`DefinitionVersions` 只列最近 100 条（`definitions.go:11`），`Draft` 要求 base 等于当前 published（`definitions.go:46-48`），没有回滚端点，也没有字段级 diff。回滚只能人工取旧 document 再起草。
   - 影响：误发布只能人工重建；多管理员协作时缺乏明确的“当前版本/基线”可视化与一键回退，审计链（revisions）虽在但恢复成本高。
   - 建议方向：增加只读的“从指定 version 起草”入口（复用 `Draft`，显式传入历史 document）与版本差异展示；状态机可评估补 `rolled_back` 或直接复用 `superseded`。

6. **Track 级版本差异表达有限**
   - 现状：Track 自身有独立 Title/Number/Position/Attributes（`types.go:46-70`），`defaults.go:95-98` 明确 Entity 无 `title_override` 列，同一 Expression 在不同版本中的时长/署名差异只能靠各 Track 的 `attributes`（duration/role）承载；per-pressing 的 artist credit 无专门字段。
   - 影响：旧文档（`media-architecture-review.md` §4/§7）按 `title_override` 描述，与实现不符；多版本署名差异需要塞进 track attributes 的非结构化字段。
   - 建议方向：若确需 per-pressing 署名/标题覆盖，优先在 definitions 增加 track 字段（如 `title_override`、`artist_credit`）走后台配置，而不是加列。

7. **收藏沿用旧目标词表**
   - 现状：`catalog.favorites.target_type` CHECK 保留旧前端词表 `work/release/artist/franchise/canonical_entry`（`migrations/000003_catalog_favorites.up.sql:5-6`，`schema.sql:145`），服务端在读取时映射到新 kind（`favorites.go:19-25`：artist→agent、franchise→collection、canonical_entry→expression/content_unit）。
   - 影响：落库值与新轨命名不一致，新增 kind 无法被收藏；映射层是又一处兼容债。
   - 建议方向：迁移或新增列改为存新 kind，或至少把「kind → target_type」映射收敛到单点并加注释，避免各模块各自解释。

8. **relations 表无数据库级端点/类型约束**
   - 现状：`catalog.relations.type` 为 text，端点 FK 只到 `entities(id)`，未约束 kind 组合（`schema.sql:54-58`）；全部端点 kind/type、无环、基数、重复判定逻辑都在应用层（`relations.go:258-322`），并依赖全局 advisory lock（`store.go:76-89`）串行化。
   - 影响：直连 SQL 或未来并发入口可写入非法边；查询 `relations` 时用 `attributes(...historical=true)` 逐条校验、失败静默跳过（`relations.go:250-252`），非法边表现为“读不到”而非报错，难排查。
   - 建议方向：保持应用层校验为主，但考虑把“被静默跳过的非法边”纳入日志或运维巡检；关系表可评估加 `CHECK(source_id<>target_id)` 之外的最小约束。

9. **文档与代码的事实漂移**
   - 已在本次文档更新中修正：`docs-site/docs/frbr-model.md` §5.1、`curation-guide.md` §5.2/§3 的关系矩阵与关系码（原引用 `part_of_franchise`、`prequel_of`、`spin_off_of`、`crossover_with`、`included_in`、`creator_of`、`voice_actor_of`、`alternate_form_of`、`phonographic_copyright` 等未实现码）；`docs/architecture/content-carrier-hierarchy.md` §迁移与兼容（原引用不存在的 `000004/000005/000006` 迁移与 `canonical_entry_id` 兼容列）；`media-architecture-review.md`（`title_override`、旧轨范围、关系种子清单）；`docs-site/docs/api-agent.md`、`agent-integration.md`、`editing-guide.md`、`overview.md`、`taxonomy.md`。
   - **仍存续（不在本次可写范围）**：根 `AGENTS.md` 仍称 `000006_carrier_content_integrity`、`000007_translation_aliases` 为已执行迁移，与 `backend/migrations/` 实际文件（仅 `000001`–`000003`）不符，建议由持有根文件写权限的维护者修正。

## 3. 实际关系与字段清单（校验基准）

以上代码为唯一事实来源（`defaults.go:103-141`），便于文档比对：

- 署名（credits，work/content_unit/expression/release → agent）：`created_by`、`performed_by`、`photographed_by`、`modeled_by`、`developed_by`、`voiced_by`；分媒介：`composed_by`、`lyricist_of`、`arranged_by`、`directed_by`、`written_by`、`illustrated_by`、`narrated_by`。
- 角色与兜底署名（credits）：`character_in`（agent → work/collection）、`credit_for`（work/content_unit/expression/release → agent，职位原文落 `credit_role`）。
- 创作关系（creative，无环）：work→work `adaptation_of / sequel_of / soundtrack_of`；expression→expression `translation_of / revision_of / cover_of / alternate_take_of`；release→release `pressing_of`。
- 组成与特典（membership）：`bonus_included_in`、`store_bonus_for`、`includes`（collection/work → work/collection）。
- 关系通用字段：`role`、`credit_role`、`context`、`character`、`language`、`begin_date`、`end_date`、`scope`（`defaults.go:104`）。
- 不存在的关系码（文档中常被误引）：`part_of_franchise`、`creator_of`、`included_in`、`crossover_with`、`prequel_of`、`spin_off_of`、`expansion_of`、`remake_of`、`member_of`、`voice_actor_of`、`imprint_of`、`real_counterpart_of`、`alternate_form_of`、`phonographic_copyright`。
