# MetaFusion 规范驱动开发需求与架构基准 (Spec-Driven Requirements & Architecture Baseline)

> **重要约束**：本文档为用户明确下达的核心架构与产品规范。所有后续开发、修改、重构与会话压缩恢复均以此规范为唯一权威依据，严防需求丢失导致目标偏移。

---

## 1. 核心架构与系统边界

1. **元数据主系统（一体化核心）**：
   - **涵盖范围**：首页分类货架（`/`）、全域探索中心（`/explore`）、实体详情展示（`/catalog/[id]`）、实体编辑器/创建器（`/new`）、多版本对比工具（`/compare`）、以及共用同一数据库的后台管理系统（`/admin`）。
   - **后台管理系统**：
     - 与元数据主系统共用同一 PostgreSQL 数据库（`catalog` schema）。
     - 支持在后台 GUI 中完整定义与管理动态元数据架构：动态类型（Types）、字段定义（Fields）、图谱关系（Relations）、受控词表（Vocabularies）、展示模板（Templates）。
     - 支持全量实体的内容元数据编辑、生命周期审核（草稿/审核/发布/归档/删除）、实体合并（Merge）与修订历史（Revisions）审计。
   - **无多余 Slogan**：全站禁止添加各类夸张、冗余的营销 Slogan，保持国家图书馆级别的严谨、纯净与高效。

2. **外围解耦系统**：
   - **账号系统 (Auth)**：独立微服务体系，支持 OAuth2 / OIDC 标准 SSO；前端通过顶栏或操作拦截跳转统一账号中心（默认 `/account` 或外部 `https://auth.findverse.cc`），本地仅保留无状态 JWT 验签。
   - **社区论坛 (Community)**：独立社区服务，仅通过实体 UUID 单向引用元数据实体；在实体详情页内嵌轻量展示对应条目的短评讨论流与收录合集，深层论坛互动提供直达入口。
   - **资源存储与下载中心 (Storage / Downloads)**：独立资产服务（S3 CAS 去重 + 校验 + 配额），元数据核心绝不反向存储文件物理路径；前端通过顶栏导航（`/downloads`）以及详情页侧边栏快捷卡片提供跳转入口。

---

## 2. i18n 国际化与动态 Schema 驱动原则

1. **双轨多语言分工体系**：
   - **系统级固定前端字段**：全站界面按钮、表单占位符、固定实体骨架（Agent, Collection, Work, ContentUnit, Expression, Release, Medium, Track）、状态标签、空状态提示等，**必须严格通过前端 i18n 字典管理**（`frontend/src/messages/zh-CN.json` 与 `en-US.json`），禁止任何硬编码中文或英文，禁止中英文混杂。
   - **业务级动态元数据定义**：
     - 动态类型（如 `animation` 动画、`novel` 小说、`album` 专辑、`indie_game` 独立游戏、`photobook` 写真集等）、
     - 图谱关系（如 `adaptation_of` 改编自、`soundtrack_of` 配乐、`sequel_of` 续作、`performed_by` 表演者等）、
     - 动态属性与词表（如 `format` 载体格式、`packaging` 包装等）、
     - 必须**全部从服务端动态获取**（`GET /api/catalog/definitions`）。
     - 这些定义的名称在后台配置并保存多语言字典（`Names map[string]string`，含 `zh-CN` 与 `en-US`）。
     - 前端展示时根据当前用户 `locale` 动态读取（`def.names[locale] || def.names['zh-CN'] || def.names['en-US'] || code`），**严禁前端写死类型或字典映射**。

2. **探索中心 (`/explore`) 规范**：
   - 实体骨架筛选器（Kinds）按结构化规范呈现，多语言文本走前端字典。
   - 类型筛选器（Types）完全基于当前选中 Kind 从服务端 `definitions.types` 动态计算，分类标签由服务端 `typeDef.names[locale]` 直出，保证后台新增类型无需发版即可在前端自动生效并正确本地化。

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

- **多版本专辑（通常盘 vs 限定盘）**：一个专辑 Work，建立多个 Release；限定盘 Release 下挂多个 Medium（CD 唱片 + 现场 Live 演唱会 BD 光盘）。
- **单曲与专辑多重收录**：单曲歌曲自身为 Work，其录音 Expression 被单曲 Release、专辑 Release 的不同 TrackContent 引用。
- **个人作品无门槛**：写真集、独立游戏、同人翻唱无需任何商业发行证明或文件上传即可独立建档。