# MetaFusion LRM 增强版架构与实体拓扑规范 (LRM Architecture & Topology Reference)

## 1. IFLA LRM 实体模型在 MetaFusion 中的映射

MetaFusion 融合国际图书馆参考模型（IFLA LRM）与 MusicBrainz 编目哲学，将多媒体数据划分为 4+1 层结构：

```
┌────────────────────────────────────────────────────────┐
│  LRM-E1: Work (逻辑作品概念层)                        │
│  - 纯粹思想与艺术创作概念，如《千与千寻》《范特西》《三体》│
└───────────────────────────┬────────────────────────────┘
                            │ 1:N 派生 / 表现
┌───────────────────────────▼────────────────────────────┐
│  LRM-E2: Expression / CanonicalEntry (典范条目/内容母版) │
│  - 单曲母带、漫画分话母版、视觉小说故事线、单集母版   │
└───────────────────────────┬────────────────────────────┘
                            │ 1:N 物化 / 商业发售
┌───────────────────────────▼────────────────────────────┐
│  LRM-E3: Manifestation / Release (载体发行版本)        │
│  - 初回限定盘 CD+BD、4K UHD 铁盒版、精装单行本分卷     │
│    └─ Medium (介质容器: Disc 1, Disc 2, Vol.1)         │
│         └─ Track (条目分轨: 音轨序号、章节目录)        │
└───────────────────────────┬────────────────────────────┘
                            │ 1:N 数字化持久化
┌───────────────────────────▼────────────────────────────┐
│  LRM-E4: Item / AssetFile (实体单件与存储资产)          │
│  - RustFS / S3 对象存储、SHA-256 校验、HLS 切片流      │
└────────────────────────────────────────────────────────┘
```

---

## 2. 四大独立实体枢纽 (The Four Canonical Hubs)

全库仅保留四大可独立成页的核心枢纽实体：

### 2.1 Franchise (企划 / 世界观宇宙)
- **定义**：聚合同一世界观、跨媒介（漫画+动画+游戏+影视+音乐）的超级企划。
- **正例**：`Fate 系列`、`三体宇宙`、`刀剑神域`、`明日方舟`、`赛博朋克 2077 / 边缘行者`。
- **反例**：
  - ❌ 禁止为个人作者的作品集建立 Franchise（如“久石让作品集”、“周杰伦全曲”应当由 `Artist` 枢纽聚合）；
  - ❌ 禁止为正传卷册或单季续作升级为 Franchise（单季续作使用 `Work` + `sequel_of` 边连接）。

### 2.2 Work (逻辑作品概念)
- **定义**：一部可独立指认的创作概念，聚合其所有语言翻译、再版、重制与衍生发行。
- **纯净题名规则**：
  - 严禁包含媒介载体（`TV动画`、`剧场版`、`单行本`、`EP`、`OST`）；
  - 严禁包含分卷序号（`第1卷`、`Vol.2`、`Season 1`）；
  - 严禁包含格式音质（`4K 60FPS`、`Hi-Res 24bit`、`FLAC`、`Remastered`）。

### 2.3 Release (载体发行版)
- **定义**：同一 Work 在特定时间、地域、介质与包装下的具体封装出版物。
- **包含属性**：`edition_name`、`barcode` (ISBN-13/EAN)、`catalog_number`（唱片编号）、`packaging`、`release_date`、`country`。
- **Medium & Track**：一个 Release 包含 1 到多个 Medium（如 Disc 1 CD, Disc 2 Blu-ray）；每个 Medium 包含若干有序的 Track。

### 2.4 Agent (责任主体: 创作者 / 机构 / 虚拟角色 / 乐队)
- **定义**：参与创作、演出、制作、出版的个人、法人或虚构主体。
- **实体类型 (`entity_type`)**：`person`（个人）、`group`（团体/乐队）、`organization`（机构/工作室/出版社）、`label`（唱片厂牌）、`virtual_character`（虚拟角色）、`fictional_band`（虚构乐队）。

---

## 3. 实体连接矩阵与拓扑拓扑约束 (Graph Connectivity Matrix)

| 源实体 (Source) | 目标实体 (Target) | 允许的关系谓词 (Relationship Types) | 说明与限定 |
|---|---|---|---|
| **Franchise** | **Franchise** | `part_of_franchise` | 企划嵌套（如 `FGO` 作为 `Fate 系列` 的子企划） |
| **Work** | **Franchise** | `part_of_franchise` | 作品隶属于企划 |
| **Work** | **Work** | `adaptation_of` (改编自)<br>`soundtrack_of` (原声带)<br>`sequel_of` (续作)<br>`prequel_of` (前作)<br>`spin_off_of` (衍生作品)<br>`included_in` (收录于)<br>`expansion_of` (DLC/资料片)<br>`remake_of` (重制自) | 作品间语义拓扑，**严格保持有向无环 (DAG)**，严禁自环与回环 |
| **Agent** | **Franchise** | `creator_of`, `character_in`, `imprint_of` | 创作者、企划登场角色、厂牌隶属 |
| **Agent** | **Work** | 演职员职能 (Director, Author, Illustrator, Composer, Lyricist, Arranger, Vocalist 等) + `character_in` | 演职与角色出场 |
| **Agent** | **Agent** | `voice_actor_of` (声优配音)<br>`member_of` (乐队/团体成员)<br>`real_counterpart_of` (现实真人对照乐队)<br>`alternate_form_of` (角色不同形态变体)<br>`imprint_of` (子厂牌/子出版方) | 关系多边使用 `qualifier` 标注语种或细分属性 |
| **Agent** | **Release** | 出版发行商 (Publisher, Label) | Release 外键关联 `publisher_id` |
| **CanonicalEntry**| **Work** | `included_in` | 典范条目归属于母作品 |

---

## 4. 消除 `media_type` 的多维表达体系

MetaFusion 坚决反对在主表强加 `media_type` 枚举。作品形态由四重维度正交决定：

1. **多维标签 (`tags`)**：
   - `format` 分组：`["动画", "电影"]`、`["音乐", "专辑"]`、`["轻小说"]`、`["漫画"]`、`["游戏"]`；
   - `genre` 分组：`["赛博朋克"]`、`["摇滚"]`、`["悬疑推理"]`；
   - `theme` 分组：`["机甲"]`、`["校园日常"]`；
2. **封面画幅 (`cover_aspect`)**：
   - `"1:1"` (音乐唱片/OST)；
   - `"2:3"` (电影/动画海报)；
   - `"3:4"` (书籍/漫画/轻小说)；
3. **Release 载体规格**：
   - Medium `format`: `Paperback`, `Hardcover`, `CD`, `Vinyl`, `Blu-ray`, `UHD-BD`, `Digital Book`, `Digital Album`；
4. **实体图谱边 (`entity_relationships`)**：
   - 自然区分影视原声、衍生轻小说、漫改动画。
