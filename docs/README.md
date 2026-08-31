# MetaFusion 文档索引

本目录是项目内部文档入口。三层文档体系分工如下：

| 目录 / 文件 | 定位 | 读者 |
|---|---|---|
| [`requirements.md`](requirements.md) | 产品需求文档（PRD）：可见性边界、邀请制风控、功能需求与验收标准 | 产品 / 开发 |
| [`architecture/plugin-decoupling-blueprint.md`](architecture/plugin-decoupling-blueprint.md) | 插件 DAG 依赖治理蓝图：Semver 约束、拓扑排序、级联启停 | 开发 |
| [`../docs-site/`](../docs-site/) | 面向公众的文档站（VitePress）：LRM 模型、编目指南、API 全套文档、法务页 | 所有人 |
| [`../AGENTS.md`](../AGENTS.md) | Agent / 贡献者协作准则（Git 规范、编目最高准则） | AI Agent / 贡献者 |
| [metafusion-skills](https://github.com/MoeclubM/metafusion-skills) | 编目标准技能独立仓库（metafusion-curator + lrm-catalog-standards） | AI Agent |

## 架构速览（当前口径）

- **LRM 五层模型**：`Work → CanonicalEntry (Expression) → Release (Manifestation) → Medium / Track → AssetFile`；详见 docs-site [frbr-model](../docs-site/docs/frbr-model.md)。
- **分类法**：实体类型（`entity_type_definitions`）与关系类型（`relation_types`）全部数据库字典化、后台可配；标签（tags）+ 虚拟货架（virtual_shelves）承担分类；旧 `categories` / `media_type` 硬分类已移除。
- **图谱**：实体间关系一律 `entity_relationships` 有向边（DAG，层级边写时环检测）；作品署名（credits）单一事实源即图边，`work_artist_relations` 旧表已退役为只读兼容投影。
- **存储**：物理资产经 `asset_registry` / `asset_bindings`（CAS）与元数据解耦。
- **部署**：`deploy/docker-compose.yml` 一键启动；init_db SQL 仅在空卷首次启动执行。

## 维护约定

- 文档与代码同 PR 更新；架构口径变化先改本文档速览与 docs-site 对应页。
- docs-site 待办：`ignoreDeadLinks` 当前为 true（死链不暴露），建议尽快收紧为 false 并修复存量断链。
