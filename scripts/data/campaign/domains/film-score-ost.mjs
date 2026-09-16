#!/usr/bin/env node
// 领域 9「电影原声带（OST → 影片 soundtrack_of）」— 真实数据补录脚本。
//
// 覆盖两条链（BRIEF 第 0.1 节）：
//   创作链：work → content_unit(曲目篇目) → expression(该曲的录音表达，content_unit_id 挂到篇目)
//   承载链：work → release(subjects) → medium(cd) → track(contents[] → expression)
//
// 本领域刻意用两种"篇目归属"形状，用来实测实例行为（结论写进报告）：
//   · Under the Skin：曲目篇目挂在**原声专辑 Work** 上 → release.subjects 只声明专辑 Work；
//   · The Fountain：曲目篇目挂在**影片 Work** 上（配乐是影片的乐段）→ 专辑 Release 的 subjects
//     必须同时声明专辑 Work（primary）与影片 Work（compilation），实测多作品 subjects 校验。
//
// 数据来源（每条实体/关系各自带 sources）：
//   · MusicBrainz release：品番 / 条码 / 地区 / 日期 / 介质 / 曲序与时长（毫秒）
//   · Apple Music Lookup API：官方专辑题名、曲目顺序与秒级时长、© 行
//   · 英文维基（影片与专辑事实：导演、作曲、演出者、发行日）
//   · 中文维基 /zh-cn/ 与 /zh-tw/ 变体页面、日文维基：多语言官方题名
//
// 用法：MF_USER_PASS=… node scripts/data/campaign/domains/film-score-ost.mjs [--dry-run]

import { Campaign, Client, Index, src, DRY } from "../lib.mjs";

// ── 来源条目 ────────────────────────────────────────────────────────────────
const S = {
  mbUtsCd: src("https://musicbrainz.org/release/1e9c6f1d-109f-4a12-a784-f1c972121110",
    "MusicBrainz release「Under the Skin」(Milan / 399 543-2)：条码 3299039954324、地区 XE、2014-04、1×CD 12 曲及每曲标题与时长(ms)"),
  mbUtsGroup: src("https://musicbrainz.org/ws/2/release?query=release%3A%22Under+the+Skin%22+AND+artist%3A%22Mica+Levi%22",
    "MusicBrainz 检索「Under the Skin / Mica Levi」：定义 release group 7e8e8890-95b2-4568-9454-2e627ebdc222，并给出同组其它版本（US CD M2-36678、US 12 吋黑胶）"),
  wikiUtsFilm: src("https://en.wikipedia.org/wiki/Under_the_Skin_(2013_film)",
    "英文维基 Under the Skin (2013 film)：导演 Jonathan Glazer、音乐 Mica Levi、2013-08-29 特柳赖德首映、英国 2014-03-14 上映"),
  wikiUtsOst: src("https://en.wikipedia.org/wiki/Under_the_Skin_(soundtrack)",
    "英文维基 Under the Skin (soundtrack)：专辑题名 Under the Skin (Original Motion Picture Soundtrack)、Mica Levi、2014-03-28、Rough Trade、producer = Mica Levi / Peter Raeburn、全长 46:57"),
  itUts: src("https://itunes.apple.com/lookup?id=1813127106&entity=song",
    "Apple Music「Under the Skin (Original Soundtrack Album)」(Mica Levi, collectionId 1813127106)：12 首曲目、曲序、秒级时长、℗ 2014 Rough Trade Records Ltd"),
  zhUts: src("https://zh.wikipedia.org/zh-cn/%E7%9A%AE%E5%9B%8A%E4%B9%8B%E4%B8%8B",
    "中文维基 /zh-cn/ 变体：zh-CN 片名「皮囊之下」；/zh-tw/ 变体页面标题为「肌膚之侵」，取为 zh-TW 片名"),
  jaUts: src("https://ja.wikipedia.org/wiki/%E3%82%A2%E3%83%B3%E3%83%80%E3%83%BC%E3%83%BB%E3%82%B6%E3%83%BB%E3%82%B9%E3%82%AD%E3%83%B3_%E7%A8%AE%E3%81%AE%E6%8D%95%E9%A3%9F",
    "日文维基条目题名「アンダー・ザ・スキン 種の捕食」：取 ja-JP 片名"),
  mbFountain: src("https://musicbrainz.org/release/33abead4-3015-438f-9ea3-97f2cc5cb278",
    "MusicBrainz release「The Fountain」(Nonesuch, US, 2006-11-21)：条码 075597990126、包装 Cardboard/Paper Sleeve、release group c2f448d3-2df4-3c2b-9e27-7ae3f3cd6e1e"),
  wikiFountain: src("https://en.wikipedia.org/wiki/The_Fountain",
    "英文维基 The Fountain：导演 Darren Aronofsky、音乐 Clint Mansell、2006-11-22 上映、美国片"),
  wikiFountainOst: src("https://en.wikipedia.org/wiki/The_Fountain_(soundtrack)",
    "英文维基 The Fountain (soundtrack)：专辑题名 The Fountain: Music from the Motion Picture、artist = Clint Mansell with the Kronos Quartet and Mogwai、Nonesuch、2006-11-27、producer = Tony Doogan / Geoff Foster / Scott Fraser"),
  itFountain: src("https://itunes.apple.com/lookup?id=204669166&entity=song",
    "Apple Music「The Fountain (Music from the Motion Picture)」(Clint Mansell, collectionId 204669166)：10 首曲目、曲序、秒级时长、℗ 2006 Nonesuch Records，发行日 2006-11-21"),
  zhFountain: src("https://zh.wikipedia.org/zh-cn/%E7%9C%9F%E6%84%9B%E6%B0%B8%E6%81%86",
    "中文维基 /zh-cn/ 变体页面标题「珍爱泉源」（zh-CN）、/zh-tw/ 变体标题「真愛永恆」（zh-TW）"),
  jaFountain: src("https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A1%E3%82%A6%E3%83%B3%E3%83%86%E3%83%B3_%E6%B0%B8%E9%81%A0%E3%81%AB%E3%81%A4%E3%81%A5%E3%81%8F%E6%84%9B",
    "日文维基条目题名「ファウンテン 永遠につづく愛」：取 ja-JP 片名"),
  wikiNames: src("https://en.wikipedia.org/w/api.php?action=query&prop=langlinks&lllimit=500&format=json&titles=Jonathan%20Glazer%7CClint%20Mansell%7CDarren%20Aronofsky%7CKronos%20Quartet%7CMogwai",
    "英文维基 langlinks：Jonathan Glazer→ja ジョナサン・グレイザー / zh 強納森・葛雷澤；Clint Mansell→ja クリント・マンセル / zh 克林特・曼塞爾；Darren Aronofsky→ja ダーレン・アロノフスキー / zh 戴倫・艾洛諾夫斯基；Kronos Quartet→ja クロノス・クァルテット；Mogwai→ja モグワイ / zh 魔怪 (樂團)"),
  wikiMogwai: src("https://en.wikipedia.org/wiki/Mogwai",
    "英文维基 Mogwai 信息框：caption 列出成员 Alex Mackay / Martin Bulloch / Barry Burns / Dominic Aitchison / Stuart Braithwaite，origin = Glasgow, Scotland；用于 member_of 关系"),
};

const ev = (note, sources) => ({ note, sources: Array.isArray(sources) ? sources : [sources] });
const note = (what) => "编目：新建电影原声带领域的" + what + "，事实取自下方来源（MusicBrainz 发行记录 + Apple Music 曲目单 + 维基影片/专辑页）。";
// 只给"有来源支持"的语种行，不编造译名
const tr = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { title: v }]));

// ── Agent（作曲家 / 导演 / 演奏团体 / 厂牌 / 乐手）──────────────────────────
const AGENTS = [
  { key: "mica-levi", title: "Mica Levi", type: "person", lang: "en", names: tr({ "en-US": "Mica Levi" }),
    s: [S.wikiUtsFilm, S.itUts], what: "agent：影片《Under the Skin》配乐作曲 Mica Levi" },
  { key: "jonathan-glazer", title: "Jonathan Glazer", type: "person", lang: "en",
    names: tr({ "en-US": "Jonathan Glazer", "ja-JP": "ジョナサン・グレイザー", "zh-TW": "強納森・葛雷澤" }),
    s: [S.wikiUtsFilm, S.wikiNames], what: "agent：影片《Under the Skin》导演 Jonathan Glazer" },
  { key: "peter-raeburn", title: "Peter Raeburn", type: "person", lang: "en", names: tr({ "en-US": "Peter Raeburn" }),
    s: [S.wikiUtsOst], what: "agent：原声专辑制作人 Peter Raeburn（维基专辑信息框 producer 行）" },
  { key: "milan-records", title: "Milan Records", type: "organization", lang: "en", names: tr({ "en-US": "Milan Records" }),
    s: [S.mbUtsCd], what: "agent（organization）：欧版 CD 发行厂牌 Milan Records" },
  { key: "clint-mansell", title: "Clint Mansell", type: "person", lang: "en",
    names: tr({ "en-US": "Clint Mansell", "ja-JP": "クリント・マンセル", "zh-TW": "克林特・曼塞爾" }),
    s: [S.wikiFountain, S.wikiNames], what: "agent：影片《The Fountain》配乐作曲 Clint Mansell" },
  { key: "darren-aronofsky", title: "Darren Aronofsky", type: "person", lang: "en",
    names: tr({ "en-US": "Darren Aronofsky", "ja-JP": "ダーレン・アロノフスキー", "zh-TW": "戴倫・艾洛諾夫斯基" }),
    s: [S.wikiFountain, S.wikiNames], what: "agent：影片《The Fountain》导演 Darren Aronofsky" },
  { key: "kronos-quartet", title: "Kronos Quartet", type: "group", lang: "en",
    names: tr({ "en-US": "Kronos Quartet", "ja-JP": "クロノス・クァルテット" }),
    s: [S.wikiFountainOst, S.wikiNames], what: "agent（group）：《The Fountain》原声的演奏团体 Kronos Quartet" },
  { key: "mogwai", title: "Mogwai", type: "group", lang: "en",
    names: tr({ "en-US": "Mogwai", "ja-JP": "モグワイ", "zh-TW": "魔怪" }),
    s: [S.wikiFountainOst, S.wikiNames], what: "agent（group）：《The Fountain》原声的演奏团体 Mogwai" },
  { key: "nonesuch", title: "Nonesuch Records", type: "organization", lang: "en", names: tr({ "en-US": "Nonesuch Records" }),
    s: [S.wikiFountainOst, S.mbFountain], what: "agent（organization）：《The Fountain》原声发行厂牌 Nonesuch Records" },
  { key: "stuart-braithwaite", title: "Stuart Braithwaite", type: "person", lang: "en", names: tr({ "en-US": "Stuart Braithwaite" }),
    s: [S.wikiMogwai], what: "agent：Mogwai 成员 Stuart Braithwaite（供 member_of 关系）" },
];

// ── 影片 + 原声专辑 + 篇目 + 承载链 ─────────────────────────────────────────
// cueHost: "album" = 曲目篇目挂在专辑 Work；"film" = 配乐篇目挂在影片 Work
const FILMS = [
  {
    key: "uts",
    filmTitle: "Under the Skin",
    filmNames: tr({ "en-US": "Under the Skin", "zh-CN": "皮囊之下", "zh-TW": "肌膚之侵", "ja-JP": "アンダー・ザ・スキン 種の捕食" }),
    filmTags: ["电影", "英国电影", "科幻", "film"],
    filmS: [S.wikiUtsFilm, S.zhUts, S.jaUts],
    filmExt: { wikipedia: "Under the Skin (2013 film)" },
    filmWhat: "work(film)：影片《Under the Skin》（2013，导演 Jonathan Glazer）",
    albumTitle: "Under the Skin (Original Motion Picture Soundtrack)",
    albumExt: { musicbrainz: "7e8e8890-95b2-4568-9454-2e627ebdc222", apple_music: "1813127106" },
    albumTags: ["电影原声", "原声带", "soundtrack", "film score"],
    albumS: [S.wikiUtsOst, S.itUts, S.mbUtsGroup],
    albumWhat: "work(album)：Mica Levi《Under the Skin (Original Motion Picture Soundtrack)》原声专辑",
    cueHost: "album",
    cues: [
      { n: "1", title: "Creation", dur: 167 },
      { n: "2", title: "Lipstick to Void", dur: 401 },
      { n: "3", title: "Andrew Void", dur: 134 },
      { n: "4", title: "Meat to Maths", dur: 121 },
      { n: "5", title: "Drift", dur: 419 },
      { n: "6", title: "Lonely Void", dur: 219 },
    ],
    releaseTitle: "Under the Skin (Original Motion Picture Soundtrack)",
    releaseAttrs: { catalog_number: "399 543-2", barcode: "3299039954324", edition_date: "2014-04", edition_type: "standard", edition_batch: "first_press", country: "XE", distribution_channel: "physical", publisher: "@milan-records" },
    releaseExt: { musicbrainz: "1e9c6f1d-109f-4a12-a784-f1c972121110" },
    releaseS: [S.mbUtsCd, S.wikiUtsOst],
    releaseWhat: "release：欧版 CD（Milan 399 543-2，条码 3299039954324，2014-04，12 曲）",
    subjects: [{ work: "album", role: "primary", position: 0 }],
    tracks: [
      { n: "1", title: "Creation", dur: 167 },
      { n: "2", title: "Lipstick to Void", dur: 401 },
      { n: "3", title: "Andrew Void", dur: 134 },
      { n: "4", title: "Meat to Maths", dur: 121 },
      { n: "5", title: "Drift", dur: 419 },
      { n: "6", title: "Lonely Void", dur: 219 },
      { n: "7", title: "Mirror to Vortex", dur: 156 },
      { n: "8", title: "Bedroom", dur: 90 },
      { n: "9", title: "Love", dur: 310 },
      { n: "10", title: "Bothy", dur: 82 },
      { n: "11", title: "Death", dur: 279 },
      { n: "12", title: "Alien Loop", dur: 440 },
    ],
    relations: [
      { type: "soundtrack_of", from: "work:album", to: "work:film", attrs: {}, s: [S.wikiUtsOst], what: "关系：原声专辑《Under the Skin》→ 影片《Under the Skin》（soundtrack_of）" },
      { type: "composed_by", from: "work:film", to: "@mica-levi", attrs: { credit_role: "composer" }, s: [S.wikiUtsFilm], what: "关系：影片 → Mica Levi（作曲，维基信息框 music 行）" },
      { type: "composed_by", from: "work:album", to: "@mica-levi", attrs: { credit_role: "composer" }, s: [S.itUts, S.wikiUtsOst], what: "关系：原声专辑 → Mica Levi（作曲／专辑艺人）" },
      { type: "directed_by", from: "work:film", to: "@jonathan-glazer", attrs: { credit_role: "director" }, s: [S.wikiUtsFilm], what: "关系：影片 → Jonathan Glazer（导演）" },
      { type: "credit_for", from: "work:album", to: "@mica-levi", attrs: { credit_role: "producer" }, s: [S.wikiUtsOst], what: "关系：原声专辑 → Mica Levi（producer 署名）" },
      { type: "credit_for", from: "work:album", to: "@peter-raeburn", attrs: { credit_role: "producer" }, s: [S.wikiUtsOst], what: "关系：原声专辑 → Peter Raeburn（producer 署名）" },
      { type: "created_by", from: "release", to: "@milan-records", attrs: { credit_role: "label" }, s: [S.mbUtsCd], what: "关系：欧版 CD → Milan Records（发行厂牌）" },
      { type: "composed_by", from: "unit:1", to: "@mica-levi", attrs: { credit_role: "composer" }, s: [S.itUts], what: "关系：篇目〈Creation〉→ Mica Levi（该曲作曲）" },
    ],
  },
  {
    key: "fountain",
    filmTitle: "The Fountain",
    filmNames: tr({ "en-US": "The Fountain", "zh-CN": "珍爱泉源", "zh-TW": "真愛永恆", "ja-JP": "ファウンテン 永遠につづく愛" }),
    filmTags: ["电影", "美国电影", "科幻", "film"],
    filmS: [S.wikiFountain, S.zhFountain, S.jaFountain],
    filmExt: { wikipedia: "The Fountain" },
    filmWhat: "work(film)：影片《The Fountain》（2006，导演 Darren Aronofsky）",
    albumTitle: "The Fountain: Music from the Motion Picture",
    albumExt: { musicbrainz: "c2f448d3-2df4-3c2b-9e27-7ae3f3cd6e1e", apple_music: "204669166" },
    albumTags: ["电影原声", "原声带", "soundtrack", "film score"],
    albumS: [S.wikiFountainOst, S.itFountain],
    albumWhat: "work(album)：Clint Mansell with Kronos Quartet & Mogwai《The Fountain: Music from the Motion Picture》",
    cueHost: "film",
    cues: [
      { n: "1", title: "The Last Man", dur: 369 },
      { n: "2", title: "Holy Dread!", dur: 232 },
      { n: "3", title: "Tree of Life", dur: 225 },
      { n: "4", title: "Stay With Me", dur: 216 },
      { n: "5", title: "Work", dur: 154 },
      { n: "6", title: "Xibalba", dur: 323 },
    ],
    releaseTitle: "The Fountain: Music from the Motion Picture",
    releaseAttrs: { barcode: "075597990126", edition_date: "2006-11-21", edition_type: "standard", edition_batch: "first_press", country: "US", distribution_channel: "physical", publisher: "@nonesuch" },
    releaseExt: { musicbrainz: "33abead4-3015-438f-9ea3-97f2cc5cb278" },
    releaseS: [S.mbFountain, S.wikiFountainOst, S.itFountain],
    releaseWhat: "release：美版 CD（Nonesuch，条码 075597990126，2006-11-21，10 曲；subjects 同时声明专辑与影片两个 Work）",
    subjects: [{ work: "album", role: "primary", position: 0 }, { work: "film", role: "compilation", position: 1 }],
    tracks: [
      { n: "1", title: "The Last Man", dur: 369 },
      { n: "2", title: "Holy Dread!", dur: 232 },
      { n: "3", title: "Tree of Life", dur: 225 },
      { n: "4", title: "Stay With Me", dur: 216 },
      { n: "5", title: "Work", dur: 154 },
      { n: "6", title: "Xibalba", dur: 323 },
      { n: "7", title: "First Snow", dur: 189 },
      { n: "8", title: "Finish It", dur: 265 },
      { n: "9", title: "Death Is the Road to Awe", dur: 506 },
      { n: "10", title: "Together We Will Live Forever", dur: 302 },
    ],
    relations: [
      { type: "soundtrack_of", from: "work:album", to: "work:film", attrs: {}, s: [S.wikiFountainOst], what: "关系：原声专辑《The Fountain》→ 影片《The Fountain》（soundtrack_of）" },
      { type: "composed_by", from: "work:film", to: "@clint-mansell", attrs: { credit_role: "composer" }, s: [S.wikiFountain], what: "关系：影片 → Clint Mansell（作曲）" },
      { type: "composed_by", from: "work:album", to: "@clint-mansell", attrs: { credit_role: "composer" }, s: [S.wikiFountainOst], what: "关系：原声专辑 → Clint Mansell（作曲）" },
      { type: "directed_by", from: "work:film", to: "@darren-aronofsky", attrs: { credit_role: "director" }, s: [S.wikiFountain], what: "关系：影片 → Darren Aronofsky（导演）" },
      { type: "performed_by", from: "work:album", to: "@kronos-quartet", attrs: { credit_role: "performer" }, s: [S.wikiFountainOst], what: "关系：原声专辑 → Kronos Quartet（演奏）" },
      { type: "performed_by", from: "work:album", to: "@mogwai", attrs: { credit_role: "performer" }, s: [S.wikiFountainOst], what: "关系：原声专辑 → Mogwai（演奏）" },
      { type: "created_by", from: "release", to: "@nonesuch", attrs: { credit_role: "label" }, s: [S.mbFountain, S.wikiFountainOst], what: "关系：美版 CD → Nonesuch Records（发行厂牌）" },
      { type: "composed_by", from: "unit:1", to: "@clint-mansell", attrs: { credit_role: "composer" }, s: [S.itFountain], what: "关系：篇目〈The Last Man〉→ Clint Mansell（该曲作曲）" },
      { type: "member_of", from: "@stuart-braithwaite", to: "@mogwai", attrs: { credit_role: "member" }, s: [S.wikiMogwai], what: "关系：Stuart Braithwaite → Mogwai（成员）" },
    ],
  },
];

// ── 执行 ────────────────────────────────────────────────────────────────────
const client = new Client();
await client.login();
const camp = new Campaign({ domain: "film-score-ost", client, index: Index.load() });

const ids = {};          // 逻辑键（含影片前缀）→ 实体 id
const records = [];      // 写后断言清单
const KIND_OF = { agent: "agent", filmWork: "work", albumWork: "work", unit: "content_unit", expression: "expression", release: "release", medium: "medium", track: "track" };
const put = (k, v) => { if (v) ids[k] = v; return v; };
const track = (kind, key, ent, expect) => {
  records.push({ kind, key, id: ent.id, title: ent.title, expect: expect || {} });
  return ent;
};
// 关系两端逻辑键 → 实体 id（按影片前缀解析，避免跨影片串号）
const refOf = (f, raw) => {
  const k = raw.startsWith("@") ? "agent:" + raw.slice(1)
    : raw === "work:film" ? "filmWork:" + f.key
    : raw === "work:album" ? "albumWork:" + f.key
    : raw === "release" ? "release:" + f.key
    : raw.startsWith("unit:") ? "unit:" + f.key + "-" + raw.slice(5)
    : null;
  if (!k || !ids[k]) throw new Error("引用不存在的逻辑键：" + raw + "（数据集内部错误）");
  return ids[k];
};

console.log("=== 1/7 查重与创建 agent（" + AGENTS.length + " 个）===");
for (const a of AGENTS) {
  const ent = await camp.ensureEntity("agent", a.title, {
    original_language: a.lang, types: [a.type], translations: a.names, attributes: {}, external_ids: {},
  }, ev(note(a.what), a.s), { idemKey: "film-score-ost-agent-" + a.key });
  put("agent:" + a.key, ent.id);
  track("agent", "agent:" + a.key, ent, { types: a.type });
}

console.log("=== 2/7 查重与创建 work（影片 + 原声专辑，共 " + (FILMS.length * 2) + " 部）===");
for (const f of FILMS) {
  const film = await camp.ensureEntity("work", f.filmTitle, {
    original_language: "en", types: ["film"], translations: f.filmNames,
    attributes: { tags: f.filmTags }, external_ids: f.filmExt,
  }, ev(note(f.filmWhat), f.filmS), { idemKey: "film-score-ost-film-" + f.key });
  put("filmWork:" + f.key, film.id);
  track("filmWork", "filmWork:" + f.key, film, { types: "film" });

  const album = await camp.ensureEntity("work", f.albumTitle, {
    original_language: "en", types: ["album"], translations: tr({ "en-US": f.albumTitle }),
    attributes: { tags: f.albumTags }, external_ids: f.albumExt,
  }, ev(note(f.albumWhat), f.albumS), { idemKey: "film-score-ost-album-" + f.key });
  put("albumWork:" + f.key, album.id);
  track("albumWork", "albumWork:" + f.key, album, { types: "album" });
}

console.log("=== 3/7 创建 content_unit（每条原声前 6 个曲目篇目）===");
for (const f of FILMS) {
  const host = f.cueHost === "album" ? ids["albumWork:" + f.key] : ids["filmWork:" + f.key];
  for (const c of f.cues) {
    const ent = await camp.ensureEntity("content_unit", c.title, {
      work_id: host, position: Number(c.n), number: c.n,
      original_language: "en", types: ["content_unit"],
      translations: tr({ "en-US": c.title }),
      attributes: { entry_role: "main" }, external_ids: {},
    }, ev(note(f.key + " 原声曲目篇目 #" + c.n + "〈" + c.title + "〉，挂在" + (f.cueHost === "album" ? "原声专辑" : "影片") + " Work 下"), f.albumS), {
      idemKey: "film-score-ost-unit-" + f.key + "-" + c.n, scope: { work_id: host }, allowServerLookup: true,
    });
    put("unit:" + f.key + "-" + c.n, ent.id);
    track("unit", "unit:" + f.key + "-" + c.n, ent, { work: host, entry_role: "main" });
  }
}

console.log("=== 4/7 创建 expression（篇目对应的录音表达，带 content_unit_id）===");
for (const f of FILMS) {
  const host = f.cueHost === "album" ? ids["albumWork:" + f.key] : ids["filmWork:" + f.key];
  for (const c of f.cues) {
    const unitId = ids["unit:" + f.key + "-" + c.n];
    const ent = await camp.ensureEntity("expression", c.title, {
      work_id: host, content_unit_id: unitId, position: Number(c.n),
      original_language: "en", types: ["expression"],
      translations: tr({ "en-US": c.title }),
      attributes: { duration: c.dur }, external_ids: {},
    }, ev(note(f.key + " 曲目〈" + c.title + "〉的录音表达（时长 " + c.dur + " 秒，取自 Apple Music 曲目时长）"), f.albumS), {
      idemKey: "film-score-ost-expr-" + f.key + "-" + c.n, scope: { work_id: host }, allowServerLookup: true,
    });
    put("expr:" + f.key + "-" + c.n, ent.id);
    track("expression", "expr:" + f.key + "-" + c.n, ent, { work: host, unit: unitId });
  }
}

console.log("=== 5/7 创建 release（subjects 声明收录的 Work）+ medium ===");
for (const f of FILMS) {
  const attrs = {};
  for (const [k, v] of Object.entries(f.releaseAttrs)) attrs[k] = typeof v === "string" && v.startsWith("@") ? ids["agent:" + v.slice(1)] : v;
  const subjects = f.subjects.map((s) => ({ work_id: ids[(s.work === "album" ? "albumWork:" : "filmWork:") + f.key], role: s.role, position: s.position }));
  const rel = await camp.ensureEntity("release", f.releaseTitle, {
    original_language: "en", types: ["release"], translations: tr({ "en-US": f.releaseTitle }),
    attributes: attrs, external_ids: f.releaseExt, subjects,
  }, ev(note(f.releaseWhat), f.releaseS), { idemKey: "film-score-ost-release-" + f.key, allowServerLookup: true });
  put("release:" + f.key, rel.id);
  track("release", "release:" + f.key, rel, { subjects: subjects.map((s) => s.work_id) });

  const med = await camp.ensureEntity("medium", "CD", {
    release_id: rel.id, position: 1, original_language: "en", types: ["medium"],
    translations: tr({ "en-US": "CD" }), attributes: { format: "cd", role: "primary" }, external_ids: {},
  }, ev(note(f.key + " 原声 CD 载体（1 枚 CD）"), f.releaseS), {
    idemKey: "film-score-ost-medium-" + f.key, scope: { release_id: rel.id }, allowServerLookup: true,
  });
  put("medium:" + f.key, med.id);
  track("medium", "medium:" + f.key, med, { release: rel.id, format: "cd" });
}

console.log("=== 6/7 创建 track（完整曲序；前 6 首带 contents 引用 expression）===");
for (const f of FILMS) {
  const mediumId = ids["medium:" + f.key];
  for (const t of f.tracks) {
    const hasCue = f.cues.some((c) => c.n === t.n);
    const exprId = hasCue ? ids["expr:" + f.key + "-" + t.n] : null;
    const ent = await camp.ensureEntity("track", t.title, {
      medium_id: mediumId, position: Number(t.n), number: t.n,
      original_language: "en", types: ["track"],
      translations: tr({ "en-US": t.title }),
      attributes: { duration: t.dur },
      contents: exprId ? [{ expression_id: exprId, position: 1, locator: null }] : [],
      external_ids: {},
    }, ev(note(f.key + " CD 第 " + t.n + " 轨〈" + t.title + "〉" + (exprId ? "，contents 引用该曲录音表达" : "（曲序真实存在，本轮未建对应表达）")), f.releaseS), {
      idemKey: "film-score-ost-track-" + f.key + "-" + t.n, scope: { medium_id: mediumId }, allowServerLookup: true,
    });
    put("track:" + f.key + "-" + t.n, ent.id);
    track("track", "track:" + f.key + "-" + t.n, ent, { medium: mediumId, expression: exprId });
  }
}

console.log("=== 7/7 创建关系 ===");
for (const f of FILMS) {
  for (const r of f.relations) {
    await camp.createRelation(r.type, refOf(f, r.from), refOf(f, r.to), ev(note(r.what), r.s), { attributes: r.attrs });
  }
}

// ── 写后回读断言 ────────────────────────────────────────────────────────────
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const totalRelations = FILMS.reduce((n, f) => n + f.relations.length, 0);

if (!DRY) {
  console.log("\n=== 写后回读断言 ===");
  const byId = new Map();
  for (const kind of ["agent", "work", "content_unit", "expression", "release", "medium", "track"]) {
    const rows = await client.listKind(kind);
    for (const e of rows) byId.set(e.id, e);
  }
  console.log("回读实体 " + byId.size + " 条");

  const STRUCT = ["work_id", "release_id", "medium_id", "parent_id", "content_unit_id"];
  for (const rec of records) {
    const e = byId.get(rec.id);
    if (!e) { fails.push(rec.kind + "「" + rec.title + "」(" + rec.id + ") 回读缺失"); continue; }
    ok(e.kind === KIND_OF[rec.kind], rec.kind + "「" + e.title + "」kind 不符：" + e.kind);
    ok(e.status === "published", rec.kind + "「" + e.title + "」状态非 published：" + e.status);
    ok(e.translations && Object.keys(e.translations).length > 0, rec.kind + "「" + e.title + "」没有翻译行");
    const A = e.attributes || {};
    if (rec.kind === "filmWork" || rec.kind === "albumWork") {
      ok((e.types || []).includes(rec.expect.types), "work「" + e.title + "」types 不含 " + rec.expect.types);
      for (const k of STRUCT) ok(!e[k], "work「" + e.title + "」不该有结构字段 " + k);
    }
    if (rec.kind === "unit") {
      ok(e.work_id === rec.expect.work, "content_unit「" + e.title + "」work_id 不符");
      ok(!e.parent_id, "content_unit「" + e.title + "」不该有 parent_id");
      ok(A.entry_role === rec.expect.entry_role, "content_unit「" + e.title + "」entry_role=" + A.entry_role);
    }
    if (rec.kind === "expression") {
      ok(e.work_id === rec.expect.work, "expression「" + e.title + "」work_id 不符");
      ok(e.content_unit_id === rec.expect.unit, "expression「" + e.title + "」content_unit_id 未挂到篇目（" + e.content_unit_id + "）");
      ok(!e.parent_id, "expression「" + e.title + "」不该有 parent_id");
      ok(e.work_id === ((byId.get(e.content_unit_id) || {}).work_id), "expression「" + e.title + "」与篇目不同 Work");
    }
    if (rec.kind === "release") {
      ok(!e.work_id, "release「" + e.title + "」不该有 work_id");
      const subj = (e.subjects || []).map((s) => s.work_id).sort();
      ok(JSON.stringify(subj) === JSON.stringify([...rec.expect.subjects].sort()), "release「" + e.title + "」subjects 不符：" + JSON.stringify(subj));
    }
    if (rec.kind === "medium") {
      ok(e.release_id === rec.expect.release, "medium「" + e.title + "」release_id 不符");
      ok(A.format === "cd", "medium「" + e.title + "」format=" + A.format);
    }
    if (rec.kind === "track") {
      ok(e.medium_id === rec.expect.medium, "track「" + e.title + "」medium_id 不符");
      if (rec.expect.expression) ok(!!(e.contents || []).find((x) => x.expression_id === rec.expect.expression), "track「" + e.title + "」contents 未引用预期 expression");
    }
    if (rec.kind === "agent") ok((e.types || []).includes(rec.expect.types), "agent「" + e.title + "」types 不符：" + JSON.stringify(e.types));
  }

  // subjects 覆盖复算（服务端 undeclared_release_subject 的本地等价检查）
  for (const f of FILMS) {
    const rel = byId.get(ids["release:" + f.key]);
    const subj = new Set((rel.subjects || []).map((s) => s.work_id));
    const meds = [...byId.values()].filter((m) => m.kind === "medium" && m.release_id === rel.id);
    const trks = [...byId.values()].filter((t) => t.kind === "track" && meds.some((m) => m.id === t.medium_id));
    const used = new Set();
    for (const t of trks) for (const c of t.contents || []) {
      const ex = byId.get(c.expression_id);
      ok(!!ex, "track「" + t.title + "」contents 指向不存在的 expression " + c.expression_id);
      if (ex && ex.work_id) { used.add(ex.work_id); ok(subj.has(ex.work_id), "release「" + rel.title + "」收录未声明 Work " + ex.work_id); }
    }
    ok(used.size > 0, "release「" + rel.title + "」没有任何带 contents 的 Track");
    console.log("  subjects 覆盖：" + rel.title + " → 声明 " + subj.size + " 个 Work / 实际收录 " + used.size + " 个 / Track " + trks.length + " 条");
  }

  // 关系两端回读
  const relCache = new Map();
  for (const f of FILMS) for (const r of f.relations) {
    const from = refOf(f, r.from), to = refOf(f, r.to);
    if (!relCache.has(from)) relCache.set(from, await client.relationsOf(from));
    ok(!!relCache.get(from).find((x) => x.type === r.type && x.target_id === to && !x.via), "关系回读缺失：" + r.type + " " + from.slice(0, 8) + "→" + to.slice(0, 8));
  }
  console.log("  关系回读：" + relCache.size + " 个源实体上复核 " + totalRelations + " 条关系");

  // revisions 抽样
  const revTargets = records.filter((r) => ["filmWork", "albumWork", "release", "unit", "expression"].includes(r.kind)).slice(0, 8);
  let revOk = 0, revBad = 0;
  for (const rec of revTargets) {
    const rv = await client.call("/api/catalog/entities/" + rec.id + "/revisions");
    if (rv.status === 200) { revOk++; const items = rv.body && (rv.body.items || rv.body.revisions || rv.body); ok(Array.isArray(items) ? items.length > 0 : true, "revisions 为空：" + rec.id); }
    else revBad++;
  }
  console.log("  revisions 抽样：" + revTargets.length + " 个实体中可用 " + revOk + " / 端点不可用 " + revBad);
  for (const m of fails) console.log("  ✗ " + m);
  console.log("断言失败 " + fails.length + " 项");
}

camp.summary({
  planned: {
    agents: AGENTS.length, works: FILMS.length * 2,
    contentUnits: FILMS.reduce((n, f) => n + f.cues.length, 0),
    expressions: FILMS.reduce((n, f) => n + f.cues.length, 0),
    releases: FILMS.length, mediums: FILMS.length,
    tracks: FILMS.reduce((n, f) => n + f.tracks.length, 0),
    relations: totalRelations,
  },
  assertFailures: fails,
});
if (camp.failed.length || fails.length) { console.log("存在失败项，退出码 1"); process.exit(1); }
console.log("全部成功（写入失败 0 / 断言失败 0）");
