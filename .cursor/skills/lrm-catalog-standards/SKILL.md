---
name: lrm-catalog-standards
description: Enforce LRM (Library Reference Model) and MusicBrainz-aligned cataloging and Release naming standards across all media forms (web novels, published books, comics, anime, music, games) in MetaFusion. Use when creating, seeding, curating, migrating, or querying Work, CanonicalEntry, Release, Medium, and Publisher metadata.
---

# MetaFusion LRM 编目与发行版 (Release) 命名规范

本规范确立 MetaFusion 媒体实体在 IFLA LRM（国际图书馆参考模型）与 MusicBrainz 体系下的元数据编目标准，指导全库 Work、CanonicalEntry、Release、Medium、Track 及出版者元数据的规整与录入。

> **核心互通**：本规范与项目根级编目审查总则 [metafusion-curator](../metafusion-curator/SKILL.md) 保持完全同步与互补，作为跨媒介实体结构与发行版本（Release）细分领域的权威实操指南。

---

## 1. 核心实体模型五层分层体系 (The 5-Layer LRM Hierarchy)

MetaFusion 融合 IFLA LRM（国际图书馆参考模型）与现代多媒介流媒体/编目哲学，将媒体实体划分为五层结构：

```
Work (纯净逻辑作品 / 抽象思想创作概念，如《千与千寻》《范特西》《三体》《流浪地球》)
 └── CanonicalEntry (表现层 Expression / 典范条目 / 标准篇目 / 跨媒介具体创作表达)
      └── Release (具体发行版本 / 物理载体 / 商业发售规格)
           └── Medium (介质容器 / 盘片 / 卷册，如 Disc 1 CD, Disc 2 BD, Vol.1)
                └── Track (物理分轨 / 音轨序号 / 章节目录项)
```

### 1.1 各层职责与跨媒介表现层 (CanonicalEntry / Expression) 映射

- **Work 题名**：必须保持**绝对纯净**，严禁混入媒介、版本、规格、音质或分卷副标题前缀：
  - ✅ 正确：`宿命之环`、`攻壳机动队`、`千与千寻`、`范特西`
  - ❌ 错误：`宿命之环（起点中文网首发版）`、`攻壳机动队 剧场版 1080P`、`千与千寻 日本13BD豪华盒装版`、`范特西 CD+VCD限量版`
- **CanonicalEntry（表现层 Expression / 典范条目）**：承载抽象 Work 的具体创作实现与可复用篇目/母版内容。在不同媒介领域下自适应对应为：
  - 🎵 **音乐 (Music)**：`CanonicalEntry` = 典范录音 / 母版 (Recording / Master Audio Track)，如《晴天 (Master Recording)》；
  - 📚 **图书 / 小说 (Books / Novels)**：`CanonicalEntry` = 标准篇目 / 典范章节 / 正文篇幅 (Chapter / Canonical Text / Story Piece)，如《第1章：红月亮》；
  - 🎬 **影视 / 动画 / 剧集 (Cinema / Anime / Series)**：`CanonicalEntry` = 正片剪辑 / 分集母版 / 典范剧集 (Feature Film Cut / Episode Master)，如《第1话：给二千年后的你》、《正片公映版 (Theatrical Master)》；
  - 🎨 **漫画 / 绘本 (Manga / Comics)**：`CanonicalEntry` = 连载话 / 篇章 (Episode / Story Chapter)，如《第1话：风车村的红发》；
  - 🎙️ **播客 / 广播剧 / 有声书 (Podcasts / Audio Dramas)**：`CanonicalEntry` = 典范单集 / 正片声音母版 (Master Episode Audio)；
  - 🎮 **游戏 (Games)**：`CanonicalEntry` = 游戏本体剧情 / 扩展战役篇章 (Main Scenario / DLC Campaign)。
- **Release 题名与规格**：**严禁机械化模版式重复**（如所有网文都填同一句“网络连载版”）。Release 必须具有唯一且可精确辨识的**版本规格、出版机构、卷次、装帧或媒介渠道**。

### 1.2 抽象创作与表现层实现的严格分离及跨发行复用机制

在全媒介编目中，必须严格区分 **Work 级抽象创作关系** 与 **CanonicalEntry 级具体表现制作关系**：

1. **Work 级创作关系**（抽象思想与原创内核）：
   - `author`（文学作者）、`composer`（作曲者）、`lyricist`（作词者）、`scriptwriter`（剧本创作者）、`character_designer`（原案设计者）。
   - **规则**：无论内容被收录于何种载体或发行版本，Work 的核心创作者恒定不变。
2. **CanonicalEntry (Expression) 级制作演职与版本表现关系**（具体母版/篇目的实现者与权利人）：
   - 音乐：`performer`（演唱/演奏）、`arranger`（编曲）、`producer`（录音制作人）、`phonographic_copyright`（℗ 录音版权）；
   - 影视/动画：`director`（剪辑/分集导演）、`sound_director`（音响监督）、`voice_actor`（配音演员）；
   - 图书/漫画：`translator`（特定译本翻译）、`editor`（分卷责任编辑）。
3. **跨发行复用 (Expression Reuse) 与「Appears on Releases」反查机制**：
   - 同一个具体的 `CanonicalEntry` 由全局唯一 UUID 标识；
   - **小说案例**：同一部小说的标准正文篇章（`CanonicalEntry`），同时被初版平装书（Release A）、精装合订本（Release B）、Kindle 电子书（Release C）引用；
   - **电影案例**：同一部电影的院线公映正片母版（`CanonicalEntry`），同时被院线首映版（Release A）、4K UHD 蓝光版（Release B）、流媒体重映版（Release C）引用；
   - **音乐案例**：同一首母版录音（`CanonicalEntry`），同时被首版 CD（Release A）、精选集（Release B）、20周年黑胶套装（Release C）引用；
   - 系统通过 `tracks.canonical_entry_id` 反查该篇目/母版在全库所有发行版中的收录记录（Appears on Releases），彻底消除元数据冗余。

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
- **必填属性**：`barcode`（有效 13 位 ISBN-13，如 `9787513352887`）、`publisher`（出版机构 Artist）、`release_date`（出版日期）、`country_code`（如 `CHN`, `JPN`）。
- **示例**：
  - `宿命之环 1：宿命之环（初版平装单行本，新星出版社，ISBN 9787513352887）`
  - `诡秘之主 1：小丑（精装典藏版，广东旅游出版社，ISBN 9787557022495）`
  - `诡秘之主 2：无面人（精装典藏版，广东旅游出版社，ISBN 9787557024642）`
  - `斗罗大陆（全14册精装典藏盒装版，太白文艺出版社，ISBN 9787806806500）`

### 2.3 漫画 / 绘本单行本 (Comics / Manga)
- **命名格式**：`{作品主名} 第{N}卷（{出版社/出版方} {装帧规格}，ISBN {ISBN-13}）`
- **示例**：
  - `一人之下 第1卷：炁体源流（浙江文艺出版社，平装单行本，ISBN 9787533948740）`
  - `镖人 第1卷（北京联合出版公司，初回限定版，ISBN 9787559612977）`

### 2.4 动画 / 影视载体 (Anime / Film / TV Series)
- **命名格式**：`{作品主名} {分季/规格}（{介质包装}，{发行厂牌/平台}，{品番}）`
- **示例**：
  - `全职高手 第一季（4K UHD 典藏蓝光BOX，BCXA-1234，腾讯视频/阅文影视）`
  - `千与千寻（日本院线官方初版蓝光，VWBS-1530，Walt Disney Studios Japan）`
  - `攻壳机动队（4K UHD 典藏限量铁盒版，BCQA-0001，Bandai Visual）`

### 2.5 音乐唱片 / 原声集 (Music / OST)
- **命名格式**：`{专辑名}（{介质/盘种}，{Catalog Number/厂牌}）`
- **示例**：
  - `范特西（首版 CD+VCD 豪华装，BMG 唱片，TCD-5246）`
  - `流浪地球 电影原声大碟（Hi-Res 96kHz/24bit 数字无损专辑，造梦嘉/阿鲲音乐）`
  - `攻壳机动队 原声大碟（初回限定盘 CD，Victor Entertainment，VICL-60017）`

---

## 3. 多作品全集 / 豪华盒装编目铁律 (Multi-Work Boxsets & Compilations)

### 3.1 核心铁律
1. **严禁混淆挂载**：绝对禁止将多部作品全集/作品集盒装的品番/条形码直接挂载在单部作品下。
2. **经典教学案例**：
   - **《宮崎駿監督作品集》（13BD 豪华限定盒装，品番 `VWBS-1531`）**：
     - 收录 11 部宫崎骏执导长片（《鲁邦三世》《风之谷》《天空之城》《龙猫》《魔女宅急便》《红猪》《幽灵公主》《千与千寻》《哈尔的移动城堡》《悬崖上的金鱼姬》《起风了》）及 2 碟特典；
     - 必须独立创建汇编作品《宮崎駿監督作品集》及其 Release `VWBS-1531`，分碟展开 13 个 Medium，Medium 8 的 Track 关联《千与千寻》；
   - **《千与千寻》（单行本蓝光，品番 `VWBS-1530`）**：
     - 属于单部作品《千与千寻》的单碟发行版（1 BD-50）；
     - **严禁**将 `VWBS-1531` 挂在《千与千寻》单部作品名下！

---

## 4. 跨媒介世界观企划 Hub 与 DAG 拓扑图谱 (Franchise & DAG Topology)

### 4.1 企划聚合原则
以《流浪地球》系列与《三体》系列为标杆：
1. **Franchise 聚合**：建立 `流浪地球系列企划` 与 `三体宇宙`；
2. **跨媒介连接边**：
   - `adaptation_of`（改编自）：电影改编自小说；
   - `sequel_of` / `prequel_of`（续篇/前传）：电影 2 为电影 1 的前传（保持严格单向有向图）；
   - `soundtrack_of`（原声带）：阿鲲音乐制作的原声大碟指向电影本体；
   - `spin_off_of`（外传衍生）：同人衍生或官方外传指向原作；
   - `crossover_with`（跨界联动）：作品间限定联动（对称边）；
   - `included_in`（收录于）：单曲/短篇收录于合辑。
3. **拓扑无环检查**：全站关系图谱必须保持有向无环（DAG），禁止自环与多级循环依赖；
4. **多版本 Qualifier**：使用 `qualifier` 区分同类多边（如日配 `qualifier="ja"`，中配 `qualifier="zh-CN"`）。

---

## 5. 封面自然宽高比与官方保真实体标准

MetaFusion 严格执行封面画幅与官方保真规范：
- **音乐唱片 / OST / 单曲**：严格强制 `"1:1"`（推荐 ≥ 1400 × 1400 px）；
- **电影 / TV动画 / 剧集海报**：严格强制 `"2:3"`（推荐 ≥ 1000 × 1500 px）；
- **实体书籍 / 轻小说 / 漫画单行本**：严格强制 `"3:4"`（推荐 ≥ 1200 × 1600 px）。
- **保真要求**：图片必须来自官方出版原档并持久化托管于平台对象存储，严禁盗链图床、占位图或变形拉伸图。

---

## 6. 全栈多语言回退链与不可篡改审计流

1. **实体多语言回退**：
   - 标注 `original_language`，并在 `translations` 录入本地化题名与简介（`zh-CN`, `zh-TW`, `en-US`, `ja`, etc.）；
   - 遵循多语言回退链（User Locale -> en-US -> original_language -> Default）；
   - 前端 UI 严禁硬编码中英文，全部通过 i18n 字典驱动。
2. **不可篡改审计流**：
   - 每次写操作必须提供考据依据 `source_urls`（官方目录/ISBN/MusicBrainz 等权威公开链接）与编辑动机 `edit_note`（详细说明变更背景）。
