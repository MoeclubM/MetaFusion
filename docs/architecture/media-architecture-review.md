# 通用多媒体元数据架构与前端优化建议

> 对标目标：Bangumi 条目页（多版本、曲目、关联）与 Bushiroad Music 官方音乐目录（单曲 / 专辑 / 版本 / 介质 / 曲目 / MV / BD 特典）。
> 结论先行：现有 `catalog` 八实体骨架足以完整存储并展示上述内容，不需要为音乐、书籍、影像各自建特例模型。真正的缺口只有三处：版本类型学字段不足、旧单轨模型与硬编码货架残留、发行页与对比页等前端展示断裂。按“骨架冻结、差异全部走后台可配 Definitions”的路线补齐即可。

## 1. 现状诊断

### 1.1 后端：新轨已完整，旧轨是最大混乱源

新轨（`backend/internal/catalog/`，Postgres `catalog` schema）实体与边：

- 全实体基座 `catalog.entities(id, kind, version, title, status, document)`，`kind` 固定八种：`agent / collection / work / content_unit / expression / release / medium / track`（`types.go:9`）。
- 结构归属不可变：`expression.work_id`、`medium.release_id`、`track.medium_id` 建后不许跨域移动；`content_unit.parent_id`、`medium.parent_id`、`track.parent_id` 只能同域自引用并带无环检查。
- 多作品发行：`catalog.release_subjects(release_id, work_id, role, position)`，`role` 受 `release_role` 词表（`primary / compilation / supplement`）约束；曲目复用：`catalog.track_contents(track_id, expression_id, position, locator)`，`locator` 支持 `relative_to(track/medium)`、`time_start/end_ms`、`page_start/end`、`chapter`、`path`。
- 通用图谱边 `catalog.relations(type, source_id, target_id, document)`，`type` 必须在已发布 Definitions 中，支持对称、无环、基数、端点 kind/type 双重校验。
- 动态治理 `catalog.definitions(document)`：`Types / Fields / Vocabularies / Relations / Templates` 全量 JSON，`draft → published → superseded` 三态，发布前全量影响预演。种子见 `defaults.go`：词语表 `format / packaging / role / release_role / edition_type / distribution_channel`，关系含署名系 `created_by / performed_by / photographed_by / modeled_by / developed_by / voiced_by` 与分媒介 `composed_by / lyricist_of / arranged_by / directed_by / written_by / illustrated_by / narrated_by`，角色与兜底 `character_in`（agent → work/collection）、`credit_for`（work/content_unit/expression/release → agent，职位原文落 `credit_role`），创作系 `adaptation_of / sequel_of / soundtrack_of / translation_of / revision_of / cover_of / alternate_take_of / pressing_of`，组成系 `bonus_included_in / store_bonus_for / includes`。关系通用字段为 `role / credit_role / context / character / language / begin_date / end_date / scope`。完整清单以 `defaults.go` 为准（见 [架构评估结论](./architecture-assessment-2026-09.md) §3）。
- 审计：`edit_note + sources` 强制、`revisions / outbox / deliveries` 同事务写；合并要求同 kind、同归属、目标已发布。

旧轨残留（`backend/internal/models/` + `database/patches.go`）必须清理。范围澄清：`cmd/server` 已不依赖旧轨，当前仅 `cmd/worker`（`internal/transcoder`）引用 `internal/database` + `internal/models`，因此不再是 API 写入路径的双写，但旧模型语义仍与新轨冲突——`Release.work_id NOT NULL` 单作品归属与新 `subjects` 直接冲突，多作品盒装在旧轨只能伪造 Work 或走旁路边；`canonical_entries` 表与 `Track.canonical_entry_id` 单引用和新 `track_contents` 双写；`artists / artist_translations / entity_type_definitions / franchise` 独立体系与新 `agent / collection` 分裂；`AssetFile legacy` 与新 CAS 解耦存储分裂；`migrations/000004~000007` 文件缺失、`ApplyPatches` 空跳过，跨作品一致性实际靠 `store.go` 的 `undeclared_release_subject` 兜底（Track 引用的 Expression 所属 Work 必须在 Release subjects 中声明）。

> **已消解（2026-09-13）**：系统未上线、无需兼容旧数据，上述旧轨已整段删除——`internal/models`、`internal/database`、`internal/transcoder`、`cmd/worker`、`deploy/init_db`、旧前端兼容层与 11 条旧路由全部移除，`subjects` 与 `track_contents` 成为唯一事实源。

### 1.2 前端：能存，展示断裂

- 发行页把全部 `mediums` 纵向堆叠展示，无介质 Tab、无按 `CD / 黑胶 / BD / DVD / 数字` 筛选；版本仅显示品番、包装、条码文案，无普通 / 限定 / 首发 / 地区 / 再版类型徽标，`country / language / distribution_channel` 存而不展。
- 作品发行表只有版名、厂牌、品番、日期四列，无版本、地区、包装、规格列，无过滤，无“加入对比”入口；`CompareView` 仍读旧 `attributes.*` 形状，与新顶层字段脱节。
- 曲目复用只有单向链（发行 → 典范 → 发行），没有“同一录音在各版本中的题名、署名、时长差异”并排表；`mediaLabels` 在发行与载体页多处传入空类型，恒显示“载体 / 条目”，碟、曲、话、章的行头切换失效。
- `/home` 生产 `tags / tag_match` 参数但 `/explore` 不消费，货架“查看全部”跳转后过滤丢失；前后端各硬编码一套货架且 slug 对不上；封面永远取 `pictures[0]`，无官方图优先与主图标记。

### 1.3 可扩展性：定义层已达标，执行层与货架缺失

已达标：新增类型、字段、词表项、关系、模板全部走 Admin `DefinitionsEditor` 草稿、影响预演、发布三步，前端经 `GET /catalog/definitions` 动态读取，后台新增无需发版；外部来源（官网、Bushiroad Music、Bangumi、MusicBrainz 等约 30 个）已有 `external_databases` 后台 CRUD。

缺失：货架无表、无 API、无 GUI；`tags / virtual_shelves` 在 v2 无表无 API；旧后台 11 个治理 Tab 调用的是不存在的 v1 路由；抓取、导出、声纹、AI 补译、通知、搜索等执行能力只有模块槽位，没有按 `moduleapi + moduledeps DAG` 落地的可选模块。

## 2. 优化原则

1. 骨架冻结八 Kind，不为任何媒体加表加列。版本、介质、用途、地区、特典的全部差异都是 Definitions 的词表项、字段、模板组合。
2. 作品面与技术面分离。题材风格走 Type 与 Relations；品番、条码、格式、编码、页码、时码走 Release / Medium / Track Fields 与 `locator`，永远不混成“标签”。
3. 关系一律后台可配。新增关系只是在 Definitions 里加一条 `RelationDefinition`（端点 kinds/types、对称、无环、基数、分组、多语言名），前端自动本地化显示，不改代码。
4. 清理优先于新增。先删旧轨双写、硬编码货架、死 i18n key、过时架构文档，再补版本类型学与前端。

## 3. 数据模型补强（只加 Definitions，不加表）

- `release` 补 `edition_type` 枚举字段，词表 `edition_type`：`standard` 普通版、`limited` 限定版、`first_press` 初回版、`regional` 地区版、`reissue` 再版、`digital` 数字版；并把既有的 `country / language / platform / publisher / edition_date / catalog_number / barcode / attachments / store_bonuses / events` 列为发行页必展字段。
- `packaging` 词表扩 `jewel / slipcase / boxset`；`format` 词表扩 `uhd_bd / sacd / cassette / web`，原有 `cd / bd / dvd / vinyl / paper / digital` 保留；`role`（`primary / supplement / side`）保留，限定盘附带 BD 记 `supplement`。
- `medium` 补 `catalog_number` 字段，多碟各自品番放载体级，发行级保留总品番与条码；`track` 保留 `duration / role`，ISRC 只放 `expression.isrc`，不下沉到 Track。
- 新增关系全部走后台，现已落地（`defaults.go`）：`pressing_of`（再版 Release 指向上代）、`bonus_included_in`（特典内容归属）、`store_bonus_for`（店铺特典归属渠道）、`alternate_take_of`（同一曲目录音版本链），以及本次新增的 `character_in`（虚构角色/团体 → work/collection）与通用兜底 `credit_for`（无贴切职位码时的署名，职位原文落 `credit_role`）。合辑盒装不需要新类型：`release_subjects(role=compilation) + packaging=box + Medium.parent_id` 碟组即盒装；缺少显式汇编模型的风险见 [架构评估结论](./architecture-assessment-2026-09.md) §2 第 1 条。
- 退役语义沿用 `retirement.go`：停用词表项保留历史显示、禁止新用、不阻断无关编辑。

## 4. 前端展示补强

- 发行页：顶部版本徽标（版式、地区、包装）加介质 Tab（按 `format` 分组，特典盘折叠），加同曲跨介质时长与编码对照；曲目表保持编号、标题（Track 自带 Title，可与母带标题不同；实现无 `title_override` 列）、典范链、跨作品母体链、时长五列，新增同一录音各版本题名、署名、时长并排表。
- 作品页：发行表加版本、地区、包装、规格列，加按版式、格式、地区过滤，加每行“加入对比”；把 `CompareView` 数据源迁到新顶层字段并按 `Comparable` 标记过滤；目录组件传入真实媒体类型，修复碟、曲、话、章行头。
- 小说、漫画、动画、影视不需要新页面结构。卷、章、节、季、集全部是 `ContentUnit` 同作品树；单行本、文库版、BD-BOX、配信版全部是 `Release`；纸质册、光盘、数字集全部是 `Medium`；页码、章节、集号、时码全部是 `locator`。
- 探索与货架二选一闭环：要么让 `/explore` 消费 `tags / tag_match / virtual_shelves`，要么宣布废弃并删除 `/home` 生产端，不允许生产无人消费。封面按官方来源与主图标记优先，比例保持自然不拉伸。

## 5. 后台治理补强

保留 `DefinitionsEditor` 草稿、影响、发布流程；补外部来源管理 Tab 入口（API 已有）；货架如需后台化则新建 `shelves` 表（规则含 types、fields、vocab、relations 条件，加排序、图标、多语言名），公开读、管理写，前后端共用同一规则。抓取、导出、声纹、AI、通知、搜索一律做可选模块，禁止外键指回核心表。

## 6. 清理清单（单独提交，不混入逻辑变更）

删除旧 GORM 双写与单作品约束、两套硬编码货架与首页标题子串匹配、旧对比入口、已无人引用的 i18n key、过时的插件蓝图载体描述与旧术语文档。

## 7. 每类一例

### 7.1 专辑多版本：普通版、限定版、地区版内容各异

- `Work` 专辑母体，下挂 11 个录音 `Expression` 与 2 支 MV 视频 `Expression`。
- 普通版 `Release`（`edition_type=standard`，品番 A）：1 个 `Medium`（`format=cd`，`role=primary`），11 条 `Track` 按序引用 11 个录音。
- 初回限定版 `Release`（`edition_type=first_press`，品番 B）：`Medium` CD 主盘（`role=primary`，同上 11 轨）加 `Medium` BD 特典盘（`role=supplement`），特典盘 `Track` 引用 2 支 MV `Expression`，`attachments` 记写真册，`store_bonuses` 记店铺特典。
- 欧版 `Release`（`edition_type=regional`，`country=EU`，条码不同）：曲目为 11 轨子集加 1 首附赠曲（多引用一个 `Expression`），对比页对该附赠轨标版本差异。
- 展示：作品发行表一行一版，版本、地区、包装、规格可筛；发行页介质 Tab 切 CD 与 BD；对比页并排三个版本的曲目集合差。

### 7.2 单曲即作品：单曲发行收录进多张专辑，介质含 CD 与黑胶

- 单曲本身是 `Work(type=song)`，录音是其 `Expression`（持 ISRC）。
- 单曲 CD `Release`、专辑 A `Release` 第 3 轨、精选集 `Release` 第 7 轨，三处 `TrackContent` 引用同一个 `expression_id`，各自保留 Track 级标题与 `track.attributes`（如 `duration`）；重制版时长差异落在各 Track/Expression 上，不污染母带。Track 无 `title_override`/`artist_credit` 专用列，署名差异表达限制见 [架构评估结论](./architecture-assessment-2026-09.md) §2 第 6 条。
- 黑胶翻刻 `Release`（`edition_type=reissue`，`format=vinyl`，`pressing_of` 指向上代 CD 版）复用同一录音。
- 展示：典范篇目页“收录于以下发行”反向列出单曲、专辑、精选、黑胶四处，含碟轨号与版本自定义标题对照；Bushiroad Music 式艺人页按发行日期列出同一录音的全部版本流。

### 7.3 CD 曲目关系：同录音、现场版、翻唱、译词、MV

- 录音室母带 `Expression` 为基准；现场版 `Expression` 经 `revision_of` 指向母带；他歌手翻唱 `Expression` 经 `cover_of` 指向母带；中文译词版 `Expression` 经 `translation_of` 指向母带；MV 视频 `Expression` 独立存在。
- 各 `Release` 的 `Track` 按需引用其中之一，署名经 `performed_by` 边落在 `agent`，角色经边属性 `character` 指向虚构角色（如需声优双轨则同一演员多条边）。
- 展示：曲目行链入典范页，典范页 Tab 切录音、现场、翻唱、译词、MV 五种表达并列出各自收录发行。

### 7.4 小说章节关系：卷、章、节、单行本、文库版

- `Work` 小说母体；`ContentUnit` 卷、章、节三级同作品树（`parent_id` 逐级指向上级）。
- 每章定稿一个 `Expression`（归属同一 `Work`，可选挂 `content_unit_id`）。
- 单行本卷一 `Release` 与文库版 `Release` 各自下挂 `Medium(paper)`，`Track` 按章引用对应 `Expression`，`locator` 记 `page_start/end` 与 `chapter`。
- 展示：作品目录按卷折叠章节；发行页按页码排序；单行本与文库版进对比页比较收录章与页码差。

### 7.5 动画版本：Web 配信、BD、DVD 内容与介质各异

- `Work` 动画母体；`ContentUnit` 第一季第 1 至 12 话同作品树。
- 本篇 12 话各一个 `Expression`，另加特典映像、无字幕片头等 `Expression`。
- 配信版 `Release`（`format=digital`，`edition_type=digital`）：1 个数字 `Medium`，12 条 `Track` 引用本篇。
- BD-BOX `Release`（`edition_type=limited`，`packaging=box`）：`Medium` 光盘一至三（`format=bd`，`role=primary`，`parent_id` 组成碟组）加特典盘（`role=supplement` 引用特典 `Expression`）；DVD 版结构相同、`format=dvd`、品番与条码不同。
- 展示：Bangumi 式条目头加话数目录，版本表区分配信、BD、DVD，发行页介质 Tab 切三张光盘与特典盘。

### 7.6 音乐目录页：Bushiroad Music 式单曲、专辑、影像聚合

- `collection` 跨媒体企划（或 `agent` 团体）经 `includes` 聚合所属单曲、专辑 `Work`。
- 目录页按 `edition_date` 倒序列出全部 `Release`，卡片字段固定为封面（官方优先）、标题（请求语言、英语、原语言、基础字段四级回退）、版式、品番、试听入口、特典标记、事件时间线（`events` 已有结构，补渲染）。
- 不新增聚合表，聚合即图谱查询加发行流排序。

### 7.7 条目关联页：Bangumi 式 subject 全景

- 同一 `Work` 一次取全：标题四级回退、目录树、版本表、关联封面网格（`adaptation_of / sequel_of / soundtrack_of / includes`）、外部 ID 同级外链（官网、Bushiroad Music、Bangumi、MusicBrainz 并列，不 hardcode）。
- 配乐、改编、续作全部是 work 间边；声优、创作者全部是 work 到 agent 边；翻译、翻唱、修订全部是 expression 间边。页面只做分组渲染，不新增关系种类。

## 8. 实施顺序

1. 清理旧轨与硬编码货架（机械变更单独提交）。
2. 后台补 `edition_type` 等词表字段与新增关系定义（Definitions 草稿、影响预演、发布）。
3. 发行页介质 Tab 与版本徽标、作品发行表过滤与对比入口、典范并排表。
4. 探索与货架闭环、封面官方优先、行头修复。
5. 抓取、导出、搜索等执行能力按可选模块逐个落地。

---

*范围声明：本文档为只读架构建议，未修改任何代码与数据；引用文件名为撰写时检出状态，后续重命名以实际代码为准。*
