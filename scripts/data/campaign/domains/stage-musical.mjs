#!/usr/bin/env node
// 领域脚本：舞台剧 / 音乐剧（公演盘）— slug = stage-musical
//
// 层级形状（两条链都走通）：
//   Work(音乐剧) → ContentUnit(幕 / 曲目) → Expression(该公演的上演，挂 content_unit_id)
//   Work → Release(公演盘) → Medium(BD / CD) → Track → contents[] 引用 Expression
//
// 两个单元：
//   A. 英文音乐剧《The Phantom of the Opera》2011 年 Royal Albert Hall 25 周年纪念公演
//      —— CD（2 碟现场录音，曲序/轨号/时长取自 Apple Music 官方页）与 Blu-ray（公演映像盘）双发行，
//         两个发行复用同一批 Expression（验证"同一表达被多个发行收录"）。
//   B. 日文 2.5 次元舞台《少女☆歌劇 レヴュースタァライト -The LIVE- #1 revival》
//      —— 官方商品页 BRMM-10109 是 Blu-ray + CD 套装：BD 收第 1 部/第 2 部公演正片 + 特典映像，
//         CD 收 7 首舞台歌唱音源；品番、発売日、时长、同梱物、店舗特典全部来自官方商品页。
//
// 所有事实都来自下方 SRC 里列出的可核对页面；没有来源的字段一律留空并在报告里记缺口。
// 用法：
//   node scripts/data/campaign/domains/stage-musical.mjs --dry-run
//   $env:MF_USER_PASS = …; node scripts/data/campaign/domains/stage-musical.mjs

import fs from "node:fs";
import path from "node:path";
import { Campaign, Client, DRY, Index, LOG_DIR, src } from "../lib.mjs";

// ── 来源 ────────────────────────────────────────────────────────────────
const S_WIKI_RAH = src("https://en.wikipedia.org/wiki/The_Phantom_of_the_Opera_at_the_Royal_Albert_Hall",
  "英文维基百科《The Phantom of the Opera at the Royal Albert Hall》：三场公演 2011-10-01 19:30 / 2011-10-02 13:30・19:00 于 Royal Albert Hall；舞台监督 Laurence Connor、影像导演 Nick Morris、制作 Cameron Mackintosh、发行 Universal Pictures UK；主演表（Ramin Karimloo / Sierra Boggess / Hadley Fraser / Wendy Ferguson / Barry James / Gareth Snook / Liz Robertson / Daisy Maywood / Wynne Evans / Earl Carpenter）；Home media 节：UK Blu-ray・DVD・CD 首发 2011-11-14，数字版 2011-11-11，北美 2012-02-07，并说明后续发行的影像由三场素材剪辑而成");
const S_WIKI_POTO = src("https://en.wikipedia.org/wiki/The_Phantom_of_the_Opera_(1986_musical)",
  "英文维基百科《The Phantom of the Opera (1986 musical)》：作曲 Andrew Lloyd Webber、作词 Charles Hart（additional Richard Stilgoe）、剧本 Richard Stilgoe & Andrew Lloyd Webber、原著 Gaston Leroux 1910 年小说、1986-10-09 Her Majesty's Theatre 首演；Musical numbers 章节的分幕曲目表与逐曲词作者脚注（mn1=Charles Hart，mn2=Charles Hart with additional lyrics by Richard Stilgoe）");
const S_POTO_NUMBERS = src("https://www.thephantomoftheopera.com/musical-numbers/",
  "音乐剧官网 Musical Numbers 页（维基曲目表所引来源）：Act I / Act II 曲目名称与顺序");
const S_APPLE_RAH = src("https://music.apple.com/gb/album/the-phantom-of-the-opera-at-the-royal-albert-hall/1843483289",
  "Apple Music 官方商店页（iTunes Lookup collectionId=1843483289）：本公演现场录音 2 碟 22 轨的曲名、碟号、轨序、毫秒时长与版权行（℗ 2011 LW Entertainment Limited / The Other Songs Records Limited）");
const S_BUSHIROAD_BD = src("https://bushiroad-music.com/musics/BRMM-10109",
  "ブシロードミュージック 官方商品页「少女☆歌劇 レヴュースタァライト -The LIVE-#1 revival」：品番 BRMM-10109、発売日 2018-06-27、価格 7,800+税、商品タイプ Blu-ray + CD；Blu-ray Disc 收录 2018-01-08 AiiA 2.5 Theater Tokyo 千秋楽公演（1 部 ミュージカルパート 74 分／2 部 ライブパート 39 分／2 部曲目 1.舞台少女心得 2.願いは光になって 3.情熱の目覚めるとき 4.GANG☆STAR 5.Fancy You 6.Star Divine 7.スタァライトシアター＋カーテンコール Glittering Stars／特典映像 25 分）；CD 收錄「舞台歌唱音源」7 曲（1.３・７・５・１・０ 2.ポジションゼロへ！ 3.私たちの居る理由 4.ジャンヌダルク 5.RE: 6.Resist 7.Glittering Stars）；16P ブックレット・三方背 BOX（初回生産分）・舞台新作公演 初日先行申込券封入；店舗別オリジナル特典（アニメイト／ゲーマーズ／とらのあな／タワーレコード／HMV／ブシロードECショップ）");
const S_WIKI_STARI = src("https://ja.wikipedia.org/wiki/少女☆歌劇_レヴュースタァライト",
  "日文维基百科《少女☆歌劇 レヴュースタァライト》：ミュージカル 节（2017 年 9 月起上演；1 部ミュージカル・2 部観客参加型ライブの構成）、公演リスト（-The LIVE- #1 2017-09-22〜24、-The LIVE- #1 revival 2018-01-06〜08 同 AiiA 2.5 シアターTokyo、-The LIVE- #2 Transition 2018-10-13〜21 天王洲 銀河劇場）、スタッフ（-The LIVE- 演出 児玉明子・脚本 三浦香・主催「少女☆歌劇 レヴュースタァライト -The LIVE-」プロジェクト；舞台版レーベルはブシロードミュージック）、BD 一覧（-The LIVE- #1 revival BRMM-10109・2018-06-27）、登場人物（声・演 同一キャスト：愛城華恋=小山百代／神楽ひかり=三森すずこ／天堂真矢=富田麻帆／西條クロディーヌ=相羽あいな／花柳香子=伊藤彩沙 等）");

const ev = (note, sources) => ({ note, sources });

// ── 单元 A：The Phantom of the Opera @ Royal Albert Hall 2011 ────────────
// 曲目取官方曲目表与 Apple Music 轨表交集里的 7 首（碟号/轨号为 Apple Music 实际轨号，用于如实标注物理位置）
const POTO_UNITS = [
  { key: "think",  act: 1, disc: 1, track: 3,  title: "Think of Me",                       ms: 555520, lyrics: "hart+stilgoe" },
  { key: "poto",   act: 1, disc: 1, track: 6,  title: "The Phantom of the Opera",          ms: 316853, lyrics: "hart+batt" },
  { key: "music",  act: 1, disc: 1, track: 7,  title: "The Music of the Night",            ms: 398093, lyrics: "hart+stilgoe" },
  { key: "allask", act: 1, disc: 1, track: 13, title: "All I Ask of You",                  ms: 250240, lyrics: "hart+stilgoe" },
  { key: "masq",   act: 2, disc: 2, track: 2,  title: "Masquerade / Why So Silent?",       ms: 488133, lyrics: "hart+stilgoe" },
  { key: "wish",   act: 2, disc: 2, track: 4,  title: "Wishing You Were Somehow Here Again", ms: 275880, lyrics: "hart+stilgoe" },
  { key: "point",  act: 2, disc: 2, track: 6,  title: "The Point of No Return",            ms: 362307, lyrics: "hart+stilgoe" },
];

// 单元 B：少女☆歌劇 レヴュースタァライト -The LIVE- #1 revival（BRMM-10109, Blu-ray + CD）
const STARLIGHT_LIVE1_CD_TRACKS = [
  "３・７・５・１・０", "ポジションゼロへ！", "私たちの居る理由", "ジャンヌダルク", "RE:", "Resist", "Glittering Stars",
];

const AGENTS = {
  // 单元 A
  alw:       { type: "person", zh: "安德鲁·劳埃德·韦伯", tw: "安德魯·洛伊·韋伯", ja: "アンドルー・ロイド・ウェバー", en: "Andrew Lloyd Webber" },
  hart:      { type: "person", zh: "Charles Hart", tw: "Charles Hart", ja: "チャールズ・ハート", en: "Charles Hart" },
  mackintosh:{ type: "person", zh: "Cameron Mackintosh", tw: "Cameron Mackintosh", ja: "キャメロン・マッキントッシュ", en: "Cameron Mackintosh" },
  connor:    { type: "person", zh: "Laurence Connor", tw: "Laurence Connor", ja: "ローレンス・コナー", en: "Laurence Connor" },
  ramin:     { type: "person", zh: "Ramin Karimloo", tw: "Ramin Karimloo", ja: "ラミン・カリムルー", en: "Ramin Karimloo" },
  sierra:    { type: "person", zh: "Sierra Boggess", tw: "Sierra Boggess", ja: "シエラ・ボーゲス", en: "Sierra Boggess" },
  hadley:    { type: "person", zh: "Hadley Fraser", tw: "Hadley Fraser", ja: "ハドリー・フレイザー", en: "Hadley Fraser" },
  // 单元 B
  koyama:    { type: "person", zh: "小山百代", tw: "小山百代", ja: "小山百代", en: "Momoyo Koyama" },
  mimori:    { type: "person", zh: "三森すずこ", tw: "三森すずこ", ja: "三森すずこ", en: "Suzuko Mimori" },
  tomita:    { type: "person", zh: "富田麻帆", tw: "富田麻帆", ja: "富田麻帆", en: "Maho Tomita" },
  kodama:    { type: "person", zh: "児玉明子", tw: "児玉明子", ja: "児玉明子", en: "Akiko Kodama" },
  miura:     { type: "person", zh: "三浦香", tw: "三浦香", ja: "三浦香", en: "Kaoru Miura" },
  bushiroad: { type: "organization", zh: "武士道音乐", tw: "武士道音樂", ja: "ブシロードミュージック", en: "Bushiroad Music" },
};

const CHARACTERS = {
  phantom:  { zh: "魅影", tw: "魅影", ja: "ファントム", en: "The Phantom" },
  christine:{ zh: "克莉丝汀·戴耶", tw: "克莉絲汀·戴耶", ja: "クリスティーヌ・ダーエ", en: "Christine Daaé" },
  raoul:    { zh: "拉乌尔·德·夏尼", tw: "拉烏爾·德·夏尼", ja: "ラウル・ド・シャニー", en: "Raoul, Vicomte de Chagny" },
  karen:    { zh: "愛城華恋", tw: "愛城華恋", ja: "愛城華恋", en: "Karen Aijo" },
  hikari:   { zh: "神楽ひかり", tw: "神楽ひかり", ja: "神楽ひかり", en: "Hikari Kagura" },
  maya:     { zh: "天堂真矢", tw: "天堂真矢", ja: "天堂真矢", en: "Maya Tendo" },
};

export const tr4 = (zh, tw, ja, en) => ({ "zh-CN": { title: zh }, "zh-TW": { title: tw }, "ja-JP": { title: ja }, "en-US": { title: en } });
const inAll = (t) => tr4(t, t, t, t); // 无官方译名时各语种填原文题名（BRIEF 允许）
const secs = (ms) => Math.round(ms / 1000);

// ── 主流程 ──────────────────────────────────────────────────────────────
const client = new Client();
if (!DRY) await client.login();
else console.log("[dry-run] 离线空跑：不登录、不写库；仅列表查重仍会按需执行（此处全部关闭）");

const camp = new Campaign({ domain: "stage-musical", client, index: Index.load() });
const lookup = !DRY; // 服务端 ?q= 只用于几处关键查重（列表路由限流）

// dry-run 时 lib 用「DRY-<kind>-<题名前 20 字>」当占位 id，同 kind 且题名前缀相同的两条会撞 id
// （本领域有 -The LIVE- #1 / #2 两条），这里在 dry-run 下换成序号保证占位 id 唯一，真跑不受影响。
// 本领域自己建出来的实体集合：只对这些实体做"四语题名 / 状态 published"严格断言——
// 复用别人建的存量实体（如线上已存在的声优三森すずこ、他人建的 draft agent）不按本领域标准判失败。
const myOwnIds = new Set();
try {
  for (const line of fs.readFileSync(path.join(LOG_DIR, "stage-musical.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.op === "entity" && r.status === "created" && r.id) myOwnIds.add(r.id); } catch {}
  }
} catch { /* 首次运行还没有日志 */ }
const reusedIds = new Set();
let drySeq = 0;
async function ent(kind, title, spec, evObj, opts) {
  const before = camp.created.entity;
  const got = await camp.ensureEntity(kind, title, spec, evObj, opts);
  if (camp.created.entity === before && !String(got.id).startsWith("DRY-")) reusedIds.add(got.id);
  else if (camp.created.entity > before) myOwnIds.add(got.id);
  if (DRY && typeof got.id === "string" && got.id.startsWith("DRY-")) got.id = "DRY-" + kind + "-" + (++drySeq);
  return got;
}

// 结构作用域预载：lib 的本地索引只是快照、且不写回，重跑时若索引里没有结构实体会重复建档。
// 这里先按 work/release 全量拉一次、再按 work_id/release_id/medium_id 拉子实体灌进本地索引，
// 保证"命中即复用"在索引陈旧时依然成立（已被父代理的重复建档事故验证过必要性）。
async function preloadKinds(kinds) {
  if (DRY) return;
  for (const k of kinds) for (const it of await client.listKind(k)) camp.index.add(it);
}
async function preloadScoped(kind, scopeKey, id) {
  if (DRY || !id || String(id).startsWith("DRY-")) return;
  const r = await client.call("/api/catalog/entities?kind=" + kind + "&" + scopeKey + "=" + id + "&limit=50");
  for (const it of (r.body && r.body.items) || []) camp.index.add(it);
}
await preloadKinds(["work", "release"]);

// 1) Agent：复用线上已有的声优（先建/复用）
const A = {};
for (const [key, a] of Object.entries(AGENTS)) {
  A[key] = await ent("agent", a.ja, {
    original_language: a.type === "organization" ? "ja" : (["koyama", "tomita", "kodama", "miura", "mimori", "bushiroad"].includes(key) ? "ja" : "en"),
    types: [a.type],
    translations: tr4(a.zh, a.tw, a.ja, a.en),
  }, ev("编目：建立责任主体「" + a.ja + "」（" + a.type + "）。"
    + (["koyama", "tomita", "kodama", "miura", "mimori", "bushiroad"].includes(key)
      ? "依据日文维基百科《少女☆歌劇 レヴュースタァライト》的舞台版キャスト/スタッフ表与ブシロードミュージック 官方商品页署名。"
      : "依据英文维基百科本公演条目与 1986 年音乐剧条目的作曲/作词/制作/演出/主演署名。"),
    [S_WIKI_STARI, S_BUSHIROAD_BD, S_WIKI_RAH, S_WIKI_POTO]),
    { idemKey: "stage-musical-agent-" + key, allowServerLookup: lookup });
}
const CH = {};
for (const [key, c] of Object.entries(CHARACTERS)) {
  CH[key] = await ent("agent", c.ja, {
    original_language: ["karen", "hikari", "maya"].includes(key) ? "ja" : "en",
    types: ["character"],
    translations: tr4(c.zh, c.tw, c.ja, c.en),
  }, ev("编目：建立虚构角色主体「" + c.ja + "」（character）。"
    + (["karen", "hikari", "maya"].includes(key)
      ? "依据日文维基百科舞台版登场人物表（声・演 同一キャスト）。"
      : "依据英文维基百科本公演条目的 Cast 表与 1986 年音乐剧条目 Synopsis 的角色表。"),
    [S_WIKI_STARI, S_WIKI_RAH, S_WIKI_POTO]),
    { idemKey: "stage-musical-char-" + key, allowServerLookup: lookup });
}

// ── 单元 A ──────────────────────────────────────────────────────────────
const poto = await ent("work", "The Phantom of the Opera", {
  original_language: "en",
  types: ["music"],
  translations: tr4("歌剧魅影", "歌劇魅影", "オペラ座の怪人", "The Phantom of the Opera"),
  attributes: { language: "en", tags: ["ミュージカル", "ウェスト・エンド", "音楽劇"] },
}, ev("编目：新建音乐剧工作《The Phantom of the Opera》（types=music，原语言 en）。依据英文维基百科 1986 年音乐剧条目：作曲 Andrew Lloyd Webber、作词 Charles Hart（additional Richard Stilgoe）、剧本 Richard Stilgoe & Andrew Lloyd Webber、原著 Gaston Leroux 1910 年小说、1986-10-09 于 Her Majesty's Theatre 首演。注：实例的 work 类型词表没有舞台剧/音乐剧类型，本领域用 music 承载（见报告缺口清单）。",
  [S_WIKI_POTO, S_WIKI_RAH, S_POTO_NUMBERS]),
  { idemKey: "stage-musical-poto-work", allowServerLookup: lookup });

await preloadScoped("content_unit", "work_id", poto.id);

const potoActCU = {};
for (const [act, label, num] of [[1, "Act I", "I"], [2, "Act II", "II"]]) {
  potoActCU[act] = await ent("content_unit", label, {
    work_id: poto.id, position: act, number: num,
    original_language: "en", types: ["content_unit"],
    translations: tr4(act === 1 ? "第一幕" : "第二幕", act === 1 ? "第一幕" : "第二幕", act === 1 ? "第1幕" : "第2幕", label),
    attributes: { language: "en", entry_role: "main" },
  }, ev("编目：为《The Phantom of the Opera》建立幕级篇目「" + label + "」（number 用罗马数字保留官方分幕写法）。分幕结构取自音乐剧官网 Musical Numbers 页（Act I / Act II）与其所引的维基曲目表。",
    [S_POTO_NUMBERS, S_WIKI_POTO]),
    { idemKey: "stage-musical-poto-act" + act, allowServerLookup: false });
}

await preloadScoped("expression", "work_id", poto.id);
const potoCU = {}, potoEX = {};
for (const u of POTO_UNITS) {
  // 幕内序号（篇目在所属幕里的排序）；碟内轨号只用于 Track，两者不混用
  const actIndex = POTO_UNITS.filter((x) => x.act === u.act).findIndex((x) => x.key === u.key) + 1;
  let cu = await ent("content_unit", u.title, {
    work_id: poto.id, parent_id: potoActCU[u.act].id,
    position: actIndex, number: String(actIndex),
    original_language: "en", types: ["content_unit"],
    translations: inAll(u.title),
    attributes: { language: "en", entry_role: "main" },
  }, ev("编目：《The Phantom of the Opera》" + (u.act === 1 ? "第一幕" : "第二幕") + "曲目「" + u.title + "」（parent 指向该幕，position/number=幕内第 " + actIndex + " 曲）。曲名与幕归属取自音乐剧官网 Musical Numbers 页；该曲在 Apple Music 公演录音里的碟内轨号为第 " + u.track + " 轨（记在 Track 上）。",
    [S_POTO_NUMBERS, S_APPLE_RAH]),
    { idemKey: "stage-musical-poto-cu-" + u.key, allowServerLookup: false });
  if (!DRY) {
    // 判定用服务端现值（本地索引可能是旧快照），避免每次重跑都白写一次 PUT
    const live = await camp.getEntity(cu.id);
    if (live.number !== String(actIndex) || live.position !== actIndex || live.parent_id !== potoActCU[u.act].id) {
    cu = await camp.updateEntity(cu.id, { number: String(actIndex), position: actIndex,
      parent_id: potoActCU[u.act].id, work_id: poto.id },
      ev("编目：修正篇目「" + u.title + "」的 position/number 为幕内序号（首轮曾把题名写进 number 字段，写后断言捕获）。",
        [S_POTO_NUMBERS]));
    }
  }
  potoCU[u.key] = cu;

  potoEX[u.key] = await ent("expression", u.title, {
    work_id: poto.id, content_unit_id: potoCU[u.key].id, position: 1,
    original_language: "en", types: ["expression"],
    translations: inAll(u.title),
    attributes: { language: "en", duration: secs(u.ms), version_label: "2011年 Royal Albert Hall 25周年記念公演" },
  }, ev("编目：建立《" + u.title + "》在 2011 年 Royal Albert Hall 25 周年纪念公演上的表达（version_label=2011年 Royal Albert Hall 25周年記念公演，duration=" + secs(u.ms) + " 秒，挂 content_unit_id）。时长取自 Apple Music 该公演录音第 " + u.disc + " 碟第 " + u.track + " 轨（" + u.ms + " ms）；公演事实取自英文维基百科本公演条目（2011-10-01/02 三场）。",
    [S_APPLE_RAH, S_WIKI_RAH]),
    { idemKey: "stage-musical-poto-ex-" + u.key, allowServerLookup: false });
}

const potoCD = await ent("release", "The Phantom of the Opera at the Royal Albert Hall（CD）", {
  original_language: "en", types: ["release"],
  translations: inAll("The Phantom of the Opera at the Royal Albert Hall（CD）"),
  subjects: [{ work_id: poto.id, role: "primary" }],
  attributes: {
    edition_date: "2011-11-14", country: "GB", edition_type: "standard", edition_batch: "regular",
    distribution_channel: "physical", packaging: "jewel",
  },
}, ev("编目：新建发行《The Phantom of the Opera at the Royal Albert Hall》CD 版（2 碟现场录音盘）。UK 首发日 2011-11-14 取自英文维基百科本公演条目 Home media 节（数字版 2011-11-11、北美 2012-02-07）；碟数、曲序与时长取自 Apple Music 官方商品页。品番/条码/发行商在可核对来源里未公布，留空（见报告缺口清单）。subjects 声明音乐剧工作为 primary。",
  [S_WIKI_RAH, S_APPLE_RAH]),
  { idemKey: "stage-musical-poto-rel-cd", allowServerLookup: false });

const potoBD = await ent("release", "The Phantom of the Opera at the Royal Albert Hall（Blu-ray）", {
  original_language: "en", types: ["release"],
  translations: inAll("The Phantom of the Opera at the Royal Albert Hall（Blu-ray）"),
  subjects: [{ work_id: poto.id, role: "primary" }],
  attributes: {
    edition_date: "2011-11-14", country: "GB", edition_type: "standard", edition_batch: "regular",
    distribution_channel: "physical", packaging: "standard",
  },
}, ev("编目：新建发行《The Phantom of the Opera at the Royal Albert Hall》Blu-ray 公演映像盘。UK 首发日 2011-11-14（与 DVD/CD 同日）取自英文维基百科本公演条目 Home media 节；该页同时说明后续发行的影像由三场公演素材剪辑而成，故与 CD 复用同一批曲目表达。官方来源未公布章节表，故本盘不建逐章 Track（见报告缺口清单）。",
  [S_WIKI_RAH]),
  { idemKey: "stage-musical-poto-rel-bd", allowServerLookup: false });

await preloadScoped("medium", "release_id", potoCD.id);
const potoMed = {};
for (const d of [1, 2]) {
  potoMed[d] = await ent("medium", "Disc " + d, {
    release_id: potoCD.id, position: d, original_language: "",
    types: ["medium"],
    translations: tr4("第 " + d + " 碟", "第 " + d + " 碟", "ディスク " + d, "Disc " + d),
    attributes: { format: "cd", role: "primary" },
  }, ev("编目：按发行实物建立 CD 载体（Disc " + d + "，format=cd）。双碟结构取自 Apple Music 官方商品页（第 1 碟 14 轨、第 2 碟 8 轨）。",
    [S_APPLE_RAH]),
    { idemKey: "stage-musical-poto-med-" + d, scope: { release_id: potoCD.id }, allowServerLookup: false });
}
await preloadScoped("medium", "release_id", potoBD.id);
const potoMedBD = await ent("medium", "Blu-ray", {
  release_id: potoBD.id, position: 1, original_language: "",
  types: ["medium"],
  translations: tr4("蓝光碟", "藍光碟", "ブルーレイ", "Blu-ray"),
  attributes: { format: "bd", role: "primary" },
}, ev("编目：按发行实物建立 Blu-ray 载体（format=bd）。载体形式取自英文维基百科本公演条目 Home media 节（Blu-ray/DVD/CD）。",
  [S_WIKI_RAH]),
  { idemKey: "stage-musical-poto-med-bd", scope: { release_id: potoBD.id }, allowServerLookup: false });

await preloadScoped("track", "medium_id", potoMed[1].id);
await preloadScoped("track", "medium_id", potoMed[2].id);
await preloadScoped("track", "medium_id", potoMedBD.id);
const potoTrack = {};
for (const u of POTO_UNITS) {
  potoTrack[u.key] = await ent("track", u.title, {
    medium_id: potoMed[u.disc].id, position: u.track, number: String(u.track),
    contents: [{ expression_id: potoEX[u.key].id, position: 1, locator: null }],
    original_language: "", types: ["track"],
    translations: inAll(u.title),
    attributes: { role: "primary", duration: secs(u.ms) },
  }, ev("编目：按 Apple Music 官方轨表建立 CD 轨（第 " + u.disc + " 碟第 " + u.track + " 轨，position/number 用实际轨号），contents 引用该曲在本次公演的表达。曲名与时长同样取自 Apple Music 官方商品页。",
    [S_APPLE_RAH]),
    { idemKey: "stage-musical-poto-tr-" + u.key, scope: { medium_id: potoMed[u.disc].id }, allowServerLookup: false });
}
const potoMainTrack = await ent("track", "Main Feature", {
  medium_id: potoMedBD.id, position: 1, number: "1",
  contents: POTO_UNITS.map((u, i) => ({ expression_id: potoEX[u.key].id, position: i + 1, locator: null })),
  original_language: "", types: ["track"],
  translations: tr4("正片（全編映像）", "正片（全編映像）", "本編（全編映像）", "Main Feature"),
  attributes: { role: "primary" },
}, ev("编目：Blu-ray 公演映像盘只建一条「正片」Track，contents 依次引用本次公演 7 首曲目的表达。理由：官方来源（维基百科条目、发行方页）未公布该盘的章节表，此处不臆造章节编号与时间码，故以单条正片轨承载引用（报告缺口清单已记录该粒度限制）。",
  [S_WIKI_RAH, S_APPLE_RAH]),
  { idemKey: "stage-musical-poto-tr-main", scope: { medium_id: potoMedBD.id }, allowServerLookup: false });

// ── 单元 B ──────────────────────────────────────────────────────────────
const live1 = await ent("work", "少女☆歌劇 レヴュースタァライト -The LIVE- #1", {
  original_language: "ja",
  types: ["music"],
  translations: tr4("少女☆歌劇 レヴュースタァライト -The LIVE- #1", "少女☆歌劇 レヴュースタァライト -The LIVE- #1", "少女☆歌劇 レヴュースタァライト -The LIVE- #1", "Revue Starlight -The LIVE- #1"),
  attributes: { language: "ja", tags: ["2.5次元舞台", "ミュージカル"] },
}, ev("编目：新建舞台工作《少女☆歌劇 レヴュースタァライト -The LIVE- #1》（types=music，原语言 ja）。依据日文维基百科公演リスト：2017-09-22〜24 于 AiiA 2.5 シアターTokyo 上演，主演=聖翔音楽学園；同条目ミュージカル 节说明「1 部はミュージカル、2 部は観客参加型のライブ」的构成。注：实例 work 类型词表无舞台剧类型，用 music 承载（报告缺口清单）。",
  [S_WIKI_STARI, S_BUSHIROAD_BD]),
  { idemKey: "stage-musical-live1-work", allowServerLookup: lookup });

const live2 = await ent("work", "少女☆歌劇 レヴュースタァライト -The LIVE- #2 Transition", {
  original_language: "ja",
  types: ["music"],
  translations: tr4("少女☆歌劇 レヴュースタァライト -The LIVE- #2 Transition", "少女☆歌劇 レヴュースタァライト -The LIVE- #2 Transition", "少女☆歌劇 レヴュースタァライト -The LIVE- #2 Transition", "Revue Starlight -The LIVE- #2 Transition"),
  attributes: { language: "ja", tags: ["2.5次元舞台", "ミュージカル"] },
}, ev("编目：新建舞台工作《少女☆歌劇 レヴュースタァライト -The LIVE- #2 Transition》。依据日文维基百科公演リスト：2018-10-13〜21 于天王洲 銀河劇場上演（该条目并引官方站 2018-11-06 公告）。仅建工作用于表达与 #1 的系列关系，本战役未补其公演盘（报告未建模项）。",
  [S_WIKI_STARI]),
  { idemKey: "stage-musical-live2-work", allowServerLookup: lookup });

await preloadScoped("content_unit", "work_id", live1.id);

const live1CU = {};
live1CU.p1 = await ent("content_unit", "第1部 ミュージカルパート", {
  work_id: live1.id, position: 1, number: "1",
  original_language: "ja", types: ["content_unit"],
  translations: inAll("第1部 ミュージカルパート"),
  attributes: { language: "ja", entry_role: "main" },
}, ev("编目：为《-The LIVE- #1》建立篇目「第1部 ミュージカルパート」。构成与时长（74 分）取自ブシロードミュージック 官方商品页 BRMM-10109 的 Blu-ray Disc 收录说明；「1 部ミュージカル／2 部ライブ」的构成亦见日文维基百科ミュージカル 节。",
  [S_BUSHIROAD_BD, S_WIKI_STARI]),
  { idemKey: "stage-musical-live1-cu-p1", allowServerLookup: false });

live1CU.p2 = await ent("content_unit", "第2部 ライブパート", {
  work_id: live1.id, position: 2, number: "2",
  original_language: "ja", types: ["content_unit"],
  translations: inAll("第2部 ライブパート"),
  attributes: { language: "ja", entry_role: "main" },
}, ev("编目：为《-The LIVE- #1》建立篇目「第2部 ライブパート」。官方商品页 BRMM-10109 记载第 2 部 39 分，并给出该部 7 首曲目顺序与カーテンコール Glittering Stars；曲目本战役未逐首拆成篇目（报告未建模项）。",
  [S_BUSHIROAD_BD]),
  { idemKey: "stage-musical-live1-cu-p2", allowServerLookup: false });

await preloadScoped("expression", "work_id", live1.id);

const live1EX = {};
live1EX.p1 = await ent("expression", "第1部 ミュージカルパート", {
  work_id: live1.id, content_unit_id: live1CU.p1.id, position: 1,
  original_language: "ja", types: ["expression"],
  translations: inAll("第1部 ミュージカルパート"),
  attributes: { language: "ja", duration: 74 * 60, version_label: "2018-01-08 AiiA 2.5 Theater Tokyo 千秋楽公演" },
}, ev("编目：建立该公演第一部的表达（version_label=2018-01-08 千秋楽公演，duration=74 分＝4440 秒，挂 content_unit_id）。收录日期与时长取自官方商品页 BRMM-10109（Blu-ray Disc：2018 年 1 月 8 日 AiiA 2.5 Theater Tokyo 千秋楽公演／1 部 ミュージカルパート 74 分）。",
  [S_BUSHIROAD_BD]),
  { idemKey: "stage-musical-live1-ex-p1", allowServerLookup: false });

live1EX.p2 = await ent("expression", "第2部 ライブパート", {
  work_id: live1.id, content_unit_id: live1CU.p2.id, position: 2,
  original_language: "ja", types: ["expression"],
  translations: inAll("第2部 ライブパート"),
  attributes: { language: "ja", duration: 39 * 60, version_label: "2018-01-08 AiiA 2.5 Theater Tokyo 千秋楽公演" },
}, ev("编目：建立该公演第二部的表达（version_label=2018-01-08 千秋楽公演，duration=39 分＝2340 秒，挂 content_unit_id）。收录日期与时长取自官方商品页 BRMM-10109。",
  [S_BUSHIROAD_BD]),
  { idemKey: "stage-musical-live1-ex-p2", allowServerLookup: false });

const live1Rel = await ent("release", "少女☆歌劇 レヴュースタァライト -The LIVE- #1 revival", {
  original_language: "ja", types: ["release"],
  translations: inAll("少女☆歌劇 レヴュースタァライト -The LIVE- #1 revival"),
  subjects: [{ work_id: live1.id, role: "primary" }],
  attributes: {
    catalog_number: "BRMM-10109", edition_date: "2018-06-27", country: "JP",
    edition_type: "standard", edition_batch: "first_press", packaging: "box",
    distribution_channel: "physical",
    attachments: [
      { label: { "ja-JP": "16 ページブックレット" } },
      { label: { "ja-JP": "三方背 BOX 仕様（初回生産分のみ）" } },
      { label: { "ja-JP": "舞台新作公演 初日先行申込券（封入特典）" } },
    ],
    store_bonuses: [
      { channel: "アニメイト", label: { "ja-JP": "キャスト撮りおろしツーショット L 版ブロマイド【真矢＆クロディーヌ】" } },
      { channel: "ゲーマーズ", label: { "ja-JP": "キャスト撮りおろしツーショット L 版ブロマイド【双葉＆香子】／A4 クリアファイル【華恋＆ひかり】" } },
      { channel: "とらのあな", label: { "ja-JP": "キャスト撮りおろしツーショット L 版ブロマイド【華恋＆まひる】" } },
      { channel: "タワーレコード", label: { "ja-JP": "キャスト撮りおろしツーショット L 版ブロマイド【華恋＆ひかり】B" } },
      { channel: "HMV", label: { "ja-JP": "キャスト撮りおろしツーショット L 版ブロマイド【純那＆なな】" } },
      { channel: "ブシロードECショップ", label: { "ja-JP": "キャスト撮りおろしツーショット L 版ブロマイド【華恋＆ひかり】A" } },
    ],
  },
}, ev("编目：新建发行《少女☆歌劇 レヴュースタァライト -The LIVE- #1 revival》（BD+CD 套装公演盘）。品番 BRMM-10109、発売日 2018-06-27、価格 7,800+税、商品タイプ Blu-ray + CD、同梱物与店舗別特典全部取自ブシロードミュージック 官方商品页；発売元ブシロードミュージック 的舞台版所属レーベル记载见日文维基百科 CD（ミュージカル）节；线上已存在同名 agent「ブシロードミュージック」但 status=draft，引用草稿会被服务端拒（400 publisher: invalid_reference），故 publisher 字段留空，见报告缺口清单。subjects 声明舞台工作为 primary，覆盖 BD 轨 contents 引用的全部表达所属 Work。",
  [S_BUSHIROAD_BD, S_WIKI_STARI]),
  { idemKey: "stage-musical-live1-release", allowServerLookup: false });

await preloadScoped("medium", "release_id", live1Rel.id);
const live1MedBD = await ent("medium", "Blu-ray", {
  release_id: live1Rel.id, position: 1, original_language: "",
  types: ["medium"],
  translations: tr4("蓝光碟", "藍光碟", "ブルーレイ", "Blu-ray"),
  attributes: { format: "bd", role: "primary" },
}, ev("编目：按官方商品页的商品タイプ「Blu-ray + CD」建立 Blu-ray 载体（position=1，format=bd，role=primary）。",
  [S_BUSHIROAD_BD]),
  { idemKey: "stage-musical-live1-med-bd", scope: { release_id: live1Rel.id }, allowServerLookup: false });

const live1MedCD = await ent("medium", "CD", {
  release_id: live1Rel.id, position: 2, original_language: "",
  types: ["medium"],
  translations: tr4("CD", "CD", "CD", "CD"),
  attributes: { format: "cd", role: "supplement" },
}, ev("编目：按官方商品页建立随套装的 CD 载体（position=2，format=cd，role=supplement——官方说明为舞台歌唱音源 7 曲的特别 CD）。",
  [S_BUSHIROAD_BD]),
  { idemKey: "stage-musical-live1-med-cd", scope: { release_id: live1Rel.id }, allowServerLookup: false });

await preloadScoped("track", "medium_id", live1MedBD.id);
await preloadScoped("track", "medium_id", live1MedCD.id);
const live1Track = {};
live1Track.p1 = await ent("track", "第1部 ミュージカルパート", {
  medium_id: live1MedBD.id, position: 1, number: "1",
  contents: [{ expression_id: live1EX.p1.id, position: 1, locator: null }],
  original_language: "", types: ["track"],
  translations: inAll("第1部 ミュージカルパート"),
  attributes: { role: "primary", duration: 74 * 60 },
}, ev("编目：按官方商品页的 Blu-ray 收录说明建立 BD 轨「第1部 ミュージカルパート」（74 分），contents 引用该部在千秋楽公演的表达。",
  [S_BUSHIROAD_BD]),
  { idemKey: "stage-musical-live1-tr-p1", scope: { medium_id: live1MedBD.id }, allowServerLookup: false });

live1Track.p2 = await ent("track", "第2部 ライブパート", {
  medium_id: live1MedBD.id, position: 2, number: "2",
  contents: [{ expression_id: live1EX.p2.id, position: 1, locator: null }],
  original_language: "", types: ["track"],
  translations: inAll("第2部 ライブパート"),
  attributes: { role: "primary", duration: 39 * 60 },
}, ev("编目：按官方商品页建立 BD 轨「第2部 ライブパート」（39 分），contents 引用该部在千秋楽公演的表达。该部曲目（舞台少女心得／願いは光になって／情熱の目覚めるとき／GANG☆STAR／Fancy You／Star Divine／スタァライトシアター＋カーテンコール Glittering Stars）见报告未建模项。",
  [S_BUSHIROAD_BD]),
  { idemKey: "stage-musical-live1-tr-p2", scope: { medium_id: live1MedBD.id }, allowServerLookup: false });

live1Track.extra = await ent("track", "特典映像", {
  medium_id: live1MedBD.id, position: 3, number: "3",
  contents: [],
  original_language: "", types: ["track"],
  translations: tr4("特典影像", "特典影像", "特典映像", "Bonus Footage"),
  attributes: { role: "extra", duration: 25 * 60 },
}, ev("编目：按官方商品页建立 BD 特典映像轨（AFTER TALK 20180108 matinee／CAST COMMENT 20180108 soiree，合计 25 分，role=extra）。特典影像不是音乐剧篇目的表达，故 contents 留空。",
  [S_BUSHIROAD_BD]),
  { idemKey: "stage-musical-live1-tr-extra", scope: { medium_id: live1MedBD.id }, allowServerLookup: false });

const live1CDTracks = [];
for (let i = 0; i < STARLIGHT_LIVE1_CD_TRACKS.length; i++) {
  const t = STARLIGHT_LIVE1_CD_TRACKS[i];
  live1CDTracks.push(await ent("track", t, {
    medium_id: live1MedCD.id, position: i + 1, number: String(i + 1),
    contents: [],
    original_language: "", types: ["track"],
    translations: inAll(t),
    attributes: { role: i === STARLIGHT_LIVE1_CD_TRACKS.length - 1 ? "extra" : "supplement" },
  }, ev("编目：按官方商品页的 CD 收录 7 曲（舞台歌唱音源）建立 CD 轨「" + t + "」（第 " + (i + 1) + " 曲）。官方未公布这 7 曲的单曲时长，duration 留空；它们是舞台歌唱音源而非本公演现场收录，故 contents 不引用第 1/2 部的公演表达（报告缺口清单）。",
    [S_BUSHIROAD_BD]),
    { idemKey: "stage-musical-live1-cdtr-" + (i + 1), scope: { medium_id: live1MedCD.id }, allowServerLookup: false }));
}

// ── 关系 ────────────────────────────────────────────────────────────────
const REL_EV = {
  composedWork: ev("编目：《The Phantom of the Opera》署名为作曲 Andrew Lloyd Webber（英文维基百科音乐剧条目 infobox 与音乐剧官网 Musical Numbers 页）。",
    [S_WIKI_POTO, S_POTO_NUMBERS]),
  composedCU: (t) => ev("编目：署名曲目《" + t + "》作曲为 Andrew Lloyd Webber（音乐剧官网 Musical Numbers 页列出的该曲，音乐由 Andrew Lloyd Webber 创作；维基音乐剧条目 Score/music 栏一致）。",
    [S_POTO_NUMBERS, S_WIKI_POTO]),
  lyricWork: ev("编目：《The Phantom of the Opera》署名词作者 Charles Hart（英文维基百科音乐剧条目 infobox：lyrics Charles Hart（additional Richard Stilgoe））。",
    [S_WIKI_POTO]),
  lyricCU: (t, note) => ev("编目：署名曲目《" + t + "》词作者为 Charles Hart（" + note + "，依据维基音乐剧条目 Musical numbers 章节逐曲脚注）。",
    [S_WIKI_POTO, S_POTO_NUMBERS]),
  performed: (who, role) => ev("编目：署名 " + who + " 在 2011 年 Royal Albert Hall 25 周年纪念公演中出演 " + role + "（英文维基百科本公演条目 Cast 表）。",
    [S_WIKI_RAH]),
  characterIn: (c, w, rank) => ev("编目：虚构角色「" + c + "」出现于《" + w + "》（character_in，character_rank=" + rank + "）。角色表取自英文维基百科本公演条目 Cast 与 1986 年音乐剧条目 Synopsis。",
    [S_WIKI_RAH, S_WIKI_POTO]),
  directed: ev("编目：署名《The Phantom of the Opera at the Royal Albert Hall》舞台监督（stage direction）为 Laurence Connor（英文维基百科本公演条目 infobox：director Nick Morris；stage direction Laurence Connor）。",
    [S_WIKI_RAH]),
  creditProd: ev("编目：署名本公演制作人为 Cameron Mackintosh（英文维基百科本公演条目 infobox producer 与 Idea 节）。",
    [S_WIKI_RAH]),
  sequel: ev("编目：《-The LIVE- #2 Transition》是《-The LIVE- #1》的后继公演（sequel_of）。公演日程与顺序取自日文维基百科公演リスト（#1 2017-09-22〜24、#2 2018-10-13〜21）。",
    [S_WIKI_STARI]),
  performedJP: (who, role) => ev("编目：署名 " + who + " 在舞台《少女☆歌劇 レヴュースタァライト -The LIVE- #1》中出演 " + role + "（日文维基百科登场人物表标注「声・演」同一演员）。",
    [S_WIKI_STARI]),
  charJP: (c) => ev("编目：虚构角色「" + c + "」出现于舞台《少女☆歌劇 レヴュースタァライト -The LIVE- #1》（character_in，character_rank=main）。依据日文维基百科登场人物表（声・演 同一キャスト）。",
    [S_WIKI_STARI]),
  directedJP: ev("编目：署名《少女☆歌劇 レヴュースタァライト -The LIVE-》演出为児玉明子（日文维基百科 スタッフ（ミュージカル）节，-The LIVE- 条目下）。",
    [S_WIKI_STARI]),
  writtenJP: ev("编目：署名《少女☆歌劇 レヴュースタァライト -The LIVE-》脚本为三浦香（日文维基百科 スタッフ（ミュージカル）节）。",
    [S_WIKI_STARI]),
};

const expected = [];
const rel = async (type, srcId, tgtId, note, attributes = {}, key) => {
  await camp.createRelation(type, srcId, tgtId, note, { attributes, skipIfExists: !DRY, idemKey: key ? "stage-musical-rel-" + key : undefined });
  expected.push({ type, srcId, tgtId });
};

// 单元 A：credits（composed_by / lyricist_of）+ 演出/出演 + 角色
await rel("composed_by", poto.id, A.alw.id, REL_EV.composedWork, { credit_role: "作曲" }, "poto-work-alw");
for (const k of ["music", "poto", "think"]) {
  await rel("composed_by", potoCU[k].id, A.alw.id, REL_EV.composedCU(potoCU[k].title), { credit_role: "作曲" }, "poto-cu-" + k + "-alw");
}
await rel("lyricist_of", poto.id, A.hart.id, REL_EV.lyricWork, { credit_role: "作詞" }, "poto-work-hart");
for (const u of POTO_UNITS) {
  const note = u.lyrics === "hart+batt"
    ? "该曲脚注 mn3：Additional lyrics by Mike Batt"
    : "该曲脚注 mn2：Charles Hart with additional lyrics by Richard Stilgoe";
  await rel("lyricist_of", potoCU[u.key].id, A.hart.id, REL_EV.lyricCU(u.title, note), { credit_role: "作詞" }, "poto-cu-" + u.key + "-hart");
}
await rel("performed_by", poto.id, A.ramin.id, REL_EV.performed("Ramin Karimloo", "The Phantom"), { credit_role: "出演", character: CH.phantom.id }, "poto-ramin");
await rel("performed_by", poto.id, A.sierra.id, REL_EV.performed("Sierra Boggess", "Christine Daaé"), { credit_role: "出演", character: CH.christine.id }, "poto-sierra");
await rel("performed_by", poto.id, A.hadley.id, REL_EV.performed("Hadley Fraser", "Raoul"), { credit_role: "出演", character: CH.raoul.id }, "poto-hadley");
await rel("character_in", CH.phantom.id, poto.id, REL_EV.characterIn("The Phantom", "The Phantom of the Opera", "main"), { character_rank: "main" }, "poto-char-phantom");
await rel("character_in", CH.christine.id, poto.id, REL_EV.characterIn("Christine Daaé", "The Phantom of the Opera", "main"), { character_rank: "main" }, "poto-char-christine");
await rel("character_in", CH.raoul.id, poto.id, REL_EV.characterIn("Raoul", "The Phantom of the Opera", "main"), { character_rank: "main" }, "poto-char-raoul");
await rel("directed_by", poto.id, A.connor.id, REL_EV.directed, { credit_role: "舞台監督" }, "poto-connor");
await rel("credit_for", potoBD.id, A.mackintosh.id, REL_EV.creditProd, { credit_role: "制作" }, "poto-bd-mackintosh");

// 单元 B：系列关系 + 出演 + 角色 + 演出/脚本
await rel("sequel_of", live2.id, live1.id, REL_EV.sequel, {}, "live2-sequel-live1");
await rel("performed_by", live1.id, A.koyama.id, REL_EV.performedJP("小山百代", "愛城華恋"), { credit_role: "出演", character: CH.karen.id }, "live1-koyama");
await rel("performed_by", live1.id, A.tomita.id, REL_EV.performedJP("富田麻帆", "天堂真矢"), { credit_role: "出演", character: CH.maya.id }, "live1-tomita");
await rel("performed_by", live1.id, A.mimori.id, REL_EV.performedJP("三森すずこ", "神楽ひかり"), { credit_role: "出演", character: CH.hikari.id }, "live1-hikari");
await rel("character_in", CH.karen.id, live1.id, REL_EV.charJP("愛城華恋"), { character_rank: "main" }, "live1-char-karen");
await rel("character_in", CH.hikari.id, live1.id, REL_EV.charJP("神楽ひかり"), { character_rank: "main" }, "live1-char-hikari");
await rel("character_in", CH.maya.id, live1.id, REL_EV.charJP("天堂真矢"), { character_rank: "main" }, "live1-char-maya");
await rel("directed_by", live1.id, A.kodama.id, REL_EV.directedJP, { credit_role: "演出" }, "live1-kodama");
await rel("written_by", live1.id, A.miura.id, REL_EV.writtenJP, { credit_role: "脚本" }, "live1-miura");
// 发售元走关系而不是 release.attributes.publisher：线上同名 agent 目前是 draft，
// 属性引用被 400 publisher: invalid_reference 拒，但关系端点接受 draft（本次实测 200）。
await rel("credit_for", live1Rel.id, A.bushiroad.id,
  ev("编目：署名本发行（BRMM-10109）的发售元为ブシロードミュージック。依据官方商品页与日文维基百科 CD（ミュージカル）节的「舞台版の所属レーベルはブシロードミュージック」记载。",
    [S_BUSHIROAD_BD, S_WIKI_STARI]), { credit_role: "発売" }, "live1-bushiroad");

// ── 写后回读断言 ────────────────────────────────────────────────────────
const problems = [];
const checked = { entities: 0, relations: 0, revisions: 0 };
// 回读阶段的偶发网络中断（fetch failed / socket closed）不算数据问题：重试几次再判失败
async function withRetry(fn, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw err;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok, msg) => { if (!ok) problems.push(msg); };

async function verify() {
  const ALL = [];
  const push = (e, tag) => { if (e && e.id) ALL.push({ e, tag }); };
  push(poto, "work/poto"); push(potoCD, "release/poto-cd"); push(potoBD, "release/poto-bd");
  push(potoMed[1], "medium/poto-cd1"); push(potoMed[2], "medium/poto-cd2"); push(potoMedBD, "medium/poto-bd");
  push(potoMainTrack, "track/poto-main");
  push(live1, "work/live1"); push(live2, "work/live2"); push(live1Rel, "release/live1");
  push(live1MedBD, "medium/live1-bd"); push(live1MedCD, "medium/live1-cd");
  for (const [k, v] of Object.entries(potoActCU)) push(v, "cu/poto-act" + k);
  for (const [k, v] of Object.entries(potoCU)) push(v, "cu/poto-" + k);
  for (const [k, v] of Object.entries(potoEX)) push(v, "expr/poto-" + k);
  for (const [k, v] of Object.entries(potoTrack)) push(v, "track/poto-" + k);
  for (const [k, v] of Object.entries(live1CU)) push(v, "cu/live1-" + k);
  for (const [k, v] of Object.entries(live1EX)) push(v, "expr/live1-" + k);
  for (const [k, v] of Object.entries(live1Track)) push(v, "track/live1-" + k);
  for (const t of live1CDTracks) push(t, "track/live1-cd");
  for (const [k, v] of Object.entries(A)) push(v, "agent/" + k);
  for (const [k, v] of Object.entries(CH)) push(v, "character/" + k);

  const fresh = new Map();
  for (const { e, tag } of ALL) {
    const got = await withRetry(() => camp.getEntity(e.id));
    fresh.set(e.id, got);
    checked.entities++;
    check(got.kind === e.kind, tag + " 回读 kind 不一致：" + got.kind + " ≠ " + e.kind);
    if (reusedIds.has(got.id)) continue; // 复用别人的存量实体：只校验 kind，四语/状态由原主负责
    check(got.status === "published", tag + " 状态不是 published：" + got.status);
    for (const loc of ["zh-CN", "zh-TW", "ja-JP", "en-US"]) {
      check(!!(got.translations || {})[loc] && !!(got.translations || {})[loc].title, tag + " 缺 " + loc + " 题名");
    }
  }

  // A 创作链：Work → ContentUnit → Expression
  for (const u of POTO_UNITS) {
    const cu = fresh.get(potoCU[u.key].id), ex = fresh.get(potoEX[u.key].id);
    check(cu.work_id === poto.id, "cu/poto-" + u.key + " work_id 不属于《The Phantom of the Opera》");
    check(cu.parent_id === potoActCU[u.act].id, "cu/poto-" + u.key + " parent 未指向 Act " + u.act);
    const actIndex = POTO_UNITS.filter((x) => x.act === u.act).findIndex((x) => x.key === u.key) + 1;
    check(String(cu.number) === String(actIndex) && cu.position === actIndex, "cu/poto-" + u.key + " number/position 与幕内序号不符：" + cu.number + "/" + cu.position);
    check(fresh.get(potoTrack[u.key].id).position === u.track && String(fresh.get(potoTrack[u.key].id).number) === String(u.track),
      "track/poto-" + u.key + " position/number 与 Apple Music 轨号不符");
    check(ex.work_id === poto.id, "expr/poto-" + u.key + " work_id 归属错误");
    check(ex.content_unit_id === potoCU[u.key].id, "expr/poto-" + u.key + " content_unit_id 未挂到对应篇目");
    check(ex.parent_id === undefined || ex.parent_id === null || ex.parent_id === "", "expr/poto-" + u.key + " 不应有 parent_id");
    check(ex.attributes && ex.attributes.duration === secs(u.ms), "expr/poto-" + u.key + " duration 不符：" + JSON.stringify(ex.attributes));
  }
  for (const [k, cu] of Object.entries(live1CU)) {
    const got = fresh.get(cu.id), ex = fresh.get(live1EX[k].id);
    check(got.work_id === live1.id, "cu/live1-" + k + " work_id 归属错误");
    check(ex.work_id === live1.id && ex.content_unit_id === cu.id, "expr/live1-" + k + " work_id/content_unit_id 归属错误");
  }

  // B 承载链：Release → Medium → Track → contents，且 subjects 覆盖全部被引用表达所属 Work
  const chains = [
    { rel: potoCD, mediums: [potoMed[1], potoMed[2]], tracks: Object.values(potoTrack), tag: "release/poto-cd" },
    { rel: potoBD, mediums: [potoMedBD], tracks: [potoMainTrack], tag: "release/poto-bd" },
    { rel: live1Rel, mediums: [live1MedBD, live1MedCD], tracks: [...Object.values(live1Track), ...live1CDTracks], tag: "release/live1" },
  ];
  for (const c of chains) {
    const r = fresh.get(c.rel.id);
    check(!r.work_id, c.tag + " 不应有 work_id");
    const subj = (r.subjects || []).map((x) => x.work_id);
    check(subj.length > 0, c.tag + " 缺 subjects");
    for (const m of c.mediums) check(fresh.get(m.id).release_id === r.id, c.tag + " medium 未挂在发行上");
    let withContents = 0;
    for (const t of c.tracks) {
      const got = fresh.get(t.id);
      check(c.mediums.some((m) => m.id === got.medium_id), c.tag + " track「" + got.title + "」medium 归属错误");
      const seen = new Set();
      for (const ct of got.contents || []) {
        check(!seen.has(ct.position), c.tag + " track「" + got.title + "」contents position 重复 " + ct.position);
        seen.add(ct.position);
        const ex = fresh.get(ct.expression_id);
        check(!!ex, c.tag + " track「" + got.title + "」contents 指向未知表达 " + ct.expression_id);
        if (ex) check(subj.includes(ex.work_id), c.tag + " track「" + got.title + "」表达所属 Work 未在 subjects 声明");
      }
      if ((got.contents || []).length) withContents++;
    }
    check(withContents > 0, c.tag + " 没有任何带 contents 的 Track（承载链只到 Medium）");
  }
  // 跨发行复用同一表达：CD 与 BD 引用同一批 expression
  for (const u of POTO_UNITS) {
    check(fresh.get(potoMainTrack.id).contents.some((c) => c.expression_id === potoEX[u.key].id),
      "track/poto-main 未复用 CD 版同一 Expression：" + u.key);
  }
  // 多媒体验证：同一发行的 BD 与 CD 各自挂载正确
  check(fresh.get(live1MedBD.id).attributes.format === "bd" && fresh.get(live1MedCD.id).attributes.format === "cd",
    "live1 发行的两条载体 format 不符");
  check(fresh.get(live1Rel.id).attributes.catalog_number === "BRMM-10109", "live1 发行品番回读不符");
  check((fresh.get(live1Rel.id).attributes.store_bonuses || []).length === 6, "live1 发行店舗特典回读条数不符");

  // C 关系：逐条回读（lib 幂等键修复后仍必须确认真的落库）
  const bySource = new Map();
  for (const e of expected) {
    if (!bySource.has(e.srcId)) bySource.set(e.srcId, []);
    bySource.get(e.srcId).push(e);
  }
  for (const [srcId, wanted] of bySource) {
    const got = await withRetry(() => client.relationsOf(srcId));
    const items = Array.isArray(got) ? got : (got.body && got.body.items) || [];
    for (const w of wanted) {
      const ok = items.some((r) => r.type === w.type && r.source_id === w.srcId && r.target_id === w.tgtId);
      check(ok, "关系回读缺失：" + w.type + " " + w.srcId.slice(0, 8) + "→" + w.tgtId.slice(0, 8));
      if (ok) checked.relations++;
    }
  }

  // D revisions
  const revSample = [poto.id, potoCU.music.id, potoEX.music.id, potoCD.id, potoMainTrack.id,
    live1.id, live1CU.p1.id, live1EX.p1.id, live1Rel.id, live1MedBD.id, live1Track.p1.id, A.koyama.id, CH.karen.id];
  for (const id of revSample) {
    const r = await withRetry(() => client.call("/api/catalog/entities/" + id + "/revisions"));
    const items = (r.body && (r.body.items || r.body.revisions)) || [];
    checked.revisions += items.length;
    check(r.status === 200 && items.length >= 1, "revisions 回读异常 " + id.slice(0, 8) + " -> " + r.status + " items=" + items.length);
  }
}

if (!DRY) {
  await verify();
  console.log("\n回读断言：实体 " + checked.entities + " 条、关系 " + checked.relations + " 条、revision " + checked.revisions + " 条");
  if (problems.length) {
    console.log("断言失败 " + problems.length + " 项：");
    for (const p of problems.slice(0, 40)) console.log("  ✗ " + p);
  } else {
    console.log("断言全部通过（结构归属 / subjects 覆盖 / 关系两端 / revisions / 四语题名）");
  }
  console.log("\n完整链样例：");
  console.log("  A: work " + poto.id + "「The Phantom of the Opera」→ cu " + potoCU.music.id + "「The Music of the Night」(parent " + potoActCU[1].id + " Act I) → expr " + potoEX.music.id
    + " → track " + potoTrack.music.id + " (medium " + potoMed[1].id + ") ← release " + potoCD.id + "（BRMM 无，品番缺）");
  console.log("  B: work " + live1.id + "「-The LIVE- #1」→ cu " + live1CU.p1.id + "「第1部 ミュージカルパート」→ expr " + live1EX.p1.id
    + " → track " + live1Track.p1.id + " (medium " + live1MedBD.id + ") ← release " + live1Rel.id + "（BRMM-10109）");
} else {
  console.log("\n[dry-run] 计划：work 3 / content_unit 11 / expression 9 / release 3 / medium 5 / track 18 / agent 12（另复用线上 2 个）/ character 6 = 67 个新实体；关系 30 条");
}

camp.summary({ verification: { problems: DRY ? ["dry-run 未回读"] : problems, checked }, expectedRelations: expected.length });
if (problems.length) process.exitCode = 1;
