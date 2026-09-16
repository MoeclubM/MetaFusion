#!/usr/bin/env node
// 领域 18「广播剧 / ドラマCD」真实数据补录（编目战役）。
//
// 数据全部来自可核对来源：
//   · MusicBrainz release（品番 / 条码 / 发行日 / 地区 / 盘数 / 曲目题名与时长 / 曲目出演クレジット）
//   · 日文维基（登场人物 cast、原作关系、ディスコグラフィ上的品番）与中文维基（中文题名）
//   · Bangumi 条目（发行日与价格交叉核对）
// 层级形状（BRIEF 领域 18）：work + 话 content_unit → expression（配音演出，挂 content_unit_id）
//   → release（品番）→ medium(cd) → track → contents[]（引用该篇目的 expression）。
// 用法：node scripts/data/campaign/domains/audio-drama-cd.mjs [--dry-run]

import { Campaign, Client, Index, src, DRY } from "../lib.mjs";

/** 四语题名：没有官方译名时按 BRIEF 用原文题名（绝不编造）。 */
const loc4 = (ja, zhCN, zhTW, en) => ({
  "ja-JP": { title: ja },
  "zh-CN": { title: zhCN || ja },
  "zh-TW": { title: zhTW || ja },
  "en-US": { title: en || ja },
});

const ev = (note, sources) => ({ note, sources });
const sec = (ms) => Math.round(ms / 1000);

// ── 来源清单 ────────────────────────────────────────────────────────────────
const S = {
  mbAmagi: src(
    "https://musicbrainz.org/release/74b8cc06-6f08-4405-ba76-55a901169e2d",
    "MusicBrainz 发行『TVアニメ「甘城ブリリアントパーク」ドラマCD』：品番 VTCL-60387（label flying DOG）、条码 4580325319064、发行日 2014-12-24、地区 JP、1×CD、3 曲题名与时长、曲目クレジット（可児江西也/内山昂輝・千斗いすず/加隈亜衣 等の役名＋声優表記）",
  ),
  wikiAmagi: src(
    "https://ja.wikipedia.org/wiki/甘城ブリリアントパーク",
    "登场人物：可児江西也＝内山昂輝、千斗いすず＝加隈亜衣；ディスコグラフィに「TVアニメ「甘城ブリリアントパーク」ドラマCD」＝VTCL-60387",
  ),
  bgmAmagi: src(
    "https://bgm.tv/subject/119620",
    "Bangumi 条目「甘城ブリリアントパーク ドラマCD」：发售日 2014-12-24、价格 ￥2,160、碟片数 1（与 MusicBrainz 交叉核对）",
  ),
  zhAmagi: src(
    "https://zh.wikipedia.org/wiki/甘城輝煌樂園救世主",
    "中文题名：zh-TW「甘城輝煌樂園救世主」（臺灣角川轻小说／动画译名），zh-CN 简体同形",
  ),

  mbMaria: src(
    "https://musicbrainz.org/release/4e5bff35-126f-4d9d-90da-98ce32a5ea13",
    "MusicBrainz 发行『TVアニメ「まりあ†ほりっく」ドラマCD』：品番 MFCZ-1001（label Frontier Works）、条码 4562207970709、发行日 2009-04-24、地区 JP、1×CD、5 曲（第一話〜第四話＋おまけ「茉莉花日誌」、曲目クレジットは「脚本: 横谷昌宏」）",
  ),
  wikiMaria: src(
    "https://ja.wikipedia.org/wiki/まりあ†ほりっく",
    "主要人物：宮前かなこ、衹堂鞠也（TV アニメ の声は順に真田アサミ／小林ゆう、2008-07-25 発売の先行ドラマCD ではかなこ役が平野綾と注記）；ドラマCD 節に 2009年4月24日発売の記載、シリーズ構成・脚本＝横谷昌宏",
  ),
  zhMaria: src(
    "https://zh.wikipedia.org/wiki/瑪莉亞狂熱",
    "中文题名：zh-TW「瑪莉亞狂熱」（日語：まりあ†ほりっく），zh-CN 简体「玛莉亚狂热」",
  ),

  mbAwsao: src(
    "https://musicbrainz.org/release/25126214-c019-4692-893b-9de4d1e493e1",
    "MusicBrainz 发行『アクセル・ワールド+ソードアート・オンライン ドラマCD』：品番 MNCA-9051（label アスキー・メディアワークス）、条码 4942330050880、2×CD、4 曲（媒体1：ハルユキの災難／キリトの受難、媒体2：バーサス／『AW』&『SAO』キャストトーク集、各曲の时长）",
  ),
  wikiSaoDisc: src(
    "https://ja.wikipedia.org/wiki/ソードアート・オンラインのディスコグラフィ",
    "『アクセル・ワールド+ソードアート・オンライン ドラマCD』2012年4月6日発売；収録内容＝第1話『ハルユキの災難』（出演 ハルユキ〈梶裕貴〉ほか）、第2話『キリトの受難』（出演 キリト〈松岡禎丞〉・シノン〈沢城みゆき〉ほか）、第3話『バーサス』、スペシャル『AW』&『SAO』キャストトーク集；特典同梱の記載",
  ),
  wikiAw: src(
    "https://ja.wikipedia.org/wiki/アクセル・ワールド",
    "登場人物：ハルユキ＝有田春雪、声 - 梶裕貴；ドラマCD 節に『アクセル・ワールド』+『ソードアート・オンライン』ドラマCD 2012年4月6日発売、川原礫著作の電撃文庫作品",
  ),
  wikiSao: src(
    "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    "登場人物：キリト 声 - 松岡禎丞、シノン 声 - 沢城みゆき；作者 川原礫（電撃文庫）",
  ),
  bgmAwsao: src(
    "https://bgm.tv/subject/39665",
    "Bangumi 条目『アクセル・ワールド』+『ソードアート・オンライン』ドラマCD：发售日 2012-04-06、版本特性 DRAMA CD（与日文维基一致）",
  ),
  zhAw: src("https://zh.wikipedia.org/wiki/加速世界", "中文题名：zh-TW／zh-CN「加速世界」，英文 Accel World"),
  zhSao: src("https://zh.wikipedia.org/wiki/刀劍神域", "中文题名：zh-TW「刀劍神域」、zh-CN「刀剑神域」，英文 Sword Art Online"),
};

// ── agent 表 ───────────────────────────────────────────────────────────────
const AGENTS = {
  kani: {
    title: "可児江西也",
    spec: { original_language: "ja", types: ["character"], translations: loc4("可児江西也") },
    note: "新建角色 agent：TV アニメ『甘城ブリリアントパーク』の主人公・可児江西也（ドラマ CD 全 3 話の主演）",
    sources: [S.wikiAmagi],
  },
  isuzu: {
    title: "千斗いすず",
    spec: { original_language: "ja", types: ["character"], translations: loc4("千斗いすず") },
    note: "新建角色 agent：TV アニメ『甘城ブリリアントパーク』のヒロイン・千斗いすず（第 1 話の主役、全話出演）",
    sources: [S.wikiAmagi],
  },
  uchiyama: {
    title: "内山昂輝",
    spec: { original_language: "ja", types: ["person"], translations: loc4("内山昂輝") },
    note: "新建人物 agent：声優・内山昂輝（MusicBrainz のドラマ CD 曲目クレジットで可児江西也役として全 3 話に記載）",
    sources: [S.mbAmagi, S.wikiAmagi],
  },
  kakuma: {
    title: "加隈亜衣",
    spec: { original_language: "ja", types: ["person"], translations: loc4("加隈亜衣") },
    note: "新建人物 agent：声優・加隈亜衣（MusicBrainz のドラマ CD 曲目クレジットで千斗いすず役として全 3 話に記載）",
    sources: [S.mbAmagi, S.wikiAmagi],
  },
  flyingdog: {
    title: "フライングドッグ",
    spec: { original_language: "ja", types: ["organization"], translations: loc4("フライングドッグ", "フライングドッグ", "フライングドッグ", "flying DOG") },
    note: "新建组织 agent：音楽レーベル flying DOG（フライングドッグ）。ドラマ CD『甘城ブリリアントパーク』の label 表記＝flying DOG／品番 VTCL-60387",
    sources: [S.mbAmagi, S.wikiAmagi],
  },

  kanako: {
    title: "宮前かなこ",
    spec: { original_language: "ja", types: ["character"], translations: loc4("宮前かなこ") },
    note: "新建角色 agent：『まりあ†ほりっく』の主人公・宮前かなこ（ドラマ CD 本篇の登場人物、第一話〜第四話の語り手）",
    sources: [S.wikiMaria],
  },
  mariya: {
    title: "祇堂鞠也",
    spec: { original_language: "ja", types: ["character"], translations: loc4("祇堂鞠也") },
    note: "新建角色 agent：『まりあ†ほりっく』の祇堂鞠也（官方表記は「衹堂」＝補助漢字、一般表記は「祇堂」；ドラマ CD 本篇の主要人物）",
    sources: [S.wikiMaria],
  },
  yokotani: {
    title: "横谷昌宏",
    spec: { original_language: "ja", types: ["person"], translations: loc4("横谷昌宏") },
    note: "新建人物 agent：脚本家・横谷昌宏（MusicBrainz のドラマ CD 曲目クレジットに「脚本: 横谷昌宏」、TV アニメのシリーズ構成・脚本も担当）",
    sources: [S.mbMaria, S.wikiMaria],
  },
  frontier: {
    title: "フロンティアワークス",
    spec: { original_language: "ja", types: ["organization"], translations: loc4("フロンティアワークス", "フロンティアワークス", "フロンティアワークス", "Frontier Works") },
    note: "新建组织 agent：株式会社フロンティアワークス。MusicBrainz のドラマ CD『まりあ†ほりっく』label 表記＝Frontier Works／品番 MFCZ-1001",
    sources: [S.mbMaria],
  },

  haruyuki: {
    title: "ハルユキ",
    spec: { original_language: "ja", types: ["character"], translations: loc4("ハルユキ", "有田春雪", "有田春雪", "Haruyuki Arita") },
    note: "新建角色 agent：『アクセル・ワールド』の主人公ハルユキ（本名 有田春雪、声 - 梶裕貴；ドラマ CD 第 1 話／第 3 話の出演クレジット）",
    sources: [S.wikiSaoDisc, S.wikiAw],
  },
  kirito: {
    title: "キリト",
    spec: { original_language: "ja", types: ["character"], translations: loc4("キリト", "桐人", "桐人", "Kirito") },
    note: "新建角色 agent：『ソードアート・オンライン』の主人公キリト（本名 桐ヶ谷和人、声 - 松岡禎丞；ドラマ CD 第 2 話／第 3 話の出演クレジット）",
    sources: [S.wikiSaoDisc, S.wikiSao],
  },
  sinon: {
    title: "シノン",
    spec: { original_language: "ja", types: ["character"], translations: loc4("シノン") },
    note: "新建角色 agent：『ソードアート・オンライン』のシノン（声 - 沢城みゆき、ドラマ CD 第 2 話『キリトの受難』出演クレジット）",
    sources: [S.wikiSaoDisc, S.wikiSao],
  },
  kaji: {
    title: "梶裕貴",
    spec: { original_language: "ja", types: ["person"], translations: loc4("梶裕貴") },
    note: "新建人物 agent：声優・梶裕貴（ドラマ CD 第 1 話／第 3 話／キャストトーク集でハルユキ役としてクレジット）",
    sources: [S.wikiSaoDisc, S.wikiAw],
  },
  matsuoka: {
    title: "松岡禎丞",
    spec: { original_language: "ja", types: ["person"], translations: loc4("松岡禎丞") },
    note: "新建人物 agent：声優・松岡禎丞（ドラマ CD 第 2 話／第 3 話／キャストトーク集でキリト役としてクレジット）",
    sources: [S.wikiSaoDisc, S.wikiSao],
  },
  kawahara: {
    title: "川原礫",
    spec: { original_language: "ja", types: ["person"], translations: loc4("川原礫") },
    note: "新建人物 agent：作家・川原礫（電撃文庫『アクセル・ワールド』『ソードアート・オンライン』の著者）",
    sources: [S.wikiAw, S.wikiSao],
  },
  asciimw: {
    title: "アスキー・メディアワークス",
    spec: { original_language: "ja", types: ["organization"], translations: loc4("アスキー・メディアワークス", "アスキー・メディアワークス", "アスキー・メディアワークス", "ASCII Media Works") },
    note: "新建组织 agent：アスキー・メディアワークス（KADOKAWA グループの電撃文庫ブランド）。MusicBrainz のドラマ CD label 表記＝アスキー・メディアワークス／品番 MNCA-9051",
    sources: [S.mbAwsao, S.wikiSaoDisc],
  },
};

// ── 三条链的数据表 ─────────────────────────────────────────────────────────
const CHAINS = [
  {
    key: "amagi",
    label: "TVアニメ「甘城ブリリアントパーク」ドラマCD",
    sources: [S.mbAmagi, S.wikiAmagi, S.bgmAmagi, S.zhAmagi],
    source: {
      key: "amagi-anime",
      title: "甘城ブリリアントパーク",
      spec: {
        original_language: "ja", types: ["animation"],
        translations: loc4("甘城ブリリアントパーク", "甘城辉煌乐园救世主", "甘城輝煌樂園救世主", "Amagi Brilliant Park"),
      },
      note: "新建 Work（animation）：TV アニメ『甘城ブリリアントパーク』＝ドラマ CD の適応元（リリース题名に TVアニメ を冠する企画ドラマ）",
    },
    work: {
      title: "甘城ブリリアントパーク ドラマCD",
      spec: {
        original_language: "ja", types: ["music"],
        translations: loc4("甘城ブリリアントパーク ドラマCD"),
        attributes: { tags: ["ドラマCD", "オーディオドラマ", "アニメ"] },
        external_ids: { musicbrainz: "cc622feb-8e3d-4d3f-a3a7-17fed897d967" },
      },
      note: "新建 Work（music）：ドラマ CD 本編（オリジナル 3 話の音声ドラマ）。曲目そのものが話数単位なので content_unit で 3 篇目を立てる",
    },
    units: [
      { title: "風邪っぴきいすずのお見舞い事情", number: "1", position: 1, entry_role: "main", durationSec: sec(1148586) },
      { title: "BRILLIANT4のたあいもない話", number: "2", position: 2, entry_role: "main", durationSec: sec(888040) },
      { title: "ABCトリオの再訓練", number: "3", position: 3, entry_role: "main", durationSec: sec(1011853) },
    ],
    release: {
      title: "TVアニメ「甘城ブリリアントパーク」ドラマCD",
      attributes: {
        catalog_number: "VTCL-60387", barcode: "4580325319064", edition_date: "2014-12-24", country: "JP",
        edition_type: "standard", distribution_channel: "physical",
      },
      publisherAgent: "flyingdog",
      subjects: [{ work: "main", role: "primary", position: 0 }],
      note: "新建 Release：flying DOG 2014-12-24 发行、品番 VTCL-60387、条码 4580325319064、1 枚 CD（subjects 声明本作品 primary）",
    },
    media: [{ title: "CD", format: "cd", role: "primary", position: 1, tracks: [0, 1, 2] }],
    agents: ["kani", "isuzu", "uchiyama", "kakuma", "flyingdog"],
    relations: [
      { type: "character_in", from: "kani", to: "work", attributes: { character_rank: "main" }, note: "キャラクター登場：可児江西也はドラマ CD 全 3 話の主演（MusicBrainz 曲目クレジットで役名＋声優が全話に記載）", sources: [S.mbAmagi, S.wikiAmagi] },
      { type: "character_in", from: "isuzu", to: "work", attributes: { character_rank: "main" }, note: "キャラクター登場：千斗いすずは第 1 話『風邪っぴきいすずのお見舞い事情』の主役、全話出演", sources: [S.mbAmagi, S.wikiAmagi] },
      { type: "voiced_by", from: "work", to: "uchiyama", attributes: { character: "kani", language: "ja" }, note: "配音：内山昂輝が可児江西也役でドラマ CD に出演（MusicBrainz 曲目クレジットの役名＋声優表記）", sources: [S.mbAmagi, S.wikiAmagi] },
      { type: "voiced_by", from: "work", to: "kakuma", attributes: { character: "isuzu", language: "ja" }, note: "配音：加隈亜衣が千斗いすず役でドラマ CD に出演（MusicBrainz 曲目クレジットの役名＋声優表記）", sources: [S.mbAmagi, S.wikiAmagi] },
      { type: "adaptation_of", from: "work", to: "source", attributes: {}, note: "改编自：ドラマ CD は TV アニメ『甘城ブリリアントパーク』の企画ドラマ（リリース题名が「TVアニメ『甘城ブリリアントパーク』ドラマCD」）", sources: [S.wikiAmagi, S.mbAmagi] },
      { type: "credit_for", from: "release", to: "flyingdog", attributes: { credit_role: "発売元" }, note: "署名：本ドラマ CD の発売元は flying DOG（品番 VTCL-60387、label 表記 flying DOG）", sources: [S.mbAmagi, S.wikiAmagi] },
    ],
  },
  {
    key: "maria",
    label: "TVアニメ「まりあ†ほりっく」ドラマCD",
    sources: [S.mbMaria, S.wikiMaria, S.zhMaria],
    source: {
      key: "maria-anime",
      title: "まりあ†ほりっく",
      spec: {
        original_language: "ja", types: ["animation"],
        translations: loc4("まりあ†ほりっく", "玛莉亚狂热", "瑪莉亞狂熱", "Maria Holic"),
      },
      note: "新建 Work（animation）：TV アニメ『まりあ†ほりっく』＝ドラマ CD の適応元（原作は漫画だが、实例に漫画用 work 类型が無いため动画 Work を適応元にした＝報告の缺口参照）",
    },
    work: {
      title: "まりあ†ほりっく ドラマCD",
      spec: {
        original_language: "ja", types: ["music"],
        translations: loc4("まりあ†ほりっく ドラマCD"),
        attributes: { tags: ["ドラマCD", "オーディオドラマ", "アニメ"] },
        external_ids: { musicbrainz: "08aa7802-ce30-4c0a-b68c-0c913e213fa3" },
      },
      note: "新建 Work（music）：2009-04-24 発売のドラマ CD 本編（第一話〜第四話＋おまけ、脚本 横谷昌宏）",
    },
    units: [
      { title: "第一話「流されて」", number: "1", position: 1, entry_role: "main", durationSec: sec(921000) },
      { title: "第二話「天の妃女学院連続失踪事件」", number: "2", position: 2, entry_role: "main", durationSec: sec(545000) },
      { title: "第三話「第13女子寮の悪夢」", number: "3", position: 3, entry_role: "main", durationSec: sec(465000) },
      { title: "第四話「地球最後の日」", number: "4", position: 4, entry_role: "main", durationSec: sec(449000) },
      { title: "おまけ「茉莉花日誌」", number: "おまけ", position: 5, entry_role: "extra", durationSec: sec(466000) },
    ],
    release: {
      title: "TVアニメ「まりあ†ほりっく」ドラマCD",
      attributes: {
        catalog_number: "MFCZ-1001", barcode: "4562207970709", edition_date: "2009-04-24", country: "JP",
        edition_type: "standard", distribution_channel: "physical",
      },
      publisherAgent: "frontier",
      subjects: [{ work: "main", role: "primary", position: 0 }],
      note: "新建 Release：Frontier Works 2009-04-24 发行、品番 MFCZ-1001、条码 4562207970709、1 枚 CD（subjects 声明本作品 primary）",
    },
    media: [{ title: "CD", format: "cd", role: "primary", position: 1, tracks: [0, 1, 2, 3, 4] }],
    agents: ["kanako", "mariya", "yokotani", "frontier"],
    relations: [
      { type: "character_in", from: "kanako", to: "work", attributes: { character_rank: "main" }, note: "キャラクター登場：宮前かなこは本ドラマ CD の主人公（第一話〜第四話の本篇に登場）", sources: [S.wikiMaria, S.mbMaria] },
      { type: "character_in", from: "mariya", to: "work", attributes: { character_rank: "main" }, note: "キャラクター登場：祇堂鞠也は本ドラマ CD の主要人物（第一話〜第四話の本篇に登場）", sources: [S.wikiMaria, S.mbMaria] },
      { type: "written_by", from: "work", to: "yokotani", attributes: { credit_role: "脚本" }, note: "脚本题名：MusicBrainz の収録曲クレジットが全 5 曲に「脚本: 横谷昌宏」と記載", sources: [S.mbMaria, S.wikiMaria] },
      { type: "adaptation_of", from: "work", to: "source", attributes: {}, note: "改编自：本 CD は TV アニメ『まりあ†ほりっく』のドラマ CD（リリース题名が「TVアニメ『まりあ†ほりっく』ドラマCD」）", sources: [S.mbMaria, S.wikiMaria] },
      { type: "credit_for", from: "release", to: "frontier", attributes: { credit_role: "発売元" }, note: "署名：本ドラマ CD の発売元は Frontier Works（品番 MFCZ-1001、label 表記 Frontier Works）", sources: [S.mbMaria] },
    ],
  },
  {
    key: "awsao",
    label: "『アクセル・ワールド』+『ソードアート・オンライン』ドラマCD",
    sources: [S.mbAwsao, S.wikiSaoDisc, S.wikiAw, S.wikiSao, S.bgmAwsao, S.zhAw, S.zhSao],
    // 多作品盒装：两作各自的ドラマ CD 作品 + 収録媒体共通用の合集作品
    sources_works: [
      { key: "aw-novel", title: "アクセル・ワールド", types: ["novel"], translations: loc4("アクセル・ワールド", "加速世界", "加速世界", "Accel World"), note: "新建 Work（novel）：電撃文庫『アクセル・ワールド』（著：川原礫）＝ドラマ CD 第 1 話の適応元" },
      { key: "sao-novel", title: "ソードアート・オンライン", types: ["novel"], translations: loc4("ソードアート・オンライン", "刀剑神域", "刀劍神域", "Sword Art Online"), note: "新建 Work（novel）：電撃文庫『ソードアート・オンライン』（著：川原礫）＝ドラマ CD 第 2 話の適応元" },
    ],
    works: [
      {
        key: "aw-drama",
        title: "アクセル・ワールド ドラマCD",
        types: ["music"],
        tags: ["ドラマCD", "オーディオドラマ", "ライトノベル"],
        note: "新建 Work（music）：『アクセル・ワールド』のドラマ CD 本編（第 1 話『ハルユキの災難』を収録）",
        units: [{ title: "ハルユキの災難", number: "第1話", position: 1, entry_role: "main", durationSec: sec(1549653) }],
      },
      {
        key: "sao-drama",
        title: "ソードアート・オンライン ドラマCD",
        types: ["music"],
        tags: ["ドラマCD", "オーディオドラマ", "ライトノベル"],
        note: "新建 Work（music）：『ソードアート・オンライン』のドラマ CD 本編（第 2 話『キリトの受難』を収録）",
        units: [{ title: "キリトの受難", number: "第2話", position: 1, entry_role: "main", durationSec: sec(1675026) }],
      },
      {
        key: "awsao-drama",
        title: "アクセル・ワールド+ソードアート・オンライン ドラマCD",
        types: ["music"],
        tags: ["ドラマCD", "オーディオドラマ", "クロスオーバー"],
        note: "新建 Work（music）：両作のクロスオーバードラマ（第 3 話『バーサス』）とキャストトーク集を収める合集作品",
        units: [
          { title: "バーサス", number: "第3話", position: 1, entry_role: "main", durationSec: sec(1859160) },
          { title: "『AW』&『SAO』キャストトーク集", number: "スペシャル", position: 2, entry_role: "extra", durationSec: sec(1155653) },
        ],
      },
    ],
    release: {
      title: "アクセル・ワールド+ソードアート・オンライン ドラマCD",
      attributes: {
        catalog_number: "MNCA-9051", barcode: "4942330050880", edition_date: "2012-04-06", country: "JP",
        distribution_channel: "physical",
      },
      publisherAgent: "asciimw",
      subjects: [
        { work: "awsao-drama", role: "primary", position: 0 },
        { work: "aw-drama", role: "compilation", position: 1 },
        { work: "sao-drama", role: "compilation", position: 2 },
      ],
      note: "新建 Release：アスキー・メディアワークス（電撃文庫）2012-04-06 发行、品番 MNCA-9051、条码 4942330050880、2 枚组 CD；subjects 同时声明合集作品（primary）与两作各自的ドラマ CD 作品（compilation）",
    },
    // 2 枚组：medium 题名必须能区分盘序（MusicBrainz 只给 format=CD、盘序 1/2，别无官方盘名）
    media: [
      { title: "CD 1", format: "cd", role: "primary", position: 1, tracks: [{ work: "aw-drama", unit: 0 }, { work: "sao-drama", unit: 0 }] },
      { title: "CD 2", format: "cd", role: "primary", position: 2, tracks: [{ work: "awsao-drama", unit: 0 }, { work: "awsao-drama", unit: 1 }] },
    ],
    agents: ["haruyuki", "kirito", "sinon", "kaji", "matsuoka", "kawahara", "asciimw"],
    relations: [
      { type: "character_in", from: "haruyuki", to: "work:aw-drama", attributes: { character_rank: "main" }, note: "キャラクター登場：ハルユキ（有田春雪）は第 1 話『ハルユキの災難』の主役、第 3 話にも出演", sources: [S.wikiSaoDisc, S.wikiAw] },
      { type: "character_in", from: "kirito", to: "work:sao-drama", attributes: { character_rank: "main" }, note: "キャラクター登場：キリトは第 2 話『キリトの受難』の主役、第 3 話にも出演", sources: [S.wikiSaoDisc, S.wikiSao] },
      { type: "character_in", from: "sinon", to: "work:sao-drama", attributes: { character_rank: "supporting" }, note: "キャラクター登場：シノンは第 2 話『キリトの受難』の出演クレジットに記載", sources: [S.wikiSaoDisc, S.wikiSao] },
      { type: "voiced_by", from: "work:aw-drama", to: "kaji", attributes: { character: "haruyuki", language: "ja" }, note: "配音：梶裕貴がハルユキ役で出演（第 1 話の出演クレジット ハルユキ〈梶裕貴〉）", sources: [S.wikiSaoDisc, S.wikiAw] },
      { type: "voiced_by", from: "work:sao-drama", to: "matsuoka", attributes: { character: "kirito", language: "ja" }, note: "配音：松岡禎丞がキリト役で出演（第 2 話の出演クレジット キリト〈松岡禎丞〉）", sources: [S.wikiSaoDisc, S.wikiSao] },
      { type: "voiced_by", from: "work:sao-drama", to: "existing:沢城みゆき", attributes: { character: "sinon", language: "ja" }, note: "配音：沢城みゆき（存量 agent 复用）がシノン役で出演（第 2 話の出演クレジット シノン〈沢城みゆき〉）", sources: [S.wikiSaoDisc, S.wikiSao] },
      { type: "adaptation_of", from: "work:aw-drama", to: "source:aw-novel", attributes: {}, note: "改编自：電撃文庫『アクセル・ワールド』（著：川原礫）のドラマ CD 化", sources: [S.wikiAw, S.mbAwsao] },
      { type: "adaptation_of", from: "work:sao-drama", to: "source:sao-novel", attributes: {}, note: "改编自：電撃文庫『ソードアート・オンライン』（著：川原礫）のドラマ CD 化", sources: [S.wikiSao, S.mbAwsao] },
      { type: "created_by", from: "source:aw-novel", to: "kawahara", attributes: { credit_role: "著者" }, note: "作者：電撃文庫『アクセル・ワールド』の著者は川原礫", sources: [S.wikiAw] },
      { type: "created_by", from: "source:sao-novel", to: "kawahara", attributes: { credit_role: "著者" }, note: "作者：電撃文庫『ソードアート・オンライン』の著者は川原礫", sources: [S.wikiSao] },
      { type: "credit_for", from: "release", to: "asciimw", attributes: { credit_role: "発売元" }, note: "署名：本ドラマ CD の発売元はアスキー・メディアワークス（KADOKAWA グループ／電撃文庫、品番 MNCA-9051）", sources: [S.mbAwsao, S.wikiSaoDisc] },
    ],
  },
];

// ── 构建 ───────────────────────────────────────────────────────────────────
const client = new Client();
await client.login();

// 战役期间十几个子代理同时写同一实例：先按 kind 预拉全量（行内含 work_id / release_id / medium_id / parent_id），
// 把查重放到本地索引，之后再写就不再走限流的列表路由——既避开 429，也避开"刚建完搜不到"导致的重复建档。
const index = Index.load();
const liveRows = [];
try {
  for (const kind of ["agent", "collection", "work", "content_unit", "expression", "release", "medium", "track"]) {
    const rows = await client.listKind(kind);
    for (const e of rows) { index.add(e); liveRows.push(e); }
    console.log("预载 " + kind + " × " + rows.length);
  }
} catch (err) {
  console.log("！全量预载失败，退回本地快照查重：" + err.message);
}
const camp = new Campaign({ domain: "audio-drama-cd", client, index });
/** 只走本地索引（预载快照）的创建：服务端 search 在限流与索引延迟下不可靠。 */
const ensure = (kind, title, spec, evd, opts = {}) => camp.ensureEntity(kind, title, spec, evd, { allowServerLookup: false, ...opts });

// 注：多盘发行的 medium 题名必须在**计划里**就区分盘序（「CD 1」「CD 2」）。
// medium 的查重作用域只能给 release_id，同名 medium 会被并入同一条，事后改名也救不回来——
// lib 的 Index.add 对同 id 的旧行不覆盖，改名后的实体在本轮索引里查不到，会再建一条重复。

const K = [];               // 所有新建/复用实体登记（用于断言）
const LAYOUT = [];          // 计划布局（medium/盘序/track 序号），构建后据此订正并断言
const ENT = { agent: new Map(), work: new Map() };
const ok = (kind, key, entity, chain) => { K.push({ kind, key, chain, id: entity.id, title: entity.title }); return entity; };

// agent：先建，后面各链引用
const agentIds = new Map();
for (const [key, a] of Object.entries(AGENTS)) {
  const e = await ensure("agent", a.title, a.spec, ev(a.note, a.sources), { idemKey: "audio-drama-cd-agent-" + key });
  agentIds.set(key, e.id);
  ok("agent", "agent:" + key, e, null);
}

const relList = [];
for (const ch of CHAINS) {
  const wIds = new Map();            // work key → id
  const srcIds = new Map();
  const unitIds = [];                // {workKey, unitIdx, cuId, exId, title}

  // 適応元 Work（単数 or 複数）
  const sourceDefs = ch.sources_works
    ? ch.sources_works.map((s) => ({ key: s.key, title: s.title, spec: { original_language: "ja", types: s.types, translations: s.translations }, note: s.note }))
    : ch.source
      ? [{ key: ch.source.key, title: ch.source.title, spec: ch.source.spec, note: ch.source.note }]
      : [];
  for (const s of sourceDefs) {
    const e = await ensure("work", s.title, s.spec, ev(s.note, ch.sources), { idemKey: "audio-drama-cd-src-" + s.key });
    srcIds.set(s.key, e.id);
    ok("work", "source:" + s.key, e, ch.key);
  }

  // 作品 Work（单作品链 1 个；多作品盒装链 3 个）
  const workDefs = ch.works
    ? ch.works
    : [{ key: "main", title: ch.work.title, types: ch.work.spec.types, tags: ch.work.spec.attributes.tags, external_ids: ch.work.spec.external_ids, units: ch.units, note: ch.work.note }];
  for (const w of workDefs) {
    const spec = {
      original_language: "ja", types: w.types,
      translations: loc4(w.title),
      attributes: { tags: w.tags },
    };
    if (w.external_ids) spec.external_ids = w.external_ids;
    const e = await ensure("work", w.title, spec, ev(w.note, ch.sources), { idemKey: "audio-drama-cd-work-" + ch.key + "-" + w.key });
    wIds.set(w.key, e.id);
    ok("work", ch.key + ":" + w.key, e, ch.key);
    for (let i = 0; i < w.units.length; i++) {
      const u = w.units[i];
      const cu = await ensure("content_unit", u.title, {
        work_id: e.id, position: u.position, number: u.number,
        original_language: "ja", types: ["content_unit"], translations: loc4(u.title),
        attributes: { language: "ja", entry_role: u.entry_role },
      }, ev("新建篇目（content_unit）：" + w.title + " の公式曲順 " + u.number + "『" + u.title + "』（" + u.entry_role + "）", ch.sources), {
        idemKey: "audio-drama-cd-cu-" + ch.key + "-" + w.key + "-" + i, scope: { work_id: e.id },
      });
      const ex = await ensure("expression", u.title, {
        work_id: e.id, content_unit_id: cu.id, position: 1,
        original_language: "ja", types: ["expression"], translations: loc4(u.title),
        attributes: { language: "ja", duration: u.durationSec },
      }, ev("新建表达（expression）：本篇目の音声（ドラマ録音）を content_unit に紐付け、duration は MusicBrainz の収録時間（ms→秒）", ch.sources), {
        idemKey: "audio-drama-cd-ex-" + ch.key + "-" + w.key + "-" + i, scope: { work_id: e.id },
      });
      ok("content_unit", ch.key + ":" + w.key + ":" + i, cu, ch.key);
      ok("expression", ch.key + ":" + w.key + ":" + i, ex, ch.key);
      unitIds.push({ workKey: w.key, unitIdx: i, cuId: cu.id, exId: ex.id, title: u.title });
    }
  }

  // Release
  const r = ch.release;
  const publisherId = r.publisherAgent ? agentIds.get(r.publisherAgent) : null;
  const attrs = { ...r.attributes };
  if (publisherId) attrs.publisher = publisherId;
  const rel = await ensure("release", r.title, {
    original_language: "ja", types: ["release"], translations: loc4(r.title),
    attributes: attrs,
    subjects: r.subjects.map((s) => ({ work_id: wIds.get(s.work), role: s.role, position: s.position })),
  }, ev(r.note + "。品番・条码・发行日・盘数来自 MusicBrainz；subjects 覆盖本发行全部被收录表达所属 Work", ch.sources), {
    idemKey: "audio-drama-cd-release-" + ch.key,
  });
  ok("release", ch.key + ":release", rel, ch.key);

  // Medium / Track
  for (const m of ch.media) {
    const medium = await ensure("medium", m.title, {
      release_id: rel.id, position: m.position, original_language: "ja", types: ["medium"],
      translations: loc4(m.title), attributes: { format: m.format, role: m.role },
    }, ev("新建载体（medium）：" + r.title + " 的真实盘（Disc " + m.position + "、" + m.format + "）", ch.sources), {
      idemKey: "audio-drama-cd-medium-" + ch.key + "-" + m.position, scope: { release_id: rel.id },
    });
    ok("medium", ch.key + ":medium:" + m.position, medium, ch.key);
    let pos = 1;
    for (const t of m.tracks) {
      const spec = typeof t === "object" && t.work
        ? { workKey: t.work, unitIdx: t.unit, cu: null }
        : { workKey: ch.works ? null : "main", unitIdx: t, cu: null };
      const unit = unitIds.find((u) => u.workKey === spec.workKey && u.unitIdx === spec.unitIdx);
      const durationSec = (ch.works ? ch.works.find((w) => w.key === spec.workKey).units[spec.unitIdx] : ch.units[spec.unitIdx]).durationSec;
      const track = await ensure("track", unit.title, {
        medium_id: medium.id, position: pos, original_language: "ja", types: ["track"],
        translations: loc4(unit.title), attributes: { duration: durationSec, role: "primary" },
        contents: [{ expression_id: unit.exId, position: 1, locator: null }],
      }, ev("新建收录位置（track）：Disc " + m.position + " 第 " + pos + " 曲『" + unit.title + "』整轨收录对应表达（locator 为空＝整轨）", ch.sources), {
        idemKey: "audio-drama-cd-track-" + ch.key + "-" + m.position + "-" + pos, scope: { medium_id: medium.id },
      });
      ok("track", ch.key + ":" + m.position + ":" + pos, track, ch.key);
      LAYOUT.push({ chain: ch.key, mediumId: medium.id, mediumTitle: m.title, trackId: track.id, trackTitle: unit.title, position: pos });
      pos++;
    }
  }

  // 关系
  const resolve = (ref) => {
    if (ref === "work") return wIds.get("main");
    if (ref === "source") {
      const keys = [...srcIds.keys()];
      if (keys.length === 1) return srcIds.get(keys[0]);
    }
    if (ref === "release") return rel.id;
    if (ref.startsWith("work:")) return wIds.get(ref.slice(5));
    if (ref.startsWith("source:")) return srcIds.get(ref.slice(7));
    if (ref.startsWith("existing:")) return camp.index.find("agent", ref.slice(9))?.id || ref.slice(9);
    if (agentIds.has(ref)) return agentIds.get(ref);
    throw new Error("未知关系端点引用：" + ref);
  };
  for (let ri = 0; ri < ch.relations.length; ri++) {
    const rl = ch.relations[ri];
    const s = resolve(rl.from);
    const t = resolve(rl.to);
    const attributes = { ...rl.attributes };
    if (attributes.character && agentIds.has(attributes.character)) attributes.character = agentIds.get(attributes.character);
    // 幂等键必须是 ASCII：lib 会把 idemKey 原样拼进 HTTP 头，含非 ASCII（如角色名「沢城みゆき」）会触发
    // undici 的 ByteString 异常（见报告的缺口清单）。这里只用链名 + 序号。
    const rel2 = await camp.createRelation(rl.type, s, t, ev(rl.note, rl.sources), { attributes, idemKey: "audio-drama-cd-rel-" + ch.key + "-" + ri });
    relList.push({ type: rl.type, source_id: s, target_id: t, attributes, id: rel2.id, chain: ch.key });
  }
}

// ── 布局订正（幂等）：track 必须落在计划的那枚 medium 上、序号与真实盘序一致 ──
let converged = 0;
if (!DRY) {
  for (const item of LAYOUT) {
    const cur = await camp.getEntity(item.trackId);
    if (cur.medium_id === item.mediumId && cur.position === item.position) continue;
    await camp.updateEntity(item.trackId, { medium_id: item.mediumId, position: item.position },
      ev("编目订正：轨道归位——「" + item.trackTitle + "」属于载体「" + item.mediumTitle + "」第 " + item.position + " 曲（依 MusicBrainz 盘序）", S.mbAwsao));
    converged++;
  }
  if (converged) console.log("布局订正 " + converged + " 条 track（medium 归属／序号）");
}

// ── 写后回读断言 ───────────────────────────────────────────────────────────
const problems = [];
const stat = { struct: 0, contents: 0, subjects: 0, relations: 0, revisions: 0 };
if (DRY) {
  console.log("\n[dry-run] 跳过回读断言；计划：实体 " + K.length + "、关系 " + relList.length);
} else {
  const byId = new Map();
  for (const k of K) {
    const e = await camp.getEntity(k.id);
    byId.set(k.id, e);
    stat.struct++;
    if (e.kind !== k.kind) problems.push("kind 不符 " + k.id + " 期望 " + k.kind + " 实为 " + e.kind);
    if (!e.status || e.status !== "published") problems.push("状态非 published：" + k.kind + "「" + k.title + "」=" + e.status);
  }
  for (const k of K) {
    const e = byId.get(k.id);
    if (k.kind === "content_unit") {
      if (!e.work_id) problems.push("content_unit 缺 work_id：" + e.title);
      else stat.struct++;
    }
    if (k.kind === "expression") {
      if (e.parent_id) problems.push("expression 不应有 parent_id：" + e.title);
      if (!e.content_unit_id) problems.push("expression 缺 content_unit_id（创作链断开）：" + e.title);
      if (!e.work_id) problems.push("expression 缺 work_id：" + e.title);
    }
    if (k.kind === "medium" && !e.release_id) problems.push("medium 缺 release_id：" + e.title);
    if (k.kind === "track") {
      if (!e.medium_id) problems.push("track 缺 medium_id：" + e.title);
      if (!e.contents || !e.contents.length) problems.push("track 缺 contents：" + e.title);
    }
    if (k.kind === "release" && e.work_id) problems.push("release 不应有 work_id：" + e.title);
  }
  // 篇目归属：expression.content_unit 的 work 与自身 work 一致
  for (const k of K.filter((x) => x.kind === "expression")) {
    const e = byId.get(k.id);
    const cu = byId.get(e.content_unit_id) || (await camp.getEntity(e.content_unit_id));
    if (!cu) problems.push("expression 的 content_unit 不存在：" + e.title);
    else if (cu.work_id !== e.work_id) problems.push("expression 与 content_unit 跨 Work：" + e.title);
    else stat.struct++;
  }
  // 承载链：medium → release、track → medium、contents → expression
  for (const k of K.filter((x) => x.kind === "medium")) {
    const e = byId.get(k.id);
    const rel = byId.get(e.release_id) || (await camp.getEntity(e.release_id));
    if (!rel || rel.kind !== "release") problems.push("medium 的 release_id 不是 release：" + e.title);
    else stat.struct++;
  }
  for (const k of K.filter((x) => x.kind === "track")) {
    const e = byId.get(k.id);
    const med = byId.get(e.medium_id) || (await camp.getEntity(e.medium_id));
    if (!med || med.kind !== "medium") problems.push("track 的 medium_id 不是 medium：" + e.title);
    else stat.struct++;
    for (const c of e.contents) {
      const ex = byId.get(c.expression_id) || (await camp.getEntity(c.expression_id));
      if (!ex || ex.kind !== "expression") problems.push("track contents 指向非 expression：" + e.title);
      else { stat.contents++; if (!ex.content_unit_id) problems.push("track 收录的 expression 未挂篇目：" + ex.title); }
    }
  }
  // subjects 覆盖：每个 release 的 subjects 必须覆盖其 track contents 引用的全部 expression 所属 work
  for (const k of K.filter((x) => x.kind === "release")) {
    const r = byId.get(k.id);
    const subj = new Set((r.subjects || []).map((s) => s.work_id));
    const meds = K.filter((x) => x.kind === "medium" && x.chain === k.chain).map((x) => byId.get(x.id));
    const trks = K.filter((x) => x.kind === "track" && x.chain === k.chain).map((x) => byId.get(x.id));
    const ms = new Set(meds.map((m) => m.id));
    let refs = 0;
    for (const t of trks) {
      if (!ms.has(t.medium_id)) continue;
      for (const c of t.contents) {
        const ex = byId.get(c.expression_id);
        if (!ex) { problems.push("track contents 指向未知表达：" + t.title); continue; }
        refs++;
        if (!subj.has(ex.work_id)) problems.push("release「" + r.title + "」subjects 未覆盖 Work " + ex.work_id + "（undeclared_release_subject 风险）");
        else stat.subjects++;
      }
    }
    if (!refs) problems.push("release 没有任何带 contents 的 track：" + r.title);
  }
  // 关系两端回读
  for (const rl of relList) {
    const items = await client.relationsOf(rl.source_id);
    const hit = items.find((x) => x.type === rl.type && x.source_id === rl.source_id && x.target_id === rl.target_id && !x.via);
    if (!hit) problems.push("关系回读失败：" + rl.type + " " + rl.source_id + "→" + rl.target_id);
    else stat.relations++;
    const back = await client.relationsOf(rl.target_id);
    const hit2 = back.find((x) => x.id === hit?.id || (x.type === rl.type && x.target_id === rl.target_id && x.source_id === rl.source_id));
    if (!hit2) problems.push("关系反向/双端回读失败：" + rl.type + " " + rl.target_id);
  }
  // revisions
  for (const k of K) {
    const rv = await client.call("/api/catalog/entities/" + k.id + "/revisions");
    const items = (rv.body && rv.body.items) || [];
    if (!items.length) problems.push("没有 revision 记录：" + k.kind + "「" + k.title + "」");
    else {
      stat.revisions++;
      const snap = items[0].snapshot || {};
      if (snap.id && snap.id !== k.id) problems.push("revision 快照 id 不符：" + k.id);
      if (!(byId.get(k.id).version >= 1)) problems.push("version 未递增：" + k.title);
    }
  }
}

// ── 重复建档自查（跨子代理并发必备）：同 kind + 题名 + 父级作用域不得有 ≥2 条活体实体 ──
if (!DRY) {
  const dupKinds = [...new Set(K.map((k) => k.kind))];
  const dupes = [];
  try {
    for (const kind of dupKinds) {
      // 列表路由在并发写时会把同一实体重复返回（分页不稳定），按 id 去重后再判定"重复建档"
      const rows = [...new Map((await client.listKind(kind)).map((e) => [e.id, e])).values()]
        .filter((e) => e.status !== "deleted" && e.status !== "merged");
      const groups = new Map();
      for (const e of rows) {
        const key = [e.kind, String(e.title || "").replace(/\s+/g, "").toLowerCase(), e.work_id || "", e.release_id || "", e.medium_id || "", e.parent_id || ""].join("|");
        groups.set(key, [...(groups.get(key) || []), e]);
      }
      for (const [, list] of groups) {
        if (list.length < 2) continue;
        if (!list.some((e) => K.some((k) => k.id === e.id))) continue;
        dupes.push(list.map((e) => e.kind + "「" + e.title + "」" + e.id + "(" + e.status + ")").join("  /  "));
      }
    }
  } catch (err) { problems.push("重复建档自查失败：" + err.message); }
  if (dupes.length) { for (const d of dupes) problems.push("发现重复建档：" + d); }
  else console.log("✓ 重复建档自查：本次涉及的 " + dupKinds.join("/") + " 无同 kind+题名+父级作用域的活体重复");
}

const counts = {};
for (const k of K) counts[k.kind] = (counts[k.kind] || 0) + 1;
console.log("\n计划/已建实体（按 kind）：" + JSON.stringify(counts) + "；关系 " + relList.length);
console.log("断言通过计数：" + JSON.stringify(stat));
if (problems.length) {
  console.log("断言失败 " + problems.length + " 项：");
  for (const p of problems) console.log("  ✗ " + p);
  process.exitCode = 1;
} else if (!DRY) {
  console.log("✓ 写后回读断言全部通过（结构归属 / contents→expression / subjects 覆盖 / 关系两端 / revisions）");
}
camp.summary({ entitiesByKind: counts, relationCount: relList.length, assertProblems: problems.length });
