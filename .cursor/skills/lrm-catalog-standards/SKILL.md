---
name: lrm-catalog-standards
description: Enforce LRM (Library Reference Model) and MusicBrainz-aligned cataloging and Release naming standards across all media forms (web novels, published books, comics, anime, music, games) in MetaFusion. Use when creating, seeding, curating, migrating, or querying Work, CanonicalEntry, Release, Medium, and Publisher metadata.
---

# MetaFusion LRM 编目与发行版 (Release) 命名规范

本规范确立 MetaFusion 媒体实体在 IFLA LRM（图书馆参考模型）与 MusicBrainz 体系下的元数据编目标准，指导全库 Work、Release、Medium、Track 及出版者元数据的规整与录入。

> **核心互通**：本规范与项目根级编目审查总则 [metafusion-curator](../metafusion-curator/SKILL.md) 保持完全同步与互补，作为跨媒介发行版本（Release）细分领域的详细指引。

---

## 1. 核心实体模型分层

```
Work (纯净逻辑作品 / 思想创作，如《宿命之环》《攻壳机动队》《千与千寻》)
 └── CanonicalEntry (标准规范题名、主分类标签、原始创作年代、核心主创)
      └── Release (具体发行版本 / 物理载体 / 数字发行规格)
           └── Medium (卷册 / 盘片 / 媒介规格，如 Vol.1, Disc 1)
                └── Track (章节 / 分镜 / 音轨 / 关卡)
```

- **Work 题名**：必须保持绝对干净纯粹，不含媒介、版本、规格或副标题前缀（例如 `宿命之环`，而非 `宿命之环（起点中文网首发版）`；`攻壳机动队`，而非 `攻壳机动队 剧场版 1080P`）。
- **Release 题名**：**严禁机械化模版式重复**（如所有网文都填同一句“网络连载版（起点中文网首发）”）。Release 必须具有唯一且可精确辨识的**版本规格、出版信息、卷次或媒介渠道**。

---

## 2. 跨媒介发行版 (Release) 命名与规格标准

### 2.1 网络连载 / 数字阅读 (Web Novel / E-Book)
- **命名格式**：
  - 数字全本/连载：`{作品主名}（{发布平台}官方数字连载版）` 或 `{作品主名}（{发布平台}电子书完结典藏版）`
  - 分卷连载：`{作品主名} 第{N}卷：{卷名}（{发布平台}数字版）`
- **示例**：
  - `宿命之环（起点中文网官方数字连载版）`
  - `诡秘之主（起点中文网正版连载·完结典藏版）`
  - `道诡异仙（起点中文网数字连载版）`
  - `剑来（纵横中文网官方连载版）`

### 2.2 实体图书 / 出版单行本 (Printed Book / Light Novel)
- **命名格式**：
  - 单卷/单册：`{作品主名} {卷号}：{卷副题名}（{装帧/版本}，{出版社}，ISBN {ISBN-13}）`
  - 套装/盒装：`{作品主名}（全{N}册{装帧}套装，{出版社}，ISBN {ISBN-13}）`
- **必填属性**：`barcode`（有效 13 位 ISBN，如 `9787513352887`）、`publisher`（出版机构 Artist/Label）、`release_date`（出版年月）、`country_code`（如 `CHN`, `JPN`）。
- **示例**：
  - `宿命之环 1：宿命之环（初版平装单行本，新星出版社，ISBN 9787513352887）`
  - `诡秘之主 1：小丑（精装典藏版，广东旅游出版社，ISBN 9787557022495）`
  - `诡秘之主 2：无面人（精装典藏版，广东旅游出版社，ISBN 9787557024642）`
  - `斗罗大陆（全14册精装典藏盒装版，太白文艺出版社，ISBN 9787806806500）`
  - `全职高手 1：巅峰荣耀（纪念精装本，知书达礼，ISBN 9787557008185）`

### 2.3 漫画 / 绘本单行本 (Comics / Manga)
- **命名格式**：`{作品主名} 第{N}卷（{出版社/出版方} {装帧规格}）`
- **示例**：
  - `一人之下 第1卷：炁体源流（浙江文艺出版社，平装单行本）`
  - `镖人 第1卷（北京联合出版公司，初回限定版）`

### 2.4 动画 / 影视影视载体 (Anime / Film / TV Series)
- **命名格式**：`{作品主名} {分季/规格}（{介质包装}，{发行厂牌/平台}）`
- **示例**：
  - `全职高手 第一季（4K UHD 典藏蓝光BOX，阅文影视/腾讯视频）`
  - `诡秘之主 动画先导片（Bilibili 4K HDR 官方网络流媒体首播版）`
  - `攻壳机动队（4K UHD 典藏限量铁盒版，Bandai Visual）`

### 2.5 音乐唱片 / 原声集 (Music / OST)
- **命名格式**：`{专辑名}（{介质/盘种}，{Catalog Number/厂牌}）`
- **示例**：
  - `诡秘之主 官方概念原声大碟（Hi-Res 96kHz/24bit 数字无损专辑）`
  - `全职高手 动画原声带（初回限定盘 CD+Booklet，Sony Music，SVWC-70231）`
  - `攻壳机动队 原声大碟（初回限定盘 CD，Victor Entertainment，VICL-60017）`

### 2.6 多作品全集 / 豪华盒装 (Multi-Work Boxset & Compilation)
- **核心铁律**：严禁将多部作品全集/作品集盒装的品番/条形码直接挂载在单部作品下（如严禁将 13 碟全集盒装 `VWBS-1531` 当作《千与千寻》单部电影发行版）。
- **单行本与全集分离**：
  - 单部作品挂载独立单行本（如《千与千寻（日本院线官方初版蓝光，VWBS-1530，1 BD-50）》）；
  - 全集盒装建立独立汇编作品/Release（如《宮崎駿監督作品集（13BD 豪华限定盒装，VWBS-1531，Walt Disney Studios Japan）》），分盘（Mediums）1:1 建立 13 张碟片，并通过 `Track` / `CanonicalEntry` 或 `entity_relationships`（`included_in`）将分碟精准链接回各母体作品。

---

## 3. 编目清洗与种子数据规整守则

1. **唯一性与可追溯性**：同一 Work 下若存在多个 Release，必须各自代表不同的媒介载体、出版机构、出版批次或数字分发渠道。
2. **出版者 (Publisher / Label) 关联**：
   - 阅文集团作为出版机构/版权方时，其名下应当聚合真实的实体书、数字平台版本，而非全部套用相同的静态文本。
   - 实体出版物必须关联真实出版社（如新星出版社、人民文学出版社、广东旅游出版社、浙江文艺出版社等）。
3. **Medium 与 Track 的规范性**：
   - 实体书 Medium `format` 标为 `Paperback`、`Hardcover`、`Box Set` 或 `Digital Book`。
   - 音乐/影像 Medium `format` 标为 `CD`、`Digital`、`Blu-ray`、`UHD-BD`、`Vinyl` 等。
4. **元数据禁止项**：
   - 禁止出现 generic 模版占位符如 `Release 1`、`网络连载版（起点中文网首发）` 全局硬编码复制。
