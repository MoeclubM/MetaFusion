#!/usr/bin/env node
// 编目战役领域 16：游戏原声 BOX（多盘多作品）
//
// 两个真实存在的多盘盒装（字段逐条可回溯到官方商品页 / MusicBrainz / 维基）：
//   A. NieR:Automata / NieR Gestalt & Replicant Original Soundtrack Vinyl Set
//      2017-12-20 · SQEX-10614~10617 · 4×12" Vinyl · 一个 BOX 跨两部游戏作品
//   B. CHRONO ORCHESTRA Arrangement BOX
//      2019-09-04 · SQEX-10727~10729 · 3×CD · 跨 Chrono Trigger / Chrono Cross + BOX 限定 Piano Duo 盘
//
// 两条链都要走满：
//   创作链  song Work → ContentUnit（曲目篇目） → Expression（该盘面/该编曲的录音，挂 content_unit_id）
//   承载链  album Work → Release（boxset，多 subjects） → Medium×N → Track → contents[Expression]
//
// 拿不到证据的字段（ISRC、店舗特典实物、黑胶 A/B 面号等）一律留空，缺口写进
// docs-local/data-campaign/logs/game-ost-boxset-report.md，不编造。
//
// 用法：
//   node scripts/data/campaign/domains/game-ost-boxset.mjs --dry-run   # 空跑，只打计划
//   node scripts/data/campaign/domains/game-ost-boxset.mjs             # 真写入 + 回读断言

import { Campaign, Client, Index, src, DRY } from "../lib.mjs";

const DOMAIN = "game-ost-boxset";
const K = (s) => DOMAIN + "-" + s;

// ─────────────────────────────────────────────── 证据来源
const S = {
  seNierJp: src("https://www.jp.square-enix.com/music/lineup/item/SQEX-10614-7.html",
    "SQUARE ENIX MUSIC 官方商品页（日文）「NieR:Automata / NieR Gestalt & Replicant Original Soundtrack Vinyl Set」：明示由「NieR:Automata Original Soundtrack Vinyl」与「NieR Gestalt & Replicant Original Soundtrack Vinyl」组成ボックスセット；发售日 2017.12.20、价格 ¥7,920；Disc1–Disc4 官方日文曲目表（本批 5 曲的题名与盘内序号）"),
  seNierEn: src("https://www.jp.square-enix.com/music/en/lineup/item/SQEX-10614-7.html",
    "同一官方商品页英文版：Disc2 #7「Weight of the World English Version - J'Nique Nicole」给出演唱署名；Disc4 #9 收「Ashes of Dreams / New」"),
  mbNier: src("https://musicbrainz.org/release/e3143995-0a05-4a94-8618-951ca06130ca",
    "MusicBrainz 发行条目「NieR:Automata / NieR Gestalt & Replicant Original Soundtrack Vinyl Box Set」：品番 SQEX-10614~10617、条码 4988601465793、2017-12-20、JP、4×12 英寸 Vinyl；各盘标题（NieR:Automata Original Soundtrack Vinyl / NieR: Gestalt & Replicant Original Soundtrack Vinyl）与逐曲秒数、逐曲作曲署名（Keiichi Okabe / Keigo Hoashi）"),
  sonyNier: src("https://www.sonymusicshop.jp/m/item/itemShw.php?dS2SPH=1&cd=SQEX000011185",
    "Sony Music Shop 商品页（2025 复刻版 SQEX-11185）：「2017年に完全限定生産商品として発売された『NieR:Automata / NieR Gestalt & Replicant Original Soundtrack Vinyl Set』が新たなパッケージとなって復活」——佐证 2017 原始版为完全限定生産"),
  mbChrono: src("https://musicbrainz.org/release/4d88a11e-4ccc-4e61-ad54-1b305dd7613c",
    "MusicBrainz 发行条目「CHRONO ORCHESTRA Arrangement BOX」：品番 SQEX 10727 / 10728 / 10729、条码 4988601467247、2019-09-04、JP、3×CD；三盘标题（CHRONO TRIGGER Orchestral Arrangement / CHRONO CROSS Orchestral Arrangement / CHRONO SPECIAL DISC 〜Piano Duo〜）与逐曲秒数"),
  cdjChrono: src("https://www.cdjapan.co.jp/product/SQEX-10727",
    "CDJapan 商品页（SQEX-10727）：Box release of the simultaneously released CDs: CHRONO TRIGGER Orchestral Arrangement and CHRONO CROSS Orchestral Arrangement … Box edition comes with newly arranged CD；Number of Discs 3；Credits: SQUARE ENIX / Yasunori Mitsuda"),
  psnineChrono: src("https://psnine.com/gene/40534",
    "曲目与署名表（转载自官方/门店页）：原作曲＆监修 光田康典；逐曲编曲署名（予感 / クロノ・トリガー = 山下康介；時の回廊 / サラのテーマ = マリアム・アボンナサー；CHRONO CROSS 〜時の傷痕〜 = マリアム・アボンナサー）；演奏 東京フィルハーモニー交響楽団、指挥 佐々木新平；CHRONO SPECIAL DISC ~Piano Duo~ 编曲/演奏 森下唯・伊賀拓郎・野口明生・谷岡久美"),
  seChronoConcert: src("https://www.jp.square-enix.com/music/sem/page/chrono/concert/",
    "SQUARE ENIX 官方公演页「CHRONO ORCHESTRA 時を渡る翼 CHRONO TRIGGER & CHRONO CROSS」：2019-10-27 横滨公演 演奏 東京フィルハーモニー交響楽団、指挥 佐々木新平、トークゲスト 光田康典（佐证发行盘的演奏/指挥署名）"),
  wikiAutomata: src("https://en.wikipedia.org/wiki/Nier:_Automata",
    "Music and sound design 段：作曲 Keiichi Okabe 与 Monaca 成员 Keigo Hoashi / Kuniyuki Takahashi / Kakeru Ishihama；Emi Evans、J'Nique Nicole 等演唱；NieR:Automata Original Soundtrack 2017-03-29 发行"),
  wikiMusicNier: src("https://en.wikipedia.org/wiki/Music_of_Nier",
    "Nier（2010）OST 由 Emi Evans 担任演唱，「Ashes of Dreams」英文版歌词由 Evans 译写；NieR:Automata 音乐由 Okabe 与 Monaca 团队作曲、Emi Evans / J'Nique Nicole / Nami Nakagawa 演唱"),
  wikiOkabe: src("https://en.wikipedia.org/wiki/Keiichi_Okabe",
    "岡部啓一 2004 年设立音乐制作工作室 Monaca（用于 created_by 署名）"),
  wikiMitsuda: src("https://en.wikipedia.org/wiki/Yasunori_Mitsuda",
    "光田康典为 Chrono Trigger / Chrono Cross 作曲（用于 soundtrack_of 与 composed_by）"),
};

// ─────────────────────────────────────────────── 工具

/** 四语翻译：没有官方译名时按 BRIEF「该语种填原文题名即可」，绝不机翻或臆造。 */
function L4(main, alt = {}) {
  const map = { "ja-JP": main, "en-US": alt.en || main, "zh-CN": alt.zhCN || main, "zh-TW": alt.zhTW || main };
  const out = {};
  for (const loc of ["zh-CN", "zh-TW", "en-US", "ja-JP"]) {
    out[loc] = { title: map[loc] };
    if (alt.aliases && alt.aliases[loc]) out[loc].aliases = alt.aliases[loc];
  }
  return out;
}

// ─────────────────────────────────────────────── 数据表

const AGENTS = [
  { key: "okabe", title: "岡部啓一", lang: "ja", en: "Keiichi Okabe", types: ["person"],
    note: "音乐署名者 agent（person）「岡部啓一 / Keiichi Okabe」：NieR 系列与 NieR:Automata 的首席作曲者，本批两部盒装里 NieR 侧曲目的作曲者",
    sources: [S.wikiOkabe, S.wikiAutomata, S.mbNier] },
  { key: "hoashi", title: "帆足圭吾", lang: "ja", en: "Keigo Hoashi", types: ["person"],
    note: "音乐署名者 agent（person）「帆足圭吾 / Keigo Hoashi」：Monaca 成员，NieR:Automata 作曲之一（本批 Disc1 #5「遊園施設」作曲）",
    sources: [S.wikiAutomata, S.mbNier] },
  { key: "mitsuda", title: "光田康典", lang: "ja", en: "Yasunori Mitsuda", types: ["person"],
    note: "音乐署名者 agent（person）「光田康典 / Yasunori Mitsuda」：Chrono Trigger / Chrono Cross 的原作曲者，也是 CHRONO ORCHESTRA 的作曲＆监修",
    sources: [S.wikiMitsuda, S.cdjChrono, S.psnineChrono] },
  { key: "evans", title: "Emi Evans", lang: "en", aliases: { "en-US": ["Emiko Rebecca Evans"] }, types: ["person"],
    note: "演唱者 agent（person）「Emi Evans」：Nier（2010）与 NieR:Automata 系列的人声演唱者，「Ashes of Dreams」英文版由其演唱并译写英文歌词",
    sources: [S.wikiMusicNier, S.wikiAutomata] },
  { key: "nicole", title: "J'Nique Nicole", lang: "en", types: ["person"],
    note: "演唱者 agent（person）「J'Nique Nicole」：官方商品页在 Disc2 #7 直接署名其为「Weight of the World English Version」的演唱者",
    sources: [S.seNierEn, S.wikiMusicNier] },
  { key: "sem", title: "SQUARE ENIX MUSIC", lang: "ja", aliases: { "ja-JP": ["スクウェア・エニックス ミュージック"] }, types: ["organization"],
    note: "发行方 agent（organization）「SQUARE ENIX MUSIC」：两部盒装的厂牌/发行 imprint（MusicBrainz label 与 CDJapan Credits 均为 SQUARE ENIX）",
    sources: [S.mbNier, S.mbChrono, S.cdjChrono] },
  { key: "monaca", title: "Monaca", lang: "ja", aliases: { "ja-JP": ["MONACA"] }, types: ["organization"],
    note: "制作团体 agent（organization）「Monaca」：岡部啓一设立的音乐制作工作室，NieR 系列配乐的制作团队",
    sources: [S.wikiOkabe, S.wikiAutomata] },
  { key: "yamashita", title: "山下康介", lang: "ja", types: ["person"],
    note: "编曲者 agent（person）「山下康介」：CHRONO TRIGGER Orchestral Arrangement 第 1 曲「予感 / クロノ・トリガー」的编曲者",
    sources: [S.psnineChrono] },
  { key: "abounnasr", title: "マリアム・アボンナサー", lang: "ja", en: "Mariam Abounnasr", types: ["person"],
    note: "编曲者 agent（person）「マリアム・アボンナサー / Mariam Abounnasr」：本批 Chrono 侧「時の回廊 / サラのテーマ」「CHRONO CROSS 〜時の傷痕〜」的编曲者",
    sources: [S.psnineChrono] },
  { key: "iga", title: "伊賀拓郎", lang: "ja", types: ["person"],
    note: "编曲/演奏者 agent（person）「伊賀拓郎」：BOX 限定盘 CHRONO SPECIAL DISC 〜Piano Duo〜 的编曲与钢琴演奏者（サラのテーマ / クロノ・トリガー 两曲）",
    sources: [S.psnineChrono] },
  { key: "tpo", title: "東京フィルハーモニー交響楽団", lang: "ja", en: "Tokyo Philharmonic Orchestra", types: ["group"],
    note: "演奏团体 agent（group）「東京フィルハーモニー交響楽団」：官方公演页载明横滨公演由其演奏、佐々木新平指挥；CHRONO ORCHESTRA 发行盘即该编曲的演奏团体",
    sources: [S.seChronoConcert, S.psnineChrono] },
  { key: "sasaki", title: "佐々木新平", lang: "ja", types: ["person"],
    note: "指挥 agent（person）「佐々木新平」：CHRONO ORCHESTRA 公演与发行盘的指挥",
    sources: [S.seChronoConcert, S.psnineChrono] },
];

const GAMES = [
  { key: "nier-automata", title: "NieR:Automata", lang: "ja", en: "NieR:Automata", types: ["indie_game"],
    tags: ["video game", "action RPG", "2017"],
    note: "游戏创作母体：NieR:Automata（2017，PlatinumGames / SQUARE ENIX）建为 work；本批 Vinyl Set 的 Disc1–Disc2 即该作原声的黑胶版本。注：work 类型词表只有 indie_game 一个游戏码，本作为商业主机游戏，按战役 BRIEF 第 15 行口径以 indie_game 承载（缺口记入报告）",
    sources: [S.wikiAutomata, S.seNierJp, S.mbNier] },
  { key: "nier-replicant", title: "NieR Replicant", lang: "ja", en: "NieR Replicant", types: ["indie_game"],
    tags: ["video game", "action RPG", "2010"],
    note: "游戏创作母体「NieR Replicant」（2010，PS3 日版；Xbox 360 版为 NieR Gestalt，音乐共用）建为 work；本批 Vinyl Set 的 Disc3–Disc4 收录其原声。类型码同样只有 indie_game 可用",
    sources: [S.wikiMusicNier, S.seNierJp, S.mbNier] },
  { key: "chrono-trigger", title: "クロノ・トリガー", lang: "ja", en: "Chrono Trigger", types: ["indie_game"],
    tags: ["video game", "RPG", "1995"],
    note: "游戏创作母体「クロノ・トリガー / Chrono Trigger」（1995，SQUARE）建为 work；CHRONO ORCHESTRA Arrangement BOX 的 Disc1 为其管弦编曲。类型码同样只有 indie_game 可用",
    sources: [S.wikiMitsuda, S.cdjChrono, S.mbChrono] },
  { key: "chrono-cross", title: "クロノ・クロス", lang: "ja", en: "Chrono Cross", types: ["indie_game"],
    tags: ["video game", "RPG", "1999"],
    note: "游戏创作母体「クロノ・クロス / Chrono Cross」（1999，SQUARE）建为 work；盒装 Disc2 为其管弦编曲",
    sources: [S.wikiMitsuda, S.cdjChrono, S.mbChrono] },
];

const BOXES = [
  {
    key: "nier",
    release: {
      title: "NieR:Automata / NieR Gestalt & Replicant Original Soundtrack Vinyl Set",
      lang: "ja",
      catalog_number: "SQEX-10614~10617",
      barcode: "4988601465793",
      date: "2017-12-20",
      country: "JP",
      editionType: "boxset",
      editionBatch: "first_press",
      packaging: "boxset",
      note: "官方日文商品页明确为「两张 LP 组成的ボックスセット」：2017-12-20 发行、品番 SQEX-10614~10617、条码 4988601465793；subjects 声明盒内两张专辑（各 primary）与 Track contents 引用的全部曲目 Work（compilation）",
      sources: [S.seNierJp, S.mbNier, S.sonyNier],
    },
    albums: [
      { key: "automata-ost", title: "NieR:Automata Original Soundtrack", lang: "ja", en: "NieR:Automata Original Soundtrack",
        game: "nier-automata", tags: ["game music", "original soundtrack"],
        note: "album Work「NieR:Automata Original Soundtrack」：2017-03-29 发行的该作原声母体；本批 Vinyl Set 的 Disc1–Disc2 是其黑胶版（同名 LP）",
        sources: [S.wikiAutomata, S.seNierJp, S.mbNier] },
      { key: "gr-ost", title: "NieR Gestalt & Replicant Original Soundtrack", lang: "ja", en: "NieR Gestalt & Replicant Original Soundtrack",
        game: "nier-replicant", tags: ["game music", "original soundtrack"],
        note: "album Work「NieR Gestalt & Replicant Original Soundtrack」：2010 年 NieR Gestalt / Replicant 的原声母体；本批 Vinyl Set 的 Disc3–Disc4 是其黑胶版",
        sources: [S.wikiMusicNier, S.seNierJp, S.mbNier] },
    ],
    media: [
      { n: 1, title: "NieR:Automata Original Soundtrack Vinyl（Disc 1）", catalog: "SQEX-10614", format: "vinyl", album: "automata-ost" },
      { n: 2, title: "NieR:Automata Original Soundtrack Vinyl（Disc 2）", catalog: "SQEX-10615", format: "vinyl", album: "automata-ost" },
      { n: 3, title: "NieR: Gestalt & Replicant Original Soundtrack Vinyl（Disc 1）", catalog: "SQEX-10616", format: "vinyl", album: "gr-ost" },
      { n: 4, title: "NieR: Gestalt & Replicant Original Soundtrack Vinyl（Disc 2）", catalog: "SQEX-10617", format: "vinyl", album: "gr-ost" },
    ],
    tracks: [
      { key: "n1", work: "遺サレタ場所／斜光", title: "遺サレタ場所／斜光", lang: "ja", en: "City Ruins - Rays of Light",
        medium: 1, pos: 1, dur: 375, composer: "okabe", album: "automata-ost" },
      { key: "n2", work: "遊園施設", title: "遊園施設", lang: "ja", en: "Amusement Park",
        medium: 1, pos: 5, dur: 372, composer: "hoashi", album: "automata-ost" },
      { key: "n3", work: "Weight of the World", title: "Weight of the World／English Version", lang: "en", en: "Weight of the World English Version",
        medium: 2, pos: 7, dur: 335, composer: "okabe", album: "automata-ost", version: "English Version",
        performer: "nicole", perfRole: "vocal" },
      { key: "n4", work: "イニシエノウタ／デボル", title: "イニシエノウタ／デボル", lang: "ja", en: "Song of the Ancients / Devola",
        medium: 3, pos: 3, dur: 182, composer: "okabe", album: "gr-ost" },
      { key: "n5", work: "Ashes of Dreams", title: "Ashes of Dreams ／ English Version", lang: "en", en: "Ashes of Dreams English Version",
        medium: 4, pos: 9, dur: 372, composer: "okabe", album: "gr-ost", version: "English Version",
        performer: "evans", perfRole: "vocal" },
    ],
  },
  {
    key: "chrono",
    release: {
      title: "CHRONO ORCHESTRA Arrangement BOX",
      lang: "ja",
      catalog_number: "SQEX-10727~10729",
      barcode: "4988601467247",
      date: "2019-09-04",
      country: "JP",
      editionType: "boxset",
      editionBatch: "first_press",
      packaging: "boxset",
      note: "CDJapan/官方口径：BOX = 同时发售的「CHRONO TRIGGER Orchestral Arrangement」「CHRONO CROSS Orchestral Arrangement」两盘 CD + BOX 限定新规编曲盘「CHRONO SPECIAL DISC 〜Piano Duo〜」；2019-09-04 发行、品番 SQEX-10727~10729、条码 4988601467247",
      sources: [S.cdjChrono, S.mbChrono, S.seChronoConcert],
    },
    albums: [
      { key: "ct-orch", title: "CHRONO TRIGGER Orchestral Arrangement", lang: "ja", en: "CHRONO TRIGGER Orchestral Arrangement",
        game: "chrono-trigger", tags: ["game music", "orchestral arrangement"],
        note: "album Work「CHRONO TRIGGER Orchestral Arrangement」：2019-09-04 发行的クロノ・トリガー管弦编曲专辑（可单独购买），作曲＆监修 光田康典",
        sources: [S.cdjChrono, S.mbChrono, S.psnineChrono] },
      { key: "cc-orch", title: "CHRONO CROSS Orchestral Arrangement", lang: "ja", en: "CHRONO CROSS Orchestral Arrangement",
        game: "chrono-cross", tags: ["game music", "orchestral arrangement"],
        note: "album Work「CHRONO CROSS Orchestral Arrangement」：2019-09-04 发行的クロノ・クロス管弦编曲专辑（可单独购买），作曲＆监修 光田康典",
        sources: [S.cdjChrono, S.mbChrono, S.psnineChrono] },
    ],
    media: [
      { n: 1, title: "CHRONO TRIGGER Orchestral Arrangement", catalog: "SQEX-10727", format: "cd", album: "ct-orch" },
      { n: 2, title: "CHRONO CROSS Orchestral Arrangement", catalog: "SQEX-10728", format: "cd", album: "cc-orch" },
      { n: 3, title: "CHRONO SPECIAL DISC 〜Piano Duo〜", catalog: "SQEX-10729", format: "cd", album: null },
    ],
    tracks: [
      { key: "c1", work: "予感 / クロノ・トリガー", title: "予感 / クロノ・トリガー", lang: "ja", en: "Premonition / Chrono Trigger",
        medium: 1, pos: 1, dur: 161, composer: "mitsuda", arranger: "yamashita", album: "ct-orch" },
      { key: "c2", work: "時の回廊 / サラのテーマ", title: "時の回廊 / サラのテーマ", lang: "ja", en: "Corridors of Time / Schala's Theme",
        medium: 1, pos: 7, dur: 444, composer: "mitsuda", arranger: "abounnasr", album: "ct-orch" },
      { key: "c3", work: "CHRONO CROSS 〜時の傷痕〜", title: "CHRONO CROSS 〜時の傷痕〜", lang: "ja", en: "CHRONO CROSS -Scars of Time-",
        medium: 2, pos: 1, dur: 153, composer: "mitsuda", arranger: "abounnasr", album: "cc-orch" },
      { key: "c4", work: "サラのテーマ", title: "サラのテーマ (Piano Duo ver)", lang: "ja", en: "Schala's Theme (Piano Duo ver)",
        medium: 3, pos: 2, dur: 411, composer: "mitsuda", version: "Piano Duo", arranger: "iga", performedBy: "iga", perfRole: "piano",
        bonus: true, bonusNote: "BOX 限定盘曲目（CHRONO SPECIAL DISC 〜Piano Duo〜，单独发行的两张编曲专辑不含此盘）", album: null },
      { key: "c5", work: "クロノ・トリガー（メインテーマ）", workEn: "Chrono Trigger", title: "クロノ・トリガー (Piano Duo ver)", lang: "ja", en: "Chrono Trigger (Piano Duo ver)",
        medium: 3, pos: 4, dur: 375, composer: "mitsuda", version: "Piano Duo", performedBy: "iga", perfRole: "piano",
        workNote: "题名加「（メインテーマ）」是编目侧消歧：本曲的音乐母体与同名游戏作品（本批另建的 Work「クロノ・トリガー」/ indie_game）必须是两个 Work，否则按题名查重会被合并（见报告 §5.2）",
        bonus: true, bonusNote: "BOX 限定盘曲目（CHRONO SPECIAL DISC 〜Piano Duo〜，单独发行的两张编曲专辑不含此盘）", album: null },
    ],
  },
];

const SONG_SRC = [S.mbNier, S.seNierJp];
const CHRONO_SRC = [S.mbChrono, S.psnineChrono, S.cdjChrono];

// ─────────────────────────────────────────────── 主流程

const client = new Client();
await client.login();
const camp = new Campaign({ domain: DOMAIN, client, index: Index.load() });

const ENT = new Map();       // key -> 实体
const CREATED = [];          // 回读断言用
const EXPECT_REL = [];       // 关系回读断言用

async function make(key, kind, title, spec, ev, idem, opts = {}) {
  const e = await camp.ensureEntity(kind, title, spec, ev, {
    idemKey: K(idem),
    scope: opts.scope || {},
    allowServerLookup: true,
  });
  ENT.set(key, e);
  CREATED.push({ key, kind, title, id: e.id, expect: opts.expect || {} });
  return e;
}

async function rel(type, sourceKey, targetKey, note, sources, attributes = {}) {
  const s = ENT.get(sourceKey), t = ENT.get(targetKey);
  if (!s || !t) throw new Error("关系端点缺失：" + sourceKey + " → " + targetKey);
  const r = await camp.createRelation(type, s.id, t.id, { note, sources }, { attributes, skipIfExists: !DRY });
  EXPECT_REL.push({ type, sourceKey, targetKey, relId: r.id });
  return r;
}

const AG = (k) => ENT.get("agent:" + k);
const idOf = (key) => { const e = ENT.get(key); return e ? e.id : null; };

// —— 1. agents
for (const a of AGENTS) {
  await make("agent:" + a.key, "agent", a.title, {
    original_language: a.lang,
    types: a.types,
    translations: L4(a.title, { en: a.en, aliases: a.aliases }),
    external_ids: {},
  }, { note: a.note, sources: a.sources }, "agent-" + a.key);
}

// —— 2. 游戏创作母体
for (const g of GAMES) {
  await make("game:" + g.key, "work", g.title, {
    original_language: g.lang,
    types: g.types,
    attributes: { tags: g.tags },
    translations: L4(g.title, { en: g.en }),
    external_ids: {},
  }, { note: g.note, sources: g.sources }, "work-" + g.key);
}

// —— 3. 逐盒装：专辑 Work → 曲目 Work/篇目/表达 → Release → Medium → Track
for (const box of BOXES) {
  const bx = box.key;
  const srcSet = bx === "chrono" ? CHRONO_SRC : SONG_SRC;

  for (const al of box.albums) {
    await make("album:" + al.key, "work", al.title, {
      original_language: al.lang,
      types: ["album"],
      attributes: { tags: al.tags },
      translations: L4(al.title, { en: al.en }),
      external_ids: {},
    }, { note: al.note, sources: al.sources }, "album-" + al.key);
  }

  for (const t of box.tracks) {
    const sw = await make("song:" + bx + ":" + t.key, "work", t.work, {
      original_language: t.lang,
      types: [t.version ? "music" : (t.performer ? "song" : "music")],
      attributes: { tags: ["game music"].concat(bx === "chrono" && t.version ? ["arrangement"] : []) },
      translations: L4(t.work, { en: t.workEn || t.en }),
      external_ids: {},
    }, {
      note: "编目：盒装《" + box.release.title + "》Disc" + t.medium + " 第 " + t.pos + " 曲「" + t.title + "」的创作母体（曲目 Work）：作曲 " + AG(t.composer).title
        + (t.arranger ? "、编曲 " + AG(t.arranger).title : "")
        + "；发行内位置由 Track/Medium 承载，本 Work 只留纯净曲名"
        + (t.workNote ? "；" + t.workNote : ""),
      sources: srcSet,
    }, "work-" + bx + "-" + t.key);

    const cu = await make("cu:" + bx + ":" + t.key, "content_unit", t.title, {
      work_id: sw.id,
      position: t.pos,
      number: String(t.pos),
      original_language: t.lang,
      types: ["content_unit"],
      attributes: { language: t.lang, entry_role: "main" },
      translations: L4(t.title, { en: t.en }),
      external_ids: {},
    }, {
      note: "编目：曲目 Work「" + t.work + "」的篇目（ContentUnit）——该曲在盒内第 " + t.medium + " 盘第 " + t.pos + " 位，position/number 取盘内曲序；parent 留空（该 Work 只有一个篇目）",
      sources: srcSet,
    }, "cu-" + bx + "-" + t.key, { scope: { work_id: sw.id }, expect: { work_id: sw.id, position: t.pos } });

    await make("expr:" + bx + ":" + t.key, "expression", t.title, {
      work_id: sw.id,
      content_unit_id: cu.id,
      original_language: t.lang,
      types: ["expression"],
      attributes: Object.assign({ language: t.lang, duration: t.dur }, t.version ? { version_label: t.version } : {}),
      translations: L4(t.title, { en: t.en }),
      external_ids: {},
    }, {
      note: "编目：曲目「" + t.title + "」在盒装《" + box.release.title + "》里的录音表达（Expression），content_unit_id 挂到该曲目篇目；时长 " + t.dur + " 秒取自 MusicBrainz 实测曲目表"
        + (t.version ? "；version_label「" + t.version + "」对应本盘的编曲版本" : "")
        + (t.bonus ? "；" + t.bonusNote : ""),
      sources: srcSet,
    }, "expr-" + bx + "-" + t.key, { scope: { work_id: sw.id }, expect: { work_id: sw.id, content_unit_id: cu.id } });
  }

  // Release：subjects = 盒内专辑（primary）+ 被 Track contents 引用的全部曲目 Work（compilation）
  const subjects = [];
  box.albums.forEach((al, i) => subjects.push({ work_id: idOf("album:" + al.key), role: "primary", position: i }));
  box.tracks.forEach((t, i) => subjects.push({ work_id: idOf("song:" + bx + ":" + t.key), role: "compilation", position: box.albums.length + i }));

  const relEnt = await make("release:" + bx, "release", box.release.title, {
    original_language: box.release.lang,
    types: ["release"],
    attributes: {
      catalog_number: box.release.catalog_number,
      barcode: box.release.barcode,
      edition_date: box.release.date,
      edition_type: box.release.editionType,
      edition_batch: box.release.editionBatch,
      country: box.release.country,
      publisher: AG("sem").id,
      packaging: box.release.packaging,
      distribution_channel: "physical",
    },
    translations: L4(box.release.title, {}),
    external_ids: {},
    subjects,
  }, {
    note: "编目：盒装发行（Release）「" + box.release.title + "」——" + box.release.note,
    sources: box.release.sources,
  }, "release-" + bx, { expect: { subjects: subjects.map((s) => s.work_id) } });

  for (const m of box.media) {
    await make("medium:" + bx + ":" + m.n, "medium", m.title, {
      release_id: relEnt.id,
      position: m.n,
      number: String(m.n),
      original_language: "ja",
      types: ["medium"],
      attributes: { format: m.format, role: "primary", catalog_number: m.catalog },
      translations: L4(m.title, {}),
      external_ids: {},
    }, {
      note: "编目：《" + box.release.title + "》的第 " + m.n + " 张盘（Medium）：载体 " + m.format + "、品番 " + m.catalog
        + (m.album ? "；盘名与盒内专辑「" + box.albums.find((a) => a.key === m.album).title + "」同名，靠 position/number 与题名后缀区分" : "；BOX 限定盘，没有对应的单独发行专辑"),
      sources: box.release.sources,
    }, "medium-" + bx + "-" + m.n, { scope: { release_id: relEnt.id }, expect: { release_id: relEnt.id, position: m.n } });
  }

  for (const t of box.tracks) {
    const medId = idOf("medium:" + bx + ":" + t.medium);
    const exId = idOf("expr:" + bx + ":" + t.key);
    await make("track:" + bx + ":" + t.key, "track", t.title, {
      medium_id: medId,
      position: t.pos,
      number: String(t.pos),
      original_language: t.lang,
      types: ["track"],
      attributes: { role: t.bonus ? "supplement" : "primary", duration: t.dur },
      translations: L4(t.title, { en: t.en }),
      external_ids: {},
      contents: [{ expression_id: exId, position: 1, locator: null }],
    }, {
      note: "编目：《" + box.release.title + "》Disc" + t.medium + " 第 " + t.pos + " 轨「" + t.title + "」——载体位置项（Track）；contents 引用该曲在本次发行里的 Expression（整轨收录，locator 留空）",
      sources: srcSet,
    }, "track-" + bx + "-" + t.key, {
      scope: { medium_id: medId },
      expect: { medium_id: medId, position: t.pos, contents: [exId] },
    });
  }

  // 专辑 → 游戏、专辑 → 制作团体、发行 → 厂牌
  for (const al of box.albums) {
    await rel("soundtrack_of", "album:" + al.key, "game:" + al.game,
      "编目：《" + al.title + "》是游戏作品「" + ENT.get("game:" + al.game).title + "」的原声/管弦编曲专辑",
      al.sources, {});
  }
  await rel("created_by", "release:" + bx, "agent:sem",
    "编目：盒装发行《" + box.release.title + "》的发行方为 SQUARE ENIX MUSIC",
    box.release.sources, { credit_role: "label" });
}

// —— 4. 署名/特典关系
for (const box of BOXES) {
  const bx = box.key;
  for (const t of box.tracks) {
    await rel("composed_by", "song:" + bx + ":" + t.key, "agent:" + t.composer,
      "编目：曲目「" + t.work + "」的作曲署名 " + AG(t.composer).title
        + (bx === "nier" ? "（MusicBrainz 逐曲作曲署名）" : "（原作曲＆监修 光田康典）"),
      bx === "nier" ? SONG_SRC : [S.psnineChrono, S.mbChrono, S.wikiMitsuda],
      { credit_role: "composer" });

    if (t.arranger) {
      const sourceKey = t.version ? "expr:" + bx + ":" + t.key : "song:" + bx + ":" + t.key;
      await rel("arranged_by", sourceKey, "agent:" + t.arranger,
        "编目：《" + box.release.title + "》Disc" + t.medium + "「" + t.title + "」的编曲署名 " + AG(t.arranger).title,
        [S.psnineChrono, S.cdjChrono], { credit_role: "arranger" });
    }
    if (t.performedBy) {
      await rel("performed_by", "expr:" + bx + ":" + t.key, "agent:" + t.performedBy,
        "编目：表达《" + t.title + "》的演奏署名 " + AG(t.performedBy).title + "（BOX 限定 Piano Duo 盘的钢琴演奏者）",
        [S.psnineChrono], { credit_role: t.perfRole });
    }
    if (t.performer) {
      await rel("performed_by", "expr:" + bx + ":" + t.key, "agent:" + t.performer,
        "编目：录音表达《" + t.title + "》的演唱署名 " + AG(t.performer).title
          + (t.key === "n3" ? "（官方商品页 Disc2 #7 直接署名）" : "（「Ashes of Dreams」英文版演唱者）"),
        t.key === "n3" ? [S.seNierEn, S.mbNier] : [S.wikiMusicNier, S.mbNier],
        { credit_role: t.perfRole });
    }
    if (t.bonus) {
      await rel("bonus_included_in", "expr:" + bx + ":" + t.key, "release:" + bx,
        "编目：《" + t.title + "》只作为 BOX 限定盘收录在《" + box.release.title + "》里，单独发行的两张编曲专辑不含此曲",
        [S.cdjChrono, S.psnineChrono], { role: "supplement" });
    }
  }
}
await rel("performed_by", "release:chrono", "agent:tpo",
  "编目：《CHRONO ORCHESTRA Arrangement BOX》的演奏团体为東京フィルハーモニー交響楽団（官方公演页载明横滨公演由其演奏）",
  [S.seChronoConcert, S.psnineChrono], { credit_role: "orchestra" });
await rel("credit_for", "release:chrono", "agent:sasaki",
  "编目：《CHRONO ORCHESTRA Arrangement BOX》的指挥为佐々木新平",
  [S.seChronoConcert, S.psnineChrono], { credit_role: "conductor" });

// ─────────────────────────────────────────────── 3b. 修复历史偏差（幂等：仅在检测到旧状态时动作）
//
// 背景：lib 的查重只按「kind + 精确题名」，曲目 Work「クロノ・トリガー」与游戏作品
// 「クロノ・トリガー」(indie_game) 同名，首轮写入被判为复用 → 该曲的篇目/表达曾挂在游戏作品下。
// 归属字段不可变（PUT 改不了 work_id），修复口径只能是「在新 Work 下重建 + 改 Track 引用 + 停用旧实体」。
// 顺序不能颠倒：先补 subjects（新 Work）→ 改 Track contents → 撤下旧 Work 的 subject → 停用旧实体；
// 反过来会撞 undeclared_release_subject。

const REPAIR = { legacy: [], gameWork: null, subjectsAdded: 0, subjectsRemoved: 0, repointed: [], edgesRemoved: [], retired: [], errors: [] };
const problems = [];
let checked = 0;

async function listBy(kind, param, id) {
  const r = await client.call("/api/catalog/entities?kind=" + kind + "&" + param + "=" + id + "&limit=50");
  return ((r.body || {}).items) || [];
}

if (!DRY) {
  const gameId = idOf("game:chrono-trigger");
  const newWorkId = idOf("song:chrono:c5");
  const newExprId = idOf("expr:chrono:c5");
  const relId = idOf("release:chrono");
  const legacyCus = gameId ? await listBy("content_unit", "work_id", gameId) : [];
  const legacyExprs = gameId ? await listBy("expression", "work_id", gameId) : [];
  if (legacyCus.length || legacyExprs.length) {
    REPAIR.gameWork = gameId;
    REPAIR.legacy = legacyExprs.map((x) => x.id).concat(legacyCus.map((x) => x.id));
    const legacyExprIds = new Set(legacyExprs.map((x) => x.id));
    const fixSources = [S.psnineChrono, S.mbChrono];
    console.log("\n=== 修复：把错挂在游戏作品下的篇目/表达迁到曲目 Work ===");
    // 第 1 步：release 先补新 Work 的 subject（旧 Work 暂留，Track 还没改指）
    let rel = await camp.getEntity(relId);
    let subjects = (rel.subjects || []).map((s) => ({ work_id: s.work_id, role: s.role, position: s.position }));
    if (!subjects.some((s) => s.work_id === newWorkId)) {
      subjects.push({ work_id: newWorkId, role: "compilation", position: subjects.length });
      await camp.updateEntity(relId, { subjects }, {
        note: "编目修复（第 1/5 步）：盒装《CHRONO ORCHESTRA Arrangement BOX》的 subjects 补入在新曲目 Work「クロノ・トリガー（メインテーマ）」下重建的收录声明（旧游戏作品的 subject 暂留，待 Track 改指后再撤）",
        sources: fixSources,
      });
      REPAIR.subjectsAdded = 1;
    }
    // 第 2 步：Track contents 改指新 Expression
    for (const m of await listBy("medium", "release_id", relId)) {
      for (const t of await listBy("track", "medium_id", m.id)) {
        if (!(t.contents || []).some((c) => legacyExprIds.has(c.expression_id))) continue;
        const full = await camp.getEntity(t.id);
        const contents = (full.contents || []).map((c) => ({
          expression_id: legacyExprIds.has(c.expression_id) ? newExprId : c.expression_id,
          position: c.position,
          locator: c.locator === undefined ? null : c.locator,
        }));
        await camp.updateEntity(t.id, { contents }, {
          note: "编目修复（第 2/5 步）：Track「" + full.title + "」的 contents 从旧 Expression 改指在新曲目 Work 下重建的 Expression",
          sources: fixSources,
        });
        REPAIR.repointed.push(t.id);
      }
    }
    // 第 3 步：旧 Work 已无 Track 引用 → 从 subjects 撤下（只保留「被 Track contents 引用」与盒内两张专辑）
    const keep = new Set([idOf("album:ct-orch"), idOf("album:cc-orch")]);
    for (const m of await listBy("medium", "release_id", relId)) {
      for (const t of await listBy("track", "medium_id", m.id)) {
        for (const c of t.contents || []) {
          const ex = (await client.call("/api/catalog/entities/" + c.expression_id)).body;
          if (ex && ex.work_id) keep.add(ex.work_id);
        }
      }
    }
    rel = await camp.getEntity(relId);
    const before = (rel.subjects || []).map((s) => ({ work_id: s.work_id, role: s.role }));
    const after = before.filter((s) => keep.has(s.work_id)).map((s, i) => ({ work_id: s.work_id, role: s.role, position: i }));
    if (after.length !== before.length) {
      await camp.updateEntity(relId, { subjects: after }, {
        note: "编目修复（第 3/5 步）：Track 已改指新 Expression，撤下同名游戏作品「クロノ・トリガー」在该盒装上的 compilation 声明（它与本盒装的关系由 album --soundtrack_of--> work 表达）",
        sources: fixSources,
      });
      REPAIR.subjectsRemoved = before.length - after.length;
    }
    // 第 4 步：删掉端点落在旧实体上的关系边（否则旧实体停用后，边会指向已删除实体）
    const legacyIdSet = new Set(REPAIR.legacy);
    for (const id of REPAIR.legacy) {
      const rr = await client.call("/api/catalog/entities/" + id + "/relations");
      for (const edge of ((rr.body || {}).items) || []) {
        if (!legacyIdSet.has(edge.source_id) && !legacyIdSet.has(edge.target_id)) continue;
        const del = await client.call("/api/catalog/relations/" + edge.id, {
          method: "DELETE",
          body: {
            expected_version: edge.version,
            edit_note: "编目修复（第 4/5 步）：删除以旧（错挂在游戏作品下的）表达为端点的关系边 " + edge.type + "，同义边已在新建的表达上重建",
            sources: fixSources.map((s) => ({ kind: s.kind, url: s.url, citation: s.citation })),
          },
        });
        if (del.status >= 400) {
          REPAIR.errors.push("删边失败 " + edge.id + " " + del.status + " " + JSON.stringify(del.body).slice(0, 160));
          problems.push("删除旧关系边失败：" + edge.type + " " + edge.id + " -> " + del.status);
        } else {
          REPAIR.edgesRemoved.push(edge.type + ":" + edge.id);
          console.log("  · relation | deleted | " + edge.type + " | " + edge.id);
        }
      }
    }
    // 第 5 步：停用旧 Expression / 旧篇目（owner 仍可直读，公开列表不可见）
    for (const x of legacyExprs.concat(legacyCus)) {
      const cur = await camp.getEntity(x.id);
      const r = await client.call("/api/catalog/entities/" + x.id + "/lifecycle", {
        method: "POST",
        body: {
          expected_version: cur.version,
          target_id: "",
          edit_note: "编目修复（第 5/5 步）：停用错挂在游戏作品 Work 下的旧" + (x.kind === "expression" ? "表达" : "篇目") + "「" + x.title + "」（已在新曲目 Work 下重建并改指，无任何 Track 再引用）",
          sources: fixSources.map((s) => ({ kind: s.kind, url: s.url, citation: s.citation })),
        },
      });
      if (r.status >= 400) {
        REPAIR.errors.push(x.kind + " " + x.id + " 停用失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
        problems.push("停用旧实体失败：" + x.kind + " " + x.id + " -> " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
      } else {
        REPAIR.retired.push(x.id);
        console.log("  · lifecycle | deleted | " + x.kind + " | " + x.title + " | " + x.id);
      }
    }
  }
}

// ─────────────────────────────────────────────── 写后回读断言

if (!DRY) {
  const seen = new Set();
  for (const rec of CREATED) {
    if (!rec.id || rec.id.startsWith("DRY-")) continue;
    if (seen.has(rec.key)) continue;
    seen.add(rec.key);
    const cur = await camp.getEntity(rec.id);
    checked++;
    const e = rec.expect || {};
    const label = rec.kind + "「" + rec.title + "」";
    if (cur.kind !== rec.kind) problems.push(label + " kind 不一致：期望 " + rec.kind + " 实际 " + cur.kind);
    if (e.work_id !== undefined && cur.work_id !== e.work_id) problems.push(label + " work_id 期望 " + e.work_id + " 实际 " + cur.work_id);
    if (e.content_unit_id !== undefined && cur.content_unit_id !== e.content_unit_id) problems.push(label + " content_unit_id 期望 " + e.content_unit_id + " 实际 " + cur.content_unit_id);
    if (e.release_id !== undefined && cur.release_id !== e.release_id) problems.push(label + " release_id 期望 " + e.release_id + " 实际 " + cur.release_id);
    if (e.medium_id !== undefined && cur.medium_id !== e.medium_id) problems.push(label + " medium_id 期望 " + e.medium_id + " 实际 " + cur.medium_id);
    if (e.position !== undefined && cur.position !== e.position) problems.push(label + " position 期望 " + e.position + " 实际 " + cur.position);
    if (e.subjects !== undefined) {
      const got = (cur.subjects || []).map((s) => s.work_id).sort();
      const want = e.subjects.slice().sort();
      if (got.length !== want.length || got.some((x, i) => x !== want[i])) {
        problems.push(label + " subjects 覆盖不足：期望 " + want.length + " 项，实际 " + got.length + " 项");
      }
    }
    if (e.contents !== undefined) {
      const got = (cur.contents || []).map((c) => c.expression_id);
      if (JSON.stringify(got) !== JSON.stringify(e.contents)) problems.push(label + " contents 期望 " + JSON.stringify(e.contents) + " 实际 " + JSON.stringify(got));
    }
    if (!(cur.version >= 1)) problems.push(label + " version/revision 缺失（version=" + cur.version + "）");
  }
}

let relChecked = 0;
if (!DRY) {
  const bySource = new Map();
  for (const r of EXPECT_REL) {
    if (!bySource.has(r.sourceKey)) bySource.set(r.sourceKey, []);
    bySource.get(r.sourceKey).push(r);
  }
  for (const [sourceKey, list] of bySource) {
    const src = ENT.get(sourceKey);
    const rels = await client.relationsOf(src.id);
    relChecked += rels.length;
    for (const want of list) {
      const target = ENT.get(want.targetKey);
      if (!rels.some((r) => r.type === want.type && r.target_id === (target && target.id))) {
        problems.push("关系缺失：" + want.type + " " + sourceKey + " → " + want.targetKey);
      }
    }
  }

  // subjects 覆盖 + 创作链完整性再算一次（用服务端回读数据）
  for (const box of BOXES) {
    const relEnt = await camp.getEntity(idOf("release:" + box.key));
    const subj = new Set((relEnt.subjects || []).map((s) => s.work_id));
    for (const t of box.tracks) {
      const ex = await camp.getEntity(idOf("expr:" + box.key + ":" + t.key));
      if (ex.work_id && !subj.has(ex.work_id)) problems.push("发行《" + box.release.title + "》未声明收录曲目 Work " + ex.work_id + "（" + t.work + "）");
      if (!ex.content_unit_id) problems.push("表达「" + t.title + "」没有挂 content_unit_id（创作链断了）");
      const track = await camp.getEntity(idOf("track:" + box.key + ":" + t.key));
      if (!(track.contents || []).length) problems.push("Track「" + t.title + "」的 contents 为空");
    }
  }

  // 修复结果回读：新链完整 / Track 指向新 Expression / 旧实体已停用 / subjects 不再含游戏作品
  if (REPAIR.legacy.length) {
    for (const id of REPAIR.legacy) {
      const cur = await camp.getEntity(id);
      if (cur.status !== "deleted") problems.push("修复后旧实体未停用：" + cur.kind + "「" + cur.title + "」" + id + " status=" + cur.status);
    }
    for (const id of REPAIR.legacy) {
      const rr = await client.call("/api/catalog/entities/" + id + "/relations");
      const left = ((rr.body || {}).items) || [];
      if (rr.status === 200 && left.length) problems.push("修复后旧实体仍有关系边残留：" + id + " ×" + left.length);
    }
    const relAfter = await camp.getEntity(idOf("release:chrono"));
    if ((relAfter.subjects || []).some((s) => s.work_id === REPAIR.gameWork)) problems.push("修复后 release subjects 仍包含同名游戏作品 " + REPAIR.gameWork);
    const trk = await camp.getEntity(idOf("track:chrono:c5"));
    const wantExpr = idOf("expr:chrono:c5");
    if (!(trk.contents || []).some((c) => c.expression_id === wantExpr)) problems.push("修复后 Track「クロノ・トリガー (Piano Duo ver)」的 contents 未指向新 Expression");
    const newCu = await camp.getEntity(idOf("cu:chrono:c5"));
    const newWork = idOf("song:chrono:c5");
    if (newCu.work_id !== newWork) problems.push("修复后新篇目未挂在新曲目 Work 下");
    const newEx = await camp.getEntity(wantExpr);
    if (newEx.work_id !== newWork || newEx.content_unit_id !== newCu.id) problems.push("修复后新 Expression 的 work_id/content_unit_id 链不完整");
  }
}

console.log("\n=== 回读断言 ===");
console.log("回读实体 " + checked + " 条，关系端点 " + relChecked + " 条，问题 " + problems.length + " 条");
for (const p of problems) console.log("  ✗ " + p);

const summary = camp.summary({
  boxes: BOXES.map((b) => {
    const first = b.tracks[0];
    return {
      key: b.key,
      release: idOf("release:" + b.key),
      title: b.release.title,
      catalog_number: b.release.catalog_number,
      media: b.media.length,
      tracks: b.tracks.length,
      subjects: b.albums.length + b.tracks.length,
      chain_sample: first ? {
        title: first.title,
        work: idOf("song:" + b.key + ":" + first.key),
        content_unit: idOf("cu:" + b.key + ":" + first.key),
        expression: idOf("expr:" + b.key + ":" + first.key),
        track: idOf("track:" + b.key + ":" + first.key),
        medium: idOf("medium:" + b.key + ":" + first.medium),
      } : null,
    };
  }),
  repair: REPAIR,
  readback: { entities: checked, relations: relChecked, problems },
});
void summary;

process.exitCode = (camp.failed.length === 0 && problems.length === 0) ? 0 : 1;
