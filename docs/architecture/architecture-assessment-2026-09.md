# 架构评估结论（2026-09）

> 范围声明：本文为只读架构评估，未修改任何代码、迁移或数据。所有结论以撰写时检出状态为准，证据为源码文件与行号。
> 关联文档：[核心实现与模块边界](./catalog-core-implementation.md)、[通用多媒体架构与前端优化建议](./media-architecture-review.md)、[元数据目录教程](https://github.com/MoeclubM/metafusion-docs/blob/main/docs/catalog.md)。

## 0. 评估基线

- 元数据主系统单一新轨：Go 服务 `backend/internal/catalog`，统一入口 `/api`（无版本前缀），前端 Next.js 14 App Router。
- 固定八实体 kind：`agent / collection / work / content_unit / expression / release / medium / track`（`backend/internal/catalog/types.go:9`，数据库 CHECK 见 `backend/migrations/000001_catalog_core.up.sql`）。
- 动态类型/字段/词表/关系/模板由 `catalog.definitions.document`（JSON）驱动（见 `backend/migrations/000001_catalog_core.up.sql` 的 `catalog.definitions`），后台 DefinitionsEditor 走 draft → impact → publish（`backend/internal/catalog/definitions.go:30-159`），代码默认值见 `backend/internal/catalog/defaults.go`。
- 收藏归互动服务（`community.favorites`），目录侧不持有收藏表；目录库只放实体、关系、定义、修订、outbox 与货架。
- 关系种子含 `character_in`（角色登场）、`credit_for`（通用署名兜底）与 `translated_by`（译者），字段 `credit_role` 承载署名原文；导入器按 `/v0/subjects/{id}/persons`、`/characters` 取上游数据（`importer.go`）。

## 1. 需求逐条评估

| 需求 | 结论 | 证据与说明 |
| --- | --- | --- |
| (a) 同一专辑多版本（普通版/限定版/地区版，各自曲目与内含特典不同） | **已支持** | 一个专辑 Work 下建多个 Release，版本类型由 `edition_type` 词表承载（`defaults.go:38`，字段接入 release 于 `defaults.go:89`，校验走 `validation.go:254-259`）；各版本曲目差异由各自 Medium/Track 与 `track_contents` 独立表达（`backend/migrations/000001_catalog_core.up.sql`，写入 `store.go:309-321`）；特典盘用 `medium.role=supplement`（`defaults.go:36`，字段 `defaults.go:93`）；盒内附件 `attachments`、店铺特典 `store_bonuses`（`defaults.go:23`，结构 `defaults.go:60-72`）；多版本结构对比见 `relations.go:482-521`（`Compare` 仅比较 `Comparable` 字段与完整 Release 树）。 |
| (b) CD/黑胶/WebDL/BD 等不同最终载体 | **已支持** | `format` 词表含 `cd/bd/uhd_bd/dvd/vinyl/sacd/cassette/paper/digital/web`（`defaults.go:34`），绑定在 medium（`defaults.go:93`）；`distribution_channel` 区分实体/数字/网络配信（`defaults.go:39`，字段 `defaults.go:89`）。WEDL/REMUX/编码等归档技术面属文件与媒体模块，不塞进核心实体，符合边界。 |
| (c) 单曲既是独立作品又可被多个专辑收录（TrackContent 引用复用） | **已支持** | 单曲本身建 Work（`defaults.go:76` 的 `song` 类型），录音建 Expression；多张 Release 的 Track 通过 `contents[].expression_id` 引用同一 Expression（`types.go:36-40`、`backend/migrations/000001_catalog_core.up.sql`）；反向反查见 `Occurrences`（`relations.go:424-479`，SQL 同时按 expression/work/content_unit 命中）。写入按 `track_contents` 整组替换（`store.go:314-321`）。 |
| (d) 小说章节关系（content_unit 层级） | **已支持** | `content_units.parent_id` 自引用 + 同 work 复合外键（`backend/migrations/000001_catalog_core.up.sql`），延迟触发器做无环检测（`backend/migrations/000001_catalog_core.up.sql`）；`expression.content_unit_id` 关联篇目（`backend/migrations/000001_catalog_core.up.sql`）；结构字段白名单与 `parent_required` 见 `validation.go:356-370`；页码/章节定位由 `locator`（`page_start/page_end/chapter`，`types.go:27-35`，校验 `validation.go:401-412`）承载。最多四层字段嵌套限制针对 field 定义（`validation.go:164-166`），不影响 content_unit 树深度。 |
| (e) 关系类型与字段可由后台 GUI 扩展而不改代码 | **部分支持** | 已支持：关系/字段/类型/词表/模板均为 definitions JSON，后台 draft→impact→publish 三步（`definitions.go:30-159`），发布前全量既有实体与关系影响预演（`definitions.go:56-107`），校验含端点 kind/type、对称、无环、基数、字段白名单（`validation.go:109-139`、`relations.go:258-322`）；种子全部由 `addRel` 生成（`defaults.go:103-141`）。**限制**：固定 kind 集不可扩展（`types.go:9` + `backend/migrations/000001_catalog_core.up.sql` CHECK），无法通过 GUI 新增实体骨架；关系属性只能引用已有 `Fields`，字段类型集固定（`validation.go:174-198`）；字段 code 有保留字黑名单（`validation.go:15`）。 |
| (f) 通用巨型多媒体模型（不为特定媒体建特例） | **已支持** | 无 `media_type` 枚举与树状分类，媒体差异由类型（`defaults.go:76-82`）、模板（`defaults.go:73-75`）、词表、关系线表达；`release_subjects` 支持一个 Release 归属多个 Work（`backend/migrations/000001_catalog_core.up.sql`，`types.go:41-45`）。所有实体共用 `catalog.entities` 文档列，无按媒体分表。 |

## 2. 缺口与风险

1. **多作品盒装缺显式汇编语义**
   - 现状：跨作品收录只能靠 `release_subjects` 多行声明（`backend/migrations/000001_catalog_core.up.sql`，role 取自 `release_role`：`primary/compilation/supplement`，`defaults.go:37`）加 `includes` 关系（`defaults.go:134`，collection/work → work/collection）。没有专门的 compilation/boxset 实体或 release 级汇编模型；文档要求“独立汇编 Work”，但 `TrackContent` 强制被收录 Expression 的 Work 必须列入 release subjects（`store.go:335-342`），导致汇编 Work 与母作品语义重叠。
   - 影响：13BD 之类盒装可落库，但“汇编 Work 是否必须存在”“subjects role 该填 compilation 还是 primary”无契约约束，编目行为依赖人工约定，易出现同一实体被反复建模。
   - 建议方向：在文档与技能契约中固化“盒装 = 一 Release + 多 subjects（含一个 role=compilation 的汇编 Work）+ `includes` 边”的推荐范式；若需强约束，再评估是否在 definitions 中引入 compilation 校验（不加表）。

2. **跨 Work 一致性只在应用层、且是全局 EXISTS 扫描**
   - 现状：`Save` 每次写入都执行一次全表 EXISTS 检查，只要库内任意 `track_contents` 的 Expression 所属 Work 未列入对应 Release subjects 就整笔失败（`store.go:335-342`），错误码 `undeclared_release_subject`。数据库层没有等价约束（`track_contents` 仅 FK 到 tracks/expressions，`backend/migrations/000001_catalog_core.up.sql`）。
   - 影响：1) 数据量大后每次实体写入都全表扫描，性能随库增长退化；2) 一条历史脏数据会阻断所有后续实体写入，且错误信息不指向本次改动；3) 直连 SQL 可绕过。
   - 建议方向：把校验范围收窄到本次涉及的 Release/Expression（例如按 `release_id` 过滤）；存量脏数据需专项排查；长期考虑以触发器或物化校验列替代全局扫描。


3. **definitions 的版本 diff 与回滚没有后台界面**
   - 现状：`draft → published → superseded` 三态，发布是整份文档替换；接口侧已具备 `GET /api/admin/catalog-definitions`（`include_document=false` 取瘦身列表）、`GET /{id}`（单版本）、`GET /{id}/diff`（字段级差异）与 `POST /{id}/rollback`（以当前 published 为 base 起草并发布，不原地改历史行）。
   - 影响：误发布或合并结果不合预期时，多管理员只能走 API 复核与回退，管理台没有“当前版本/基线”可视化。
   - 建议方向：管理台接上述四个端点（列表不下载文档、点版本才拉详情、变更区渲染 diff、回滚走 rollback）。

4. **Track 级版本差异表达有限**
   - 现状：Track 自身有独立 Title/Number/Position/Attributes（`types.go:46-70`），`defaults.go:95-98` 明确 Entity 无 `title_override` 列，同一 Expression 在不同版本中的时长/署名差异只能靠各 Track 的 `attributes`（duration/role）承载；per-pressing 的 artist credit 无专门字段。
   - 影响：`media-architecture-review.md` §4/§6 按 `title_override` 描述，与实现不符；多版本署名差异需要塞进 track attributes 的非结构化字段。
   - 建议方向：若确需 per-pressing 署名/标题覆盖，优先在 definitions 增加 track 字段（如 `title_override`、`artist_credit`）走后台配置，而不是加列。

5. **relations 表无数据库级端点/类型约束**
   - 现状：`catalog.relations.type` 为 text，端点 FK 只到 `entities(id)`，未约束 kind 组合（`backend/migrations/000001_catalog_core.up.sql`）；全部端点 kind/type、无环、基数、重复判定逻辑都在应用层（`relations.go:258-322`），并依赖全局 advisory lock（`store.go:76-89`）串行化。
   - 影响：直连 SQL 或未来并发入口可写入非法边；查询 `relations` 时用 `attributes(...historical=true)` 逐条校验、失败静默跳过（`relations.go:250-252`），非法边表现为“读不到”而非报错，难排查。
   - 建议方向：保持应用层校验为主，但考虑把“被静默跳过的非法边”纳入日志或运维巡检；关系表可评估加 `CHECK(source_id<>target_id)` 之外的最小约束。

6. **文档与代码的事实漂移**
   - 现状：外部文档（`metafusion-docs` 仓库）与本文的接口/关系码描述会随实现变化漂移，关系码与端点是最常被误引的两类；本仓库的接口事实来源是 `backend/internal/catalog/http.go`、`openapi.go` 与 `defaults.go`。
   - 影响：读者按旧文档写出不存在的端点或关系码，评审时无法从文档反推实现。
   - 建议方向：文档改动与代码同批提交；关系码与端点清单以 `defaults.go` 与 `http.go` 为准，文档只引用不复制。

## 3. 实际关系与字段清单（校验基准）

以上代码为唯一事实来源（`defaults.go:103-141`），便于文档比对：

- 署名（credits，work/content_unit/expression/release → agent）：`created_by`、`performed_by`、`photographed_by`、`modeled_by`、`developed_by`、`voiced_by`；分媒介：`composed_by`、`lyricist_of`、`arranged_by`、`directed_by`、`written_by`、`illustrated_by`、`narrated_by`；译者 `translated_by`。
- 角色与兜底署名（credits）：`character_in`（agent → work/collection）、`credit_for`（work/content_unit/expression/release → agent，职位原文落 `credit_role`）。
- 创作关系（creative，无环）：work→work `adaptation_of / sequel_of / spin_off_of / soundtrack_of`；expression→expression `translation_of / revision_of / cover_of / alternate_take_of`；release→release `pressing_of`。
- 组成与特典（membership）：`bonus_included_in`、`store_bonus_for`、`includes`（collection/work → work/collection）、`member_of`（agent → agent，个人与团体）。
- 关系通用字段：`role`、`credit_role`、`context`、`character`、`language`、`begin_date`、`end_date`、`scope`（`defaults.go:104`）。
- 不存在的关系码（文档中常被误引）：`part_of_franchise`、`creator_of`、`included_in`、`crossover_with`、`prequel_of`、`expansion_of`、`remake_of`、`voice_actor_of`、`imprint_of`、`real_counterpart_of`、`alternate_form_of`、`phonographic_copyright`。
  （注意：`sequel_of` 的反向名是「作为前作」，`includes` 的反向名是「组成属于」，它们不是独立关系码。）

## 4. 全动态化边界

**原则**：仅保留"实体骨架 + 结构性引用"作为核心；**其余一切属性与编排由 definitions 声明**，后台 GUI 可增删改，不需要改代码、改迁移或发版。

由 definitions 声明的部分：

- 收录定位（页/时间码/路径/章节）：`Locator` 是 `map[string]any`，键集合由 `fields.locator` 组字段声明（含 `anchor_key` 锚点语义与通用成对区间校验），后台可加"盘面/张/帧"等任意定位键（`types.go`、`defaults.go`、`validation.go`）。
- 收录关系与发行对象的附加描述：`catalog.track_contents.attributes` 与 `catalog.release_subjects.attributes`（JSONB），由 `fields.inclusion_attributes` / `fields.subject_attributes` 校验，默认无子字段、后台可扩展。
- 作品"主日期"语义：模板声明 `primary_date_field`，导入与展示按声明取值（`Defaults.PrimaryDateField`、`types.go`）。
- 详情页属性分区与头部徽章：按模板 `sections` / `badge_fields` 递归渲染（`TemplateAttributeSections.tsx`），未覆盖字段自动收尾；类型渲染支持 text/number/date/enum/entity/multilingual/list/group。
- 发行版列表列与筛选：模板声明 `columns` / `facet_fields`，列头与筛选项全部由声明生成。
- 编辑器定位字段：按 `fields.locator` 声明递归生成，枚举走词表。

**保留为"核心"的部分**（有意不动态化）：八个实体 kind、实体表列（`id/kind/version/title/status/...`）、结构性外键（`work_id`/`release_id`/`medium_id`/`parent_id`/`content_unit_id`）、`track_contents`/`release_subjects` 的引用与次序、关系端点 kind 白名单、以及 `Relation` 的 source/target/type。这些是 LRM 骨架与引用完整性所必需，改它们等同于迁移模型本身。
