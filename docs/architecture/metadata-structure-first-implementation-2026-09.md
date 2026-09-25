# 元数据层级关系：首批实施记录

日期：2026-09-25。本文记录当前分支的实现与只读样本判断；上线实例仍运行旧版本，以下改动尚未部署，也没有修改线上元数据。

## A. 唯一事实来源与样本判断

| 事实 | 权威来源 | 当前约束与读取入口 |
| --- | --- | --- |
| ContentUnit / Expression 属于 Work | `content_units.work_id` / `expressions.work_id` | 非空，类型外键；实体读取与 `GET /catalog/entities/{id}/links` |
| Medium 属于 Release、Track 属于 Medium | `mediums.release_id` / `tracks.medium_id` | 非空，类型或侧表外键；实体读取与 links |
| ContentUnit / Medium / Track 的上级位置、Expression 的内容单元位置 | 各侧表 `parent_id` / `content_unit_id` | 同 Work、Release 或 Medium 的复合外键及循环校验；links 只读 |
| Release 包含的作品 | `release_subjects` | `(release_id, work_id, role)` 唯一，带 position 与动态 attributes；Release.subjects 写入 |
| Track 收录的表达 | `track_contents` | `(track_id, position)` 唯一，带 locator 与动态 attributes；Track.contents 写入；跨 Work 收录需在 Release.subjects 声明 |
| 署名、创作、改编、聚合等语义 | `catalog.relations` | definitions 关系码与端点校验；关系编辑端点 |

依据是现行迁移 `backend/migrations/000001_catalog_core.up.sql`、目录写入校验和处理器。读取层不另存这些事实。

| 样本与来源 | 现有模型的判断 | 仍需的真实编目证据 |
| --- | --- | --- |
| [《NieR:Automata》站内 Work](https://findverse.cc/works/01a0aaf3-1fbe-7a1b-a973-8d9d1e75379a) | 2026-09-25 匿名 API 回读：0 个 ContentUnit、0 个 Expression，只有一条 `soundtrack_of`。目录应隐藏；配乐 Work 通过语义边关联，不造空章节。 | 若要补路线/任务，须先有稳定标识和来源。现有 `indie_game` 是旧导入映射，不能据此断言独立制作。 |
| [Bangumi 动画条目 633836](https://bgm.tv/subject/633836) | 分集可以是同 Work 的 ContentUnit；播出与发行收录分开。现有所有权和定位已足够。 | 不同剪辑是否应分 Expression，取决于具体版本证据。 |
| [Project Gutenberg《A Christmas Carol》](https://www.gutenberg.org/ebooks/46) | 作品与 Stave 篇章可分别为 Work、ContentUnit；不需要为章节新造 Work。 | 译本、纸版页码和具体发行须按各版独立来源补证；本样本不证明这些版本事实。 |
| [BRMM-11089 商品页](https://bushiroad-music.com/musics/brmm-11089/) | 同一音乐作品的不同品番建不同 Release；CD 实际曲序在 Medium / Track，赠品是发行属性。现有结构可表达。 | 歌曲或录音的身份复用应逐曲核对。 |
| [BRMM-11112 商品页](https://bushiroad-music.com/musics/brmm-11112/) | 双乐队 split single 的 A/B 盘可各有 Release、多个 Release.subjects、CD/BD Medium 与各自 TrackContent；跨 Work 收录是引用，不是多个父 Work。现有结构可表达。 | CD 是否共用同一录音 Expression、BD 演出是否为独立 Work，须按实际曲目和演出来源逐项核对。 |

这五组样本尚未证明必须改变八种身份或四条核心所有权，因此暂不建立 `structure_links`。多版本发行、跨作品收录的差异在现有权威表中已有位置。

## B. 页面和导入修正

- 作品页只读取一次 ContentUnit、Expression 与聚合关系，目录标签与内容共用结果。没有可见条目时隐藏目录；读取失败时显示错误和重试；有条目时保留目录。
- 内容单元下若有同题名的 Expression，目录角标明确标成“内容表达”，避免把两个不同身份都标为“本篇”而看似重复建档。
- Bangumi 的通用游戏类型映射到新增的四语 `game`，不再推断成 `indie_game`。旧实例中的误分类记录需要单独审阅和有证据的更正；本批不批量改线上数据。
- 现有实例须先按部署流程执行 `mf-migrate seed`，发布新增的 `game` 类型后才启用新的 Bangumi 导入映射；HTTP 服务启动只检查迁移兼容性，不代替定义种子步骤。

## C. 统一关系读取的首批范围

`GET /catalog/definitions` 增加只读 `relationship_rules`：固定归属、定位、收录规则与动态语义规则共用码、类别、四语正反向名称和端点描述。管理台显示固定规则及其只读属性。固定规则码以 `structure:` 开头，动态语义码以 `relation:` 开头；已发布 definitions 的写入格式不变。

`GET /catalog/entities/{id}/links` 从四类权威来源汇总直接边，返回相对主体的方向、类别、规则码、两端、位置、角色、定位与属性，以及当前发布 definitions 版本和当页可见端点。按可见端点与关系码、位置稳定分页，`limit` 默认 50、最大 100；普通关系的实体属性引用不冒充主体直接边。固定边只从所属实体或收录表编辑，不能经此接口写入。

当前接口不提供逐条边的证据来源或历史规则版本：旧外键和收录表未保存独立的逐边来源，而当前 definitions 版本只能说明本次读取的命名和校验口径。后续若确需逐边证据，先设计权威写入处的来源记录与迁移，不能在投影接口中虚构来源。扩展结构规则的编辑、发布影响检查和 `structure_links` 写入仍属于阶段 D，须先有无法用现有结构表达的带来源样本。

本批仅完成编译和静态检查；尚未针对目标实例执行新接口回读，也未改变已执行迁移。部署后的验收应以目标实例版本、已执行迁移、权限身份下的 API 回读及详情页表现为准。
