#!/usr/bin/env node
// 领域 5：爵士合辑 / 精选（跨作品编目 + release.subjects 汇编能力）
//
// 目标形状（BRIEF 第 5 行）：
//   多 song/album Work ──► release(compilation subjects) ──► medium ──► track ──► contents[]→Expression
//   以及创作链 Work → ContentUnit（专辑曲目篇目）→ Expression（该曲目的录音母版，挂 content_unit_id）
//
// 真实数据基线（全部来自 MusicBrainz，逐条核对；不虚构品番/日期/曲目）：
//   发行 R1 = The Best of Blue Note（1991-11-12 / US / Blue Note CDP 7 96110 2 / barcode 0077779611027 / 1×CD / 9 曲）
//   MusicBrainz release  b3047ed8-1ae2-4d5c-ae4b-fa60dff158b7
//   MusicBrainz RG       b6ab1382-e02e-3db3-802e-db678234aa10（Album + Compilation）
//   9 首曲目各自来自 9 张不同的 Blue Note 经典专辑 → 9 个 album Work 都是 R1.subjects 的 compilation 对象，
//   用来验证服务端 undeclared_release_subject：任一收录表达的 Work 未声明即拒。
//
// 用法：
//   $env:MF_USER_PASS = (Select-String -Path 'docs-local/sim-credentials.md' -Pattern '^\| admin \|').Line.Split('|')[2].Trim()
//   node scripts/data/campaign/domains/jazz-compilation.mjs --dry-run
//   node scripts/data/campaign/domains/jazz-compilation.mjs

import { Campaign, Client, Index, src, DRY } from "../lib.mjs";

// ---------------------------------------------------------------- 来源（每条写入都引用）
const S = {
  r1: src(
    "https://musicbrainz.org/release/b3047ed8-1ae2-4d5c-ae4b-fa60dff158b7",
    "MusicBrainz release b3047ed8（The Best of Blue Note / 1991-11-12 / US / Blue Note，品番 CDP 7 96110 2，barcode 0077779611027，Jewel Case，1×CD 9 曲）：曲目表、曲序、各曲时长、艺人署名、载体与包装",
  ),
  r1rg: src(
    "https://musicbrainz.org/release-group/b6ab1382-e02e-3db3-802e-db678234aa10",
    "MusicBrainz release-group b6ab1382（The Best of Blue Note，primary-type Album + secondary-type Compilation，first-release-date 1991-11-12）：汇编性质与题名",
  ),
  r1cover: src(
    "https://coverartarchive.org/release/b3047ed8-1ae2-4d5c-ae4b-fa60dff158b7",
    "Cover Art Archive：该发行的正封面图（image id 28026177166，front=true）",
  ),
  series: src(
    "https://musicbrainz.org/release/8cd43bd5-a828-444c-9e42-98a2f84e9b5f",
    "MusicBrainz release 8cd43bd5（The Best of Blue Note, Volume 2 / 1992 / GB / Blue Note，9 曲）：同名系列第二卷，作为「The Best of Blue Note」系列聚合的第二条证据",
  ),
  label: src(
    "https://musicbrainz.org/label/713c4a95-6616-442b-9cf6-14e1ddfd5946",
    "MusicBrainz label 713c4a95（Blue Note，Imprint，label code 133）：R1 的发行主体/厂牌",
  ),
  altTake: src(
    "https://musicbrainz.org/release/47eebbe5-b13d-4593-b75a-9840619b0ad3",
    "MusicBrainz release 47eebbe5（The Ultimate Blue Train / 1997-04-01 / US / Blue Note CDP 7243 8 53428 0 6）：Bonus track「Blue Train (alternate take)」(recording f350e0d0) 的收录证据，属 Blue Train 母带同一 work",
  ),
};

// ---------------------------------------------------------------- 数据表（9 首曲目 = 9 张源专辑 = 9 个 Work）
// 每张源专辑一行：专辑 Work + 该曲目在源专辑里的 content_unit（篇目）+ 该曲目的 expression（录音）
const ALBUMS = [
  {
    key: "blue-train",
    album: "Blue Train",
    albumAlias: null,
    albumYear: "1958-02",
    albumCat: "BLP 1577",
    albumRg: "12349ce8-2087-3d16-93da-70cd65621774",
    albumRel: "4ca248f9-8f10-462b-a3bd-6ff48f25f151",
    albumArtist: "John Coltrane",
    performer: "coltrane",
    composer: "coltrane",
    cuNumber: "A1",
    cuPosition: 1,
    trackTitle: "Blue Train",
    trackNo: 1,
    duration: 642,
    recording: "1f1fd94d-35f2-4ca4-8b29-01100caa2a19",
  },
  {
    key: "maiden-voyage",
    album: "Maiden Voyage",
    albumAlias: null,
    albumYear: "1965-05-17",
    albumCat: "BLP 4195",
    albumRg: "c5e5e8ad-dc89-319e-8b2d-b3ff5e59fcea",
    albumRel: "8b3ca77d-647d-4e3e-b3a9-e7d5dd17f3e0",
    albumArtist: "Herbie Hancock",
    performer: "hancock",
    composer: "hancock",
    cuNumber: "A1",
    cuPosition: 1,
    trackTitle: "Maiden Voyage",
    trackNo: 2,
    duration: 478,
    recording: "7b486d22-ade1-4d61-940b-334071aad0cf",
  },
  {
    key: "new-perspective",
    album: "A New Perspective",
    albumAlias: null,
    albumYear: "1963",
    albumCat: "BLP 4124",
    albumRg: "66130180-5893-3d6e-85f3-28ceb0dac50a",
    albumRel: "56b5af15-1bc1-4240-a0a2-7b099a1ac4cc",
    albumArtist: "Donald Byrd",
    performer: "byrd",
    composer: "pearson",
    cuNumber: "B1",
    cuPosition: 4,
    trackTitle: "Cristo Redentor",
    trackNo: 3,
    duration: 342,
    recording: "da499edc-82cd-4cf0-8d84-c0fb9bb04321",
  },
  {
    key: "moanin",
    album: "Moanin'",
    albumAlias: "Art Blakey and The Jazz Messengers",
    albumYear: "1958",
    albumCat: "BLP 4003",
    albumRg: "e809b0f3-5683-3248-b39a-e7ee8e86d2d9",
    albumRel: "68cf83c9-3f68-4af2-9edd-37f22d5da600",
    albumArtist: "Art Blakey & The Jazz Messengers",
    performer: "messengers",
    composer: "timmons",
    cuNumber: "A1",
    cuPosition: 1,
    trackTitle: "Moanin'",
    trackNo: 4,
    duration: 573,
    recording: "71e795c3-896d-4cc5-8244-106aa20080f9",
  },
  {
    key: "blues-walk",
    album: "Blues Walk",
    albumAlias: null,
    albumYear: "1958-07-28",
    albumCat: "BLP 1593",
    albumRg: "75ac1dd5-e8fd-3e07-b2cc-8f8574b09e74",
    albumRel: "c0600ea4-822e-4b89-af49-d577fb099af9",
    albumArtist: "Lou Donaldson",
    performer: "donaldson",
    composer: "donaldson",
    cuNumber: "A1",
    cuPosition: 1,
    trackTitle: "Blues Walk",
    trackNo: 5,
    duration: 404,
    recording: "98293fac-6b8f-4e65-9e19-538f6b108399",
  },
  {
    key: "song-for-my-father",
    album: "Song for My Father",
    albumAlias: null,
    albumYear: "1964-12",
    albumCat: "BST 84185",
    albumRg: "5fd8134c-ff96-3f48-a0a7-952a1e00e78e",
    albumRel: "219c3a25-3772-41eb-ac23-4fd68047bbbe",
    albumArtist: "Horace Silver",
    performer: "silver",
    composer: "silver",
    cuNumber: "A1",
    cuPosition: 1,
    trackTitle: "Song for My Father",
    trackNo: 6,
    duration: 442,
    recording: "433b0433-3b8d-4e46-8865-0abeb236e8dd",
  },
  {
    key: "chicken-shack",
    album: "Back at the Chicken Shack",
    albumAlias: null,
    albumYear: "1963-02",
    albumCat: "BST 84117",
    albumRg: "10bb15b0-2d55-369a-90c3-a5131406ac9e",
    albumRel: "16ff71ba-6d9e-435b-ad13-951ed918dff2",
    albumArtist: "Jimmy Smith",
    performer: "jimmy_smith",
    composer: "jimmy_smith",
    cuNumber: "A1",
    cuPosition: 1,
    trackTitle: "Back at the Chicken Shack",
    trackNo: 7,
    duration: 484,
    recording: "38bacaac-21f7-48ac-bf75-d188c5ba7264",
  },
  {
    key: "midnight-blue",
    album: "Midnight Blue",
    albumAlias: null,
    albumYear: "1963",
    albumCat: "BLP 4123",
    albumRg: "88861537-d884-370c-800d-7b4a7aed782c",
    albumRel: "fad95885-3da7-4dbd-8969-cb7c26be2e4d",
    albumArtist: "Kenny Burrell",
    performer: "burrell",
    composer: "burrell",
    cuNumber: "A1",
    cuPosition: 1,
    trackTitle: "Chitlins Con Carne",
    trackNo: 8,
    duration: 328,
    recording: "7d95973e-988e-4ea0-b60b-f0be468555f2",
  },
  {
    key: "sidewinder",
    album: "The Sidewinder",
    albumAlias: null,
    albumYear: "1964-07",
    albumCat: "BLP 4157",
    albumRg: "24d2fedc-7976-3b88-bb91-b49a05f26e55",
    albumRel: "6b09dbc1-b4be-4fb9-9996-886b32852a19",
    albumArtist: "Lee Morgan",
    performer: "morgan",
    composer: "morgan",
    cuNumber: "A1",
    cuPosition: 1,
    trackTitle: "The Sidewinder",
    trackNo: 9,
    duration: 625,
    recording: "8e8c1753-dea8-4f59-beb7-63392d0f9451",
  },
];

// 责任主体：album artist / composer / 厂牌（MusicBrainz artist id 逐条核对）
const AGENTS = {
  coltrane:   { title: "John Coltrane",   type: "person",       mb: "b625448e-bf4a-41c3-a421-72ad46cdb831", note: "Blue Train 专辑艺人兼同名曲作曲" },
  hancock:    { title: "Herbie Hancock",  type: "person",       mb: "27613b78-1b9d-4ec3-9db5-fa0743465fdd", note: "Maiden Voyage 专辑艺人兼同名曲作曲" },
  byrd:       { title: "Donald Byrd",     type: "person",       mb: "69f95e5c-4b34-4c8b-b8fe-c59f9296195a", note: "A New Perspective 专辑艺人" },
  messengers: { title: "Art Blakey & The Jazz Messengers", type: "group", mb: "209ddf15-ee0a-41a1-a1f5-6f4c0409d2ee", note: "Moanin' 专辑艺人（Art Blakey 领队的乐团）" },
  blakey:     { title: "Art Blakey",      type: "person",       mb: "601e7466-eaf5-4a91-9909-ffd770b7e04a", note: "乐团领队/鼓手，作为个人主体建档以表达 member_of" },
  donaldson:  { title: "Lou Donaldson",   type: "person",       mb: "db147d97-f5cf-4e80-9e1a-08ddcb1d0bf8", note: "Blues Walk 专辑艺人兼同名曲作者（MusicBrainz work 记 writer）" },
  silver:     { title: "Horace Silver",   type: "person",       mb: "d185d986-ee96-4fd3-bd61-8c848a4765b6", note: "Song for My Father 专辑艺人兼同名曲作曲" },
  jimmy_smith:{ title: "Jimmy Smith",     type: "person",       mb: "4f8a0d9b-5777-40da-b29a-e9753d5ae693", note: "Back at the Chicken Shack 专辑艺人兼同名曲作曲" },
  burrell:    { title: "Kenny Burrell",   type: "person",       mb: "a85b66d2-34df-4d5a-8c0d-d585b8a14ce1", note: "Midnight Blue 专辑艺人；Chitlins Con Carne 作曲" },
  morgan:     { title: "Lee Morgan",      type: "person",       mb: "a1235272-3650-4ed7-9317-5a55a08701ec", note: "The Sidewinder 专辑艺人兼同名曲作曲；1958-61 年 Jazz Messengers 成员" },
  pearson:    { title: "Duke Pearson",    type: "person",       mb: "ea39ae7d-5498-4f26-992b-7cf3390253ed", note: "Cristo Redentor 作曲" },
  timmons:    { title: "Bobby Timmons",   type: "person",       mb: "ef05197e-aacb-4dbf-9cc4-2a9abee82f03", note: "Moanin' 作曲；1958-59 年 Jazz Messengers 成员" },
  bluenote:   { title: "Blue Note Records", type: "organization", mb: null, note: "R1 的发行厂牌（MusicBrainz label 713c4a95 Blue Note，Imprint）" },
};

// 四语翻译：官方译名无据 → 各语种填原文题名（BRIEF §0.4，不编造译名）
function trans(title, enAliases) {
  const row = (t) => (enAliases && t === "en-US" ? { title, aliases: enAliases } : { title });
  return { "zh-CN": row("zh-CN"), "zh-TW": row("zh-TW"), "ja-JP": row("ja-JP"), "en-US": row("en-US") };
}

const client = new Client();
await client.login();
const camp = new Campaign({ domain: "jazz-compilation", client, index: Index.load() });
console.log("领域 jazz-compilation 起始（" + (DRY ? "dry-run" : "写入模式") + "）");

// 幂等预载：content_unit / expression / release / medium / track 这几类没有服务端题名查重
// （lib.ensureEntity 默认对它们 allowServerLookup=false），靠 24h 幂等命中会在「幂等键并入载荷后重跑」
// 时失效并重复建档。这里显式按结构作用域把库里已存在的实体灌进本地索引，使 ensureEntity 直接复用。
async function preloadExisting() {
  const added = { release: 0, medium: 0, track: 0, expression: 0, content_unit: 0 };
  const rels = await client.search("release", "The Best of Blue Note");
  const rel = rels.find((x) => (x.external_ids || {}).musicbrainz === S.r1.url.split("/").pop()) || rels[0];
  if (!rel) return added;
  camp.index.add(rel); added.release++;
  const meds = await client.call("/api/catalog/entities?kind=medium&release_id=" + rel.id + "&limit=50");
  for (const m of (meds.body && meds.body.items) || []) {
    camp.index.add(m); added.medium++;
    const trs = await client.call("/api/catalog/entities?kind=track&medium_id=" + m.id + "&limit=100");
    for (const t of (trs.body && trs.body.items) || []) {
      camp.index.add(t); added.track++;
      for (const c of t.contents || []) {
        const e = await camp.getEntity(c.expression_id);
        camp.index.add(e); added.expression++;
        if (e.content_unit_id) { camp.index.add(await camp.getEntity(e.content_unit_id)); added.content_unit++; }
      }
    }
  }
  return added;
}
const preloaded = await preloadExisting();
console.log("预载已存在实体（幂等复用）：" + JSON.stringify(preloaded));

// ---------------------------------------------------------------- 1) agent（先建，release.publisher 与关系都要用 id）
const A = {};
for (const [key, spec] of Object.entries(AGENTS)) {
  const ext = spec.mb ? { musicbrainz: spec.mb } : {};
  const labelSrc = key === "bluenote" ? S.label : null;
  const ev = {
    note: "编目：" + spec.title + "（" + spec.type + "）——" + spec.note + "。",
    sources: labelSrc ? [S.label, S.r1] : [S.r1, S.r1rg],
  };
  A[key] = await camp.ensureEntity("agent", spec.title, {
    original_language: "en",
    types: [spec.type],
    translations: trans(spec.title),
    attributes: {},
    external_ids: ext,
  }, ev, { idemKey: "jazz5b-agent-" + key });
}

// ---------------------------------------------------------------- 2) 源专辑 Work + 篇目 content_unit + 录音 expression
for (const a of ALBUMS) {
  const albumEv = {
    note: "编目：专辑 Work「" + a.album + "」——R1「The Best of Blue Note」第 " + a.trackNo + " 曲的源专辑。"
      + "MusicBrainz release-group " + a.albumRg + "（primary-type Album，first-release-date " + a.albumYear
      + "，Blue Note 品番 " + a.albumCat + "），专辑艺人 " + a.albumArtist + "。Work 只保留专辑主名，品番/年份留在来源与报告里。",
    sources: [
      src("https://musicbrainz.org/release-group/" + a.albumRg, "MusicBrainz release-group " + a.albumRg + "（" + a.album + "，" + a.albumYear + "，" + a.albumCat + "）：专辑题名、首版日期、专辑艺人"),
      src("https://musicbrainz.org/release/" + a.albumRel, "MusicBrainz release " + a.albumRel + "（" + a.album + "，" + a.albumCat + "）：源专辑曲目表与曲序（本篇目号 " + a.cuNumber + "，共 " + (a.trackNo === 3 ? 5 : (a.key === "midnight-blue" ? 7 : (a.key === "chicken-shack" ? 4 : 5))) + " 曲）"),
      S.r1,
    ],
  };
  a.work = await camp.ensureEntity("work", a.album, {
    original_language: "en",
    types: ["album"],
    translations: trans(a.album, a.albumAlias ? [a.albumAlias] : null),
    attributes: {},
    external_ids: { musicbrainz: a.albumRg },
  }, albumEv, { idemKey: "jazz5b-work-" + a.key });

  // 篇目（源专辑内的曲目目录）：number 用原始 LP 面号，position 为源专辑内排序
  const cuEv = {
    note: "编目：专辑「" + a.album + "」的曲目篇目「" + a.trackTitle + "」——源专辑 " + a.albumCat
      + " 的 " + a.cuNumber + " 曲（第 " + a.cuPosition + " 首）。R1 第 " + a.trackNo + " 轨收录的正是这一曲目。",
    sources: [
      src("https://musicbrainz.org/release/" + a.albumRel, "MusicBrainz release " + a.albumRel + "（" + a.album + "）：曲目号 " + a.cuNumber + " / 标题 " + a.trackTitle + " / 时长"),
      S.r1,
    ],
  };
  a.cu = await camp.ensureEntity("content_unit", a.trackTitle, {
    work_id: a.work.id,
    position: a.cuPosition,
    number: a.cuNumber,
    original_language: "en",
    types: ["content_unit"],
    translations: trans(a.trackTitle),
    attributes: { language: "en", entry_role: "main" },
    external_ids: {},
  }, cuEv, { idemKey: "jazz5b-cu-" + a.key, allowServerLookup: true, scope: { work_id: a.work.id } });

  // 表达（录音母版）：必须挂 content_unit_id，才能把 Work→ContentUnit→Expression 链走通
  const exprEv = {
    note: "编目：录音表达「" + a.trackTitle + "」——MusicBrainz recording " + a.recording + "，时长 " + a.duration
      + " 秒（以 R1 该轨时长为准），挂在源专辑篇目 " + a.cuNumber + " 上。同一录音可被多个发行复用（R1 与其他合辑）。",
    sources: [
      src("https://musicbrainz.org/recording/" + a.recording, "MusicBrainz recording " + a.recording + "（" + a.trackTitle + "，" + a.albumArtist + "）：录音实体与时长"),
      S.r1,
    ],
  };
  a.expr = await camp.ensureEntity("expression", a.trackTitle, {
    work_id: a.work.id,
    content_unit_id: a.cu.id,
    position: 0,
    original_language: "en",
    types: ["expression"],
    translations: trans(a.trackTitle),
    attributes: { language: "en", duration: a.duration },
    external_ids: { musicbrainz: a.recording },
  }, exprEv, { idemKey: "jazz5b-expr-" + a.key, allowServerLookup: true, scope: { work_id: a.work.id } });
}

// Blue Train 的 alternate take：真实存在的第二个 expression（同篇目、同 work），用于 alternate_take_of（creative 类关系）
const altEv = {
  note: "编目：录音表达「Blue Train (alternate take)」——MusicBrainz recording f350e0d0-7c09-45d8-add2-04e3ceff2485（597 秒），"
    + "见于 The Ultimate Blue Train（1997-04-01 / Blue Note CDP 7243 8 53428 0 6）等再版的 bonus track，与 R1 收录的正片录音同属 Blue Train 母带。",
  sources: [S.altTake, src("https://musicbrainz.org/recording/f350e0d0-7c09-45d8-add2-04e3ceff2485", "MusicBrainz recording f350e0d0（Blue Train (alternate take)，John Coltrane）")],
};
const altTake = await camp.ensureEntity("expression", "Blue Train (alternate take)", {
  work_id: ALBUMS[0].work.id,
  content_unit_id: ALBUMS[0].cu.id,
  position: 1,
  original_language: "en",
  types: ["expression"],
  translations: trans("Blue Train (alternate take)"),
  attributes: { language: "en", duration: 597, version_label: "alternate take" },
  external_ids: { musicbrainz: "f350e0d0-7c09-45d8-add2-04e3ceff2485" },
}, altEv, { idemKey: "jazz5b-expr-blue-train-alt", allowServerLookup: true, scope: { work_id: ALBUMS[0].work.id } });

// ---------------------------------------------------------------- 3) 汇编 Work（R1 本身）
const compEv = {
  note: "编目：汇编作品 Work「The Best of Blue Note」——R1 的发行母体。MusicBrainz release-group b6ab1382（primary-type Album + secondary-type Compilation，首版 1991-11-12），"
    + "Various Artists 企划；它作为 R1.subjects 的 primary，9 张源专辑作品作为 compilation。",
  sources: [S.r1rg, S.r1],
};
const compWork = await camp.ensureEntity("work", "The Best of Blue Note", {
  original_language: "en",
  types: ["album"],
  translations: trans("The Best of Blue Note"),
  attributes: {},
  external_ids: { musicbrainz: "b6ab1382-e02e-3db3-802e-db678234aa10" },
}, compEv, { idemKey: "jazz5b-work-compilation" });

// ---------------------------------------------------------------- 4) release（subjects 覆盖全部收录表达的 Work）
const subjects = [{ work_id: compWork.id, role: "primary", position: 0 }];
ALBUMS.forEach((a, i) => subjects.push({ work_id: a.work.id, role: "compilation", position: i + 1 }));

const relEv = {
  note: "编目：发行「The Best of Blue Note」——1991-11-12 / US / Blue Note，品番 CDP 7 96110 2，barcode 0077779611027，Jewel Case，1×CD 9 曲（MusicBrainz release b3047ed8）。"
    + "subjects 声明汇编作品 primary + 9 张被收录源专辑 compilation；唱片收录的每一条表达所属 Work 均在 subjects 内。",
  sources: [S.r1, S.r1rg, S.r1cover, S.label],
};
const release = await camp.ensureEntity("release", "The Best of Blue Note", {
  original_language: "en",
  types: ["release"],
  translations: trans("The Best of Blue Note"),
  attributes: {
    catalog_number: "CDP 7 96110 2",
    barcode: "0077779611027",
    edition_date: "1991-11-12",
    edition_type: "standard",
    packaging: "jewel",
    country: "US",
    publisher: A.bluenote.id,
    distribution_channel: "physical",
  },
  external_ids: { musicbrainz: "b3047ed8-1ae2-4d5c-ae4b-fa60dff158b7" },
  subjects,
  pictures: [{
    url: "https://coverartarchive.org/release/b3047ed8-1ae2-4d5c-ae4b-fa60dff158b7/28026177166.jpg",
    caption: { "zh-CN": "发行正封面（Cover Art Archive 收录）", "en-US": "Front cover (Cover Art Archive)" },
    source: { kind: "url", citation: "Cover Art Archive: release b3047ed8 front image id 28026177166", url: "https://coverartarchive.org/release/b3047ed8-1ae2-4d5c-ae4b-fa60dff158b7" },
  }],
}, relEv, { idemKey: "jazz5b-release-r1", allowServerLookup: true });

// ---------------------------------------------------------------- 5) medium（1×CD）+ track（9 轨，contents 引用 expression）
const medEv = {
  note: "编目：发行 R1 的载体「CD」——MusicBrainz release b3047ed8 的唯一载体（1×CD，9 曲），载体品番与发行一致 CDP 7 96110 2。",
  sources: [S.r1],
};
const medium = await camp.ensureEntity("medium", "CD", {
  release_id: release.id,
  position: 0,
  number: "",
  original_language: "en",
  types: ["medium"],
  translations: trans("CD"),
  attributes: { catalog_number: "CDP 7 96110 2", format: "cd", role: "primary" },
  external_ids: {},
}, medEv, { idemKey: "jazz5b-medium-r1", allowServerLookup: true, scope: { release_id: release.id } });

for (const a of ALBUMS) {
  const trackEv = {
    note: "编目：R1 第 " + a.trackNo + " 轨「" + a.trackTitle + "」——收录源专辑「" + a.album + "」篇目 " + a.cuNumber
      + " 的录音表达（同一 expression，未复制）。时长 " + a.duration + " 秒取自 MusicBrainz release b3047ed8。",
    sources: [S.r1, src("https://musicbrainz.org/recording/" + a.recording, "MusicBrainz recording " + a.recording + "（" + a.trackTitle + "）：该轨对应的录音实体")],
  };
  a.track = await camp.ensureEntity("track", a.trackTitle, {
    medium_id: medium.id,
    position: a.trackNo,
    number: "",
    original_language: "en",
    types: ["track"],
    translations: trans(a.trackTitle),
    attributes: { duration: a.duration, role: "primary" },
    external_ids: {},
    contents: [{ expression_id: a.expr.id, position: 1, locator: null }],
  }, trackEv, { idemKey: "jazz5b-track-" + a.key, allowServerLookup: true, scope: { medium_id: medium.id } });
}

// ---------------------------------------------------------------- 6) collection（同名系列聚合）+ includes
const colEv = {
  note: "编目：series collection「The Best of Blue Note」——Blue Note 1991/1992 两卷同名合辑的系列聚合枢纽（第一卷 MusicBrainz release b3047ed8 1991-11-12，"
    + "第二卷「The Best of Blue Note, Volume 2」release 8cd43bd5 1992）。用 includes 关联本卷的汇编 Work。",
  sources: [S.r1, S.r1rg, S.series],
};
const collection = await camp.ensureEntity("collection", "The Best of Blue Note", {
  original_language: "en",
  types: ["collection"],
  translations: trans("The Best of Blue Note"),
  attributes: { language: "en" },
  external_ids: {},
}, colEv, { idemKey: "jazz5b-collection" });

// ---------------------------------------------------------------- 7) 关系（credits / creative / membership）
const relNote = {
  // 9 条 performed_by：expression → agent
  perf: (a) => ({
    note: "关系：录音表达「" + a.trackTitle + "」由 " + a.albumArtist + " 演奏——MusicBrainz release b3047ed8 该轨艺人与源专辑「" + a.album + "」(" + a.albumCat + ") 专辑艺人一致。",
    sources: [S.r1, src("https://musicbrainz.org/release-group/" + a.albumRg, "MusicBrainz release-group " + a.albumRg + "（" + a.album + "）：专辑艺人署名")],
  }),
  // 9 条 composed_by：content_unit → agent
  comp: (a, composerName) => ({
    note: "关系：源专辑「" + a.album + "」篇目 " + a.cuNumber + "「" + a.trackTitle + "」作曲 " + composerName
      + "——MusicBrainz work 的 composer/writer 关系（work「" + a.trackTitle + "」）。",
    sources: [src("https://musicbrainz.org/recording/" + a.recording, "MusicBrainz recording " + a.recording + " → 关联 work「" + a.trackTitle + "」的 composer/writer 署名")],
  }),
};

for (const a of ALBUMS) {
  const perf = AGENTS[a.performer];
  await camp.createRelation("performed_by", a.expr.id, A[a.performer].id, relNote.perf(a), {
    attributes: { credit_role: "performer" }, idemKey: "jazz5b-rel-perf-" + a.key,
  });

  const comp = AGENTS[a.composer];
  await camp.createRelation("composed_by", a.cu.id, A[a.composer].id, relNote.comp(a, comp.title), {
    attributes: { credit_role: "composer" }, idemKey: "jazz5b-rel-comp-" + a.key,
  });
}

// creative：Blue Train 的 alternate take 与正片录音同工作
await camp.createRelation("alternate_take_of", altTake.id, ALBUMS[0].expr.id, {
  note: "关系：「Blue Train (alternate take)」（recording f350e0d0）是 R1 收录的正片录音（recording 1f1fd94d）的替代 take，同属 Blue Train 母带（MusicBrainz work「Blue Train」）。",
  sources: [S.altTake, S.r1],
}, { idemKey: "jazz5b-rel-alttake" });

// membership：两位 Jazz Messengers 成员（1958-59 年 Moanin' 时期阵容，MusicBrainz 专辑署名）
await camp.createRelation("member_of", A.morgan.id, A.messengers.id, {
  note: "关系：Lee Morgan 为 Art Blakey & The Jazz Messengers 成员——1958 年 Moanin'（BLP 4003）录音阵容的 trumpet。",
  sources: [src("https://musicbrainz.org/release/68cf83c9-3f68-4af2-9edd-37f22d5da600", "MusicBrainz release 68cf83c9（Moanin' / BLP 4003）：乐队署名与编制"), S.r1],
}, { idemKey: "jazz5b-rel-member-morgan" });

await camp.createRelation("member_of", A.timmons.id, A.messengers.id, {
  note: "关系：Bobby Timmons 为 Art Blakey & The Jazz Messengers 成员——1958 年 Moanin'（BLP 4003）录音阵容的 piano，并作 Moanin' 一曲。",
  sources: [src("https://musicbrainz.org/release/68cf83c9-3f68-4af2-9edd-37f22d5da600", "MusicBrainz release 68cf83c9（Moanin' / BLP 4003）：乐队署名与编制"), S.r1],
}, { idemKey: "jazz5b-rel-member-timmons" });

// membership：系列聚合
await camp.createRelation("includes", collection.id, compWork.id, {
  note: "关系：「The Best of Blue Note」系列 collection 包含第一卷汇编作品 Work（R1 的发行母体）；第二卷 1992 年版计划在后续批次补录。",
  sources: [S.series, S.r1rg],
}, { idemKey: "jazz5b-rel-includes" });

// ---------------------------------------------------------------- 8) 写后回读断言
const problems = [];
if (DRY) {
  console.log("\n[dry-run] 跳过回读断言");
} else {
  const expect = [];
  // 8.1 结构归属 + contents 引用
  const medBack = await camp.getEntity(medium.id);
  if (medBack.release_id !== release.id) problems.push("medium 归属不符: " + medBack.release_id);
  for (const a of ALBUMS) {
    const cu = await camp.getEntity(a.cu.id);
    if (cu.work_id !== a.work.id) problems.push("cu「" + a.trackTitle + "」work_id 不符");
    const ex = await camp.getEntity(a.expr.id);
    if (ex.work_id !== a.work.id) problems.push("expr「" + a.trackTitle + "」work_id 不符");
    if (ex.content_unit_id !== a.cu.id) problems.push("expr「" + a.trackTitle + "」content_unit_id 未挂到篇目");
    const tk = await camp.getEntity(a.track.id);
    if (tk.medium_id !== medium.id) problems.push("track「" + a.trackTitle + "」medium_id 不符");
    const hit = (tk.contents || []).some((c) => c.expression_id === a.expr.id);
    if (!hit) problems.push("track「" + a.trackTitle + "」contents 未引用对应 expression");
    expect.push([a.work, a.cu, a.expr, a.track]);
  }
  // 8.2 subjects 覆盖：Track contents 引用的全部 Expression 所属 Work 必须在 subjects 里
  const relBack = await camp.getEntity(release.id);
  const declared = new Set((relBack.subjects || []).map((s) => s.work_id));
  const tracksAll = [];
  for (const m of [medium.id]) {
    const list = await client.call("/api/catalog/entities?kind=track&medium_id=" + m + "&limit=100");
    tracksAll.push(...(((list.body || {}).items) || []));
  }
  const usedWorks = new Map();
  for (const t of tracksAll) {
    for (const c of t.contents || []) usedWorks.set(c.expression_id, null);
  }
  for (const [exprId] of usedWorks) {
    const e = await camp.getEntity(exprId);
    usedWorks.set(exprId, e.work_id);
    if (!declared.has(e.work_id)) problems.push("undeclared_release_subject: expression " + exprId + " 的 Work " + e.work_id + " 不在 subjects");
  }
  if ((relBack.subjects || []).length !== ALBUMS.length + 1) problems.push("subjects 条数=" + (relBack.subjects || []).length + "，期望 " + (ALBUMS.length + 1));
  // 8.3 关系两端：逐条期望边回读（22 条全部核对，按 source 归组以减少列表调用）
  const expectedEdges = [];
  for (const a of ALBUMS) {
    expectedEdges.push({ type: "performed_by", source: a.expr.id, target: A[a.performer].id, label: "performed_by「" + a.trackTitle + "」" });
    expectedEdges.push({ type: "composed_by", source: a.cu.id, target: A[a.composer].id, label: "composed_by「" + a.trackTitle + "」" });
  }
  expectedEdges.push({ type: "alternate_take_of", source: altTake.id, target: ALBUMS[0].expr.id, label: "alternate_take_of「Blue Train (alternate take)」" });
  expectedEdges.push({ type: "member_of", source: A.morgan.id, target: A.messengers.id, label: "member_of「Lee Morgan」" });
  expectedEdges.push({ type: "member_of", source: A.timmons.id, target: A.messengers.id, label: "member_of「Bobby Timmons」" });
  expectedEdges.push({ type: "includes", source: collection.id, target: compWork.id, label: "includes「The Best of Blue Note」系列" });
  const bySource = new Map();
  for (const e of expectedEdges) {
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source).push(e);
  }
  let edgesOk = 0;
  for (const [sourceId, edges] of bySource) {
    const got = await client.relationsOf(sourceId);
    for (const e of edges) {
      if (got.some((r) => r.type === e.type && r.target_id === e.target && !r.via)) edgesOk++;
      else problems.push("关系缺失：" + e.label + "（" + e.type + " " + e.source.slice(0, 8) + "→" + e.target.slice(0, 8) + "）");
    }
  }
  console.log("关系边回读：" + edgesOk + "/" + expectedEdges.length + " 条存在");
  // 8.4 revisions
  const idList = [release.id, medium.id, compWork.id, collection.id, ...ALBUMS.flatMap((a) => [a.work.id, a.cu.id, a.expr.id, a.track.id]), altTake.id];
  for (const id of idList) {
    const rv = await client.call("/api/catalog/entities/" + id + "/revisions");
    const n = ((rv.body || {}).items || []).length;
    if (n < 1) problems.push("revisions 为空: " + id);
  }
  console.log("\n回读断言：" + (problems.length === 0 ? "全部通过" : problems.length + " 项失败"));
  for (const p of problems) console.log("  FAIL " + p);
  for (const p of problems) camp.failed.push({ op: "assert", code: p });
}

camp.summary({ assertionFailures: problems.length });
if (problems.length) process.exit(1);
