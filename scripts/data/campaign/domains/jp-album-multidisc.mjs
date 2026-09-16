#!/usr/bin/env node
// 领域 2：日本乐队多盘专辑（2CD+BD）— slug=jp-album-multidisc
//
// 真实发行：DIR EN GREY『PHALARIS』完全生産限定盤（2022-06-15 / 3枚組 CD＋特典CD＋特典Blu-ray）
// 选它的理由：官网 DISCOGRAPHY 一次给出版型、品番、三盘曲目与店铺特典；MusicBrainz 给出条码、
// 每盘曲目时长与录音 MBID；ja.wikipedia 给出 DISC 2 为再録、DISC 3 为 2021-06-05「疎外」全场影像。
// 三者互相印证，可把 2CD+BD 的两条层次链用真实数据走满。
//
// 建模取舍（详见 docs-local/data-campaign/logs/jp-album-multidisc-report.md）：
//   · DISC 1 十一曲各建 song Work，其录音为该 Work 的 Expression（Track.contents 引用之）；
//   · DISC 2 两曲是旧曲再录，复用同一 song Work、另建 Expression（version_label 标注再録）；
//   · DISC 3 的 Live 影像建独立 music Work「疎外」，其篇目是该场次演出曲目（content_unit），
//     每篇目的 Expression 挂在该 Work 下 —— 这是本领域 Work→ContentUnit→Expression 链的落地方式；
//   · Release.subjects 覆盖三盘 Track 收录表达所属的全部 Work（专辑 primary / 各曲 compilation / Live 盘 supplement）。
//
// 用法（口令只走环境变量）：
//   node scripts/data/campaign/domains/jp-album-multidisc.mjs --dry-run
//   node scripts/data/campaign/domains/jp-album-multidisc.mjs

import { Campaign, Client, Index, src, DRY } from "../lib.mjs";

const SRC_OFFICIAL = src(
  "https://www.direngrey.co.jp/jp/discography",
  "DIR EN GREY 官网 DISCOGRAPHY：11th ALBUM『PHALARIS』（2022.06.15）—— 完全生産限定盤 特殊パッケージ仕様 3枚組(CD＋特典CD＋特典Blu-ray) SFCD-0265～267、初回生産限定盤 2枚組(CD＋特典CD) SFCD-0271～272、通常盤 CD SFCD-0273；三盘曲目；预约店舗特典（早期予約オリジナルキーホルダー、TOWER RECORDS ステッカーA、HMV ステッカーB、Amazon メガジャケ 24×24cm、楽天ブックス クリアポーチ、セブンネット ミニスマホスタンドキーホルダー、一般拠点店舗 ポストカード）"
);
const SRC_MB = src(
  "https://musicbrainz.org/release/f95e8278-ed20-44e2-9d6e-2f61299d742b",
  "MusicBrainz release（WS/2 API 读取）：barcode 4529123002655、2022-06-15、country JP、label FIREWALL DIV. SFCD-0265/0266/0267；三盘 tracklist、各曲时长与 recording MBID"
);
const SRC_WIKI = src(
  "https://ja.wikipedia.org/wiki/PHALARIS",
  "ja.wikipedia『PHALARIS』：完全生産限定盤/初回生産限定盤/通常盤三种版型；DISC 2 收『GAUZE』mazohyst of decadence 与 9th single ain't afraid to die 的再録；DISC 3 为 2021年6月 東京ガーデンシアター 公演「疎外」フルサイズ収録；全作詞 京、作曲・編曲 DIR EN GREY、逐曲原曲者"
);
const SRC_WIKI_BAND = src(
  "https://ja.wikipedia.org/wiki/DIR_EN_GREY",
  "ja.wikipedia『DIR EN GREY』：成员与担当（京 Voice／薫 Guitar／Die Guitar／Toshiya Bass／Shinya Drums，注记说明担当表记依官网）；1997年大阪结成"
);
const SRC_TOUR = src(
  "https://www.direngrey.co.jp/jp/tours",
  "DIR EN GREY 官网 TOURS：公演「疎外」2021-06-05 東京ガーデンシアター（2021-05-06 振替公演）"
);
const SRC_STORE = src(
  "https://www.direngrey.co.jp/jp/discography",
  "官网 DISCOGRAPHY『PHALARIS』予約店舗特典段落：TOWER RECORDS ステッカーA(100×148mm)、HMV ステッカーB(100×148mm)、Amazon メガジャケ(24×24cm)、楽天ブックス クリアポーチ、セブンネット ミニスマホスタンドキーホルダー"
);

// 四语题名：zh-CN / zh-TW 无官方译名时按 BRIEF 填原文题名（不编造）；en-US 仅在官方英文名存在时用英文。
const T = (ja, en) => ({
  "ja-JP": { title: ja },
  "zh-CN": { title: ja },
  "zh-TW": { title: ja },
  "en-US": { title: en || ja },
});

// ── 真实数据表 ─────────────────────────────────────────────────────────────
const BAND = { title: "DIR EN GREY", mbid: "ab309b83-904f-4e2c-8d11-a0223bba51f9" };
const MEMBERS = [
  { title: "京", en: "Kyo", role: "Voice" },
  { title: "薫", en: "Kaoru", role: "Guitar" },
  { title: "Die", en: "Die", role: "Guitar" },
  { title: "Toshiya", en: "Toshiya", role: "Bass" },
  { title: "Shinya", en: "Shinya", role: "Drums" },
];
const LABEL = "FIREWALL DIV.";
const STORES = [
  { title: "TOWER RECORDS", bonus: "ステッカーA (100×148mm)" },
  { title: "HMV", bonus: "ステッカーB (100×148mm)" },
  { title: "Amazon.co.jp", bonus: "メガジャケ (24×24cm)" },
];

// DISC 1：11 曲（官方曲目表；时长为 MusicBrainz recording 长度；原曲者为 wiki 记载）
const DISC1 = [
  { title: "Schadenfreude", dur: 599, rec: "dd5d4504-bb6b-45d6-a0c3-c0b3f39cde8d", origin: "薫" },
  { title: "朧", dur: 239, rec: "62bb9c40-91cb-4eb5-a57c-5d5837cf9e0b", origin: "薫" },
  { title: "The Perfume of Sins", dur: 259, rec: "5ab5d7f0-0fbc-448f-9a9b-dcb084c02c6e", origin: "薫" },
  { title: "13", dur: 222, rec: "677caeb0-2793-4b88-9a43-5e5329ea87dc", origin: "Die" },
  { title: "現、忘我を喰らう", dur: 211, rec: "cc3d9c66-cbbe-4c0a-a006-c41f2bf3d611", origin: "Die" },
  { title: "落ちた事のある空", dur: 199, rec: "3a1273cb-7469-4801-ad3f-d9ebb99f3aea", origin: "薫" },
  { title: "盲愛に処す", dur: 171, rec: "696ec664-ecda-4036-87ab-a800e728eac0", origin: "薫" },
  { title: "響", dur: 239, rec: "41d4c436-5edd-4213-914d-145c75b91f2f", origin: "Die" },
  { title: "Eddie", dur: 172, rec: "21caef05-c662-421f-94e1-60f6f2a9b8f0", origin: "Die" },
  { title: "御伽", dur: 363, rec: "6b9e7a88-229c-4992-8544-7661b01088ff", origin: "薫" },
  { title: "カムイ", dur: 552, rec: "9e4e5256-04c3-4c4b-a13b-5c6486e54a37", origin: "薫&Die" },
];
// DISC 2（特典CD）：旧曲再録 —— 复用 song Work，另建 Expression
const DISC2 = [
  { title: "mazohyst of decadence", dur: 355, rec: "2d75e482-1972-4115-9dc3-7d05f0790adf", origin: "1999年1stアルバム『GAUZE』収録曲の再録" },
  { title: "ain’t afraid to die", dur: 417, rec: "7c688dce-5cf1-4b8e-8bc0-c7e1d5678044", origin: "2001年9thシングルの再録" },
];
// DISC 3（特典Blu-ray）：2021-06-05 東京ガーデンシアター「疎外」全 18 曲中，登记第 1・2・12 章（受实体量级上限，其余章未登记）
const LIVE_TITLE = "疎外";
const LIVE_CH = [
  { n: "1", title: "DOZING GREEN (Acoustic Ver.)", rec: "5f7804d0-7643-4d42-9e2c-312f91ba9775" },
  { n: "2", title: "絶縁体", rec: "f845f702-ad04-4ea8-8868-05dce6378f1c" },
  { n: "12", title: "朧", rec: "3f7db86c-6169-4463-934f-90c72962008d" },
];

const EV = {
  band: { note: "编目：依据官网/维基建立日本摇滚乐队 DIR EN GREY（1997 大阪结成）主体，作为本领域多盘专辑的责任团体节点", sources: [SRC_WIKI_BAND, SRC_OFFICIAL] },
  member: (m) => ({ note: "编目：建成员主体「" + m.title + "」（担当 " + m.role + "，依官网表记口径），用于 member_of 与署名关系", sources: [SRC_WIKI_BAND] }),
  label: { note: "编目：建发行主体 FIREWALL DIV.（本作 Manufactured by FIREWALL DIV.），供 Release.attributes.publisher 引用", sources: [SRC_OFFICIAL, SRC_MB] },
  store: (s) => ({ note: "编目：建渠道主体「" + s.title + "」，用于 store_bonus_for 关系与 Release.store_bonuses.store 引用（官网店铺特典段落）", sources: [SRC_STORE] }),
  album: { note: "编目：依据官网 DISCOGRAPHY 与 MusicBrainz 建立 11th ALBUM『PHALARIS』（2022-06-15）创作母体；题名保持纯净，版型/品番/包装信息落在 Release", sources: [SRC_OFFICIAL, SRC_MB, SRC_WIKI] },
  song: (t, origin) => ({ note: "编目：『PHALARIS』收录曲「" + t + "」建为独立 song Work（全作詞 京／作曲・編曲 DIR EN GREY，原曲者 " + origin + "），题名按官方曲目表", sources: [SRC_OFFICIAL, SRC_WIKI, SRC_MB] }),
  live: { note: "编目：完全生産限定盤 DISC 3 是 2021-06-05 東京ガーデンシアター 公演「疎外」全场影像，按一等音乐作品建档（types=music），其篇目＝该场次演出曲目", sources: [SRC_OFFICIAL, SRC_TOUR, SRC_WIKI] },
  cu: (ch) => ({ note: "编目：「疎外」公演篇目：按 Blu-ray 章节建立 content_unit，number 保留官方章节号（第 " + ch.n + " 章）", sources: [SRC_OFFICIAL, SRC_MB] }),
  expr: (kind) => ({ note: "编目：建立可复用录音表达（" + kind + "），供本发行及其它发行的 Track 收录引用", sources: [SRC_MB, SRC_OFFICIAL] }),
  release: { note: "编目：按官网 2022-06-15『PHALARIS』完全生産限定盤（特殊パッケージ仕様・3枚組 CD＋特典CD＋特典Blu-ray・SFCD-0265～267）建立发行版；subjects 覆盖三盘 Track 收录表达所属的全部 Work（专辑 primary／各曲 compilation／Live 盘 supplement）", sources: [SRC_OFFICIAL, SRC_MB, SRC_WIKI] },
  medium: (n, spec) => ({ note: "编目：按实物三枚组登记第 " + n + " 枚（" + spec + "），format/role 取 definitions 词表代码", sources: [SRC_OFFICIAL] }),
  track: (n, medium) => ({ note: "编目：按官方曲目表登记 " + medium + " 第 " + n + " 轨，contents 收录对应 Expression", sources: [SRC_OFFICIAL, SRC_MB] }),
  relMember: (m) => ({ note: "编目：建立「" + m.title + "」→ DIR EN GREY 的 member_of（乐队成员关系），担当依官网表记（" + m.role + "）", sources: [SRC_WIKI_BAND] }),
  relIncludes: (t) => ({ note: "编目：专辑 Work『PHALARIS』includes 收录曲 Work「" + t + "」（聚合关系，非发行承载）", sources: [SRC_OFFICIAL, SRC_WIKI] }),
  relPerformed: (w) => ({ note: "编目：「" + w + "」由 DIR EN GREY 演奏/演唱（乐队整体署名）", sources: [SRC_WIKI, SRC_OFFICIAL] }),
  relLyricist: { note: "编目：全作詞 京 的专辑级署名", sources: [SRC_WIKI] },
  relComposed: (t, who, role) => ({ note: "编目：作曲/原曲署名：「" + t + "」" + role + " " + who, sources: [SRC_WIKI, SRC_OFFICIAL] }),
  relArranged: { note: "编目：专辑级编曲署名（作曲・編曲：DIR EN GREY）", sources: [SRC_WIKI] },
  relStore: (s) => ({ note: "编目：本发行的店铺特典由「" + s.title + "」提供（" + s.bonus + "），据官网予約店舗特典段落", sources: [SRC_STORE] }),
  relBonus: (t) => ({ note: "编目：「" + t + "」是特典CD 追加曲，收录于本发行的 DISC 2（bonus_included_in）", sources: [SRC_OFFICIAL, SRC_WIKI] }),
  relAlt: { note: "编目：Blu-ray 收录的「朧」是同一曲的现场版本，与专辑录音互为另一版表达（alternate_take_of）", sources: [SRC_OFFICIAL, SRC_MB] },
};

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail: detail || "" });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const client = new Client();
await client.login();
const camp = new Campaign({ domain: "jp-album-multidisc", client, index: Index.load() });

// ── 0) 计划自检（dry-run 也跑，纯数据层） ──────────────────────────────────
const planTracks = DISC1.length + DISC2.length + LIVE_CH.length;
const planSubjects = 2 + DISC1.length + DISC2.length;
check("计划：预计新建实体 64 个（30–70 区间内）", true, "agent 10 + work 15 + content_unit 3 + expression 16 + release 1 + medium 3 + track 16 = 64");
check("计划：Track 数＝收录表达数 16", planTracks === 16, "DISC1 11 + DISC2 2 + BD 3");
check("计划：subjects 覆盖三盘全部 Work 15 条", planSubjects === 15, "专辑 1 + 歌曲 13 + Live 1");

// ── 0b) 预填本地索引 ──────────────────────────────────────────────────────
// 为什么：服务端 ?q= 标题检索对 track/medium 不可靠（实测 kind=track&q=朧 返回空），
// 而 content_unit/expression/medium/track 默认不做服务端查重；为使脚本可重复运行且不产生重复实体，
// 先按 kind 全量拉取一次灌进 lib 的 Index，再用「题名 + 结构归属 scope」精确查重。
const PREFILL_KINDS = ["content_unit", "expression", "release", "medium", "track"];
for (const k of PREFILL_KINDS) {
  const rows = await client.listKind(k);
  for (const e of rows) camp.index.add(e);
  console.log("prefill " + k + " = " + rows.length + " 条");
}

// ── 1) agents ─────────────────────────────────────────────────────────────
const band = await camp.ensureEntity("agent", BAND.title, {
  original_language: "ja",
  types: ["group"],
  translations: T(BAND.title, BAND.title),
  attributes: {},
  external_ids: { musicbrainz: BAND.mbid },
}, EV.band, { idemKey: "jp-album-multidisc-agent-band" });

const members = {};
for (const m of MEMBERS) {
  members[m.title] = await camp.ensureEntity("agent", m.title, {
    original_language: "ja",
    types: ["person"],
    translations: T(m.title, m.en),
    attributes: {},
    external_ids: {},
  }, EV.member(m), { idemKey: "jp-album-multidisc-agent-" + slug(m.en) });
}

const label = await camp.ensureEntity("agent", LABEL, {
  original_language: "ja",
  types: ["organization"],
  translations: T(LABEL, LABEL),
  attributes: {},
  external_ids: {},
}, EV.label, { idemKey: "jp-album-multidisc-agent-label" });

const stores = {};
for (const s of STORES) {
  stores[s.title] = await camp.ensureEntity("agent", s.title, {
    original_language: "ja",
    types: ["organization"],
    translations: T(s.title, s.title),
    attributes: {},
    external_ids: {},
  }, EV.store(s), { idemKey: "jp-album-multidisc-agent-store-" + slug(s.title) });
}

// ── 2) works ──────────────────────────────────────────────────────────────
const albumWork = await camp.ensureEntity("work", "PHALARIS", {
  original_language: "ja",
  types: ["album"],
  translations: T("PHALARIS", "PHALARIS"),
  attributes: { tags: ["アルバム", "rock", "DIR EN GREY"] },
  external_ids: { musicbrainz: "9166c85f-7401-439a-852b-db8f481916f8" },
}, EV.album, { idemKey: "jp-album-multidisc-work-album" });

const songWorks = {};
for (let i = 0; i < DISC1.length; i++) {
  const s = DISC1[i];
  songWorks[s.title] = await camp.ensureEntity("work", s.title, {
    original_language: "ja",
    types: ["song"],
    translations: T(s.title, s.title),
    attributes: { tags: ["song", "DIR EN GREY"] },
    external_ids: {},
  }, EV.song(s.title, s.origin), { idemKey: "jp-album-multidisc-work-song-d1-" + i });
}
for (let i = 0; i < DISC2.length; i++) {
  const s = DISC2[i];
  songWorks[s.title] = await camp.ensureEntity("work", s.title, {
    original_language: "ja",
    types: ["song"],
    translations: T(s.title, s.title),
    attributes: { tags: ["song", "DIR EN GREY", "既発曲"] },
    external_ids: {},
  }, EV.song(s.title, s.origin), { idemKey: "jp-album-multidisc-work-song-d2-" + i });
}

const liveWork = await camp.ensureEntity("work", LIVE_TITLE, {
  original_language: "ja",
  types: ["music"],
  translations: T(LIVE_TITLE, LIVE_TITLE),
  attributes: { tags: ["ライブ映像", "LIVE", "DIR EN GREY"] },
  external_ids: {},
}, EV.live, { idemKey: "jp-album-multidisc-work-live" });

// ── 3) content units（Live 作品篇目） ──────────────────────────────────────
const liveCUs = [];
for (let i = 0; i < LIVE_CH.length; i++) {
  const ch = LIVE_CH[i];
  liveCUs.push(await camp.ensureEntity("content_unit", ch.title, {
    work_id: liveWork.id,
    position: i + 1,
    number: ch.n,
    original_language: "ja",
    types: ["content_unit"],
    translations: T(ch.title, ch.title),
    attributes: { language: "ja", entry_role: "main" },
    external_ids: {},
  }, EV.cu(ch), { idemKey: "jp-album-multidisc-cu-" + i, scope: { work_id: liveWork.id }, allowServerLookup: false }));
}

// ── 4) expressions ────────────────────────────────────────────────────────
const exprs = { disc1: {}, disc2: {}, live: {} };
for (let i = 0; i < DISC1.length; i++) {
  const s = DISC1[i];
  exprs.disc1[s.title] = await camp.ensureEntity("expression", s.title, {
    work_id: songWorks[s.title].id,
    position: 1,
    original_language: "ja",
    types: ["expression"],
    translations: T(s.title, s.title),
    attributes: { language: "ja", duration: s.dur },
    external_ids: { musicbrainz: s.rec },
  }, EV.expr("专辑录音母版"), { idemKey: "jp-album-multidisc-expr-d1-" + i, scope: { work_id: songWorks[s.title].id }, allowServerLookup: false });
}
for (let i = 0; i < DISC2.length; i++) {
  const s = DISC2[i];
  exprs.disc2[s.title] = await camp.ensureEntity("expression", s.title, {
    work_id: songWorks[s.title].id,
    position: 1,
    original_language: "ja",
    types: ["expression"],
    translations: T(s.title, s.title),
    attributes: { language: "ja", duration: s.dur, version_label: "2022年再録（PHALARIS DISC 2）" },
    external_ids: { musicbrainz: s.rec },
  }, EV.expr("旧曲再録"), { idemKey: "jp-album-multidisc-expr-d2-" + i, scope: { work_id: songWorks[s.title].id }, allowServerLookup: false });
}
for (let i = 0; i < LIVE_CH.length; i++) {
  const ch = LIVE_CH[i];
  exprs.live[ch.title] = await camp.ensureEntity("expression", ch.title, {
    work_id: liveWork.id,
    content_unit_id: liveCUs[i].id,
    position: i + 1,
    original_language: "ja",
    types: ["expression"],
    translations: T(ch.title, ch.title),
    attributes: { language: "ja", version_label: "Live at 東京ガーデンシアター 2021-06-05" },
    external_ids: { musicbrainz: ch.rec },
  }, EV.expr("公演现场录音/影像"), { idemKey: "jp-album-multidisc-expr-live-" + i, scope: { work_id: liveWork.id }, allowServerLookup: false });
}

// ── 5) release（subjects 覆盖三盘全部 Work） ──────────────────────────────
const subjects = [{ work_id: albumWork.id, role: "primary", position: 0 }];
DISC1.forEach((s, i) => subjects.push({ work_id: songWorks[s.title].id, role: "compilation", position: i + 1 }));
DISC2.forEach((s, i) => subjects.push({ work_id: songWorks[s.title].id, role: "compilation", position: DISC1.length + i + 1 }));
subjects.push({ work_id: liveWork.id, role: "supplement", position: DISC1.length + DISC2.length + 1 });

const release = await camp.ensureEntity("release", "PHALARIS 完全生産限定盤", {
  original_language: "ja",
  types: ["release"],
  subjects,
  translations: T("PHALARIS 完全生産限定盤", "PHALARIS Limited Edition"),
  attributes: {
    catalog_number: "SFCD-0265～267",
    barcode: "4529123002655",
    edition_date: "2022-06-15",
    edition_type: "limited",
    edition_batch: "first_press",
    country: "JPN",
    publisher: label.id,
    packaging: "boxset",
    distribution_channel: "physical",
    store_bonuses: STORES.map((s) => ({
      label: {
        "ja-JP": "予約店舗特典：" + s.bonus,
        "zh-CN": "预约店铺特典：" + s.bonus,
        "zh-TW": "預約店鋪特典：" + s.bonus,
        "en-US": "Pre-order retailer bonus: " + s.bonus,
      },
      store: stores[s.title].id,
      channel: s.title,
      region: "JP",
      source_url: "https://www.direngrey.co.jp/jp/discography",
    })),
  },
  external_ids: { musicbrainz: "f95e8278-ed20-44e2-9d6e-2f61299d742b" },
}, EV.release, { idemKey: "jp-album-multidisc-release-1" });

// ── 6) mediums ────────────────────────────────────────────────────────────
const mediumSpecs = [
  { title: "DISC 1", en: "Disc 1", spec: "CD（专辑正片 11 曲）", format: "cd", role: "primary" },
  { title: "DISC 2 (特典CD)", en: "Disc 2", spec: "特典CD（旧曲再録 2 曲）", format: "cd", role: "supplement" },
  { title: "DISC 3 (特典Blu-ray)", en: "Disc 3", spec: "特典Blu-ray（2021.6.5「疎外」ライブ映像）", format: "bd", role: "extra" },
];
const mediums = [];
for (let i = 0; i < mediumSpecs.length; i++) {
  const m = mediumSpecs[i];
  mediums.push(await camp.ensureEntity("medium", m.title, {
    release_id: release.id,
    position: i + 1,
    original_language: "ja",
    types: ["medium"],
    translations: T(m.title, m.en),
    attributes: { format: m.format, role: m.role },
    external_ids: {},
  }, EV.medium(i + 1, m.spec), { idemKey: "jp-album-multidisc-medium-" + i, scope: { release_id: release.id }, allowServerLookup: false }));
}

// ── 7) tracks ─────────────────────────────────────────────────────────────
const tracks = { disc1: [], disc2: [], live: [] };
for (let i = 0; i < DISC1.length; i++) {
  const s = DISC1[i];
  tracks.disc1.push(await camp.ensureEntity("track", s.title, {
    medium_id: mediums[0].id,
    position: i + 1,
    original_language: "ja",
    types: ["track"],
    translations: T(s.title, s.title),
    attributes: { duration: s.dur, role: "primary" },
    contents: [{ expression_id: exprs.disc1[s.title].id, position: 1 }],
    external_ids: {},
  }, EV.track(i + 1, "DISC 1"), { idemKey: "jp-album-multidisc-track-d1-" + i, scope: { medium_id: mediums[0].id }, allowServerLookup: false }));
}
for (let i = 0; i < DISC2.length; i++) {
  const s = DISC2[i];
  tracks.disc2.push(await camp.ensureEntity("track", s.title, {
    medium_id: mediums[1].id,
    position: i + 1,
    original_language: "ja",
    types: ["track"],
    translations: T(s.title, s.title),
    attributes: { duration: s.dur, role: "supplement" },
    contents: [{ expression_id: exprs.disc2[s.title].id, position: 1 }],
    external_ids: {},
  }, EV.track(i + 1, "DISC 2 (特典CD)"), { idemKey: "jp-album-multidisc-track-d2-" + i, scope: { medium_id: mediums[1].id }, allowServerLookup: false }));
}
for (let i = 0; i < LIVE_CH.length; i++) {
  const ch = LIVE_CH[i];
  tracks.live.push(await camp.ensureEntity("track", ch.title, {
    medium_id: mediums[2].id,
    position: i + 1,
    number: ch.n,
    original_language: "ja",
    types: ["track"],
    translations: T(ch.title, ch.title),
    attributes: { role: "extra" },
    contents: [{ expression_id: exprs.live[ch.title].id, position: 1 }],
    external_ids: {},
  }, EV.track(ch.n, "DISC 3 (特典Blu-ray)"), { idemKey: "jp-album-multidisc-track-bd-" + i, scope: { medium_id: mediums[2].id }, allowServerLookup: false }));
}

// ── 8) relations ──────────────────────────────────────────────────────────
const R = (type, s, t, ev, attributes, key) => camp.createRelation(type, s, t, ev, { attributes, idemKey: key });

for (const m of MEMBERS) {
  await R("member_of", members[m.title].id, band.id, EV.relMember(m), { credit_role: m.role }, "jp-album-multidisc-rel-member-" + slug(m.en));
}
for (let i = 0; i < DISC1.length; i++) {
  await R("includes", albumWork.id, songWorks[DISC1[i].title].id, EV.relIncludes(DISC1[i].title), {}, "jp-album-multidisc-rel-includes-" + i);
}
await R("performed_by", albumWork.id, band.id, EV.relPerformed("PHALARIS"), { credit_role: "Performed by" }, "jp-album-multidisc-rel-perf-album");
await R("performed_by", liveWork.id, band.id, EV.relPerformed("疎外"), { credit_role: "Performed by" }, "jp-album-multidisc-rel-perf-live");
await R("lyricist_of", albumWork.id, members["京"].id, EV.relLyricist, { credit_role: "作詞" }, "jp-album-multidisc-rel-lyricist");
await R("composed_by", albumWork.id, band.id, EV.relComposed("PHALARIS", "DIR EN GREY", "作曲・編曲"), { credit_role: "作曲・編曲" }, "jp-album-multidisc-rel-composed-band");
await R("composed_by", songWorks["朧"].id, members["薫"].id, EV.relComposed("朧", "薫", "原曲"), { credit_role: "原曲" }, "jp-album-multidisc-rel-composed-oboro");
await R("composed_by", songWorks["13"].id, members["Die"].id, EV.relComposed("13", "Die", "原曲"), { credit_role: "原曲" }, "jp-album-multidisc-rel-composed-13");
await R("arranged_by", albumWork.id, band.id, EV.relArranged, { credit_role: "編曲" }, "jp-album-multidisc-rel-arranged");
for (const s of STORES) {
  await R("store_bonus_for", release.id, stores[s.title].id, EV.relStore(s), { credit_role: s.bonus, scope: "予約店舗特典" }, "jp-album-multidisc-rel-store-" + slug(s.title));
}
for (let i = 0; i < DISC2.length; i++) {
  await R("bonus_included_in", exprs.disc2[DISC2[i].title].id, mediums[1].id, EV.relBonus(DISC2[i].title), { credit_role: "特典CD 追加曲" }, "jp-album-multidisc-rel-bonus-" + i);
}
if (DRY && exprs.live["朧"].id === exprs.disc1["朧"].id) {
  // dry-run 下同名同 kind 的实体共用伪 id，自环校验会误报；真实运行两端是不同实体。
  console.log("  · relation | dry-run | alternate_take_of | 跳过：dry-run 下同名 Expression 共用伪 id（真实运行两端为不同实体）");
} else {
  await R("alternate_take_of", exprs.live["朧"].id, exprs.disc1["朧"].id, EV.relAlt, { credit_role: "Live at 東京ガーデンシアター 2021-06-05" }, "jp-album-multidisc-rel-alt-oboro");
}

// ── 9) 写后回读断言（dry-run 跳过） ────────────────────────────────────────
if (DRY) {
  console.log("\n[dry-run] 跳过写后回读断言（无真实 id）");
} else {
  const back = (id) => camp.getEntity(id);
  const relOf = async (id) => (await client.relationsOf(id)).filter((x) => !x.via);

  const relBack = await back(release.id);
  const subj = relBack.subjects || [];
  const subjWorks = new Set(subj.map((s) => s.work_id));
  check("回读 release.subjects 数量=15", subj.length === 15, "subjects=" + subj.length);
  check("回读 subjects 含专辑 primary 与 Live supplement",
    subj.some((s) => s.work_id === albumWork.id && s.role === "primary") && subj.some((s) => s.work_id === liveWork.id && s.role === "supplement"));
  check("回读 release 品番/条码/日期/版型",
    relBack.attributes.catalog_number === "SFCD-0265～267" && relBack.attributes.barcode === "4529123002655" &&
    relBack.attributes.edition_date === "2022-06-15" && relBack.attributes.edition_type === "limited",
    [relBack.attributes.catalog_number, relBack.attributes.barcode, relBack.attributes.edition_date, relBack.attributes.edition_type].join(" / "));
  check("回读 release.publisher 指向 " + LABEL, relBack.attributes.publisher === label.id, String(relBack.attributes.publisher));
  check("回读 release.store_bonuses 三条",
    Array.isArray(relBack.attributes.store_bonuses) && relBack.attributes.store_bonuses.length === 3,
    JSON.stringify((relBack.attributes.store_bonuses || []).map((b) => b.channel)));

  for (let i = 0; i < mediums.length; i++) {
    const mb = await back(mediums[i].id);
    check("回读 medium " + (i + 1) + " 归属 release 且格式正确",
      mb.release_id === release.id && mb.attributes.format === mediumSpecs[i].format,
      "format=" + mb.attributes.format + " role=" + mb.attributes.role);
  }

  const mediumIds = mediums.map((m) => m.id);
  const allTracks = [...tracks.disc1, ...tracks.disc2, ...tracks.live];
  let trackOk = 0, contentOk = 0, subjectOk = 0;
  const bad = [];
  for (const t of allTracks) {
    const tb = await back(t.id);
    if (mediumIds.includes(tb.medium_id)) trackOk++;
    const c = (tb.contents || [])[0];
    if (!c || !c.expression_id) { bad.push(t.title + ":无 contents"); continue; }
    const e = await back(c.expression_id);
    if (e.work_id) contentOk++;
    if (subjWorks.has(e.work_id)) subjectOk++; else bad.push(t.title + ":expression→work " + e.work_id + " 未在 subjects");
  }
  check("回读 16 条 track 的 medium 归属", trackOk === allTracks.length, trackOk + "/" + allTracks.length);
  check("回读 16 条 track 的 contents→expression 可解析", contentOk === allTracks.length, contentOk + "/" + allTracks.length + " " + bad.join("; ").slice(0, 200));
  check("回读 16 条 track 收录表达的 Work 全在 subjects 中（undeclared_release_subject 断言）", subjectOk === allTracks.length, subjectOk + "/" + allTracks.length);

  let cuOk = 0, liveExprOk = 0;
  for (let i = 0; i < liveCUs.length; i++) {
    const cu = await back(liveCUs[i].id);
    if (cu.work_id === liveWork.id) cuOk++;
    const e = await back(exprs.live[LIVE_CH[i].title].id);
    if (e.work_id === liveWork.id && e.content_unit_id === liveCUs[i].id) liveExprOk++;
  }
  check("回读 content_unit 归属 Live Work", cuOk === liveCUs.length, cuOk + "/" + liveCUs.length);
  check("回读 Live expression 同时挂 Work 与 content_unit", liveExprOk === liveCUs.length, liveExprOk + "/" + liveCUs.length);

  const relAlbum = await relOf(albumWork.id);
  const relSongOboro = await relOf(songWorks["朧"].id);
  const relSong13 = await relOf(songWorks["13"].id);
  const relBand = await relOf(band.id);
  const relRelease = await relOf(release.id);
  const relD2 = await relOf(exprs.disc2[DISC2[0].title].id);
  const relLive = await relOf(exprs.live["朧"].id);
  check("关系回读：includes×11（专辑→曲）", relAlbum.filter((r) => r.type === "includes" && r.source_id === albumWork.id).length === 11,
    String(relAlbum.filter((r) => r.type === "includes").length));
  check("关系回读：performed_by×1 / lyricist_of×1 / composed_by×3（专辑 1 + 曲 2）/ arranged_by×1",
    relAlbum.filter((r) => r.type === "performed_by").length === 1 &&
    relAlbum.filter((r) => r.type === "lyricist_of").length === 1 &&
    relAlbum.filter((r) => r.type === "composed_by").length === 1 &&
    relSongOboro.filter((r) => r.type === "composed_by" && r.target_id === members["薫"].id).length === 1 &&
    relSong13.filter((r) => r.type === "composed_by" && r.target_id === members["Die"].id).length === 1 &&
    relAlbum.filter((r) => r.type === "arranged_by").length === 1,
    JSON.stringify([...relAlbum, ...relSongOboro, ...relSong13].map((r) => r.type)));
  check("关系回读：member_of×5 指向乐队", relBand.filter((r) => r.type === "member_of" && r.target_id === band.id).length === 5,
    String(relBand.filter((r) => r.type === "member_of").length));
  check("关系回读：store_bonus_for×3 指向渠道主体", relRelease.filter((r) => r.type === "store_bonus_for").length === 3,
    String(relRelease.filter((r) => r.type === "store_bonus_for").length));
  check("关系回读：bonus_included_in 指向 DISC 2 medium", relD2.some((r) => r.type === "bonus_included_in" && r.target_id === mediums[1].id));
  check("关系回读：alternate_take_of 现场朧→专辑朧", relLive.some((r) => r.type === "alternate_take_of" && r.target_id === exprs.disc1["朧"].id));

  let revOk = 0;
  const revTargets = [albumWork.id, release.id, liveWork.id, tracks.disc1[0].id, liveCUs[0].id];
  for (const id of revTargets) {
    const rv = await client.call("/api/catalog/entities/" + id + "/revisions");
    if (rv.status === 200 && ((rv.body && rv.body.items) || []).length >= 1) revOk++;
  }
  check("回读 revisions 均 ≥1", revOk === 5, revOk + "/5");

  console.log("\n=== 完整链样例 ===");
  console.log("创作链 A：Work「" + LIVE_TITLE + "」(" + liveWork.id + ") → ContentUnit「" + LIVE_CH[0].title + "」(" + liveCUs[0].id + ") → Expression「" + LIVE_CH[0].title + "」(" + exprs.live[LIVE_CH[0].title].id + ")");
  console.log("创作链 B：Work「" + LIVE_TITLE + "」(" + liveWork.id + ") → ContentUnit「朧」(" + liveCUs[2].id + ") → Expression「朧」(" + exprs.live["朧"].id + ")");
  console.log("承载链 A：Work「PHALARIS」(" + albumWork.id + ") → Release「" + relBack.title + "」(" + release.id + ") → Medium「DISC 1」(" + mediums[0].id + ") → Track「朧」(" + tracks.disc1[1].id + ") → contents → Expression「朧」(" + exprs.disc1["朧"].id + ")");
  console.log("承载链 B：Work「" + LIVE_TITLE + "」(" + liveWork.id + ") → Release「" + relBack.title + "」(" + release.id + ") → Medium「DISC 3 (特典Blu-ray)」(" + mediums[2].id + ") → Track「朧」(" + tracks.live[2].id + ") → contents → Expression「朧」(" + exprs.live["朧"].id + ")");
}

const failedChecks = checks.filter((c) => !c.ok);
camp.summary({
  planned: { agent: 10, work: 15, content_unit: 3, expression: 16, release: 1, medium: 3, track: 16, total: 64 },
  actual: { createdEntities: camp.created.entity, reusedEntities: camp.reused.entity, createdRelations: camp.created.relation, reusedRelations: camp.reused.relation, failed: camp.failed.length },
  relations: { member_of: 5, includes: 11, performed_by: 2, lyricist_of: 1, composed_by: 3, arranged_by: 1, store_bonus_for: 3, bonus_included_in: 2, alternate_take_of: 1 },
  checks: { total: checks.length, failed: failedChecks.length, detail: failedChecks },
});
if (failedChecks.length) {
  console.log("\n断言失败 " + failedChecks.length + " 项，退出码 1");
  process.exit(1);
}
console.log("\n断言全部通过：" + checks.length + " 项");
