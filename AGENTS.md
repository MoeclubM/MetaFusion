# AGENTS — MetaFusion 项目协作指南

本文件面向在本仓库中工作的所有 Agent（人类与 AI）。所有规则以本文件为准，未列出的按仓库现有约定执行。

## 1. Git 工作流 — 操作后必提交

> **核心规则：任何文件操作（新增/修改/删除/重构/配置变更）完成后，必须立即执行 `git commit`，不得累积到最后。**

### 1.1 何时提交
- 每完成一个逻辑单元就提交一次（一个功能、一个修复、一个文档更新即一次提交）。
- 批量重命名/格式化等机械变更单独提交，不与逻辑变更混在一起。
- Agent 连续多步操作时，每步结束即提交；不要等待用户提醒。

### 1.2 提交信息规范
- 使用 Conventional Commits：`feat/fix/chore/docs/style/refactor/test/build` 前缀。
- 首行简短（< 72 字符），必要时空一行后写正文说明动机与影响。
- 中文或英文均可，保持与近期 `git log` 风格一致；涉及用户可见文案变更时优先中文。

### 1.3 提交前检查
- `git status` 确认变更范围，仅提交与本次任务相关的文件（避免把无关的 `M`/`??` 误带入）。
- `git diff --cached` 复核内容，确保无敏感信息（`.env`、密钥、token）。
- 若变更触及 `frontend/` 或 `backend/`，本地跑通 `build` / `go vet` / 相关测试再提交。

### 1.4 分支与推送
- 默认在当前分支提交；需要新功能时从 `main` 新建分支，PR 合并回 `main`。
- 未获用户明确授权不执行 `git push --force`；推送前确认远端状态。

## 2. 项目上下文与实体编目最高准则 (Supreme Cataloging Standards)
- **核心标准 Skill**：所有涉及数据编目、实体创建、数据导入、审核巡检与修改的 AI Agent，必须严格执行 [metafusion-curator](.cursor/skills/metafusion-curator/SKILL.md) 与 [lrm-catalog-standards](.cursor/skills/lrm-catalog-standards/SKILL.md)。
- **全栈多语言与国际化零硬编码铁律**：所有 UI 文本与存储实体数据必须具备多语言能力。前端严禁硬编码任何中英文文案，必须通过 `frontend/src/messages/{zh-CN,en-US}.json` 字典与 `useI18n()` 统一管理；实体数据通过 `work_translations`/`artist_translations`/`franchise_translations` 或 `JSONB` 多语言映射持久化，严格遵循多语言回退链（User Locale -> en-US -> original_language -> Default）。详见 `.cursor/rules/i18n-localization-strict.mdc`。
- **技术栈**：Go (backend) + Next.js (frontend) + Postgres + RustFS (S3 兼容对象存储) + OpenSearch 2.x + FFmpeg Worker，`deploy/docker-compose.yml` 一键启动。
- **核心模型**：LRM 混合 `Work / CanonicalEntry / Release / Medium / Track / AssetFile`，实体必须保持纯净标题（Work 严禁混入季数/载体/规格），通过「标签 + 虚拟货架 + Release 规格 + 实体图谱边」自然表达，无 `media_type`（传统树状分类与硬编码形态已完全废弃）。
- **插件架构与解耦治理**：核心实体层保持纯粹，外围抓取（Importers）、格式导出（Exporters）、通知外发（Notifiers）、媒体分析与 AI 增强全面采用插件化与 DAG 拓扑依赖治理（支持 Semver 约束、循环依赖检测与级联启停保护）。详见 [`docs/architecture/plugin-decoupling-blueprint.md`](docs/architecture/plugin-decoupling-blueprint.md)。
- **实体图谱与拓扑**：通过 `adaptation_of`、`soundtrack_of`、`sequel_of`、`spin_off_of` 组织有向无环图谱（DAG），严禁循环边与自环；跨作品登场通过多条 `character_in` 边连接，严禁分裂实体。
- **封面与多语言**：封面支持自适应自然宽高比与强制 `cover_aspect`（音乐 1:1、影视/动画 2:3、书籍 3:4），严禁风景图与占位图；多语言题名与简介基于 `work_translations` 本地化回退链。
- **不可篡改审计流**：每次写操作必须附带 `source_urls`（权威考据源）与 `edit_note`（编辑动机说明），生成不可篡改版本快照。
- **约束**：详见 `C:\Users\QwQ\.zcode\cli\memories\projects\metafusion-38d133024429979f\memory\MEMORY.md` 索引的各项记忆（如 Archive Cosmos 设计规范、受控媒体访问、空状态优先等）。

## 3. 其他协作约定
- 保持代码风格与周边一致，注释仅解释代码无法自明的约束。
- 外发内容（发布到外部服务、删除/覆盖非自建文件）前需确认。
- 遇到阻塞（需要用户决策的破坏性操作或范围变更）时停下并说明原因，而非猜测继续。
