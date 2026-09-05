# AGENTS — MetaFusion 项目协作指南

本文件适用于本仓库；进入子目录前检查更具体的 `AGENTS.md`。规则冲突时遵循上级平台指令、用户明确要求和相应目录规则，不把旧文档当作运行时事实。

## 1. 协作与任务边界

- 使用中文回复；不使用 CodeTool MCP。
- 开始前运行 `git status --short --branch`，确认当前分支和已有改动。只处理本任务文件，不覆盖、暂存、回滚或提交他人的改动；禁止为获得干净工作区而自动执行 reset、clean 或 stash。
- 先定位代码、契约与相关规则，再做最小必要修改。代码开发、只读编目审查和对实例的数据写入是不同任务；修改教程不代表获准操作真实目录。
- 未获明确授权，不推送、发布、部署、写入远程实例，或删除/覆盖用户数据。存在破坏性操作、实体身份歧义或范围变化时，暂停相关操作并说明原因；不阻塞无关的安全工作。
- 不读取或输出与任务无关的 `.env`、密钥、PAT、数据库导出；示例使用占位符，凭证从环境变量读取，不能进日志、文档或提交。

## 2. Git 工作流：每个逻辑单元校验后立即提交

1. 每完成一个可独立验证的功能、修复或文档更新，先完成对应检查，再立即 `git commit`；不要把多个已完成单元积压到最后。一个单元可以包含相互依赖的多个文件，不要求每次保存文件都提交。
2. 批量重命名、格式化等机械变更单独提交，不混入逻辑变更。
3. 提交前查看 `git status` 和本任务 diff，按明确路径暂存，再检查 `git diff --cached --check` 与 `git diff --cached`。不要用 `git add .` 捎带无关修改；已有非本任务暂存内容时先停下协调。
4. 使用 Conventional Commits（`feat/fix/chore/docs/style/refactor/test/build`），首行少于 72 字符。保持近期提交风格；用户可见文案优先中文。
5. 默认在当前分支提交。真正的新功能从 `main` 建功能分支（默认 `codex/` 前缀），但不得为切分支丢弃已有改动。未经明确授权不 force push；获准推送时先确认远端状态。
6. 检查失败时区分本次引入的问题与既有/环境问题；修复本次问题，无法验证的项目明确报告，不以“已通过”替代。提交后再次确认工作区范围。

## 3. 项目导航与事实来源

MetaFusion 是类似 MusicBrainz / Bangumi 的开放元数据目录与受控资源分享站，不是通用知识库。

| 任务 | 优先入口 |
| --- | --- |
| 后端 API / 数据模型 | `backend/cmd/server/routes_catalog.go`、`backend/internal/catalog/`、`backend/internal/models/` |
| 数据库与完整性约束 | `backend/migrations/`；只把已执行迁移视为目标实例能力 |
| 前端与国际化 | `frontend/src/`、`frontend/src/messages/{zh-CN,en-US}.json`、[i18n 规则](.cursor/rules/i18n-localization-strict.mdc) |
| 插件与解耦 | `backend/internal/plugin/`、[插件架构](docs/architecture/plugin-decoupling-blueprint.md) |
| 部署与 CI | `deploy/docker-compose.yml`、`.github/workflows/ci.yml` |
| 用户 / LLM 编辑教程 | [Agent 接入](docs-site/docs/agent-integration.md)、[Agent API](docs-site/docs/api-agent.md) |

技术栈：Go + Next.js / Bun + PostgreSQL + Redis + RustFS（S3）+ OpenSearch 2.x + FFmpeg Worker。

涉及 API 或数据行为时，对照目标实例响应、实际处理器及已执行迁移，再核对 OpenAPI、技能与文档。发生矛盾时记录差异，暂停依赖该能力的写入；不能只改文案来掩盖实现缺口。接口变化应同步 OpenAPI、相关教程和技能契约，避免另造一套字段或枚举。

## 4. 编目技能与数据不变量

### 技能入口

数据编目、实体创建/修改、导入、合并和审核必须读取独立技能仓库 [MoeclubM/metafusion-skills](https://github.com/MoeclubM/metafusion-skills) 的两个入口：

- [metafusion-curator](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/metafusion-curator/SKILL.md)：操作流程、证据、API 写入与回读。
- [lrm-catalog-standards](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/lrm-catalog-standards/SKILL.md)：实体边界、发行版命名与内容复用。

优先使用已经安装的技能；可从同级 `../metafusion-skills/skills/` 读取源码，或将两个技能目录一起安装到 `.cursor/skills/`。主仓库并不保证已经安装技能。不要把整个技能仓库误放成单个技能，也不要同时维护多份规范；修改技能源码时在其独立仓库检查并提交。技能不可读时，先报告缺失，暂停真实编目写入；普通代码/文档任务不因此要求安装技能。

### 必须保持的边界

- `Work → CanonicalEntry` 是创作母体与可复用表达/母版/篇目的关系；`Work → Release → Medium → Track → TrackContent` 表达发行承载，TrackContent 引用 CanonicalEntry。AssetFile 独立承载文件、哈希与绑定。
- Work 保持纯净题名；季数、卷号、载体、规格、包装等放到适当层级。先按来源判断独立创作身份，不机械删去本就是正式题名一部分的词；不为凑齐层级虚构发行、容器或目录。
- CanonicalEntry 的父子关系只能在同一 Work 内；Medium / Track 的父子关系不能跨所属 Release / Medium。当前 `000006_carrier_content_integrity` 要求 Track 及其内容与 Release 属于同一 Work；多作品盒装若缺少显式汇编模型，报告缺口，不用 SQL 或伪造 Work 绕过。
- 无 `media_type` 传统树状分类；通过标签、虚拟货架、Release 规格和实体图谱表达。关系、角色、介质格式等代码从 taxonomy / relation-types 及实现取得，不凭显示文案猜枚举。
- `adaptation_of`、`soundtrack_of`、`sequel_of`、`spin_off_of` 等关系连接已有实体。需要层级/无环语义的关系拒绝自环和循环；同一角色跨作品用多条 `character_in` 边，不拆重复主体。
- 外围抓取、导出、通知、媒体分析与 AI 增强保持插件化；依赖按 Semver 与 DAG 治理，保留循环检测和级联启停保护，不塞进核心实体层。

### 国际化、封面与审计

- UI 文案必须通过 `useI18n()` 与中英字典管理，两种语言键同步；禁止硬编码文案或 `t(key) || "中文兜底"`。动态术语使用已有多语言数据和 helper。
- Work / Artist / Franchise 翻译使用数组；字段以各实体实际 DTO 为准。当前 `000007_translation_aliases` 支持每个语种一个主标题及 `aliases`；原语言标题归属对应翻译行，不能把其他语种题名全塞进实体级 aliases。载体及 CanonicalEntry 的翻译是按 locale 分组的 JSON 对象，不能照搬数组。
- 展示回退遵循请求语言 → en-US → original_language → 基础字段/系统兜底；读取和写入字段分离，不能把 `localized_*` 展示值回写为基础值。
- 封面优先使用可考据的官方/授权图片，保留自然比例、不拉伸，不使用风景占位图。音乐 1:1、影视/动画 2:3、书籍 3:4 是常用展示建议；`cover_aspect` 实际支持值以接口为准，不把建议写成不存在的服务端拒绝规则。
- 每次编目变更准备具体 `edit_note` 与相关 `source_urls`，目标是可追溯修订。不能宣称所有端点已强制证据、完整审计或 ACID 事务；当前 Work 创建、通用关系与兼容 `/catalog/submit` 有不同边界，按技能契约核实。缺少所需审计能力时报告缺口，禁止直接改数据库绕过。
- PUT 不等于局部 PATCH。先读取完整实体，按写入 DTO 保留无关字段；翻译、标签和 Track contents 可能整组替换。写后回读目标、关联与 revisions，并检查未请求修改的数据未丢失；响应不明时先核对状态，不盲重试创建或自动删除已成功的数据。

## 5. 按改动范围验证

以下命令分别在“目录”列指定位置运行；项目版本与依赖以 manifest 和 CI 为准。只读调查无需为此启动整套服务。

| 改动范围 | 目录 | 必要检查 |
| --- | --- | --- |
| 后端 | `backend/` | `go test ./...`、`go vet ./...`、`go build ./cmd/server ./cmd/worker ./cmd/migrate` |
| 前端 | `frontend/` | `bunx tsc --noEmit`、`bun run build`；涉及 UI 时检查中英显示 |
| 文档站 | `docs-site/` | `bun run build`；核对示例字段、路由和链接 |
| Compose | 仓库根目录 | `docker compose -f deploy/docker-compose.yml config --quiet`；不要输出展开后的密钥 |
| AGENTS / 技能 | 所属仓库 | 检查路径、Markdown/代码块、契约一致性；有技能验证器或脚本测试时运行 |

不要为了验证文档而执行导入、清库、数据库迁移或线上写入脚本。保持周边代码风格，注释解释约束而不复述代码。交付时简述改动、验证结果、未完成事项和提交号，明确是否进行了远程操作。
