# 八项攻坚验证报告（真人模拟口径）

> 范围声明：本地无 Postgres/出站受限，DB 集成测试按仓库惯例 SKIP（CI 以 `MF_V2_TEST_DSN` 跑全）；
> Bangumi 公开 API 直连超时，改走本地快照 + 桩服务单测验证映射；未向线上写任何数据。

## 1. 残留清理（已合入 b62d813）

- `modules.go` 删除 `/api/v2` 别名循环，只留 `/api`；前端 `lib/api.ts` 基址同步去 `v1` 前缀（c30de5f），前后端前缀一致。
- `types.go:1` 注释 `catalogv2` 改 `catalog`；`http.go` 删除硬编码 `GET /catalog/shelves` 六货架；`openapi.go` 同步删路由声明。
- `ApplyPatches` 缺失文件空跳过改为硬失败：`seed_relations.go` 返回 error，`db.go` 透出，`patches.go applySchemaPatches` 签名改 `error`、DDL 失败直接返回。
- 验证：`go vet ./...`、`go build`、`go test ./internal/catalog/...` 全过。

## 2. 数据结构（已合入 b62d813）

- 新增 `edition_type` 字段 + 词表（standard/limited/first_press/regional/reissue/digital），接入 release。
- `format` 扩 uhd_bd/sacd/cassette/web；`packaging` 扩 jewel/slipcase/boxset；`role` 加 extra/commentary。
- `medium` 接入 `catalog_number`（多碟各自品番）；新增关系 `pressing_of / bonus_included_in / store_bonus_for / alternate_take_of`（acyclic）。
- `names()` 返回五键（zh-CN/zh-TW/ja/ja-JP/en-US），`Definitions.Validate` 中英必填保持通过。
- 七类实例走法见 `docs/architecture/media-architecture-review.md §7`，骨架八 Kind 未动，无特例表。

## 3. UI 密度（已合入 01f2f7f）

- 发行页：版本徽标行（版式/地区/包装）+ 介质 format 分组 Tab（特典盘折叠）+ 同曲跨介质时长对照 + 同一录音各版本对照表（occurrences）+ attachments/store_bonuses/events 折叠 + 真实媒体类型行头 + 对比篮。
- 作品发行表：版本/地区/包装/规格列 + 版式/格式/地区过滤 + 逐行对比复选；CompareView 迁新顶层字段 + Comparable 过滤，常量 2/6。
- 验证：`tsc --noEmit` 通过。

## 4. 企业级（已合入 c4e7fa5，部分；其余二期）

- 已做：Semver Compare 补 Tag 预发布语义，通配约束加显式注释。
- 未做（二期）：超时（Read/WriteTimeout、DB QueryContext、merge 内部超时）、幂等键、重型接口限流、X-Request-ID 与 metrics、List 真 COUNT 与 Occurrences 去 N+1、拆 God 文件与全局锁改范围锁。原因：需改表结构或大重构，不在本轮小步范围内。

## 5. 新项目化（已合入 b62d813 + 63eec77）

- 去 `/api/v2` 别名、去 `/api/v1` 前缀、去硬编码货架、迁移失败硬失败、不补 000004~000007 空文件（约束收归 schema.sql + store.go）。
- `.gitignore` 全局 `*.json` 收窄为 `deploy/*.json`（8072e2d），语种文件可跟踪。
- 过时文档：`plugin-decoupling-blueprint` 待归档标 VISION（未做，文档任务，需单独提交）。

## 6. 四语种（已合入 8072e2d + 01f2f7f）

- `routing.ts` locales 四语 + ja/zh-TW/zh-HK/Hant 识别；`getMessages` 四语 catalog；`LocaleSwitcher` 四项；`ja-JP.json`/`zh-TW.json` 新建，四文件 2555 key 零差集。
- 标题链收敛 `buildTitleChain`：用户排序 → 界面语言 → 原语言 → en-US → zh-CN → zh-TW → ja/ja-JP → 剩余；ja-JP↔ja 等价写法互通；四个手写调用方已收敛。
- 硬编码清零：admin 导航、kindLabel/query_tags、setup 错误串、VisualRelationEditor、StaffCharacter 徽章、EntityRevisions 默认参、themeContext 主题名全部转 key。
- 真译率：日繁各 89/2555（nav/common 核心），低频键英文占位但无缺 key。
- 验证：`tsc --noEmit` 通过。

## 7. 后台可编（已合入 8072e2d）

- `catalog.shelves` 新表 + `000002` 迁移 + 公开读/管理 CRUD + 种子六条；`ShelvesTab` 重写接新 CRUD（四语 names、四类 query 条件）；旧 `ShelfModal` 删除。
- 外部来源 Tab 挂载已有 CRUD；EntityTypes/RelationTypes 四语回写；DefinitionsEditor 补 groupNames label、directory 对齐、词表冒烟面板；Fields NamesEditor 四语。
- 验证：后端单测 + `tsc` 通过。

## 8. 真人模拟 + person/45638（2026-09-08 线上全流程已执行，数据已清理）

- 部署：分支推送至 origin，生产机 `/root/metafusion` 拉取 `2d3a148`，增量构建 backend+frontend，
  迁移 `000002_catalog_shelves` 已应用；`POST /api/importer/*` 路由注册成功。
- 真人链（token 直发 MoeCaa admin，用后即删）：preview（Bangumi 实抓 MyGO!!!!!）→ import
  建 agent `4327fef9` → 带 token 回读 draft 可见、匿名 404 符合可见性语义 → PUT 发布 v2 →
  修 `original_language=ja` + zh-CN 翻译 v3 → 建 `performed_by`（动画 work→乐队）→
  双侧 relations 反查命中 → revisions 审计可追溯 → DELETE 关系 → lifecycle 删实体（v4 deleted）。
- 数据质量发现：Bangumi 快照 summary 含 GBK 混杂乱码，线上 ja 翻译行如实透传，需后续清洗；
  草稿阶段匿名不可读符合 `store.go:165`，不是 bug。
- 清理：验证关系已删，验证实体已 deleted，token 已删；库内 703 实体（含 1 条 deleted 审计残留）/ 255 关系归位。
- 货架：`GET /api/catalog/shelves` 返回 DB 规则，四语 names 就绪。
- 未做：Definitions 新版发布（线上仍 base_version=1 无 edition_type，需后台 impact 预演后发布）、
  全量 702 重导（旧数据已在库，无需重跑）。

---

*提交链：5c1f344 → b62d813 → 8072e2d → c4e7fa5 → 01f2f7f → c30de5f → 63eec77；本文档为验证口径说明，未新增代码。*
