# MetaFusion 规范驱动开发需求与架构基准 (Spec-Driven Requirements & Architecture Baseline)

> **重要约束**：本文档为用户明确下达的核心架构与产品规范，后续开发、修改与重构均以此为准。
>
> **实现现状差异（2026-09-26 复核）**：§1.1 的生命周期词表在实现中是 `draft / pending_review / published / deleted / merged`——没有「归档」，多一个「合并」（`backend/internal/catalog/validation.go` 的状态闭集）。
>
> 另外两处是规范的表述比实现窄，不构成缺口：§2.1 的名称回退链在实现里是超集（在 zh-CN 之前插入了 zh-TW / ja，见 `frontend/src/lib/definitions.ts` 的 `resolveLocalizedName`）；§2.2 里「名称含 zh-CN 与 en-US」已按 §2.3 的命名四语铁律对齐。

---

## 1. 核心架构与系统边界

1. **元数据主系统（一体化核心）**：
   - **涵盖范围**：首页分类货架（`/`）、全域探索中心（`/explore`）、实体详情展示（正式路由 `/works`、`/releases`、`/mediums`，其余 kind 兜底 `/catalog/[id]`，见 `frontend/src/lib/entityRoutes.ts`）、实体编辑器/创建器（`/new`）、多版本对比工具（`/compare`）、站内通知（`/notifications`）、以及共用同一数据库的后台管理系统（`/admin`）。
   - **后台管理系统**：
     - 与元数据主系统共用同一 PostgreSQL 数据库（`catalog` schema）。
     - 支持在后台 GUI 中完整定义与管理动态元数据架构：动态类型（Types）、字段定义（Fields）、图谱关系（Relations）、受控词表（Vocabularies）、展示模板（Templates）。
     - 动态定义保存在 `catalog.definition_config` 的单份生效文档中。编辑器直接预检并保存完整文档，以 `etag` 防止并发覆盖；不保留定义版本、草稿、差异或回滚入口。
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
     - 元数据方案（当前沿用 API 的 `types` 字段；如 `animation`、`novel`、`album` 等，仅声明适用字段与展示模板，不作为必填分类）、
     - 图谱关系（如 `adaptation_of` 改编自、`soundtrack_of` 配乐、`sequel_of` 续作、`performed_by` 表演者等）、
     - 动态属性与词表（如 `format` 载体格式、`packaging` 包装等）、
     - 必须**全部从服务端动态获取**（`GET /api/catalog/definitions`）。
     - 这些定义的名称在后台配置并保存多语言字典（`Names map[string]string`，含 `zh-CN` / `zh-TW` / `ja-JP` / `en-US` 四语，见下 §2.3）。
     - 前端展示时根据当前用户 `locale` 动态读取（`def.names[locale] || def.names['zh-CN'] || def.names['en-US'] || code`），**严禁前端写死方案或字典映射**。

2. **探索中心 (`/explore`) 规范**：
   - 实体骨架筛选器（Kinds）按结构化规范呈现，名称走服务端 `definitions.kinds`（四语）。
   - 描述性分类与主题筛选使用开放标签 `attributes.tags`；货架规则承担策展式收录。`definitions.types` 仅用于字段方案，不能强制用户按预置媒体类型分类。

3. **命名四语铁律（无例外）**：
   - 任何"名称"（实体的 kind/type/字段/关系/词表项/模板/分区/货架）必须在 `zh-CN`、`zh-TW`、`ja-JP`、`en-US` 四语下都能取到真实译文；
     把英文填进 `zh-TW`/`ja-JP` 当占位属于未完成；新增名称一律用 `names4()` 显式给出四语。
   - 前端 `t(key) || "中文兜底"` 这类写法一律禁止；缺键要么补字典，要么走服务端多语言数据。

4. **货架、标签与字段方案的边界**：
   - 虚拟分类预设（`catalog.shelves`）是后台可配、名称四语的策展收录规则；规则中的 `query.tags` 按任一标签匹配，与其它规则条件取交集。开放标签（`attributes.tags`）表达作品类别、主题和其它描述性分类，可由来源或贡献者添加。预设不使用元数据方案 `types` 筛选。
   - 不得在代码或种子里另造固定分类标签清单，也不从字段方案自动复制标签。标签不决定实体 kind、结构归属或可写字段。
   - `definitions.types` 沿用既有 API 字段名，作为可选的元数据方案，控制字段白名单并引用展示模板。用户仅填写基础身份与标签时可以不选方案；填写扩展字段时选择适用方案。列表角标仍显示 kind。

---

## 3. 实体骨架与复杂媒体映射规则

| 固定实体 | 职责 | 动态类型示例 |
|---|---|---|
| **Agent (主体)** | 个人、组织、团体、虚构角色等身份 | 个人、组织、同人社团、声优、虚构角色 |
| **Collection (集合)** | 企划、系列及有序聚合，非独立作品本身 | 跨媒体企划（如 BanG Dream!）、小说系列 |
| **Work (作品)** | 独立创作身份与母体 | 歌曲、动画作品、完整专辑、写真集、独立游戏、轻小说 |
| **ContentUnit (内容单元)** | 作品内稳定的逻辑部分（同作品目录树） | 分集（第1话~第13话）、章节、篇、游戏路线 |
| **Expression (内容表达)** | 某一具体录音、正文、剪辑或创作版本 | 录音室母带音频、中文译文、BD 剪辑版视频 |
| **Release (发行版本)** | 有来源依据的公开产品或发布形态 | 通常盘、蓝光付限定盘、数字版、自费印刷版 |
| **Medium (载体)** | 发行中的物理/数字承载单元 | CD、Blu-ray Disc、黑胶 Vinyl、纸质册、数字集 |
| **Track (收录位置)** | 载体中的轨道、顺序与导航节点 | CD 轨道、光盘面、BD 章节、小说页码 |

`definitions.structure` 只描述固定骨架的归属外键和收录入口；其字段、目标 kind、必填性、`subjects` 与 `contents` 必须与数据库约束一致。后台 GUI 可扩展元数据方案、属性、词表、模板和实体关系；新增骨架外键或收录容器须先变更数据库与服务端契约。资源展示开关不改变结构归属。

层级关系按归属、定位、收录和语义区分，规则码、端点与约束须可查询；同一事实只允许一个权威存储来源。现有外键及收录表继续负责其已覆盖的结构，统一读取层可将它们与动态语义关系合并展示，但不得把旧边复制为另一套可编辑事实。只有带来源的真实样本证明现有结构无法表达某种合法的新关系时，才引入受约束的扩展边及相应的发布影响检查；详见[元数据身份与层级关系演进方案](./metadata-structure-evolution-plan.md)。

- **多版本专辑（通常盘 vs 限定盘）**：一个专辑 Work，建立多个 Release；限定盘 Release 下挂多个 Medium（CD 唱片 + 现场 Live 演唱会 BD 光盘）。
- **单曲与专辑多重收录**：单曲歌曲自身为 Work，其录音 Expression 被单曲 Release、专辑 Release 的不同 TrackContent 引用。
- **个人作品无门槛**：写真集、独立游戏、同人翻唱无需任何商业发行证明或文件上传即可独立建档。
