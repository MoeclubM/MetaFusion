---
name: metafusion-dev
description: MetaFusion 项目级开发约定：docs-local 维护、提交纪律、开发规范、多语言约定。在本仓库改代码、文档、部署前先读。
---

# MetaFusion 项目开发技能

本仓库的工作约定，适用于改代码、改文档、改部署的任务。
与 `AGENTS.md` 冲突时以更具体的一方为准；与用户当次指令冲突时以用户指令为准。

## 1. 本地开发日志（`docs-local/`）

`docs-local/` 被 `.gitignore` 排除，**永不提交**，只放"下一次接手的人必须知道"的信息：

| 文件 | 内容 |
| --- | --- |
| `docs-local/README.md` | 目录用途与规则 |
| `docs-local/dev-log.md` | 阶段判断、关键决定、已踩过的坑（倒序） |
| `docs-local/deploy/server-connection.md` | 开发服务器、部署目录、操作注意事项 |
| `docs-local/deploy/paths.md` | 主工程与各子项目路径、一键部署入口 |

任务开始时读一遍（目录不存在按上表创建即可）；结束前把涉及部署、路径、服务器约定、阶段变化的新信息写回。
判断标准：对下一次接手有用就写，操作流水不写。
涉及账号 / 互动 / 存储 / 网关 / 文档时，先到 `docs-local/deploy/paths.md` 查兄弟仓库（`../metafusion-*`）的位置，确认改动归属再下手。

凭据：口令、私钥、PAT 一律不复制进仓库，只记"到哪里取"并写明来源路径。

## 2. 提交与验证（细节见 `AGENTS.md` §2 / §5）

- 一个逻辑单元一提交；机械重命名/格式化单独提交，不混入逻辑变更。
- Conventional Commits，首行 < 72 字符，风格与近期 `git log` 一致。
- 只 `add` 本次任务相关文件；提交前 `git status` + `git diff --cached --check`，确认无敏感信息、无无关改动。
- 改到哪验到哪，命令见 `AGENTS.md` §5（后端 `go build/vet/test`、前端 `tsc` 与构建、Compose 走 CI 的 `compose-lint`，本地不跑 docker）。
- 默认不 push、不 amend 他人提交；`main`/`master` 不 force push；push 需用户明确要求。

## 3. 开发规范

1. 注释只写"为什么/约束是什么"，不复述代码；踩过的坑写成一行原因。
2. 单文件接近 500 行考虑按职责拆分；别在已过长的文件上继续堆。
3. 互不依赖的多模块改动可以用并行子代理推进；子代理任务要自包含，并注明别碰他人的未提交改动。
4. 接口、行为、部署方式变化时，同批次更新文档（独立文档仓库 `../metafusion-docs`、相关 README、OpenAPI 描述）；文档以代码实际行为为准，不符时改文档并在提交信息里说明。

## 4. 多语言约定

- 用户可见文案走 `useI18n()` 的 `t()` 加四语字典（zh-CN / en-US / zh-TW / ja-JP）同步增补；不写死文案，不用中文兜底。
- 动态术语（实体/关系类型、词表项、字段名）来自服务端 definitions，用现成 helper 解析。
- 实体翻译在统一 DTO 的 `translations`（按 locale 分组的对象）里；原语言题名归对应翻译行。展示回退链与读写分离见 `AGENTS.md` §4。

## 5. 项目边界

开放的多媒体元数据共建库 + 受控资源分发站（类似 MusicBrainz / Bangumi，不是通用知识库）。
实体骨架、关系约束、架构细节见 `AGENTS.md`（规范驱动、运行时说明、编目边界），这里只记两条行为：

- 类型/关系/字段由 definitions 驱动，不把能力写死在代码里；
- 结论要证据：能跑测试就写测试，跑不了就写"未验证"，不拿"编译通过"当验证。
