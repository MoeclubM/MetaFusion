# MetaFusion 标准编目与数据录入 SOP 工作流 (Cataloging SOP)

本文档为 AI Agent 与档案考据员提供严密、规范的数据创建与编辑操作流程。

---

## 阶段一：考据、检索与防重判定 (Research & Deduplication)

### 1.1 权威源检索
在录入任何新内容前，必须通过权威数据库或官方出版物交叉验证：
- **图书/文献/漫画**：ISBN 官方分配库、国图 CIP、NDL（日本国会图书馆）、豆瓣读书、各大出版社官网；
- **音乐/唱片/原声**：MusicBrainz、VGMdb、Discogs、Oricon、网易云/Apple Music 官方条目；
- **动画/电影/剧集**：TMDB、Bangumi、AniList、IMDb、文化厅媒体艺术数据库；
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
- **处理**：
  1. 剥离画质规格（1080P/BD）→ 属于 Release / Medium 载体；
  2. 剥离分季（Season 1）→ 属于 Release `edition_name`；
  3. 剥离版本（最终重制版）→ 属于 Release `packaging/edition`；
  4. 剥离集数（01-25）→ 属于 Tracks；
  5. **最终 Work 题名**：`进击的巨人` (日文原名: `進撃の巨人`)。

### 2.2 多语言本地化回退链 (i18n Fallback)
录入时必须尽可能填充多语言映射：
```json
[
  { "locale": "zh-CN", "title": "进击的巨人", "summary": "悠长的历史之中，人类曾一度因被巨人捕食而崩溃..." },
  { "locale": "zh-TW", "title": "進擊的巨人", "summary": "悠長的歷史之中，人類曾一度因被巨人捕食而崩潰..." },
  { "locale": "ja", "title": "進撃の巨人", "summary": "圧倒的な力を持つ巨人たちに怯えながら暮らす人類..." },
  { "locale": "en-US", "title": "Attack on Titan", "summary": "Centuries ago, mankind was slaughtered by monstrous humanoid creatures..." }
]
```

---

## 阶段三：出版发行树与分碟音轨结构 (Release -> Medium -> Track)

### 3.1 Release 命名与属性规范

#### 实体图书 (Printed Book)
- **Release 题名**：`{作品名} {卷号}：{卷副题名}（{装帧规格}，{出版社}，ISBN {ISBN-13}）`
- **示例**：`宿命之环 1：宿命之环（初版平装单行本，新星出版社，ISBN 9787513352887）`
- **必填**：`barcode` (必须是 13 位无分隔符纯数字或标准格式，如 `9787513352887`)、`release_date` (`YYYY-MM-DD` 或 `YYYY-MM`)、`publisher` (关联真实出版社)。

#### 网络连载/数字小说 (Web Novel / E-Book)
- **Release 题名**：`{作品名}（{平台名}官方数字连载·完结典藏版）`
- **示例**：`诡秘之主（起点中文网官方数字连载·完结典藏版）`

#### 音乐唱片 (Music CD / Vinyl / Digital)
- **Release 题名**：`{专辑名}（{盘种/规格}，{唱片编号/厂牌}）`
- **示例**：`攻壳机动队 原声大碟（初回限定盘 CD，VICL-60017，Victor Entertainment）`
- **必填**：`catalog_number` (如 `VICL-60017`)、`release_date`。

#### 影像载体 (Blu-ray / UHD-BD / DVD)
- **Release 题名**：`{作品名} {分季/分卷}（{规格/包装}，{发行厂牌}）`
- **示例**：`全职高手 第一季（4K UHD 典藏蓝光BOX，BCXA-1234，腾讯视频/阅文影视）`

### 3.2 Medium 与 Track 拆分
- `Medium 1`: `format="CD"`, `name="Disc 1"`
  - `Track 1`: `position=1`, `title="M01 - Opening Theme"`, `duration=235`
  - `Track 2`: `position=2`, `title="M02 - Main Theme"`, `duration=180`
- `Medium 2`: `format="Blu-ray"`, `name="Disc 2 (Bonus BD)"`
  - `Track 1`: `position=1`, `title="Music Video"`

---

## 阶段四：演职主体与图谱关系绑定 (Artists & Graph Edges)

### 4.1 演职员绑定
使用字典表合法谓词：
- 影视：`director` (监督/导演), `screenwriter` (编剧), `cinematographer` (摄影), `music` (配乐)；
- 文学：`author` (著作者), `illustrator` (插画师), `translator` (译者)；
- 音乐：`composer` (作曲), `lyricist` (作词), `arranger` (编曲), `performer` (演奏), `vocalist` (演唱)。

### 4.2 角色与声优标准三元组模型
严禁在作品简介里随意堆砌角色声优文字。必须按标准图谱建模：
```
[ 声优 (Agent: Person) ] ── voice_actor_of (qualifier="ja") ──► [ 角色 (Agent: Virtual Character) ]
                                                                       │
                                                                       │ character_in
                                                                       ▼
                                                          [ 作品 / 企划 (Work / Franchise) ]
```

---

## 阶段五：封面与多媒体资产管理 (Covers & Assets)

### 5.1 封面画幅与类型强制匹配
- **音乐 (1:1)**：正方形高清扫描件（推荐 ≥ 1400x1400）；
- **动画/电影 (2:3)**：竖版官方宣发海报（推荐 ≥ 1000x1500）；
- **出版物/漫画 (3:4)**：书面扫描件（推荐 ≥ 1200x1600）。

### 5.2 资源托管与安全性
- 所有图片必须转存至系统对象存储（S3 / RustFS），杜绝直接引用随时可能失效的外部防盗链图床；
- 严禁模糊网截、低质同人二次创作、占位图。

---

## 阶段六：修订记录与可追溯性 (Revisions & Audit Log)

每一次通过 API 或管理后台的修改，都必须生成不可篡改的版本快照：
- `edit_note` 明确说明：
  - ✅ "根据讲谈社官方最新出版目录，添加第 34 卷完结单行本 Release 及对应 ISBN-13"
  - ❌ "update data"（过简，拒绝）
- `source_urls` 提供实证：
  - ✅ `["https://kc.kodansha.co.jp/product?item=0000352227"]`
  - ❌ 留空或填写 `localhost`（拒绝）
