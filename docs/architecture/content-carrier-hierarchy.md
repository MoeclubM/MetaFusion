# 内容目录与发行载体层级

MetaFusion 将“作品是什么”和“某个版本如何承载它”分开存储。这样同一首录音、同一集动画或同一章漫画可以被多个发行版复用，也不会因为一张盒装专辑、一本单行本或一套蓝光的包装差异而复制作品实体。

## 层级关系

```text
Work（创作母体）
├── CanonicalEntry（作品内容目录 / LRM-E2 Expression）
│   └── CanonicalEntry.parent_id（同一作品内的目录树）
└── Release（商业发行版 / Manifestation）
    └── Medium（发行版内的碟、卷、文件集或其他容器）
        ├── Medium.parent_id（同一发行版内的容器树）
        └── Track（容器中的位置或偏移）
            └── TrackContent（Track ↔ CanonicalEntry 多对多收录关系）
```

- `Work.title` 只保存创作母体的纯题名，不混入季数、碟号、卷号、规格或目录编号。
- `CanonicalEntry` 保存可被引用的内容表达：歌曲母版、动画分集、电影剪辑、漫画章节或书籍正文片段。`position`、`number`、`entry_role` 与 `parent_id` 表达作品目录，不表达包装。
- `Release` 保存带有发行日期、厂牌、ISBN/JAN/目录编号、包装和封面的具体版本。没有可靠发行证据时，作品可以只有 `Work + CanonicalEntry`，不创建占位发行版。
- `Medium` 是发行版内真实存在的容器。多碟盒装、实体卷册、蓝光附盘和数字文件集都在这里表达；`role=primary|supplement` 区分主载体和附加载体。
- `Track` 是载体中的位置，不再被当作作品目录。一个 Track 可以通过 `TrackContent` 收录多个内容表达，并在 `locator` 中保存页码、章节或时间段；单内容旧数据继续由 `canonical_entry_id` 兼容读取。
- 所有层级的父节点都受数据库外键、同容器约束和循环检查保护，不能跨作品、跨发行版或跨介质挂接；Track 及 TrackContent 还由数据库触发器校验必须属于 Release 所属的 Work。

## 三类来源的推荐落库

### BRMM-10512《BanG Dream! Dreamer’s Best》

1. 创建纯题名的音乐 `Work`。
2. 创建一个 `Release`，将 `catalog_number=BRMM-10512`、JAN、官方页面和限定版包装写入发行版；发行版封面优先使用发行版自己的 `cover_image_url`。
3. 在同一发行版下创建四个 `Medium`：两张 CD 为 `primary`，两张 Blu-ray 为 `supplement`，按包装中的实际顺序填写 `position`、`number` 和 `format`。
4. CD 曲目对应可复用的录音 `CanonicalEntry`；Blu-ray 中的演唱会或视频内容若有独立表达，则建立 `entry_role=extra` 的目录项，再由 `TrackContent` 关联。只有载体位置而没有可复用表达的附录，可以保留无内容关联的 Track。

### Bangumi 186515《BanG Dream!》TV

1. `Work` 保存 TV 系列的纯题名和播出时间。
2. 13 集与 OVA/SP 建立 `CanonicalEntry`；正片使用 `entry_role=main`，OVA、SP 等使用 `extra`，排序由 `position/number` 表达。
3. 每一套真实蓝光或 DVD 发行版单独建立 `Release`，每张碟建立 `Medium`，每个收录位置建立 `Track`，再通过 `TrackContent` 指向对应分集。不要创建“TV Broadcast”“BD-BOX”这类虚构技术载体来代替真实发行证据。

### Bangumi 206016《BanG Dream! バンドリ》漫画系列

1. Bangumi 系列条目先建立一个没有 Release 的漫画 `Work`；没有章节来源时只保留作品级档案，不从“有 4 本单行本”推造 4 个章节。
2. 每个真实单行本（例如卷 1、卷 4）作为同一 Work 下的独立 `Release`，在 Release 中保存 ISBN、出版日期、出版社和对应封面；每个纸质卷册建立一个 `Medium`，格式为 `paperback`。
3. 当权威来源提供章节目录时，再把章节建立为 `CanonicalEntry` 并按卷或章节组设置 `parent_id`；同一章节被电子版、纸版或再版收录时，只新增发行版和 TrackContent 关系，不复制章节实体。
4. 若某个来源把“卷”维护成独立创作实体，则把它作为独立 Work，并用受控图谱边表达 `part_of`/`version_of`；不要把卷号拼接进系列 Work 的标题。

## 写入与读取接口

- `GET /catalog/works/:id/contents` 返回与发行库存无关的完整作品内容目录。
- `GET /catalog/canonical-entries?work_id=...&parent_id=root` 支持按作品和父节点分页读取目录。
- `POST/PUT /catalog/canonical-entries` 用于维护内容目录；已有篇目禁止迁移到其他 Work。
- `POST/PUT /catalog/mediums` 与 `POST/PUT /catalog/tracks` 用于维护发行载体树；Track 的 `contents` 数组维护多对多收录和定位信息。
- Release、Medium、Track 和 CanonicalEntry 的写入都要求 `edit_note` 与 HTTP(S) `source_urls`，并记录不可变修订快照。

## 迁移与兼容

`000004_content_hierarchy` 增加作品目录字段、同作品父子外键和循环触发器；`000005_carrier_hierarchy` 增加发行/介质/轨道字段、`track_contents` 表及同容器父子外键；`000006_carrier_content_integrity` 移除旧 `entry_number` 唯一约束，并为 Track/TrackContent 增加跨 Work 保护。旧的单一 `tracks.canonical_entry_id` 保留用于兼容存量数据，新代码读取时同时合并旧关联和 `TrackContent` 关联。
