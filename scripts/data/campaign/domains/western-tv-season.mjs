#!/usr/bin/env node
// 编目战役领域 17：欧美电视剧季（slug=western-tv-season）
//
// 目标：用真实可考据的欧美电视剧季数据把两条链压满
//   创作链  Work(季) → ContentUnit(分集目录) → Expression(分集表达)
//   承载链  Work(季) → Release(蓝光套装 / 数字季) → Medium(BD ×3 / 数字) → Track → contents(引用 Expression)
//
// 选材：FX《American Horror Story》(2011–)
//   · 第 1 季 Murder House（12 集）—— 全链：12 篇目 + 12 表达 + 蓝光套装(3 BD) + 数字季发行(12 轨)
//   · 第 2 季 Asylum（13 集）—— 分集篇目目录（无表达/轨：本批不做第二条发行链）
//   · 第 8 季 Apocalypse、衍生剧 American Horror Stories —— 创作关系锚点（sequel_of / spin_off_of）
//
// 证据（逐字段可回溯，见 report）：
//   · 英文维基百科分集表：题名 / 首播日 / 导演 / 编剧 / 制作码
//   · Wikidata：多语言官方题名（P179 系列归属、P449 播出网、P577 首播日、P345 IMDb ID）
//   · iTunes Storefront API（GB）：数字季发行的逐集顺序与店头时长（表达式 duration）
//   · AVS Forum 蓝光影评：发行方 20th Century Fox Home Entertainment、3 张 BD-50、发行日 2012-09-25、配乐 James S. Levine
// 拿不到证据的字段一律留空（不虚构品番、条码、逐盘分集表），见报告「缺口清单」。
//
// 用法：
//   node scripts/data/campaign/domains/western-tv-season.mjs --dry-run   # 空跑，只打计划
//   node scripts/data/campaign/domains/western-tv-season.mjs             # 真写入 + 回读断言

import fs from "node:fs";
import path from "node:path";
import { Campaign, Client, Index, src, DRY, LOG_DIR } from "../lib.mjs";

// ---------------------------------------------------------------- 证据来源

const S_MH = src("https://en.wikipedia.org/wiki/American_Horror_Story:_Murder_House",
  "第 1 季条目：Infobox（首播 2011-10-05 / 完结 2011-12-21、12 集、FX、showrunner Ryan Murphy、主演名单）、"
  + "Episodes 表（逐集题名/首播日/导演/编剧/制作码）、Home media 表（The Complete First Season：12 集、4 Disc Set (DVD)、3 Disc Set (BD)、总时长 533 分钟、Region 1 2012-09-25）、"
  + "正文（由 Ryan Murphy & Brad Falchuk 为 FX 创作、20th Century Fox Television 制作）");
const S_ASYLUM = src("https://en.wikipedia.org/wiki/American_Horror_Story:_Asylum",
  "第 2 季条目：Episodes 表（13 集逐集题名/首播日/导演/编剧/制作码）；系列总览给出 2012-10-17 至 2013-01-23");
const S_APOC = src("https://en.wikipedia.org/wiki/American_Horror_Story:_Apocalypse",
  "第 8 季条目：正文（由 Ryan Murphy & Brad Falchuk 为 FX 创作、20th Century Fox Television 制作；2018-09-12 至 2018-11-14 播出、10 集；'presented as a crossover between Murder House, Coven, and Hotel'）");
const S_STORIES = src("https://en.wikipedia.org/wiki/American_Horror_Stories",
  "衍生剧条目：American Horror Stories 为 FX on Hulu 播出的 AHS 衍生剧（Wikidata Q107187662 描述亦为 'spin-off from American Horror Story'）");
const S_LIST = src("https://en.wikipedia.org/wiki/List_of_American_Horror_Story_episodes",
  "系列总览表：各季集数、起止播出日；首段（Ryan Murphy 与 Brad Falchuk 创作、2011-10-05 于 FX 首播、每季为自成一体的迷你剧）");
const S_ITUNES_S1 = src("https://itunes.apple.com/lookup?id=476791486&entity=tvEpisode&country=GB&limit=50",
  "iTunes Storefront API（GB）：数字季 'American Horror Story, Season 1'（collectionId 476791486，上架日 2011-10-05）的 12 集曲序、题名与店头时长（秒）");
const S_ITUNES_S2 = src("https://itunes.apple.com/lookup?id=571129095&entity=tvEpisode&country=GB&limit=50",
  "iTunes Storefront API（GB）：数字季 'American Horror Story: Asylum, Season 2'（collectionId 571129095）的 13 集曲序与题名（店头上架日滞后于首播日，故首播日以维基为准）");
const S_AVS = src("https://www.avsforum.com/threads/american-horror-story-the-complete-first-season-blu-ray-official-avsforum-review.1432224/",
  "蓝光影评（实物评测）：'comes to Blu-ray Disc from 20th Century Fox Home Entertainment'、Region A 发行日 2012-09-25、"
  + "'Season One's 12 episodes are spread over three BD-50 Blu-ray Discs'、标准 amaray + slipcover 包装、feature running time 532 分钟、Music by: James S. Levine、主演名单");
const S_WD_SERIES = src("https://www.wikidata.org/wiki/Q53922", "Wikidata Q53922 American Horror Story：多语言标签（zh 美國恐怖故事 / ja アメリカン・ホラー・ストーリー）、IMDb tt1844624");
const S_WD_MH = src("https://www.wikidata.org/wiki/Q689821", "Wikidata Q689821：zh 美國恐怖故事：凶宅 / ja アメリカン・ホラー・ストーリー: 呪いの館、P179 属于 Q53922、P449 播出网 FX");
const S_WD_ASYLUM = src("https://www.wikidata.org/wiki/Q129397", "Wikidata Q129397：zh 美國恐怖故事：瘋人院 / ja アメリカン・ホラー・ストーリー:精神科病棟、P179 属于 Q53922、P449 FX");
const S_WD_APOC = src("https://www.wikidata.org/wiki/Q55190027", "Wikidata Q55190027：zh 美國恐怖故事：第八季 / ja アメリカン・ホラー・ストーリー: アポカリプス、P577 首播 2018-09-12、P179 Q53922、P449 FX");
const S_WD_STORIES = src("https://www.wikidata.org/wiki/Q107187662", "Wikidata Q107187662 American Horror Stories：zh 美國恐怖故事集 / ja アメリカン・ホラー・ストーリーズ、IMDb tt12306692、描述为 AHS 的 spin-off");
const S_WD_MURPHY = src("https://www.wikidata.org/wiki/Q316844", "Wikidata Q316844 Ryan Murphy：zh-hans 莱恩·墨菲 / zh-hant 萊恩·墨菲 / ja ライアン・マーフィー、IMDb nm0614682");
const S_WD_FALCHUK = src("https://www.wikidata.org/wiki/Q315750", "Wikidata Q315750 Brad Falchuk：zh 布萊德·法查克 / zh-hant 巴特·法卓克 / ja ブラッド・ファルチャック、IMDb nm1004299");
const S_WD_LANGE = src("https://www.wikidata.org/wiki/Q173585", "Wikidata Q173585 Jessica Lange：zh-hans 杰西卡·兰格 / zh-hant 潔西卡·蘭芝 / ja ジェシカ・ラング、IMDb nm0001448");
const S_WD_PETERS = src("https://www.wikidata.org/wiki/Q785270", "Wikidata Q785270 Evan Peters：zh 伊万·彼得斯 / zh-hant 伊凡·彼得斯 / ja エヴァン・ピーターズ、IMDb nm1404239");
const S_WD_LEVINE = src("https://www.wikidata.org/wiki/Q862127", "Wikidata Q862127 James S. Levine：zh 詹姆士·S.萊文 / ja ジェームズ・S・レヴィン、IMDb nm0505828");
const S_WD_FX = src("https://www.wikidata.org/wiki/Q651228", "Wikidata Q651228 FX：播出网条目（Q689821/Q129397/Q55190027 的 P449 均指向该条）");
const S_WD_FOX = src("https://www.wikidata.org/wiki/Q2084961", "Wikidata Q2084961 20th Century Studios Home Entertainment（2012 年发行时的名称即 20th Century Fox Home Entertainment）：IMDb 公司 ID co0010224");
const S_CHARS = src("https://en.wikipedia.org/wiki/American_Horror_Story:_Murder_House",
  "第 1 季主角团：Constance Langdon（Jessica Lange）、Tate Langdon（Evan Peters）为该季主要角色（Cast 段；两个角色条目均重定向到本季条目，故不写独立 Wikidata 项）");

// ---------------------------------------------------------------- 数据表

// 第 1 季 Murder House：题名/首播日/导演/编剧取自维基分集表；duration 取 iTunes 店头秒数
const MH_EPS = [
  { n: 1, title: "Pilot", date: "2011-10-05", dir: "Ryan Murphy", wri: "Ryan Murphy & Brad Falchuk", dur: 3097 },
  { n: 2, title: "Home Invasion", date: "2011-10-12", dir: "Alfonso Gomez-Rejon", wri: "Ryan Murphy & Brad Falchuk", dur: 2563 },
  { n: 3, title: "Murder House", date: "2011-10-19", dir: "Bradley Buecker", wri: "Jennifer Salt", dur: 2559 },
  { n: 4, title: "Halloween, Pt. 1", date: "2011-10-26", dir: "David Semel", wri: "James Wong", dur: 2356 },
  { n: 5, title: "Halloween, Pt. 2", date: "2011-11-02", dir: "David Semel", wri: "Tim Minear", dur: 2464 },
  { n: 6, title: "Piggy, Piggy", date: "2011-11-09", dir: "Michael Uppendahl", wri: "Jessica Sharzer", dur: 2659 },
  { n: 7, title: "Open House", date: "2011-11-16", dir: "Tim Hunter", wri: "Brad Falchuk", dur: 2443 },
  { n: 8, title: "Rubber Man", date: "2011-11-23", dir: "Miguel Arteta", wri: "Ryan Murphy", dur: 2619 },
  { n: 9, title: "Spooky Little Girl", date: "2011-11-30", dir: "John Scott", wri: "Jennifer Salt", dur: 2435 },
  { n: 10, title: "Smoldering Children", date: "2011-12-07", dir: "Michael Lehmann", wri: "James Wong", dur: 2550 },
  { n: 11, title: "Birth", date: "2011-12-14", dir: "Alfonso Gomez-Rejon", wri: "Tim Minear", dur: 2519 },
  { n: 12, title: "Afterbirth", date: "2011-12-21", dir: "Bradley Buecker", wri: "Jessica Sharzer", dur: 3129 },
];

// 第 2 季 Asylum：13 集篇目目录（duration 见 iTunes 但本批不建表达，仅保留在数据表内备查）
const ASYLUM_EPS = [
  { n: 1, title: "Welcome to Briarcliff", date: "2012-10-17", dir: "Bradley Buecker", wri: "Tim Minear", dur: 2763 },
  { n: 2, title: "Tricks and Treats", date: "2012-10-24", dir: "Bradley Buecker", wri: "James Wong", dur: 2636 },
  { n: 3, title: "Nor'easter", date: "2012-10-31", dir: "Michael Uppendahl", wri: "Jennifer Salt", dur: 2486 },
  { n: 4, title: "I Am Anne Frank, Pt. 1", date: "2012-11-07", dir: "Michael Uppendahl", wri: "Jessica Sharzer", dur: 2529 },
  { n: 5, title: "I Am Anne Frank, Pt. 2", date: "2012-11-14", dir: "Alfonso Gomez-Rejon", wri: "Brad Falchuk", dur: 2548 },
  { n: 6, title: "The Origins of Monstrosity", date: "2012-11-21", dir: "David Semel", wri: "Ryan Murphy", dur: 2466 },
  { n: 7, title: "Dark Cousin", date: "2012-11-28", dir: "Michael Rymer", wri: "Tim Minear", dur: 2500 },
  { n: 8, title: "Unholy Night", date: "2012-12-05", dir: "Michael Lehmann", wri: "James Wong", dur: 2381 },
  { n: 9, title: "The Coat Hanger", date: "2012-12-12", dir: "Jeremy Podeswa", wri: "Jennifer Salt", dur: 2424 },
  { n: 10, title: "The Name Game", date: "2013-01-02", dir: "Michael Lehmann", wri: "Jessica Sharzer", dur: 2392 },
  { n: 11, title: "Spilt Milk", date: "2013-01-09", dir: "Alfonso Gomez-Rejon", wri: "Brad Falchuk", dur: 2745 },
  { n: 12, title: "Continuum", date: "2013-01-16", dir: "Craig Zisk", wri: "Ryan Murphy", dur: 2608 },
  { n: 13, title: "Madness Ends", date: "2013-01-23", dir: "Alfonso Gomez-Rejon", wri: "Tim Minear", dur: 2776 },
];

// ---------------------------------------------------------------- 工具

const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

/** 四语翻译：官方题名来自 Wikidata；没有该语种官名时填原语言题名（绝不编造）。 */
function L4(en, zhCN, zhTW, jaJP, extra = {}) {
  const t = (v) => ({ title: v, ...extra });
  return { "en-US": t(en), "zh-CN": t(zhCN || en), "zh-TW": t(zhTW || zhCN || en), "ja-JP": t(jaJP || en) };
}
/** 剧集条目/篇目/载体：官方只给出英文题名，各语种一律填原文题名。 */
const EN4 = (title, extra = {}) => L4(title, title, title, title, extra);

// ---------------------------------------------------------------- 幂等台账（重跑不重复建子级实体）
// lib 的 Index 是启动快照 + 内存新增；子级（content_unit/expression/medium/track）默认不做服务端查重，
// 因此本脚本用自己domain的 JSONL 日志做「上次已建」台账：命中则回读复用。

function loadLedger() {
  const file = path.join(LOG_DIR, "western-tv-season.jsonl");
  const map = new Map();          // kind|title -> [id]
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let r = null;
      try { r = JSON.parse(line); } catch { continue; }
      if (!r || !r.id || !r.title || !r.kind) continue;
      if (typeof r.id !== "string" || r.id.startsWith("DRY-")) continue;
      const key = r.kind + "|" + norm(r.title);
      const list = map.get(key) || [];
      if (!list.includes(r.id)) list.push(r.id);
      map.set(key, list);
    }
  } catch { /* 首次运行没有日志文件 */ }
  return map;
}

const client = new Client();
await client.login();
const camp = new Campaign({ domain: "western-tv-season", client, index: Index.load() });
const ledger = loadLedger();          // kind|title -> [上次运行建过的 id]
const ledgerScoped = new Map();       // kind|title|父级键 -> id（本次运行内确认过的对应关系）
const stats = { ledgerReuse: 0 };

/**
 * 建实体：先查上一次运行的台账（同 kind + 同题名 + 同父级作用域命中即回读复用），再交给 lib 查重/新建。
 * parent 形如 {work_id} / {release_id} / {medium_id}，用于把同名子级绑定到正确的父级，避免重跑重复建档。
 */
async function ensure(kind, title, spec, ev, opts = {}, parent = {}) {
  const key = kind + "|" + norm(title);
  const pkey = Object.keys(parent).sort().map((k) => k + "=" + parent[k]).join("&");
  const scopedKey = key + "|" + pkey;
  const hit = ledgerScoped.get(scopedKey);
  const candidates = hit ? [hit] : (ledger.get(key) || []);
  for (const prevId of candidates) {
    try {
      const cur = await camp.getEntity(prevId);
      const okParent = Object.keys(parent).every((k) => cur[k] === parent[k]);
      if (cur && cur.id === prevId && cur.kind === kind && okParent) {
        ledgerScoped.set(scopedKey, prevId);
        stats.ledgerReuse++;
        camp.log({ op: "entity", status: "reuse-ledger", kind, title, id: prevId });
        return cur;
      }
    } catch { /* 读不到：按未建处理 */ }
  }
  const e = await camp.ensureEntity(kind, title, spec, ev, opts);
  if (e && e.id && !String(e.id).startsWith("DRY-")) {
    ledgerScoped.set(scopedKey, e.id);
    const list = ledger.get(key) || [];
    if (!list.includes(e.id)) list.push(e.id);
    ledger.set(key, list);
  }
  // 空跑时 lib 的 DRY id 只截取题名前 20 字符，同前缀题名会互相撞成"自环"，这里换成唯一 id
  if (e && typeof e.id === "string" && e.id.startsWith("DRY-")) {
    return { ...e, id: "DRY-" + kind + "-" + norm(title).slice(0, 40) };
  }
  return e;
}

/** 关系创建后登记，收尾统一回读断言每条边真的落库（防幂等缓存丢边）。 */
const REL_PLAN = [];
async function rel(type, sourceId, targetId, ev, opts = {}) {
  if (sourceId === targetId) {
    camp.log({ op: "relation", status: "skip", title: type, code: "两端相同（空跑占位 id 冲突），跳过" });
    return { id: "DRY-REL" };
  }
  const r = await camp.createRelation(type, sourceId, targetId, ev, opts);
  if (!DRY) REL_PLAN.push({ type, sourceId, targetId, id: r && r.id });
  return r;
}

// ---------------------------------------------------------------- 1. agent

const A = {};
async function person(title, tr, ev, opts = {}) {
  const e = await ensure("agent", title, {
    original_language: "en",
    types: ["person"],
    translations: tr,
    external_ids: opts.external_ids || {},
  }, ev, { idemKey: opts.idemKey });
  return e;
}

A.murphy = await person("Ryan Murphy", L4("Ryan Murphy", "莱恩·墨菲", "萊恩·墨菲", "ライアン・マーフィー", { aliases: ["Ryan Murphy (producer)"] }), {
  note: "编目：《American Horror Story》创作者/剧集主管 Ryan Murphy（person agent）——系列第一季与第八季均由他与 Brad Falchuk 创作",
  sources: [S_LIST, S_MH, S_APOC, S_WD_MURPHY],
}, { idemKey: "wts-agent-ryan-murphy", external_ids: { wikidata: "Q316844", imdb_person: "nm0614682" } });

A.falchuk = await person("Brad Falchuk", L4("Brad Falchuk", "布莱德·法查克", "巴特·法卓克", "ブラッド・ファルチャック"), {
  note: "编目：《American Horror Story》联合创作者 Brad Falchuk（person agent）——与 Ryan Murphy 共同创作本系列",
  sources: [S_LIST, S_MH, S_WD_FALCHUK],
}, { idemKey: "wts-agent-brad-falchuk", external_ids: { wikidata: "Q315750", imdb_person: "nm1004299" } });

A.lange = await person("Jessica Lange", L4("Jessica Lange", "杰西卡·兰格", "潔西卡·蘭芝", "ジェシカ・ラング"), {
  note: "编目：Murder House 主演 Jessica Lange（person agent）——饰 Constance Langdon，并继续出演第 2 季 Asylum",
  sources: [S_MH, S_AVS, S_WD_LANGE, S_WD_ASYLUM],
}, { idemKey: "wts-agent-jessica-lange", external_ids: { wikidata: "Q173585", imdb_person: "nm0001448" } });

A.peters = await person("Evan Peters", L4("Evan Peters", "伊万·彼得斯", "伊凡·彼得斯", "エヴァン・ピーターズ"), {
  note: "编目：Murder House 主演 Evan Peters（person agent）——饰 Tate Langdon",
  sources: [S_MH, S_AVS, S_WD_PETERS],
}, { idemKey: "wts-agent-evan-peters", external_ids: { wikidata: "Q785270", imdb_person: "nm1404239" } });

A.levine = await person("James S. Levine", L4("James S. Levine", "詹姆士·S.莱文", "詹姆士·S.萊文", "ジェームズ・S・レヴィン"), {
  note: "编目：Murder House 配乐 James S. Levine（person agent）——蓝光评测署名 'Music by: James S. Levine'",
  sources: [S_AVS, S_WD_LEVINE],
}, { idemKey: "wts-agent-james-levine", external_ids: { wikidata: "Q862127", imdb_person: "nm0505828" } });

A.constance = await ensure("agent", "Constance Langdon", {
  original_language: "en",
  types: ["character"],
  translations: EN4("Constance Langdon"),
}, {
  note: "编目：Murder House 虚构角色 Constance Langdon（character agent）——该角色无独立百科条目，来源为第 1 季条目 Cast 段；无可靠多语言官名，各语种填原文",
  sources: [S_CHARS, S_MH],
}, { idemKey: "wts-agent-constance-langdon" });

A.tate = await ensure("agent", "Tate Langdon", {
  original_language: "en",
  types: ["character"],
  translations: EN4("Tate Langdon"),
}, {
  note: "编目：Murder House 虚构角色 Tate Langdon（character agent）——来源为第 1 季条目 Cast 段；无可靠多语言官名，各语种填原文",
  sources: [S_CHARS, S_MH],
}, { idemKey: "wts-agent-tate-langdon" });

A.fx = await ensure("agent", "FX", {
  original_language: "en",
  types: ["organization"],
  translations: EN4("FX", { aliases: ["FX Networks", "FX (TV channel)"] }),
}, {
  note: "编目：《American Horror Story》首播播出网 FX（organization agent）——Wikidata 各季条目 P449 均指向该条",
  sources: [S_WD_FX, S_WD_SERIES, S_MH, S_ASYLUM, S_APOC],
}, { idemKey: "wts-agent-fx", external_ids: { wikidata: "Q651228" } });

A.foxhome = await ensure("agent", "20th Century Fox Home Entertainment", {
  original_language: "en",
  types: ["organization"],
  translations: L4("20th Century Fox Home Entertainment", "20世纪福斯家庭娱乐公司", "20世紀福斯家庭娛樂公司", "20世紀スタジオ ホーム エンターテイメント", { aliases: ["20th Century Studios Home Entertainment"] }),
}, {
  note: "编目：Murder House 蓝光套装的发行方 20th Century Fox Home Entertainment（organization agent，2012 年发行时的公司名；现名 20th Century Studios Home Entertainment）",
  sources: [S_AVS, S_WD_FOX],
}, { idemKey: "wts-agent-fox-home-ent", external_ids: { wikidata: "Q2084961" } });

// ---------------------------------------------------------------- 2. collection + work

const collection = await ensure("collection", "American Horror Story", {
  original_language: "en",
  types: ["collection"],
  attributes: { language: "en" },
  translations: L4("American Horror Story", "美国恐怖故事", "美國恐怖故事", "アメリカン・ホラー・ストーリー", { aliases: ["AHS"] }),
  external_ids: { wikidata: "Q53922", wikipedia: "https://en.wikipedia.org/wiki/American_Horror_Story" },
}, {
  note: "编目：把 FX 选集剧《American Horror Story》(2011–) 建为 collection（系列枢纽），各季用独立 Work 表达、以 includes 关系聚合；本剧集是 anthology，每季独立成篇",
  sources: [S_LIST, S_WD_SERIES],
}, { idemKey: "wts-collection-ahs" });

const W = {};
W.mh = await ensure("work", "American Horror Story: Murder House", {
  original_language: "en",
  types: ["animation"],
  attributes: {
    episodes: 12, broadcast_start: "2011-10-05", broadcast_end: "2011-12-21",
    broadcast_weekday: "Wednesday", air_network: "FX", language: "en",
    tags: ["TV series", "horror", "anthology", "2011"],
  },
  translations: L4("American Horror Story: Murder House", "美国恐怖故事：凶宅", "美國恐怖故事：凶宅", "アメリカン・ホラー・ストーリー: 呪いの館"),
  external_ids: { wikidata: "Q689821", imdb: "tt1844624", wikipedia: "https://en.wikipedia.org/wiki/American_Horror_Story:_Murder_House" },
}, {
  note: "编目：第 1 季建为独立 Work（官方季副题 Murder House，题名保留官方全称）；属性 episodes/broadcast_*/air_network 来自维基第 1 季条目 Infobox；IMDb 为该剧集系列级 ID（季级 ID 未取得，记缺口）",
  sources: [S_MH, S_WD_MH, S_LIST],
}, { idemKey: "wts-work-murder-house" });

W.asylum = await ensure("work", "American Horror Story: Asylum", {
  original_language: "en",
  types: ["animation"],
  attributes: {
    episodes: 13, broadcast_start: "2012-10-17", broadcast_end: "2013-01-23",
    broadcast_weekday: "Wednesday", air_network: "FX", language: "en",
    tags: ["TV series", "horror", "anthology", "2012"],
  },
  translations: L4("American Horror Story: Asylum", "美国恐怖故事：疯人院", "美國恐怖故事：瘋人院", "アメリカン・ホラー・ストーリー:精神科病棟"),
  external_ids: { wikidata: "Q129397", wikipedia: "https://en.wikipedia.org/wiki/American_Horror_Story:_Asylum" },
}, {
  note: "编目：第 2 季 Asylum 建为独立 Work；集数与播出窗口来自维基条目与系列总览表",
  sources: [S_ASYLUM, S_WD_ASYLUM, S_LIST],
}, { idemKey: "wts-work-asylum" });

W.apoc = await ensure("work", "American Horror Story: Apocalypse", {
  original_language: "en",
  types: ["animation"],
  attributes: {
    episodes: 10, broadcast_start: "2018-09-12", broadcast_end: "2018-11-14",
    air_network: "FX", language: "en",
    tags: ["TV series", "horror", "anthology", "2018", "crossover"],
  },
  translations: L4("American Horror Story: Apocalypse", "美国恐怖故事：第八季", "美國恐怖故事：第八季", "アメリカン・ホラー・ストーリー: アポカリプス"),
  external_ids: { wikidata: "Q55190027", wikipedia: "https://en.wikipedia.org/wiki/American_Horror_Story:_Apocalypse" },
}, {
  note: "编目：第 8 季 Apocalypse 建为 Work，作为 sequel_of（承接 Murder House 剧情线）关系的端点；10 集、2018-09-12 至 2018-11-14",
  sources: [S_APOC, S_WD_APOC],
}, { idemKey: "wts-work-apocalypse" });

W.stories = await ensure("work", "American Horror Stories", {
  original_language: "en",
  types: ["animation"],
  attributes: { air_network: "FX on Hulu", language: "en", tags: ["TV series", "horror", "anthology", "spin-off"] },
  translations: L4("American Horror Stories", "美国恐怖故事集", "美國恐怖故事集", "アメリカン・ホラー・ストーリーズ"),
  external_ids: { wikidata: "Q107187662", imdb: "tt12306692", wikipedia: "https://en.wikipedia.org/wiki/American_Horror_Stories" },
}, {
  note: "编目：衍生剧 American Horror Stories（2021–，FX on Hulu）建为 Work，作为 spin_off_of 关系的来源；季数与分集未在本批建（见报告）",
  sources: [S_STORIES, S_WD_STORIES],
}, { idemKey: "wts-work-american-horror-stories" });

// ---------------------------------------------------------------- 3. content_unit（分集目录）

const CU = { mh: [], asylum: [] };

for (const ep of MH_EPS) {
  const cu = await ensure("content_unit", ep.title, {
    work_id: W.mh.id,
    position: ep.n,
    number: String(ep.n),
    original_language: "en",
    types: ["content_unit"],
    attributes: { entry_role: "main", air_date: ep.date, language: "en" },
    translations: EN4(ep.title, { aliases: ["American Horror Story: Murder House 第 " + ep.n + " 集"] }),
  }, {
    note: "编目：第 1 季第 " + ep.n + " 集「" + ep.title + "」的篇目（ContentUnit）——number 保留官方集序、position 表示排序、air_date 为美国首播日（第四/五集在官方分集表为一组 Halloween 上下篇，题名用 iTunes 店头写法 Pt. 1 / Pt. 2）",
    sources: [S_MH, S_LIST, S_ITUNES_S1],
  }, { idemKey: "wts-cu-mh-" + ep.n, allowServerLookup: false, scope: { work_id: W.mh.id } }, { work_id: W.mh.id });
  CU.mh.push(cu);
}

for (const ep of ASYLUM_EPS) {
  const cu = await ensure("content_unit", ep.title, {
    work_id: W.asylum.id,
    position: ep.n,
    number: String(ep.n),
    original_language: "en",
    types: ["content_unit"],
    attributes: { entry_role: "main", air_date: ep.date, language: "en" },
    translations: EN4(ep.title, { aliases: ["American Horror Story: Asylum 第 " + ep.n + " 集"] }),
  }, {
    note: "编目：第 2 季第 " + ep.n + " 集「" + ep.title + "」的篇目（ContentUnit）——air_date 为美国首播日（iTunes 店头上架日滞后于首播，不作为首播依据；第四/五集为 I Am Anne Frank 上下篇）",
    sources: [S_ASYLUM, S_LIST, S_ITUNES_S2],
  }, { idemKey: "wts-cu-asylum-" + ep.n, allowServerLookup: false, scope: { work_id: W.asylum.id } }, { work_id: W.asylum.id });
  CU.asylum.push(cu);
}

// ---------------------------------------------------------------- 4. expression（分集表达，挂 content_unit_id）

const EXPR = [];
for (let i = 0; i < MH_EPS.length; i++) {
  const ep = MH_EPS[i];
  const ex = await ensure("expression", ep.title, {
    work_id: W.mh.id,
    content_unit_id: CU.mh[i].id,
    position: ep.n,
    original_language: "en",
    types: ["expression"],
    attributes: { language: "en", duration: ep.dur },
    translations: EN4(ep.title, { aliases: ["American Horror Story: Murder House 第 " + ep.n + " 集 播出母版"] }),
  }, {
    note: "编目：第 1 季第 " + ep.n + " 集「" + ep.title + "」的播出表达（Expression），用 content_unit_id 挂到该集篇目；duration 取 iTunes 店头时长 " + ep.dur + " 秒",
    sources: [S_MH, S_ITUNES_S1],
  }, { idemKey: "wts-expr-mh-" + ep.n, allowServerLookup: false, scope: { work_id: W.mh.id } }, { work_id: W.mh.id });
  if (!DRY && ex.content_unit_id !== CU.mh[i].id) {
    throw new Error("expression " + ex.id + " 的 content_unit_id 与篇目不一致：" + ex.content_unit_id + " != " + CU.mh[i].id);
  }
  EXPR.push(ex);
}

// ---------------------------------------------------------------- 5. release / medium / track

const SUBJECTS = [{ work_id: W.mh.id, role: "primary", position: 0 }];

const relBd = await ensure("release", "American Horror Story – The Complete First Season (Blu-ray)", {
  original_language: "en",
  types: ["release"],
  attributes: {
    edition_date: "2012-09-25",
    edition_type: "standard",
    edition_batch: "regular",
    country: "US",
    publisher: A.foxhome.id,
    packaging: "slipcase",
    distribution_channel: "physical",
  },
  translations: EN4("American Horror Story – The Complete First Season (Blu-ray)"),
  subjects: SUBJECTS,
}, {
  note: "编目：Murder House 蓝光套装（Release）——官方套装名 American Horror Story – The Complete First Season；Region A 发行日 2012-09-25、发行方 20th Century Fox Home Entertainment、12 集分布在 3 张 BD-50、标准 amaray + slipcover 包装；无品番/条码证据故留空",
  sources: [S_MH, S_AVS],
}, { idemKey: "wts-release-mh-bd", allowServerLookup: false });

const relDigital = await ensure("release", "American Horror Story, Season 1 (digital)", {
  original_language: "en",
  types: ["release"],
  attributes: {
    edition_date: "2011-10-05",
    edition_type: "standard",
    edition_batch: "regular",
    country: "GB",
    distribution_channel: "digital",
    platform: "iTunes Store",
  },
  translations: EN4("American Horror Story, Season 1 (digital)"),
  subjects: SUBJECTS,
}, {
  note: "编目：Murder House 数字季发行（Release）——iTunes 店头名 'American Horror Story, Season 1'（collectionId 476791486，GB storefront），上架日 2011-10-05、12 集；数字发行无包装，故不写 packaging；发行主体无可考证据（零售商不等于发行方）故不写 publisher",
  sources: [S_ITUNES_S1],
}, { idemKey: "wts-release-mh-digital", allowServerLookup: false });

const MED = {};
MED.bd = [];
for (let d = 1; d <= 3; d++) {
  const m = await ensure("medium", "Blu-ray Disc " + d, {
    release_id: relBd.id,
    position: d,
    original_language: "en",
    types: ["medium"],
    attributes: { format: "bd", role: "primary" },
    translations: EN4("Blu-ray Disc " + d),
  }, {
    note: "编目：蓝光套装的第 " + d + " 张 BD-50 盘（Medium）——实物评测明确 12 集分布在 3 张 BD-50 盘；无逐盘分集表来源，故本盘不挂 Track（见报告缺口清单）",
    sources: [S_MH, S_AVS],
  }, { idemKey: "wts-medium-mh-bd-" + d, allowServerLookup: false, scope: { release_id: relBd.id } }, { release_id: relBd.id });
  MED.bd.push(m);
}

const medDigital = await ensure("medium", "Digital Media", {
  release_id: relDigital.id,
  position: 1,
  original_language: "en",
  types: ["medium"],
  attributes: { format: "digital", role: "primary" },
  translations: EN4("Digital Media"),
}, {
  note: "编目：数字季发行的载体（Medium）——iTunes 单季下载/流媒体文件集，format=digital，12 集按店头曲序排列",
  sources: [S_ITUNES_S1],
}, { idemKey: "wts-medium-mh-digital", allowServerLookup: false, scope: { release_id: relDigital.id } }, { release_id: relDigital.id });

const TRACK = [];
for (let i = 0; i < MH_EPS.length; i++) {
  const ep = MH_EPS[i];
  const trk = await ensure("track", ep.title, {
    medium_id: medDigital.id,
    position: ep.n,
    number: String(ep.n),
    original_language: "en",
    types: ["track"],
    attributes: { role: "primary", duration: ep.dur },
    translations: EN4(ep.title, { aliases: ["第 " + ep.n + " 集"] }),
  }, {
    note: "编目：数字季发行第 " + ep.n + " 轨「" + ep.title + "」（Track）——曲序与时长取 iTunes 店头；收录取整轨，locator 为空",
    sources: [S_ITUNES_S1, S_MH],
  }, { idemKey: "wts-track-mh-" + ep.n, allowServerLookup: false, scope: { medium_id: medDigital.id } }, { medium_id: medDigital.id });
  TRACK.push(trk);
}

// 回填 contents（整轨收录 → locator 为空；已填过的不重复 PUT）
for (let i = 0; i < TRACK.length; i++) {
  const want = [{ expression_id: EXPR[i].id, position: 1, locator: null }];
  const cur = DRY ? null : await camp.getEntity(TRACK[i].id);
  const same = cur && Array.isArray(cur.contents) && cur.contents.length === 1
    && cur.contents[0].expression_id === EXPR[i].id;
  if (same) {
    camp.log({ op: "entity-update", status: "skip-unchanged", kind: "track", title: TRACK[i].title, id: TRACK[i].id });
  } else {
    await camp.updateEntity(TRACK[i].id, { contents: want }, {
      note: "编目：回填 Track contents——第 " + (i + 1) + " 轨收录第 1 季第 " + (i + 1) + " 集的播出表达（Expression），整轨收录故 locator 为空",
      sources: [S_ITUNES_S1, S_MH],
    });
  }
}

// ---------------------------------------------------------------- 6. 关系

const evRel = (note, sources) => ({ note, sources });

// membership / creative
for (const w of [W.mh, W.asylum, W.apoc]) {
  await rel("includes", collection.id, w.id, evRel(
    "编目：系列 collection《American Horror Story》包含季 Work「" + w.title + "」",
    [S_LIST, S_WD_SERIES]), { attributes: {} });
}
await rel("sequel_of", W.apoc.id, W.mh.id, evRel(
  "编目：《Apocalypse》(第 8 季) 承接第 1 季 Murder House 的剧情线：维基明确该季是 Murder House / Coven / Hotel 的 crossover，主角之一即 Murder House 结局中的孩子；以此表达季间的续作关系",
  [S_APOC, S_WD_APOC]), { attributes: {} });
await rel("spin_off_of", W.stories.id, W.mh.id, evRel(
  "编目：衍生剧《American Horror Stories》(2021–) 是《American Horror Story》的衍生剧（Wikidata 条目描述 'spin-off from American Horror Story'）；"
  + "spin_off_of 只允许 work→work、不能指向 collection，故指向该系列第一季 Work 作为代理端点（模型缺口见报告）",
  [S_STORIES, S_WD_STORIES]), { attributes: {} });

// credits
for (const p of [A.murphy, A.falchuk]) {
  await rel("created_by", W.mh.id, p.id, evRel(
    "编目：第 1 季《Murder House》由 " + p.title + " 创作（与另一位创作者共同署名）",
    [S_MH, S_LIST, S_WD_MURPHY, S_WD_FALCHUK]), { attributes: { credit_role: "creator" } });
  await rel("created_by", W.apoc.id, p.id, evRel(
    "编目：第 8 季《Apocalypse》由 " + p.title + " 创作（系列创作者署名）",
    [S_APOC, S_WD_APOC, S_WD_MURPHY, S_WD_FALCHUK]), { attributes: { credit_role: "creator" } });
}
await rel("composed_by", W.mh.id, A.levine.id, evRel(
  "编目：第 1 季 Murder House 配乐由 James S. Levine 作曲（蓝光实物评测 'Music by: James S. Levine'）",
  [S_AVS, S_WD_LEVINE]), { attributes: { credit_role: "composer" } });

await rel("performed_by", W.mh.id, A.lange.id, evRel(
  "编目：Jessica Lange 出演第 1 季 Murder House，饰 Constance Langdon",
  [S_MH, S_AVS, S_CHARS, S_WD_LANGE]), { attributes: { credit_role: "actor", character: A.constance.id } });
await rel("performed_by", W.mh.id, A.peters.id, evRel(
  "编目：Evan Peters 出演第 1 季 Murder House，饰 Tate Langdon",
  [S_MH, S_AVS, S_CHARS, S_WD_PETERS]), { attributes: { credit_role: "actor", character: A.tate.id } });
await rel("performed_by", W.asylum.id, A.lange.id, evRel(
  "编目：Jessica Lange 继续出演第 2 季 Asylum（主要演员之一）",
  [S_ASYLUM, S_WD_ASYLUM, S_WD_LANGE]), { attributes: { credit_role: "actor" } });
await rel("character_in", A.constance.id, W.mh.id, evRel(
  "编目：虚构角色 Constance Langdon 于第 1 季 Murder House 登场（主要角色）",
  [S_CHARS, S_MH]), { attributes: { character_rank: "main" } });
await rel("character_in", A.tate.id, W.mh.id, evRel(
  "编目：虚构角色 Tate Langdon 于第 1 季 Murder House 登场（主要角色）",
  [S_CHARS, S_MH]), { attributes: { character_rank: "main" } });

// 分集署名（content_unit 级）
const ep1 = CU.mh[0];
await rel("written_by", ep1.id, A.murphy.id, evRel(
  "编目：第 1 季第 1 集「Pilot」编剧 Ryan Murphy",
  [S_MH]), { attributes: { credit_role: "writer" } });
await rel("written_by", ep1.id, A.falchuk.id, evRel(
  "编目：第 1 季第 1 集「Pilot」编剧 Brad Falchuk",
  [S_MH]), { attributes: { credit_role: "writer" } });
await rel("directed_by", ep1.id, A.murphy.id, evRel(
  "编目：第 1 季第 1 集「Pilot」由 Ryan Murphy 执导",
  [S_MH]), { attributes: { credit_role: "director" } });

// 发行/播出署名
await rel("credit_for", relBd.id, A.foxhome.id, evRel(
  "编目：Murder House 蓝光套装由 20th Century Fox Home Entertainment 发行",
  [S_AVS, S_WD_FOX]), { attributes: { credit_role: "publisher" } });
for (const w of [W.mh, W.asylum, W.apoc]) {
  await rel("credit_for", w.id, A.fx.id, evRel(
    "编目：「" + w.title + "」在美国由 FX 首播（播出网署名）",
    [S_WD_FX, S_WD_MH, S_WD_ASYLUM, S_WD_APOC]), { attributes: { credit_role: "network" } });
}

// ---------------------------------------------------------------- 7. 写后回读断言

const problems = [];
const checks = [];
const seenIds = new Set();
let checked = 0;

function trackCheck(e, expect) { checks.push({ id: e && e.id, kind: "track", expect }); }

checks.push({ id: W.mh.id, kind: "work", expect: { types: "animation" } });
checks.push({ id: W.asylum.id, kind: "work", expect: { types: "animation" } });
checks.push({ id: W.apoc.id, kind: "work", expect: { types: "animation" } });
checks.push({ id: W.stories.id, kind: "work", expect: { types: "animation" } });
checks.push({ id: collection.id, kind: "collection", expect: {} });
for (let i = 0; i < CU.mh.length; i++) checks.push({ id: CU.mh[i].id, kind: "content_unit", expect: { work_id: W.mh.id, position: MH_EPS[i].n } });
for (let i = 0; i < CU.asylum.length; i++) checks.push({ id: CU.asylum[i].id, kind: "content_unit", expect: { work_id: W.asylum.id, position: ASYLUM_EPS[i].n } });
for (let i = 0; i < EXPR.length; i++) checks.push({ id: EXPR[i].id, kind: "expression", expect: { work_id: W.mh.id, content_unit_id: CU.mh[i].id, position: MH_EPS[i].n } });
checks.push({ id: relBd.id, kind: "release", expect: { subjects: [W.mh.id] } });
checks.push({ id: relDigital.id, kind: "release", expect: { subjects: [W.mh.id] } });
for (let i = 0; i < MED.bd.length; i++) checks.push({ id: MED.bd[i].id, kind: "medium", expect: { release_id: relBd.id, position: i + 1 } });
checks.push({ id: medDigital.id, kind: "medium", expect: { release_id: relDigital.id, position: 1 } });
for (let i = 0; i < TRACK.length; i++) checks.push({ id: TRACK[i].id, kind: "track", expect: { medium_id: medDigital.id, position: MH_EPS[i].n, contents: [EXPR[i].id] } });
for (const a of Object.values(A)) checks.push({ id: a.id, kind: "agent", expect: {} });

if (!DRY) {
  for (const c of checks) {
    if (!c.id || String(c.id).startsWith("DRY-") || seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    let cur = null;
    try { cur = await camp.getEntity(c.id); } catch (e) { problems.push("回读失败 " + c.kind + " " + c.id + "：" + String(e.message).slice(0, 120)); continue; }
    checked++;
    const e = c.expect;
    if (cur.kind !== c.kind) problems.push(c.id + " kind 期望 " + c.kind + " 实际 " + cur.kind);
    if (e.work_id && cur.work_id !== e.work_id) problems.push(c.kind + " " + c.id + " work_id 期望 " + e.work_id + " 实际 " + cur.work_id);
    if (e.content_unit_id && cur.content_unit_id !== e.content_unit_id) problems.push("expression " + c.id + " content_unit_id 期望 " + e.content_unit_id + " 实际 " + cur.content_unit_id);
    if (e.release_id && cur.release_id !== e.release_id) problems.push(c.kind + " " + c.id + " release_id 期望 " + e.release_id + " 实际 " + cur.release_id);
    if (e.medium_id && cur.medium_id !== e.medium_id) problems.push(c.kind + " " + c.id + " medium_id 期望 " + e.medium_id + " 实际 " + cur.medium_id);
    if (e.position !== undefined && cur.position !== e.position) problems.push(c.kind + " " + c.id + " position 期望 " + e.position + " 实际 " + cur.position);
    if (e.contents) {
      const got = (cur.contents || []).map((x) => x.expression_id);
      if (JSON.stringify(got) !== JSON.stringify(e.contents)) problems.push("track " + c.id + " contents 期望 " + JSON.stringify(e.contents) + " 实际 " + JSON.stringify(got));
    }
    if (e.subjects) {
      const got = (cur.subjects || []).map((s) => s.work_id).sort();
      const want = e.subjects.slice().sort();
      if (got.length !== want.length || got.some((x, i) => x !== want[i])) problems.push("release " + c.id + " subjects 期望 " + want + " 实际 " + got);
    }
    if (!(cur.version >= 1)) problems.push(c.kind + " " + c.id + " version/revision 缺失");
  }
}

// 关系回读：逐条确认边真的存在（幂等缓存曾出现丢边）
let relChecked = 0;
const bySource = new Map();
if (!DRY) {
  for (const r of REL_PLAN) {
    if (!bySource.has(r.sourceId)) bySource.set(r.sourceId, await client.relationsOf(r.sourceId));
    const list = bySource.get(r.sourceId);
    relChecked++;
    if (!list.some((x) => x.type === r.type && x.source_id === r.sourceId && x.target_id === r.targetId)) {
      problems.push("关系缺失 " + r.type + " " + r.sourceId.slice(0, 8) + " → " + r.targetId.slice(0, 8));
    }
  }
}

console.log("\n=== 回读断言 ===");
console.log("实体回读 " + checked + " 条；关系端点回读 " + relChecked + " 条；问题 " + problems.length + " 条");
for (const p of problems) console.log("  x " + p);

const summary = camp.summary({
  level_counts: {
    collection: 1,
    work: 4,
    content_unit: CU.mh.length + CU.asylum.length,
    expression: EXPR.length,
    release: 2,
    medium: MED.bd.length + 1,
    track: TRACK.length,
    agent: Object.keys(A).length,
  },
  ledger_reuse: stats.ledgerReuse,
  chain_samples: {
    creation: [
      { work: W.mh.id, work_title: W.mh.title, content_unit: CU.mh[0].id, content_unit_title: CU.mh[0].title, expression: EXPR[0].id, expression_title: EXPR[0].title },
      { work: W.mh.id, work_title: W.mh.title, content_unit: CU.mh[1].id, content_unit_title: CU.mh[1].title, expression: EXPR[1].id, expression_title: EXPR[1].title },
    ],
    carrier: [
      { work: W.mh.id, release: relDigital.id, release_title: relDigital.title, medium: medDigital.id, medium_title: medDigital.title, track: TRACK[0].id, track_title: TRACK[0].title, expression: EXPR[0].id },
      { work: W.mh.id, release: relBd.id, release_title: relBd.title, medium: MED.bd[0].id, medium_title: MED.bd[0].title, note: "3 张 BD 中的第 1 张（无逐盘分集表来源，未挂 Track）" },
    ],
  },
  readback: { entities: checked, relations: relChecked, problems },
});
process.exitCode = (camp.failed.length === 0 && problems.length === 0) ? 0 : 1;
