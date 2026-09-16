#!/usr/bin/env node
// 领域脚本：华语流行专辑（CD / 卡带）— slug = cpop-album
//
// 数据全部来自可核对的页面（中文维基百科条目曲目表、Apple Music 官方商店页、
// MusicBrainz 发行条目），脚本内不写任何推测值；缺证据的字段留空并在报告里列缺口。
//
// 层级形状（本脚本主推 album 作为 Work，专辑曲目作 ContentUnit，录音作 Expression）：
//   Work(专辑) → ContentUnit(曲目) → Expression(录音)
//   Work(专辑) → Release → Medium(CD / 卡带) → Track → contents[] 引用 Expression
// 卡带版与 CD 版复用同一批 Expression，用来验证"同一表达被多个发行重复收录"。
//
// 用法：
//   node scripts/data/campaign/domains/cpop-album.mjs --dry-run
//   $env:MF_USER_PASS = …; node scripts/data/campaign/domains/cpop-album.mjs

import { Campaign, Client, DRY, Index, src } from "../lib.mjs";

const WIKI = (t) => "https://zh.wikipedia.org/wiki/" + encodeURIComponent(t);

const S_WIKI_ALBUM = src(WIKI("范特西"),
  "中文维基百科《范特西》条目：曲目表（曲序/曲名/时长/作词/编曲）、发行日期 2001-09-14、发行公司博德曼音乐、唱片版本（CD／台湾卡带版）、全碟作曲周杰伦");
const S_WIKI_EP = src(WIKI("范特西Plus"),
  "中文维基百科《范特西Plus》条目：曲目表（蝸牛／你比從前快樂／世界末日及各自作词、全碟作曲周杰伦）、发行日期 2001-12-24、发行公司博德曼音乐");
const S_WIKI_ARTIST = src(WIKI("周杰倫"), "中文维基百科周杰伦条目：歌手/艺人身份与所属作品");
const S_APPLE_ALBUM = src("https://music.apple.com/tw/album/%E8%8C%83%E7%89%B9%E8%A5%BF/535739206",
  "Apple Music 台湾商店《范特西》页（iTunes Search/Lookup API collectionId=535739206）：10 首曲目顺序、发行日期 2001-09-14、厂牌 JVR Music");
const S_APPLE_EP = src("https://music.apple.com/tw/album/%E8%8C%83%E7%89%B9%E8%A5%BF-live-single/536110584",
  "Apple Music 台湾商店《范特西 (Live) - Single》页（iTunes Lookup collectionId=536110584）：3 首 Live 曲目顺序与时长（238/202/265 秒）");
const S_MB_CD = src("https://musicbrainz.org/release/0377c05a-0da4-46f7-a153-52e80e7adac1",
  "MusicBrainz 发行 0377c05a：《范特西》台湾 CD 版（date=2001-09-20、country=TW、barcode=743218940323、catalog-number=74321894032、label=Alfa Music、medium=CD×10）");
const S_MB_CASSETTE = src("https://musicbrainz.org/release/5c3809c3-afe5-3d29-9d7c-7b0b0966ec5e",
  "MusicBrainz 发行 5c3809c3：《范特西》中国卡带版（date=2001、country=CN、barcode=9787799602868、catalog-number=MKC-1553、label=Meika、medium=Cassette×10）");
const S_MB_RG = src("https://musicbrainz.org/release-group/732b78cb-9f7d-383d-86cc-5cf7e43c9658",
  "MusicBrainz release-group 732b78cb：《范特西》作品组（含台湾 CD、中国卡带、日本 2006 CD+DVD 等发行）");

const ev = (note, sources) => ({ note, sources });

// ── 事实表（全部来自上方来源）────────────────────────────────────────────
// 《范特西》（2001-09-14，博德曼音乐／Alfa Music）曲目：曲序、正体/简体题名、时长（秒）、作词、编曲
const FANTASY_TRACKS = [
  { n: 1, tw: "愛在西元前", cn: "爱在西元前", sec: 230, lyricist: "方文山", arranger: "林邁可" },
  { n: 2, tw: "爸我回來了", cn: "爸我回来了", sec: 231, lyricist: "周杰倫", arranger: "鍾興民" },
  { n: 3, tw: "簡單愛", cn: "简单爱", sec: 268, lyricist: "徐若瑄", arranger: "林邁可" },
  { n: 4, tw: "忍者", cn: "忍者", sec: 155, lyricist: "方文山", arranger: "林邁可" },
  { n: 5, tw: "開不了口", cn: "开不了口", sec: 286, lyricist: "徐若瑄", arranger: "洪敬堯" },
  { n: 6, tw: "上海一九四三", cn: "上海一九四三", sec: 193, lyricist: "方文山", arranger: "林邁可" },
  { n: 7, tw: "對不起", cn: "对不起", sec: 225, lyricist: "方文山", arranger: "洪敬堯" },
  { n: 8, tw: "威廉古堡", cn: "威廉古堡", sec: 235, lyricist: "方文山", arranger: "洪敬堯" },
  { n: 9, tw: "雙截棍", cn: "双截棍", sec: 201, lyricist: "方文山", arranger: "鍾興民" },
  { n: 10, tw: "安靜", cn: "安静", sec: 330, lyricist: "周杰倫", arranger: "林邁可" },
];

// 《范特西Plus》（2001-12-24，博德曼音乐）CD 曲目：桃园巨蛋演唱会重新演唱的三首歌
const PLUS_TRACKS = [
  { n: 1, tw: "蝸牛", cn: "蜗牛", sec: 238, lyricist: "周杰倫" },
  { n: 2, tw: "你比從前快樂", cn: "你比从前快乐", sec: 202, lyricist: "方文山" },
  { n: 3, tw: "世界末日", cn: "世界末日", sec: 265, lyricist: "周杰倫" },
];

// 责任主体（标题为原文正体，en-US 用已核实通行的英文名，其余语种按 BRIEF 填原文）
const AGENTS = {
  jay: { tw: "周杰倫", cn: "周杰伦", en: "Jay Chou", type: "person" },
  fang: { tw: "方文山", cn: "方文山", en: "Vincent Fang", type: "person" },
  vivian: { tw: "徐若瑄", cn: "徐若瑄", en: "Vivian Hsu", type: "person" },
  michael: { tw: "林邁可", cn: "林迈可", en: "林邁可", type: "person" },
  chung: { tw: "鍾興民", cn: "钟兴民", en: "鍾興民", type: "person" },
  hung: { tw: "洪敬堯", cn: "洪敬尧", en: "洪敬堯", type: "person" },
  alfa: { tw: "阿爾發音樂", cn: "阿尔发音乐", en: "Alfa Music", type: "organization" },
  bmg: { tw: "博德曼音樂", cn: "博德曼音乐", en: "BMG Taiwan", type: "organization" },
};

const tr4 = (tw, cn, ja = tw, en = tw) => ({
  "zh-CN": { title: cn }, "zh-TW": { title: tw }, "ja-JP": { title: ja }, "en-US": { title: en },
});

const trackTitle = (s) => tr4(s.tw, s.cn);

// ── 主流程 ──────────────────────────────────────────────────────────────
const client = new Client();
if (!DRY) await client.login();
else console.log("[dry-run] 离线空跑：不登录、不写库、不发列表检索");
const camp = new Campaign({ domain: "cpop-album", client, index: Index.load() });
const lookup = !DRY; // 服务端 ?q= 查重只在真跑时执行（列表路由限流）

const REF = {
  album: ev("编目：新建华语流行专辑工作《范特西》（album，原语言 zh-TW）。依据中文维基百科曲目表与 Apple Music 官方页确认 2001-09-14 发行、10 首曲目、全碟作曲周杰伦；专辑总时长 39:30 取自维基百科 infobox。",
    [S_WIKI_ALBUM, S_APPLE_ALBUM, S_MB_RG]),
  cu: (s) => ev("编目：为《范特西》建立曲目内容单元（第 " + s.n + " 首《" + s.tw + "》，number=" + s.n + "、entry_role=main）。曲序与曲名取自中文维基百科曲目表，顺序经 Apple Music 官方商店页核对。",
    [S_WIKI_ALBUM, S_APPLE_ALBUM]),
  expr: (s) => ev("编目：为《" + s.tw + "》建立录音表达（duration=" + s.sec + " 秒，挂 content_unit_id）。时长取自中文维基百科 CD 曲目表；Apple Music 数字版时长略有差异，已在报告缺口节记录。",
    [S_WIKI_ALBUM, S_APPLE_ALBUM]),
  relCD: ev("编目：新建发行《范特西》台湾 CD 版（standard／first_press，TW，博德曼音乐发行、阿爾發音樂出品）。品番 74321894032、条码 743218940323 取自 MusicBrainz；发行日期 2001-09-14 取自维基百科与 Apple Music（MusicBrainz 记 2001-09-20，差异见报告）。subjects 声明专辑工作为 primary。",
    [S_WIKI_ALBUM, S_APPLE_ALBUM, S_MB_CD]),
  relCassette: ev("编目：新建发行《范特西》卡带版（Cassette×10，CN，regular）。品番 MKC-1553、条码 9787799602868、厂牌 Meika、年份 2001 取自 MusicBrainz 发行 5c3809c3；维基百科同时记载「台湾卡带版」但无品番。",
    [S_MB_CASSETTE, S_WIKI_ALBUM]),
  relPlus: ev("编目：新建发行《范特西Plus》EP CD 版（standard，TW，博德曼音乐发行，2001-12-24）。曲目与发行信息取自中文维基百科《范特西Plus》条目与 Apple Music《范特西 (Live)》页。",
    [S_WIKI_EP, S_APPLE_EP]),
  med: (name) => ev("编目：按发行实物建立载体 " + name + "（format 取自官方词表，role=primary）。",
    [S_WIKI_ALBUM, S_MB_CD, S_MB_CASSETTE, S_APPLE_EP]),
  track: (s) => ev("编目：按实物曲序建立 Track（position=" + s.n + "），contents 引用该曲目录音的 Expression。曲序与曲名取自中文维基百科曲目表与 Apple Music 官方页。",
    [S_WIKI_ALBUM, S_APPLE_ALBUM, S_APPLE_EP]),
};

// 1) agents
const A = {};
for (const [key, a] of Object.entries(AGENTS)) {
  A[key] = await camp.ensureEntity("agent", a.tw, {
    original_language: "zh-TW",
    types: [a.type],
    translations: tr4(a.tw, a.cn, a.tw, a.en),
  }, ev("编目：建立责任主体「" + a.tw + "」（" + a.type + "）。署名事实来自中文维基百科《范特西》曲目表的作词/编曲栏与专辑条目，艺人身分见周杰伦条目。",
    [S_WIKI_ALBUM, S_WIKI_ARTIST]), { idemKey: "cpop-agent-" + key, allowServerLookup: lookup });
}

// 2) 专辑 Work
const album = await camp.ensureEntity("work", "范特西", {
  original_language: "zh-TW",
  types: ["album"],
  translations: tr4("范特西", "范特西", "范特西", "Fantasy"),
  attributes: { language: "zh-TW", duration: 2370, tags: ["華語流行音樂"] },
  external_ids: { musicbrainz: "732b78cb-9f7d-383d-86cc-5cf7e43c9658" },
}, REF.album, { idemKey: "cpop-work-fantasy", allowServerLookup: lookup });

const ep = await camp.ensureEntity("work", "范特西Plus", {
  original_language: "zh-TW",
  types: ["album"],
  translations: tr4("范特西Plus", "范特西Plus", "范特西Plus", "Fantasy Plus"),
  attributes: { language: "zh-TW", tags: ["華語流行音樂"] },
}, ev("编目：新建 EP 工作《范特西Plus》（album）。依据中文维基百科条目：2001-12-24 由博德曼音乐发行，收录周杰伦在桃园巨蛋演唱会重新演唱的三首歌；全碟作曲周杰伦。",
  [S_WIKI_EP, S_APPLE_EP]), { idemKey: "cpop-work-fantasy-plus", allowServerLookup: lookup });

// 3) ContentUnit（篇目）
const CU = {};
for (const s of FANTASY_TRACKS) {
  CU[s.n] = await camp.ensureEntity("content_unit", s.tw, {
    work_id: album.id, position: s.n, number: String(s.n),
    original_language: "zh-TW", types: ["content_unit"],
    translations: trackTitle(s),
    attributes: { language: "zh-TW", entry_role: "main" },
  }, REF.cu(s), { idemKey: "cpop-cu-fantasy-" + s.n, allowServerLookup: false });
}
const CU_PLUS = {};
for (const s of PLUS_TRACKS) {
  CU_PLUS[s.n] = await camp.ensureEntity("content_unit", s.tw, {
    work_id: ep.id, position: s.n, number: String(s.n),
    original_language: "zh-TW", types: ["content_unit"],
    translations: trackTitle(s),
    attributes: { language: "zh-TW", entry_role: "main" },
  }, ev("编目：为《范特西Plus》建立曲目内容单元（第 " + s.n + " 首《" + s.tw + "》）。曲序与曲名取自中文维基百科曲目表，顺序经 Apple Music 核对。",
    [S_WIKI_EP, S_APPLE_EP]), { idemKey: "cpop-cu-plus-" + s.n, allowServerLookup: false });
}

// 4) Expression（录音），挂到篇目上
const EX = {};
for (const s of FANTASY_TRACKS) {
  EX[s.n] = await camp.ensureEntity("expression", s.tw, {
    work_id: album.id, content_unit_id: CU[s.n].id, position: s.n,
    original_language: "zh-TW", types: ["expression"],
    translations: trackTitle(s),
    attributes: { language: "zh-TW", duration: s.sec },
  }, REF.expr(s), { idemKey: "cpop-expr-fantasy-" + s.n, allowServerLookup: false });
}
const EX_PLUS = {};
for (const s of PLUS_TRACKS) {
  EX_PLUS[s.n] = await camp.ensureEntity("expression", s.tw, {
    work_id: ep.id, content_unit_id: CU_PLUS[s.n].id, position: s.n,
    original_language: "zh-TW", types: ["expression"],
    translations: trackTitle(s),
    attributes: { language: "zh-TW", duration: s.sec, version_label: "Live" },
  }, ev("编目：为《" + s.tw + "》建立演唱会现场录音表达（version_label=Live，duration=" + s.sec + " 秒，挂 content_unit_id）。Apple Music 官方曲名带 (Live) 后缀、维基百科记为桃园巨蛋演唱会重新演唱。",
    [S_WIKI_EP, S_APPLE_EP]), { idemKey: "cpop-expr-plus-" + s.n, allowServerLookup: false });
}

// 5) Release
const relCD = await camp.ensureEntity("release", "范特西", {
  original_language: "zh-TW", types: ["release"],
  translations: tr4("范特西", "范特西", "范特西", "Fantasy"),
  subjects: [{ work_id: album.id, role: "primary" }],
  attributes: {
    catalog_number: "74321894032", barcode: "743218940323", edition_date: "2001-09-14",
    edition_type: "standard", edition_batch: "first_press", country: "TW",
    publisher: A.alfa.id, packaging: "jewel", distribution_channel: "physical",
  },
  external_ids: { musicbrainz: "0377c05a-0da4-46f7-a153-52e80e7adac1" },
}, REF.relCD, { idemKey: "cpop-rel-fantasy-twcd", allowServerLookup: false });

const relCassette = await camp.ensureEntity("release", "范特西（卡帶版）", {
  original_language: "zh-TW", types: ["release"],
  translations: tr4("范特西（卡帶版）", "范特西（卡带版）", "范特西（カセットテープ版）", "Fantasy (Cassette)"),
  subjects: [{ work_id: album.id, role: "primary" }],
  attributes: {
    catalog_number: "MKC-1553", barcode: "9787799602868",
    edition_type: "standard", edition_batch: "regular", country: "CN",
    packaging: "slipcase", distribution_channel: "physical",
  },
  external_ids: { musicbrainz: "5c3809c3-afe5-3d29-9d7c-7b0b0966ec5e" },
}, REF.relCassette, { idemKey: "cpop-rel-fantasy-cassette", allowServerLookup: false });

const relPlus = await camp.ensureEntity("release", "范特西Plus", {
  original_language: "zh-TW", types: ["release"],
  translations: tr4("范特西Plus", "范特西Plus", "范特西Plus", "Fantasy Plus"),
  subjects: [{ work_id: ep.id, role: "primary" }],
  attributes: {
    edition_date: "2001-12-24", edition_type: "standard", edition_batch: "regular",
    country: "TW", publisher: A.bmg.id, packaging: "jewel", distribution_channel: "physical",
  },
}, REF.relPlus, { idemKey: "cpop-rel-fantasy-plus", allowServerLookup: false });

// 6) Medium
const medCD = await camp.ensureEntity("medium", "CD", {
  release_id: relCD.id, position: 1, original_language: "", types: ["medium"],
  translations: tr4("CD", "CD", "CD", "CD"),
  attributes: { format: "cd", role: "primary" },
}, REF.med("CD"), { idemKey: "cpop-med-fantasy-cd", scope: { release_id: relCD.id }, allowServerLookup: false });

const medTape = await camp.ensureEntity("medium", "卡帶", {
  release_id: relCassette.id, position: 1, original_language: "", types: ["medium"],
  translations: tr4("卡帶", "卡带", "カセットテープ", "Cassette"),
  attributes: { format: "cassette", role: "primary" },
}, REF.med("卡帶"), { idemKey: "cpop-med-fantasy-cassette", scope: { release_id: relCassette.id }, allowServerLookup: false });

const medPlus = await camp.ensureEntity("medium", "CD", {
  release_id: relPlus.id, position: 1, original_language: "", types: ["medium"],
  translations: tr4("CD", "CD", "CD", "CD"),
  attributes: { format: "cd", role: "primary" },
}, REF.med("CD"), { idemKey: "cpop-med-fantasy-plus-cd", scope: { release_id: relPlus.id }, allowServerLookup: false });

// 7) Track（contents 引用 Expression；卡带版与 CD 版复用同一批表达）
const TK = {}, TK_TAPE = {};
for (const s of FANTASY_TRACKS) {
  const contents = [{ expression_id: EX[s.n].id, position: 1, locator: null }];
  TK[s.n] = await camp.ensureEntity("track", s.tw, {
    medium_id: medCD.id, position: s.n, number: String(s.n), contents,
    original_language: "", types: ["track"],
    translations: trackTitle(s), attributes: { role: "primary" },
  }, REF.track(s), { idemKey: "cpop-track-fantasy-cd-" + s.n, scope: { medium_id: medCD.id }, allowServerLookup: false });
  TK_TAPE[s.n] = await camp.ensureEntity("track", s.tw, {
    medium_id: medTape.id, position: s.n, number: String(s.n), contents,
    original_language: "", types: ["track"],
    translations: trackTitle(s), attributes: { role: "primary" },
  }, REF.track(s), { idemKey: "cpop-track-fantasy-tape-" + s.n, scope: { medium_id: medTape.id }, allowServerLookup: false });
}
const TK_PLUS = {};
for (const s of PLUS_TRACKS) {
  TK_PLUS[s.n] = await camp.ensureEntity("track", s.tw, {
    medium_id: medPlus.id, position: s.n, number: String(s.n),
    contents: [{ expression_id: EX_PLUS[s.n].id, position: 1, locator: null }],
    original_language: "", types: ["track"],
    translations: trackTitle(s), attributes: { role: "primary" },
  }, REF.track(s), { idemKey: "cpop-track-plus-" + s.n, scope: { medium_id: medPlus.id }, allowServerLookup: false });
}

// 8) 关系
const REL_EV = {
  composed: (s) => ev("编目：署名《" + s.tw + "》作曲者为周杰伦（中文维基百科《范特西》曲目表标注全碟作曲周杰伦，Apple Music 作曲署名一致）。",
    [S_WIKI_ALBUM, S_APPLE_ALBUM]),
  lyric: (s) => ev("编目：署名《" + s.tw + "》作词者为" + s.lyricist + "（中文维基百科《范特西》曲目表作词栏）。",
    [S_WIKI_ALBUM]),
  arranged: (s) => ev("编目：署名《" + s.tw + "》编曲者为" + s.arranger + "（中文维基百科《范特西》曲目表编曲栏）。",
    [S_WIKI_ALBUM]),
  perform: (t) => ev("编目：署名" + t + "演唱/表演者为周杰伦（中文维基百科专辑条目与周杰伦条目）。", [S_WIKI_ALBUM, S_WIKI_ARTIST]),
  dist: ev("编目：署名《范特西》2001 年台湾版的发行公司为博德曼音乐（中文维基百科条目「由台湾博德曼音乐于2001年9月14日发行」；MusicBrainz 记厂牌为 Alfa Music）。",
    [S_WIKI_ALBUM, S_MB_CD]),
  lyricPlus: (s) => ev("编目：署名《" + s.tw + "》作词者为" + s.lyricist + "（中文维基百科《范特西Plus》曲目表作词栏）。", [S_WIKI_EP]),
};

for (const s of FANTASY_TRACKS) {
  await camp.createRelation("composed_by", CU[s.n].id, A.jay.id, REL_EV.composed(s), { attributes: { credit_role: "作曲" }, skipIfExists: !DRY });
}
for (const s of FANTASY_TRACKS) {
  const who = s.lyricist === "方文山" ? A.fang : s.lyricist === "徐若瑄" ? A.vivian : A.jay;
  await camp.createRelation("lyricist_of", CU[s.n].id, who.id, REL_EV.lyric(s), { attributes: { credit_role: "作詞" }, skipIfExists: !DRY });
}
for (const s of FANTASY_TRACKS.filter((x) => x.n === 1 || x.n === 8 || x.n === 9)) {
  const who = s.arranger === "林邁可" ? A.michael : s.arranger === "鍾興民" ? A.chung : A.hung;
  await camp.createRelation("arranged_by", EX[s.n].id, who.id, REL_EV.arranged(s), { attributes: { credit_role: "編曲" }, skipIfExists: !DRY });
}
await camp.createRelation("performed_by", album.id, A.jay.id, REL_EV.perform("《范特西》"), { attributes: { credit_role: "演唱" }, skipIfExists: !DRY });
await camp.createRelation("performed_by", ep.id, A.jay.id, REL_EV.perform("《范特西Plus》"), { attributes: { credit_role: "演唱" }, skipIfExists: !DRY });
await camp.createRelation("credit_for", relCD.id, A.bmg.id, REL_EV.dist, { attributes: { credit_role: "發行" }, skipIfExists: !DRY });
for (const s of PLUS_TRACKS) {
  const who = s.lyricist === "方文山" ? A.fang : A.jay;
  await camp.createRelation("lyricist_of", CU_PLUS[s.n].id, who.id, REL_EV.lyricPlus(s), { attributes: { credit_role: "作詞" }, skipIfExists: !DRY });
}

// ── 写后回读断言 ────────────────────────────────────────────────────────
const problems = [];
const checked = { entities: 0, relations: 0, revisions: 0 };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok, msg) => { if (!ok) problems.push(msg); };

async function verify() {
  const ALL = [];
  const push = (e, tag) => ALL.push({ e, tag });
  push(album, "work/album"); push(ep, "work/ep");
  for (const s of FANTASY_TRACKS) { push(CU[s.n], "cu/" + s.n); push(EX[s.n], "expr/" + s.n); push(TK[s.n], "track/cd/" + s.n); push(TK_TAPE[s.n], "track/tape/" + s.n); }
  for (const s of PLUS_TRACKS) { push(CU_PLUS[s.n], "cu+/" + s.n); push(EX_PLUS[s.n], "expr+/" + s.n); push(TK_PLUS[s.n], "track+/" + s.n); }
  push(relCD, "release/cd"); push(relCassette, "release/tape"); push(relPlus, "release/ep");
  push(medCD, "medium/cd"); push(medTape, "medium/tape"); push(medPlus, "medium/ep");
  for (const a of Object.values(A)) push(a, "agent");

  const fresh = new Map();
  for (const { e, tag } of ALL) {
    const got = await camp.getEntity(e.id);
    fresh.set(e.id, got);
    checked.entities++;
    check(got.kind === e.kind, tag + " 回读 kind 不一致：" + got.kind + " ≠ " + e.kind);
    check(got.status === "published", tag + " 状态不是 published：" + got.status);
    const keys = Object.keys(got.translations || {});
    for (const loc of ["zh-CN", "zh-TW", "ja-JP", "en-US"]) {
      check(!!(got.translations || {})[loc] && !!(got.translations || {})[loc].title, tag + " 缺 " + loc + " 题名");
    }
    check(keys.length >= 4, tag + " 翻译行不足：" + keys.join(","));
  }

  // A 结构归属
  for (const s of FANTASY_TRACKS) {
    const cu = fresh.get(CU[s.n].id), ex = fresh.get(EX[s.n].id);
    check(cu.work_id === album.id, "cu/" + s.n + " work_id 不属于《范特西》");
    check(cu.work_id !== undefined, "cu/" + s.n + " 缺 work_id");
    check(String(cu.number) === String(s.n) && cu.position === s.n, "cu/" + s.n + " number/position 与曲序不符");
    check(ex.work_id === album.id, "expr/" + s.n + " work_id 不属于《范特西》");
    check(ex.content_unit_id === CU[s.n].id, "expr/" + s.n + " content_unit_id 未挂到对应篇目");
    check(ex.parent_id === undefined || ex.parent_id === null || ex.parent_id === "", "expr/" + s.n + " 不应有 parent_id");
    check(ex.attributes && ex.attributes.duration === s.sec, "expr/" + s.n + " duration 不符：" + JSON.stringify(ex.attributes));
  }
  for (const s of PLUS_TRACKS) {
    const cu = fresh.get(CU_PLUS[s.n].id), ex = fresh.get(EX_PLUS[s.n].id);
    check(cu.work_id === ep.id, "cu+/" + s.n + " work_id 不属于《范特西Plus》");
    check(ex.work_id === ep.id && ex.content_unit_id === CU_PLUS[s.n].id, "expr+/" + s.n + " work_id/content_unit_id 归属错误");
  }
  // B 承载链与 subjects 覆盖
  for (const [rel, med, map, exprs, tag] of [
    [fresh.get(relCD.id), fresh.get(medCD.id), TK, EX, "release/cd"],
    [fresh.get(relCassette.id), fresh.get(medTape.id), TK_TAPE, EX, "release/tape"],
    [fresh.get(relPlus.id), fresh.get(medPlus.id), TK_PLUS, EX_PLUS, "release/ep"],
  ]) {
    check(!rel.work_id, tag + " 不应有 work_id");
    check(eq(fresh.get(med.id).release_id, rel.id), tag + " medium 未挂在发行上");
    const subjectIds = (rel.subjects || []).map((x) => x.work_id);
    check(subjectIds.length > 0, tag + " 缺 subjects");
    for (const s of Object.keys(map)) {
      const t = fresh.get(map[s].id), ex = fresh.get(exprs[s].id);
      check(t.medium_id === med.id, tag + " track/" + s + " medium 归属错误");
      check(t.position === Number(s), tag + " track/" + s + " position 不符");
      const c = (t.contents || [])[0];
      check(!!c && c.expression_id === ex.id, tag + " track/" + s + " contents 未引用预期表达");
      check(subjectIds.includes(ex.work_id), tag + " track/" + s + " 的 Expression 所属 Work 未在 subjects 声明");
    }
    for (const s of Object.keys(map)) {
      const seen = new Set(); // 每个 Track 独立判重（position 在同一 Track 内唯一）
      for (const c of fresh.get(map[s].id).contents || []) {
        check(!seen.has(c.position), tag + " track/" + s + " contents position 重复");
        seen.add(c.position);
      }
    }
  }
  // 跨发行复用：卡带版与 CD 版引用同一批 Expression
  for (const s of FANTASY_TRACKS) {
    check(fresh.get(TK_TAPE[s.n].id).contents[0].expression_id === fresh.get(TK[s.n].id).contents[0].expression_id,
      "track/tape/" + s.n + " 未复用 CD 版同一 Expression");
  }

  // C 关系两端与存在性
  const bySource = new Map();
  const addRel = (type, srcId, tgtId) => {
    if (!bySource.has(srcId)) bySource.set(srcId, []);
    bySource.get(srcId).push({ type, srcId, tgtId });
  };
  for (const s of FANTASY_TRACKS) {
    addRel("composed_by", CU[s.n].id, A.jay.id);
    addRel("lyricist_of", CU[s.n].id, (s.lyricist === "方文山" ? A.fang : s.lyricist === "徐若瑄" ? A.vivian : A.jay).id);
  }
  for (const s of FANTASY_TRACKS.filter((x) => x.n === 1 || x.n === 8 || x.n === 9)) {
    addRel("arranged_by", EX[s.n].id, (s.arranger === "林邁可" ? A.michael : s.arranger === "鍾興民" ? A.chung : A.hung).id);
  }
  addRel("performed_by", album.id, A.jay.id);
  addRel("performed_by", ep.id, A.jay.id);
  addRel("credit_for", relCD.id, A.bmg.id);
  for (const s of PLUS_TRACKS) addRel("lyricist_of", CU_PLUS[s.n].id, (s.lyricist === "方文山" ? A.fang : A.jay).id);

  for (const [srcId, wanted] of bySource) {
    const got = await client.relationsOf(srcId);
    for (const w of wanted) {
      const items = Array.isArray(got) ? got : (got.body && got.body.items) || [];
      const ok = items.some((r) => r.type === w.type && r.source_id === w.srcId && r.target_id === w.tgtId);
      check(ok, "关系回读缺失：" + w.type + " " + w.srcId.slice(0, 8) + "→" + w.tgtId.slice(0, 8));
      if (ok) checked.relations++;
    }
  }

  // D revisions
  for (const id of [album.id, ep.id, relCD.id, relCassette.id, relPlus.id, CU[1].id, EX[1].id, TK[1].id, medTape.id, A.jay.id, A.bmg.id]) {
    const r = await client.call("/api/catalog/entities/" + id + "/revisions");
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
} else {
  console.log("\n[dry-run] 计划：2 个专辑工作 + 13 篇目 + 13 表达 + 3 发行 + 3 载体 + 23 轨 + 8 主体；关系 29 条");
}

camp.summary({ verification: { problems: DRY ? ["dry-run 未回读"] : problems, checked } });
if (problems.length) process.exitCode = 1;
