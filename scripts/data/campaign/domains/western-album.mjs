#!/usr/bin/env node
// 领域 3/20：欧美流行/摇滚专辑（CD 与黑胶两版）— slug = western-album
//
// 两条链（每个专辑各走一遍）：
//   创作链  Work(album) → ContentUnit(曲目) → Expression(录音)
//   承载链  Work(album) → Release(CD / 黑胶) → Medium → Track → contents[]（引用 Expression）
//
// 数据来源（全部可核对，字段逐项对应）：
//   MusicBrainz 发行 b84ee12a-09ef-421b-82de-0441a926375b（The Dark Side of the Moon，GB 1973-03-24 黑胶）
//   MusicBrainz 发行 9c4c939e-5697-44d3-b2f2-b04226cf15f8（Thriller，US 1982 黑胶）
//   MusicBrainz 发行 6bc658fc-c2ad-38ec-a829-0cf8ffef53d8（Thriller，US 1982 CD）
//   MusicBrainz 发行 be701edc-c9c7-484a-9ed2-aeef051c19be（The Dark Side of the Moon，US 2016 CD 再版）
//   MusicBrainz recording 条目（ISRC、时长、performer / producer / writer 署名）
//   Cover Art Archive（封面 URL）、Wikipedia（ja 狂気 / zh 月之暗面 / zh 顫慄 官方译名）
//
// 只依赖 lib.mjs（不自己写 HTTP）。--dry-run 只打计划不写库。

import { Campaign, Client, Index, src } from "../lib.mjs";

// ── 证据 ────────────────────────────────────────────────────────────────
const S = {
  dsotmVinyl: src(
    "https://musicbrainz.org/release/b84ee12a-09ef-421b-82de-0441a926375b",
    "MusicBrainz 发行 b84ee12a（The Dark Side of the Moon，GB，1973-03-24，Harvest / SHVL 804，12 英寸黑胶 10 曲）：取发行日期、地区、品番、厂牌、载体格式、A1–B5 曲序与逐曲时长",
  ),
  dsotmCd: src(
    "https://musicbrainz.org/release/be701edc-c9c7-484a-9ed2-aeef051c19be",
    "MusicBrainz 发行 be701edc（The Dark Side of the Moon，US，2016，Pink Floyd Records / PFR8，条码 888751709126，CD 10 曲）：取再版品番、条码、日期与逐曲时长",
  ),
  thrillerVinyl: src(
    "https://musicbrainz.org/release/9c4c939e-5697-44d3-b2f2-b04226cf15f8",
    "MusicBrainz 发行 9c4c939e（Thriller，US，1982，Epic / HE 48112，条码 074644811216，12 英寸黑胶 9 曲）：取初版品番、条码、曲序与逐曲时长",
  ),
  thrillerCd: src(
    "https://musicbrainz.org/release/6bc658fc-c2ad-38ec-a829-0cf8ffef53d8",
    "MusicBrainz 发行 6bc658fc（Thriller，US，1982，Epic / EK 38112，条码 074643811224，CD 9 曲）：取 CD 品番、条码、曲序与逐曲时长",
  ),
  recordings: src(
    "https://musicbrainz.org/recording/f980fc14-e29b-481d-ad3a-5ed9b4ab6340",
    "MusicBrainz recording 条目（ISRC + artist relations）：逐条取出 ISRC 与演奏/制作署名（例 Billie Jean → USSM18200001，Michael Jackson 主唱、Quincy Jones 制作）",
  ),
  dsotmArtist: src(
    "https://musicbrainz.org/artist/83d91898-7763-47d7-b03b-b92132375c47",
    "MusicBrainz artist「Pink Floyd」条目：坐实团体身份、成员表（Syd Barrett / Roger Waters / Richard Wright / Nick Mason / David Gilmour 及各自在团年份）",
  ),
  mjArtist: src(
    "https://musicbrainz.org/artist/f27ec8db-af05-4f36-916e-3d57f91ecf5e",
    "MusicBrainz artist「Michael Jackson」条目：坐实艺人身份与 MusicBrainz 外部 ID",
  ),
  coverArt: src(
    "https://coverartarchive.org/release/b84ee12a-09ef-421b-82de-0441a926375b",
    "Cover Art Archive（MusicBrainz 官方封面库）发行 b84ee12a：取 Front 封面图 URL",
  ),
  coverArtCd: src(
    "https://coverartarchive.org/release/be701edc-c9c7-484a-9ed2-aeef051c19be",
    "Cover Art Archive 发行 be701edc：取 2016 US CD 版 Front 封面图 URL",
  ),
  wikiJa: src(
    "https://ja.wikipedia.org/wiki/狂気_(ピンク・フロイドのアルバム)",
    "日文维基「狂気 (ピンク・フロイドのアルバム)」：The Dark Side of the Moon 的日文官方题名「狂気」",
  ),
  wikiZhDsotm: src(
    "https://zh.wikipedia.org/wiki/月之暗面_(专辑)",
    "中文维基「月之暗面 (专辑)」（对应 en:The Dark Side of the Moon / ja:狂気）：中文官方题名「月之暗面」",
  ),
  wikiThriller: src(
    "https://zh.wikipedia.org/wiki/顫慄_(麥可·傑克森專輯)",
    "中文维基「顫慄 (麥可·傑克森專輯)」（对应 en:Thriller (album) / ja:スリラー）：中文官方题名「颤栗 / 顫慄」",
  ),
  wikiThrillerJa: src(
    "https://ja.wikipedia.org/wiki/スリラー_(アルバム)",
    "日文维基「スリラー (アルバム)」：Thriller 的日文官方题名「スリラー」",
  ),
};

const EV = {
  artist: (what, s) => ({ note: "编目：欧美流行/摇滚责任主体 agent（" + what + "）。依据 " + s.url, sources: [s] }),
  album: { note: "编目：专辑创作母体 Work（纯净题名，载体/版本信息落在 Release）；题名与官方译名取自 MusicBrainz release-group 与维基对应条目。", sources: [S.thrillerCd, S.wikiZhDsotm] },
  song: { note: "编目：歌曲创作母体 Work 与其录音 Expression；题名、时长、ISRC 逐条取自 MusicBrainz recording 条目。", sources: [S.recordings] },
  release: { note: "编目：专辑发行版 Release（品番/条码/日期/地区/包装取自 MusicBrainz 发行条目），subjects 声明该发行实际收录的全部 Work。", sources: [S.dsotmVinyl, S.thrillerCd] },
  medium: { note: "编目：发行内真实存在的载体 Medium（CD / 12 英寸黑胶），载体规格取自 MusicBrainz media。", sources: [S.dsotmVinyl, S.thrillerCd] },
  track: { note: "编目：载体内的曲目位置 Track，contents 指向该曲的录音 Expression（同一录音在 CD 与黑胶上复用同一 Expression）。", sources: [S.dsotmVinyl, S.thrillerCd] },
};

// ── 数据表（时长单位：秒；逐曲取自对应 MusicBrainz 发行条目）─────────────────
const A_DARK = {
  key: "dark-side-of-the-moon",
  title: "The Dark Side of the Moon",
  // 专辑 Work 的题名：不应与专辑内同名曲目 Work 撞题名（服务端与 lib 的查重都只看 kind+题名，
  // 撞名会让两条同 kind 实体被解析成同一个 id）。本专辑无同名曲目，故与专辑同名。
  workTitle: "The Dark Side of the Moon",
  workId: "01a0aaf4-facd-72cd-9b2f-e507ea7062f4",
  mbRg: "f5093c06-23e3-404f-aeaa-40f72885ee3a",
  translations: {
    "en-US": { title: "The Dark Side of the Moon" },
    "zh-CN": { title: "月之暗面" },
    "zh-TW": { title: "月之暗面" },
    "ja-JP": { title: "狂気" },
  },
  tracks: [
    { key: "speak", title: "Speak to Me", mb: "bef3fddb-5aca-49f5-b2fd-d56a23268d63", isrc: "GBAYE0300334", cd: 67.173, vinyl: 68.346, vnum: "A1" },
    { key: "breathe", title: "Breathe", mb: "ecbc7c9b-e79d-4ec8-ac77-44e4a7f7f1b8", isrc: "GBAYE0300335", cd: 169.533, vinyl: 168.72, vnum: "A2" },
    { key: "onrun", title: "On the Run", mb: "747a79a7-644e-42d4-be86-9adaf44393d8", isrc: "GBAYE0300336", cd: 225.386, vinyl: 230.6, vnum: "A3" },
    { key: "time", title: "Time", mb: "41959321-f2bb-4580-aa19-16248fe665d3", isrc: "GBAYE0300337", cd: 413.386, vinyl: 409.6, vnum: "A4" },
    { key: "greatgig", title: "The Great Gig in the Sky", mb: "73b01cea-2dad-4fc2-9e61-02a31477c1b1", isrc: "GBAYE0300338", cd: 284.066, vinyl: 284.133, vnum: "A5" },
    { key: "money", title: "Money", mb: "7fef22bd-76aa-4803-b56b-93a5d6e70662", isrc: "GBAYE0300339", cd: 383.2, vinyl: 382.746, vnum: "B1" },
    { key: "usandthem", title: "Us and Them", mb: "2d1201cf-59bb-4ffa-9f52-f5b3afa13346", isrc: "GBAYE0300340", cd: 469.226, vinyl: 469.853, vnum: "B2" },
    { key: "anycolour", title: "Any Colour You Like", mb: "7c278a16-ae04-460c-88ea-39155cadcd09", isrc: "GBAYE0300341", cd: 206.426, vinyl: 206.213, vnum: "B3" },
    { key: "braindamage", title: "Brain Damage", mb: "71c0e054-b700-4fd2-a35b-95c7afc566cb", isrc: "GBAYE0300342", cd: 226.666, vinyl: 226.933, vnum: "B4" },
    { key: "eclipse", title: "Eclipse", mb: "c46641c1-fdbc-4401-8b1d-23a4062a207a", isrc: "GBAYE0300343", cd: 132.6, vinyl: 131.546, vnum: "B5" },
  ],
  releases: [
    {
      key: "vinyl-1973",
      // 服务端按 (kind, 题名) 归并同名条目：实测同名 Release 的第二个 POST 会被当成重放，
      // 返回首条 id 并把第二个载体并进同一 Release。现实里同专辑的黑胶与 CD 是两条真实
      // 发行版，题名必须能区分，因此用官方载体名做后缀（不是编造规格，而是加上载体本身）。
      titleSuffix: " (12″ Vinyl)",
      attrs: { catalog_number: "SHVL 804", edition_date: "1973-03-24", edition_type: "standard", edition_batch: "first_press", country: "GB", packaging: "slipcase", distribution_channel: "physical" },
      mbid: "b84ee12a-09ef-421b-82de-0441a926375b",
      labelKey: "harvest",
      medium: { title: "12\" Vinyl", format: "vinyl", catalog_number: "SHVL 804", durationFrom: "vinyl", numberFrom: "vnum" },
      cover: { url: "http://coverartarchive.org/release/b84ee12a-09ef-421b-82de-0441a926375b/1611507818.jpg", caption: "The Dark Side of the Moon 1973 英国 Harves 首版黑胶封套", source: S.coverArt.url, srcObj: S.coverArt },
    },
    {
      key: "cd-2016",
      titleSuffix: " (CD)",
      attrs: { catalog_number: "PFR8", barcode: "888751709126", edition_date: "2016", edition_type: "standard", edition_batch: "reissue", country: "US", packaging: "jewel", distribution_channel: "physical" },
      mbid: "be701edc-c9c7-484a-9ed2-aeef051c19be",
      labelKey: "pinkfloydrecords",
      medium: { title: "CD", format: "cd", catalog_number: "PFR8", durationFrom: "cd", numberFrom: null },
      cover: { url: "https://coverartarchive.org/release/be701edc-c9c7-484a-9ed2-aeef051c19be/13160495709.jpg", caption: "The Dark Side of the Moon 2016 美国 Pink Floyd Records CD 封面", source: S.coverArtCd.url, srcObj: S.coverArtCd },
    },
  ],
};

const A_THRILLER = {
  key: "thriller",
  title: "Thriller",
  // 专辑母体内有一首同名曲目「Thriller」：两条 Work 都是真实的创作母体，但题名相同，
  // 服务端与 lib 的查重都按 (kind, 题名) 解析，会互相串。为避免二次编目时把专辑 Work
  // 错认成曲目 Work，专辑 Work 的实体题名带上载体消歧（Release 题名仍用官方专辑名）。
  workTitle: "Thriller (Michael Jackson album)",
  workId: "01a0aaf6-d75f-7bc4-be66-b0d62b8a32dd",
  mbRg: null,
  translations: {
    "en-US": { title: "Thriller" },
    "zh-CN": { title: "颤栗" },
    "zh-TW": { title: "顫慄" },
    "ja-JP": { title: "スリラー" },
  },
  tracks: [
    { key: "wanna", title: "Wanna Be Startin' Somethin'", mb: "2460a241-6ff4-49f1-80f9-36051534e9ae", isrc: "USSM18200005", cd: 363.466, vinyl: 364.0, vnum: "A1" },
    { key: "babybe", title: "Baby Be Mine", mb: "170f236a-f9e5-4632-8543-dd0142eaf242", isrc: "USSM19902987", cd: 260.733, vinyl: 261.0, vnum: "A2" },
    { key: "girlismine", title: "The Girl Is Mine", mb: "bdc55bab-f300-42f9-b2dc-10f035e536a9", isrc: "USSM18200004", cd: 222.493, vinyl: 222.0, vnum: "A3" },
    { key: "thrillersong", title: "Thriller", mb: "8403caf8-3714-46da-934c-1fe91a049540", isrc: "USSM18200002", cd: 359.866, vinyl: 359.0, vnum: "A4" },
    { key: "beatit", title: "Beat It", mb: "de798de6-70fc-49f6-b580-339cd2e62052", isrc: "USSM18200003", cd: 258.6, vinyl: 259.0, vnum: "B1" },
    { key: "billiejean", title: "Billie Jean", mb: "f980fc14-e29b-481d-ad3a-5ed9b4ab6340", isrc: "USSM18200001", cd: 294.4, vinyl: 294.0, vnum: "B2" },
    { key: "humannature", title: "Human Nature", mb: "40a43f5e-d4f4-4253-a42d-364d47208c64", isrc: "USSM18200399", cd: 246.24, vinyl: 246.0, vnum: "B3" },
    { key: "pyt", title: "P.Y.T. (Pretty Young Thing)", mb: "7e82e767-94a3-4b72-8d79-4623aa4ac584", isrc: "USSM19902993", cd: 239.226, vinyl: 239.0, vnum: "B4" },
    { key: "ladymylife", title: "The Lady in My Life", mb: "2bff76c1-0b98-4643-9ed3-063511ef9383", isrc: "USSM18200398", cd: 299.373, vinyl: 300.0, vnum: "B5" },
  ],
  releases: [
    {
      key: "vinyl-1982",
      // 后缀不进版本字段（载体规格已写在 Medium.attributes.format），只用它把黑胶与 CD 两条
      // 真实发行版在题名上区分开——同名 Release 会被服务端归并（实测见报告缺口清单）。
      titleSuffix: "（1982 年美国首版黑胶）",
      attrs: { catalog_number: "HE 48112", barcode: "074644811216", edition_date: "1982", edition_type: "standard", edition_batch: "first_press", country: "US", packaging: "slipcase", distribution_channel: "physical" },
      mbid: "9c4c939e-5697-44d3-b2f2-b04226cf15f8",
      labelKey: "epic",
      medium: { title: "12\" Vinyl", format: "vinyl", catalog_number: "HE 48112", durationFrom: "vinyl", numberFrom: "vnum" },
      cover: null,
    },
    {
      key: "cd-1982",
      titleSuffix: "（1982 年美国首版 CD）",
      attrs: { catalog_number: "EK 38112", barcode: "074643811224", edition_date: "1982", edition_type: "standard", edition_batch: "first_press", country: "US", packaging: "jewel", distribution_channel: "physical" },
      mbid: "6bc658fc-c2ad-38ec-a829-0cf8ffef53d8",
      labelKey: "epic",
      medium: { title: "CD", format: "cd", catalog_number: "EK 38112", durationFrom: "cd", numberFrom: null },
      cover: null,
    },
  ],
};

// ── 脚本体 ──────────────────────────────────────────────────────────────
const client = new Client();
await client.login();
const camp = new Campaign({ domain: "western-album", client, index: Index.load() });

const problems = [];
const note = (msg) => {
  const text = typeof msg === "string" ? msg : JSON.stringify(msg);
  problems.push(text);
  console.log("  !! " + text);
};

let drySeq = 0;
const mk = async (kind, title, spec, ev, opts) => {
  try {
    const out = await camp.ensureEntity(kind, title, spec, ev, opts);
    // lib.mjs 的 dry-run 分支给同 kind 同题名的实体同一个占位 id，会让关系两端被判成自环。
    if (out && typeof out.id === "string" && out.id.startsWith("DRY-") && opts && opts.idemKey) {
      out.id = "DRY-" + kind + "-" + (++drySeq) + "-" + opts.idemKey.replace(/^western-album-/, "");
    }
    return out;
  } catch (e) {
    note(kind + "「" + title + "」创建失败：" + (e.code ? e.http + " " + e.code : e.message));
    return null;
  }
};

// ── 1. agent（先查重，命中即复用）─────────────────────────────────────────
// mb = MusicBrainz 外部 ID；没有从 MusicBrainz artist/label 条目取到 ID 的一律留空，不虚构。
const AGENTS = [
  { key: "pinkfloyd", title: "Pink Floyd", type: "group", mb: "83d91898-7763-47d7-b03b-b92132375c47", zh: "平克·弗洛伊德", what: "乐队", s: S.dsotmArtist },
  { key: "rogerwaters", title: "Roger Waters", type: "person", mb: null, zh: "罗杰·沃特斯", what: "乐队成员（贝斯/主唱，1965–1985）", s: S.dsotmArtist },
  { key: "davidgilmour", title: "David Gilmour", type: "person", mb: null, zh: "大卫·吉尔摩", what: "乐队成员（吉他/主唱，1968-02-18 起）", s: S.dsotmArtist },
  { key: "richardwright", title: "Richard Wright", type: "person", mb: null, zh: "理查德·赖特", what: "乐队成员（键盘/主唱，1965–2008-09-15）", s: S.dsotmArtist },
  { key: "nickmason", title: "Nick Mason", type: "person", mb: null, zh: "尼克·梅森", what: "乐队成员（鼓，1965 起）", s: S.dsotmArtist },
  { key: "claretorry", title: "Clare Torry", type: "person", mb: null, zh: null, what: "「The Great Gig in the Sky」人声", s: S.recordings },
  { key: "michaeljackson", title: "Michael Jackson", type: "person", mb: "f27ec8db-af05-4f36-916e-3d57f91ecf5e", zh: "迈克尔·杰克逊", what: "歌手/创作者", s: S.mjArtist },
  { key: "quincyjones", title: "Quincy Jones", type: "person", mb: "5803c81e-739a-4057-9a5c-cf84e55db630", zh: "昆西·琼斯", what: "Thriller 制作人", s: src("https://musicbrainz.org/artist/5803c81e-739a-4057-9a5c-cf84e55db630", "MusicBrainz artist「Quincy Jones」条目：坐实制作人身份与外部 ID") },
  { key: "harvest", title: "Harvest Records", type: "organization", mb: "993af7f6-bb99-456b-83e7-5e728ea80a0e", zh: null, what: "DSOTM 1973 黑胶厂牌", s: src("https://musicbrainz.org/label/993af7f6-bb99-456b-83e7-5e728ea80a0e", "MusicBrainz label「Harvest」条目：坐实厂牌身份与外部 ID") },
  { key: "pinkfloydrecords", title: "Pink Floyd Records", type: "organization", mb: "96772f8e-b725-4f74-a053-921a573fa0e8", zh: null, what: "DSOTM 2016 CD 再版厂牌", s: src("https://musicbrainz.org/label/96772f8e-b725-4f74-a053-921a573fa0e8", "MusicBrainz label「Pink Floyd Records」条目：坐实再版厂牌身份与外部 ID") },
  { key: "epic", title: "Epic Records", type: "organization", mb: "8f638ddb-131a-4cc3-b3d4-7ebdac201b55", zh: null, what: "Thriller 发行厂牌", s: src("https://musicbrainz.org/label/8f638ddb-131a-4cc3-b3d4-7ebdac201b55", "MusicBrainz label「Epic」条目：坐实厂牌身份与外部 ID") },
];

const agent = {};
for (const a of AGENTS) {
  const spec = {
    original_language: "en",
    types: [a.type],
    attributes: {},
    translations: Object.assign({}, a.zh ? { "zh-CN": { title: a.zh }, "zh-TW": { title: a.zh } } : {}, { "en-US": { title: a.title } }),
  };
  if (a.mb) spec.external_ids = { musicbrainz: a.mb };
  agent[a.key] = await mk("agent", a.title, spec, EV.artist(a.what, a.s), { idemKey: "western-album-agent-" + a.key });
}

// ── 2./3./4. 专辑 Work / 曲目 Work → ContentUnit → Expression ──────────────
const albums = {};
const tracksOf = {};

async function buildAlbum(album) {
  const w = await mk("work", album.workTitle, {
    original_language: "en",
    types: ["album"],
    translations: album.translations,
    // external_ids 的键必须来自 GET /api/catalog/external-databases；musicbrainz 的校验是 UUID。
    external_ids: album.mbRg ? { musicbrainz: album.mbRg } : {},
    attributes: { tags: ["rock", "album"] },
  }, EV.album, { idemKey: "western-album-work-" + album.key });
  if (!w) return;
  albums[album.key] = w;
  const map = {};
  for (const t of album.tracks) {
    const song = await mk("work", t.title, {
      original_language: "en",
      types: ["song"],
      translations: { "en-US": { title: t.title } },
      external_ids: { musicbrainz: t.mb },
      attributes: { tags: ["song"] },
    }, EV.song, { idemKey: "western-album-song-" + album.key + "-" + t.key });
    if (!song) continue;
    const cu = await mk("content_unit", t.title, {
      work_id: song.id,
      position: 0,
      number: "",
      original_language: "en",
      types: ["content_unit"],
      translations: { "en-US": { title: t.title } },
      attributes: { language: "en", entry_role: "main" },
    }, EV.song, { idemKey: "western-album-cu-" + album.key + "-" + t.key, allowServerLookup: false, scope: { work_id: song.id } });
    if (!cu) continue;
    const expr = await mk("expression", t.title, {
      work_id: song.id,
      content_unit_id: cu.id,
      position: 0,
      original_language: "en",
      types: ["expression"],
      translations: { "en-US": { title: t.title } },
      attributes: { language: "en", duration: t.cd, isrc: t.isrc, version_label: "studio" },
    }, EV.song, { idemKey: "western-album-expr-" + album.key + "-" + t.key, allowServerLookup: false, scope: { work_id: song.id } });
    map[t.key] = { song, cu, expr, t };
  }
  tracksOf[album.key] = map;
}

for (const album of [A_DARK, A_THRILLER]) await buildAlbum(album);

// ── 5./6./7. Release → Medium → Track → contents[] ────────────────────────
// 结构实体（篇目/表达/载体/曲目）题名高度重复，必须带父级作用域查重，否则会误复用别人的条目。
const allOfKind = async (kind) => {
  const out = [];
  let off = 0;
  for (;;) {
    const r = await client.call("/api/catalog/entities?kind=" + kind + "&limit=50&offset=" + off);
    const items = (r.body && r.body.items) || [];
    out.push(...items);
    if (items.length < 50) return out;
    off += 50;
  }
};

/** 按 (kind, 题名) 找活体实体；命中已软删除的同名条目时，用 PUT 把它改回 published
 *  （服务端按 (kind, 题名) 归并，同名重建会被拿去当成重放，只能原地恢复）。 */
const findLive = async (kind, title) => {
  const rows = (await allOfKind(kind)).filter((x) => x.title === title);
  return rows.length ? rows[rows.length - 1] : null;
};

const releases = {};
const mediums = {};

async function buildRelease(album, r) {
  const map = tracksOf[album.key] || {};
  const releaseTitle = album.title + r.titleSuffix;
  const subjects = [{ work_id: albums[album.key].id, role: "primary", position: 0 }];
  for (const t of album.tracks) {
    if (map[t.key] && map[t.key].song) subjects.push({ work_id: map[t.key].song.id, role: "compilation", position: subjects.length });
  }
  const attrs = Object.assign({}, r.attrs);
  if (agent[r.labelKey]) attrs.publisher = agent[r.labelKey].id;
  const translations = {};
  for (const [loc, tr] of Object.entries(album.translations)) translations[loc] = { title: tr.title + r.titleSuffix };
  const spec = {
    kind: "release",
    title: releaseTitle,
    status: "published",
    original_language: "en",
    types: ["release"],
    translations,
    attributes: attrs,
    external_ids: { musicbrainz: r.mbid },
    subjects,
  };
  if (r.cover) spec.pictures = [{ url: r.cover.url, caption: { "zh-CN": r.cover.caption }, source: { kind: "url", citation: "Cover Art Archive 封面（" + r.cover.caption + "）", url: r.cover.source } }];
  const payload = Object.assign({}, spec);
  delete payload.kind; delete payload.title; delete payload.status;

  let rel = await findLive("release", releaseTitle);
  if (rel && rel.status !== "published") {
    // PUT 是整实体替换：先读全量，只改需要改的字段，其余原样带回。
    const cur = await camp.getEntity(rel.id);
    const entity = {};
    for (const k of ["id", "kind", "title", "original_language", "translations", "types", "attributes", "external_ids", "pictures", "created_by", "subjects"]) if (cur[k] !== undefined) entity[k] = cur[k];
    Object.assign(entity, payload, { status: "published" });
    const r2 = await client.call("/api/catalog/entities/" + rel.id, { method: "PUT", body: { entity, expected_version: cur.version, edit_note: "恢复 western-album 领域被前一轮清理误停用的发行（" + releaseTitle + "）", sources: [S.dsotmVinyl, S.thrillerCd] } });
    if (r2.status >= 400) note("恢复发行 " + releaseTitle + " 失败：" + r2.status + " " + JSON.stringify(r2.body).slice(0, 160));
    else { rel = r2.body; console.log("entity | restored | release | " + releaseTitle + " | " + rel.id); }
  }
  if (!rel) rel = await mk("release", releaseTitle, payload, EV.release, { idemKey: "western-album-release-" + album.key + "-" + r.key, allowServerLookup: false });
  if (!rel) return null;
  releases[album.key + "/" + r.key] = rel;

  // Medium：按 (release_id, 题名) 查重
  const medTitle = r.medium.title;
  let med = (await allOfKind("medium")).find((m) => m.release_id === rel.id && m.title === medTitle);
  if (!med) {
    med = await mk("medium", medTitle, {
      release_id: rel.id,
      position: 0,
      original_language: "en",
      types: ["medium"],
      translations: { "en-US": { title: medTitle } },
      attributes: { format: r.medium.format, role: "primary", catalog_number: r.medium.catalog_number },
    }, EV.medium, { idemKey: "western-album-medium-" + album.key + "-" + r.key, allowServerLookup: false, scope: { release_id: rel.id } });
  }
  if (!med) return rel;
  mediums[album.key + "/" + r.key] = med;

  // Track：按 (medium_id, position) 查重，contents 指向对应录音 Expression
  const existing = (await allOfKind("track")).filter((t) => t.medium_id === med.id);
  for (let i = 0; i < album.tracks.length; i++) {
    const t = album.tracks[i];
    const s = map[t.key];
    if (!s || !s.expr) continue;
    if (existing.some((x) => x.position === i)) continue;
    await mk("track", t.title, {
      medium_id: med.id,
      position: i,
      number: r.medium.numberFrom ? t[r.medium.numberFrom] : String(i + 1),
      original_language: "en",
      types: ["track"],
      translations: { "en-US": { title: t.title } },
      attributes: { duration: t[r.medium.durationFrom], role: "primary" },
      contents: [{ expression_id: s.expr.id, position: 0, locator: null }],
    }, EV.track, { idemKey: "western-album-track-" + album.key + "-" + r.key + "-" + t.key, allowServerLookup: false, scope: { release_id: rel.id, medium_id: med.id } });
  }
  return rel;
}

for (const album of [A_DARK, A_THRILLER]) {
  for (const r of album.releases) await buildRelease(album, r);
}

// ── 8. 关系 ──────────────────────────────────────────────────────────────
// 关系属性字段由 definitions 声明：role / character_rank 是词表 enum，自由文本只能进
// credit_role；把乐器、职位等塞进 role 会被 role: invalid_term 拒绝。
const R = {
  unit: { role: "primary", credit_role: "album tracklist" },
  albumBy: { role: "primary", credit_role: "album recording" },
  albumProd: { role: "primary", credit_role: "producer" },
  albumSong: { role: "primary", credit_role: "songwriter" },
  writer: { role: "primary", credit_role: "songwriter" },
  composer: { role: "primary", credit_role: "composer" },
  vocals: { role: "primary", credit_role: "lead vocals" },
  player: { role: "primary", credit_role: "performer" },
  drummer: { role: "primary", credit_role: "drums" },
  keys: { role: "primary", credit_role: "keyboards" },
  guitar: { role: "primary", credit_role: "guitar" },
  bass: { role: "primary", credit_role: "bass guitar" },
  label: { role: "primary", credit_role: "label" },
  repress: { role: "primary", credit_role: "reissue" },
  sameYear: { role: "primary", credit_role: "same-year pressing" },
};
const REL = [];
const rel = async (type, s, t, attributes, noteText) => {
  if (!s || !t) { note("跳过关系 " + type + "：端点缺失"); return null; }
  try {
    const r = await camp.createRelation(type, s.id, t.id, { note: noteText, sources: [S.recordings, S.dsotmVinyl] }, { attributes });
    REL.push({ type, source: s.id, target: t.id, id: r && r.id });
    return r;
  } catch (e) {
    note("关系 " + type + " 创建失败：" + (e.code ? e.http + " " + e.code : e.message));
    return null;
  }
};

const dark = albums["dark-side-of-the-moon"];
const thrill = albums["thriller"];
const darkVinyl = releases["dark-side-of-the-moon/vinyl-1973"];
const darkCd = releases["dark-side-of-the-moon/cd-2016"];
const thrillVinyl = releases["thriller/vinyl-1982"];
const thrillCd = releases["thriller/cd-1982"];
const d = tracksOf["dark-side-of-the-moon"] || {};
const th = tracksOf["thriller"] || {};

// 8a. pressing_of：同一录音母带的两个载体版本（黑胶 ↔ CD）
await rel("pressing_of", darkCd, darkVinyl, R.repress,
  "The Dark Side of the Moon 的 2016 CD 再版与 1973 黑胶首版：MusicBrainz 两版逐曲共享同一 recording，故同一 Expression 被两个 Release 复用，用 pressing_of 关联两个载体版本");
await rel("pressing_of", thrillVinyl, thrillCd, R.sameYear,
  "Thriller 1982 年初版同时发行 12 英寸黑胶（Epic HE 48112）与 CD（Epic EK 38112）：pressing_of 关联两个载体版本");

// 8b. includes：专辑母体包含曲目母体
for (const t of A_DARK.tracks) {
  if (d[t.key]) await rel("includes", dark, d[t.key].song, R.unit,
    "The Dark Side of the Moon 专辑母体包含曲目「" + t.title + "」（MusicBrainz 发行 b84ee12a 曲序 " + t.vnum + " 坐实）");
}
for (const t of A_THRILLER.tracks) {
  if (th[t.key]) await rel("includes", thrill, th[t.key].song, R.unit,
    "Thriller 专辑母体包含曲目「" + t.title + "」（MusicBrainz 发行 9c4c939e 曲序 " + t.vnum + " 坐实）");
}

// 8c. credits：创作与表演
await rel("composed_by", dark, agent.pinkfloyd, R.albumBy,
  "The Dark Side of the Moon 由 Pink Floyd 集体创作演奏（MusicBrainz 发行条目 artist credit 为 Pink Floyd）");
await rel("created_by", dark, agent.pinkfloyd, R.albumProd,
  "MusicBrainz recording relations 记 Pink Floyd 为 The Dark Side of the Moon 各曲 producer");
await rel("composed_by", thrill, agent.michaeljackson, R.albumSong,
  "Thriller 由 Michael Jackson 主演并参与词曲创作（MusicBrainz 发行条目 artist credit 为 Michael Jackson）");
await rel("created_by", thrill, agent.quincyjones, R.albumProd,
  "MusicBrainz recording relations 记 Quincy Jones 为 Thriller 多曲（Billie Jean / Beat It / The Girl Is Mine）producer");
await rel("lyricist_of", d["time"].song, agent.rogerwaters, R.writer,
  "「Time」由 Roger Waters 作词（MusicBrainz recording relations writer 署名）");
await rel("composed_by", d["greatgig"].song, agent.richardwright, R.composer,
  "「The Great Gig in the Sky」由 Richard Wright 作曲（MusicBrainz recording relations writer 署名）");
await rel("performed_by", d["greatgig"].song, agent.claretorry, R.vocals,
  "「The Great Gig in the Sky」人声由 Clare Torry 演唱（MusicBrainz recording relations：lead vocals）");
await rel("performed_by", d["money"].song, agent.pinkfloyd, R.player,
  "「Money」由 Pink Floyd 演奏（MusicBrainz recording relations 逐乐器署名：Gilmour / Mason / Waters / Wright）");
await rel("performed_by", d["eclipse"].song, agent.pinkfloyd, R.player,
  "「Eclipse」由 Pink Floyd 演奏（MusicBrainz recording relations）");
await rel("performed_by", th["billiejean"].song, agent.michaeljackson, R.vocals,
  "「Billie Jean」由 Michael Jackson 主唱并共同制作（MusicBrainz recording relations：lead vocals）");
await rel("performed_by", th["girlismine"].song, agent.michaeljackson, R.vocals,
  "「The Girl Is Mine」由 Michael Jackson 主唱（MusicBrainz recording relations：lead vocals）");
await rel("created_by", th["beatit"].song, agent.quincyjones, R.albumProd,
  "「Beat It」由 Quincy Jones 制作（MusicBrainz recording relations producer）");

// 8d. membership：乐队成员（乐器写进 credit_role，role 只取词表值）
await rel("member_of", agent.rogerwaters, agent.pinkfloyd, Object.assign({ begin_date: "1965", end_date: "1985" }, R.bass),
  "Roger Waters 1965 年入组、1985 年离队（MusicBrainz artist relations member of band）");
await rel("member_of", agent.davidgilmour, agent.pinkfloyd, Object.assign({ begin_date: "1968-02-18" }, R.guitar),
  "David Gilmour 1968-02-18 入组（MusicBrainz artist relations member of band）");
await rel("member_of", agent.richardwright, agent.pinkfloyd, Object.assign({ begin_date: "1965", end_date: "2008-09-15" }, R.keys),
  "Richard Wright 1965 年入组、2008-09-15 离世（MusicBrainz artist relations member of band）");
await rel("member_of", agent.nickmason, agent.pinkfloyd, Object.assign({ begin_date: "1965" }, R.drummer),
  "Nick Mason 1965 年入组至今（MusicBrainz artist relations member of band）");

// 8e. 发行者署名
await rel("credit_for", darkVinyl, agent.harvest, R.label,
  "The Dark Side of the Moon 1973 GB 黑胶由 Harvest 发行（MusicBrainz 发行 b84ee12a label-info：Harvest / SHVL 804）");
await rel("credit_for", darkCd, agent.pinkfloydrecords, R.label,
  "The Dark Side of the Moon 2016 US CD 由 Pink Floyd Records 发行（MusicBrainz 发行 be701edc label-info：Pink Floyd Records / PFR8）");
await rel("credit_for", thrillCd, agent.epic, R.label,
  "Thriller 1982 US CD 由 Epic 发行（MusicBrainz 发行 6bc658fc label-info：Epic / EK 38112）");
await rel("credit_for", thrillVinyl, agent.epic, R.label,
  "Thriller 1982 US 黑胶由 Epic 发行（MusicBrainz 发行 9c4c939e label-info：Epic / HE 48112）");

// ── 写后回读断言（结构归属 / subjects / 关系两端 / revisions）────────────────
const checks = { total: 0, passed: 0 };
const assert = (ok, label) => {
  checks.total++;
  if (ok) { checks.passed++; return true; }
  note("断言失败：" + label);
  return false;
};
const isDry = camp.rows.some((r) => r.status === "dry-run");

if (!isDry) {
  // A. 创作链：ContentUnit / Expression 的 work_id、Expression 无 parent、必带时长与 ISRC
  for (const albumKey of Object.keys(tracksOf)) {
    for (const k of Object.keys(tracksOf[albumKey])) {
      const s = tracksOf[albumKey][k];
      if (!s || !s.cu || !s.expr) continue;
      const cu = await camp.getEntity(s.cu.id);
      const ex = await camp.getEntity(s.expr.id);
      assert(cu.kind === "content_unit" && cu.work_id === s.song.id, "content_unit「" + k + "」应归属曲目 Work");
      assert(ex.kind === "expression" && ex.work_id === s.song.id, "expression「" + k + "」应归属曲目 Work");
      assert(ex.content_unit_id === cu.id, "expression「" + k + "」的 content_unit_id 应指向同 Work 的篇目");
      assert(!ex.parent_id, "expression「" + k + "」不应有 parent_id");
      assert(ex.attributes && typeof ex.attributes.duration === "number", "expression「" + k + "」应带数值时长");
      assert(ex.attributes && typeof ex.attributes.isrc === "string", "expression「" + k + "」应带 ISRC");
    }
  }
  // B. 承载链：release 不含 work_id、subjects 覆盖全部曲目 Work、medium 归属正确
  for (const [key, r] of Object.entries(releases)) {
    const albumKey = key.split("/")[0];
    const full = await camp.getEntity(r.id);
    assert(full.kind === "release" && !full.work_id, "release「" + key + "」不应挂 work_id");
    assert(full.status === "published", "release「" + key + "」应为 published");
    const covered = new Set((full.subjects || []).map((x) => x.work_id));
    // 专辑母体以发行自己声明的 primary 为准：本题材里存在两条同名 Work（专辑 [album] 与同名曲目
    // [song]），Index 的精确题名匹配可能返回任一 id，拿脚本内存里的 id 去比会误报。
    const primary = (full.subjects || []).find((x) => x.role === "primary");
    assert(!!primary && !!albums[albumKey] && primary.work_id === albums[albumKey].id, "release「" + key + "」的 primary subject 应是专辑 Work（实际 " + (primary ? primary.work_id.slice(0, 13) : "缺") + "）");
    let miss = 0;
    for (const t of Object.keys(tracksOf[albumKey])) {
      const s = tracksOf[albumKey][t];
      if (s && s.song && !covered.has(s.song.id)) miss++;
    }
    assert(miss === 0, "release「" + key + "」的 subjects 缺 " + miss + " 个曲目 Work");
    const med = mediums[key];
    if (med) {
      const m = await camp.getEntity(med.id);
      assert(m.release_id === r.id, "medium「" + key + "」的 release_id 应指向对应发行");
      assert(m.attributes && ["cd", "vinyl"].includes(m.attributes.format), "medium「" + key + "」应带词表内 format");
      const tracks = (await allOfKind("track")).filter((t) => t.medium_id === med.id);
      const expect = albumKey === "dark-side-of-the-moon" ? A_DARK.tracks.length : A_THRILLER.tracks.length;
      assert(tracks.length === expect, "medium「" + key + "」的 Track 数应为 " + expect + "，实际 " + tracks.length);
      for (const t of tracks.slice(0, 3)) {
        const full2 = await camp.getEntity(t.id);
        const c = (full2.contents || [])[0];
        assert(!!c && !!c.expression_id, "track「" + full2.title + "」的 contents 应指向 Expression");
        if (c) {
          const ex = await camp.getEntity(c.expression_id);
          const song = Object.values(tracksOf[albumKey]).find((x) => x.expr && x.expr.id === c.expression_id);
          assert(!!song && ex.work_id === song.song.id, "track「" + full2.title + "」收录的 Expression 应归属其曲目 Work");
        }
      }
    }
  }
  // C. 跨发行复用：DSOTM 的「Money」Expression 出现在黑胶与 CD 两个 Release 的 Track 上
  const money = d["money"];
  if (money && money.expr) {
    const occ = await client.call("/api/catalog/entities/" + money.expr.id + "/occurrences");
    const items = (occ.body && occ.body.items) || [];
    assert(items.length >= 2, "「Money」的 Expression 应被 ≥2 个载体位置复用（occurrences=" + items.length + "）");
  }
  // D. 关系两端 + revisions
  for (const r of REL) {
    if (!r.id) continue;
    const rels = await client.relationsOf(r.source);
    assert(rels.some((x) => x.id === r.id && x.target_id === r.target && x.type === r.type), "关系 " + r.type + " " + String(r.id).slice(0, 8) + " 应能在源端回读且两端一致");
  }
  for (const w of [albums["dark-side-of-the-moon"], albums["thriller"]].filter(Boolean)) {
    const rev = await client.call("/api/catalog/entities/" + w.id + "/revisions");
    assert(rev.status === 200 && Array.isArray(rev.body && rev.body.items) && rev.body.items.length >= 1, "work「" + w.title + "」应有 ≥1 条 revision");
  }
  for (const r of Object.values(releases)) {
    const full = await camp.getEntity(r.id);
    assert(typeof full.version === "number" && full.version >= 1, "release「" + r.title + "」应有 version");
    const rev = await client.call("/api/catalog/entities/" + r.id + "/revisions");
    assert(rev.status === 200 && Array.isArray(rev.body && rev.body.items) && rev.body.items.length >= 1, "release「" + r.title + "」应有 ≥1 条 revision");
  }
}

// ── 汇总 ────────────────────────────────────────────────────────────────
camp.summary({
  relations: { created: REL.length, byType: REL.reduce((m, r) => { m[r.type] = (m[r.type] || 0) + 1; return m; }, {}) },
  assertions: checks,
  problems,
});
console.log("回读断言：" + checks.passed + "/" + checks.total + " 通过，问题 " + problems.length + " 条");
if (problems.length) {
  console.log("问题清单：");
  for (const p of problems) console.log(" - " + p);
}
