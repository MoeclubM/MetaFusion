#!/usr/bin/env node
// 领域 10「日本 TV 动画分季（每话篇目 + 声优关系）」——MetaFusion 编目战役真实数据补录
//
// 目标形状（BRIEF 第 10 行）：
//   work(animation) + 每话 content_unit(air_date / entry_role)
//     → expression（必须挂 content_unit_id）
//     → release(Blu-ray 第1卷 完全生産限定版：品番 / 发售日 / 收录话数) → medium(本編 Blu-ray + 特典CD)
//       → track(每话一条) → contents[]（引用该话的 expression）
//   关系重点：character_in / voiced_by / directed_by / sequel_of / includes
//
// 数据来源（每条写入都带 edit_note + sources，来源集中定义在下面 S 常量）：
//   · Bangumi v0 API：作品元信息（放送期间 / 话数 / 版权表记 / 监督）、每话官方题名与 air_date、角色与声优
//   · 动画官方 Blu-ray&DVD 页：品番、发售日、收录话数、特典内容、封面图（一手）
//   · 中文维基百科：zh-CN / zh-TW 题名（曼迪傳播 / bilibili 译名）与 BD 卷表（可核对二手）
// 拿不到证据的字段一律留空、不编造；判断与缺口写进 logs/anime-tv-episodes-report.md。
//
// 用法：
//   node scripts/data/campaign/domains/anime-tv-episodes.mjs --dry-run   # 只打计划（离线，不登录不写库）
//   MF_USER_PASS=… node scripts/data/campaign/domains/anime-tv-episodes.mjs   # 真跑
import { Campaign, Client, Index, src, DRY } from "../lib.mjs";

const D = "anime-tv-episodes";
const tr = (ja, cn, tw, en) => ({ "ja-JP": { title: ja }, "zh-CN": { title: cn }, "zh-TW": { title: tw }, "en-US": { title: en } });

// ── 来源清单 ───────────────────────────────────────────────────────────────
const S = {
  bgmBtr: src("https://api.bgm.tv/v0/subjects/328609", "Bangumi 条目 328609「ぼっち・ざ・ろっく！」：中文名、别名、话数 12、放送开始 2022-10-08 / 结束 2022-12-24、放送局、导演 斎藤圭一郎、版权表记"),
  bgmBtrEps: src("https://api.bgm.tv/v0/episodes?subject_id=328609&type=0&limit=100&offset=0", "Bangumi 分集接口：第1–12话官方日文题名与 air_date（2022-10-08 起每周六）"),
  bgmBtrChars: src("https://api.bgm.tv/v0/subjects/328609/characters", "Bangumi 角色接口：主角 後藤ひとり/伊地知虹夏/山田リョウ/喜多郁代 与声优 青山吉能/鈴代紗弓/水野朔/長谷川育美；配角 伊地知星歌 = 内田真礼"),
  btrBd1: src("https://bocchi.rocks/bddvd/vol1.html", "官方站 Blu-ray&DVD 第1卷页：2022.12.28 发售、Blu-ray 完全生産限定版 品番 ANZX-16341~16342、収録 #01~#02（2話収録）、仕様 2枚組(特典CD付)、特典CD = オリジナルサウンドトラックvol.1、封面图 ph_vol1.jpg"),
  btrSite: src("https://bocchi.rocks/", "官方站：第2期公布消息（監督 山本ゆうすけ、キャラクターデザイン 小田景門/けろりら、制作 CloverWorks）与版权表记 ©はまじあき／芳文社・アニプレックス"),
  zhBtr: src("https://zh.wikipedia.org/wiki/%E5%AD%A4%E7%8D%A8%E6%90%96%E6%BB%BE%EF%BC%81_(%E5%8B%95%E7%95%AB)", "中文维基条目「孤獨搖滾！ (動畫)」：繁中題名 孤獨搖滾！、第1/2季監督 齋藤圭一郎/山本ゆうすけ、劇集列表（zh-tw = 曼迪傳播译名 / zh-cn = bilibili 译名）与分集放送日"),
  bgmLy: src("https://api.bgm.tv/v0/subjects/364450", "Bangumi 条目 364450「リコリス・リコイル」：中文名 莉可丽丝、话数 13、放送开始 2022-07-02 / 结束 2022-09-24、导演 足立慎吾、版权表记 ©Spider Lily／アニプレックス・ABCアニメーション・BS11"),
  bgmLyEps: src("https://api.bgm.tv/v0/episodes?subject_id=364450&type=0&limit=100&offset=0", "Bangumi 分集接口：第1–13话官方题名与 air_date（2022-07-02 起每周六）"),
  bgmLyChars: src("https://api.bgm.tv/v0/subjects/364450/characters", "Bangumi 角色接口：主角 錦木千束/井ノ上たきな 与声优 安済知佳/若山詩音；配角 中原ミズキ = 小清水亜美、クルミ = 久野美咲"),
  lyBd1: src("https://lycoris-recoil.com/bddvd/", "官方站 Blu-ray&DVD 页：第1卷 2022年9月21日发售、Blu-ray 完全生産限定版 品番 ANZX-15301-15302、収録話数 第1話・第2話・第3話、特典CD オリジナル・サウンドトラック①、三方背ケース&デジジャケット、封面图 jk_vol01.jpg"),
  zhLy: src("https://zh.wikipedia.org/wiki/Lycoris_Recoil_%E8%8E%89%E5%8F%AF%E9%BA%97%E7%B5%B2", "中文维基条目「Lycoris Recoil 莉可麗絲」：繁中題名、登場人物繁中名（錦木千束/井之上瀧奈/中原瑞希/胡桃）、集數列表（zh-hant / zh-hans 译名）、BD 卷表（第1卷 2022-09-21 収録第1話－第3話 ANZX-15301/02）"),
};

// ── 数据表 ────────────────────────────────────────────────────────────────
const ANIPLEX = {
  key: "p-aniplex", title: "アニプレックス", types: ["organization"],
  tr: tr("アニプレックス", "Aniplex", "Aniplex", "Aniplex"), src: [S.btrBd1, S.lyBd1],
  note: "新建 agent「アニプレックス」（organization）：两卷 Blu-ray 的发行主体，取自官方 Blu-ray&DVD 页的版权表记与发售元",
};

const BOCCHI = {
  key: "btr",
  label: "ぼっち・ざ・ろっく！",
  srcEps: S.bgmBtrEps, srcChars: S.bgmBtrChars, srcZh: S.zhBtr, srcBd: S.btrBd1,
  collection: {
    title: "ぼっち・ざ・ろっく！", tr: tr("ぼっち・ざ・ろっく！", "孤独摇滚！", "孤獨搖滾！", "Bocchi the Rock!"),
    attributes: { language: "ja" }, src: [S.bgmBtr, S.zhBtr],
    note: "新建 collection「ぼっち・ざ・ろっく！」：以原作漫画（はまじあき／芳文社「まんがタイムきららMAX」連載）为根的企划聚合枢纽，经 includes 关联 TV 动画第1期/第2期；题名与繁中译名取自 Bangumi 条目 328609 与中文维基条目",
  },
  works: [
    {
      key: "w1", title: "ぼっち・ざ・ろっく！", tr: tr("ぼっち・ざ・ろっく！", "孤独摇滚！", "孤獨搖滾！", "Bocchi the Rock!"),
      attributes: {
        episodes: 12, platform: "TV", broadcast_start: "2022-10-08", broadcast_end: "2022-12-24", broadcast_weekday: "土",
        air_network: "TOKYO MX／BS11／群馬テレビ／とちぎテレビ", language: "ja", copyright: "©はまじあき／芳文社・アニプレックス",
        tags: ["TVアニメ", "2022年", "CloverWorks"],
      },
      external_ids: { bangumi: "328609" }, src: [S.bgmBtr, S.zhBtr],
      note: "新建 animation Work「ぼっち・ざ・ろっく！」（2022 年 TV 动画第1期，全 12 话）：纯题名不含季数/媒体词；话数、放送开始/结束、放送曜日、放送局、版权表记取自 Bangumi 条目 328609",
    },
    {
      key: "w2", title: "ぼっち・ざ・ろっく！第2期", tr: tr("ぼっち・ざ・ろっく！第2期", "孤独摇滚！第二季", "孤獨搖滾！第2季", "Bocchi the Rock! Season 2"),
      attributes: { platform: "TV", language: "ja", copyright: "©はまじあき／芳文社・アニプレックス", tags: ["TVアニメ", "続編", "CloverWorks"] },
      external_ids: { bangumi: "537409" }, src: [S.btrSite, S.zhBtr],
      note: "新建 animation Work「ぼっち・ざ・ろっく！第2期」：官方站已公布第2期（監督 山本ゆうすけ）；官方未公布话数与放送日，故 episodes 与放送日期字段留空，不推造",
    },
  ],
  // [话数, 官方日文题名, zh-CN(哔哩哔哩/维基), zh-TW(曼迪傳播/维基), en-US, air_date]
  episodes: [
    [1, "転がるぼっち", "孤独的转机", "翻轉孤獨", null, "2022-10-08"],
    [2, "また明日", "明天见", "明天見", null, "2022-10-15"],
    [3, "馳せサンズ", "救星赶来", "火速增員", null, "2022-10-22"],
    [4, "ジャンピングガール(ズ)", "跳跃女孩（们）", "跳躍的女孩（們）", null, "2022-10-29"],
    [5, "飛べない魚", "飞不了的鱼", "不會飛的魚", null, "2022-11-05"],
    [6, "八景", "八景", "八景", null, "2022-11-12"],
    [7, "君の家まで", "去你家", "去你的家裡", null, "2022-11-19"],
    [8, "ぼっち・ざ・ろっく", "孤独摇滚", "孤獨搖滾", null, "2022-11-26"],
    [9, "江ノ島エスカー", "江之岛扶梯", "江之島電扶梯", null, "2022-12-03"],
    [10, "アフターダーク", "天黑以后", "黑夜之後", null, "2022-12-10"],
    [11, "十二進法の夕景", "十二进制的夕景", "十二進位法的黃昏", null, "2022-12-17"],
    [12, "君に朝が降る", "愿你迎来黎明", "晨光落在你身上", null, "2022-12-24"],
  ],
  release: {
    key: "r1", work: "w1", title: "ぼっち・ざ・ろっく！ 1 Blu-ray 完全生産限定版",
    tr: tr("ぼっち・ざ・ろっく！ 1 Blu-ray 完全生産限定版", "孤独摇滚！ 第1卷 Blu-ray 完全生产限定版", "孤獨搖滾！ 第1卷 Blu-ray 完全生產限定版", "Bocchi the Rock! Vol.1 (Blu-ray Limited Edition)"),
    attributes: {
      catalog_number: "ANZX-16341~16342", edition_date: "2022-12-28", edition_type: "limited", edition_batch: "first_press",
      country: "JP", distribution_channel: "physical", platform: "Blu-ray",
    },
    picture: { url: "https://bocchi.rocks/tv/assets/img/page/bddvd/vol/ph_vol1.jpg", caption: { "ja-JP": "Blu-ray 第1巻 ジャケット（公式サイト）", "zh-CN": "第1卷 Blu-ray 封面（官方网站商品图）" } },
    src: [S.btrBd1],
    note: "新建 release「ぼっち・ざ・ろっく！ 1 Blu-ray 完全生産限定版」：官方站第1卷页给出 2022.12.28 发售、Blu-ray 完全生産限定版 品番 ANZX-16341~16342、収録 #01~#02；subjects 声明收录的动画第1期（primary）；edition_batch 按「完全生産限定版 = 初次限定生产」记 first_press",
  },
  media: [
    { key: "m1", title: "本編ディスク", tr: tr("本編ディスク", "正片光盘（Blu-ray）", "正片光碟（Blu-ray）", "Main feature disc (Blu-ray)"), attributes: { format: "bd", role: "primary" }, note: "新建 medium「本編ディスク」：官方页仕様「2枚組(特典CD付)」中的本編 Blu-ray，收录第1話・第2話" },
    { key: "m2", title: "特典CD オリジナルサウンドトラックvol.1", tr: tr("特典CD オリジナルサウンドトラックvol.1", "特典CD 原声带 vol.1", "特典CD 原聲帶 vol.1", "Bonus CD: Original Soundtrack Vol.1"), attributes: { format: "cd", role: "supplement" }, note: "新建 medium「特典CD オリジナルサウンドトラックvol.1」：官方页完全生産限定版特典「特典CD:オリジナルサウンドトラックvol.1」；该 CD 的曲目表官方未公布，故不建 Track" },
  ],
  tracks: [{ media: "m1", ep: 1 }, { media: "m1", ep: 2 }],
  agents: [
    { key: "c-hitori", types: ["character"], title: "後藤ひとり", tr: tr("後藤ひとり", "后藤一里", "後藤一里", "Hitori Gotoh"), src: [S.bgmBtrChars, S.zhBtr] },
    { key: "c-nijika", types: ["character"], title: "伊地知虹夏", tr: tr("伊地知虹夏", "伊地知虹夏", "伊地知虹夏", "Nijika Ijichi"), src: [S.bgmBtrChars, S.zhBtr] },
    { key: "c-ryo", types: ["character"], title: "山田リョウ", tr: tr("山田リョウ", "山田凉", "山田涼", "Ryo Yamada"), src: [S.bgmBtrChars, S.zhBtr] },
    { key: "c-kita", types: ["character"], title: "喜多郁代", tr: tr("喜多郁代", "喜多郁代", "喜多郁代", "Ikuyo Kita"), src: [S.bgmBtrChars, S.zhBtr] },
    { key: "c-seika", types: ["character"], title: "伊地知星歌", tr: tr("伊地知星歌", "伊地知星歌", "伊地知星歌", "Seika Ijichi"), src: [S.bgmBtrChars, S.zhBtr] },
    { key: "p-yoshino", types: ["person"], title: "青山吉能", tr: tr("青山吉能", "青山吉能", "青山吉能", "Yoshino Aoyama"), src: [S.bgmBtrChars] },
    { key: "p-suzushiro", types: ["person"], title: "鈴代紗弓", tr: tr("鈴代紗弓", "铃代纱弓", "鈴代紗弓", "Sayumi Suzushiro"), src: [S.bgmBtrChars] },
    { key: "p-mizuno", types: ["person"], title: "水野朔", tr: tr("水野朔", "水野朔", "水野朔", "Saku Mizuno"), src: [S.bgmBtrChars] },
    { key: "p-hasegawa", types: ["person"], title: "長谷川育美", tr: tr("長谷川育美", "长谷川育美", "長谷川育美", "Ikumi Hasegawa"), src: [S.bgmBtrChars] },
    { key: "p-saito", types: ["person"], title: "斎藤圭一郎", tr: tr("斎藤圭一郎", "斋藤圭一郎", "齋藤圭一郎", "Keiichiro Saito"), src: [S.bgmBtr, S.zhBtr] },
    { key: "p-yamamoto", types: ["person"], title: "山本ゆうすけ", tr: tr("山本ゆうすけ", "山本ゆうすけ", "山本ゆうすけ", "Yusuke Yamamoto"), src: [S.btrSite, S.zhBtr] },
    { key: "p-uchida", types: ["person"], title: "内田真礼", tr: tr("内田真礼", "内田真礼", "內田真禮", "Maaya Uchida"), src: [S.bgmBtrChars], reuseOnly: true },
  ],
  relations: [
    { type: "includes", from: "collection", to: "work:w1", note: "collection→work：TV 动画第1期属于「ぼっち・ざ・ろっく！」企划" },
    { type: "includes", from: "collection", to: "work:w2", note: "collection→work：TV 动画第2期属于「ぼっち・ざ・ろっく！」企划" },
    { type: "sequel_of", from: "work:w2", to: "work:w1", note: "work→work：「第2期」是「ぼっち・ざ・ろっく！」（第1期）的续作（官方站已公布第2期，監督 山本ゆうすけ）" },
    { type: "directed_by", from: "work:w1", to: "agent:p-saito", note: "监督：斎藤圭一郎（Bangumi 条目 328609 infobox「导演」）" },
    { type: "directed_by", from: "work:w2", to: "agent:p-yamamoto", note: "第2期监督：山本ゆうすけ（官方站第2期公布消息与中文维基条目）" },
    { type: "character_in", from: "agent:c-hitori", to: "work:w1", attributes: { character_rank: "main" }, note: "主角登场：後藤ひとり（Bangumi 角色接口 relation = 主角）" },
    { type: "character_in", from: "agent:c-nijika", to: "work:w1", attributes: { character_rank: "main" }, note: "主角登场：伊地知虹夏（Bangumi 角色接口 relation = 主角）" },
    { type: "character_in", from: "agent:c-ryo", to: "work:w1", attributes: { character_rank: "main" }, note: "主角登场：山田リョウ（Bangumi 角色接口 relation = 主角）" },
    { type: "character_in", from: "agent:c-kita", to: "work:w1", attributes: { character_rank: "main" }, note: "主角登场：喜多郁代（Bangumi 角色接口 relation = 主角）" },
    { type: "character_in", from: "agent:c-seika", to: "work:w1", attributes: { character_rank: "supporting" }, note: "配角登场：伊地知星歌（Bangumi 角色接口 relation = 配角）" },
    { type: "voiced_by", from: "work:w1", to: "agent:p-yoshino", character: "c-hitori", note: "配音：青山吉能 → 後藤ひとり（Bangumi 角色接口 actors）" },
    { type: "voiced_by", from: "work:w1", to: "agent:p-suzushiro", character: "c-nijika", note: "配音：鈴代紗弓 → 伊地知虹夏（Bangumi 角色接口 actors）" },
    { type: "voiced_by", from: "work:w1", to: "agent:p-mizuno", character: "c-ryo", note: "配音：水野朔 → 山田リョウ（Bangumi 角色接口 actors）" },
    { type: "voiced_by", from: "work:w1", to: "agent:p-hasegawa", character: "c-kita", note: "配音：長谷川育美 → 喜多郁代（Bangumi 角色接口 actors）" },
    { type: "voiced_by", from: "work:w1", to: "agent:p-uchida", character: "c-seika", note: "配音：内田真礼（复用目录中已存在的 agent）→ 伊地知星歌（Bangumi 角色接口 actors）" },
  ],
};

const LYCORIS = {
  key: "lyc",
  label: "リコリス・リコイル",
  srcEps: S.bgmLyEps, srcChars: S.bgmLyChars, srcZh: S.zhLy, srcBd: S.lyBd1,
  collection: null,
  works: [
    {
      key: "w1", title: "リコリス・リコイル", tr: tr("リコリス・リコイル", "莉可丽丝", "Lycoris Recoil 莉可麗絲", "Lycoris Recoil"),
      attributes: {
        episodes: 13, platform: "TV", broadcast_start: "2022-07-02", broadcast_end: "2022-09-24", broadcast_weekday: "土",
        air_network: "TOKYO MX／BS11／群馬テレビ／とちぎテレビ", language: "ja", copyright: "©Spider Lily／アニプレックス・ABCアニメーション・BS11",
        tags: ["TVアニメ", "2022年", "オリジナルアニメ"],
      },
      external_ids: { bangumi: "364450" }, src: [S.bgmLy, S.zhLy],
      note: "新建 animation Work「リコリス・リコイル」（2022 年原创 TV 动画，全 13 话）：话数、放送开始/结束、放送曜日、放送局、版权表记取自 Bangumi 条目 364450",
    },
  ],
  episodes: [
    [1, "Easy does it", "慢慢来", "不著急", "Easy does it", "2022-07-02"],
    [2, "The more the merrier", "多多益善", "越來越熱鬧", "The more the merrier", "2022-07-09"],
    [3, "More haste, less speed", "欲速则不达", "欲速則不達", "More haste, less speed", "2022-07-16"],
    [4, "Nothing seek, nothing find", "无所求则无所获", "無所求則無所獲", "Nothing seek, nothing find", "2022-07-23"],
    [5, "So far, so good", "目前情况良好", "至今還好", "So far, so good", "2022-07-30"],
    [6, "Opposites attract", "不是冤家不聚头", "不是冤家不聚頭", "Opposites attract", "2022-08-06"],
    [7, "Time will tell", "时间会证明一切", "時間會證明一切", "Time will tell", "2022-08-13"],
    [8, "Another day, another dollar", "得过且过", "做一天和尚，撞一天鐘", "Another day, another dollar", "2022-08-20"],
    [9, "What's done is done", "无可挽回", "木已成舟", "What's done is done", "2022-08-27"],
    [10, "Repay evil with evil", "以恶报恶", "以惡報惡", "Repay evil with evil", "2022-09-03"],
    [11, "Diamond cut diamond", "棋逢对手", "強中自有強中手", "Diamond cut diamond", "2022-09-10"],
    [12, "Nature versus nurture", "先天之才与后天之能", "先天與後天", "Nature versus nurture", "2022-09-17"],
    [13, "Recoil of Lycoris", "铳动彼岸花", "莉可麗絲的反擊", "Recoil of Lycoris", "2022-09-24"],
  ],
  release: {
    key: "r1", work: "w1", title: "リコリス・リコイル 1 Blu-ray 完全生産限定版",
    tr: tr("リコリス・リコイル 1 Blu-ray 完全生産限定版", "莉可丽丝 第1卷 Blu-ray 完全生产限定版", "Lycoris Recoil 莉可麗絲 第1卷 Blu-ray 完全生產限定版", "Lycoris Recoil Vol.1 (Blu-ray Limited Edition)"),
    attributes: {
      catalog_number: "ANZX-15301-15302", edition_date: "2022-09-21", edition_type: "limited", edition_batch: "first_press",
      country: "JP", distribution_channel: "physical", platform: "Blu-ray", packaging: "slipcase",
    },
    picture: { url: "https://lycoris-recoil.com/assets/img/bddvd/jk_vol01.jpg", caption: { "ja-JP": "Blu-ray 第1巻 ジャケット（公式サイト）", "zh-CN": "第1卷 Blu-ray 封面（官方网站商品图）" } },
    src: [S.lyBd1, S.zhLy],
    note: "新建 release「リコリス・リコイル 1 Blu-ray 完全生産限定版」：官方站第1卷页给出 2022年9月21日发售、品番 ANZX-15301-15302、収録話数 第1話・第2話・第3話、三方背ケース&デジジャケット；subjects 声明收录的 Work（primary）",
  },
  media: [
    { key: "m1", title: "本編ディスク", tr: tr("本編ディスク", "正片光盘（Blu-ray）", "正片光碟（Blu-ray）", "Main feature disc (Blu-ray)"), attributes: { format: "bd", role: "primary" }, note: "新建 medium「本編ディスク」：收录第1話・第2話・第3話（官方页収録話数）" },
    { key: "m2", title: "特典CD オリジナル・サウンドトラック①", tr: tr("特典CD オリジナル・サウンドトラック①", "特典CD 原声带①", "特典CD 原聲帶①", "Bonus CD: Original Soundtrack 1"), attributes: { format: "cd", role: "supplement" }, note: "新建 medium「特典CD オリジナル・サウンドトラック①」：官方页完全生産限定版特典；该 CD 的曲目表官方未公布，故不建 Track" },
  ],
  tracks: [{ media: "m1", ep: 1 }, { media: "m1", ep: 2 }, { media: "m1", ep: 3 }],
  agents: [
    { key: "c-chisato", types: ["character"], title: "錦木千束", tr: tr("錦木千束", "锦木千束", "錦木千束", "Chisato Nishikigi"), src: [S.bgmLyChars, S.zhLy] },
    { key: "c-takina", types: ["character"], title: "井ノ上たきな", tr: tr("井ノ上たきな", "井之上泷奈", "井之上瀧奈", "Takina Inoue"), src: [S.bgmLyChars, S.zhLy] },
    { key: "c-mizuki", types: ["character"], title: "中原ミズキ", tr: tr("中原ミズキ", "中原瑞希", "中原瑞希", "Mizuki Nakahara"), src: [S.bgmLyChars, S.zhLy] },
    { key: "c-kurumi", types: ["character"], title: "クルミ", tr: tr("クルミ", "胡桃", "胡桃", "Kurumi"), src: [S.bgmLyChars, S.zhLy] },
    { key: "p-anzai", types: ["person"], title: "安済知佳", tr: tr("安済知佳", "安济知佳", "安濟知佳", "Chika Anzai"), src: [S.bgmLyChars, S.zhLy] },
    { key: "p-wakayama", types: ["person"], title: "若山詩音", tr: tr("若山詩音", "若山诗音", "若山詩音", "Shion Wakayama"), src: [S.bgmLyChars] },
    { key: "p-kuno", types: ["person"], title: "久野美咲", tr: tr("久野美咲", "久野美咲", "久野美咲", "Misaki Kuno"), src: [S.bgmLyChars] },
    { key: "p-adachi", types: ["person"], title: "足立慎吾", tr: tr("足立慎吾", "足立慎吾", "足立慎吾", "Shingo Adachi"), src: [S.bgmLy] },
    { key: "p-koizumi", types: ["person"], title: "小清水亜美", tr: tr("小清水亜美", "小清水亚美", "小清水亞美", "Ami Koshimizu"), src: [S.bgmLyChars], reuseOnly: true },
  ],
  relations: [
    { type: "directed_by", from: "work:w1", to: "agent:p-adachi", note: "监督：足立慎吾（Bangumi 条目 364450 infobox「导演」）" },
    { type: "character_in", from: "agent:c-chisato", to: "work:w1", attributes: { character_rank: "main" }, note: "主角登场：錦木千束（Bangumi 角色接口 relation = 主角）" },
    { type: "character_in", from: "agent:c-takina", to: "work:w1", attributes: { character_rank: "main" }, note: "主角登场：井ノ上たきな（Bangumi 角色接口 relation = 主角）" },
    { type: "character_in", from: "agent:c-mizuki", to: "work:w1", attributes: { character_rank: "supporting" }, note: "配角登场：中原ミズキ（Bangumi 角色接口 relation = 配角）" },
    { type: "character_in", from: "agent:c-kurumi", to: "work:w1", attributes: { character_rank: "supporting" }, note: "配角登场：クルミ（Bangumi 角色接口 relation = 配角）" },
    { type: "voiced_by", from: "work:w1", to: "agent:p-anzai", character: "c-chisato", note: "配音：安済知佳 → 錦木千束（Bangumi 角色接口 actors）" },
    { type: "voiced_by", from: "work:w1", to: "agent:p-wakayama", character: "c-takina", note: "配音：若山詩音 → 井ノ上たきな（Bangumi 角色接口 actors）" },
    { type: "voiced_by", from: "work:w1", to: "agent:p-koizumi", character: "c-mizuki", note: "配音：小清水亜美（复用目录中已存在的 agent）→ 中原ミズキ（Bangumi 角色接口 actors）" },
    { type: "voiced_by", from: "work:w1", to: "agent:p-kuno", character: "c-kurumi", note: "配音：久野美咲 → クルミ（Bangumi 角色接口 actors）" },
  ],
};

const FRANCHISES = [BOCCHI, LYCORIS];

// ── 主流程 ────────────────────────────────────────────────────────────────
const plan = { units: [], exprs: [], releases: [], media: [], tracks: [], relations: [], works: [], agents: [] };
const ev = (note, sources) => ({ note: "编目战役·" + D + "：" + note, sources });

const RESUME = process.argv.includes("--resume"); // 重跑/补写：先把线上现存实体灌进本地索引，避免重复建
const client = new Client();
if (!DRY) await client.login();
const camp = new Campaign({ domain: D, client, index: Index.load() });
if (!DRY && RESUME) {
  for (const kind of ["collection", "work", "agent", "content_unit", "expression", "release", "medium", "track"]) {
    const rows = await client.listKind(kind);
    for (const row of rows) camp.index.add(row);
    console.log("[resume] 预载 " + kind + " × " + rows.length);
  }
}

// 0) 发行主体（两个 release 共用）
const pub = await camp.ensureEntity("agent", ANIPLEX.title, {
  original_language: "ja", types: ANIPLEX.types, translations: ANIPLEX.tr, attributes: {}, external_ids: {},
}, ev(ANIPLEX.note, ANIPLEX.src), { idemKey: D + "-" + ANIPLEX.key, allowServerLookup: !DRY });
plan.agents.push({ key: ANIPLEX.key, id: pub.id, title: ANIPLEX.title });

const skip = !DRY; // 真跑按 type+两端+属性幂等跳过；dry-run 不查关系

for (const f of FRANCHISES) {
  const ids = { work: {}, cu: {}, expr: {}, media: {} };

  // 1) collection
  if (f.collection) {
    const col = await camp.ensureEntity("collection", f.collection.title, {
      original_language: "ja", types: ["collection"], translations: f.collection.tr, attributes: f.collection.attributes, external_ids: {},
    }, ev(f.collection.note, f.collection.src), { idemKey: D + "-" + f.key + "-col", allowServerLookup: !DRY });
    ids.collection = col.id;
  }

  // 2) works
  for (const w of f.works) {
    const ent = await camp.ensureEntity("work", w.title, {
      original_language: "ja", types: ["animation"], translations: w.tr, attributes: w.attributes, external_ids: w.external_ids,
    }, ev(w.note, w.src), { idemKey: D + "-" + f.key + "-work-" + w.key, allowServerLookup: !DRY });
    ids.work[w.key] = ent.id;
    plan.works.push({ id: ent.id, title: w.title, key: f.key + "/" + w.key });
  }

  // 3) agents（角色 / 声优 / 监督）；reuseOnly 的题名在索引里已有 → 复用
  for (const a of f.agents) {
    const ent = await camp.ensureEntity("agent", a.title, {
      original_language: "ja", types: a.types, translations: a.tr, attributes: {}, external_ids: {},
    }, ev("新建 agent「" + a.title + "」（" + a.types[0] + "）：" + (a.types[0] === "character" ? "虚构角色，登场见 character_in" : "责任主体（声优/监督），署名见 voiced_by / directed_by") + "；题名与角色-声优对应取自 Bangumi 角色接口", a.src),
      { idemKey: D + "-" + f.key + "-agent-" + a.key, allowServerLookup: !DRY });
    plan.agents.push({ key: a.key, id: ent.id, title: a.title });
  }

  // 4) content_unit（每话篇目）
  for (const ep of f.episodes) {
    const [n, ja, cn, tw, en, air] = ep;
    const cu = await camp.ensureEntity("content_unit", ja, {
      work_id: ids.work.w1, position: n, number: String(n),
      original_language: "ja", types: ["content_unit"],
      translations: tr(ja, cn, tw, en || ja),
      attributes: { air_date: air, entry_role: "main", language: "ja" },
      external_ids: {},
    }, ev("新建 content_unit「第" + n + "話 " + ja + "」：" + f.label + " 的篇目目录层；轴题名与 air_date 取自 Bangumi 分集接口，zh-CN/zh-TW 题名取自中文维基剧集列表（曼迪傳播 / bilibili）", [f.srcEps, f.srcZh]),
      { idemKey: D + "-" + f.key + "-cu-" + n, allowServerLookup: false, scope: { work_id: ids.work.w1 } });
    ids.cu[n] = cu.id;
    plan.units.push({ id: cu.id, workId: ids.work.w1, number: String(n), air, title: ja });
  }

  // 5) expression（承载链覆盖到的那几话，必须挂 content_unit_id）
  for (const t of f.tracks) {
    const ep = f.episodes.find((e) => e[0] === t.ep);
    const n = ep[0];
    const ex = await camp.ensureEntity("expression", ep[1], {
      work_id: ids.work.w1, content_unit_id: ids.cu[n], position: n,
      original_language: "ja", types: ["expression"],
      translations: tr(ep[1], ep[2], ep[3], ep[4] || ep[1]),
      attributes: { language: "ja", version_label: "本編" },
      external_ids: {},
    }, ev("新建 expression（第" + n + "話 本編）：可被后续发行复用的那一层表达，用 content_unit_id 挂到第" + n + "話篇目；收录于「" + f.release.title + "」", [f.srcBd, f.srcEps]),
      { idemKey: D + "-" + f.key + "-expr-" + n, allowServerLookup: false, scope: { work_id: ids.work.w1 } });
    ids.expr[n] = ex.id;
    plan.exprs.push({ id: ex.id, workId: ids.work.w1, cuId: ids.cu[n], title: ep[1] });
  }

  // 6) release（subjects 覆盖该发行全部 track contents 引用表达所属的 Work）
  const r = f.release;
  const attrs = { ...r.attributes, publisher: pub.id };
  const pictures = r.picture ? [{
    url: r.picture.url, caption: r.picture.caption,
    source: { kind: "url", url: r.src[0].url, citation: "官方站 Blu-ray&DVD 商品页商品图" },
  }] : undefined;
  const rel = await camp.ensureEntity("release", r.title, {
    original_language: "ja", types: ["release"], translations: r.tr, attributes: attrs, external_ids: {},
    subjects: [{ work_id: ids.work[r.work], role: "primary", position: 0 }],
    pictures,
  }, ev(r.note, r.src), { idemKey: D + "-" + f.key + "-release-" + r.key, allowServerLookup: false });
  const releaseId = rel.id;
  plan.releases.push({ id: releaseId, subjectWorkIds: [ids.work[r.work]], catalog: r.attributes.catalog_number, title: r.title });

  // 7) medium
  let pos = 1;
  for (const m of f.media) {
    const med = await camp.ensureEntity("medium", m.title, {
      release_id: releaseId, position: pos++,
      original_language: "ja", types: ["medium"], translations: m.tr, attributes: m.attributes, external_ids: {},
    }, ev(m.note, r.src), { idemKey: D + "-" + f.key + "-medium-" + m.key, allowServerLookup: false, scope: { release_id: releaseId } });
    ids.media[m.key] = med.id;
    plan.media.push({ id: med.id, releaseId, title: m.title });
  }

  // 8) track（每话一条，contents 引用该话 expression）
  let tpos = 0;
  for (const t of f.tracks) {
    const ep = f.episodes.find((e) => e[0] === t.ep);
    const track = await camp.ensureEntity("track", ep[1], {
      medium_id: ids.media[t.media], position: ++tpos, number: String(t.ep),
      original_language: "ja", types: ["track"],
      translations: tr(ep[1], ep[2], ep[3], ep[4] || ep[1]),
      attributes: { role: "primary" },
      external_ids: {},
      contents: [{ expression_id: ids.expr[t.ep], position: 1, locator: null }],
    }, ev("新建 track（第" + t.ep + "話「" + ep[1] + "」）：contents 引用第" + t.ep + "話本編 expression；收录位置与收录话数来自官方 Blu-ray&DVD 页", [r.src[0], f.srcEps]),
      { idemKey: D + "-" + f.key + "-track-" + t.ep, allowServerLookup: false, scope: { medium_id: ids.media[t.media] } });
    plan.tracks.push({ id: track.id, mediumId: ids.media[t.media], releaseId, expressionIds: [ids.expr[t.ep]], title: ep[1] });
  }

  // 9) 关系
  for (const rl of f.relations) {
    const from = resolveRef(rl.from, ids, plan);
    const to = resolveRef(rl.to, ids, plan);
    const attributes = { ...(rl.attributes || {}) };
    if (rl.character) attributes.character = resolveRef("agent:" + rl.character, ids, plan);
    if (rl.type === "voiced_by") attributes.language = "ja";
    const created = await camp.createRelation(rl.type, from, to, ev(rl.note, [f.srcChars, f.srcZh]), {
      attributes, idemKey: D + "-" + f.key + "-rel-" + rl.type + "-" + rl.from.replace(/:/g, "_") + "-" + rl.to.replace(/:/g, "_"), skipIfExists: skip,
    });
    plan.relations.push({ id: created.id, type: rl.type, sourceId: from, targetId: to, attributes, label: rl.type + " " + rl.from + " → " + rl.to });
  }
}

function resolveRef(ref, ids, plan) {
  if (ref === "collection") return ids.collection;
  if (ref.startsWith("work:")) return ids.work[ref.slice(5)];
  if (ref.startsWith("agent:")) {
    const hit = plan.agents.find((a) => a.key === ref.slice(6));
    if (!hit) throw new Error("找不到 agent 参照：" + ref);
    return hit.id;
  }
  throw new Error("无法解析参照：" + ref);
}

if (DRY) {
  console.log("\n[dry-run] 计划：" + (plan.works.length + plan.units.length + plan.exprs.length + plan.releases.length + plan.media.length + plan.tracks.length + plan.agents.length)
    + " 个实体（work " + plan.works.length + " / content_unit " + plan.units.length + " / expression " + plan.exprs.length
    + " / release " + plan.releases.length + " / medium " + plan.media.length + " / track " + plan.tracks.length + " / agent " + plan.agents.length
    + "） + " + plan.relations.length + " 条关系");
  console.log("[dry-run] 未登录、未写库；去掉 --dry-run 即真跑。");
  camp.summary();
  process.exit(0);
}

// ── 写后回读断言（结构归属 / subjects 覆盖 / 关系两端 / revisions）──────────
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const get = (id) => camp.getEntity(id);

for (const u of plan.units) {
  const e = await get(u.id);
  ok(e.kind === "content_unit" && e.work_id === u.workId, "content_unit「" + u.title + "」work_id 归属不符：" + e.work_id);
  ok(String((e.attributes || {}).air_date || "") === u.air, "content_unit「" + u.title + "」air_date 不符：" + (e.attributes || {}).air_date);
  ok(String(e.number) === u.number, "content_unit「" + u.title + "」number 不符：" + e.number);
}
for (const x of plan.exprs) {
  const e = await get(x.id);
  ok(e.kind === "expression" && e.work_id === x.workId, "expression「" + x.title + "」work_id 不符：" + e.work_id);
  ok(e.content_unit_id === x.cuId, "expression「" + x.title + "」content_unit_id 未挂上：" + e.content_unit_id);
  ok(!e.parent_id, "expression「" + x.title + "」不应有 parent_id");
}
for (const m of plan.media) {
  const e = await get(m.id);
  ok(e.kind === "medium" && e.release_id === m.releaseId, "medium「" + m.title + "」release_id 不符：" + e.release_id);
}
for (const t of plan.tracks) {
  const e = await get(t.id);
  ok(e.kind === "track" && e.medium_id === t.mediumId, "track「" + t.title + "」medium_id 不符：" + e.medium_id);
  const refs = (e.contents || []).map((c) => c.expression_id);
  ok(refs.length === t.expressionIds.length && t.expressionIds.every((i) => refs.includes(i)), "track「" + t.title + "」contents 引用不符：" + JSON.stringify(refs));
}
for (const r of plan.releases) {
  const e = await get(r.id);
  ok(!e.work_id, "release「" + r.title + "」不应有 work_id");
  ok(String((e.attributes || {}).catalog_number || "") === r.catalog, "release「" + r.title + "」catalog_number 不符：" + (e.attributes || {}).catalog_number);
  const subj = new Set((e.subjects || []).map((s) => s.work_id));
  for (const w of r.subjectWorkIds) ok(subj.has(w), "release「" + r.title + "」subjects 缺 Work " + w);
  for (const t of plan.tracks.filter((x) => x.releaseId === r.id)) {
    for (const exId of t.expressionIds) {
      const ex = await get(exId);
      ok(!!ex.content_unit_id, "track 引用的 expression「" + ex.title + "」没有 content_unit_id");
      ok(subj.has(ex.work_id), "release「" + r.title + "」subjects 未覆盖收录表达所属 Work " + ex.work_id);
    }
  }
}
for (const rl of plan.relations) {
  const edges = await client.relationsOf(rl.sourceId);
  const hit = edges.find((x) => x.type === rl.type && x.target_id === rl.targetId && !x.via);
  ok(!!hit, "关系回读缺失：" + rl.label);
  if (hit && rl.attributes.character) ok((hit.attributes || {}).character === rl.attributes.character, "关系属性 character 不符：" + rl.label);
  if (hit && rl.type === "voiced_by") ok((hit.attributes || {}).language === "ja", "voiced_by 缺 language=ja：" + rl.label);
}
for (const w of plan.works) {
  const rv = await client.call("/api/catalog/entities/" + w.id + "/revisions");
  ok(rv.status === 200 && (((rv.body || {}).items) || []).length >= 1, "work「" + w.title + "」revisions 缺失（status " + rv.status + "）");
}

const out = camp.summary({ assertions: { checked: plan.units.length + plan.exprs.length + plan.releases.length + plan.media.length + plan.tracks.length + plan.relations.length + plan.works.length, failed: fails.length } });
console.log("\n=== 写后回读断言 ===");
console.log("  失败 " + fails.length + " 项");
for (const m of fails) console.log("  FAIL " + m);
if (fails.length || out.failed.length) process.exit(1);
console.log("断言全部通过；明细见 " + camp.logFile);
