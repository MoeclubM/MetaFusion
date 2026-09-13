# 元数据目录核心架构

MetaFusion 采用基于实体责任骨架与动态目录定义的纯净架构。核心统一入口为 `/api`，默认运行仅需依赖 PostgreSQL 即可提供完备的元数据建档、层级关联、多版本比对与协同审核能力。外围资源归档与下载中心完全解耦。

## 固定层级与可选结构

| 实体 | 用途 | 示例 |
| --- | --- | --- |
| Agent | 个人、组织、角色身份 | 摄影师、独立开发者、配音演员、虚构角色 |
| Collection | 有序聚合或企划 | 摄影系列、跨媒体企划 |
| Work | 独立创作身份 | 歌曲、专辑、写真集、小说、独立游戏 |
| ContentUnit | 同作品内的逻辑目录 | 第三章、编号 78 的动画集、游戏路线 |
| Expression | 属于一个 Work 的具体表达，可关联该作品的 ContentUnit | 原文、译文、翻唱录音、BD 剪辑 |
| Release | 有来源依据的公开发行，subjects 可关联多个 Work | 普通版、限定版、地区版、个人免费数字版 |
| Medium | 同发行内的承载单元，可嵌套 | CD、MV BD、纸质册、黑胶 |
| Track | 同载体内的收录位置，可嵌套 | A1、光盘菜单、章节位置 |

类型可以组合；简单作品无需凑齐全部层级。`position` 为非负排序整数，`number` 为原始印刷编号。Expression 的 `work_id`、Medium 的 `release_id` 和 Track 的 `medium_id` 为固定所属关系，普通编辑不可跨域移动。目录父子必须同域且无环。

Track 的 `contents` 是实际收录的唯一来源：`expression_id`、`position`、`locator`。允许跨作品引用，但被收录表达的 Work 必须明确列入发行的 `subjects`。不要重复创建同一个录音。专辑的概念编排使用有序 `includes` 关系；实际版次顺序以载体和 TrackContent 为准。

`locator` / `subject_attributes` / `inclusion_attributes` 均走 definitions 的组字段声明（种子见 `backend/internal/catalog/defaults.go`，校验见 `validation.go`）：实体写入时先按拥有者 kind/types 匹配 `definitions.schemes` 同槽位场景，取并集 fields 收敛可用子字段与必填（展示编辑顺序即并集顺序，`relative_to` 锚点置前）；无匹配场景时回退全局组（旧文档无 `schemes` 键时同样回退，保持向后兼容）。匹配场景任一声明 `require_range` 时，`locator` 至少一个内容语义（`semantics=content`，如时间码）子字段非空，否则报 `range_required`。新增独立字段 `isbn`（release 级产品标识，与品番/条码同组展示）与 `duration_source`（entity 引用的时长来源，仅 expression 可写，解释同一表达在不同版本中的时长差异），音乐场景模板已引用 `duration_source`。

关系类型全部由服务端 definitions 驱动，运行时清单以 `GET /api/catalog/definitions` 为准（种子见 `backend/internal/catalog/defaults.go`）。署名类关系（work/content_unit/expression/release → agent）含 `created_by / performed_by / composed_by / lyricist_of / arranged_by / directed_by / written_by / illustrated_by / narrated_by / voiced_by / photographed_by / modeled_by / developed_by`；译者用 `translated_by`（work / content_unit / expression → agent，组 `credits`），不再挤占通用兜底；角色登场为 `character_in`（agent → work/collection，番位落 `role`，原始文本落 `credit_role`）；当来源职位没有贴切关系码时用通用兜底 `credit_for`（work/content_unit/expression/release → agent，职位原文落 `credit_role`），已有精确关系码时不再重复建边。关系通用可选字段为 `role`、`credit_role`、`context`、`character`、`language`、`begin_date`、`end_date`、`scope`。详情页的关系分区标题与顺序同样读各关系定义的分组声明，前端不写死关系码名单。

## 前端路由

作品、发行版、载体有专用详情路由 `/works/[id]`、`/releases/[id]`、`/mediums/[id]`；通用兜底与编辑入口为 `/catalog/[id]`（未知 kind 与 `?edit=1` 直达编辑）。探索为 `/explore`，对比为 `/compare`，创建为 `/new`，管理后台为 `/admin`。

## 七个编目例子

1. **写真**：创建摄影师 Agent、写真 Work，添加 `photobook` 和 `personal` 类型；以作者自述为来源。没有文件、出版社或发行记录也能发布条目。
2. **独立游戏**：游戏 Work 组合 `indie_game` 与 `visual_novel`；路线是 ContentUnit；有创作差异的正文版本是 Expression；不同平台公开发布是 Release。安装包编码与压缩方式属于文件模块。
3. **翻唱与单曲**：原歌曲 Work 下创建翻唱 Expression，关联演唱者和原表达。单曲发行、专辑、精选集的 Track 可以复用同一 Expression。实质改编且形成新作品身份时另建 Work。
4. **普通／BD 限定／特装专辑**：一个专辑 Work、三个 Release。普通版含 CD；限定版含 CD 与 BD；特装版再记录盒内附件。CD 收录歌曲录音，BD 收录演唱会或 MV 表达，发行 subjects 同时声明这些 Work。立牌写 `attachments`；店铺赠品写 `store_bonuses`，不能误建为盒内 Medium。
5. **小说**：同一 ContentUnit“第三章”对应原文和译文 Expression，通过 `translation_of` 关联。不同出版版 Track 映射正文，页码定位注明 `relative_to=medium`。
6. **动画与电影**：分集 ContentUnit 保留编号 `78`、`EX`；WEB、BD 剪辑是 Expression；WEB、BD、DVD 产品是 Release 与 Medium。WEB-DL、REMUX 和编码属于归档与媒体分析。
7. **一人多角**：多条 `voiced_by` 关系保存同一作品、演员以及不同 `character` 引用；`language`、`context` 和 `scope` 说明语言与适用篇目。服务端按上下文判重，不按演员名去重。

官方案例参考：[致並跡](https://bushiroad-music.com/musics/brmm-11026/)、[迷跡波黑胶](https://bushiroad-music.com/musics/brmm-11011/)、[Re:ゼロ条目](https://bgm.tv/subject/633836)。示例是建模说明，不代表已向实例导入这些资料。

## 通过后台配置

管理员打开 `/admin`（旧 `/catalog/admin` 已重定向），Definitions 页签覆盖 types / fields / vocabularies / relations / templates / schemes：

1. 添加稳定代码与中英名称，选择固定实体层级。
2. 在共享字段库定义文本、多语言、数字、日期、布尔、网址、词表、实体引用、列表或字段组；在类型与关系中引用同一个字段。
3. 定义关系的正反向名称、端点层级与类型、上下文、基数、对称性、无环和显示分组。
4. 定义模板分区、字段顺序、列表列、目录模式与关系分区顺序（`relation_groups`）。
5. 在 schemes 页签按槽位（`locator` / `inclusion_attributes` / `subject_attributes`）声明场景子集：kinds/types 白名单（空为不限）、可用子字段（顺序即展示编辑顺序）、必填子集（⊆ fields）、`require_range`（仅 locator，要求至少一个内容语义子字段有值）。种子示例 `vinyl_track_locator`（`track` + `relative_to/chapter/path`）仅作示范，可被后台删除。
5. 填写编辑说明与来源，保存草稿，检查既有数据影响，然后发布。冲突或过期基础版本会阻止发布。

正在使用的定义请停用，不要删除。停用值可以保留并继续显示，不能在新数据中重新使用。发布后表单和详情读取新的定义；无专用模板的类型使用通用展示。

## 写入与审核

运行时结构见 `/api/openapi.json`，动态代码见 `/api/catalog/definitions`。先查询 `/api/auth/me` 核对角色。

```json
{
  "entity": {
    "kind": "work",
    "title": "城市光影",
    "original_language": "zh-CN",
    "translations": {"zh-CN": {"title": "城市光影", "summary": "作者独立摄影作品", "aliases": []}},
    "types": ["photobook", "personal"],
    "status": "draft",
    "attributes": {},
    "external_ids": {},
    "pictures": [],
    "position": 0,
    "number": "",
    "contents": [],
    "subjects": []
  },
  "expected_version": 0,
  "edit_note": "依据作者自述建立作品身份",
  "sources": [{"kind": "self", "citation": "作者说明作品题名与创作范围"}]
}
```

提交到 `POST /api/catalog/entities`。编辑前 GET 完整实体，保留未修改字段；PUT 带当前 `expected_version`。409 需要回读与合并，不能盲目覆盖或重试创建。创建后回读实体、关系、收录及修订历史。

编辑者可管理自己未发布的条目并提交 `pending_review`；管理员审核后设为 `published`。公开实体不能引用未公开的核心实体。合并需要管理员、同固定种类、相容所属关系和已发布目标；引用迁移与受影响修订在同一事务提交。冲突的收录或关系必须先处理。停用保留墓碑，外围数据不级联删除。

收藏是核心能力（表 `catalog.favorites`，迁移 `000003_catalog_favorites`）：`POST /api/favorites/toggle` 切换（需登录但不限管理员，请求体 `{target_type, target_id}` 拒绝未知字段，返回 `favorited`）、`GET /api/favorites/status?target_type=&target_ids=a,b` 批量查询（匿名返回空集）、`GET /api/favorites/mine` 当前用户收藏（需登录但不限管理员）、`GET /api/users/:id/favorites` 指定用户收藏（公开读，但目标实体按请求方可见性过滤；后两者支持 `target_type`、`page`、`page_size`，默认 `page=1`、`page_size=20`、上限 100）。`target_type` 直接是实体 kind（固定八实体骨架 `agent/collection/work/content_unit/expression/release/medium/track`），不做词表映射，并复用实体可见性规则。

首页偏好：登录用户可读写 `GET /api/catalog/me/home-preferences`（匿名返回 401）与 `PUT /api/catalog/me/home-preferences`（请求体 `{order, hidden}`，slug 去空去重并按货架白名单校验，未知 slug 报 `unknown_shelf`；`GET /api/catalog/shelves/feed` 按偏好重排与隐藏）。

用户角色：`PUT /api/admin/users/:id/role` 请求体为 `{role}`，取值为 `user / editor / admin`（创建账号默认 `editor`，密码长度 12–72），且不能降级唯一的管理员。改密 `PUT /api/auth/password` 与 `POST /api/auth/change-password` 同语义，请求体均为 `{old_password, new_password}`。

来源支持 `url`（必须 HTTP(S) URL）、`publication` 和 `self`，都需要具体 `citation`。每次写入均要求 `edit_note` 和非空 `sources`，不再使用 v1 的 `source_urls` 字段。

## 可选模块

`GET /api/capabilities` 只提供模块状态，不返回文件详情。归档、播放、媒体处理、社区、个人记录、导入提案与导出默认关闭；管理员可按依赖级联启停。

| 模块 | API | 数据与行为 |
| --- | --- | --- |
| archive | `/archive/entities/{id}/resources`、`/archive/resources/{id}/content` | SHA-256 文件绑定，公开或所有者权限，本地对象目录或 S3 |
| playback | `/playback/resources/{id}/content` | 按权限播放浏览器支持的音视频和图片 |
| media | `/media/resources/{id}/jobs`、`/media/jobs/{id}` | PostgreSQL 队列，ffprobe 分析；`preview` 操作生成 MP4，结果只在媒体模块 |
| community | `/community/entities/{id}/posts` | 条目讨论，作者和管理员可删除 |
| records | `/records/entities/{id}` | 私有收藏、评分、进度和持有记录 |
| exchange | `/exchange/entities/{id}`、`/exchange/proposals` | JSON 导出及通过核心校验提交的编辑提案 |

Bangumi 导入器（`POST /api/importer/preview`、`POST /api/importer/import`）是核心路由，不是受 `capabilities` 开关控制的模块；其抓取条目、发行链、演职员/角色/声优关系的能力与不导入项见 [新建与编辑](/api-edit) 的「外部导入器能力」。其余新服务商导入器、AI、通知与 OpenSearch 适配器仍需实现模块；不能仅添加目录类型就获得新的执行能力。已有 v1 插件不会自动成为 v2 模块。SDK 在 `backend/internal/moduleapi`，依赖治理在 `moduledeps`，不引用旧 ORM。

## 运行与验证

在 `deploy/.env` 设置数据库凭据后：

```sh
docker compose -p deploy -f deploy/docker-compose.metadata.yml up -d --build
```

应用自动初始化独立 `catalog` schema。只需 PostgreSQL 与应用即可运行；Compose 中网关和前端提供网页入口。Redis、OpenSearch、RustFS 和旧 worker 均不在最小启动集内。归档启用前不会读取 S3 凭据或连接对象存储。FFmpeg 在启用媒体模块后才执行。

全新数据库验收使用 `MF_V2_TEST_DSN=postgres://.../mf_v2_test?sslmode=disable`。测试会创建并仅删除本次生成的随机测试库，不清理指定的旧数据库或生产 schema。CI 配置 PostgreSQL 服务，防止集成测试被默认跳过。
