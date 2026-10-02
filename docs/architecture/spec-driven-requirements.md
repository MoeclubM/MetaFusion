# MetaFusion 规范驱动开发需求与架构基准 (Spec-Driven Requirements & Architecture Baseline)

> **重要约束**：本文档为用户明确下达的核心架构与产品规范，后续开发、修改与重构均以此为准。
>
> **实现现状差异（2026-09-26 复核）**：§1.1 的生命周期词表在实现中是 `draft / pending_review / published / deleted / merged`——没有「归档」，多一个「合并」（`backend/internal/catalog/validation.go` 的状态闭集）。
>
> 另外两处是规范的表述比实现窄，不构成缺口：§2.1 的名称回退链在实现里是超集（在 zh-CN 之前插入了 zh-TW / ja，见 `frontend/src/lib/definitions.ts` 的 `resolveLocalizedName`）；§2.2 里「名称含 zh-CN 与 en-US」已按 §2.3 的命名四语铁律对齐。

---

## 1. 核心架构与系统边界

1. **元数据主系统（一体化核心）**：
   - **涵盖范围**：站点介绍（`/`）、首页分类货架（`/home`）、全域探索中心（`/explore`）、八种实体共用的规范详情地址 `/catalog/[id]`（kind 只决定内容布局，见 `frontend/src/lib/entityRoutes.ts`）、实体编辑器/创建器（`/new`）、多版本对比工具（`/compare`）、站内通知（`/notifications`）、以及共用同一数据库的后台管理系统（`/admin`）。
   - **后台管理系统**：
     - 与元数据主系统共用同一 PostgreSQL 数据库（`catalog` schema）。
     - 支持在后台 GUI 中管理动态字段（Fields）、图谱关系（Relations）、受控词表（Vocabularies）、场景方案（Schemes）、展示模板（Templates）与固定结构显示名；字段 `applicable_kinds` 声明可写层级，实体不再保存业务 Types。
     - 动态定义保存在 `catalog.definition_config` 的单份生效文档中。编辑器直接预检并保存完整文档，以 `etag` 防止并发覆盖；不保留定义版本、草稿、差异或回滚入口。
     - 语义关系支持 GUI 配置 `scope`（同 Work/Release/Medium）、`cycle_group`（跨码共同无环）、`unique_position` 和 `reference_scopes`（实体属性相对某端点的归属范围）。保存、定义影响检查、合并回放共用校验；只允许受支持的声明，不执行 SQL/脚本。
     - `usage=expression_composition` 表示整体 Expression 包含同 Work 内的部分 Expression，全部同用途关系共用顺序及去重约束，并纳入共同无环组。`usage=release_group` 表示 Release 明确属于一个 Work/Collection 版本组；共同 subjects 只表示相关收录，不能据此推断版本。
     - 模板的 `match` 是有限条件的 AND，`priority` 决定匹配优先级，同最高优先级冲突回退通用事实布局；`blocks` 控制受支持区块的显示与顺序。可选 `creation_form` 属性用于描述和选模板，可在 GUI 扩展，字段可写性仍只由 `applicable_kinds` 决定。
     - 八种实体共用分区编辑器：基本信息、按结构声明出现的归属与收录、附加信息、图片与标识、关系、说明与来源。切换分区保留同一份草稿，字段布局模板与搜索入口位于附加信息；保存前定位缺失标题或证据，图片上传期间禁用保存。已有条目的关系逐条独立保存，新条目的关系在创建成功后提交，界面明确标注此边界。
     - 对比页有显式 `ids` 时以 URL 清单为准，否则直接使用共享篮子状态；恢复缓存不得在空清单与已选清单之间相互回写。单个已选条目也回读题名和封面，加载或不可用时显示本地化提示，不以 UUID 作为题名。
     - 支持全量实体的内容元数据编辑与状态流转（`draft` / `pending_review` / `published` / `deleted` / `merged` 五档）、实体合并（Merge）与修订历史（Revisions）审计。
       状态口径：发布 = PUT 实体写 `status: "published"`；`/api/catalog/entities/:id/lifecycle` 只做合并与停用（请求体无 `action` 字段）。
   - **无多余 Slogan**：全站禁止添加各类夸张、冗余的营销 Slogan，保持国家图书馆级别的严谨、纯净与高效。

2. **外围解耦系统**：
   - **账号系统 (Auth)**：独立微服务体系，支持 OAuth2 / OIDC 标准 SSO；前端通过顶栏或操作拦截跳转统一账号中心（默认 `/account` 或外部 `https://auth.findverse.cc`），本地仅保留无状态 JWT 验签。
   - **社区论坛 (Community)**：独立社区服务，仅通过实体 UUID 单向引用元数据实体；在实体详情页内嵌轻量展示对应条目的短评讨论流与收录合集，深层论坛互动提供直达入口。
   - **资源存储与下载中心 (Storage / Downloads)**：独立资产服务（S3 CAS 去重 + 校验 + 配额），元数据核心绝不反向存储文件物理路径；前端通过顶栏导航（`/downloads`）以及详情页侧边栏快捷卡片提供跳转入口。

---

## 2. i18n 国际化与动态 Schema 驱动原则

1. **双轨多语言分工体系**：
   - **系统级固定前端字段**：全站界面按钮、表单占位符、状态标签、空状态提示等**必须严格通过前端 i18n 字典管理**（`frontend/src/messages/{zh-CN,zh-TW,ja-JP,en-US}.json`），禁止任何硬编码中文或英文，禁止中英文混杂。
   - **固定实体骨架（Agent, Collection, Work, ContentUnit, Expression, Release, Medium, Track）的名称属于领域名称**：
     服务端在 `GET /api/catalog/definitions` 的 `kinds` 字段给出四语名称（`catalog.KindNames()`），前端用 `getKindName()` 取；
     前端字典里的 `catalog.kind.*` 只作为"服务端未给"时的兜底，不得作为唯一来源。
   - **业务级动态元数据定义**：
     - 字段自身的适用 kind（`definitions.fields.<code>.applicable_kinds`）、可组合字段、场景方案与展示模板；实体不再声明业务 `types`，
     - 图谱关系（如 `adaptation_of` 改编自、`soundtrack_of` 配乐、`sequel_of` 续作、`performed_by` 表演者等）、
     - 动态属性与词表（如 `format` 载体格式、`packaging` 包装等）、
     - 必须**全部从服务端动态获取**（`GET /api/catalog/definitions`）。
     - 这些定义的名称在后台配置并保存多语言字典（`Names map[string]string`，含 `zh-CN` / `zh-TW` / `ja-JP` / `en-US` 四语，见下 §2.3）。
     - 前端展示时根据当前用户 `locale` 动态读取（`def.names[locale] || def.names['zh-CN'] || def.names['en-US'] || code`），**严禁前端写死方案或字典映射**。

2. **探索中心 (`/explore`) 规范**：
   - 实体骨架筛选器（Kinds）按结构化规范呈现，名称走服务端 `definitions.kinds`（四语）。
   - 描述性分类与主题筛选使用开放标签 `attributes.tags`；货架规则承担策展式收录。字段可写性按 `applicable_kinds`，不按标签或隐含媒体分类推断。

3. **命名四语铁律（无例外）**：
   - 任何"名称"（实体的 kind、字段、关系、词表项、模板、分区、货架）必须在 `zh-CN`、`zh-TW`、`ja-JP`、`en-US` 四语下都能取到真实译文；
     把英文填进 `zh-TW`/`ja-JP` 当占位属于未完成；新增名称一律用 `names4()` 显式给出四语。
   - 前端 `t(key) || "中文兜底"` 这类写法一律禁止；缺键要么补字典，要么走服务端多语言数据。

4. **货架、标签与字段适用范围的边界**：
   - 虚拟分类预设（`catalog.shelves`）是后台可配、名称四语的策展收录规则；规则中的 `query.tags` 按任一标签匹配，与其它规则条件取交集。开放标签（`attributes.tags`）表达作品类别、主题和其它描述性分类，可由来源或贡献者添加。迁移 000015 曾将当时作品的业务方案码一次性写入标签；这些是已有标签值，不再从字段或旧方案自动生成新标签。
   - 不得在代码或种子里另造固定分类标签清单，也不从字段方案自动复制标签。标签不决定实体 kind、结构归属或可写字段。
   - `definitions.fields.<code>.applicable_kinds` 是实体属性可用层级的唯一声明；空集合表示该字段只用于关系或内嵌结构，不可直接写进实体 `attributes`。同一字段可适用于多个 kind；界面按 kind 组合可写字段。列表角标仍显示 kind。关系的 `type` 是关系码、字段的 `type` 是值结构类型，均不属于已移除的实体业务 `types`。
   - 一次性迁移 `000016` 从旧定义中**包括停用项**的 `kinds × fields` 推导并集，删除实体与定义的业务 `types`，同时清除关系定义的 `source_types` / `target_types` 和方案的 `types`。不补“待分类”或其它类别；无法无损映射的历史字段和图片必须先修复对应 ID，再重跑迁移。切换后不提供旧 JSON 接口兼容读法。

---

## 3. 实体骨架与复杂媒体映射规则

| 固定实体 | 职责 | 可表达的实例示例（非业务类型） |
|---|---|---|
| **Agent (主体)** | 个人、组织、团体、虚构角色等身份 | 个人、组织、同人社团、声优、虚构角色 |
| **Collection (集合)** | 企划、系列及有序聚合，非独立作品本身 | 跨媒体企划（如 BanG Dream!）、小说系列 |
| **Work (作品)** | 独立创作身份与母体 | 歌曲、动画作品、完整专辑、写真集、独立游戏、轻小说 |
| **ContentUnit (内容单元)** | 作品内稳定的逻辑部分（同作品目录树） | 分集（第1话~第13话）、章节、篇、游戏路线 |
| **Expression (内容表达)** | 某一具体录音、正文、剪辑或创作版本 | 录音室母带音频、中文译文、BD 剪辑版视频 |
| **Release (发行版本)** | 有来源依据的公开产品或发布形态 | 通常盘、蓝光付限定盘、数字版、自费印刷版 |
| **Medium (载体)** | 发行中的物理/数字承载单元 | CD、Blu-ray Disc、黑胶 Vinyl、纸质册、数字集 |
| **Track (收录位置)** | 载体中的轨道、顺序与导航节点 | CD 轨道、光盘面、BD 章节、小说页码 |

`definitions.structure` 描述固定骨架的归属外键和收录入口；其字段、目标 kind、必填性、`subjects` 与 `contents` 必须与数据库约束一致。每条结构字段及两个收录入口的正反向名称由这份定义声明，后台可编辑；资源展示开关也可编辑且不改变归属事实。额外的八种实体间组合可在关系定义中声明端点、基数、无环性与聚合语义；新增骨架外键或收录容器则须先变更数据库与服务端契约。

层级关系按归属、定位、收录和语义区分，规则码、端点与约束须可查询；同一事实只允许一个权威存储来源。现有外键及收录表继续负责其已覆盖的结构，统一读取层可将它们与动态语义关系合并展示，但不得把旧边复制为另一套可编辑事实。只有带来源的真实样本证明现有结构无法表达某种合法的新关系时，才引入受约束的扩展边及相应的发布影响检查；详见[元数据身份与层级关系演进方案](./metadata-structure-evolution-plan.md)。

- **多版本专辑（通常盘 vs 限定盘）**：一个专辑 Work，建立多个 Release；限定盘 Release 下挂多个 Medium（CD 唱片 + 现场 Live 演唱会 BD 光盘）。
- **单曲与专辑多重收录**：单曲歌曲自身为 Work，其录音 Expression 被单曲 Release、专辑 Release 的不同 TrackContent 引用。
- **个人作品无门槛**：写真集、独立游戏、同人翻唱无需任何商业发行证明或文件上传即可独立建档。
