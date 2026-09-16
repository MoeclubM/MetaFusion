#!/usr/bin/env node
// 领域脚本：主机 / 独立游戏（多平台）— slug = console-game
//
// 数据全部来自可核对的官方/权威页面（Steam 商店页与 appdetails API、英文/中文维基百科、商店官方文案），
// 脚本内不写推测值；拿不到证据的字段留空并在 docs-local/data-campaign/logs/console-game-report.md 里列缺口。
//
// 层级形状（每部游戏一条完整创作链 + 一条承载链）：
//   Work(indie_game) → ContentUnit(章节/内容包) → Expression(该章节的可复用内容)
//   Work → Release(平台版) → Medium(数字配信) → Track(收录位置) → contents[] 引用章节 Expression
// 同一批 Expression 被多个平台发行重复收录（跨发行复用），用来验证 occurrences 反查。
//
// 用法：
//   node scripts/data/campaign/domains/console-game.mjs --dry-run
//   $env:MF_USER_PASS = …; node scripts/data/campaign/domains/console-game.mjs

import { Campaign, Client, DRY, Index, src } from "../lib.mjs";

// ── 来源 ────────────────────────────────────────────────────────────────
const S = {
  steamCeleste: src("https://store.steampowered.com/app/504230/Celeste/",
    "Steam 商店页 + appdetails API（appids=504230）：开发者 Maddy Makes Games Inc. 与 Extremely OK Games, Ltd.、发行 Maddy Makes Games Inc.、发行日期 2018-01-25、支持平台 Windows/macOS/Linux、类型含 Indie"),
  wikiCeleste: src("https://en.wikipedia.org/wiki/Celeste_(video_game)",
    "英文维基百科 Celeste (video game) 条目与信息框：导演/设计师 Maddy Thorson、作曲 Lena Raine、开发者与发行 Maddy Makes Games、PC/Switch/PS4 2018-01-25、Xbox One 2018-01-26、Google Stadia 2020-07-28、平台列表；正文：本体 8 章 + 2019-09-09 免费 DLC「Farewell」新增第 9 章、Limited Run Games 收藏版 2019-01-01 开始预订；封面说明列出角色 Badeline、Oshiro、Madeline、Granny、Theo"),
  zhWikiCeleste: src("https://zh.wikipedia.org/wiki/%E8%94%9A%E8%97%8D_(%E9%81%8A%E6%88%B2)",
    "中文维基百科《蔚藍（遊戲）》条目：中文题名「蔚蓝／蔚藍」、主角瑪德琳、Theo（西奧）、Granny（老奶奶）、Mr. Oshiro（山城先生）、第九章为发售后新增"),
  steamHK: src("https://store.steampowered.com/app/367520/Hollow_Knight/",
    "Steam 商店页 + appdetails API（appids=367520）：开发者与发行 Team Cherry、发行日期 2017-02-24、Windows/macOS/Linux；简体中文商店文案使用「空洞骑士」并列出内容包中文名「格林剧团／生命血／寻神者」；日文商店文案使用「ホロウナイト」"),
  wikiHK: src("https://en.wikipedia.org/wiki/Hollow_Knight",
    "英文维基百科 Hollow Knight 条目与信息框：开发者/发行 Team Cherry、导演与设计师 Ari Gibson 与 William Pellen、插画 Ari Gibson、作曲 Christopher Larkin、脚本 Ari Gibson 与 William Pellen、Windows 2017-02-24 / Linux・macOS 2017-04-11 / Nintendo Switch 2018-06-12 / PS4・Xbox One 2018-09-25；正文「Downloadable content」节：Hidden Dreams 2017-08-03、The Grimm Troupe 2017-10-26、Lifeblood 2018-04-20、Godmaster 2018-08-23（四个免费内容包）"),
  steamDR: src("https://store.steampowered.com/app/1671210/DELTARUNE/",
    "Steam 商店页 + appdetails API（appids=1671210）：开发者与发行 tobyfox、发行日期 2025-06-04、支持平台 Windows/macOS、类型含 Indie"),
  wikiDR: src("https://en.wikipedia.org/wiki/Deltarune",
    "英文维基百科 Deltarune 条目与信息框：作者/编剧/作曲/设计/导演 Toby Fox、美术 Temmie Chang、发行方 Toby Fox 与 8-4（8-4 移植并发行主机版）、平台 macOS/Windows/Nintendo Switch/PS4/Switch 2/PS5；各章官方副标题 Chapter 1 The Beginning、Chapter 2 A Cyber's World、Chapter 3 Late Night、Chapter 4 Prophecy；Chapter 1 macOS・Windows 2018-10-31、Chapter 2 macOS・Windows 2021-09-17、Chapters 3+4 2025-06-04（NA/EU）；正文角色 Kris、Susie、Ralsei"),
};

const ev = (note, sources) => ({ note, sources });

/** 四语题名：没有可核实的官方译名时按 BRIEF 填原文题名，绝不编造。 */
function tr(en, opt = {}) {
  const out = {
    "zh-CN": { title: opt.cn || en },
    "zh-TW": { title: opt.tw || opt.cn || en },
    "ja-JP": { title: opt.ja || en },
    "en-US": { title: en },
  };
  if (opt.cnAlias) out["zh-CN"].aliases = [].concat(opt.cnAlias);
  if (opt.twAlias) out["zh-TW"].aliases = [].concat(opt.twAlias);
  if (opt.jaAlias) out["ja-JP"].aliases = [].concat(opt.jaAlias);
  if (opt.enAlias) out["en-US"].aliases = [].concat(opt.enAlias);
  return out;
}

// ── 主流程 ──────────────────────────────────────────────────────────────
const client = new Client();
if (!DRY) await client.login();
else console.log("[dry-run] 离线空跑：不登录、不写库、不发列表检索");
const camp = new Campaign({ domain: "console-game", client, index: Index.load() });
const lookup = !DRY; // 服务端 ?q= 查重只在真跑时执行（列表路由 120/分钟）

// 1) 责任主体 / 角色 agent
const A = {};

A.eok = await camp.ensureEntity("agent", "Extremely OK Games", {
  original_language: "en",
  types: ["group"],
  translations: tr("Extremely OK Games", { enAlias: ["Maddy Makes Games", "Matt Makes Games"] }),
}, ev("编目：建立《Celeste》的开发/发行团体 agent「Extremely OK Games」（group）。Steam 商店把开发者列为 Maddy Makes Games Inc. 与 Extremely OK Games, Ltd.，英文维基信息框的 developer/publisher 记作 Maddy Makes Games；二者是同一工作室的新旧名，故合并为一个主体，旧名放别名。",
  [S.steamCeleste, S.wikiCeleste]), { idemKey: "console-game-agent-eok", allowServerLookup: lookup });

A.thorson = await camp.ensureEntity("agent", "Maddy Thorson", {
  original_language: "en",
  types: ["person"],
  translations: tr("Maddy Thorson"),
}, ev("编目：建立《Celeste》导演/设计师 agent「Maddy Thorson」（person）。中文维基记作「麦迪·索尔森」。",
  [S.wikiCeleste, S.zhWikiCeleste]), { idemKey: "console-game-agent-thorson", allowServerLookup: lookup });

A.raine = await camp.ensureEntity("agent", "Lena Raine", {
  original_language: "en",
  types: ["person"],
  translations: tr("Lena Raine"),
}, ev("编目：建立《Celeste》作曲 agent「Lena Raine」（person）。",
  [S.wikiCeleste]), { idemKey: "console-game-agent-raine", allowServerLookup: lookup });

A.madeline = await camp.ensureEntity("agent", "Madeline", {
  original_language: "en",
  types: ["character"],
  translations: tr("Madeline", { cn: "玛德琳", tw: "瑪德琳", ja: "マデリン" }),
}, ev("编目：建立《Celeste》主角角色 agent「Madeline」（character）。中文维基正文作「瑪德琳」，日文商店文案作「マデリン」。",
  [S.wikiCeleste, S.zhWikiCeleste, S.steamCeleste]), { idemKey: "console-game-agent-madeline", allowServerLookup: lookup });

A.badeline = await camp.ensureEntity("agent", "Badeline", {
  original_language: "en",
  types: ["character"],
  translations: tr("Badeline"),
}, ev("编目：建立《Celeste》角色 agent「Badeline」（character）。英文维基封面说明列出 Badeline；中文维基描述为「由她的阴暗面构成的『另一个瑪德琳』」，未给出官方中文名，故三语保留原文。",
  [S.wikiCeleste, S.zhWikiCeleste]), { idemKey: "console-game-agent-badeline", allowServerLookup: lookup });

A.theo = await camp.ensureEntity("agent", "Theo", {
  original_language: "en",
  types: ["character"],
  translations: tr("Theo", { cn: "西奥", tw: "西奧" }),
}, ev("编目：建立《Celeste》角色 agent「Theo」（character）。中文维基正文作「西雅圖人西奧（Theo）」。",
  [S.wikiCeleste, S.zhWikiCeleste]), { idemKey: "console-game-agent-theo", allowServerLookup: lookup });

A.tobyfox = await camp.ensureEntity("agent", "Toby Fox", {
  original_language: "en",
  types: ["person"],
  translations: tr("Toby Fox"),
}, ev("编目：建立《DELTARUNE》作者 agent「Toby Fox」（person）。",
  [S.wikiDR, S.steamDR]), { idemKey: "console-game-agent-tobyfox", allowServerLookup: lookup });

A.eightfour = await camp.ensureEntity("agent", "8-4", {
  original_language: "en",
  types: ["organization"],
  translations: tr("8-4"),
}, ev("编目：建立《DELTARUNE》主机版移植/发行方 agent「8-4」（organization）。英文维基信息框注明 8-4 ported and published the console versions（附 IGN 与移植负责人推文引用）。",
  [S.wikiDR]), { idemKey: "console-game-agent-8-4", allowServerLookup: lookup });

A.temmie = await camp.ensureEntity("agent", "Temmie Chang", {
  original_language: "en",
  types: ["person"],
  translations: tr("Temmie Chang"),
}, ev("编目：建立《DELTARUNE》美术 agent「Temmie Chang」（person）。",
  [S.wikiDR]), { idemKey: "console-game-agent-temmie", allowServerLookup: lookup });

A.kris = await camp.ensureEntity("agent", "Kris", {
  original_language: "en",
  types: ["character"],
  translations: tr("Kris"),
}, ev("编目：建立《DELTARUNE》主角角色 agent「Kris」（character）。",
  [S.wikiDR]), { idemKey: "console-game-agent-kris", allowServerLookup: lookup });

A.susie = await camp.ensureEntity("agent", "Susie", {
  original_language: "en",
  types: ["character"],
  translations: tr("Susie"),
}, ev("编目：建立《DELTARUNE》角色 agent「Susie」（character）。",
  [S.wikiDR]), { idemKey: "console-game-agent-susie", allowServerLookup: lookup });

A.ralsei = await camp.ensureEntity("agent", "Ralsei", {
  original_language: "en",
  types: ["character"],
  translations: tr("Ralsei"),
}, ev("编目：建立《DELTARUNE》角色 agent「Ralsei」（character）。",
  [S.wikiDR]), { idemKey: "console-game-agent-ralsei", allowServerLookup: lookup });

A.teamcherry = await camp.ensureEntity("agent", "Team Cherry", {
  original_language: "en",
  types: ["group"],
  translations: tr("Team Cherry"),
}, ev("编目：建立《Hollow Knight》开发/发行团体 agent「Team Cherry」（group）。",
  [S.wikiHK, S.steamHK]), { idemKey: "console-game-agent-teamcherry", allowServerLookup: lookup });

A.larkin = await camp.ensureEntity("agent", "Christopher Larkin", {
  original_language: "en",
  types: ["person"],
  translations: tr("Christopher Larkin"),
}, ev("编目：建立《Hollow Knight》作曲 agent「Christopher Larkin」（person）。",
  [S.wikiHK]), { idemKey: "console-game-agent-larkin", allowServerLookup: lookup });

A.gibson = await camp.ensureEntity("agent", "Ari Gibson", {
  original_language: "en",
  types: ["person"],
  translations: tr("Ari Gibson"),
}, ev("编目：建立《Hollow Knight》导演/美术 agent「Ari Gibson」（person）。英文维基记其为本作创始成员、artist 与 director。",
  [S.wikiHK]), { idemKey: "console-game-agent-gibson", allowServerLookup: lookup });

A.pellen = await camp.ensureEntity("agent", "William Pellen", {
  original_language: "en",
  types: ["person"],
  translations: tr("William Pellen"),
}, ev("编目：建立《Hollow Knight》导演/设计师 agent「William Pellen」（person）。英文维基记其为本作创始成员、designer 与 director。",
  [S.wikiHK]), { idemKey: "console-game-agent-pellen", allowServerLookup: lookup });

// 2) 游戏 Work
const celeste = await camp.ensureEntity("work", "Celeste", {
  original_language: "en",
  types: ["indie_game"],
  translations: tr("Celeste", { cnAlias: ["蔚蓝"], twAlias: ["蔚藍"] }),
  attributes: {
    platform: "Windows / macOS / Linux / Nintendo Switch / PlayStation 4 / Xbox One / Google Stadia",
    language: "en",
    edition_date: "2018-01-25",
    episodes: 9,
    tags: ["独立游戏", "平台游戏"],
  },
  external_ids: { steam: "504230" },
}, ev("编目：新建独立游戏作品《Celeste》（indie_game，原语言 en）。平台与首发日取自英文维基信息框（PC/Switch/PS4 2018-01-25、Xbox One 2018-01-26、Stadia 2020-07-28）并用 Steam 商店页核对（2018-01-25，Windows/macOS/Linux）。episodes=9 记本体 8 章 + 免费 DLC 第 9 章。中文题名「蔚蓝／蔚藍」来自中文维基条目，作为别名保留（是否为官方译名未核实）。",
  [S.wikiCeleste, S.steamCeleste, S.zhWikiCeleste]), { idemKey: "console-game-work-celeste", allowServerLookup: lookup });

const deltarune = await camp.ensureEntity("work", "DELTARUNE", {
  original_language: "en",
  types: ["indie_game"],
  translations: tr("DELTARUNE"),
  attributes: {
    platform: "Windows / macOS / Nintendo Switch / PlayStation 4 / PlayStation 5",
    language: "en",
    edition_date: "2018-10-31",
    episodes: 4,
    tags: ["独立游戏", "角色扮演"],
  },
  external_ids: { steam: "1671210" },
}, ev("编目：新建独立游戏作品《DELTARUNE》（indie_game，原语言 en）。首章 2018-10-31 于 macOS/Windows 发布，2025-06-04（NA/EU）随 Chapter 3+4 登陆多平台；平台与日期取自英文维基信息框，Steam 商店页（2025-06-04）核对现行发售。episodes=4 记本次编目的 Chapter 1–4。",
  [S.wikiDR, S.steamDR]), { idemKey: "console-game-work-deltarune", allowServerLookup: lookup });

const hollowknight = await camp.ensureEntity("work", "Hollow Knight", {
  original_language: "en",
  types: ["indie_game"],
  translations: tr("Hollow Knight", { cn: "空洞骑士", tw: "空洞騎士", ja: "ホロウナイト" }),
  attributes: {
    platform: "Windows / Linux / macOS / Nintendo Switch / PlayStation 4 / Xbox One",
    language: "en",
    edition_date: "2017-02-24",
    tags: ["独立游戏", "メトロイドヴァニア"],
  },
  external_ids: { steam: "367520" },
}, ev("编目：新建独立游戏作品《Hollow Knight》（indie_game，原语言 en）。Windows 首发 2017-02-24（Steam 商店页与维基信息框一致）。中文题名取自 Steam 简体中文商店文案「空洞骑士」，日文题名取自 Steam 日文商店文案「ホロウナイト」；zh-TW 为 zh-CN 的繁体对应。",
  [S.wikiHK, S.steamHK]), { idemKey: "console-game-work-hollowknight", allowServerLookup: lookup });

// 3) ContentUnit（章节 / 内容包）
const CELESTE_CH = [
  { n: 1, title: "Chapter 1", air: "2018-01-25", role: "main" },
  { n: 2, title: "Chapter 2", air: "2018-01-25", role: "main" },
  { n: 3, title: "Chapter 3", air: "2018-01-25", role: "main" },
  { n: 4, title: "Chapter 4", air: "2018-01-25", role: "main" },
  { n: 5, title: "Chapter 5", air: "2018-01-25", role: "main" },
  { n: 6, title: "Chapter 6", air: "2018-01-25", role: "main" },
  { n: 7, title: "Chapter 7", air: "2018-01-25", role: "main" },
  { n: 8, title: "Chapter 8", air: "2018-01-25", role: "main" },
  { n: 9, title: "Farewell", air: "2019-09-09", role: "extra" },
];
const CU_CELESTE = {};
for (const c of CELESTE_CH) {
  CU_CELESTE[c.n] = await camp.ensureEntity("content_unit", c.title, {
    work_id: celeste.id, position: c.n, number: String(c.n),
    original_language: "en", types: ["content_unit"],
    translations: tr(c.title),
    attributes: { language: "en", entry_role: c.role, air_date: c.air },
  }, ev("编目：为《Celeste》建立篇目「" + c.title + "」（number=" + c.n + "、entry_role=" + c.role + "）。本体共 8 章、Farewell 为 2019-09-09 免费 DLC 追加的第 9 章，均取自英文维基正文；各章官方名称未在官网/维基给出可考据清单，故题名只用编号，Farewell 用官方 DLC 名。air_date 借用「篇目首发日」（本体章节随 2018-01-25 首发、第 9 章随 2019-09-09 上线）。",
    [S.wikiCeleste, S.zhWikiCeleste]), { idemKey: "console-game-cu-celeste-" + c.n, allowServerLookup: false });
}

const DELTARUNE_CH = [
  { n: 1, title: "Chapter 1: The Beginning", air: "2018-10-31" },
  { n: 2, title: "Chapter 2: A Cyber's World", air: "2021-09-17" },
  { n: 3, title: "Chapter 3: Late Night", air: "2025-06-04" },
  { n: 4, title: "Chapter 4: Prophecy", air: "2025-06-04" },
];
const CU_DELTARUNE = {};
for (const c of DELTARUNE_CH) {
  CU_DELTARUNE[c.n] = await camp.ensureEntity("content_unit", c.title, {
    work_id: deltarune.id, position: c.n, number: String(c.n),
    original_language: "en", types: ["content_unit"],
    translations: tr(c.title),
    attributes: { language: "en", entry_role: "main", air_date: c.air },
  }, ev("编目：为《DELTARUNE》建立篇目「" + c.title + "」（number=" + c.n + "）。副标题取自英文维基正文的各章标题；air_date 借用各章首发日（Ch1 2018-10-31、Ch2 2021-09-17、Ch3・Ch4 2025-06-04 macOS/Windows）。",
    [S.wikiDR, S.steamDR]), { idemKey: "console-game-cu-deltarune-" + c.n, allowServerLookup: false });
}

const HK_PACKS = [
  { n: 1, title: "Hidden Dreams", air: "2017-08-03" },
  { n: 2, title: "The Grimm Troupe", air: "2017-10-26", cn: "格林剧团", tw: "格林劇團" },
  { n: 3, title: "Lifeblood", air: "2018-04-20", cn: "生命血", tw: "生命血" },
  { n: 4, title: "Godmaster", air: "2018-08-23", cn: "寻神者", tw: "尋神者" },
];
const CU_HK = {};
for (const p of HK_PACKS) {
  CU_HK[p.n] = await camp.ensureEntity("content_unit", p.title, {
    work_id: hollowknight.id, position: p.n, number: "",
    original_language: "en", types: ["content_unit"],
    translations: tr(p.title, p.cn ? { cn: p.cn, tw: p.tw } : {}),
    attributes: { language: "en", entry_role: "extra", air_date: p.air },
  }, ev("编目：为《Hollow Knight》建立内容包篇目「" + p.title + "」（免费更新，2017–2018 共四个）。名称与发布日期取自英文维基「Downloadable content」节。" + (p.cn ? "中文名「" + p.cn + "」取自 Steam 简体中文商店文案。" : "该内容包未在 Steam 简体中文文案中出现，三语保留原文题名。"),
    [S.wikiHK, S.steamHK]), { idemKey: "console-game-cu-hk-" + p.n, allowServerLookup: false });
}

// 4) Expression（可被多个发行复用的表达）
const EX_CELESTE = {};
for (const c of CELESTE_CH) {
  EX_CELESTE[c.n] = await camp.ensureEntity("expression", c.title, {
    work_id: celeste.id, content_unit_id: CU_CELESTE[c.n].id, position: c.n,
    original_language: "en", types: ["expression"],
    translations: tr(c.title),
    attributes: { language: "en" },
  }, ev("编目：为《Celeste》篇目「" + c.title + "」建立表达（挂 content_unit_id=" + CU_CELESTE[c.n].id.slice(0, 8) + "…，language=en）。表达指该章节可被多个平台发行重复收录的游戏内容。",
    [S.wikiCeleste, S.steamCeleste]), { idemKey: "console-game-ex-celeste-" + c.n, allowServerLookup: false });
}

const EX_DELTARUNE = {};
for (const c of DELTARUNE_CH) {
  EX_DELTARUNE[c.n] = await camp.ensureEntity("expression", c.title, {
    work_id: deltarune.id, content_unit_id: CU_DELTARUNE[c.n].id, position: c.n,
    original_language: "en", types: ["expression"],
    translations: tr(c.title),
    attributes: { language: "en" },
  }, ev("编目：为《DELTARUNE》篇目「" + c.title + "」建立表达（挂 content_unit_id，language=en）。",
    [S.wikiDR, S.steamDR]), { idemKey: "console-game-ex-deltarune-" + c.n, allowServerLookup: false });
}

const EX_HK = {};
for (const p of HK_PACKS) {
  EX_HK[p.n] = await camp.ensureEntity("expression", p.title, {
    work_id: hollowknight.id, content_unit_id: CU_HK[p.n].id, position: p.n,
    original_language: "en", types: ["expression"],
    translations: tr(p.title, p.cn ? { cn: p.cn, tw: p.tw } : {}),
    attributes: { language: "en", version_label: "無償アップデート" },
  }, ev("编目：为《Hollow Knight》内容包「" + p.title + "」建立表达（挂 content_unit_id，language=en）。version_label 记该内容以免费更新形式提供。",
    [S.wikiHK, S.steamHK]), { idemKey: "console-game-ex-hk-" + p.n, allowServerLookup: false });
}

// 5) Release（平台版）
const relCelestePC = await camp.ensureEntity("release", "Celeste (Windows / macOS / Linux)", {
  original_language: "en", types: ["release"],
  translations: tr("Celeste (Windows / macOS / Linux)"),
  subjects: [{ work_id: celeste.id, role: "primary" }],
  attributes: {
    platform: "Windows / macOS / Linux",
    edition_date: "2018-01-25",
    edition_type: "standard", edition_batch: "regular",
    distribution_channel: "digital",
    publisher: A.eok.id,
  },
}, ev("编目：新建《Celeste》PC 数字版发行（Steam）。发行日期 2018-01-25、平台 Windows/macOS/Linux 取自 Steam 商店页与英文维基；发行主体 Maddy Makes Games（即 Extremely OK Games 旧名）。subjects 声明作品《Celeste》为 primary。",
  [S.steamCeleste, S.wikiCeleste]), { idemKey: "console-game-rel-celeste-pc", allowServerLookup: false });

const relCelesteSwitch = await camp.ensureEntity("release", "Celeste (Nintendo Switch)", {
  original_language: "en", types: ["release"],
  translations: tr("Celeste (Nintendo Switch)"),
  subjects: [{ work_id: celeste.id, role: "primary" }],
  attributes: {
    platform: "Nintendo Switch",
    edition_date: "2018-01-25",
    edition_type: "standard", edition_batch: "regular",
    distribution_channel: "digital",
    publisher: A.eok.id,
  },
}, ev("编目：新建《Celeste》Nintendo Switch 数字版发行。2018-01-25 与 PC/PS4 同日发售，取自英文维基正文与平台列表。subjects 声明作品《Celeste》为 primary；版本靠平台区分（同一作品的多平台发行）。",
  [S.wikiCeleste]), { idemKey: "console-game-rel-celeste-switch", allowServerLookup: false });

const relDrCh1 = await camp.ensureEntity("release", "DELTARUNE Chapter 1 (Windows / macOS)", {
  original_language: "en", types: ["release"],
  translations: tr("DELTARUNE Chapter 1 (Windows / macOS)"),
  subjects: [{ work_id: deltarune.id, role: "primary" }],
  attributes: {
    platform: "Windows / macOS",
    edition_date: "2018-10-31",
    edition_type: "standard", edition_batch: "regular",
    distribution_channel: "digital",
    publisher: A.tobyfox.id,
  },
}, ev("编目：新建《DELTARUNE》第一章首发版（macOS/Windows，免费公开）。日期 2018-10-31 取自英文维基信息框 Chapter 1 栏。",
  [S.wikiDR]), { idemKey: "console-game-rel-dr-ch1", allowServerLookup: false });

const relDrMain = await camp.ensureEntity("release", "DELTARUNE (Windows / macOS / Nintendo Switch / PlayStation 4 / PlayStation 5)", {
  original_language: "en", types: ["release"],
  translations: tr("DELTARUNE (Windows / macOS / Nintendo Switch / PlayStation 4 / PlayStation 5)"),
  subjects: [{ work_id: deltarune.id, role: "primary" }],
  attributes: {
    platform: "Windows / macOS / Nintendo Switch / PlayStation 4 / PlayStation 5",
    edition_date: "2025-06-04",
    edition_type: "standard", edition_batch: "regular",
    distribution_channel: "digital",
    publisher: A.tobyfox.id,
  },
}, ev("编目：新建《DELTARUNE》多平台现行发行（Chapter 3+4 上线，2025-06-04 NA/EU）。日期与平台取自英文维基信息框 Chapters 3+4 栏，并用 Steam 商店页（2025-06-04）核对；主机版由 8-4 移植发行。",
  [S.wikiDR, S.steamDR]), { idemKey: "console-game-rel-dr-main", allowServerLookup: false });

const relHkPC = await camp.ensureEntity("release", "Hollow Knight (Windows)", {
  original_language: "en", types: ["release"],
  translations: tr("Hollow Knight (Windows)"),
  subjects: [{ work_id: hollowknight.id, role: "primary" }],
  attributes: {
    platform: "Windows",
    edition_date: "2017-02-24",
    edition_type: "standard", edition_batch: "regular",
    distribution_channel: "digital",
    publisher: A.teamcherry.id,
  },
}, ev("编目：新建《Hollow Knight》Windows 首发数字版。2017-02-24 取自 Steam 商店页与英文维基信息框。",
  [S.steamHK, S.wikiHK]), { idemKey: "console-game-rel-hk-pc", allowServerLookup: false });

// 6) Medium（真实存在的容器：此处为各大平台的数字配信）
const med = {};
med.celestePC = await camp.ensureEntity("medium", "Steam 配信", {
  release_id: relCelestePC.id, position: 1,
  original_language: "en", types: ["medium"],
  translations: tr("Steam 配信", { cn: "Steam 数字下载", tw: "Steam 數位下載" }),
  attributes: { format: "digital", role: "primary" },
}, ev("编目：按发行实物建立载体「Steam 配信」（format=digital、role=primary）。该发行只经 Steam 数字配信，无实体盘。",
  [S.steamCeleste]), { idemKey: "console-game-med-celeste-pc", scope: { release_id: relCelestePC.id }, allowServerLookup: false });

med.celesteSwitch = await camp.ensureEntity("medium", "Nintendo eShop 配信", {
  release_id: relCelesteSwitch.id, position: 1,
  original_language: "en", types: ["medium"],
  translations: tr("Nintendo eShop 配信", { cn: "Nintendo eShop 数字下载", tw: "Nintendo eShop 數位下載" }),
  attributes: { format: "digital", role: "primary" },
}, ev("编目：建立载体「Nintendo eShop 配信」（format=digital、role=primary）。Switch 版为下载版；Switch 游戏卡带在载体格式词表里没有对应码（见报告缺口节）。",
  [S.wikiCeleste]), { idemKey: "console-game-med-celeste-switch", scope: { release_id: relCelesteSwitch.id }, allowServerLookup: false });

med.drCh1 = await camp.ensureEntity("medium", "Steam 配信（Windows / macOS）", {
  release_id: relDrCh1.id, position: 1,
  original_language: "en", types: ["medium"],
  translations: tr("Steam 配信（Windows / macOS）", { cn: "Steam 数字下载（Windows / macOS）", tw: "Steam 數位下載（Windows / macOS）" }),
  attributes: { format: "digital", role: "primary" },
}, ev("编目：建立载体「Steam 配信（Windows / macOS）」（format=digital、role=primary）。",
  [S.wikiDR, S.steamDR]), { idemKey: "console-game-med-dr-ch1", scope: { release_id: relDrCh1.id }, allowServerLookup: false });

med.drMain = await camp.ensureEntity("medium", "各プラットフォーム配信", {
  release_id: relDrMain.id, position: 1,
  original_language: "en", types: ["medium"],
  translations: tr("各プラットフォーム配信", { cn: "各平台数字发行", tw: "各平台數位發行" }),
  attributes: { format: "digital", role: "primary" },
}, ev("编目：建立载体「各プラットフォーム配信」（format=digital、role=primary）。该发行同时覆盖 PC 与主机数字商店，载体层未按商店再细分（见报告缺口节）。",
  [S.wikiDR, S.steamDR]), { idemKey: "console-game-med-dr-main", scope: { release_id: relDrMain.id }, allowServerLookup: false });

med.hkPC = await camp.ensureEntity("medium", "Steam 配信（Windows）", {
  release_id: relHkPC.id, position: 1,
  original_language: "en", types: ["medium"],
  translations: tr("Steam 配信（Windows）", { cn: "Steam 数字下载（Windows）", tw: "Steam 數位下載（Windows）" }),
  attributes: { format: "digital", role: "primary" },
}, ev("编目：建立载体「Steam 配信（Windows）」（format=digital、role=primary）。",
  [S.steamHK]), { idemKey: "console-game-med-hk-pc", scope: { release_id: relHkPC.id }, allowServerLookup: false });

// 7) Track（媒介内收录位置；contents 引用章节 Expression）
const contentsOf = (map, list) => list.map((x) => ({ expression_id: map[x.n].id, position: x.n, locator: null }));

const tk = {};
tk.celestePC = await camp.ensureEntity("track", "Celeste（Windows / macOS / Linux 版）", {
  medium_id: med.celestePC.id, position: 1, number: "1",
  contents: contentsOf(EX_CELESTE, CELESTE_CH),
  original_language: "en", types: ["track"],
  translations: tr("Celeste（Windows / macOS / Linux 版）", { cn: "Celeste（Windows / macOS / Linux 版）" }),
  attributes: { role: "primary" },
}, ev("编目：建立收录位置「Celeste（Windows / macOS / Linux 版）」，contents 依次引用本体 8 章与 Farewell 的表达（position=1..9）。游戏发行没有音乐专辑式的逐曲位置，本领域把「整份游戏内容」记为一个收录位置，章节顺序由 contents.position 表达。",
  [S.steamCeleste, S.wikiCeleste]), { idemKey: "console-game-track-celeste-pc", scope: { medium_id: med.celestePC.id }, allowServerLookup: false });

tk.celesteSwitch = await camp.ensureEntity("track", "Celeste（Nintendo Switch 版）", {
  medium_id: med.celesteSwitch.id, position: 1, number: "1",
  contents: contentsOf(EX_CELESTE, CELESTE_CH),
  original_language: "en", types: ["track"],
  translations: tr("Celeste（Nintendo Switch 版）"),
  attributes: { role: "primary" },
}, ev("编目：建立收录位置「Celeste（Nintendo Switch 版）」，复用与 PC 版相同的 9 条章节表达（跨发行复用同一 Expression）。",
  [S.wikiCeleste]), { idemKey: "console-game-track-celeste-switch", scope: { medium_id: med.celesteSwitch.id }, allowServerLookup: false });

tk.drCh1 = await camp.ensureEntity("track", "DELTARUNE Chapter 1", {
  medium_id: med.drCh1.id, position: 1, number: "1",
  contents: contentsOf(EX_DELTARUNE, [DELTARUNE_CH[0]]),
  original_language: "en", types: ["track"],
  translations: tr("DELTARUNE Chapter 1"),
  attributes: { role: "primary" },
}, ev("编目：建立收录位置「DELTARUNE Chapter 1」，contents 引用第一章表达。",
  [S.wikiDR]), { idemKey: "console-game-track-dr-ch1", scope: { medium_id: med.drCh1.id }, allowServerLookup: false });

tk.drMain = await camp.ensureEntity("track", "DELTARUNE（Windows / macOS / Nintendo Switch / PlayStation 4 / PlayStation 5 版）", {
  medium_id: med.drMain.id, position: 1, number: "1",
  contents: contentsOf(EX_DELTARUNE, DELTARUNE_CH),
  original_language: "en", types: ["track"],
  translations: tr("DELTARUNE（Windows / macOS / Nintendo Switch / PlayStation 4 / PlayStation 5 版）"),
  attributes: { role: "primary" },
}, ev("编目：建立收录位置「DELTARUNE（多平台版）」，contents 引用 Chapter 1–4 的表达，验证同一 Expression 被首发版与现行多平台版重复收录。",
  [S.wikiDR, S.steamDR]), { idemKey: "console-game-track-dr-main", scope: { medium_id: med.drMain.id }, allowServerLookup: false });

tk.hkPC = await camp.ensureEntity("track", "Hollow Knight（Windows 版）", {
  medium_id: med.hkPC.id, position: 1, number: "1",
  contents: contentsOf(EX_HK, HK_PACKS),
  original_language: "en", types: ["track"],
  translations: tr("Hollow Knight（Windows 版）"),
  attributes: { role: "primary" },
}, ev("编目：建立收录位置「Hollow Knight（Windows 版）」，contents 引用四个免费内容包（Hidden Dreams / The Grimm Troupe / Lifeblood / Godmaster）的表达。游戏本体本身不构成篇目，故不在 contents 内（见报告缺口节）。",
  [S.steamHK, S.wikiHK]), { idemKey: "console-game-track-hk-pc", scope: { medium_id: med.hkPC.id }, allowServerLookup: false });

// 8) 关系
const RC = {
  dev: (w) => ev("编目：署名《" + w + "》的开发主体。", [S.wikiCeleste, S.steamCeleste]),
  devHK: ev("编目：署名《Hollow Knight》的开发与发行主体为 Team Cherry。", [S.wikiHK, S.steamHK]),
  devDR: ev("编目：署名《DELTARUNE》的开发主体为 Toby Fox 个人。", [S.wikiDR, S.steamDR]),
  dir: (who) => ev("编目：署名《Celeste》导演/设计师为 " + who + "（英文维基信息框 director 与 programmer 栏、中文维基「由加拿大电子游戏设计师麦迪·索尔森和諾爾·貝瑞设计开发」）。", [S.wikiCeleste, S.zhWikiCeleste]),
  dirDR: ev("编目：署名《DELTARUNE》导演/设计/编剧为 Toby Fox（英文维基信息框 director、designer、writer 栏）。", [S.wikiDR]),
  dirHK: (who) => ev("编目：署名《Hollow Knight》导演为 " + who + "（英文维基信息框 director 栏）。", [S.wikiHK]),
  comp: ev("编目：署名《Celeste》作曲为 Lena Raine。", [S.wikiCeleste]),
  compDR: ev("编目：署名《DELTARUNE》作曲为 Toby Fox（英文维基信息框 composer 栏）。", [S.wikiDR]),
  compHK: ev("编目：署名《Hollow Knight》作曲为 Christopher Larkin（英文维基信息框 composer 栏）。", [S.wikiHK]),
  writeDR: ev("编目：署名《DELTARUNE》编剧为 Toby Fox（英文维基信息框 writer 栏）。", [S.wikiDR]),
  writeHK: (who) => ev("编目：署名《Hollow Knight》脚本为 " + who + "（英文维基信息框 writer 栏）。", [S.wikiHK]),
  illusDR: ev("编目：署名《DELTARUNE》美术为 Temmie Chang（英文维基信息框 artist 栏）。", [S.wikiDR]),
  illusHK: ev("编目：署名《Hollow Knight》插画/美术为 Ari Gibson（英文维基信息框 artist 栏，正文记其为本作创始成员之一的美术）。", [S.wikiHK]),
  creditEOK: ev("编目：署名《Celeste》Nintendo Switch 数字版的发行主体为 Maddy Makes Games（即 Extremely OK Games）。", [S.wikiCeleste]),
  credit84: ev("编目：署名《DELTARUNE》主机版的移植与发行由 8-4 负责（英文维基信息框 publisher 注与引用）。", [S.wikiDR]),
  creditTC: ev("编目：署名《Hollow Knight》Windows 版的发行主体为 Team Cherry。", [S.wikiHK, S.steamHK]),
};

await camp.createRelation("developed_by", celeste.id, A.eok.id, RC.dev("Celeste"), { attributes: { credit_role: "開発" }, skipIfExists: !DRY });
await camp.createRelation("directed_by", celeste.id, A.thorson.id, RC.dir("Maddy Thorson"), { attributes: { credit_role: "監督・デザイン" }, skipIfExists: !DRY });
await camp.createRelation("composed_by", celeste.id, A.raine.id, RC.comp, { attributes: { credit_role: "作曲" }, skipIfExists: !DRY });
await camp.createRelation("character_in", A.madeline.id, celeste.id, ev("编目：登记主角角色 Madeline 出演《Celeste》（character_rank=main）。", [S.wikiCeleste, S.zhWikiCeleste]), { attributes: { character_rank: "main" }, skipIfExists: !DRY });
await camp.createRelation("character_in", A.badeline.id, celeste.id, ev("编目：登记角色 Badeline 出演《Celeste》（character_rank=supporting）。", [S.wikiCeleste]), { attributes: { character_rank: "supporting" }, skipIfExists: !DRY });
await camp.createRelation("character_in", A.theo.id, celeste.id, ev("编目：登记角色 Theo 出演《Celeste》（character_rank=supporting）。", [S.wikiCeleste, S.zhWikiCeleste]), { attributes: { character_rank: "supporting" }, skipIfExists: !DRY });
await camp.createRelation("credit_for", relCelesteSwitch.id, A.eok.id, RC.creditEOK, { attributes: { credit_role: "発売元" }, skipIfExists: !DRY });

await camp.createRelation("developed_by", deltarune.id, A.tobyfox.id, RC.devDR, { attributes: { credit_role: "開発" }, skipIfExists: !DRY });
await camp.createRelation("composed_by", deltarune.id, A.tobyfox.id, RC.compDR, { attributes: { credit_role: "作曲" }, skipIfExists: !DRY });
await camp.createRelation("written_by", deltarune.id, A.tobyfox.id, RC.writeDR, { attributes: { credit_role: "脚本" }, skipIfExists: !DRY });
await camp.createRelation("directed_by", deltarune.id, A.tobyfox.id, RC.dirDR, { attributes: { credit_role: "監督" }, skipIfExists: !DRY });
await camp.createRelation("illustrated_by", deltarune.id, A.temmie.id, RC.illusDR, { attributes: { credit_role: "アート" }, skipIfExists: !DRY });
await camp.createRelation("character_in", A.kris.id, deltarune.id, ev("编目：登记主角角色 Kris 出演《DELTARUNE》（character_rank=main）。", [S.wikiDR]), { attributes: { character_rank: "main" }, skipIfExists: !DRY });
await camp.createRelation("character_in", A.susie.id, deltarune.id, ev("编目：登记角色 Susie 出演《DELTARUNE》（character_rank=main）。", [S.wikiDR]), { attributes: { character_rank: "main" }, skipIfExists: !DRY });
await camp.createRelation("character_in", A.ralsei.id, deltarune.id, ev("编目：登记角色 Ralsei 出演《DELTARUNE》（character_rank=main）。", [S.wikiDR]), { attributes: { character_rank: "main" }, skipIfExists: !DRY });
await camp.createRelation("credit_for", relDrMain.id, A.eightfour.id, RC.credit84, { attributes: { credit_role: "コンソール版 移植・発売" }, skipIfExists: !DRY });

await camp.createRelation("developed_by", hollowknight.id, A.teamcherry.id, RC.devHK, { attributes: { credit_role: "開発・発売" }, skipIfExists: !DRY });
await camp.createRelation("composed_by", hollowknight.id, A.larkin.id, RC.compHK, { attributes: { credit_role: "作曲" }, skipIfExists: !DRY });
await camp.createRelation("directed_by", hollowknight.id, A.gibson.id, RC.dirHK("Ari Gibson"), { attributes: { credit_role: "監督" }, skipIfExists: !DRY });
await camp.createRelation("directed_by", hollowknight.id, A.pellen.id, RC.dirHK("William Pellen"), { attributes: { credit_role: "監督" }, skipIfExists: !DRY });
await camp.createRelation("illustrated_by", hollowknight.id, A.gibson.id, RC.illusHK, { attributes: { credit_role: "アート" }, skipIfExists: !DRY });
await camp.createRelation("written_by", hollowknight.id, A.gibson.id, RC.writeHK("Ari Gibson"), { attributes: { credit_role: "脚本" }, skipIfExists: !DRY });
await camp.createRelation("written_by", hollowknight.id, A.pellen.id, RC.writeHK("William Pellen"), { attributes: { credit_role: "脚本" }, skipIfExists: !DRY });
await camp.createRelation("credit_for", relHkPC.id, A.teamcherry.id, RC.creditTC, { attributes: { credit_role: "発売元" }, skipIfExists: !DRY });

// ── 写后回读断言 ────────────────────────────────────────────────────────
const problems = [];
const checked = { entities: 0, relations: 0, revisions: 0 };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok, msg) => { if (!ok) problems.push(msg); };

async function verify() {
  const ALL = [];
  const push = (e, tag) => ALL.push({ e, tag });
  push(celeste, "work/Celeste"); push(deltarune, "work/DELTARUNE"); push(hollowknight, "work/HK");
  for (const c of CELESTE_CH) { push(CU_CELESTE[c.n], "cu/Celeste/" + c.n); push(EX_CELESTE[c.n], "ex/Celeste/" + c.n); }
  for (const c of DELTARUNE_CH) { push(CU_DELTARUNE[c.n], "cu/DR/" + c.n); push(EX_DELTARUNE[c.n], "ex/DR/" + c.n); }
  for (const p of HK_PACKS) { push(CU_HK[p.n], "cu/HK/" + p.n); push(EX_HK[p.n], "ex/HK/" + p.n); }
  push(relCelestePC, "release/Celeste/PC"); push(relCelesteSwitch, "release/Celeste/Switch");
  push(relDrCh1, "release/DR/Ch1"); push(relDrMain, "release/DR/main"); push(relHkPC, "release/HK/PC");
  push(med.celestePC, "medium/Celeste/PC"); push(med.celesteSwitch, "medium/Celeste/Switch");
  push(med.drCh1, "medium/DR/Ch1"); push(med.drMain, "medium/DR/main"); push(med.hkPC, "medium/HK/PC");
  push(tk.celestePC, "track/Celeste/PC"); push(tk.celesteSwitch, "track/Celeste/Switch");
  push(tk.drCh1, "track/DR/Ch1"); push(tk.drMain, "track/DR/main"); push(tk.hkPC, "track/HK/PC");
  for (const a of Object.values(A)) push(a, "agent");

  const fresh = new Map();
  for (const { e, tag } of ALL) {
    const got = await camp.getEntity(e.id);
    fresh.set(e.id, got);
    checked.entities++;
    check(got.kind === e.kind, tag + " 回读 kind 不一致：" + got.kind + " ≠ " + e.kind);
    check(got.status === "published", tag + " 状态不是 published：" + got.status);
    for (const loc of ["zh-CN", "zh-TW", "ja-JP", "en-US"]) {
      check(!!(got.translations || {})[loc] && !!(got.translations || {})[loc].title, tag + " 缺 " + loc + " 题名");
    }
  }

  // A 创作链归属
  for (const c of CELESTE_CH) {
    const cu = fresh.get(CU_CELESTE[c.n].id), ex = fresh.get(EX_CELESTE[c.n].id);
    check(cu.work_id === celeste.id, "cu/Celeste/" + c.n + " work_id 不属于《Celeste》");
    check(String(cu.number) === String(c.n) && cu.position === c.n, "cu/Celeste/" + c.n + " number/position 与章节号不符");
    check(cu.attributes && cu.attributes.entry_role === c.role, "cu/Celeste/" + c.n + " entry_role 不符");
    check(ex.work_id === celeste.id, "ex/Celeste/" + c.n + " work_id 不属于《Celeste》");
    check(ex.content_unit_id === CU_CELESTE[c.n].id, "ex/Celeste/" + c.n + " content_unit_id 未挂到对应篇目");
    check(!ex.parent_id, "ex/Celeste/" + c.n + " 不应有 parent_id");
  }
  for (const c of DELTARUNE_CH) {
    const cu = fresh.get(CU_DELTARUNE[c.n].id), ex = fresh.get(EX_DELTARUNE[c.n].id);
    check(cu.work_id === deltarune.id, "cu/DR/" + c.n + " work_id 不属于《DELTARUNE》");
    check(ex.work_id === deltarune.id && ex.content_unit_id === CU_DELTARUNE[c.n].id, "ex/DR/" + c.n + " work_id/content_unit_id 归属错误");
    check(cu.attributes && cu.attributes.air_date === c.air, "cu/DR/" + c.n + " air_date 不符");
  }
  for (const p of HK_PACKS) {
    const cu = fresh.get(CU_HK[p.n].id), ex = fresh.get(EX_HK[p.n].id);
    check(cu.work_id === hollowknight.id, "cu/HK/" + p.n + " work_id 不属于《Hollow Knight》");
    check(cu.attributes && cu.attributes.entry_role === "extra", "cu/HK/" + p.n + " entry_role 应为 extra");
    check(ex.work_id === hollowknight.id && ex.content_unit_id === CU_HK[p.n].id, "ex/HK/" + p.n + " work_id/content_unit_id 归属错误");
  }

  // B 承载链与 subjects 覆盖
  const chains = [
    [relCelestePC, med.celestePC, tk.celestePC, celeste, "release/Celeste/PC"],
    [relCelesteSwitch, med.celesteSwitch, tk.celesteSwitch, celeste, "release/Celeste/Switch"],
    [relDrCh1, med.drCh1, tk.drCh1, deltarune, "release/DR/Ch1"],
    [relDrMain, med.drMain, tk.drMain, deltarune, "release/DR/main"],
    [relHkPC, med.hkPC, tk.hkPC, hollowknight, "release/HK/PC"],
  ];
  for (const [rel, m, t, work, tag] of chains) {
    const R = fresh.get(rel.id), M = fresh.get(m.id), T = fresh.get(t.id);
    check(!R.work_id, tag + " 不应有 work_id");
    check(M.release_id === rel.id, tag + " medium 未挂在发行上");
    check(T.medium_id === m.id, tag + " track 未挂在载体上");
    const subjectIds = (R.subjects || []).map((x) => x.work_id);
    check(subjectIds.length > 0, tag + " 缺 subjects");
    check(subjectIds.includes(work.id), tag + " subjects 未声明作品 " + work.title);
    check((T.contents || []).length > 0, tag + " track 缺 contents");
    const seen = new Set();
    for (const c of T.contents || []) {
      check(!seen.has(c.position), tag + " 同一 Track 内 contents position 重复：" + c.position);
      seen.add(c.position);
      const EX = fresh.get(c.expression_id);
      check(!!EX, tag + " contents 引用了回读不到的 expression：" + c.expression_id);
      if (EX) check(subjectIds.includes(EX.work_id), tag + " contents 引用的 Expression 所属 Work 未在 subjects 声明：" + EX.title);
    }
    // subjects 里声明的每个 work 都必须是真实 work
    for (const s of R.subjects || []) check(!!fresh.get(s.work_id), tag + " subjects 引用了不存在的 work：" + s.work_id);
  }

  // C 跨发行复用同一 Expression
  const pcContents = (fresh.get(tk.celestePC.id).contents || []).map((c) => c.expression_id).sort();
  const swContents = (fresh.get(tk.celesteSwitch.id).contents || []).map((c) => c.expression_id).sort();
  check(eq(pcContents, swContents), "Celeste PC 版与 Switch 版未复用同一批 Expression");
  const ch1 = (fresh.get(tk.drCh1.id).contents || []).map((c) => c.expression_id);
  const main = (fresh.get(tk.drMain.id).contents || []).map((c) => c.expression_id);
  check(main.includes(ch1[0]), "DELTARUNE 现行多平台版未复用第一章 Expression");

  // D 关系两端
  const wanted = [
    ["developed_by", celeste.id, A.eok.id], ["directed_by", celeste.id, A.thorson.id], ["composed_by", celeste.id, A.raine.id],
    ["character_in", A.madeline.id, celeste.id], ["character_in", A.badeline.id, celeste.id], ["character_in", A.theo.id, celeste.id],
    ["credit_for", relCelesteSwitch.id, A.eok.id],
    ["developed_by", deltarune.id, A.tobyfox.id], ["composed_by", deltarune.id, A.tobyfox.id], ["written_by", deltarune.id, A.tobyfox.id],
    ["directed_by", deltarune.id, A.tobyfox.id], ["illustrated_by", deltarune.id, A.temmie.id],
    ["character_in", A.kris.id, deltarune.id], ["character_in", A.susie.id, deltarune.id], ["character_in", A.ralsei.id, deltarune.id],
    ["credit_for", relDrMain.id, A.eightfour.id],
    ["developed_by", hollowknight.id, A.teamcherry.id], ["composed_by", hollowknight.id, A.larkin.id],
    ["directed_by", hollowknight.id, A.gibson.id], ["directed_by", hollowknight.id, A.pellen.id],
    ["illustrated_by", hollowknight.id, A.gibson.id], ["written_by", hollowknight.id, A.gibson.id], ["written_by", hollowknight.id, A.pellen.id],
    ["credit_for", relHkPC.id, A.teamcherry.id],
  ];
  const bySource = new Map();
  for (const w of wanted) {
    if (!bySource.has(w[1])) bySource.set(w[1], []);
    bySource.get(w[1]).push(w);
  }
  for (const [srcId, list] of bySource) {
    const got = await client.relationsOf(srcId);
    const items = Array.isArray(got) ? got : (got.body && got.body.items) || [];
    for (const [type, s, t] of list) {
      const ok = items.some((r) => r.type === type && r.source_id === s && r.target_id === t);
      check(ok, "关系回读缺失：" + type + " " + String(s).slice(0, 8) + "→" + String(t).slice(0, 8));
      if (ok) checked.relations++;
    }
  }

  // E revisions
  for (const id of [celeste.id, deltarune.id, hollowknight.id, relCelestePC.id, relDrMain.id, relHkPC.id,
    CU_CELESTE[1].id, EX_CELESTE[9].id, tk.celestePC.id, med.hkPC.id, A.raine.id, A.eok.id]) {
    const r = await client.call("/api/catalog/entities/" + id + "/revisions");
    const items = (r.body && (r.body.items || r.body.revisions)) || [];
    checked.revisions += items.length;
    check(r.status === 200 && items.length >= 1, "revisions 回读异常 " + String(id).slice(0, 8) + " → " + r.status + " items=" + items.length);
  }
}

if (!DRY) {
  await verify();
  console.log("\n回读断言：实体 " + checked.entities + " 条、关系 " + checked.relations + " 条、revision " + checked.revisions + " 条");
  if (problems.length) {
    console.log("断言失败 " + problems.length + " 项：");
    for (const p of problems.slice(0, 40)) console.log("  ✗ " + p);
  } else {
    console.log("断言全部通过（结构归属 / subjects 覆盖 / 跨发行复用 / 关系两端 / revisions / 四语题名）");
  }
} else {
  console.log("\n[dry-run] 计划：3 部游戏作品 + 3 条创作链（9/4/4 篇目）+ 5 个发行 + 5 个载体 + 5 条收录位置 + 16 个主体；关系 24 条");
}

camp.summary({ verification: { problems: DRY ? ["dry-run 未回读"] : problems, checked } });
if (problems.length) process.exitCode = 1;
