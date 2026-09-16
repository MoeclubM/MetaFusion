# 通用多媒体元数据架构与前端优化建议

> 对标目标：Bangumi 条目页（多版本、曲目、关联）与 Bushiroad Music 官方音乐目录（单曲 / 专辑 / 版本 / 介质 / 曲目 / MV / BD 特典）。
> 结论先行：现有 `catalog` 八实体骨架足以完整存储并展示上述内容，不需要为音乐、书籍、影像各自建特例模型。真正的缺口集中在展示与治理侧：典范并排表、封面取图规则、以及外围执行能力的承载方式。按“骨架冻结、差异全部走后台可配 Definitions”的路线补齐即可。

## 1. 现状诊断

### 1.1 后端：实体与边

`backend/internal/catalog/`（Postgres `catalog` schema）实体与边：

- 全实体基座 `catalog.entities(id, kind, version, title, status, document)`，`kind` 固定八种：`agent / collection / work / content_unit / expression / release / medium / track`（`types.go:9`）。
- 结构归属不可变：`expression.work_id`、`medium.release_id`、`track.medium_id` 建后不许跨域移动；`content_unit.parent_id`、`medium.parent_id`、`track.parent_id` 只能同域自引用并带无环检查。
- 多作品发行：`catalog.release_subjects(release_id, work_id, role, position)`，`role` 受 `release_role` 词表（`primary / compilation / supplement`）约束；曲目复用：`catalog.track_contents(track_id, expression_id, position, locator)`，`locator` 支持 `relative_to(track/medium)`、`time_start/end_ms`、`page_start/end`、`chapter`、`path`。
- 通用图谱边 `catalog.relations(type, source_id, target_id, document)`，`type` 必须在已发布 Definitions 中，支持对称、无环、基数、端点 kind/type 双重校验。
- 动态治理 `catalog.definitions(document)`：`Types / Fields / Vocabularies / Relations / Templates` 全量 JSON，`draft → published → superseded` 三态，发布前全量影响预演。种子见 `defaults.go`：词语表 `format / packaging / role / release_role / edition_type / distribution_channel`，关系含署名系 `created_by / performed_by / photographed_by / modeled_by / developed_by / voiced_by` 与分媒介 `composed_by / lyricist_of / arranged_by / directed_by / written_by / illustrated_by / narrated_by`，角色与兜底 `character_in`（agent → work/collection）、`credit_for`（work/content_unit/expression/release → agent，职位原文落 `credit_role`），创作系 `adaptation_of / sequel_of / soundtrack_of / translation_of / revision_of / cover_of / alternate_take_of / pressing_of`，组成系 `bonus_included_in / store_bonus_for / includes`。关系通用字段为 `role / credit_role / context / character / language / begin_date / end_date / scope`。完整清单以 `defaults.go` 为准（见 [架构评估结论](./architecture-assessment-2026-09.md) §3）。
- 审计：`edit_note + sources` 强制、`revisions / outbox / deliveries` 同事务写；合并要求同 kind、同归属、目标已发布。

### 1.2 前端展示

- 发行页按 `format` 分组的介质 Tab 展示各 `Medium`，身份区给出 `edition_type` 版本类别徽标。
- 作品发行表带格式与地区筛选，并有“加入对比”多选入口。
- 曲目复用只有单向链（发行 → 典范 → 发行），没有“同一录音在各版本中的题名、署名、时长差异”并排表。
- 封面取图没有官方来源优先与主图标记规则（组件直接取 `pictures[0]`）。

### 1.3 可扩展性：定义层已达标，外围执行能力未落地

已达标：新增类型、字段、词表项、关系、模板全部走 Admin `DefinitionsEditor` 草稿、影响预演、发布三步，前端经 `GET /api/catalog/definitions` 动态读取，后台新增无需发版；外部来源（官网、厂牌站、Bangumi、MusicBrainz 等）已有 `external_databases` 后台 CRUD 与对应 Tab；货架有 `catalog.shelves` 表、`/api/catalog/shelves` 接口与后台货架 Tab，前后端共用同一份规则。

缺失：抓取、批量导出/迁移、声纹、AI 补译、通知、搜索等执行能力不在核心实体层，也没有承载它们的独立服务或插件（单实体快照导出与外部编辑提案已有出口：`GET /api/exchange/entities/{id}`、`POST /api/exchange/proposals`）；按架构基准这些属外围能力，不进目录核心。

## 2. 优化原则

1. 骨架冻结八 Kind，不为任何媒体加表加列。版本、介质、用途、地区、特典的全部差异都是 Definitions 的词表项、字段、模板组合。
2. 作品面与技术面分离。题材风格走 Type 与 Relations；品番、条码、格式、编码、页码、时码走 Release / Medium / Track Fields 与 `locator`，永远不混成“标签”。
3. 关系一律后台可配。新增关系只是在 Definitions 里加一条 `RelationDefinition`（端点 kinds/types、对称、无环、基数、分组、多语言名），前端自动本地化显示，不改代码。
4. 外围能力不进展核心层。抓取、导出、通知、AI 补译这类执行能力以独立服务或插件承载，不往目录后端加表加列。

## 3. 数据模型补强（只加 Definitions，不加表）

> 下列枚举是**当时的建议**，不是线上词表：实际定义以 `backend/internal/catalog/defaults.go` 与 `GET /api/catalog/definitions` 为准
> （例如 `edition_type` 落地为 `standard / limited / deluxe / boxset`，`packaging` 落地为 `box / slipcase / boxset / digipak`）。

- `release` 补 `edition_type` 枚举字段，词表 `edition_type`：`standard` 普通版、`limited` 限定版、`first_press` 初回版、`regional` 地区版、`reissue` 再版、`digital` 数字版；并把既有的 `country / language / platform / publisher / edition_date / catalog_number / barcode / attachments / store_bonuses / events` 列为发行页必展字段。
- `packaging` 词表扩 `jewel / slipcase / boxset`；`format` 词表扩 `uhd_bd / sacd / cassette / web`，原有 `cd / bd / dvd / vinyl / paper / digital` 保留；`role`（`primary / supplement / side`）保留，限定盘附带 BD 记 `supplement`。
- `medium` 补 `catalog_number` 字段，多碟各自品番放载体级，发行级保留总品番与条码；`track` 保留 `duration / role`，ISRC 只放 `expression.isrc`，不下沉到 Track。
- 新增关系全部走后台（`defaults.go`）：`pressing_of`（再版 Release 指向上代）、`bonus_included_in`（特典内容归属）、`store_bonus_for`（店铺特典归属渠道）、`alternate_take_of`（同一曲目录音版本链），以及本次新增的 `character_in`（虚构角色/团体 → work/collection）与通用兜底 `credit_for`（无贴切职位码时的署名，职位原文落 `credit_role`）。合辑盒装不需要新类型：`release_subjects(role=compilation) + packaging=box + Medium.parent_id` 碟组即盒装；缺少显式汇编模型的风险见 [架构评估结论](./architecture-assessment-2026-09.md) §2 第 1 条。
- 退役语义沿用 `retirement.go`：停用词表项保留历史显示、禁止新用、不阻断无关编辑。

## 4. 前端展示补强

- 发行页：顶部版本徽标（版式、地区、包装）加介质 Tab（按 `format` 分组，特典盘折叠），加同曲跨介质时长与编码对照；曲目表保持编号、标题（Track 自带 Title，可与母带标题不同；实现无 `title_override` 列）、典范链、跨作品母体链、时长五列，新增同一录音各版本题名、署名、时长并排表。
- 作品页：发行表加版本、地区、包装、规格列，加按版式、格式、地区过滤，加每行“加入对比”；把 `CompareView` 数据源迁到新顶层字段并按 `Comparable` 标记过滤；目录组件传入真实媒体类型，修复碟、曲、话、章行头。
- 小说、漫画、动画、影视不需要新页面结构。卷、章、节、季、集全部是 `ContentUnit` 同作品树；单行本、文库版、BD-BOX、配信版全部是 `Release`；纸质册、光盘、数字集全部是 `Medium`；页码、章节、集号、时码全部是 `locator`。
- 探索与货架的筛选口径要一致：从货架跳到探索页时过滤条件不能丢。封面按官方来源与主图标记优先，比例保持自然不拉伸。

## 5. 后台治理补强

后台治理 Tab 现为账号与权限、OAuth 客户端、审计、外部库、货架、定义六类；`DefinitionsEditor` 保留草稿、影响、发布流程。货架规则（types、fields、vocab、relations 条件，加排序、图标、多语言名）公开读、管理写，前后端共用同一规则。抓取、导出、声纹、AI、通知、搜索一律做外围能力，禁止外键指回核心表。


## 6. 每类一例

### 6.1 专辑多版本：普通版、限定版、地区版内容各异

- `Work` 专辑母体，下挂 11 个录音 `Expression` 与 2 支 MV 视频 `Expression`。
- 普通版 `Release`（`edition_type=standard`，品番 A）：1 个 `Medium`（`format=cd`，`role=primary`），11 条 `Track` 按序引用 11 个录音。
- 初回限定版 `Release`（`edition_type=first_press`，品番 B）：`Medium` CD 主盘（`role=primary`，同上 11 轨）加 `Medium` BD 特典盘（`role=supplement`），特典盘 `Track` 引用 2 支 MV `Expression`，`attachments` 记写真册，`store_bonuses` 记店铺特典。
- 欧版 `Release`（`edition_type=regional`，`country=EU`，条码不同）：曲目为 11 轨子集加 1 首附赠曲（多引用一个 `Expression`），对比页对该附赠轨标版本差异。
- 展示：作品发行表一行一版，版本、地区、包装、规格可筛；发行页介质 Tab 切 CD 与 BD；对比页并排三个版本的曲目集合差。

### 6.2 单曲即作品：单曲发行收录进多张专辑，介质含 CD 与黑胶

- 单曲本身是 `Work(type=song)`，录音是其 `Expression`（持 ISRC）。
- 单曲 CD `Release`、专辑 A `Release` 第 3 轨、精选集 `Release` 第 7 轨，三处 `TrackContent` 引用同一个 `expression_id`，各自保留 Track 级标题与 `track.attributes`（如 `duration`）；重制版时长差异落在各 Track/Expression 上，不污染母带。Track 无 `title_override`/`artist_credit` 专用列，署名差异表达限制见 [架构评估结论](./architecture-assessment-2026-09.md) §2 第 6 条。
- 黑胶翻刻 `Release`（`edition_type=reissue`，`format=vinyl`，`pressing_of` 指向上代 CD 版）复用同一录音。
- 展示：典范篇目页“收录于以下发行”反向列出单曲、专辑、精选、黑胶四处，含碟轨号与版本自定义标题对照；Bushiroad Music 式艺人页按发行日期列出同一录音的全部版本流。

### 6.3 CD 曲目关系：同录音、现场版、翻唱、译词、MV

- 录音室母带 `Expression` 为基准；现场版 `Expression` 经 `revision_of` 指向母带；他歌手翻唱 `Expression` 经 `cover_of` 指向母带；中文译词版 `Expression` 经 `translation_of` 指向母带；MV 视频 `Expression` 独立存在。
- 各 `Release` 的 `Track` 按需引用其中之一，署名经 `performed_by` 边落在 `agent`，角色经边属性 `character` 指向虚构角色（如需声优双轨则同一演员多条边）。
- 展示：曲目行链入典范页，典范页 Tab 切录音、现场、翻唱、译词、MV 五种表达并列出各自收录发行。

### 6.4 小说章节关系：卷、章、节、单行本、文库版

- `Work` 小说母体；`ContentUnit` 卷、章、节三级同作品树（`parent_id` 逐级指向上级）。
- 每章定稿一个 `Expression`（归属同一 `Work`，可选挂 `content_unit_id`）。
- 单行本卷一 `Release` 与文库版 `Release` 各自下挂 `Medium(paper)`，`Track` 按章引用对应 `Expression`，`locator` 记 `page_start/end` 与 `chapter`。
- 展示：作品目录按卷折叠章节；发行页按页码排序；单行本与文库版进对比页比较收录章与页码差。

### 6.5 动画版本：Web 配信、BD、DVD 内容与介质各异

- `Work` 动画母体；`ContentUnit` 第一季第 1 至 12 话同作品树。
- 本篇 12 话各一个 `Expression`，另加特典映像、无字幕片头等 `Expression`。
- 配信版 `Release`（`format=digital`，`edition_type=digital`）：1 个数字 `Medium`，12 条 `Track` 引用本篇。
- BD-BOX `Release`（`edition_type=limited`，`packaging=box`）：`Medium` 光盘一至三（`format=bd`，`role=primary`，`parent_id` 组成碟组）加特典盘（`role=supplement` 引用特典 `Expression`）；DVD 版结构相同、`format=dvd`、品番与条码不同。
- 展示：Bangumi 式条目头加话数目录，版本表区分配信、BD、DVD，发行页介质 Tab 切三张光盘与特典盘。

### 6.6 音乐目录页：Bushiroad Music 式单曲、专辑、影像聚合

- `collection` 跨媒体企划（或 `agent` 团体）经 `includes` 聚合所属单曲、专辑 `Work`。
- 目录页按 `edition_date` 倒序列出全部 `Release`，卡片字段固定为封面（官方优先）、标题（请求语言、英语、原语言、基础字段四级回退）、版式、品番、试听入口、特典标记、事件时间线（`events` 已有结构，补渲染）。
- 不新增聚合表，聚合即图谱查询加发行流排序。

### 6.7 条目关联页：Bangumi 式 subject 全景

- 同一 `Work` 一次取全：标题四级回退、目录树、版本表、关联封面网格（`adaptation_of / sequel_of / soundtrack_of / includes`）、外部 ID 同级外链（官网、Bushiroad Music、Bangumi、MusicBrainz 并列，不 hardcode）。
- 配乐、改编、续作全部是 work 间边；声优、创作者全部是 work 到 agent 边；翻译、翻唱、修订全部是 expression 间边。页面只做分组渲染，不新增关系种类。

## 7. 实施顺序

1. 后台补词表字段与新增关系定义（Definitions 草稿、影响预演、发布）。
2. 典范并排表等展示补强，以及探索与货架的筛选口径对齐、封面官方优先。
3. 抓取、导出、搜索等外围执行能力按独立服务或插件逐个落地。

---

*范围声明：本文档为只读架构建议，未修改任何代码与数据；引用文件名为撰写时检出状态，后续重命名以实际代码为准。*
