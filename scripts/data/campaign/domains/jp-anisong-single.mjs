#!/usr/bin/env node
// 领域 1 —— 日本动画主题歌单曲 CD（slug: jp-anisong-single）
//
// 真实数据（每一条都有来源，见 SRC；未取到证据的字段一律留空）：
//   A. LiSA「紅蓮華」 初回生産限定盤 VVCL-1458/1459（CD+DVD, 2019-07-03）与 通常盤 VVCL-1460（CD）
//   B. 高橋洋子「残酷な天使のテーゼ」 KIDA-114（8cm CD, 1995-10-25）
//   C. Aimer「残響散歌 / 朝が来る」 通常盤 VVCL-1955（CD, 2022-01-12）
//
// 两条链（BRIEF 第 0 节）：
//   创作链  テレビアニメ work → 話数 content_unit → 放送版 expression
//   承载链  song work → expression(录音母版) → release(subjects) → medium(CD/DVD) → track.contents[]
//
// 用法：MF_USER_PASS=... node scripts/data/campaign/domains/jp-anisong-single.mjs [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { Campaign, Client, Index, LOG_DIR, src } from "../lib.mjs";

const DOMAIN = "jp-anisong-single";
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

// ---------------------------------------------------------------- 来源清单

const SRC = {
  mbKurenaiKai: src("https://musicbrainz.org/release/c7140dd9-d4e5-47f6-add4-cece25667fc1",
    "MusicBrainz「紅蓮華」初回生産限定盤（VVCL-1458/1459、条码 4547366408171、2019-07-03、SACRA MUSIC）：CD 4 曲 + DVD「紅蓮華 –MUSiC CLiP–」的曲序/题名/时长/录音 id"),
  mbKurenaiReg: src("https://musicbrainz.org/release/1d1b0a72-bde3-4768-9e49-f74953b113d7",
    "MusicBrainz「紅蓮華」通常盤（VVCL-1460、条码 4547366408188、Jewel Case）：CD 4 曲（紅蓮華 / “PROPAGANDA” / やくそくのうた / 紅蓮華 –Instrumental–）的题名、时长与 ISRC"),
  mbZankoku: src("https://musicbrainz.org/release/59226ea2-ff84-4819-b4f7-f0a0618019c9",
    "MusicBrainz「残酷な天使のテーゼ」（KIDA-114、条码 4988003179588、1995-10-25、STARCHILD、8cm CD）：4 曲题名、时长、ISRC"),
  mbAimerReg: src("https://musicbrainz.org/release/4089866e-3aa7-4200-a992-d6dcedded6e4",
    "MusicBrainz「残響散歌 / 朝が来る」通常盤（VVCL-1955、条码 4547366531008、2022-01-12、nocturne）：6 曲题名、时长、ISRC"),
  mbArtist: src("https://musicbrainz.org/search?query=LiSA&type=artist",
    "MusicBrainz artist 条目：日文原名与罗马字别名（高橋洋子 sort-name Takahashi, Yoko；草野華余子＝Kayoko Kusano；飛内将大＝Masahiro Tobinai；梶浦由記＝Yuki Kajiura 等）与 MBID"),
  mbGdm: src("https://musicbrainz.org/artist/122cce39-8303-4801-989e-cefa438bd98d",
    "MusicBrainz artist「Girls Dead Monster」（别名 ガルデモ/GirlDeMo）"),
  wikiKny: src("https://ja.wikipedia.org/wiki/鬼滅の刃_(アニメ)",
    "ja.wikipedia「鬼滅の刃 (アニメ)」：第1期 2019 年 4 月起全 26 话；OP「紅蓮華」作詞 LiSA・作曲 草野華余子・編曲 江口亮；遊郭編 2021-12 起全 11 话，OP 残響散歌 / ED 朝が来る 由 Aimer 担当"),
  wikiZankoku: src("https://ja.wikipedia.org/wiki/残酷な天使のテーゼ",
    "ja.wikipedia「残酷な天使のテーゼ」：高橋洋子第 11 张单曲、1995-10-25 スターチャイルド発売；全作詞 及川眠子・全編曲 大森俊之；1 曲目作曲 佐藤英敏（NGE OP）、2 曲目 月の迷宮 作曲 大森俊之（NGE イメージソング）；英文题 A Cruel Angel's Thesis"),
  wikiAimerSingle: src("https://ja.wikipedia.org/wiki/残響散歌/朝が来る",
    "ja.wikipedia「残響散歌/朝が来る」：Aimer 両A面シングル、2022-01-12 SACRA MUSIC 発売、通常盤/初回生産限定盤/期間生産限定盤 3 形態；残響散歌 作詞 aimerrhythm・作曲 飛内将大・編曲 玉井健二と飛内将大；朝が来る 由 梶浦由記 制作（遊郭編 OP/ED）"),
  wikiEva: src("https://ja.wikipedia.org/wiki/新世紀エヴァンゲリオン",
    "ja.wikipedia「新世紀エヴァンゲリオン」：1995-10-04 ~ 1996-03-27 テレビ東京系列、全 26 话；オープニングテーマ「残酷な天使のテーゼ」"),
  wikiLisa: src("https://ja.wikipedia.org/wiki/LiSA",
    "ja.wikipedia「LiSA」：2010 年以「Girls Dead Monster」2 代目ボーカル（ユイ役）メジャーデビュー、2010-12-27「Last Live -Final Operation」で活動終了；2019-07-03 第 15 张单曲「紅蓮華」发行"),
  bgmKny: src("https://api.bgm.tv/v0/episodes?subject_id=245665&type=0&limit=4&offset=0",
    "Bangumi v0（subject 245665「鬼滅の刃」）：第 1 話「残酷」air_date 2019-04-06、时长 00:23:40"),
  bgmEva: src("https://api.bgm.tv/v0/episodes?subject_id=265&type=0&limit=4&offset=0",
    "Bangumi v0（subject 265「新世紀エヴァンゲリオン」）：第 1 話「使徒、襲来」air_date 1995-10-04、时长 24m"),
  bgmSubject: src("https://api.bgm.tv/v0/search/subjects",
    "Bangumi v0 检索：鬼滅の刃 = subject 245665（2019-04-06, 26 话）、新世紀エヴァンゲリオン = subject 265（1995-10-04, 26 话）"),
  anilist: src("https://graphql.anilist.co",
    "AniList GraphQL：鬼滅の刃 = 101922（native 鬼滅の刃 / english Demon Slayer: Kimetsu no Yaiba）、新世紀エヴァンゲリオン = 30（native 新世紀エヴァンゲリオン / english Neon Genesis Evangelion）"),
};

// ---------------------------------------------------------------- 证据（edit_note + sources）

const EV = {
  agent: {
    note: "编目：新建日本动画主题歌相关责任主体（歌手/词曲作者/编曲者/乐队/唱片公司）。人物题名用日文原名，罗马字取自 MusicBrainz artist 别名字段；唱片公司名用发行方页面上标示的官方名。",
    sources: [SRC.mbArtist, SRC.mbGdm, SRC.wikiKny, SRC.wikiZankoku, SRC.wikiAimerSingle],
  },
  workSong: {
    note: "编目：为动画主题歌单曲建立纯净曲目 Work（type=song），题名只保留歌曲主名，不带「初回限定」「TV ver.」等版本修饰；原语言 ja。",
    sources: [SRC.wikiKny, SRC.wikiZankoku, SRC.wikiAimerSingle, SRC.mbKurenaiReg],
  },
  workKurenai: {
    note: "编目：建立「紅蓮華」曲目 Work——电视动画『鬼滅の刃』第 1 期片头主题歌，作詞 LiSA・作曲 草野華余子・編曲 江口亮。",
    sources: [SRC.wikiKny, SRC.mbKurenaiReg],
  },
  workZankoku: {
    note: "编目：建立「残酷な天使のテーゼ」曲目 Work——电视动画『新世紀エヴァンゲリオン』片头主题歌，作詞 及川眠子・作曲 佐藤英敏・編曲 大森俊之。",
    sources: [SRC.wikiZankoku, SRC.wikiEva, SRC.mbZankoku],
  },
  workZankyo: {
    note: "编目：建立「残響散歌」曲目 Work——电视动画『鬼滅の刃』遊郭編片头主题歌，作詞 aimerrhythm・作曲 飛内将大・編曲 玉井健二与飛内将大。",
    sources: [SRC.wikiAimerSingle, SRC.mbAimerReg],
  },
  workAsa: {
    note: "编目：建立「朝が来る」曲目 Work——电视动画『鬼滅の刃』遊郭編片尾主题歌，由 梶浦由記 制作。",
    sources: [SRC.wikiAimerSingle],
  },
  workAnimeKny: {
    note: "编目：建立动画 Work「鬼滅の刃」（第 1 期，テレビアニメ全 26 话，2019-04-06 起播）。季名/编成信息不入 Work 题名，播出期与话数放 attributes。",
    sources: [SRC.wikiKny, SRC.bgmSubject, SRC.anilist],
  },
  workAnimeEva: {
    note: "编目：建立动画 Work「新世紀エヴァンゲリオン」（1995-10-04 ~ 1996-03-27 テレビ東京系列、全 26 话）。",
    sources: [SRC.wikiEva, SRC.bgmSubject, SRC.anilist],
  },
  cuKny: {
    note: "编目：为动画 Work「鬼滅の刃」建立第 1 话篇目 content_unit（题名「残酷」，number 保留官方话数 1，air_date 2019-04-06，entry_role=main）。",
    sources: [SRC.bgmKny],
  },
  cuEva: {
    note: "编目：为动画 Work「新世紀エヴァンゲリオン」建立第 1 话篇目 content_unit（题名「使徒、襲来」，number 1，air_date 1995-10-04，entry_role=main）。",
    sources: [SRC.bgmEva],
  },
  exprLisa: {
    note: "编目：建立「紅蓮華」各版本的录音 Expression（本编 / Instrumental / DVD 收録 MUSiC CLiP），带时长（秒）与 ISRC；题名沿用发行物上的官方表记。",
    sources: [SRC.mbKurenaiReg, SRC.mbKurenaiKai],
  },
  exprZankoku: {
    note: "编目：建立「残酷な天使のテーゼ」8cm 单曲 4 轨的录音 Expression（含两轨オリジナルカラオケ），带时长与 ISRC。",
    sources: [SRC.mbZankoku, SRC.wikiZankoku],
  },
  expraimer: {
    note: "编目：建立「残響散歌 / 朝が来る」通常盤 6 轨的录音 Expression（本编 / Instrumental / TV ver.），带时长与 ISRC。",
    sources: [SRC.mbAimerReg],
  },
  exprAnime: {
    note: "编目：建立动画本篇的放送版 Expression，并挂到同一 Work 的篇目 content_unit 上（expression.content_unit_id 与 work_id 同作用域）。",
    sources: [SRC.bgmKny, SRC.bgmEva],
  },
  relReleaseKai: {
    note: "编目：LiSA 单曲「紅蓮華」初回生産限定盤（VVCL-1458/1459，CD+DVD，2019-07-03，SACRA MUSIC）：subjects 声明收录 3 首歌曲 Work，medium 按实物分为 CD 与特典 DVD。",
    sources: [SRC.mbKurenaiKai, SRC.mbKurenaiReg],
  },
  relReleaseReg: {
    note: "编目：LiSA 单曲「紅蓮華」通常盤（VVCL-1460，CD，2019-07-03，SACRA MUSIC），与初回盘共用同一批录音 Expression（跨发行复用）。",
    sources: [SRC.mbKurenaiReg],
  },
  relReleaseZankoku: {
    note: "编目：高橋洋子单曲「残酷な天使のテーゼ」（KIDA-114，8cm CD，1995-10-25，STARCHILD），subjects 声明 2 首歌曲 Work。",
    sources: [SRC.mbZankoku, SRC.wikiZankoku],
  },
  relReleaseAimer: {
    note: "编目：Aimer 両A面单曲「残響散歌 / 朝が来る」通常盤（VVCL-1955，CD，2022-01-12，SACRA MUSIC），subjects 声明 2 首歌曲 Work。",
    sources: [SRC.mbAimerReg, SRC.wikiAimerSingle],
  },
  relPerformed: {
    note: "编目：建立演唱署名 performed_by（expression → agent），credit_role 用发行物上的声部表记。",
    sources: [SRC.mbKurenaiReg, SRC.mbZankoku, SRC.mbAimerReg],
  },
  relWritten: {
    note: "编目：建立词曲编曲署名（lyricist_of / composed_by / arranged_by，work → agent），credit_role 用日文职务名。",
    sources: [SRC.wikiKny, SRC.wikiZankoku, SRC.wikiAimerSingle],
  },
  relSoundtrack: {
    note: "编目：建立 soundtrack_of（歌曲 Work → 动画 Work），把各单曲的表题曲挂回它作为主题歌的动画作品。",
    sources: [SRC.wikiKny, SRC.wikiZankoku, SRC.wikiAimerSingle],
  },
  relMember: {
    note: "编目：建立 member_of（LiSA → Girls Dead Monster），scope 记录其在动画『Angel Beats!』乐队中担任 2 代目主唱（ユイ役）的期间。",
    sources: [SRC.wikiLisa, SRC.mbGdm],
  },
  relBonus: {
    note: "编目：建立 bonus_included_in（expression → medium），把初回生産限定盤特典 DVD 里的 MUSiC CLiP 影像挂到该 DVD medium 上。",
    sources: [SRC.mbKurenaiKai],
  },
};

// ---------------------------------------------------------------- 连接与写前查重

const client = new Client();
await client.login();
const camp = new Campaign({ domain: DOMAIN, client, index: Index.load() });
const E = {};
const created = [];

const T = (ja, zhCN, zhTW, en) => ({
  "ja-JP": { title: ja },
  "zh-CN": { title: zhCN || ja },
  "zh-TW": { title: zhTW || ja },
  "en-US": { title: en || ja },
});

/** 写前精确查重：按 kind + 题名（+ 结构归属）问服务端，命中即塞进本地索引供 ensureEntity 复用。 */
async function reuseLookup(kind, title, scope = {}, extra = "") {
  const items = await client.search(kind, title, extra);
  const hit = (items || []).find((x) => norm(x.title) === norm(title)
    && (!scope.work_id || x.work_id === scope.work_id)
    && (!scope.release_id || x.release_id === scope.release_id)
    && (!scope.medium_id || x.medium_id === scope.medium_id));
  if (hit) camp.index.add(hit);
  return hit || null;
}

async function mk(kind, key, title, spec, ev, { scope = {}, extra = "" } = {}) {
  await reuseLookup(kind, title, scope, extra);
  const e = await camp.ensureEntity(kind, title, spec, ev, { idemKey: DOMAIN + "-" + key, scope, allowServerLookup: false });
  E[key] = e;
  created.push({ key, kind, title, id: e.id });
  return e;
}

// ---------------------------------------------------------------- agent（14）

const AGENTS = [
  ["lisa", "LiSA", ["person"], "LiSA", "LiSA", "LiSA", "LiSA", "85d76093-9865-4605-97fa-8c910929d366"],
  ["yoko", "高橋洋子", ["person"], "高橋洋子", "高橋洋子", "高橋洋子", "Yoko Takahashi", "7004bc31-23ee-4216-8d74-0d230e88079f"],
  ["aimer", "Aimer", ["person"], "Aimer", "Aimer", "Aimer", "Aimer", "9388cee2-7d57-4598-905f-106019b267d3"],
  ["kusano", "草野華余子", ["person"], "草野華余子", "草野華余子", "草野華余子", "Kayoko Kusano", "91490a39-cae7-4388-982c-f194d2379b2e"],
  ["eguchi", "江口亮", ["person"], "江口亮", "江口亮", "江口亮", "Ryo Eguchi", "2a558781-53aa-4f49-bb82-c32ff5886fbb"],
  ["oikawa", "及川眠子", ["person"], "及川眠子", "及川眠子", "及川眠子", "Neko Oikawa", "0b97970e-7bbb-451b-a1be-3783dd8644e0"],
  ["sato", "佐藤英敏", ["person"], "佐藤英敏", "佐藤英敏", "佐藤英敏", "Hidetoshi Sato", "f12498a6-cc9e-4e2b-ad3e-95d95af3ac87"],
  ["omori", "大森俊之", ["person"], "大森俊之", "大森俊之", "大森俊之", "Toshiyuki Omori", "099116a7-2c5a-410c-870f-8876031ce285"],
  ["tobinai", "飛内将大", ["person"], "飛内将大", "飛内将大", "飛内将大", "Masahiro Tobinai", "466150eb-ecc1-4da6-af1d-2f1d58d710b8"],
  ["tamai", "玉井健二", ["person"], "玉井健二", "玉井健二", "玉井健二", "Kenji Tamai", "9fec306a-588a-488c-9a37-d610b2559ec0"],
  ["kajiura", "梶浦由記", ["person"], "梶浦由記", "梶浦由記", "梶浦由記", "Yuki Kajiura", "67e344da-ec54-4e26-b2a4-8351d744a14c"],
  ["gdm", "Girls Dead Monster", ["group"], "Girls Dead Monster", "Girls Dead Monster", "Girls Dead Monster", "Girls Dead Monster", "122cce39-8303-4801-989e-cefa438bd98d"],
  ["sacramusic", "SACRA MUSIC", ["organization"], "SACRA MUSIC", "SACRA MUSIC", "SACRA MUSIC", "SACRA MUSIC", ""],
  ["starchild", "STARCHILD", ["organization"], "STARCHILD", "STARCHILD", "STARCHILD", "STARCHILD", ""],
];

for (const [key, title, types, ja, zhCN, zhTW, en, mb] of AGENTS) {
  await mk("agent", key, title, {
    original_language: "ja",
    types,
    translations: T(ja, zhCN, zhTW, en),
    attributes: {},
    external_ids: mb ? { musicbrainz: mb } : {},
  }, EV.agent);
}

// ---------------------------------------------------------------- work（9）

const SONGS = [
  ["w_kurenai", "紅蓮華", "紅蓮華", "紅蓮華", "紅蓮華", "紅蓮華", EV.workKurenai],
  ["w_propaganda", "“PROPAGANDA”", "“PROPAGANDA”", "“PROPAGANDA”", "“PROPAGANDA”", "“PROPAGANDA”", EV.workSong],
  ["w_yakusoku", "やくそくのうた", "やくそくのうた", "やくそくのうた", "やくそくのうた", "やくそくのうた", EV.workSong],
  ["w_zankoku", "残酷な天使のテーゼ", "残酷な天使のテーゼ", "残酷な天使のテーゼ", "残酷な天使のテーゼ", "A Cruel Angel's Thesis", EV.workZankoku],
  ["w_tsuki", "月の迷宮", "月の迷宮", "月の迷宮", "月の迷宮", "月の迷宮", EV.workSong],
  ["w_zankyo", "残響散歌", "残響散歌", "残響散歌", "残響散歌", "残響散歌", EV.workZankyo],
  ["w_asa", "朝が来る", "朝が来る", "朝が来る", "朝が来る", "朝が来る", EV.workAsa],
];

for (const [key, title, ja, zhCN, zhTW, en, ev] of SONGS) {
  await mk("work", key, title, {
    original_language: "ja",
    types: ["song"],
    translations: T(ja, zhCN, zhTW, en),
    attributes: { language: "ja", tags: ["アニソン", "アニメ主題歌"] },
    external_ids: {},
  }, ev);
}

await mk("work", "w_kny", "鬼滅の刃", {
  original_language: "ja",
  types: ["animation"],
  translations: T("鬼滅の刃", "鬼灭之刃", "鬼滅之刃", "Demon Slayer: Kimetsu no Yaiba"),
  attributes: { episodes: 26, broadcast_start: "2019-04-06", language: "ja", air_network: "TOKYO MXほか", tags: ["アニメ", "テレビアニメ"] },
  external_ids: { bangumi: "245665", anilist: "101922" },
}, EV.workAnimeKny);

await mk("work", "w_eva", "新世紀エヴァンゲリオン", {
  original_language: "ja",
  types: ["animation"],
  translations: T("新世紀エヴァンゲリオン", "新世纪福音战士", "新世紀福音戰士", "Neon Genesis Evangelion"),
  attributes: { episodes: 26, broadcast_start: "1995-10-04", broadcast_end: "1996-03-27", language: "ja", air_network: "テレビ東京系列", tags: ["アニメ", "テレビアニメ"] },
  external_ids: { bangumi: "265", anilist: "30" },
}, EV.workAnimeEva);

// ---------------------------------------------------------------- content_unit（2，创作链第一跳）

const CUS = [
  ["cu_kny1", "w_kny", "残酷", "残酷", "残酷", "残酷", { air_date: "2019-04-06", entry_role: "main", language: "ja" }, EV.cuKny],
  ["cu_eva1", "w_eva", "使徒、襲来", "使徒、襲来", "使徒、袭来", "使徒、襲来", { air_date: "1995-10-04", entry_role: "main", language: "ja" }, EV.cuEva],
];

for (const [key, workKey, title, ja, zhCN, zhTW, attr, ev] of CUS) {
  const work = E[workKey];
  await mk("content_unit", key, title, {
    work_id: work.id, position: 1, number: "1",
    original_language: "ja",
    types: ["content_unit"],
    translations: T(ja, zhCN, zhTW),
    attributes: attr,
    external_ids: {},
  }, ev, { scope: { work_id: work.id }, extra: "&work_id=" + work.id });
}

// ---------------------------------------------------------------- expression（17，创作链第二跳 + 承载链录音层）

const EXPRS = [
  // LiSA「紅蓮華」
  ["e_kurenai", "w_kurenai", "紅蓮華", 239, "JPU901900905", "a2082882-cb38-4077-b162-919d3528f5f6", "", "", EV.exprLisa],
  ["e_propaganda", "w_propaganda", "“PROPAGANDA”", 201, "JPU901901438", "511b5246-1771-4dc5-a3fb-febec2b91be6", "", "", EV.exprLisa],
  ["e_yakusoku", "w_yakusoku", "やくそくのうた", 278, "JPU901901439", "60ff320f-193b-4aea-a37a-13957152225d", "", "", EV.exprLisa],
  ["e_kurenai_inst", "w_kurenai", "紅蓮華 -Instrumental-", 235, "JPU901901440", "0c9fbebb-6129-42d1-af47-9fbab2c31d8c", "Instrumental", "", EV.exprLisa],
  ["e_kurenai_mv", "w_kurenai", "紅蓮華 –MUSiC CLiP–", 231, "", "1d9d1a1c-e9f8-4613-8f9b-4e18e61f7899", "MUSiC CLiP", "", EV.exprLisa],
  // 高橋洋子「残酷な天使のテーゼ」
  ["e_zankoku", "w_zankoku", "残酷な天使のテーゼ", 246, "JPKI09519950", "99b455ec-7f1e-49b2-bcbc-b8ee3302dbb1", "", "", EV.exprZankoku],
  ["e_tsuki", "w_tsuki", "月の迷宮", 345, "JPKI09519960", "157e3fb0-3b7d-4184-a587-694fa26f4d23", "", "", EV.exprZankoku],
  ["e_zankoku_karaoke", "w_zankoku", "残酷な天使のテーゼ（オリジナルカラオケ）", 245, "JPKI09519959", "e37045f3-c0a7-4a67-a708-09cd856ac7a4", "オリジナルカラオケ", "", EV.exprZankoku],
  ["e_tsuki_karaoke", "w_tsuki", "月の迷宮（オリジナルカラオケ）", 344, "JPKI09519969", "c299ccef-2593-425c-97ef-c00a0c21f8d0", "オリジナルカラオケ", "", EV.exprZankoku],
  // Aimer「残響散歌 / 朝が来る」
  ["e_zankyo", "w_zankyo", "残響散歌", 185, "JPU902104729", "3991a94f-b492-4fcb-99c0-23c7933d4e62", "", "", EV.expraimer],
  ["e_asa", "w_asa", "朝が来る", 295, "JPU902104730", "312f23eb-7703-42a1-ad31-424262d42454", "", "", EV.expraimer],
  ["e_zankyo_inst", "w_zankyo", "残響散歌 -Instrumental-", 185, "JPU902104731", "d36ac19d-7597-460b-92d6-3ec1986b86f7", "Instrumental", "", EV.expraimer],
  ["e_asa_inst", "w_asa", "朝が来る -Instrumental-", 295, "JPU902104732", "e858a2cc-ac9a-4935-9313-03deee2f8459", "Instrumental", "", EV.expraimer],
  ["e_zankyo_tv", "w_zankyo", "残響散歌 -TV ver.-", 91, "JPU902104733", "16f06917-111a-4dd1-a0e3-4c82ad17d438", "TV ver.", "", EV.expraimer],
  ["e_asa_tv", "w_asa", "朝が来る -TV ver.-", 91, "JPU902104734", "c6b5b896-0dd5-40d6-8e38-389e322a8434", "TV ver.", "", EV.expraimer],
  // 动画本篇放送版（创作链：work → content_unit → expression）
  ["e_kny_ep1", "w_kny", "残酷", 1420, "", "", "", "cu_kny1", EV.exprAnime],
  ["e_eva_ep1", "w_eva", "使徒、襲来", 1440, "", "", "", "cu_eva1", EV.exprAnime],
];

for (const [key, workKey, title, dur, isrc, mb, version, cuKey, ev] of EXPRS) {
  const work = E[workKey];
  const attributes = { language: "ja", duration: dur };
  if (version) attributes.version_label = version;
  if (isrc) attributes.isrc = isrc;
  const spec = {
    work_id: work.id,
    original_language: "ja",
    types: ["expression"],
    translations: T(title),
    attributes,
    external_ids: mb ? { musicbrainz: mb } : {},
  };
  if (cuKey) spec.content_unit_id = E[cuKey].id;
  await mk("expression", key, title, spec, ev, { scope: { work_id: work.id }, extra: "&work_id=" + work.id });
}

// ---------------------------------------------------------------- release（4）/ medium（5）/ track（19）

const RELEASE_PLAN = [
  {
    key: "r_kurenai_kai", title: "紅蓮華（初回生産限定盤）", ev: EV.relReleaseKai,
    attr: {
      catalog_number: "VVCL-1458/1459", barcode: "4547366408171", edition_date: "2019-07-03",
      edition_type: "limited", edition_batch: "first_press", country: "JP",
      packaging: "jewel", distribution_channel: "physical",
    },
    publisher: "sacramusic",
    subjects: [["w_kurenai", "primary"], ["w_propaganda", "primary"], ["w_yakusoku", "primary"]],
    mediums: [
      {
        key: "m_kai_cd", title: "CD", attr: { catalog_number: "VVCL-1458", format: "cd", role: "primary" },
        tracks: [
          ["紅蓮華", "e_kurenai", 239, "primary"],
          ["“PROPAGANDA”", "e_propaganda", 201, "primary"],
          ["やくそくのうた", "e_yakusoku", 278, "primary"],
          ["紅蓮華 -Instrumental-", "e_kurenai_inst", 235, "primary"],
        ],
      },
      {
        key: "m_kai_dvd", title: "DVD", attr: { catalog_number: "VVCL-1459", format: "dvd", role: "supplement" },
        tracks: [["紅蓮華 –MUSiC CLiP–", "e_kurenai_mv", 231, "supplement"]],
      },
    ],
  },
  {
    key: "r_kurenai_reg", title: "紅蓮華（通常盤）", ev: EV.relReleaseReg,
    attr: {
      catalog_number: "VVCL-1460", barcode: "4547366408188", edition_date: "2019-07-03",
      edition_type: "standard", edition_batch: "regular", country: "JP",
      packaging: "jewel", distribution_channel: "physical",
    },
    publisher: "sacramusic",
    subjects: [["w_kurenai", "primary"], ["w_propaganda", "primary"], ["w_yakusoku", "primary"]],
    mediums: [
      {
        key: "m_reg_cd", title: "CD", attr: { catalog_number: "VVCL-1460", format: "cd", role: "primary" },
        tracks: [
          ["紅蓮華", "e_kurenai", 239, "primary"],
          ["“PROPAGANDA”", "e_propaganda", 201, "primary"],
          ["やくそくのうた", "e_yakusoku", 278, "primary"],
          ["紅蓮華 -Instrumental-", "e_kurenai_inst", 235, "primary"],
        ],
      },
    ],
  },
  {
    key: "r_zankoku", title: "残酷な天使のテーゼ", ev: EV.relReleaseZankoku,
    attr: {
      catalog_number: "KIDA-114", barcode: "4988003179588", edition_date: "1995-10-25",
      edition_type: "standard", edition_batch: "first_press", country: "JP",
      distribution_channel: "physical",
    },
    publisher: "starchild",
    subjects: [["w_zankoku", "primary"], ["w_tsuki", "primary"]],
    mediums: [
      {
        key: "m_zan_cd", title: "CD", attr: { catalog_number: "KIDA-114", format: "cd", role: "primary" },
        tracks: [
          ["残酷な天使のテーゼ", "e_zankoku", 246, "primary"],
          ["月の迷宮", "e_tsuki", 345, "primary"],
          ["残酷な天使のテーゼ（オリジナルカラオケ）", "e_zankoku_karaoke", 245, "supplement"],
          ["月の迷宮（オリジナルカラオケ）", "e_tsuki_karaoke", 344, "supplement"],
        ],
      },
    ],
  },
  {
    key: "r_aimer_reg", title: "残響散歌 / 朝が来る（通常盤）", ev: EV.relReleaseAimer,
    attr: {
      catalog_number: "VVCL-1955", barcode: "4547366531008", edition_date: "2022-01-12",
      edition_type: "standard", edition_batch: "regular", country: "JP",
      distribution_channel: "physical",
    },
    publisher: "sacramusic",
    subjects: [["w_zankyo", "primary"], ["w_asa", "primary"]],
    mediums: [
      {
        key: "m_aim_cd", title: "CD", attr: { catalog_number: "VVCL-1955", format: "cd", role: "primary" },
        tracks: [
          ["残響散歌", "e_zankyo", 185, "primary"],
          ["朝が来る", "e_asa", 295, "primary"],
          ["残響散歌 -Instrumental-", "e_zankyo_inst", 185, "supplement"],
          ["朝が来る -Instrumental-", "e_asa_inst", 295, "supplement"],
          ["残響散歌 -TV ver.-", "e_zankyo_tv", 91, "supplement"],
          ["朝が来る -TV ver.-", "e_asa_tv", 91, "supplement"],
        ],
      },
    ],
  },
];

for (const plan of RELEASE_PLAN) {
  const release = await mk("release", plan.key, plan.title, {
    original_language: "ja",
    types: ["release"],
    translations: T(plan.title),
    attributes: { ...plan.attr, publisher: E[plan.publisher].id },
    external_ids: {},
    subjects: plan.subjects.map(([workKey, role], i) => ({ work_id: E[workKey].id, role, position: i })),
  }, plan.ev, { extra: "" });

  for (let mi = 0; mi < plan.mediums.length; mi++) {
    const mp = plan.mediums[mi];
    const medium = await mk("medium", mp.key, mp.title, {
      release_id: release.id, position: mi,
      original_language: "ja",
      types: ["medium"],
      translations: T(mp.title),
      attributes: mp.attr,
      external_ids: {},
    }, plan.ev, { scope: { release_id: release.id }, extra: "&release_id=" + release.id });

    for (let ti = 0; ti < mp.tracks.length; ti++) {
      const [title, exprKey, dur, role] = mp.tracks[ti];
      await mk("track", mp.key + "_t" + (ti + 1), title, {
        medium_id: medium.id, position: ti + 1, number: "",
        original_language: "ja",
        types: ["track"],
        translations: T(title),
        attributes: { duration: dur, role },
        external_ids: {},
        contents: [{ expression_id: E[exprKey].id, position: 1, locator: null }],
      }, plan.ev, { scope: { medium_id: medium.id }, extra: "&medium_id=" + medium.id });
    }
  }
}

// ---------------------------------------------------------------- 关系（28）

const RELS = [
  // performed_by：录音 → 演唱者
  ["performed_by", "e_kurenai", "lisa", { credit_role: "ヴォーカル" }, EV.relPerformed],
  ["performed_by", "e_propaganda", "lisa", { credit_role: "ヴォーカル" }, EV.relPerformed],
  ["performed_by", "e_yakusoku", "lisa", { credit_role: "ヴォーカル" }, EV.relPerformed],
  ["performed_by", "e_zankoku", "yoko", { credit_role: "ヴォーカル" }, EV.relPerformed],
  ["performed_by", "e_tsuki", "yoko", { credit_role: "ヴォーカル" }, EV.relPerformed],
  ["performed_by", "e_zankyo", "aimer", { credit_role: "ヴォーカル" }, EV.relPerformed],
  ["performed_by", "e_asa", "aimer", { credit_role: "ヴォーカル" }, EV.relPerformed],
  // lyricist_of / composed_by / arranged_by：词曲编曲署名（work → agent）
  ["lyricist_of", "w_kurenai", "lisa", { credit_role: "作詞" }, EV.relWritten],
  ["composed_by", "w_kurenai", "kusano", { credit_role: "作曲" }, EV.relWritten],
  ["arranged_by", "w_kurenai", "eguchi", { credit_role: "編曲" }, EV.relWritten],
  ["lyricist_of", "w_zankoku", "oikawa", { credit_role: "作詞" }, EV.relWritten],
  ["composed_by", "w_zankoku", "sato", { credit_role: "作曲" }, EV.relWritten],
  ["arranged_by", "w_zankoku", "omori", { credit_role: "編曲" }, EV.relWritten],
  ["composed_by", "w_tsuki", "omori", { credit_role: "作曲" }, EV.relWritten],
  ["lyricist_of", "w_zankyo", "aimer", { credit_role: "作詞（aimerrhythm 名義）" }, EV.relWritten],
  ["composed_by", "w_zankyo", "tobinai", { credit_role: "作曲" }, EV.relWritten],
  ["arranged_by", "w_zankyo", "tamai", { credit_role: "編曲" }, EV.relWritten],
  ["arranged_by", "w_zankyo", "tobinai", { credit_role: "編曲" }, EV.relWritten],
  ["lyricist_of", "w_asa", "kajiura", { credit_role: "作詞" }, EV.relWritten],
  ["composed_by", "w_asa", "kajiura", { credit_role: "作曲" }, EV.relWritten],
  ["arranged_by", "w_asa", "kajiura", { credit_role: "編曲" }, EV.relWritten],
  // soundtrack_of：歌曲 Work → 动画 Work
  ["soundtrack_of", "w_kurenai", "w_kny", { credit_role: "オープニングテーマ（第1期『竈門炭治郎 立志編』）" }, EV.relSoundtrack],
  ["soundtrack_of", "w_zankyo", "w_kny", { credit_role: "オープニングテーマ（『遊郭編』）" }, EV.relSoundtrack],
  ["soundtrack_of", "w_asa", "w_kny", { credit_role: "エンディングテーマ（『遊郭編』）" }, EV.relSoundtrack],
  ["soundtrack_of", "w_zankoku", "w_eva", { credit_role: "オープニングテーマ" }, EV.relSoundtrack],
  // member_of：LiSA → Girls Dead Monster
  ["member_of", "lisa", "gdm", { scope: "『Angel Beats!』剧中乐队 2 代目主唱（ユイ役）名义，2010 年参加、2010-12-27 Last Live 后活动结束" }, EV.relMember],
  // bonus_included_in：特典影像 Expression → 初回盘 DVD medium
  ["bonus_included_in", "e_kurenai_mv", "m_kai_dvd", { credit_role: "初回生産限定盤 特典 DVD 収録" }, EV.relBonus],
];

for (const [type, srcKey, tgtKey, attributes, ev] of RELS) {
  await camp.createRelation(type, E[srcKey].id, E[tgtKey].id, ev, {
    attributes,
    idemKey: DOMAIN + "-rel-" + type + "-" + srcKey + "-" + tgtKey,
  });
}

// ---------------------------------------------------------------- 写后回读断言

const problems = [];
const check = (name, ok, detail) => {
  if (!ok) problems.push({ name, detail: detail || "" });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
};

const isDry = created.some((c) => String(c.id).startsWith("DRY-"));

if (isDry) {
  console.log("\n[dry-run] 跳过写后回读断言。计划实体 " + created.length + " 个、关系 " + RELS.length + " 条。");
} else {
  const byKey = {};
  for (const c of created) byKey[c.key] = c;

  // 1) 结构归属：content_unit/expression/medium/track 的父级字段
  const expect = {
    cu_kny1: { work_id: E.w_kny.id },
    cu_eva1: { work_id: E.w_eva.id },
    m_kai_cd: { release_id: E.r_kurenai_kai.id },
    m_kai_dvd: { release_id: E.r_kurenai_kai.id },
    m_reg_cd: { release_id: E.r_kurenai_reg.id },
    m_zan_cd: { release_id: E.r_zankoku.id },
    m_aim_cd: { release_id: E.r_aimer_reg.id },
  };
  for (const c of created) {
    const back = await camp.getEntity(c.id);
    check("回读 " + c.kind + "「" + c.title + "」", back && back.id === c.id && back.status === "published",
      back ? "status=" + back.status : "no body");
    const want = expect[c.key];
    if (want) {
      for (const k of Object.keys(want)) check("结构归属 " + c.key + "." + k, back[k] === want[k], "got " + back[k]);
    }
  }

  // 2) expression 的 work 归属 + content_unit 作用域（创作链）
  const exprWork = {};
  for (const [key, workKey] of [["e_kurenai", "w_kurenai"], ["e_propaganda", "w_propaganda"], ["e_yakusoku", "w_yakusoku"],
    ["e_kurenai_inst", "w_kurenai"], ["e_kurenai_mv", "w_kurenai"], ["e_zankoku", "w_zankoku"], ["e_tsuki", "w_tsuki"],
    ["e_zankoku_karaoke", "w_zankoku"], ["e_tsuki_karaoke", "w_tsuki"], ["e_zankyo", "w_zankyo"], ["e_asa", "w_asa"],
    ["e_zankyo_inst", "w_zankyo"], ["e_asa_inst", "w_asa"], ["e_zankyo_tv", "w_zankyo"], ["e_asa_tv", "w_asa"],
    ["e_kny_ep1", "w_kny"], ["e_eva_ep1", "w_eva"]]) {
    exprWork[E[key].id] = E[workKey].id;
    const back = await camp.getEntity(E[key].id);
    check("expression 归属 " + key, back.work_id === E[workKey].id, "work_id=" + back.work_id);
  }
  const cuKny = await camp.getEntity(E.cu_kny1.id);
  const exKny = await camp.getEntity(E.e_kny_ep1.id);
  check("创作链 鬼滅の刃：expression.content_unit_id 指向同 Work 篇目",
    cuKny.work_id === E.w_kny.id && exKny.content_unit_id === E.cu_kny1.id && exKny.work_id === cuKny.work_id,
    "cu.work=" + cuKny.work_id + " expr.cu=" + exKny.content_unit_id + " expr.work=" + exKny.work_id);
  const cuEva = await camp.getEntity(E.cu_eva1.id);
  const exEva = await camp.getEntity(E.e_eva_ep1.id);
  check("创作链 新世紀エヴァンゲリオン：expression.content_unit_id 指向同 Work 篇目",
    cuEva.work_id === E.w_eva.id && exEva.content_unit_id === E.cu_eva1.id && exEva.work_id === cuEva.work_id,
    "cu.work=" + cuEva.work_id + " expr.cu=" + exEva.content_unit_id);

  // 3) track.contents 引用 + release.subjects 覆盖引用表达所属的全部 Work
  for (const plan of RELEASE_PLAN) {
    const rel = await camp.getEntity(E[plan.key].id);
    const declared = new Set((rel.subjects || []).map((s) => s.work_id));
    const wantSubjects = new Set(plan.subjects.map(([w]) => E[w].id));
    check("release.subjects 齐备 " + plan.key,
      wantSubjects.size === declared.size && [...wantSubjects].every((w) => declared.has(w)),
      "declared=" + [...declared].length + " want=" + wantSubjects.size);

    let trackCount = 0;
    const coveredWorks = new Set();
    for (const mp of plan.mediums) {
      const tr = await client.call("/api/catalog/entities?kind=track&medium_id=" + E[mp.key].id + "&limit=50");
      const tracks = ((tr.body && tr.body.items) || []).filter((t) => t.medium_id === E[mp.key].id);
      for (const t of tracks) {
        trackCount++;
        const contents = t.contents || [];
        check("track.contents 非空 " + plan.key + "/" + mp.key + "/#" + t.position, contents.length >= 1, "contents=" + contents.length);
        for (const c of contents) {
          const exp = await camp.getEntity(c.expression_id);
          coveredWorks.add(exp.work_id);
          check("track.contents 引用表达同 Work 声明（" + exp.title + "）", declared.has(exp.work_id),
            "expr.work=" + exp.work_id + " declared=" + [...declared].join(","));
        }
      }
    }
    check("medium/track 数量 " + plan.key, trackCount === plan.mediums.reduce((n, m) => n + m.tracks.length, 0),
      "tracks=" + trackCount);
    check("subjects 覆盖全部被引用 Work " + plan.key, [...coveredWorks].every((w) => declared.has(w)),
      "covered=" + coveredWorks.size + " declared=" + declared.size);
  }

  // 4) 关系两端
  const relsBySource = {};
  for (const [type, srcKey, tgtKey, attributes] of RELS) {
    const sid = E[srcKey].id;
    relsBySource[sid] = relsBySource[sid] || [];
    relsBySource[sid].push({ type, target: E[tgtKey].id, attributes, label: srcKey + "→" + tgtKey });
  }
  for (const sid of Object.keys(relsBySource)) {
    const items = await client.relationsOf(sid);
    for (const want of relsBySource[sid]) {
      const hit = items.find((x) => x.type === want.type && x.target_id === want.target);
      check("关系两端 " + want.type + " " + want.label, !!hit, hit ? "id=" + hit.id : "not found");
    }
  }

  // 5) revisions：每个新建实体至少一条修订
  let revOk = 0;
  for (const c of created) {
    const r = await client.call("/api/catalog/entities/" + c.id + "/revisions");
    const n = ((r.body && r.body.items) || []).length;
    if (n >= 1) revOk++;
    else check("revisions " + c.key, false, "status=" + r.status + " n=" + n);
  }
  check("所有新建实体均有修订记录", revOk === created.length, revOk + "/" + created.length);
}

const out = camp.summary({ entities: created.length, relations: RELS.length, problems });
if (problems.length) {
  console.log("\n断言失败 " + problems.length + " 项：");
  for (const p of problems) console.log("  - " + p.name + (p.detail ? " — " + p.detail : ""));
  process.exitCode = 1;
}
