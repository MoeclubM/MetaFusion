#!/usr/bin/env node
// 领域 19「纪录片系列（collection + 季 + 集）」真实数据补录（编目战役）。
//
// 层级形状：collection（系列）→ includes → 季 Work → content_unit（每集）→ expression（该集的表达）
//           Work → Release（BD / 数字配信）→ Medium → Track → contents[].expression_id（引用集表达）
//
// 数据全部来自可核对来源（en/ja/zh 维基 + Apple TV/iTunes 公开 API），先查重再新建；
// 脚本自带写后回读断言（结构归属 / subjects 覆盖 / 关系两端 / revisions），失败即非 0 退出。
//
// 用法：
//   node scripts/data/campaign/domains/documentary-series.mjs --dry-run
//   node scripts/data/campaign/domains/documentary-series.mjs

import { Campaign, Client, Index, src } from "../lib.mjs";

// ── 来源（URL + 取了什么）────────────────────────────────────────────────────
const SRC = {
  pe2En: src("https://en.wikipedia.org/wiki/Planet_Earth_II",
    "Planet Earth II（en.wikipedia）：6 集分集表（Islands/Mountains/Jungles/Deserts/Grasslands/Cities + 播出日 + Produced by）、David Attenborough 主持、作曲 Hans Zimmer/Jasha Klebe/Jacob Shea、执行制片 Vanessa Berlowitz/Mike Gunton/James Brickell/Tom Hugh-Jones、制作公司 BBC Natural History Unit、英国 2016-12-05 双碟 DVD/Blu-ray（BBC Worldwide 发行）与 2017-03-13 四碟 4K UHD+BD；Diaries 片段随每集收录"),
  pe2Ja: src("https://ja.wikipedia.org/wiki/%E3%83%97%E3%83%A9%E3%83%8D%E3%83%83%E3%83%88%E3%82%A2%E3%83%BC%E3%82%B9",
    "プラネットアース（ja.wikipedia）：日语题名「プラネットアース」「プラネットアースII」与 NHK 版 6 集日语集名（島 生命の小宇宙／熱帯の森 ひしめく命／砂漠 不毛の大地／草原 緑のゆりかご／高山 天空の闘い／都市 新天地への挑戦）"),
  pe2Bbc: src("https://www.bbc.co.uk/mediacentre/latestnews/2016/planet-earth-two",
    "BBC Media Centre：Planet Earth II 官方节目信息（BBC One 题材定位、David Attenborough 主持）"),
  pe2Itunes: src("https://itunes.apple.com/lookup?id=1185028441&entity=tvEpisode&country=US",
    "Apple TV/iTunes 公开 API（collectionId=1185028441）：Planet Earth II 第 1 季数字发行的轨道序号、集名（含 Jungle 拼写与 Planet Earth II: Diaries 附加集）、上线日期 2017-01-28 与每集时长（毫秒）"),
  bp2En: src("https://en.wikipedia.org/wiki/Blue_Planet_II",
    "Blue Planet II（en.wikipedia）：7 集分集表（题名/播出日/Produced by）、David Attenborough 主持、作曲 Hans Zimmer/Jacob Shea/David Fleming、执行制片 James Honeyborne/Mark Brownlow、英国 2017-11-27 三碟 DVD 与标准 Blu-ray、2018-01-15 六碟 4K UHD+BD（BBC Worldwide 发行）、Silva Screen 原声"),
  bp2Zh: src("https://zh.wikipedia.org/wiki/%E8%97%8D%E8%89%B2%E6%98%9F%E7%90%832",
    "藍色星球2（zh.wikipedia）：中文题名《蓝色星球2》/《藍色星球2》、BBC 自然历史部制作、David Attenborough 旁白、Hans Zimmer 主题音乐"),
  bp2Itunes: src("https://itunes.apple.com/lookup?id=1326320332&entity=tvEpisode&country=US",
    "Apple TV/iTunes 公开 API（collectionId=1326320332）：Blue Planet II 第 1 季数字发行 7 集轨道序号、集名、上线日期 2018-01-20 与每集时长（毫秒）"),
  peZh: src("https://zh.wikipedia.org/wiki/%E5%A4%A9%E8%88%87%E5%9C%B0_(%E7%B4%80%E9%8C%84%E7%89%87)",
    "天與地 (紀錄片)（zh.wikipedia）：Planet Earth（2006）中文译名（大陆「地球脉动」等、台湾「地球脈動」）、11 集、BBC/Discovery/NHK 联合制作"),
  bpZh: src("https://zh.wikipedia.org/wiki/%E8%97%8D%E8%89%B2%E6%98%9F%E7%90%83",
    "藍色星球（zh.wikipedia）：The Blue Planet（2001）中文题名《藍色星球》、BBC 制作、2001-09-12 首播、David Attenborough 旁白、执行制片 Alastair Fothergill"),
};
const ev = (note, sources) => ({ note, sources });

// ── 数据表 ───────────────────────────────────────────────────────────────────
const tr = (en, zhCN, zhTW, ja, summaries = {}) => {
  const out = { "en-US": { title: en }, "zh-CN": { title: zhCN }, "zh-TW": { title: zhTW }, "ja-JP": { title: ja } };
  for (const [loc, s] of Object.entries(summaries)) if (out[loc]) out[loc].summary = s;
  return out;
};
const secs = (ms) => Math.round(ms / 1000);

// Planet Earth II：BBC One 2016-11-06 ~ 2016-12-11，6 集；时长取 Apple 数字发行实测值
const PE2_EPS = [
  { n: 1, en: "Islands", ja: "島 生命の小宇宙", air: "2016-11-06", ms: 3047945 },
  { n: 2, en: "Mountains", ja: "高山 天空の闘い", air: "2016-11-13", ms: 2960939 },
  { n: 3, en: "Jungles", ja: "熱帯の森 ひしめく命", air: "2016-11-20", ms: 2995328 },
  { n: 4, en: "Deserts", ja: "砂漠 不毛の大地", air: "2016-11-27", ms: 2940134 },
  { n: 5, en: "Grasslands", ja: "草原 緑のゆりかご", air: "2016-12-04", ms: 2954206 },
  { n: 6, en: "Cities", ja: "都市 新天地への挑戦", air: "2016-12-11", ms: 2958803 },
];
// Diaries：随每集播出的 10 分钟制作花絮；数字发行里是独立的第 7 条（2017-03-25 上线）
const PE2_DIARIES = { en: "Planet Earth II: Diaries", air: null, ms: 3110128 };
// Blue Planet II：BBC One 2017-10-29 ~ 2017-12-10，7 集
const BP2_EPS = [
  { n: 1, en: "One Ocean", air: "2017-10-29", ms: 2922015 },
  { n: 2, en: "The Deep", air: "2017-11-05", ms: 3079007 },
  { n: 3, en: "Coral Reefs", air: "2017-11-12", ms: 2927007 },
  { n: 4, en: "Big Blue", air: "2017-11-19", ms: 2990975 },
  { n: 5, en: "Green Seas", air: "2017-11-26", ms: 3063007 },
  { n: 6, en: "Coasts", air: "2017-12-03", ms: 2898975 },
  { n: 7, en: "Our Blue Planet", air: "2017-12-10", ms: 3016992 },
];

const client = new Client();
// 只有真跑才登录/查服务端：--dry-run 必须能在没有口令的情况下空跑（只看本地索引）。
const LIVE = !process.argv.includes("--dry-run");
if (LIVE) await client.login();
const camp = new Campaign({ domain: "documentary-series", client, index: Index.load() });

const built = { agents: {}, works: {}, collections: {}, units: {}, exprs: {}, releases: {}, mediums: {}, tracks: {}, relations: [] };
const notes = [];

/** 用父级过滤把服务端已存在的子实体灌进本地索引，保证重复运行时不重复建（列表路由自带 429 退避）。 */
async function seedChildren(kind, filterKey, filterValue) {
  const r = await client.call("/api/catalog/entities?kind=" + kind + "&" + filterKey + "=" + encodeURIComponent(filterValue) + "&limit=50");
  const items = (r.body && r.body.items) || [];
  for (const it of items) camp.index.add(it);
  return items;
}

// ── 1. Agent（责任人 / 机构）────────────────────────────────────────────────
async function buildAgents() {
  const A = [
    ["attenborough", "person", "David Attenborough",
      tr("David Attenborough", "大卫·爱登堡", "大衛·艾登堡", "デイビッド・アッテンボロー"),
      ev("编目：新建人物 agent「David Attenborough」，BBC 自然纪录片主持人/解说；《Planet Earth II》与《Blue Planet II》均由他主持并撰写解说。",
        [SRC.pe2En, SRC.bp2En]), "doc-series-agent-attenborough"],
    ["zimmer", "person", "Hans Zimmer",
      tr("Hans Zimmer", "漢斯·季默", "漢斯·季默", "ハンス・ジマー"),
      ev("编目：新建人物 agent「Hans Zimmer」，两部系列的主题音乐作曲（PE2「main theme composed by Hans Zimmer」；BP2「score composed by Hans Zimmer, Jacob Shea and David Fleming」）。",
        [SRC.pe2En, SRC.bp2En]), "doc-series-agent-zimmer"],
    ["shea", "person", "Jacob Shea",
      tr("Jacob Shea", "雅各布·谢伊", "雅各布·謝伊", "ジェイコブ・シェイ"),
      ev("编目：新建人物 agent「Jacob Shea」，PE2 与 BP2 作曲（Bleeding Fingers Music）。", [SRC.pe2En, SRC.bp2En]),
      "doc-series-agent-shea"],
    ["klebe", "person", "Jasha Klebe",
      tr("Jasha Klebe", "贾沙·克莱贝", "賈沙·克萊貝", "ジャシャ・クレベ"),
      ev("编目：新建人物 agent「Jasha Klebe」，PE2 原创作曲（Bleeding Fingers Music）。", [SRC.pe2En]),
      "doc-series-agent-klebe"],
    ["fleming", "person", "David Fleming",
      tr("David Fleming", "大卫·弗莱明", "大衛·弗萊明", "デイヴィッド・フレミング"),
      ev("编目：新建人物 agent「David Fleming」，BP2 作曲（与 Hans Zimmer、Jacob Shea 共同署名）。", [SRC.bp2En]),
      "doc-series-agent-fleming"],
    ["gunton", "person", "Mike Gunton",
      tr("Mike Gunton", "迈克·冈顿", "邁克·岡頓", "マイク・ガントン"),
      ev("编目：新建人物 agent「Mike Gunton」，《Planet Earth II》执行制片（infobox executive_producer 列表之一）。", [SRC.pe2En]),
      "doc-series-agent-gunton"],
    ["honeyborne", "person", "James Honeyborne",
      tr("James Honeyborne", "詹姆斯·哈尼伯恩", "詹姆斯·哈尼伯恩", "ジェームズ・ハニーボーン"),
      ev("编目：新建人物 agent「James Honeyborne」，《Blue Planet II》执行制片（infobox executive_producer 列表之一）。", [SRC.bp2En]),
      "doc-series-agent-honeyborne"],
    ["brownlow", "person", "Mark Brownlow",
      tr("Mark Brownlow", "马克·布朗洛", "馬克·布朗洛", "マーク・ブラウンロウ"),
      ev("编目：新建人物 agent「Mark Brownlow」，《Blue Planet II》制片/执行制片人（infobox producer 与 executive_producer 列表）。", [SRC.bp2En]),
      "doc-series-agent-brownlow"],
    ["nhu", "organization", "BBC Natural History Unit",
      tr("BBC Natural History Unit", "BBC 自然历史部", "BBC 自然歷史部", "BBCナチュラルヒストリーユニット"),
      ev("编目：新建机构 agent「BBC Natural History Unit」，两部系列的制作公司（infobox company / 联合制作方）。", [SRC.pe2En, SRC.bp2En]),
      "doc-series-agent-nhu"],
    ["bbcww", "organization", "BBC Worldwide",
      tr("BBC Worldwide", "BBC 环球", "BBC 環球", "BBCワールドワイド"),
      ev("编目：新建机构 agent「BBC Worldwide」，两部系列英/美实体发行的发行方（publisher）。", [SRC.pe2En, SRC.bp2En]),
      "doc-series-agent-bbcww"],
  ];
  for (const [key, type, title, translations, evidence, idemKey] of A) {
    built.agents[key] = await camp.ensureEntity("agent", title, {
      original_language: "en", types: [type], translations,
    }, evidence, { idemKey, allowServerLookup: LIVE });
  }
}

// ── 2. Collection（系列枢纽）与 Work（季）──────────────────────────────────
async function buildWorks() {
  built.collections.pe = await camp.ensureEntity("collection", "Planet Earth", {
    original_language: "en", types: ["collection"],
    translations: tr("Planet Earth", "地球脉动系列", "地球脈動系列", "プラネットアース シリーズ", {
      "en-US": "BBC 自然纪录片系列枢纽：Planet Earth（2006）、Planet Earth II（2016）。",
      "zh-CN": "BBC 自然纪录片系列枢纽：2006 年《地球脉动》与 2016 年《地球脉动2》。",
    }),
    attributes: { language: "en" },
  }, ev("编目：新建 collection「Planet Earth」，作为 2006 年首作与 2016 年续作的系列枢纽（不含任何季/载体信息，层级靠 includes 表达）。",
    [SRC.peZh, SRC.pe2En]), { idemKey: "doc-series-coll-planet-earth", allowServerLookup: LIVE });

  built.collections.bp = await camp.ensureEntity("collection", "The Blue Planet", {
    original_language: "en", types: ["collection"],
    translations: tr("The Blue Planet", "蓝色星球系列", "藍色星球系列", "ブルー・プラネット シリーズ", {
      "en-US": "BBC 海洋自然纪录片系列枢纽：The Blue Planet（2001）、Blue Planet II（2017）。",
      "zh-CN": "BBC 海洋自然纪录片系列枢纽：2001 年《蓝色星球》与 2017 年《蓝色星球2》。",
    }),
    attributes: { language: "en" },
  }, ev("编目：新建 collection「The Blue Planet」，作为 2001 年海洋系列与其 2017 年续作的系列枢纽。", [SRC.bpZh, SRC.bp2En]),
    { idemKey: "doc-series-coll-blue-planet", allowServerLookup: LIVE });

  built.works.pe1 = await camp.ensureEntity("work", "Planet Earth", {
    original_language: "en", types: ["film"], attributes: { language: "en", tags: ["documentary", "nature", "television series"] },
    translations: tr("Planet Earth", "地球脉动", "地球脈動", "プラネットアース", {
      "en-US": "2006 BBC 自然纪录片系列，11 集，David Attenborough 解说。",
    }),
    external_ids: { wikipedia: "天與地_(紀錄片)", official_website: "https://www.bbc.co.uk/programmes/b006qfg8" },
  }, ev("编目：新建 Work「Planet Earth」（2006，11 集）；仅作系列枢纽与被续作引用的创作母体，本次不展开其层级（题名去掉了任何季/规格词）。",
    [SRC.peZh, SRC.pe2En]), { idemKey: "doc-series-work-planet-earth-2006", allowServerLookup: LIVE });

  built.works.pe2 = await camp.ensureEntity("work", "Planet Earth II", {
    original_language: "en", types: ["film"], attributes: { language: "en", tags: ["documentary", "nature", "television series", "4K"] },
    translations: tr("Planet Earth II", "地球脉动2", "地球脈動2", "プラネットアースII", {
      "en-US": "2016 BBC One 自然纪录片系列，6 集，David Attenborough 主持，BBC 首个 4K 制作。",
      "zh-CN": "BBC 2016 年自然纪录片，为 2006 年《地球脉动》的续作，共 6 集。",
    }),
    external_ids: { wikipedia: "地球脈動2", official_website: "https://www.bbc.co.uk/mediacentre/latestnews/2016/planet-earth-two" },
  }, ev("编目：新建 Work「Planet Earth II」（BBC One 2016-11-06 首播，6 集，David Attenborough 主持）；题名保持纯净，播出/集数与载体信息落到 content_unit 与 release。",
    [SRC.pe2En, SRC.pe2Bbc]), { idemKey: "doc-series-work-planet-earth-ii", allowServerLookup: LIVE });

  built.works.bp1 = await camp.ensureEntity("work", "The Blue Planet", {
    original_language: "en", types: ["film"], attributes: { language: "en", tags: ["documentary", "nature", "television series", "ocean"] },
    translations: tr("The Blue Planet", "蓝色星球", "藍色星球", "ブルー・プラネット", {
      "en-US": "2001 BBC 海洋自然纪录片系列，2001-09-12 首播，David Attenborough 旁白。",
    }),
    external_ids: { wikipedia: "藍色星球" },
  }, ev("编目：新建 Work「The Blue Planet」（2001）；作为 Blue Planet II 的前作与系列枢纽成员，本次不展开其层级。", [SRC.bpZh, SRC.bp2En]),
    { idemKey: "doc-series-work-blue-planet-2001", allowServerLookup: LIVE });

  built.works.bp2 = await camp.ensureEntity("work", "Blue Planet II", {
    original_language: "en", types: ["film"], attributes: { language: "en", tags: ["documentary", "nature", "television series", "ocean"] },
    translations: tr("Blue Planet II", "蓝色星球2", "藍色星球2", "Blue Planet II", {
      "en-US": "2017 BBC One 海洋自然纪录片系列，7 集，David Attenborough 主持。",
      "zh-CN": "BBC 2017 年海洋自然纪录片，为 2001 年《蓝色星球》的续作，共 7 集。",
    }),
    external_ids: { wikipedia: "藍色星球2" },
  }, ev("编目：新建 Work「Blue Planet II」（BBC One 2017-10-29 首播，7 集，David Attenborough 主持）；日语无官方题名，按规范回落原文题名。",
    [SRC.bp2En, SRC.bp2Zh]), { idemKey: "doc-series-work-blue-planet-ii", allowServerLookup: LIVE });
}

// ── 3. ContentUnit（每集）→ Expression（该集的表达）────────────────────────
async function buildSeason(workKey, episodes, language, extras = {}) {
  const work = built.works[workKey];
  if (LIVE) {
    await seedChildren("content_unit", "work_id", work.id);
    await seedChildren("expression", "work_id", work.id);
  }
  const out = [];
  for (const ep of episodes) {
    const isMain = ep.role !== "extra";
    const title = ep.en;
    const translations = ep.ja
      ? tr(ep.en, ep.en, ep.en, ep.ja)
      : tr(ep.en, ep.en, ep.en, ep.en);
    const unit = await camp.ensureEntity("content_unit", title, {
      work_id: work.id, position: ep.n, number: String(ep.n),
      original_language: language, types: ["content_unit"],
      translations,
      attributes: { language, entry_role: isMain ? "main" : "extra", ...(ep.air ? { air_date: ep.air } : {}) },
    }, ev("编目：新建篇目 content_unit「" + title + "」（" + work.title + " 第 " + ep.n + (isMain ? " 集" : " 项") +
      (ep.air ? "，" + ep.air + " 首播" : "") + "）；number/position 按原放送顺序，日语集名取 NHK 官网/维基日语版。",
      [SRC.pe2En, SRC.pe2Ja, SRC.bp2En, SRC.pe2Itunes, SRC.bp2Itunes]),
      { idemKey: "doc-series-cu-" + workKey + "-" + ep.n, scope: { work_id: work.id }, allowServerLookup: LIVE });

    const expression = await camp.ensureEntity("expression", title, {
      work_id: work.id, content_unit_id: unit.id, position: 0,
      original_language: language, types: ["expression"],
      translations,
      attributes: { language, version_label: "Original English broadcast", duration: secs(ep.ms) },
    }, ev("编目：新建 expression「" + title + "」（英语原版表达，挂在同一 Work 的篇目 " + unit.id + " 上）；duration 为 Apple 数字发行实测片长（" + secs(ep.ms) + " 秒）。",
      [SRC.pe2Itunes, SRC.bp2Itunes, SRC.pe2En, SRC.bp2En]),
      { idemKey: "doc-series-expr-" + workKey + "-" + ep.n, scope: { work_id: work.id }, allowServerLookup: LIVE });
    out.push({ ...ep, unit, expression });
  }
  return out;
}

// ── 4. Release → Medium → Track（contents 引用 expression）─────────────────
async function buildCarrier(workKey, releaseSpec, mediumSpec, trackPlan) {
  const release = await camp.ensureEntity("release", releaseSpec.title, {
    original_language: "en", types: ["release"],
    translations: releaseSpec.translations,
    attributes: releaseSpec.attributes,
    subjects: [{ work_id: built.works[workKey].id, role: "primary", position: 0 }],
  }, releaseSpec.evidence, { idemKey: releaseSpec.idemKey, allowServerLookup: LIVE });

  if (LIVE) await seedChildren("medium", "release_id", release.id);
  const medium = await camp.ensureEntity("medium", mediumSpec.title, {
    release_id: release.id, position: 0, original_language: "en", types: ["medium"],
    translations: tr(mediumSpec.title, mediumSpec.title, mediumSpec.title, mediumSpec.ja || mediumSpec.title),
    attributes: { format: mediumSpec.format, role: "primary" },
  }, mediumSpec.evidence, { idemKey: mediumSpec.idemKey, scope: { release_id: release.id }, allowServerLookup: LIVE });

  if (LIVE) await seedChildren("track", "medium_id", medium.id);
  const tracks = [];
  for (const t of trackPlan) {
    const track = await camp.ensureEntity("track", t.title, {
      medium_id: medium.id, position: t.position, number: String(t.position),
      original_language: "en", types: ["track"],
      translations: t.ja ? tr(t.title, t.title, t.title, t.ja) : tr(t.title, t.title, t.title, t.title),
      attributes: { duration: secs(t.ms), role: "primary" },
      contents: [{ expression_id: t.expression.id, position: 1, locator: null }],
    }, t.evidence, { idemKey: releaseSpec.idemKey + "-track-" + t.position, scope: { medium_id: medium.id }, allowServerLookup: LIVE });
    tracks.push({ ...t, track });
  }
  return { release, medium, tracks };
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  await buildAgents();
  await buildWorks();

  const pe2Units = await buildSeason("pe2", PE2_EPS.map((e) => ({ ...e })), "en");
  const pe2Diaries = await buildSeason("pe2", [{ n: 7, en: PE2_DIARIES.en, air: null, ms: PE2_DIARIES.ms, role: "extra" }], "en");
  const bp2Units = await buildSeason("bp2", BP2_EPS.map((e) => ({ ...e })), "en");

  built.units.pe2 = pe2Units; built.units.pe2Diaries = pe2Diaries[0]; built.units.bp2 = bp2Units;

  // R1：英国双碟 Blu-ray（BBC Worldwide 发行，2016-12-05）——6 集正片（Diaries 花絮随每集收录）
  const pe2Bd = await buildCarrier("pe2", {
    title: "Planet Earth II (Blu-ray)",
    translations: tr("Planet Earth II (Blu-ray)", "地球脉动2 蓝光版", "地球脈動2 藍光版", "プラネットアースII Blu-ray"),
    attributes: { edition_type: "standard", edition_date: "2016-12-05", country: "GB", distribution_channel: "physical", packaging: "standard", publisher: built.agents.bbcww.id },
    evidence: ev("编目：新建 release「Planet Earth II (Blu-ray)」——英国 2016-12-05 发行的双碟 Blu-ray（BBC Worldwide 发行）；publisher 指向 agent BBC Worldwide，subjects 声明收录 Work「Planet Earth II」。多碟套装按单个载体建模（盘内分配无公开证据，见报告缺口）。",
      [SRC.pe2En]),
    idemKey: "doc-series-rel-pe2-bd",
  }, {
    title: "Blu-ray", format: "bd", ja: "ブルーレイ",
    evidence: ev("编目：新建 medium「Blu-ray」（format=bd）承载英国版双碟套装的视频内容；官方未公布每集在第几碟，故不虚构盘内分配。", [SRC.pe2En]),
    idemKey: "doc-series-med-pe2-bd",
  }, pe2Units.map((u) => ({
    position: u.n, title: u.en, ja: u.ja, ms: u.ms, expression: u.expression,
    evidence: ev("编目：新建 track 第 " + u.n + " 项「" + u.en + "」，contents 引用该集 expression " + u.expression.id + "（整轨收录，locator 留空）。", [SRC.pe2Itunes, SRC.pe2En]),
  })));

  // R2：Apple TV 数字发行（US，2017-01-28）——6 集 + Diaries 附加集
  const pe2Digital = await buildCarrier("pe2", {
    title: "Planet Earth II (Apple TV)",
    translations: tr("Planet Earth II (Apple TV)", "地球脉动2（Apple TV）", "地球脈動2（Apple TV）", "プラネットアースII（Apple TV）"),
    attributes: { edition_type: "standard", edition_date: "2017-01-28", country: "US", distribution_channel: "digital", platform: "Apple TV (iTunes Store)" },
    evidence: ev("编目：新建 release「Planet Earth II (Apple TV)」——Apple TV/iTunes 美国区第 1 季数字发行（2017-01-28 上线，含 6 集正片与 Planet Earth II: Diaries 附加集）。",
      [SRC.pe2Itunes]),
    idemKey: "doc-series-rel-pe2-digital",
  }, {
    title: "Digital", format: "web",
    evidence: ev("编目：新建 medium「Digital」（format=web）承载数字发行文件集（无实体盘）。", [SRC.pe2Itunes]),
    idemKey: "doc-series-med-pe2-digital",
  }, [...pe2Units, pe2Diaries[0]].map((u, i) => ({
    position: i + 1, title: u.en, ja: u.ja, ms: u.ms, expression: u.expression,
    evidence: ev("编目：新建 track 第 " + (i + 1) + " 项「" + u.en + "」，contents 引用 expression " + u.expression.id + "（同一表达被实体 BD 与数字发行复用）。", [SRC.pe2Itunes]),
  })));

  // R3：英国标准 Blu-ray（BBC Worldwide 发行，2017-11-27）——7 集
  const bp2Bd = await buildCarrier("bp2", {
    title: "Blue Planet II (Blu-ray)",
    translations: tr("Blue Planet II (Blu-ray)", "蓝色星球2 蓝光版", "藍色星球2 藍光版", "Blue Planet II Blu-ray"),
    attributes: { edition_type: "standard", edition_date: "2017-11-27", country: "GB", distribution_channel: "physical", packaging: "standard", publisher: built.agents.bbcww.id },
    evidence: ev("编目：新建 release「Blue Planet II (Blu-ray)」——英国 2017-11-27 发行的标准 Blu-ray 版（同日另有 3 碟 DVD；BBC Worldwide 发行）。",
      [SRC.bp2En]),
    idemKey: "doc-series-rel-bp2-bd",
  }, {
    title: "Blu-ray", format: "bd", ja: "ブルーレイ",
    evidence: ev("编目：新建 medium「Blu-ray」（format=bd）承载英国版蓝光套装的视频内容（官方未公布碟数明细，同 PE2 处理）。", [SRC.bp2En]),
    idemKey: "doc-series-med-bp2-bd",
  }, bp2Units.map((u) => ({
    position: u.n, title: u.en, ms: u.ms, expression: u.expression,
    evidence: ev("编目：新建 track 第 " + u.n + " 项「" + u.en + "」，contents 引用该集 expression " + u.expression.id + "。", [SRC.bp2Itunes, SRC.bp2En]),
  })));

  built.releases.pe2Bd = pe2Bd; built.releases.pe2Digital = pe2Digital; built.releases.bp2Bd = bp2Bd;

  // ── 5. 关系 ───────────────────────────────────────────────────────────────
  const R = async (type, from, to, note, attributes = {}, sources = [SRC.pe2En, SRC.bp2En, SRC.peZh, SRC.bpZh]) => {
    const rel = await camp.createRelation(type, from, to, ev(note, sources), { attributes, skipIfExists: LIVE });
    built.relations.push({ type, source: from, target: to, id: rel.id });
    return rel;
  };

  await R("includes", built.collections.pe.id, built.works.pe1.id,
    "关系：系列枢纽 collection「Planet Earth」includes 2006 年首作 Work。");
  await R("includes", built.collections.pe.id, built.works.pe2.id,
    "关系：collection「Planet Earth」includes 2016 年续作 Work。");
  await R("includes", built.collections.bp.id, built.works.bp1.id,
    "关系：系列枢纽 collection「The Blue Planet」includes 2001 年海洋系列 Work。");
  await R("includes", built.collections.bp.id, built.works.bp2.id,
    "关系：collection「The Blue Planet」includes 2017 年续作 Work。");
  await R("sequel_of", built.works.pe2.id, built.works.pe1.id,
    "关系：Work「Planet Earth II」sequel_of「Planet Earth」（2006 首作的续集，官方明示）。");
  await R("sequel_of", built.works.bp2.id, built.works.bp1.id,
    "关系：Work「Blue Planet II」sequel_of「The Blue Planet」（2018 报道称其为 2001 系列的跟进作）。");
  await R("created_by", built.works.pe2.id, built.agents.nhu.id,
    "关系：Work「Planet Earth II」created_by 制作机构 BBC Natural History Unit（infobox company）。", { credit_role: "production company" });
  await R("created_by", built.works.bp2.id, built.agents.nhu.id,
    "关系：Work「Blue Planet II」created_by 制作机构 BBC Natural History Unit（联合制作方）。", { credit_role: "production company" });
  await R("created_by", built.works.pe2.id, built.agents.gunton.id,
    "关系：Work「Planet Earth II」created_by Mike Gunton（执行制片，infobox executive_producer 名单之一）。", { credit_role: "executive producer" });
  await R("created_by", built.works.bp2.id, built.agents.honeyborne.id,
    "关系：Work「Blue Planet II」created_by James Honeyborne（执行制片）。", { credit_role: "executive producer" });
  await R("created_by", built.works.bp2.id, built.agents.brownlow.id,
    "关系：Work「Blue Planet II」created_by Mark Brownlow（制片人/执行制片）。", { credit_role: "producer" });
  await R("composed_by", built.works.pe2.id, built.agents.zimmer.id,
    "关系：Work「Planet Earth II」composed_by Hans Zimmer（主题音乐作曲）。", { credit_role: "main theme composer" });
  await R("composed_by", built.works.pe2.id, built.agents.shea.id,
    "关系：Work「Planet Earth II」composed_by Jacob Shea（Bleeding Fingers Music 原创作曲）。", { credit_role: "composer" });
  await R("composed_by", built.works.pe2.id, built.agents.klebe.id,
    "关系：Work「Planet Earth II」composed_by Jasha Klebe（Bleeding Fingers Music 原创作曲）。", { credit_role: "composer" });
  await R("composed_by", built.works.bp2.id, built.agents.zimmer.id,
    "关系：Work「Blue Planet II」composed_by Hans Zimmer（与 Radiohead 合作重编 Bloom 亦见于该系列）。", { credit_role: "composer" });
  await R("composed_by", built.works.bp2.id, built.agents.shea.id,
    "关系：Work「Blue Planet II」composed_by Jacob Shea。", { credit_role: "composer" });
  await R("composed_by", built.works.bp2.id, built.agents.fleming.id,
    "关系：Work「Blue Planet II」composed_by David Fleming。", { credit_role: "composer" });
  await R("narrated_by", built.releases.pe2Bd.release.id, built.agents.attenborough.id,
    "关系：Release「Planet Earth II (Blu-ray)」narrated_by David Attenborough（主持兼解说）。", { credit_role: "narrator", language: "en" });
  await R("narrated_by", built.releases.pe2Digital.release.id, built.agents.attenborough.id,
    "关系：Release「Planet Earth II (Apple TV)」narrated_by David Attenborough。", { credit_role: "narrator", language: "en" });
  await R("narrated_by", built.releases.bp2Bd.release.id, built.agents.attenborough.id,
    "关系：Release「Blue Planet II (Blu-ray)」narrated_by David Attenborough。", { credit_role: "narrator", language: "en" });

  // 注意：pe2Diaries 传单条（buildSeason 返回数组），断言里按单条使用。
  return { pe2Units, pe2Diaries: pe2Diaries[0], bp2Units, pe2Bd, pe2Digital, bp2Bd };
}

// ── 6. 写后回读断言 ─────────────────────────────────────────────────────────
const failures = [];
const checks = { entities: 0, subjects: 0, tracks: 0, relations: 0, revisions: 0 };

async function checkEntity(kind, id, label, predicate) {
  checks.entities++;
  const e = await camp.getEntity(id);
  if (e.kind !== kind) failures.push(label + "：kind 预期 " + kind + " 实得 " + e.kind);
  if (!e.translations || !Object.keys(e.translations).length) failures.push(label + "：缺少 translations（发布态要求至少一条翻译行）");
  const bad = predicate(e);
  if (bad) failures.push(label + "：" + bad);
  return e;
}

async function assertAll(result) {
  const { pe2Units, pe2Diaries, bp2Units, pe2Bd, pe2Digital, bp2Bd } = result;
  const pe2 = built.works.pe2, bp2 = built.works.bp2;

  // Work / Collection 结构干净 + 四语题名
  for (const [label, e] of [["work Planet Earth", built.works.pe1], ["work Planet Earth II", pe2], ["work The Blue Planet", built.works.bp1], ["work Blue Planet II", bp2]]) {
    await checkEntity("work", e.id, label, (x) => x.work_id || x.release_id || x.medium_id || x.parent_id ? "work 不该带结构字段" : (Object.keys(x.translations).length < 4 ? "四语题名不足：" + Object.keys(x.translations).join(",") : ""));
  }
  for (const [label, e] of [["collection Planet Earth", built.collections.pe], ["collection The Blue Planet", built.collections.bp]]) {
    await checkEntity("collection", e.id, label, (x) => x.work_id ? "collection 不该带 work_id" : (Object.keys(x.translations).length < 4 ? "四语题名不足" : ""));
  }

  // ContentUnit：work_id 归属 + entry_role
  const allUnits = [...pe2Units, pe2Diaries, ...bp2Units];
  for (const u of allUnits) {
    const work = pe2Units.includes(u) || u === pe2Diaries ? pe2 : bp2;
    await checkEntity("content_unit", u.unit.id, "content_unit " + u.en, (x) => {
      if (x.work_id !== work.id) return "work_id 归属错误 " + x.work_id;
      if (x.parent_id) return "本层目录不应有 parent_id";
      if (!x.attributes || !x.attributes.entry_role) return "缺 entry_role";
      return "";
    });
  }
  // Expression：work_id + content_unit_id 必须指向对应篇目
  for (const u of allUnits) {
    await checkEntity("expression", u.expression.id, "expression " + u.en, (x) => {
      if (x.work_id !== u.unit.work_id) return "work_id 不等于篇目 Work";
      if (x.content_unit_id !== u.unit.id) return "content_unit_id 未挂到篇目（" + x.content_unit_id + " ≠ " + u.unit.id + "）";
      if (x.parent_id) return "expression 不允许 parent_id";
      if (!x.attributes || !x.attributes.duration) return "缺 duration";
      return "";
    });
  }

  // Release：无 work_id、subjects 覆盖；Medium/Track 归属；contents 引用与 subjects 一致
  for (const [label, carrier, work] of [["PE2 BD", pe2Bd, pe2], ["PE2 digital", pe2Digital, pe2], ["BP2 BD", bp2Bd, bp2]]) {
    checks.subjects++;
    const rel = await checkEntity("release", carrier.release.id, "release " + label, (x) => {
      if (x.work_id) return "release 不允许 work_id";
      const subj = (x.subjects || []).map((s) => s.work_id);
      if (!subj.includes(work.id)) return "subjects 未声明收录 Work " + work.title;
      return "";
    });
    const subj = new Set((rel.subjects || []).map((s) => s.work_id));
    await checkEntity("medium", carrier.medium.id, "medium " + label, (x) => x.release_id !== rel.id ? "release_id 归属错误" : (x.attributes && x.attributes.format ? "" : "缺 format"));
    for (const t of carrier.tracks) {
      checks.tracks++;
      const trk = await checkEntity("track", t.track.id, "track " + label + " #" + t.position, (x) => {
        if (x.medium_id !== carrier.medium.id) return "medium_id 归属错误";
        const c = (x.contents || [])[0];
        if (!c || c.expression_id !== t.expression.id) return "contents 未引用预期 expression";
        return "";
      });
      const expr = await camp.getEntity(t.expression.id);
      if (!subj.has(expr.work_id)) failures.push("release " + label + " 的 track " + trk.title + " 引用的表达 Work 未在 subjects 声明（服务端应已拦）");
    }
    // 同一 expression 在多个 release 中复用（PE2：BD 6 条 ⊂ 数字 7 条）
  }
  const pe2DigitalExprIds = new Set(pe2Digital.tracks.map((t) => t.expression.id));
  const reused = pe2Bd.tracks.filter((t) => pe2DigitalExprIds.has(t.expression.id)).length;
  if (reused !== pe2Bd.tracks.length) failures.push("PE2 表达跨发行复用断言失败：BD 的 " + pe2Bd.tracks.length + " 条表达只有 " + reused + " 条在数字发行中复用");

  // 关系：两端存在 + 回读可见
  const relCache = new Map();
  for (const r of built.relations) {
    checks.relations++;
    if (!relCache.has(r.source)) relCache.set(r.source, await client.call("/api/catalog/entities/" + r.source + "/relations").then((x) => (x.body && x.body.items) || []));
    const found = relCache.get(r.source).find((x) => x.type === r.type && x.source_id === r.source && x.target_id === r.target);
    if (!found) { failures.push("关系回读失败：" + r.type + " " + r.source + "→" + r.target); continue; }
    for (const id of [r.source, r.target]) {
      const e = await camp.getEntity(id);
      if (!e || !e.id) failures.push("关系端点不存在：" + id);
    }
  }

  // revisions：每类抽样 + 全部 release
  const revSamples = [
    ["agent", built.agents.attenborough.id], ["collection", built.collections.pe.id], ["work", pe2.id],
    ["content_unit", pe2Units[0].unit.id], ["expression", pe2Units[0].expression.id],
    ["release", pe2Bd.release.id], ["medium", pe2Bd.medium.id], ["track", pe2Bd.tracks[0].track.id],
    ["release", pe2Digital.release.id], ["release", bp2Bd.release.id],
  ];
  for (const [kind, id] of revSamples) {
    checks.revisions++;
    const r = await client.call("/api/catalog/entities/" + id + "/revisions");
    const items = (r.body && (r.body.items || r.body)) || [];
    if (!Array.isArray(items) || !items.length) { failures.push("revisions 为空：" + kind + " " + id); continue; }
    const ent = await camp.getEntity(id);
    const versions = items.map((it) => (it.snapshot && it.snapshot.version) || it.version || 0);
    if (Math.max(...versions) !== ent.version) failures.push("revisions 最新版本 " + Math.max(...versions) + " 与实体 version " + ent.version + " 不一致：" + kind + " " + id);
  }

  notes.push("涵盖：" + checks.entities + " 实体结构回读 / " + checks.subjects + " release subjects 覆盖 / " + checks.tracks + " track contents / " + checks.relations + " 关系两端 / " + checks.revisions + " revisions");
}

try {
  const result = await main();
  if (!process.argv.includes("--dry-run")) await assertAll(result);
  for (const n of notes) console.log("\n[断言] " + n);
  if (failures.length) {
    console.log("\n[断言] 失败 " + failures.length + " 项：");
    for (const f of failures) console.log("  - " + f);
  } else if (!process.argv.includes("--dry-run")) {
    console.log("\n[断言] 全部通过（结构归属 / subjects 覆盖 / 表达跨发行复用 / 关系两端 / revisions）");
  }
  const summary = camp.summary();
  if (failures.length || summary.failed.length) process.exitCode = 1;
} catch (err) {
  console.error("\n[中断] " + err.message);
  if (err.code) console.error("  拒绝码：" + err.code);
  camp.summary();
  process.exitCode = 1;
}
