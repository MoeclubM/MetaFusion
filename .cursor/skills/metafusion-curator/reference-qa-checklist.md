# MetaFusion 编目审查与数据质检规范 (QA & Review Checklist)

本文档定义 MetaFusion 考据员与自动化审查 Agent 进行元数据校验、巡检、合规阻断与合并的详细规则集。

---

## 1. 纯净题名审查 (Work Pure Title Inspection)

### 1.1 污染词汇黑名单拦截表
Work 题名若命中以下模式，判定为**不合规 (Dirty Title)**，审查必须直接拦截或驳回：

| 污染类型 | 违规模式 (Regex / Keyword) | 正确归宿 |
|---|---|---|
| **媒介/格式声明** | `TV(动画)?`, `剧场版`, `OVA`, `OAD`, `Web连载`, `单行本`, `漫画版`, `广播剧`, `OST`, `原声带` | 移入 Work `tags`、语义关系边或 Release 规格 |
| **季数与分卷** | `第[0-9一二三四]季`, `Season\s*\d+`, `Vol(ume)?\.\s*\d+`, `第[0-9]+卷`, `S\d+` | 移入 Release `edition_name` |
| **分辨率与音质** | `1080[pP]`, `4[kK]`, `UHD`, `Hi-Res`, `24bit/96kHz`, `FLAC`, `MP3`, `DSD`, `720[pP]` | 移入 Medium / Asset 属性 |
| **压制/字幕组** | `\[.*?字幕组\]`, `\[.*?Rip\]`, `\[Web-DL\]`, `【.*?压制】`, `x264`, `x265`, `HEVC` | 严禁入库，彻底剔除 |
| **发行限定词** | `初回限定[盘版]`, `通常[盘版]`, `完全生产限定`, `豪华版`, `Remaster(ed)?`, `BOX` | 移入 Release `edition_name` / `packaging` |

---

## 2. 盒装合集审查 (Boxset & Compilation QA)

- [ ] **全集品番隔离**：检查单部作品 Release 上的 `catalog_number` 与 `barcode` 是否为单部独立单行本（如千与千寻为 `VWBS-1530`），严禁挂载全集盒装品番（如 `VWBS-1531`）。
- [ ] **分碟完整度**：合集盒装 Release 的 Medium 数量必须与官方包装介质数量 1:1 吻合。
- [ ] **母版回溯关联**：盒装内各分碟 Track 必须精确链接至对应独立母体作品的 `CanonicalEntry` / `Work`。

---

## 3. 封面合规性与画幅审查 (Cover Quality & Aspect QA)

- [ ] **比例一致性**：检查 `works.cover_aspect` 与实际图片的像素宽高比是否匹配（允许 ±5% 误差容限）：
  - `1:1` (音乐唱片/OST): 宽高比介于 `0.95` 与 `1.05` 之间；
  - `2:3` (影视/动画): 宽高比介于 `0.63` 与 `0.70` 之间；
  - `3:4` (书籍/漫画): 宽高比介于 `0.71` 与 `0.79` 之间。
- [ ] **画质分辨率**：
  - 1:1 图片 ≥ 1000 × 1000 px（推荐 ≥ 1400 × 1400 px）；
  - 2:3 图片 ≥ 1000 × 1500 px；
  - 3:4 图片 ≥ 1200 × 1600 px。
- [ ] **图源纯净度**：无第三方网站水印、无剧照截屏拼接、无模糊扫描畸变。
- [ ] **防占位图**：严禁出现默认空图、纯色背景图或写有“暂无封面”的图片。

---

## 4. 标准编码与标识符校验 (Barcode & External ID QA)

### 4.1 ISBN-13 模 10 校验算法
所有图书出版物 Release 的 `barcode` 必须为有效 13 位数字（无破折号纯数字或标准格式）：
$$\left( \sum_{i=1}^{12} d_i \times (1 \text{ if } i \text{ is odd else } 3) + d_{13} \right) \equiv 0 \pmod{10}$$

### 4.2 唱片编号 (Catalog Number) 规范
- 格式应为：`[厂牌代码]-[数字编号]`（如 `VICL-60017`, `SVWC-70001`, `VWBS-1530`, `BCQA-0001`）；
- 严禁填写自定义描述文本（如“自购正版”）。

### 4.3 ISRC (国际标准录音制品编码)
- 格式：`CC-XXX-YY-NNNNN`（如 `JP-B01-20-00123`, `CN-A01-19-00456`）；
- 必须与对应 Track / CanonicalEntry 绑定。

---

## 5. 关系拓扑闭环与 DAG 校验 (Graph Topology & DAG QA)

- [ ] **有向无环性 (Acyclic Rule)**：作品间的 `sequel_of`、`prequel_of`、`adaptation_of` 绝不能形成闭环（如 A 是 B 的续作，B 又被指向为 A 的续作）。
- [ ] **禁止自引用 (No Self-Loop)**：`source_id != target_id`。
- [ ] **端点类型合法性**：严格满足连接矩阵（如 `soundtrack_of` 源端与宿端均必须为 Work）。
- [ ] **单实体原则**：同一人物的跨作品登场通过多条 `character_in` 关联，严禁分裂实体。
- [ ] **Qualifier 区分多边**：对于同对实体的同类多边（如日配/中配声优），必须使用 `qualifier` 标注。

---

## 6. 全栈多语言与审计流检查 (i18n & Audit QA)

- [ ] **多语言完整度**：`original_language` 必须非空；`translations` 数组必须至少包含一种官方/主要语言。
- [ ] **UI 零硬编码**：检查前端组件中是否存在任何未通过 `useI18n()` 或 `t()` 翻译的写死中文或英文。
- [ ] **审计元数据**：
  - `edit_note` 长度 ≥ 10 字符，明确说明考据来源与变更内容；
  - `source_urls` 至少包含 1 条权威公开链接（MusicBrainz / NDL / TMDB / 出版社官网等）。
