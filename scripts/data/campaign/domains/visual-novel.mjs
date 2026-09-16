#!/usr/bin/env node
// 领域脚本：视觉小说（多平台发行）— slug = visual-novel
//
// 数据来源（全部可核对，脚本内不写推测值）：
//   · VNDB kana API（/vn、/release，含声优表 va）——条目 id、平台、発売日、品番、JAN、開発/発売元
//   · 日文维基百科（CLANNAD (ゲーム) / STEINS;GATE）—— 学園編・アフターストーリー二部構成、ルート分岐、
//     家庭用移植と声優キャストの関係（PC 2004 は音声なし／PS2 2006 でフルボイス）、スタッフ（企画/シナリオ/原画/音楽）
//   · Steam 商店 API（appdetails 412830）—— 2016-09-08 配信、対応言語に英語、開発 MAGES. Inc.
//   · 国立国会図書館サーチ（OpenSearch）—— 公式外伝小説『Clannad～光見守る坂道で～』メディアワークス 2005.12 /
//     ISBN 4-8402-3250-4
//   · Bangumi v0 API —— 条目 id、発売日、封面图
//
// 层级形状（BRIEF 第 14 行给本领域的形状）：
//   Work(visual_novel) → ContentUnit(路線) → Expression(路線×プラットフォーム/言語)
//   Work → Release → Medium(dvd / web) → Track → contents[] 引用 Expression
//
// 说明（详见 report 缺口清单）：视觉小说的光盘内没有"物理音轨"，Track 在这里是"該篇目在该载体中的收录位置"，
//   与 BRIEF 对 VN 的规定形状一致；收录位置用 route 顺序，locator 留空（整载体收录）。
//
// 用法：
//   node scripts/data/campaign/domains/visual-novel.mjs --dry-run
//   $env:MF_USER_PASS = …; node scripts/data/campaign/domains/visual-novel.mjs

import { Campaign, Client, DRY, Index, src } from "../lib.mjs";

// ── 来源 ────────────────────────────────────────────────────────────────
const JA_WIKI = (t) => "https://ja.wikipedia.org/wiki/" + encodeURIComponent(t);
const S_CL_WIKI = src(JA_WIKI("CLANNAD_(ゲーム)"),
  "日文维基百科「CLANNAD (ゲーム)」：2004-04-28 初回限定版（Key、全年齢 PC）、2004-08-06 通常版、ストーリーは「学園編」＋「AFTER STORY」二部構成、PS2 版 2006-02-23 由インターチャネル発売并实装角色语音、以降 PROTOTYPE 移植（Xbox 360 2008-08-28／PS3 2011-04-21／PS4 2018-06-14 追加英文文本／Switch 2019-07-04）、PSP 2008-05-29／PS Vita 2014-08-14；Staff 欄（企画/シナリオ 麻枝准、シナリオ 涼元悠一・魁、原画 樋上いたる、音楽 折戸伸治・戸越まごめ・麻枝准）；声優欄は「2004 年発売の PC 版は声が収録されていない」とした上で各ヒロインの PS2 版以降のキャストを記載；『智代アフター ～It's a Wonderful Life～』を本作ヒロイン坂上智代の後日談スピンオフと記載；公式外伝小説『CLANNAD 〜光見守る坂道で〜』2005 年 12 月発売・2010 年に PSP 用ビジュアルサウンドノベル化と記載");
const S_CL_R302 = src("https://vndb.org/r302",
  "VNDB 发行 r302「Clannad - First Press Edition」：2004-04-28、平台 win、媒体 DVD-ROM×1、JAN 4933032002963、発売元 Key、official");
const S_CL_R301 = src("https://vndb.org/r301",
  "VNDB 发行 r301「CLANNAD」：2006-02-23、平台 ps2、媒体 DVD-ROM×1、品番 SLPM-66981、JAN 4580277330056、制作 Key／Interchannel Inc.、official");
const S_CL_V4 = src("https://vndb.org/v4",
  "VNDB 条目 v4「CLANNAD」：原典 2004-04-28、平台 win/ios/and/psp/ps2/ps3/ps4/psv/swi/vnd/xb3/mob、開発 Key、别名「クラナド／团子大家族」");
const S_CL_V12 = src("https://vndb.org/v12",
  "VNDB 条目 v12「Tomoyo After ~It's a Wonderful Life~」：原題「智代アフター ～It's a Wonderful Life～」、2005-11-25、開発 Key（作为 CLANNAD 的智代後日談作品）");
const S_CL_V4060 = src("https://vndb.org/v4060",
  "VNDB 条目 v4060「CLANNAD - Hikari Mimamoru Sakamichi de」：原題「CLANNAD -クラナド- 光見守る坂道で」、初出 2008-01-08（携帯アプリ）、開発 Key、说明为『Hikari Mimamoru Sakamichi De』短編集のビジュアルサウンドノベル化");
const S_CL_BOOK = src("https://ndlsearch.ndl.go.jp/books/R100000002-I000008005812",
  "国立国会図書館サーチ書誌 R100000002-I000008005812：『Clannad～光見守る坂道で～ : official another story』メディアワークス 2005.12、ISBN 4-8402-3250-4、責任表示 Key 文&原作・ごとP イラスト（同页另记 2020 年 KADOKAWA 新装版 ISBN 978-4-04-913147-5）");
const S_SG_WIKI = src(JA_WIKI("STEINS;GATE"),
  "日文维基百科「STEINS;GATE」：5pb.（現 MAGES.）発売のアドベンチャーゲーム、原典 Xbox 360 版 2009-10-15、Windows 版 2010-08-26、サウンドノベル形式で「6 つのマルチエンド」＋トゥルーエンドのルート分岐、スタッフ欄（企画/原案 志倉千代丸、シナリオ 林直孝／谷崎央佳、キャラクターデザイン huke、音楽 阿保剛／磯江俊道、制作 5pb.／ニトロプラス）、続編『STEINS;GATE 0』2015-12-10 発売、『科学アドベンチャーシリーズ』第 2 作、舞台版では 6 ルート（シュタインズ・ゲート編・るか編・紅莉栖編・フェイリス編・まゆり編・鈴羽編）を上演");
const S_SG_R5362 = src("https://vndb.org/r5362",
  "VNDB 发行 r5362「Steins;Gate - Regular Edition」：2009-10-15、平台 xb3、媒体 DVD-ROM×1、品番 W2D-00001、JAN 4988648682740、制作 MAGES.／NITRO PLUS、official");
const S_SG_R47588 = src("https://vndb.org/r47588",
  "VNDB 发行 r47588「STEINS;GATE - Download Edition」：2016-09-08、平台 win、媒体 インターネットダウンロード、制作 MAGES.／MAGES. Inc.、official、公式サイトとして Steam 版ページを外部リンク");
const S_SG_STEAM = src("https://store.steampowered.com/app/412830/",
  "Steam 商店 appdetails 412830「STEINS;GATE」：配信日 2016-09-08、開発 MAGES. Inc.、対応言語 English / Japanese / Simplified Chinese / Traditional Chinese");
const S_SG_V2002 = src("https://vndb.org/v2002",
  "VNDB 条目 v2002「STEINS;GATE」：原典 2009-10-15、平台 win/lin/ios/and/psp/ps3/ps4/ps5/psv/swi/sw2/xb3、開発 NITRO PLUS／MAGES.、声優表（岡部倫太郎＝宮野真守、牧瀬紅莉栖＝今井麻美、椎名まゆり＝花澤香菜、阿万音鈴羽＝田村ゆかり、秋葉留未穂＝桃井はるこ）");
const S_SG_R23006 = src("https://vndb.org/r23006",
  "VNDB 发行 r23006「Steins;Gate」PS3 中文版：2012-11-15、原題「命運石之門」、発売 Koei Tecmo（中文官方題名依据）");
const S_SG_V17102 = src("https://vndb.org/v17102",
  "VNDB 条目 v17102「STEINS;GATE 0」：2015-12-10、平台 win/ps3/ps4/psv/swi/xbo、開発 MAGES.／M2");
const S_BGM_CL = src("https://bgm.tv/subject/13",
  "Bangumi 条目 13「CLANNAD」（游戏）：発売日 2004-04-28、封面图 lain.bgm.tv 链接");
const S_BGM_SG = src("https://bgm.tv/subject/3154",
  "Bangumi 条目 3154「STEINS;GATE」（游戏）：発売日 2009-10-15、封面图 lain.bgm.tv 链接");
const S_BGM_SG0 = src("https://bgm.tv/subject/129820",
  "Bangumi 条目 129820「STEINS;GATE 0」（游戏）：発売日 2015-12-10");
const S_BGM_V4060 = src("https://bgm.tv/subject/6312",
  "Bangumi 条目 6312「CLANNAD: 光見守る坂道で 上巻」（PSP 游戏）：2010-06-03（家庭用移植版以分巻形式发售的旁证）");

const ev = (note, sources) => ({ note, sources });

// ── 多语言题名：官方译名优先，没有官方译名时填原文（绝不编造）──────────────
const tr = (ja, opts = {}) => ({
  "ja-JP": { title: opts.ja || ja },
  "zh-CN": { title: opts.cn || ja },
  "zh-TW": { title: opts.tw || ja },
  "en-US": { title: opts.en || ja },
});
const pic = (url, citation, sourceUrl, caption) => ({
  url, caption, source: { kind: "url", citation, url: sourceUrl },
});

// ── 事实表 ──────────────────────────────────────────────────────────────
// CLANNAD：学園編のヒロインルート＋アフターストーリー（日文维基百科ストーリー節・登場人物節）
const CL_ROUTES = [
  { key: "nagisa", ja: "古河渚ルート", cn: "古河渚线", tw: "古河渚線", rank: "main",
    note: "メインヒロイン古河渚のルート（学園編）。" },
  { key: "fuuko", ja: "伊吹風子ルート", cn: "伊吹风子线", tw: "伊吹風子線", rank: "main",
    note: "ヒロイン伊吹風子のルート（学園編）。" },
  { key: "kotomi", ja: "一ノ瀬ことみルート", cn: "一之濑琴美线", tw: "一之瀬琴美線", rank: "main",
    note: "ヒロイン一ノ瀬ことみのルート（学園編）。" },
  { key: "kyou", ja: "藤林杏ルート", cn: "藤林杏线", tw: "藤林杏線", rank: "main",
    note: "ヒロイン藤林杏のルート（学園編）。" },
  { key: "tomoyo", ja: "坂上智代ルート", cn: "坂上智代线", tw: "坂上智代線", rank: "main",
    note: "ヒロイン坂上智代のルート（学園編）。" },
  { key: "after", ja: "アフターストーリー", cn: "AFTER STORY", tw: "AFTER STORY", en: "AFTER STORY", rank: "main",
    note: "学園編の後、卒業後の生活を描く第二部「アフターストーリー」。" },
];
// CLANNAD の声優（日文维基百科：PC 2004 年版は音声なし、PS2 版以降のキャスト）
const CL_VA = {
  nagisa: { ja: "中原 麻衣", en: "Mai Nakahara", char: "古河 渚" },
  tomoyo: { ja: "桑島 法子", en: "Houko Kuwashima", char: "坂上 智代" },
};
// STEINS;GATE：6 つのマルチエンドのうち 4 ルートを編目（ルート名は舞台版の編名・ゲーム内表記に準拠）
const SG_ROUTES = [
  { key: "mayuri", ja: "椎名まゆりルート", cn: "椎名真由理线", tw: "椎名真由理線", rank: "main",
    note: "ヒロイン椎名まゆりのルート（6 つのマルチエンドの一つ）。" },
  { key: "feris", ja: "フェイリス・ニャンニャンルート", cn: "菲利斯·喵喵线", tw: "菲利斯·喵喵線", rank: "main",
    note: "ヒロイン秋葉留未穂（フェイリス・ニャンニャン）のルート。" },
  { key: "suzuha", ja: "阿万音鈴羽ルート", cn: "阿万音铃羽线", tw: "阿萬音鈴羽線", rank: "main",
    note: "ヒロイン阿万音鈴羽のルート。" },
  { key: "kurisu", ja: "牧瀬紅莉栖ルート", cn: "牧濑红莉栖线", tw: "牧瀬紅莉栖線", rank: "main",
    note: "ヒロインメインヒロイン牧瀬紅莉栖のルート。" },
];
const SG_VA = {
  mayuri: { ja: "花澤 香菜", en: "Kana Hanazawa", char: "椎名 まゆり" },
  kurisu: { ja: "今井 麻美", en: "Asami Imai", char: "牧瀬 紅莉栖" },
};

const AGENTS = {
  key: { ja: "Key", tw: "Key", cn: "Key", en: "Key", type: "organization" },
  interchannel: { ja: "インターチャネル", tw: "Interchannel", cn: "Interchannel", en: "Interchannel Inc.", type: "organization" },
  mages: { ja: "MAGES.", tw: "MAGES.", cn: "MAGES.", en: "MAGES.", type: "organization" },
  nitroplus: { ja: "ニトロプラス", tw: "Nitroplus", cn: "Nitroplus", en: "Nitroplus", type: "organization" },
  maeda: { ja: "麻枝 准", tw: "麻枝准", cn: "麻枝准", en: "Jun Maeda", type: "person" },
  hinoue: { ja: "樋上 いたる", tw: "樋上いたる", cn: "樋上至", en: "Itaru Hinoue", type: "person" },
  abo: { ja: "阿保 剛", tw: "阿保剛", cn: "阿保刚", en: "Takeshi Abo", type: "person" },
  huke: { ja: "huke", tw: "huke", cn: "huke", en: "huke", type: "person" },
  hayashi: { ja: "林 直孝", tw: "林直孝", cn: "林直孝", en: "Naotaka Hayashi", type: "person" },
  nakahara: { ja: "中原 麻衣", tw: "中原麻衣", cn: "中原麻衣", en: "Mai Nakahara", type: "person" },
  kuwashima: { ja: "桑島 法子", tw: "桑島法子", cn: "桑岛法子", en: "Houko Kuwashima", type: "person" },
  hanazawa: { ja: "花澤 香菜", tw: "花澤香菜", cn: "花泽香菜", en: "Kana Hanazawa", type: "person" },
  imai: { ja: "今井 麻美", tw: "今井麻美", cn: "今井麻美", en: "Asami Imai", type: "person" },
  nagisa: { ja: "古河 渚", tw: "古河渚", cn: "古河渚", en: "Nagisa Furukawa", type: "character" },
  tomoyo: { ja: "坂上 智代", tw: "坂上智代", cn: "坂上智代", en: "Tomoyo Sakagami", type: "character" },
  kurisu: { ja: "牧瀬 紅莉栖", tw: "牧瀬紅莉栖", cn: "牧濑红莉栖", en: "Kurisu Makise", type: "character" },
  mayuri: { ja: "椎名 まゆり", tw: "椎名真由理", cn: "椎名真由理", en: "Mayuri Shiina", type: "character" },
};

// ── 主流程 ──────────────────────────────────────────────────────────────
const client = new Client();
if (!DRY) await client.login();
else console.log("[dry-run] 离线空跑：不登录、不写库、不发列表检索");
const camp = new Campaign({ domain: "visual-novel", client, index: Index.load() });
const lookup = !DRY; // 服务端 ?q= 查重只在真跑时执行（列表路由 120/分钟）
// 本次新建之前就已存在的实体 id（复用存量）：它们的四语题名缺口属于存量问题，记 warning 不计失败
const PREEXISTING = new Set(camp.index.rows.map((r) => r.id));

// 1) agents（人物/团体/角色；同一个人必须复用存量）
const A = {};
const AGENT_EV = {
  key: ev("编目：建立责任主体「Key」（Key 社，CLANNAD／智代アフター等の開発・発売元）。依据日文维基百科 CLANNAD (ゲーム) 条目（Key 制作）与 VNDB v4／v12 的開発欄。",
    [S_CL_WIKI, S_CL_V4, S_CL_V12]),
  interchannel: ev("编目：建立发行主体「インターチャネル」（现ガンホー・ワークス）。依据日文维基百科 CLANNAD (ゲーム)「PS2 版はインターチャネル（現ガンホー・ワークス）より 2006 年 2 月 23 日に発売」与 VNDB r301 制作欄「Interchannel Inc.」。",
    [S_CL_WIKI, S_CL_R301]),
  mages: ev("编目：建立责任主体「MAGES.」（5pb. の後身）。依据日文维基百科 STEINS;GATE 条目（5pb.（現 MAGES.）より発売・制作 5pb.）与 VNDB v2002／r5362 制作欄。",
    [S_SG_WIKI, S_SG_V2002, S_SG_R5362]),
  nitroplus: ev("编目：建立共同制作主体「ニトロプラス」。依据日文维基百科 STEINS;GATE 条目スタッフ欄「制作 - 5pb. / ニトロプラス」与 VNDB v2002 開発欄 NITRO PLUS。",
    [S_SG_WIKI, S_SG_V2002]),
  maeda: ev("编目：建立个人责任主体「麻枝 准」（CLANNAD 企画・シナリオ・音楽）。依据日文维基百科 CLANNAD (ゲーム) スタッフ欄（企画 麻枝准／シナリオ 麻枝准、涼元悠一、魁／音楽 折戸伸治、戸越まごめ、麻枝准）。",
    [S_CL_WIKI]),
  hinoue: ev("编目：建立个人责任主体「樋上 いたる」（CLANNAD 原画）。依据日文维基百科 CLANNAD (ゲーム) スタッフ欄「原画 - 樋上いたる」。",
    [S_CL_WIKI]),
  abo: ev("编目：建立个人责任主体「阿保 剛」（STEINS;GATE 音楽）。依据日文维基百科 STEINS;GATE スタッフ欄「音楽 - 阿保剛 (5pb.) / 磯江俊道 (ZIZZ)」。",
    [S_SG_WIKI]),
  huke: ev("编目：建立个人责任主体「huke」（STEINS;GATE キャラクターデザイン）。依据日文维基百科 STEINS;GATE スタッフ欄「キャラクターデザイン - huke」。",
    [S_SG_WIKI]),
  hayashi: ev("编目：复用存量主体「林直孝」（STEINS;GATE シナリオ）。依据日文维基百科 STEINS;GATE スタッフ欄「シナリオ - 林直孝 (5pb.) / 谷崎央佳」；同名 person 已存在于目录（已挂 BanG Dream! 2nd Season），按 BRIEF「同一真人必须复用」不新建。",
    [S_SG_WIKI]),
  va: (v) => ev("编目：建立配音演员「" + v.ja + "」。依据 VNDB v2002／v4 的声優（staff）表与日文维基百科人物欄；日文维基百科明确 CLANNAD 的 PC 2004 年版「声が収録されていない」ため、当該キャストは PS2 版以降／フルボイス版のものとして扱う。",
    [S_CL_WIKI, S_CL_V4, S_SG_WIKI, S_SG_V2002]),
  character: (name) => ev("编目：建立虚构角色「" + name + "」。依据日文维基百科 CLANNAD (ゲーム)／STEINS;GATE 登場人物欄与 VNDB 的角色／声優表（角色与声優の対応）。",
    [S_CL_WIKI, S_SG_WIKI, S_SG_V2002]),
};
for (const [key, a] of Object.entries(AGENTS)) {
  const note = key === "hayashi" ? AGENT_EV.hayashi
    : ["nakahara", "kuwashima", "hanazawa", "imai"].includes(key) ? AGENT_EV.va(a)
    : ["nagisa", "tomoyo", "kurisu", "mayuri"].includes(key) ? AGENT_EV.character(a.ja)
    : AGENT_EV[key];
  A[key] = await camp.ensureEntity("agent", a.ja, {
    original_language: "ja",
    types: [a.type],
    translations: tr(a.ja, { tw: a.tw, cn: a.cn, en: a.en }),
  }, note, { idemKey: "vn-agent-" + key, allowServerLookup: lookup });
}

// 2) collection（科学アドベンチャーシリーズ）
const collection = await camp.ensureEntity("collection", "科学アドベンチャーシリーズ", {
  original_language: "ja",
  types: ["collection"],
  translations: tr("科学アドベンチャーシリーズ", { cn: "科学冒险系列", tw: "科學冒險系列", en: "Science Adventure Series" }),
  attributes: { language: "ja" },
}, ev("编目：建立企划枢纽 collection「科学アドベンチャーシリーズ」。依据日文维基百科 STEINS;GATE 条目：「5pb. とニトロプラスのコラボレーション企画『科学アドベンチャーシリーズ』2 作目」。",
  [S_SG_WIKI]), { idemKey: "vn-collection-sciadv", allowServerLookup: lookup });

// 3) Works
const clannad = await camp.ensureEntity("work", "CLANNAD", {
  original_language: "ja",
  types: ["visual_novel"],
  translations: tr("CLANNAD", {}),
  attributes: {
    language: "ja",
    platform: "Windows / PlayStation 2 / PlayStation Portable / Xbox 360 / PlayStation 3 / PlayStation 4 / PlayStation Vita / Nintendo Switch / Android / iOS",
    edition_date: "2004-04-28",
    tags: ["恋愛アドベンチャーゲーム", "学園", "家族愛"],
  },
  external_ids: { vndb: "v4", bangumi: "13" },
  pictures: [pic("https://lain.bgm.tv/pic/cover/l/c5/1c/13_tQxwM.jpg",
    "Bangumi 条目 13 的条目封面图", "https://bgm.tv/subject/13",
    { "zh-CN": "CLANNAD 原作游戏条目封面（Bangumi 条目 13）", "ja-JP": "CLANNAD 原作ゲームの表紙（Bangumi #13）" })],
}, ev("编目：新建视觉小说工作《CLANNAD》（visual_novel，原语言 ja）。依据日文维基百科 CLANNAD (ゲーム)：Key 制作の恋愛アドベンチャーゲーム、全年齢対象の PC 版が 2004 年 4 月 28 日に発売、ストーリーは「学園編」と「アフターストーリー」の二部構成；平台列表据 VNDB v4（win/ps2/psp/xb3/ps3/ps4/psv/swi/and/ios 等）与日文维基百科各移植版記述；発売日 2004-04-28 经 Bangumi 条目 13 核对。tags 取自来源原文用語（恋愛アドベンチャーゲーム／学園／家族愛）。",
  [S_CL_WIKI, S_CL_V4, S_BGM_CL]), { idemKey: "vn-work-clannad", allowServerLookup: lookup });

const steinsgate = await camp.ensureEntity("work", "STEINS;GATE", {
  original_language: "ja",
  types: ["visual_novel"],
  translations: tr("STEINS;GATE", { tw: "命運石之門", cn: "命运石之门" }),
  attributes: {
    language: "ja",
    platform: "Xbox 360 / Windows / PlayStation Portable / PlayStation 3 / PlayStation Vita / PlayStation 4 / Nintendo Switch / Android / iOS",
    edition_date: "2009-10-15",
    tags: ["アドベンチャーゲーム", "サウンドノベル", "科学アドベンチャー", "世界線"],
  },
  external_ids: { vndb: "v2002", bangumi: "3154", steam: "412830" },
  pictures: [pic("https://lain.bgm.tv/pic/cover/l/fd/bd/3154_j71Z7.jpg",
    "Bangumi 条目 3154 的条目封面图", "https://bgm.tv/subject/3154",
    { "zh-CN": "STEINS;GATE 原作游戏条目封面（Bangumi 条目 3154）", "ja-JP": "STEINS;GATE 原作ゲームの表紙（Bangumi #3154）" })],
}, ev("编目：新建视觉小说工作《STEINS;GATE》（visual_novel，原语言 ja）。依据日文维基百科 STEINS;GATE：5pb.（現 MAGES.）より発売、ファーストバージョンは Xbox 360 にて 2009 年 10 月 15 日発売、サウンドノベル形式で 6 つのマルチエンド＋トゥルーエンド；中文官方題名「命運石之門」据 VNDB r23006（PS3 中文版，2012-11-15、Koei Tecmo）；平台列表据 VNDB v2002 与各移植版記述；発売日经 Bangumi 条目 3154 核对。",
  [S_SG_WIKI, S_SG_V2002, S_SG_R23006, S_BGM_SG]), { idemKey: "vn-work-steinsgate", allowServerLookup: lookup });

const sg0 = await camp.ensureEntity("work", "STEINS;GATE 0", {
  original_language: "ja",
  types: ["visual_novel"],
  translations: tr("STEINS;GATE 0", { tw: "命運石之門 0", cn: "命运石之门 0" }),
  attributes: { language: "ja", platform: "PlayStation 4 / PlayStation 3 / PlayStation Vita / Xbox One / Windows / Nintendo Switch", edition_date: "2015-12-10" },
  external_ids: { vndb: "v17102", bangumi: "129820" },
}, ev("编目：新建视觉小说工作《STEINS;GATE 0》（visual_novel）。依据日文维基百科 STEINS;GATE「続編として β 世界線が描かれる PlayStation 4/PlayStation 3/PlayStation Vita 用『STEINS;GATE 0』が 2015 年 12 月 10 日に発売」；平台与発売日经 VNDB v17102、Bangumi 129820 核对。本领域只为 sequel_of 关系建立该作品工作层，不补篇目/发行。",
  [S_SG_WIKI, S_SG_V17102, S_BGM_SG0]), { idemKey: "vn-work-sg0", allowServerLookup: lookup });

const tomoyoAfter = await camp.ensureEntity("work", "智代アフター ～It's a Wonderful Life～", {
  original_language: "ja",
  types: ["visual_novel"],
  translations: tr("智代アフター ～It's a Wonderful Life～", { en: "Tomoyo After ~It's a Wonderful Life~" }),
  attributes: { language: "ja", platform: "Windows / PlayStation 2 / PlayStation Portable / PlayStation 3 / Xbox 360 / Android", edition_date: "2005-11-25" },
  external_ids: { vndb: "v12" },
}, ev("编目：新建视觉小说工作《智代アフター ～It's a Wonderful Life～》（visual_novel）。依据日文维基百科 CLANNAD (ゲーム)「スピンオフ作品に、本作ヒロインの 1 人である坂上智代との後日談を描いた 18 禁作品『智代アフター 〜It's a Wonderful Life〜』がある」；発売日 2005-11-25 与開発 Key 据 VNDB v12。",
  [S_CL_WIKI, S_CL_V12]), { idemKey: "vn-work-tomoyo-after", allowServerLookup: lookup });

const hikariGame = await camp.ensureEntity("work", "CLANNAD -クラナド- 光見守る坂道で", {
  original_language: "ja",
  types: ["visual_novel"],
  translations: tr("CLANNAD -クラナド- 光見守る坂道で", { en: "CLANNAD - Hikari Mimamoru Sakamichi de" }),
  attributes: { language: "ja", platform: "携帯アプリ / PlayStation Portable / Xbox 360 / PlayStation 3 / Nintendo Switch / Windows", edition_date: "2008-01-08" },
  external_ids: { vndb: "v4060", bangumi: "6312" },
}, ev("编目：新建视觉小说工作《CLANNAD -クラナド- 光見守る坂道で》（visual_novel）。依据 VNDB v4060「A 'visual sound novel' adaption of the Hikari Mimamoru Sakamichi De short stories」、初出 2008-01-08（携帯アプリ）；日文维基百科 CLANNAD (ゲーム) 记载公式外伝小説の 2010 年 PSP 用ビジュアルサウンドノベル化。",
  [S_CL_V4060, S_CL_WIKI, S_BGM_V4060]), { idemKey: "vn-work-hikari-vn", allowServerLookup: lookup });

const hikariBook = await camp.ensureEntity("work", "CLANNAD ～光見守る坂道で～", {
  original_language: "ja",
  types: ["novel"],
  translations: tr("CLANNAD ～光見守る坂道で～", { en: "Clannad ~Hikari Mimamoru Sakamichi de~" }),
  attributes: { language: "ja", magazine: "電撃G's magazine", author: "Key（文・原作）、ごとP（イラスト）" },
}, ev("编目：新建小说工作《CLANNAD ～光見守る坂道で～》（novel，公式外伝小説）。依据国立国会図書館サーチ書誌 I000008005812：『Clannad～光見守る坂道で～ : official another story』メディアワークス 2005.12、ISBN 4-8402-3250-4、責任表示 Key 文&原作・ごとP イラスト；掲載誌『電撃G's magazine』据日文维基百科 CLANNAD (ゲーム)。注意：本项只建工作层，未建该书的 Release/ISBN 发行（见报告缺口清单）。",
  [S_CL_BOOK, S_CL_WIKI]), { idemKey: "vn-work-hikari-book", allowServerLookup: lookup });

// 4) ContentUnit（路線）
const CU = { cl: {}, sg: {} };
for (const [i, r] of CL_ROUTES.entries()) {
  CU.cl[r.key] = await camp.ensureEntity("content_unit", r.ja, {
    work_id: clannad.id, position: i + 1,
    original_language: "ja", types: ["content_unit"],
    translations: tr(r.ja, { cn: r.cn, tw: r.tw, en: r.en }),
    attributes: { language: "ja", entry_role: "main" },
  }, ev("编目：为《CLANNAD》建立路线篇目 content_unit「" + r.ja + "」（entry_role=main、position=" + (i + 1) + "）。依据日文维基百科 CLANNAD (ゲーム) ストーリー節（学園編は各キャラクターのルートに分岐、アフターストーリーは卒業後を描く第二部）与登場人物節のヒロイン記述；" + r.note,
    [S_CL_WIKI, S_CL_V4]), { idemKey: "vn-cu-cl-" + r.key, allowServerLookup: false });
}
for (const [i, r] of SG_ROUTES.entries()) {
  CU.sg[r.key] = await camp.ensureEntity("content_unit", r.ja, {
    work_id: steinsgate.id, position: i + 1,
    original_language: "ja", types: ["content_unit"],
    translations: tr(r.ja, { cn: r.cn, tw: r.tw }),
    attributes: { language: "ja", entry_role: "main" },
  }, ev("编目：为《STEINS;GATE》建立路线篇目 content_unit「" + r.ja + "」（entry_role=main、position=" + (i + 1) + "）。依据日文维基百科 STEINS;GATE ゲームシステム節（6 つのマルチエンド、各ヒロインのルートへの分岐）与舞台版の 6 ルート表記（紅莉栖編・フェイリス編・まゆり編・鈴羽編 等）；" + r.note,
    [S_SG_WIKI, S_SG_V2002]), { idemKey: "vn-cu-sg-" + r.key, allowServerLookup: false });
}

// 5) Expression（路線 × 平台/言語），必须挂 content_unit_id
const EX = { cl: {}, sg: {} };
for (const r of CL_ROUTES) {
  const key = r.key + "_pc";
  EX.cl[key] = await camp.ensureEntity("expression", r.ja + "（PC版 2004）", {
    work_id: clannad.id, content_unit_id: CU.cl[r.key].id, position: CL_ROUTES.indexOf(r) + 1,
    original_language: "ja", types: ["expression"],
    translations: tr(r.ja + "（PC版 2004）", { cn: (r.cn || r.ja) + "（PC 版 2004）", tw: (r.tw || r.ja) + "（PC 版 2004）", en: (r.en || r.ja) + " (PC, 2004)" }),
    attributes: { language: "ja", version_label: "PC版（2004年 Windows 版・音声なし）" },
  }, ev("编目：为「" + r.ja + "」建立 PC 版表达（framework 表达层=該路線のプラットフォーム別実装、挂 content_unit_id）。依据日文维基百科 CLANNAD (ゲーム)：原典 PC 版 2004-04-28 発売、全年齢、PC 版に音声は収録されていない。",
    [S_CL_WIKI, S_CL_V4, S_CL_R302]), { idemKey: "vn-expr-cl-pc-" + r.key, allowServerLookup: false });
}
for (const key of ["nagisa", "tomoyo"]) {
  const r = CL_ROUTES.find((x) => x.key === key);
  EX.cl[key + "_ps2"] = await camp.ensureEntity("expression", r.ja + "（PS2版 2006）", {
    work_id: clannad.id, content_unit_id: CU.cl[key].id, position: CL_ROUTES.indexOf(r) + 1,
    original_language: "ja", types: ["expression"],
    translations: tr(r.ja + "（PS2版 2006）", { cn: (r.cn || r.ja) + "（PS2 版 2006）", tw: (r.tw || r.ja) + "（PS2 版 2006）", en: (r.en || r.ja) + " (PlayStation 2, 2006)" }),
    attributes: { language: "ja", version_label: "PS2版（2006年・フルボイス）" },
  }, ev("编目：为「" + r.ja + "」建立 PS2 版表达（フルボイス実装、挂 content_unit_id）。依据日文维基百科 CLANNAD (ゲーム)：PS2 版は 2006 年 2 月 23 日にインターチャネルより発売されキャラクターボイスを実装し、PC 版の音声なしに対し PS2 版以降が本キャスト。本次只编目渚・智代两条路线的 PS2 版表达（其余路线未编目，见报告）。",
    [S_CL_WIKI, S_CL_R301]), { idemKey: "vn-expr-cl-ps2-" + key, allowServerLookup: false });
}
for (const r of SG_ROUTES) {
  const key = r.key + "_xb3";
  EX.sg[key] = await camp.ensureEntity("expression", r.ja + "（Xbox 360版 2009）", {
    work_id: steinsgate.id, content_unit_id: CU.sg[r.key].id, position: SG_ROUTES.indexOf(r) + 1,
    original_language: "ja", types: ["expression"],
    translations: tr(r.ja + "（Xbox 360版 2009）", { cn: (r.cn || r.ja) + "（Xbox 360 版 2009）", tw: (r.tw || r.ja) + "（Xbox 360 版 2009）", en: (r.ja) + " (Xbox 360, 2009)" }),
    attributes: { language: "ja", version_label: "Xbox 360版（2009年・原典ファーストバージョン）" },
  }, ev("编目：为「" + r.ja + "」建立 Xbox 360 版表达（原典ファーストバージョン、フルボイス、挂 content_unit_id）。依据日文维基百科 STEINS;GATE（原典 Xbox 360 2009-10-15 発売）与 VNDB v2002 声優表。",
    [S_SG_WIKI, S_SG_V2002, S_SG_R5362]), { idemKey: "vn-expr-sg-xb3-" + r.key, allowServerLookup: false });
}
EX.sg.kurisu_en = await camp.ensureEntity("expression", "牧瀬紅莉栖ルート（Steam版 英語）", {
  work_id: steinsgate.id, content_unit_id: CU.sg.kurisu.id, position: 4,
  original_language: "en", types: ["expression"],
  translations: tr("牧瀬紅莉栖ルート（Steam版 英語）", { cn: "牧濑红莉栖线（Steam 英文版）", tw: "牧瀬紅莉栖線（Steam 英文版）", en: "Kurisu Makise Route (Steam, English)" }),
  attributes: { language: "en", version_label: "Steam版（2016年・英語テキスト）" },
}, ev("编目：为「牧瀬紅莉栖ルート」建立英文（Steam 版）表达，作为 translation_of 关系的译本表达（挂 content_unit_id、language=en）。依据 Steam 商店 appdetails 412830「配信日 Sep 8, 2016／対応言語 English, Japanese, Simplified Chinese, Traditional Chinese」与 VNDB r47588（2016-09-08、win、ダウンロード版、official）。本次只为该路线的英文表达做样例，其余路线未建英文表达（见报告）。",
  [S_SG_STEAM, S_SG_R47588]), { idemKey: "vn-expr-sg-kurisu-en", allowServerLookup: false });

// 6) Release
const relClFp = await camp.ensureEntity("release", "CLANNAD 初回限定版", {
  original_language: "ja", types: ["release"],
  translations: tr("CLANNAD 初回限定版", { en: "Clannad - First Press Edition" }),
  subjects: [{ work_id: clannad.id, role: "primary" }],
  attributes: {
    barcode: "4933032002963", edition_date: "2004-04-28", edition_type: "limited", edition_batch: "first_press",
    country: "JP", publisher: A.key.id, distribution_channel: "physical", platform: "Windows",
  },
}, ev("编目：新建发行《CLANNAD 初回限定版》（PC / DVD-ROM、2004-04-28、Key 発売）。JAN 4933032002963 与媒体 DVD-ROM×1 据 VNDB r302；発売日与「初回限定版」名称据日文维基百科 CLANNAD (ゲーム)。subjects 声明 CLANNAD 为 primary。包装形态（同梱物明细）无来源故未填 packaging/attachments。",
  [S_CL_R302, S_CL_WIKI, S_CL_V4]), { idemKey: "vn-rel-cl-firstpress", allowServerLookup: false });

const relClPs2 = await camp.ensureEntity("release", "CLANNAD PlayStation 2版", {
  original_language: "ja", types: ["release"],
  translations: tr("CLANNAD PlayStation 2版", { cn: "CLANNAD PlayStation 2 版", tw: "CLANNAD PlayStation 2 版", en: "Clannad (PlayStation 2)" }),
  subjects: [{ work_id: clannad.id, role: "primary" }],
  attributes: {
    catalog_number: "SLPM-66981", barcode: "4580277330056", edition_date: "2006-02-23",
    edition_type: "standard", edition_batch: "regular", country: "JP", publisher: A.interchannel.id,
    distribution_channel: "physical", platform: "PlayStation 2",
  },
}, ev("编目：新建发行《CLANNAD PlayStation 2版》（2006-02-23）。品番 SLPM-66981、JAN 4580277330056、媒体 DVD-ROM×1、制作 Key／Interchannel Inc. 据 VNDB r301；「インターチャネルより 2006 年 2 月 23 日に発売、キャラクターボイスを実装」据日文维基百科 CLANNAD (ゲーム)。subjects 声明 CLANNAD 为 primary。",
  [S_CL_R301, S_CL_WIKI]), { idemKey: "vn-rel-cl-ps2", allowServerLookup: false });

const relSgXb3 = await camp.ensureEntity("release", "STEINS;GATE Xbox 360版", {
  original_language: "ja", types: ["release"],
  translations: tr("STEINS;GATE Xbox 360版", { cn: "STEINS;GATE Xbox 360 版", tw: "STEINS;GATE Xbox 360 版", en: "Steins;Gate (Xbox 360)" }),
  subjects: [{ work_id: steinsgate.id, role: "primary" }],
  attributes: {
    catalog_number: "W2D-00001", barcode: "4988648682740", edition_date: "2009-10-15",
    edition_type: "standard", edition_batch: "regular", country: "JP", publisher: A.mages.id,
    distribution_channel: "physical", platform: "Xbox 360",
  },
}, ev("编目：新建发行《STEINS;GATE Xbox 360版》（原典ファーストバージョン、2009-10-15）。品番 W2D-00001、JAN 4988648682740、媒体 DVD-ROM×1、制作 MAGES.／NITRO PLUS 据 VNDB r5362；発売日与「ファーストバージョンは Xbox 360 にて 2009 年 10 月 15 日発売」据日文维基百科 STEINS;GATE。subjects 声明 STEINS;GATE 为 primary。",
  [S_SG_R5362, S_SG_WIKI]), { idemKey: "vn-rel-sg-xb3", allowServerLookup: false });

const relSgSteam = await camp.ensureEntity("release", "STEINS;GATE ダウンロード版（Steam）", {
  original_language: "ja", types: ["release"],
  translations: tr("STEINS;GATE ダウンロード版（Steam）", { cn: "STEINS;GATE 下载版（Steam）", tw: "STEINS;GATE 下載版（Steam）", en: "STEINS;GATE - Download Edition (Steam)" }),
  subjects: [{ work_id: steinsgate.id, role: "primary" }],
  attributes: {
    edition_date: "2016-09-08", edition_type: "standard", edition_batch: "regular",
    publisher: A.mages.id, distribution_channel: "digital", platform: "Windows (Steam)",
  },
}, ev("编目：新建数字发行《STEINS;GATE ダウンロード版（Steam）》（2016-09-08）。据 Steam 商店 appdetails 412830（配信日 Sep 8, 2016、開発 MAGES. Inc.、対応言語 English/Japanese/Simplified Chinese/Traditional Chinese）与 VNDB r47588（2016-09-08、win、ダウンロード、official、公式リンクが Steam 版ページ）。subjects 声明 STEINS;GATE 为 primary；该发行含英文文本，故其 Track 引用英文译本表达。",
  [S_SG_STEAM, S_SG_R47588]), { idemKey: "vn-rel-sg-steam", allowServerLookup: false });

// 7) Medium
const medClFp = await camp.ensureEntity("medium", "DVD-ROM", {
  release_id: relClFp.id, position: 1, original_language: "", types: ["medium"],
  translations: tr("DVD-ROM", {}),
  attributes: { format: "dvd", role: "primary" },
}, ev("编目：按发行实物建立载体 DVD-ROM（format=dvd）1 枚。依据 VNDB r302（media: dvd ×1）。",
  [S_CL_R302]), { idemKey: "vn-med-cl-firstpress-dvd", scope: { release_id: relClFp.id }, allowServerLookup: false });

const medClPs2 = await camp.ensureEntity("medium", "DVD-ROM", {
  release_id: relClPs2.id, position: 1, original_language: "", types: ["medium"],
  translations: tr("DVD-ROM", {}),
  attributes: { format: "dvd", role: "primary" },
}, ev("编目：按发行实物建立载体 DVD-ROM（format=dvd）1 枚。依据 VNDB r301（media: dvd ×1）。",
  [S_CL_R301]), { idemKey: "vn-med-cl-ps2-dvd", scope: { release_id: relClPs2.id }, allowServerLookup: false });

const medSgXb3 = await camp.ensureEntity("medium", "DVD-ROM", {
  release_id: relSgXb3.id, position: 1, original_language: "", types: ["medium"],
  translations: tr("DVD-ROM", {}),
  attributes: { format: "dvd", role: "primary" },
}, ev("编目：按发行实物建立载体 DVD-ROM（format=dvd）1 枚。依据 VNDB r5362（media: dvd ×1）。",
  [S_SG_R5362]), { idemKey: "vn-med-sg-xb3-dvd", scope: { release_id: relSgXb3.id }, allowServerLookup: false });

const medSgSteam = await camp.ensureEntity("medium", "ダウンロード", {
  release_id: relSgSteam.id, position: 1, original_language: "", types: ["medium"],
  translations: tr("ダウンロード", { cn: "下载", tw: "下載", en: "Download" }),
  attributes: { format: "web", role: "primary" },
}, ev("编目：按数字发行建立载体「ダウンロード」（format=web）1 件。依据 VNDB r47588（media: インターネットダウンロード）与 Steam appdetails 412830。",
  [S_SG_R47588, S_SG_STEAM]), { idemKey: "vn-med-sg-steam-web", scope: { release_id: relSgSteam.id }, allowServerLookup: false });

// 8) Track（contents 引用 Expression；同批 Expression 可被多个发行的 Track 重复收录）
const readme = "（视觉小说光盘内无物理音轨，本 Track 表示该路线在本载体中的收录位置，locator 留空=整载体收录）";
const TK = { clFp: {}, clPs2: {}, sgXb3: {}, sgSteam: {} };
for (const [i, r] of CL_ROUTES.entries()) {
  const expr = EX.cl[r.key + "_pc"];
  TK.clFp[r.key] = await camp.ensureEntity("track", r.ja, {
    medium_id: medClFp.id, position: i + 1,
    contents: [{ expression_id: expr.id, position: 1, locator: null }],
    original_language: "", types: ["track"],
    translations: tr(r.ja, { cn: r.cn, tw: r.tw, en: r.en }),
    attributes: { role: "primary" },
  }, ev("编目：为《CLANNAD 初回限定版》的 DVD-ROM 建立收录位置 Track（position=" + (i + 1) + "，contents 引用 PC 版表達）。" + readme + " 篇目顺序与题名据日文维基百科 CLANNAD (ゲーム)。",
    [S_CL_WIKI, S_CL_R302]), { idemKey: "vn-track-cl-fp-" + r.key, scope: { medium_id: medClFp.id }, allowServerLookup: false });
}
for (const [i, key] of ["nagisa", "tomoyo"].entries()) {
  const r = CL_ROUTES.find((x) => x.key === key);
  const expr = EX.cl[key + "_ps2"];
  TK.clPs2[key] = await camp.ensureEntity("track", r.ja, {
    medium_id: medClPs2.id, position: i + 1,
    contents: [{ expression_id: expr.id, position: 1, locator: null }],
    original_language: "", types: ["track"],
    translations: tr(r.ja, { cn: r.cn, tw: r.tw, en: r.en }),
    attributes: { role: "primary" },
  }, ev("编目：为《CLANNAD PlayStation 2版》的 DVD-ROM 建立收录位置 Track（position=" + (i + 1) + "，contents 引用 PS2 版表達）。" + readme + " 本次只编目渚・智代两条路线的 PS2 收录位置（其余路线未编目，见报告）。",
    [S_CL_WIKI, S_CL_R301]), { idemKey: "vn-track-cl-ps2-" + key, scope: { medium_id: medClPs2.id }, allowServerLookup: false });
}
for (const [i, r] of SG_ROUTES.entries()) {
  const expr = EX.sg[r.key + "_xb3"];
  TK.sgXb3[r.key] = await camp.ensureEntity("track", r.ja, {
    medium_id: medSgXb3.id, position: i + 1,
    contents: [{ expression_id: expr.id, position: 1, locator: null }],
    original_language: "", types: ["track"],
    translations: tr(r.ja, { cn: r.cn, tw: r.tw }),
    attributes: { role: "primary" },
  }, ev("编目：为《STEINS;GATE Xbox 360版》的 DVD-ROM 建立收录位置 Track（position=" + (i + 1) + "，contents 引用 Xbox 360 版表達）。" + readme + " 篇目题名据日文维基百科 STEINS;GATE（6 つのマルチエンド）。",
    [S_SG_WIKI, S_SG_R5362]), { idemKey: "vn-track-sg-xb3-" + r.key, scope: { medium_id: medSgXb3.id }, allowServerLookup: false });
}
TK.sgSteam.kurisu = await camp.ensureEntity("track", "牧瀬紅莉栖ルート", {
  medium_id: medSgSteam.id, position: 1,
  contents: [{ expression_id: EX.sg.kurisu_en.id, position: 1, locator: null }],
  original_language: "", types: ["track"],
  translations: tr("牧瀬紅莉栖ルート", { cn: "牧濑红莉栖线", tw: "牧瀬紅莉栖線" }),
  attributes: { role: "primary" },
}, ev("编目：为《STEINS;GATE ダウンロード版（Steam）》建立收录位置 Track（position=1，contents 引用英文译本表達）。" + readme + " 该发行实际收录全篇，本次只编目紅莉栖ルート的英文表达，属不完整编目（见报告）。",
  [S_SG_STEAM, S_SG_R47588]), { idemKey: "vn-track-sg-steam-kurisu", scope: { medium_id: medSgSteam.id }, allowServerLookup: false });

// 9) 关系
const REL = [];
const addRel = (type, srcId, tgtId, evd, attributes = {}) => REL.push({ type, srcId, tgtId, ev: evd, attributes });

addRel("developed_by", clannad.id, A.key.id,
  ev("编目：署名《CLANNAD》の開発・発売元为 Key。依据日文维基百科 CLANNAD (ゲーム)「Key 制作による恋愛アドベンチャーゲーム」与 VNDB v4 開発欄 Key。",
    [S_CL_WIKI, S_CL_V4]), { credit_role: "開発・発売元" });
addRel("developed_by", steinsgate.id, A.mages.id,
  ev("编目：署名《STEINS;GATE》の制作・発売元为 MAGES.（旧 5pb.）。依据日文维基百科 STEINS;GATE「5pb.（現・MAGES.）より発売された」与スタッフ欄「制作 - 5pb. / ニトロプラス」。",
    [S_SG_WIKI, S_SG_V2002]), { credit_role: "発売元・制作" });
addRel("developed_by", steinsgate.id, A.nitroplus.id,
  ev("编目：署名《STEINS;GATE》の共同制作为ニトロプラス。依据日文维基百科 STEINS;GATE スタッフ欄「制作 - 5pb. / ニトロプラス」与 VNDB v2002 開発欄 NITRO PLUS。",
    [S_SG_WIKI, S_SG_V2002]), { credit_role: "共同制作" });
addRel("written_by", clannad.id, A.maeda.id,
  ev("编目：署名《CLANNAD》のシナリオ为麻枝准。依据日文维基百科 CLANNAD (ゲーム) スタッフ欄「シナリオ - 麻枝准、涼元悠一、魁、（丘野塔也）」（本次只为麻枝准建立该关系，其余シナリオライター未建 agent）。",
    [S_CL_WIKI]), { credit_role: "シナリオ" });
addRel("written_by", steinsgate.id, A.hayashi.id,
  ev("编目：署名《STEINS;GATE》のシナリオ为林直孝。依据日文维基百科 STEINS;GATE スタッフ欄「シナリオ - 林直孝 (5pb.) / 谷崎央佳」。林直孝 复用目录已有 person。",
    [S_SG_WIKI]), { credit_role: "シナリオ" });
addRel("composed_by", clannad.id, A.maeda.id,
  ev("编目：署名《CLANNAD》の音楽为麻枝准（三人の音楽担当のうち一人）。依据日文维基百科 CLANNAD (ゲーム) スタッフ欄「音楽 - 折戸伸治、戸越まごめ、麻枝准」。",
    [S_CL_WIKI]), { credit_role: "音楽" });
addRel("composed_by", steinsgate.id, A.abo.id,
  ev("编目：署名《STEINS;GATE》の音楽为阿保剛。依据日文维基百科 STEINS;GATE スタッフ欄「音楽 - 阿保剛 (5pb.) / 磯江俊道 (ZIZZ)」。",
    [S_SG_WIKI]), { credit_role: "音楽" });
addRel("illustrated_by", clannad.id, A.hinoue.id,
  ev("编目：署名《CLANNAD》の原画为樋上いたる。依据日文维基百科 CLANNAD (ゲーム) スタッフ欄「原画 - 樋上いたる」。",
    [S_CL_WIKI]), { credit_role: "原画" });
addRel("illustrated_by", steinsgate.id, A.huke.id,
  ev("编目：署名《STEINS;GATE》のキャラクターデザイン为 huke。依据日文维基百科 STEINS;GATE スタッフ欄「キャラクターデザイン - huke」。",
    [S_SG_WIKI]), { credit_role: "キャラクターデザイン" });
for (const [key, name] of [["nagisa", "古河 渚"], ["tomoyo", "坂上 智代"], ["kurisu", "牧瀬 紅莉栖"], ["mayuri", "椎名 まゆり"]]) {
  const work = ["nagisa", "tomoyo"].includes(key) ? clannad : steinsgate;
  addRel("character_in", A[key].id, work.id,
    ev("编目：署名虚构角色「" + name + "」に登场作品为《" + work.title + "》。依据日文维基百科" + (work === clannad ? "CLANNAD (ゲーム)" : "STEINS;GATE") + " 登場人物節与 VNDB 声優表（角色与声優の対応）。character_rank 由来源的人物記述（メインヒロイン等）判定为 main。",
      [work === clannad ? S_CL_WIKI : S_SG_WIKI, work === clannad ? S_CL_V4 : S_SG_V2002]), { character_rank: "main" });
}
addRel("voiced_by", EX.cl.nagisa_ps2.id, A.nakahara.id,
  ev("编目：署名「古河渚ルート（PS2版 2006）」の古河渚役为中原麻衣。依据日文维基百科 CLANNAD (ゲーム) 登場人物節「古河 渚 声 - 中原麻衣」与同条「2004 年発売の PC 版、携帯アプリ版は声が収録されていないため、声優は PlayStation 2 版・ドラマ CD・映像化作品および PC フルボイス版等のキャスティング」——故只在 PS2 版表達上署名声優。",
    [S_CL_WIKI, S_CL_V4]), { character: A.nagisa.id, language: "ja", credit_role: "声" });
addRel("voiced_by", EX.cl.tomoyo_ps2.id, A.kuwashima.id,
  ev("编目：署名「坂上智代ルート（PS2版 2006）」の坂上智代役为桑島法子。依据日文维基百科 CLANNAD (ゲーム) 登場人物節「坂上 智代 声 - 桑島法子」（PC 2004 年版は音声なし）。",
    [S_CL_WIKI, S_CL_V4]), { character: A.tomoyo.id, language: "ja", credit_role: "声" });
addRel("voiced_by", EX.sg.mayuri_xb3.id, A.hanazawa.id,
  ev("编目：署名「椎名まゆりルート（Xbox 360版 2009）」の椎名まゆり役为花澤香菜。依据 VNDB v2002 声優表（椎名まゆり → 花澤香菜）与日文维基百科 STEINS;GATE。",
    [S_SG_V2002, S_SG_WIKI]), { character: A.mayuri.id, language: "ja", credit_role: "声" });
addRel("voiced_by", EX.sg.kurisu_xb3.id, A.imai.id,
  ev("编目：署名「牧瀬紅莉栖ルート（Xbox 360版 2009）」の牧瀬紅莉栖役为今井麻美。依据 VNDB v2002 声優表（牧瀬紅莉栖 → 今井麻美）与日文维基百科 STEINS;GATE。",
    [S_SG_V2002, S_SG_WIKI]), { character: A.kurisu.id, language: "ja", credit_role: "声" });
addRel("credit_for", relClFp.id, A.key.id,
  ev("编目：署名《CLANNAD 初回限定版》の発売元为 Key。依据 VNDB r302 制作欄 Key 与日文维基百科 CLANNAD (ゲーム)（PC オリジナル版は Key より発売）。",
    [S_CL_R302, S_CL_WIKI]), { credit_role: "発売元" });
addRel("credit_for", relClPs2.id, A.interchannel.id,
  ev("编目：署名《CLANNAD PlayStation 2版》の発売元为インターチャネル。依据日文维基百科 CLANNAD (ゲーム)「PS2 版は…インターチャネル（現ガンホー・ワークス）より 2006 年 2 月 23 日に発売」与 VNDB r301 制作欄 Interchannel Inc.。",
    [S_CL_WIKI, S_CL_R301]), { credit_role: "発売元" });
addRel("credit_for", relSgXb3.id, A.mages.id,
  ev("编目：署名《STEINS;GATE Xbox 360版》の発売元为 MAGES.。依据 VNDB r5362 制作欄 MAGES.／NITRO PLUS 与日文维基百科 STEINS;GATE（5pb. より発売）。",
    [S_SG_R5362, S_SG_WIKI]), { credit_role: "発売元" });
addRel("adaptation_of", hikariGame.id, hikariBook.id,
  ev("编目：署名《CLANNAD -クラナド- 光見守る坂道で》（ビジュアルサウンドノベル）为短編集《CLANNAD ～光見守る坂道で～》の游戏化（改编）。依据 VNDB v4060「A 'visual sound novel' adaption of the Hikari Mimamoru Sakamichi De short stories」与日文维基百科 CLANNAD (ゲーム)（公式外伝小説の 2010 年 PSP 用ビジュアルサウンドノベル化）。adaptation_of 方向为「改编作 → 原作」。",
    [S_CL_V4060, S_CL_WIKI, S_CL_BOOK]), { scope: "短編集のゲーム化" });
addRel("spin_off_of", tomoyoAfter.id, clannad.id,
  ev("编目：署名《智代アフター ～It's a Wonderful Life～》为本作ヒロイン坂上智代の後日談スピンオフ。依据日文维基百科 CLANNAD (ゲーム)「スピンオフ作品に、本作ヒロインの 1 人である坂上智代との後日談を描いた 18 禁作品『智代アフター 〜It's a Wonderful Life〜』がある」。",
    [S_CL_WIKI, S_CL_V12]), { scope: "坂上智代の後日談" });
addRel("sequel_of", sg0.id, steinsgate.id,
  ev("编目：署名《STEINS;GATE 0》为《STEINS;GATE》の続編（β 世界線）。依据日文维基百科 STEINS;GATE「続編として β 世界線が描かれる…『STEINS;GATE 0』が 2015 年 12 月 10 日に発売」与 VNDB v17102。",
    [S_SG_WIKI, S_SG_V17102]), { scope: "β 世界線の続編" });
addRel("translation_of", EX.sg.kurisu_en.id, EX.sg.kurisu_xb3.id,
  ev("编目：署名「牧瀬紅莉栖ルート（Steam版 英語）」为「牧瀬紅莉栖ルート（Xbox 360版 2009）」日文原文の英語文本版（译本表达）。依据 Steam appdetails 412830（対応言語 English/Japanese）与 VNDB r47588。",
    [S_SG_STEAM, S_SG_R47588]), { language: "en", scope: "英語テキスト版" });
addRel("includes", collection.id, steinsgate.id,
  ev("编目：署名《STEINS;GATE》属于企划系列「科学アドベンチャーシリーズ」。依据日文维基百科 STEINS;GATE「『CHAOS;HEAD』に続く、5pb. とニトロプラスのコラボレーション企画『科学アドベンチャーシリーズ』2 作目」。",
    [S_SG_WIKI]), { scope: "シリーズ第2作" });

for (const r of REL) {
  await camp.createRelation(r.type, r.srcId, r.tgtId, r.ev, {
    attributes: r.attributes,
    idemKey: "vn-rel-" + r.type + "-" + r.srcId.slice(0, 8) + "-" + r.tgtId.slice(0, 8),
    skipIfExists: !DRY,
  });
}

// ── 写后回读断言 ────────────────────────────────────────────────────────
const problems = [];
const warnings = [];
const checked = { entities: 0, relations: 0, revisions: 0 };
const check = (ok, msg) => { if (!ok) problems.push(msg); };
const warn = (msg) => { warnings.push(msg); };

async function verify() {
  const ALL = [];
  const push = (e, tag) => ALL.push({ e, tag });
  push(clannad, "work/CLANNAD"); push(steinsgate, "work/STEINS;GATE"); push(sg0, "work/SG0");
  push(tomoyoAfter, "work/TomoyoAfter"); push(hikariGame, "work/HikariVN"); push(hikariBook, "work/HikariBook");
  push(collection, "collection/SciAdv");
  for (const k of Object.keys(A)) push(A[k], "agent/" + k);
  for (const r of CL_ROUTES) { push(CU.cl[r.key], "cu/cl/" + r.key); push(EX.cl[r.key + "_pc"], "expr/cl/" + r.key + "/pc"); push(TK.clFp[r.key], "track/cl/fp/" + r.key); }
  for (const k of ["nagisa", "tomoyo"]) { push(EX.cl[k + "_ps2"], "expr/cl/" + k + "/ps2"); push(TK.clPs2[k], "track/cl/ps2/" + k); }
  for (const r of SG_ROUTES) { push(CU.sg[r.key], "cu/sg/" + r.key); push(EX.sg[r.key + "_xb3"], "expr/sg/" + r.key + "/xb3"); push(TK.sgXb3[r.key], "track/sg/xb3/" + r.key); }
  push(EX.sg.kurisu_en, "expr/sg/kurisu/en"); push(TK.sgSteam.kurisu, "track/sg/steam/kurisu");
  push(relClFp, "release/cl/fp"); push(relClPs2, "release/cl/ps2"); push(relSgXb3, "release/sg/xb3"); push(relSgSteam, "release/sg/steam");
  push(medClFp, "medium/cl/fp"); push(medClPs2, "medium/cl/ps2"); push(medSgXb3, "medium/sg/xb3"); push(medSgSteam, "medium/sg/steam");

  const fresh = new Map();
  for (const { e, tag } of ALL) {
    const got = await camp.getEntity(e.id);
    fresh.set(e.id, got);
    checked.entities++;
    check(got.kind === e.kind, tag + " 回读 kind 不一致：" + got.kind + " ≠ " + e.kind);
    check(got.status === "published", tag + " 状态不是 published：" + got.status);
    const missing = ["zh-CN", "zh-TW", "ja-JP", "en-US"].filter((loc) => !((got.translations || {})[loc] || {}).title);
    if (missing.length) {
      // 复用存量实体（如已有 person「林直孝」）的四语缺口是存量问题：记 warning，不改别人的条目
      if (PREEXISTING.has(got.id)) warn(tag + " 是复用存量实体，缺语种 " + missing.join(",") + "（未修改别人的条目）");
      else check(false, tag + " 缺 " + missing.join(",") + " 题名");
    }
  }
  // 跨领域同名工作复用的自检：记录实际 types，避免把别的领域的同名 Work 当成自己的
  check((fresh.get(clannad.id).types || []).includes("visual_novel"), "work/CLANNAD 的 types 不是 visual_novel：" + JSON.stringify(fresh.get(clannad.id).types));
  check((fresh.get(steinsgate.id).types || []).includes("visual_novel"), "work/STEINS;GATE 的 types 不是 visual_novel：" + JSON.stringify(fresh.get(steinsgate.id).types));

  // A 创作链：Work → ContentUnit → Expression
  for (const r of CL_ROUTES) {
    const cu = fresh.get(CU.cl[r.key].id), ex = fresh.get(EX.cl[r.key + "_pc"].id);
    check(cu.work_id === clannad.id, "cu/cl/" + r.key + " work_id 不属于《CLANNAD》");
    check(cu.attributes && cu.attributes.entry_role === "main", "cu/cl/" + r.key + " entry_role 不是 main");
    check(ex.work_id === clannad.id, "expr/cl/" + r.key + "/pc 的 work_id 不属于《CLANNAD》");
    check(ex.content_unit_id === CU.cl[r.key].id, "expr/cl/" + r.key + "/pc 未挂到对应篇目 content_unit_id");
    check(!ex.parent_id, "expr/cl/" + r.key + "/pc 不应有 parent_id");
    check(ex.attributes && ex.attributes.language === "ja", "expr/cl/" + r.key + "/pc language 不是 ja");
  }
  for (const k of ["nagisa", "tomoyo"]) {
    const ex = fresh.get(EX.cl[k + "_ps2"].id);
    check(ex.work_id === clannad.id && ex.content_unit_id === CU.cl[k].id, "expr/cl/" + k + "/ps2 归属错误");
  }
  for (const r of SG_ROUTES) {
    const cu = fresh.get(CU.sg[r.key].id), ex = fresh.get(EX.sg[r.key + "_xb3"].id);
    check(cu.work_id === steinsgate.id, "cu/sg/" + r.key + " work_id 不属于《STEINS;GATE》");
    check(ex.work_id === steinsgate.id, "expr/sg/" + r.key + "/xb3 work_id 不属于《STEINS;GATE》");
    check(ex.content_unit_id === CU.sg[r.key].id, "expr/sg/" + r.key + "/xb3 未挂到对应篇目");
    check(!ex.parent_id, "expr/sg/" + r.key + "/xb3 不应有 parent_id");
  }
  const enEx = fresh.get(EX.sg.kurisu_en.id);
  check(enEx.content_unit_id === CU.sg.kurisu.id && enEx.attributes.language === "en", "expr/sg/kurisu/en 归属或语言错误");

  // B 承载链：Release → Medium → Track → contents 引用 Expression；subjects 覆盖
  const chains = [
    { tag: "release/cl/fp", rel: relClFp, med: medClFp, exprOf: (k) => EX.cl[k + "_pc"], keys: CL_ROUTES.map((r) => r.key), tracks: TK.clFp },
    { tag: "release/cl/ps2", rel: relClPs2, med: medClPs2, exprOf: (k) => EX.cl[k + "_ps2"], keys: ["nagisa", "tomoyo"], tracks: TK.clPs2 },
    { tag: "release/sg/xb3", rel: relSgXb3, med: medSgXb3, exprOf: (k) => EX.sg[k + "_xb3"], keys: SG_ROUTES.map((r) => r.key), tracks: TK.sgXb3 },
  ];
  for (const c of chains) {
    const rel = fresh.get(c.rel.id), med = fresh.get(c.med.id);
    check(!rel.work_id, c.tag + " 不应有 work_id");
    check(med.release_id === c.rel.id, c.tag + " medium 未挂在发行上");
    const subjectIds = (rel.subjects || []).map((x) => x.work_id);
    check(subjectIds.length > 0, c.tag + " 缺 subjects");
    check((rel.subjects || []).some((x) => x.role === "primary"), c.tag + " subjects 缺 primary");
    for (const k of c.keys) {
      const t = fresh.get(c.tracks[k].id);
      check(t.medium_id === c.med.id, c.tag + " track/" + k + " medium 归属错误");
      const content = (t.contents || [])[0];
      check(!!content && content.expression_id === c.exprOf(k).id, c.tag + " track/" + k + " contents 未引用预期表达");
      const owner = fresh.get(c.exprOf(k).id).work_id;
      check(subjectIds.includes(owner), c.tag + " track/" + k + " 的 Expression 所属 Work 未在 subjects 声明");
    }
  }
  // 数字发行（Steam 版）：Track 引用英文译本，仍须 subjects 覆盖
  {
    const rel = fresh.get(relSgSteam.id), med = fresh.get(medSgSteam.id), t = fresh.get(TK.sgSteam.kurisu.id);
    const subjectIds = (rel.subjects || []).map((x) => x.work_id);
    check(!rel.work_id, "release/sg/steam 不应有 work_id");
    check(med.release_id === rel.id, "release/sg/steam medium 未挂在发行上");
    check((med.attributes || {}).format === "web", "release/sg/steam medium format 不是 web");
    check(t.medium_id === med.id, "release/sg/steam track medium 归属错误");
    check((t.contents || [])[0].expression_id === enEx.id, "release/sg/steam track contents 未引用英文译本表达");
    check(subjectIds.includes(enEx.work_id), "release/sg/steam 的译本 Expression 所属 Work 未在 subjects 声明");
  }
  // 同一 Expression 被多发行重复收录（跨发行复用）不适用于本次样例，改为核对 CD 与 PS2 表达互不相同
  check(EX.cl.nagisa_pc.id !== EX.cl.nagisa_ps2.id, "PC 版与 PS2 版表達不应是同一实体");

  // C 关系两端回读（每条边都必须在 source 端可见）
  const bySource = new Map();
  for (const r of REL) {
    if (!bySource.has(r.srcId)) bySource.set(r.srcId, []);
    bySource.get(r.srcId).push(r);
  }
  for (const [srcId, wanted] of bySource) {
    const got = await client.relationsOf(srcId);
    const items = Array.isArray(got) ? got : (got.body && got.body.items) || [];
    for (const w of wanted) {
      const hit = items.find((x) => x.type === w.type && x.source_id === w.srcId && x.target_id === w.tgtId);
      if (hit) checked.relations++;
      check(!!hit, "关系回读缺失：" + w.type + " " + w.srcId.slice(0, 8) + "→" + w.tgtId.slice(0, 8));
    }
  }

  // D revisions
  for (const id of [clannad.id, steinsgate.id, relClFp.id, relSgSteam.id, CU.cl.nagisa.id, EX.cl.nagisa_ps2.id, TK.clFp.nagisa.id, medSgSteam.id, A.key.id]) {
    const r = await client.call("/api/catalog/entities/" + id + "/revisions");
    const items = (r.body && (r.body.items || r.body.revisions)) || [];
    checked.revisions += items.length;
    check(r.status === 200 && items.length >= 1, "revisions 回读异常 " + id.slice(0, 8) + " -> " + r.status + " items=" + items.length);
  }
}

if (!DRY) {
  await verify();
  console.log("\n回读断言：实体 " + checked.entities + " 条、关系 " + checked.relations + " 条、revision " + checked.revisions + " 条");
  if (warnings.length) {
    console.log("存量提示 " + warnings.length + " 项（不计失败）：");
    for (const w of warnings.slice(0, 20)) console.log("  ! " + w);
  }
  if (problems.length) {
    console.log("断言失败 " + problems.length + " 项：");
    for (const p of problems.slice(0, 40)) console.log("  ✗ " + p);
  } else {
    console.log("断言全部通过（结构归属 / subjects 覆盖 / 关系两端 / revisions / 四语题名）");
  }
} else {
  console.log("\n[dry-run] 计划：" + [
    "work 6（CLANNAD / STEINS;GATE / STEINS;GATE 0 / 智代アフター / 光見守る坂道で(VN) / 光見守る坂道で(小説)）",
    "collection 1（科学アドベンチャーシリーズ）",
    "agent " + Object.keys(AGENTS).length,
    "content_unit " + (CL_ROUTES.length + SG_ROUTES.length),
    "expression " + (CL_ROUTES.length + 2 + SG_ROUTES.length + 1),
    "release 4 / medium 4 / track " + (CL_ROUTES.length + 2 + SG_ROUTES.length + 1),
    "关系 " + REL.length + " 条",
  ].join("；"));
}

camp.summary({ verification: { problems: DRY ? ["dry-run 未回读"] : problems, warnings, checked }, plannedRelations: REL.length });
if (problems.length) process.exitCode = 1;
