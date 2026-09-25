# AGENTS — MetaFusion 项目协作指南

本文件适用于本仓库；进入子目录前检查更具体的 `AGENTS.md`。规则冲突时遵循上级平台指令、用户明确要求和相应目录规则，不把旧文档当作运行时事实。

## 0. 本地记录

- `docs-local/` 是不进 git 的本机记录。按任务需要读取；仅在产生可复用的路径、部署信息、阶段决定或已知坑时更新，不记录操作流水。
- 真实凭据不进版本库、日志或对话；本机可使用已忽略的专用凭据文件。

## 1. 协作与任务边界

- 使用中文回复。开始前用 `git status --short --branch` 了解现状；保留用户和他人改动，不为获得干净工作区而 reset / clean / stash。
- 先定位代码、契约与相关规则，再做最小必要修改。可并行且互不依赖的工作可交给子代理；代码开发、只读审查、真实数据写入仍是不同任务。
- 未获明确授权，不推送、发布、部署、写入远程实例或删改用户数据；范围变化、破坏性操作或身份歧义先说明。
- 不输出无关的 `.env`、密钥、PAT 或数据库导出。

## 2. Git 工作流

- 校验后按内聚的逻辑变更提交，避免把无关或未验证改动混在一起。
- 按明确路径暂存并检查 staged diff；暂存区已有内容时确认归属，只提交本任务文件。
- 提交信息采用 Conventional Commits 并遵循近期风格。需要新分支时从合适基线创建；未经授权不 force push。
- 检查失败时区分本次引入与既有/环境问题，只修本次问题；无法验证的内容在交付中说明。

## 架构基准与运行时

规范见 [架构基准](docs/architecture/spec-driven-requirements.md)：元数据主系统共用数据库一体化运行，类型/关系/字段走服务端 definitions 动态加载与多语言解析，外围论坛与存储独立解耦。不硬编码文案，不写夸张 Slogan。

统一入口 `/api`（实现 `backend/internal/catalog`），前端详情路由 `/works`、`/releases`、`/mediums`，兜底 `/catalog/[id]`。固定实体骨架（Agent、Collection、Work、ContentUnit、Expression、Release、Medium、Track）+ Release.subjects + 跨 Work TrackContent；见 [元数据目录教程](https://github.com/MoeclubM/metafusion-docs/blob/main/docs/catalog.md)。

## 3. 项目导航与事实来源

MetaFusion 是类似 MusicBrainz / Bangumi 的开放元数据目录与受控资源分享站，不是通用知识库。

| 任务 | 优先入口 |
| --- | --- |
| 后端 API / 数据模型 | `backend/internal/catalog/`（统一入口 `/api`，路由见 `http.go:Register`） |
| 数据库与完整性约束 | `backend/migrations/*.sql` 是目录库结构迁移源，使用 `mf-migrate up` 显式执行；空库内容种子使用 `mf-migrate seed`，HTTP 服务启动只做兼容性只读检查；复合外键与校验逻辑见 `backend/internal/catalog/store.go`，只把已执行迁移视为目标实例能力 |
| 前端与国际化 | `frontend/src/`、`frontend/src/messages/{zh-CN,en-US,zh-TW,ja-JP}.json` |
| 子系统边界与迁移 | [子系统拆分与迁移契约](docs/architecture/service-split-migration.md)、[切流手册](docs/architecture/cutover-runbook.md)、[资源存储运行约定](docs/architecture/storage-operations.md)；账号 / 互动 / 存储分别在 `../metafusion-auth`、`../metafusion-community`、`../metafusion-storage` |
| 解耦审计与整改路线 | [多项目解耦审计与优化建议](docs/architecture/decoupling-audit-2026-09.md)：耦合分级证据、目标架构（每服务自带 UI、协议层 SDK、网关矩阵单源）与 B0–B6 分批 |
| 部署与 CI | `deploy/docker-compose.yml`、`.github/workflows/ci.yml` |
| 用户 / LLM 编辑教程 | [Agent 接入](../metafusion-docs/docs/agent-integration.md)、[Agent API](../metafusion-docs/docs/api-agent.md)（文档站是独立仓库 `metafusion-docs`） |

技术栈：Go + Next.js / Bun + PostgreSQL + Redis + RustFS（S3）+ OpenSearch 2.x。

涉及 API 或数据行为时，以目标实例响应 + 实际处理器 + 已执行迁移为准；有矛盾记差异、停掉依赖写入，不改文案掩盖。接口或外部行为变化时，只同步直接受影响的 OpenAPI、教程与技能契约。

## 4. 编目技能与数据不变量

### 技能入口

编目（实体创建/修改、导入、合并、审核）先读独立技能仓库 [MoeclubM/metafusion-skills](https://github.com/MoeclubM/metafusion-skills)：

- [metafusion-curator](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/metafusion-curator/SKILL.md)：流程、证据、API 写入与回读。
- [lrm-catalog-standards](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/lrm-catalog-standards/SKILL.md)：实体边界、发行版命名、内容复用。

优先用已安装技能，或读同级 `../metafusion-skills/skills/` 源码；改技能源码去它自己的仓库提交。技能不可读先报告缺失、停真实编目写入；纯代码/文档任务不受影响。

### 必须保持的边界

- 层级：`Work → ContentUnit → Expression`（创作母体/内容单元/表达）；`Work → Release → Medium → Track → TrackContent`（发行承载，TrackContent 引用 Expression）；AssetFile 独立存文件、哈希与绑定。
- Work 只留纯净题名，季/卷/载体/规格放对应层级；不删正式题名里的词，不虚构层级凑数。
- ContentUnit 父子限同一 Work；Medium / Track 不跨所属 Release / Medium（复合外键保证）。跨 Work 收录走 `Release.subjects`（`undeclared_release_subject` 校验）；缺汇编模型报缺口，不绕库。
- 无 `media_type` 树状分类，用标签/虚拟货架/Release 规格/实体图谱表达；关系、角色、介质格式等代码以 taxonomy 与实现为准。
- 关系连已有实体，可用码以 `defaults.go` 种子和 `/api/catalog/definitions` 为准；层级/无环关系拒自环与循环；同一角色跨作品用多条 `character_in`。
- 外围能力（抓取/导出/通知/AI）插件化，不进核心实体层。
- **不做转码**：存储只收原始文件、按权限分发（见 [资源上传与下载](https://github.com/MoeclubM/metafusion-docs/blob/main/docs/upload-download.md)）。

### 国际化、封面与审计

- UI 文案走 `useI18n()` + 四语字典同步，不硬编码、不用中文兜底；动态术语用 definitions 多语言字段和现成 helper。
- 实体翻译在统一 DTO 的 `translations`（按 locale 分组，每语种 `title / summary / aliases`）；原语言题名归对应翻译行，不塞实体级 `aliases`。
- 回退链：请求语言 → en-US → original_language → 基础字段；读写字段分离，展示值不回写。
- 封面用可考据官方/授权图，不拉伸、不用风景占位；比例只是展示建议（音乐 1:1、影视 2:3、书籍 3:4），**不是可写字段**——`attributes` 里写未声明的键会被 `unknown_field` 拒，导入载荷里的 `release.cover_aspect` 同样被拒（比例不落库）。
- 每次编目变更带 `edit_note` + `sources`（写入体字段名是 `sources`，每项含 `kind` ∈ url/publication/self 与必填 `citation`）；不宣称全端点强制证据/审计/ACID，按技能契约核实，缺能力报缺口、不绕库。
- PUT 非 PATCH：先读全量再写，翻译/标签/Track contents 可能整组替换；写后回读，响应不明先核对状态、不盲重试。

## 5. 按改动范围验证

根据改动范围和风险选择必要检查；命令在“目录”列位置运行，版本以 manifest 和 CI 为准。

| 改动范围 | 目录 | 参考检查 |
| --- | --- | --- |
| 后端 | `backend/` | `go test ./...`、`go vet ./...`、`go build ./cmd/server ./cmd/migrate` |
| 前端 | `frontend/` | `bunx tsc --noEmit`、`bun run build`；UI 改动看中英显示 |
| 文档站 | `../metafusion-docs/`（独立仓库） | `bun run build`；核侧栏与示例字段；改完那边提交 |
| Compose | 仓库根目录 | `docker compose -f deploy/docker-compose.yml config --quiet`；不输出密钥 |
| AGENTS / 技能 | 所属仓库 | 路径、Markdown、契约一致；有验证器就跑 |

文档任务不连带导入、清库、迁移或线上写入。无法运行某项检查时，说明原因和未覆盖风险；交付讲清改动、验证、未完成项、提交号，以及是否动过远程。
