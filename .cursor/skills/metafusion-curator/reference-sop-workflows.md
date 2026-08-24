# MetaFusion 标准编目与数据录入 SOP 工作流 (Cataloging SOP)

本文档为 AI Agent 与档案考据员提供严密、规范的数据创建与编辑操作流程。

---

## 阶段一：考据、检索与防重判定 (Research & Deduplication)

### 1.1 权威源检索与交叉比对
在录入任何新内容前，必须通过权威数据库或官方出版物交叉验证并留存证据链接：
- **图书/文献/漫画**：ISBN 官方分配库、国图 CIP、NDL（日本国会图书馆）、豆瓣读书、各大出版社官网（新星、上海译文等）；
- **音乐/唱片/原声**：MusicBrainz、VGMdb、Discogs、Oricon、网易云/Apple Music/Tidal 官方条目；
- **动画/电影/剧集**：TMDB、Bangumi、AniList、IMDb、文化厅媒体艺术数据库、出品方官网（如东宝、吉卜力官网）；
- **游戏**：VNDB、IGDB、Steam、PlayStation Store、Nintendo eShop。

### 1.2 全库检索防重
调用平台搜索接口：
```bash
GET /api/v1/search?q={关键词}&type=all
```
- **情况 A (完全存在)**：若目标作品 Work 已存在，切勿重复创建 Work。仅需在其下新建 Release 或补充缺失的 Translations / Tags / Relations。
- **情况 B (部分存在/别名)**：比对原名与别名，若存在拼写变体，更新现有 Work 的 `aliases` 与 `translations`。
- **情况 C (确属新作品)**：进入阶段二创建全套结构。

---

## 阶段二：纯净题名与多语言构建 (Pure Title & i18n)

### 2.1 纯净题名清洗原则
- **输入**：“【1080P/BD】进击的巨人 Season 1 最终重制版 [01-25]”
- **处理步骤**：
  1. 剥离画质与载体（1080P/BD）→ 移入 Release / Medium 载体属性；
  2. 剥离分季与卷次（Season 1）→ 移入 Release `edition_name`；
  3. 剥离版本说明（最终重制版）→ 移入 Release `packaging` / `edition_name`；
  4. 剥离集数分轨（[01-25]）→ 展开为 25 条 Tracks；
  5. **最终 Work 题名**：`进击的巨人` (日文原名: `進撃の巨人`)。

### 2.2 多语言本地化回退链构建 (i18n Fallback)
创建或更新实体时必须提供 `original_language`，并在 `translations` 中提供多语言对齐：
```json
[
  { "locale": "zh-CN", "title": "流浪地球", "summary": "太阳即将毁灭，人类在地球表面建造出巨大的推进器..." },
  { "locale": "zh-TW", "title": "流浪地球", "summary": "太陽即將毀滅，人類在地球表面建造出巨大的推進器..." },
  { "locale": "en-US", "title": "The Wandering Earth", "summary": "The sun is dying out, people around the globe build giant planetary thrusters..." }
]
```

---

## 阶段三：LRM 录音分层与发行版树状建模 (Work -> Entry -> Release -> Medium -> Track)

### 3.1 词曲创作 (Work) 与 录音演职 (Recording) 分离录入
1. **在 Work 级绑定创作人**：
   - 歌曲《晴天》Work：`composer` -> 周杰伦，`lyricist` -> 周杰伦；
2. **在 CanonicalEntry 级绑定录音制作人**：
   - 《晴天 (Master Recording)》CanonicalEntry：`performer` -> 周杰伦，`arranger` -> 赖伟锋/周杰伦，`producer` -> 周杰伦，`phonographic_copyright` -> 杰威尔音乐；
3. **在 Track 级关联物理分轨与 CanonicalEntry**：
   - Track 绑定该 `canonical_entry_id`，实现跨发行版本自由复用。

### 3.2 发行版 Release 命名标准
- **实体图书**：`{作品名} {卷号}：{卷副题名}（{装帧规格}，{出版社}，ISBN {ISBN-13}）`
  - 例：`宿命之环 1：宿命之环（初版平装单行本，新星出版社，ISBN 9787513352887）`
- **网络连载**：`{作品名}（{平台名}官方数字连载·完结典藏版）`
  - 例：`诡秘之主（起点中文网官方数字连载·完结典藏版）`
- **音乐唱片**：`{专辑名}（{盘种/规格}，{唱片编号/厂牌}）`
  - 例：`攻壳机动队 原声大碟（初回限定盘 CD，VICL-60017，Victor Entertainment）`
- **影视影碟**：`{作品名} {分季/分卷}（{规格/包装}，{发行厂牌}，{品番}）`
  - 例：`千与千寻（日本院线官方初版蓝光，VWBS-1530，Walt Disney Studios Japan）`

### 3.3 多作品全集盒装 (Multi-Work Boxset) 录入实操
**案例：宮崎駿監督作品集 13BD 大盒装 (`VWBS-1531`)**
1. 创建汇编 Work：《宮崎駿監督作品集》；
2. 创建 Release：《宮崎駿監督作品集（13BD 豪华限定盒装，VWBS-1531，Walt Disney Studios Japan）》；
3. 建立 13 个 Medium：
   - `Medium 1`: `format="Blu-ray"`, `name="Disc 1: ルパン三世 カリオストロの城"`
   - `Medium 8`: `format="Blu-ray"`, `name="Disc 8: 千と千尋の神隠し"`
4. 将 Medium 8 的 Track 关联至母作品《千与千寻》的电影母版；
5. 在图谱中建立 `included_in` 边连接《千与千寻》与《宮崎駿監督作品集》；
6. 严格检查：单部作品《千与千寻》**绝不能**填写 `VWBS-1531`，其独立单行本为 `VWBS-1530`。

---

## 阶段四：跨媒介企划与 DAG 拓扑图谱构建 (Franchise & DAG Edges)

### 4.1 企划聚合
对于《流浪地球》或《三体》：
1. 创建或获取 `Franchise` 实体（如 `流浪地球系列企划`）；
2. 将原著小说、第一部电影、第二部电影、原声大碟等通过 `part_of_franchise` 关联至该企划。

### 4.2 语义关系边织网
- 小说与电影：`电影1 adaptation_of 原著小说`；
- 电影与前传：`电影2 prequel_of 电影1`（或 `电影1 sequel_of 电影2`，单向选择保持 DAG）；
- 电影与原声带：`原声大碟 soundtrack_of 电影1`；
- 联动作品：`A crossover_with B`；
- 角色与声优：`声优 voice_actor_of (qualifier="ja") 角色`，`角色 character_in 作品`。

---

## 阶段五：封面与多媒体资产鉴伪校准 (Cover QA & Ingestion)

### 5.1 封面画幅与分辨率匹配
- **音乐 (1:1)**：正方形高清扫描件（推荐 ≥ 1400×1400）；
- **动画/电影 (2:3)**：竖版官方宣发海报（推荐 ≥ 1000×1500）；
- **出版物/漫画 (3:4)**：书面扫描件（推荐 ≥ 1200×1600）。

### 5.2 资源托管与防伪
- 将图片上传至 MetaFusion RustFS/S3 对象存储，获得持久化 URL；
- 坚决杜绝带有其他盗版网站水印、占位图、带腰封折痕图或剧照拼接图。

---

## 阶段六：不可篡改版本快照与审计日志 (Audit & Snapshot)

每一次数据变更，必须在请求 Payload 中附带审计元数据：
```json
{
  "edit_note": "根据讲谈社官方最新出版目录，添加第 34 卷完结单行本 Release 及对应 ISBN-13 与分盘曲目",
  "source_urls": [
    "https://kc.kodansha.co.jp/product?item=0000352227"
  ]
}
```
- 若 `edit_note` 为空或泛泛而谈（如 "update"），审查系统将自动拦截；
- `source_urls` 必须为有效合法的公开网络 URL。
