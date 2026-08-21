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

## 2. 项目上下文
- 技术栈：Go (backend) + Next.js (frontend) + Postgres + MinIO + FFmpeg Worker，`deploy/docker-compose.yml` 一键启动。
- 核心模型：LRM 混合 `Work / CanonicalEntry / Release / Medium / Track / AssetFile`，标签 + 虚拟货架为当前分类体系（Categories 已废弃）。
- 约束：详见 `C:\Users\QwQ\.zcode\cli\memories\projects\metafusion-38d133024429979f\memory\MEMORY.md` 索引的各项记忆（如 Archive Cosmos 设计规范、受控媒体访问、空状态优先等）。

## 3. 其他协作约定
- 保持代码风格与周边一致，注释仅解释代码无法自明的约束。
- 外发内容（发布到外部服务、删除/覆盖非自建文件）前需确认。
- 遇到阻塞（需要用户决策的破坏性操作或范围变更）时停下并说明原因，而非猜测继续。
