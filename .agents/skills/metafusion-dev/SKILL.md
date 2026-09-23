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
| `docs-local/deploy/runbook.md` | 线上部署步骤与实例状态 |
| `docs-local/reports/` | 一次性执行报告 |

按 `AGENTS.md` §0 阅读相关记录；目录不存在时按上表创建。仅在产生对下一次接手有用的新环境事实、阶段判断或已知坑时更新，操作流水不记。
涉及账号 / 互动 / 存储 / 网关 / 文档时，先到 `docs-local/deploy/paths.md` 查兄弟仓库（`../metafusion-*`）的位置，确认改动归属再下手。

真实凭据不进 git 追踪文件；本地 Agent 可使用已忽略的 `local/credentials.json`，令牌值不进入对话、日志、报告或提交。

## 2. 提交、验证与多语言

按 `AGENTS.md` §2、§4、§5 执行；不在技能中维护第二份命令、提交或多语言规则。

## 3. 开发规范

1. 注释只写"为什么/约束是什么"，不复述代码；踩过的坑写成一行原因。
2. 单文件接近 500 行考虑按职责拆分；别在已过长的文件上继续堆。
3. 接口、行为、部署方式变化时，同批次更新文档站、相关 README 和 OpenAPI；文档以代码实际行为为准。
4. 正文只写当前约束与用法；值得保留的决策和坑记录到 `docs-local/dev-log.md`。
5. 结论注明验证证据与限制；编译通过不等于行为已验证。
