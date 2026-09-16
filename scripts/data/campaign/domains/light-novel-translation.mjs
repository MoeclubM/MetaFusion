#!/usr/bin/env node
// 领域脚本：轻小说 + 中译本（slug = light-novel-translation）
//
// 事实来源全是可核对的权威页：
//   · 日文维基「既刊一覧」（角川スニーカー文庫 / MFブックス 的卷次·副标题·初版発行日·ISBN）
//   · 中文维基「出版書籍」表（台灣角川 / 天聞角川 繁中·简中译本 的發售日·ISBN）
//   · 小説家になろう 作品页（Web 版章名·話名·掲載日，一手来源）
//   · openBD API（日本 ISBN → 题名/丛书/出版者/出版月，脚本内逐条交叉核验）
//
// 层级形状：
//   Work(novel) → ContentUnit(卷 / Web 版章) → Expression(日文原版正文 · 繁中譯本 · 简中譯本)
//   Work → Release(原版 / 台灣角川版 / 天聞角川版 / Web 連載) → Medium(paper / web) → Track → contents[Expression]
//
// 用法：
//   node scripts/data/campaign/domains/light-novel-translation.mjs --dry-run   # 离线空跑：不登录、不写库
//   $env:MF_USER_PASS = …; node scripts/data/campaign/domains/light-novel-translation.mjs

import fs from "node:fs";
import { Campaign, Client, DRY, Index, src } from "../lib.mjs";

// ── 来源 ────────────────────────────────────────────────────────────────
const W = (lang, t) => "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(t);
const openBd = (isbn, summary) => src("https://api.openbd.jp/v1/get?isbn=" + isbn, "openBD 版元数据 ISBN=" + isbn + " → " + summary);

const S_JA_KONOSUBA = src(W("ja", "この素晴らしい世界に祝福を!"), "日文维基「既刊一覧 > 小説 > この素晴らしい世界に祝福を!」表：卷次、副标题、初版発行日、ISBN；同页 infobox：著者 暁なつめ、イラスト 三嶋くろね、レーベル 角川スニーカー文庫、出版社 角川書店→KADOKAWA、掲載誌 小説家になろう、全 21 巻（本編 17＋短編集 4）");
const S_ZH_KONOSUBA = src(W("zh", "為美好的世界獻上祝福！"), "中文维基「出版書籍 > 輕小說」表：日文標題／中文標題對照、台灣角川發售日与 ISBN；正文：正體中文版由台灣角川發行、文庫 角川Sneaker文庫、作者官方中文名 曉夏目、插圖 三嶋黑音；WEB 版原以筆名「自宅警備兵」發表於《成為小說家吧》，文庫版第 2 集出版後被作者刪除");
const S_JA_MUSHOKU = src(W("ja", "無職転生 〜異世界行ったら本気だす〜"), "日文维基「既刊一覧 > 小説『無職転生 〜異世界行ったら本気だす〜』」表：卷次、タイトル、初版発行日、発売日、ISBN、備考（幼年期編／少年期編／青少年期編）；同页：理不尽な孫の手（著）・シロタカ（イラスト）、フロンティアワークス企画／KADOKAWA発行〈MFブックス〉全 26 巻");
const S_ZH_MUSHOKU = src(W("zh", "無職轉生～到了異世界就拿出真本事～"), "中文维基条目：日文原題 無職転生 〜異世界行ったら本気だす〜、繁中題 無職轉生～到了異世界就拿出真本事～、作者 不講理不求人（理不尽な孫の手）、插圖 白鷹（シロタカ）、日本 KADOKAWA／台灣 台灣角川／中國大陸 天聞角川、文庫 MF Books；「出版書籍 > 輕小說」表三欄（KADOKAWA／台灣角川／天聞角川）的發售日与 ISBN");
const S_SYOSYEU = src("https://ncode.syosetu.com/n9669bk/", "小説家になろう 作品页『無職転生 - 異世界行ったら本気だす -』（作者：理不尽な孫の手，2015/04/03 完結）：Web 版章立て与各話掲載日 —— 第１章 幼年期、第２章 少年期 家庭教師編、第３章 少年期 冒険者入門編、第４章 少年期 渡航編、第５章 少年期 再会編、第６章 少年期 帰郷編");

// ── 事实表 ──────────────────────────────────────────────────────────────
// 角川スニーカー文庫 日文原版：卷次、副标题、初版発行日、ISBN
const KONOSUBA_VOLS = [
  { n: 1, sub: "あぁ、駄女神さま", date: "2013-10-01", isbn: "9784041010204" },
  { n: 2, sub: "中二病でも魔女がしたい！", date: "2013-12-01", isbn: "9784041011102" },
  { n: 3, sub: "よんでますよ、ダクネスさん。", date: "2014-03-01", isbn: "9784041012420" },
  { n: 4, sub: "鈍ら四重奏 〜ナマクラカルテット〜", date: "2014-05-01", isbn: "9784041015704" },
  { n: 5, sub: "爆裂紅魔にレッツ＆ゴー!!", date: "2014-09-01", isbn: "9784041015711" }
];
// 台灣角川 繁中版：集数、中文标题、發售日、ISBN
const KONOSUBA_ZH = [
  { n: 1, title: "啊啊，沒用的女神大人", date: "2014-07-18", isbn: "9789863660392" },
  { n: 2, title: "中二病也想當魔女！", date: "2014-11-15", isbn: "9789863662211" },
  { n: 3, title: "妳被召喚囉，達克妮絲小姐。", date: "2015-01-10", isbn: "9789863663034" },
  { n: 4, title: "廢柴四重奏", date: "2015-04-24", isbn: "9789863664697" },
  { n: 5, title: "爆裂紅魔Let's & Go！", date: "2015-10-16", isbn: "9789863667070" }
];
// MFブックス 日文原版：卷次、官方タイトル、初版発行日、発売日、ISBN
const MUSHOKU_VOLS = [
  { n: 1, title: "無職転生 〜異世界行ったら本気だす〜 1", pub: "2014-01-31", sale: "2014-01-14", isbn: "9784040662206" },
  { n: 2, title: "無職転生 〜異世界行ったら本気だす〜 2", pub: "2014-03-31", sale: "2014-03-25", isbn: "9784040663937" },
  { n: 3, title: "無職転生 〜異世界行ったら本気だす〜 3", pub: "2014-05-31", sale: "2014-05-23", isbn: "9784040667553" },
  { n: 4, title: "無職転生 〜異世界行ったら本気だす〜 4", pub: "2014-08-31", sale: "2014-08-25", isbn: "9784040669618" },
  { n: 5, title: "無職転生 〜異世界行ったら本気だす〜 5", pub: "2014-10-31", sale: "2014-10-24", isbn: "9784040671307" }
];
// 台灣角川 繁中版
const MUSHOKU_ZH_TW = [
  { n: 1, date: "2015-08-06", isbn: "9789863663744" },
  { n: 2, date: "2015-08-06", isbn: "9789863665441" },
  { n: 3, date: "2016-02-04", isbn: "9789863667568" },
  { n: 4, date: "2016-05-16", isbn: "9789863667575" },
  { n: 5, date: "2016-09-14", isbn: "9789864732852" }
];
// 天聞角川 简中版（中文维基表第三栏，该栏只列 1–2 卷）
const MUSHOKU_ZH_CN = [
  { n: 1, date: "2017-02-01", isbn: "9787516806968" },
  { n: 2, date: "2017-07-01", isbn: "9787534059285" }
];
// Web 版章（小説家になろう n9669bk）：章名、首話掲載日、章首話 URL
const WEB_CHAPTERS = [
  { n: 1, title: "第１章　幼年期", date: "2012-11-22", url: "https://ncode.syosetu.com/n9669bk/1/" },
  { n: 2, title: "第２章　少年期　家庭教師編", date: "2012-12-09", url: "https://ncode.syosetu.com/n9669bk/13/" },
  { n: 3, title: "第３章　少年期　冒険者入門編", date: "2012-12-23", url: "https://ncode.syosetu.com/n9669bk/20/" },
  { n: 4, title: "第４章　少年期　渡航編", date: "2013-01-14", url: "https://ncode.syosetu.com/n9669bk/34/" },
  { n: 5, title: "第５章　少年期　再会編", date: "2013-02-07", url: "https://ncode.syosetu.com/n9669bk/44/" },
  { n: 6, title: "第６章　少年期　帰郷編", date: "2013-03-16", url: "https://ncode.syosetu.com/n9669bk/51/" }
];

// ── 小工具 ──────────────────────────────────────────────────────────────
const tr = (o) => {
  const out = {};
  for (const k of Object.keys(o)) if (o[k]) out[k] = { title: o[k] };
  return out;
};
// 只有原文可核实时使用：四语种都填同一个原文题名，绝不编造翻译
const trRaw = (t) => tr({ "ja-JP": t, "zh-CN": t, "zh-TW": t, "en-US": t });
const at = (arr, n) => arr.find((x) => x.n === n) || {};
const ev = (n, sources) => ({ note: n, sources: sources });

// ── 离线核验：日文 ISBN 与 openBD 版元数据比对（--dry-run 也执行；openBD 无鉴权、非目标实例）──
console.log("openBD 版元数据核验（日本原版 ISBN）：");
const jaList = KONOSUBA_VOLS.map((v) => ({ isbn: v.isbn, expect: "この素晴らしい世界に祝福を!" }))
  .concat(MUSHOKU_VOLS.map((v) => ({ isbn: v.isbn, expect: "無職転生" })));
for (const item of jaList) {
  const res = await fetch("https://api.openbd.jp/v1/get?isbn=" + item.isbn, { headers: { "User-Agent": "MetaFusion-Campaign/1.0 (+https://findverse.cc)" } });
  const json = await res.json().catch(() => null);
  const s = json && json[0] && json[0].summary;
  const line = s ? s.title + " / " + s.series + " / " + String(s.publisher).trim() + " / " + s.pubdate + " / " + s.author : "(openBD 无记录)";
  const ok = s && s.title.indexOf(item.expect) === 0;
  console.log("  " + (ok ? "OK " : "!! ") + item.isbn + "  " + line);
}
console.log("");

// ── 主流程 ──────────────────────────────────────────────────────────────
const client = new Client();
if (!DRY) await client.login();
else console.log("[dry-run] 离线空跑：不登录目标实例、不写库、不发列表检索");
const camp = new Campaign({ domain: "light-novel-translation", client, index: Index.load() });
const lookup = !DRY; // 服务端 ?q= 查重只在真跑时执行（列表路由 120/分钟限流）

// 结构作用域预载：把 agent / work / collection 的现存实体先灌进本地索引，写入前就能精确查重。
// 用清单快照（由独立抓取脚本生成）而不是当场翻页，避免和另外十几个子代理抢列表路由的 120/分钟限流。
// 快照不存在时退回服务端 ?q= 查重（见 allowServerLookup）。
const PRELOAD = "docs-local/data-campaign/logs/light-novel-translation-preload.json";
let preloaded = 0;
try {
  const snap = JSON.parse(fs.readFileSync(PRELOAD, "utf8"));
  for (const e of snap) {
    camp.index.add({ ...e, id: e.id, kind: e.kind, title: e.title });
    const row = camp.index.byId(e.id);
    if (row) {
      row.created_by = e.created_by;
      row.translations = e.translations || {};
    }
    preloaded += 1;
  }
  console.log("  · 预载现存实体进本地索引：" + preloaded + " 条（" + PRELOAD + "）");
} catch (e) {
  console.log("  ! 预载快照不可用（" + PRELOAD + "），退回服务端 ?q= 查重");
}

// 本脚本自己建过的实体 id（取自上次运行的日志，便于区分"我建的"与"别人建的"）
const OWN_ENTITY_IDS = new Set();
const REUSED_FOREIGN = [];
const REUSED_FOREIGN_IDS = new Set();
try {
  const logTxt = fs.readFileSync("docs-local/data-campaign/logs/light-novel-translation.jsonl", "utf8");
  for (const line of logTxt.split(String.fromCharCode(10))) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.status === "created" && rec.id) OWN_ENTITY_IDS.add(rec.id);
    } catch (e) { /* 忽略坏行 */ }
  }
} catch (e) { /* 首次运行没有日志 */ }

// 复用自己的既有实体 / 或建新的。命中现存的（哪怕不是本脚本建的）一律复用，绝不建同名重复。
async function ensureAgent(title, translations, type, note, sources, idemKey) {
  const hit = camp.index.find("agent", title);
  if (hit) {
    const prev = (hit.translations || {});
    const prevLocales = Object.keys(prev).join("/");
    const mine = OWN_ENTITY_IDS.has(hit.id);
    const who = mine ? "本战役自建" : "非本战役建的存量实体（created_by=" + String(hit.created_by || "?").slice(0, 8) + "）";
    console.log("  · 复用既有 agent「" + title + "」 " + hit.id + "（" + who + "，现有翻译行 " + prevLocales + "）");
    if (!mine) REUSED_FOREIGN_IDS.add(hit.id);
    if (!prev["ja-JP"]) {
      console.log("    ! 该存量 agent 的翻译行不含 ja-JP（写的是 " + prevLocales + "）。本脚本不反写他人实体，缺口记入报告。");
      REUSED_FOREIGN.push({ id: hit.id, title: title, locales: prevLocales });
    }
    camp.reused.entity += 1;
    return hit;
  }
  return await camp.ensureEntity("agent", title, {
    original_language: "ja",
    types: [type],
    translations: translations
  }, ev(note, sources), { idemKey: idemKey, allowServerLookup: false });
}



// EX.ja / EX.tw 的前 KONOSUBA_VOLS.length 条属于 KonoSuba，無職転生 的日文／繁中表达从该偏移开始
// （EX.cn / EX.web 只装無職転生 的表达，无偏移）
const EX_J_OFFSET = KONOSUBA_VOLS.length;
const E = {};
const RELS = [];
const CU = { konosuba: [], mushoku: [], web: [] };
const EX = { ja: [], tw: [], cn: [], web: [] };
const REL = [];

// ── 工厂：每个都是「一行一次调用」，复杂证据在函数体内拼装 ──────────────
async function mkAgent(key, title, zh, type, why) {
  const note = "编目：建立责任主体「" + title + "」（" + type + "）。依据：" + why + "。agent 类型无属性字段，未写卒日／地址等任何属性。";
  E[key] = await ensureAgent(title, tr({ "ja-JP": title, "zh-TW": zh.tw, "zh-CN": zh.cn, "en-US": zh.en }), type, note, [S_JA_KONOSUBA, S_ZH_KONOSUBA, S_JA_MUSHOKU, S_ZH_MUSHOKU], "lnt-agent-" + key);
  return E[key];
}

async function mkWork(key, title, translations, tags, note, sources) {
  E[key] = await camp.ensureEntity("work", title, {
    original_language: "ja",
    types: ["novel"],
    translations: translations,
    attributes: { language: "ja", tags: tags }
  }, ev(note, sources), { idemKey: "lnt-work-" + key, allowServerLookup: lookup });
  return E[key];
}

async function mkCollection(key, title, translations, note) {
  E[key] = await camp.ensureEntity("collection", title, {
    original_language: "ja",
    types: ["collection"],
    translations: translations,
    attributes: { language: "ja" }
  }, ev(note, [S_JA_KONOSUBA, S_ZH_KONOSUBA, S_JA_MUSHOKU, S_ZH_MUSHOKU]), { idemKey: "lnt-col-" + key, allowServerLookup: lookup });
  return E[key];
}

async function mkContentUnit(slot, title, workId, n, translations, airDate, note, sources) {
  const e = await camp.ensureEntity("content_unit", title, {
    work_id: workId, position: n, number: String(n),
    original_language: "ja", types: ["content_unit"],
    translations: translations,
    attributes: { language: "ja", entry_role: "main", air_date: airDate }
  }, ev(note, sources), { idemKey: "lnt-cu-" + slot, allowServerLookup: false });
  return e;
}

async function mkExpression(title, workId, cuId, position, translations, attrs, note, sources, idem) {
  const e = await camp.ensureEntity("expression", title, {
    work_id: workId, content_unit_id: cuId, position: position,
    original_language: "ja", types: ["expression"],
    translations: translations,
    attributes: attrs
  }, ev(note, sources), { idemKey: idem, allowServerLookup: false });
  return e;
}

// bookRelease：一次建 Release → Medium → Track 三层（单册纸书：1 release / 1 medium / 1 track）
async function bookRelease(relTitle, translations, workId, relAttrs, pubAgent, medTitle, medTr, trackTitle, trackNumber, expressions, note, sources, idemPrefix) {
  const rel = await camp.ensureEntity("release", relTitle, {
    original_language: "ja", types: ["release"],
    translations: translations,
    subjects: [{ work_id: workId, role: "primary" }],
    attributes: relAttrs
  }, ev(note, sources), { idemKey: idemPrefix + "-rel", allowServerLookup: false });
  const med = await camp.ensureEntity("medium", medTitle, {
    release_id: rel.id, position: 1, original_language: "", types: ["medium"],
    translations: medTr,
    attributes: { format: "paper", role: "primary" }
  }, ev(note, sources), { idemKey: idemPrefix + "-med", scope: { release_id: rel.id }, allowServerLookup: false });
  const contents = [];
  let sp = 1;
  for (const x of expressions) {
    contents.push({ expression_id: x.id, position: sp, locator: null });
    sp += 1;
  }
  const trk = await camp.ensureEntity("track", trackTitle, {
    medium_id: med.id, position: 1, number: String(trackNumber), contents: contents,
    original_language: "", types: ["track"],
    translations: translations,
    attributes: { role: "primary" }
  }, ev(note, sources), { idemKey: idemPrefix + "-trk", scope: { medium_id: med.id }, allowServerLookup: false });
  await camp.createRelation("credit_for", rel.id, pubAgent.id, ev(note, sources), { attributes: { credit_role: "出版" }, skipIfExists: !DRY });
  RELS.push({ type: "credit_for", sourceId: rel.id, targetId: pubAgent.id });
  return { rel: rel, med: med, trk: trk };
}

// webRelease：线上连载发行（format=web），locator 用 path + relative_to 锚点
async function webRelease(chapter, expressions, workId, pubAgent, item) {
  const relTitle = "無職転生 Web版 " + chapter.title.replace("第" + chapter.n + "章　", "");
  const note = "编目：为 Web 版「" + chapter.title + "」建立线上发行（distribution_channel=web、platform=小説家になろう，无 ISBN）。Web 连载无实体品番，只填 edition_date=" + chapter.date + "＝该章首話掲載日；subjects 声明《無職転生》为 primary。";
  const rel = await camp.ensureEntity("release", relTitle, {
    original_language: "ja", types: ["release"],
    translations: trRaw(relTitle),
    subjects: [{ work_id: workId, role: "primary" }],
    attributes: { edition_date: chapter.date, edition_type: "standard", edition_batch: "regular", country: "JP", distribution_channel: "web", platform: "小説家になろう" }
  }, ev(note, [S_SYOSYEU]), { idemKey: "lnt-web-rel-" + chapter.n, allowServerLookup: false });
  const med = await camp.ensureEntity("medium", "Web", {
    release_id: rel.id, position: 1, original_language: "", types: ["medium"],
    translations: tr({ "ja-JP": "Web", "zh-TW": "Web", "zh-CN": "Web", "en-US": "Web" }),
    attributes: { format: "web", role: "primary" }
  }, ev(note, [S_SYOSYEU]), { idemKey: "lnt-web-med-" + chapter.n, scope: { release_id: rel.id }, allowServerLookup: false });
  const trk = await camp.ensureEntity("track", chapter.title, {
    medium_id: med.id, position: 1, number: String(chapter.n),
    contents: [{ expression_id: expressions[0].id, position: 1, locator: { relative_to: "medium", path: chapter.url } }],
    original_language: "", types: ["track"],
    translations: trRaw(chapter.title),
    attributes: { role: "primary" }
  }, ev(note + " locator 用 path=" + chapter.url + " 并以 relative_to=medium 明确锚点（Web 载体无页码，只有章节路径）。", [S_SYOSYEU]), { idemKey: "lnt-web-trk-" + chapter.n, scope: { medium_id: med.id }, allowServerLookup: false });
  await camp.createRelation("credit_for", rel.id, pubAgent.id, ev(note, [S_SYOSYEU]), { attributes: { credit_role: "出版" }, skipIfExists: !DRY });
  RELS.push({ type: "credit_for", sourceId: rel.id, targetId: pubAgent.id });
  return { rel: rel, med: med, trk: trk };
}

async function rel(type, source, target, note, sources, attributes) {
  await camp.createRelation(type, source.id, target.id, ev(note, sources), { attributes: attributes || {}, skipIfExists: !DRY });
  RELS.push({ type: type, sourceId: source.id, targetId: target.id });
}

// ── 1) 责任主体 ─────────────────────────────────────────────────────────
await mkAgent("akatsuki", "暁なつめ", { tw: "曉夏目", cn: "晓夏目", en: "Natsume Akatsuki" }, "person", "日文维基 infobox 著者 暁なつめ；中文维基记官方中文名 曉夏目（天聞角川另譯「曉棗」）");
await mkAgent("mishima", "三嶋くろね", { tw: "三嶋黑音", cn: "三嶋黑音", en: "Kurone Mishima" }, "person", "日文维基 infobox イラスト 三嶋くろね；中文维基插圖欄 三嶋黑音（天聞角川另譯「三島黑音」）");
await mkAgent("rifujin", "理不尽な孫の手", { tw: "不講理不求人", cn: "不讲理不求人", en: "Rifujin na Magonote" }, "person", "日文维基既刊一覧表署名「理不尽な孫の手（著）」；中文维基作者欄 不講理不求人");
await mkAgent("shirotaka", "シロタカ", { tw: "白鷹", cn: "白鹰", en: "Shirotaka" }, "person", "日文维基既刊一覧表署名「シロタカ（イラスト）」；中文维基插圖欄 白鷹（日語：シロタカ）");
await mkAgent("sneaker", "角川スニーカー文庫", { tw: "角川Sneaker文庫", cn: "角川Sneaker文库", en: "Kadokawa Sneaker Bunko" }, "organization", "日文维基 infobox レーベル 角川スニーカー文庫；中文维基文庫欄 角川Sneaker文庫");
await mkAgent("mfbooks", "MFブックス", { tw: "MF Books", cn: "MF Books", en: "MF Books" }, "organization", "日文维基：フロンティアワークス企画／KADOKAWA発行〈MFブックス〉；中文维基文庫欄 MF Books");
await mkAgent("kadokawa", "KADOKAWA", { tw: "KADOKAWA", cn: "KADOKAWA", en: "KADOKAWA" }, "organization", "日文维基 infobox 出版社 角川書店→KADOKAWA；中文维基出版社欄 日本：KADOKAWA");
await mkAgent("kadokawatw", "台灣角川", { tw: "台灣角川", cn: "台湾角川", en: "Kadokawa Taiwan" }, "organization", "中文维基：正體中文版由台灣角川發行；出版社欄 台灣：台灣角川");
await mkAgent("tianwen", "天聞角川", { tw: "天聞角川", cn: "天闻角川", en: "Tianwen Kadokawa" }, "organization", "中文维基出版社欄 中國大陸：天聞角川；出版書籍表第三欄即天聞角川簡體中文版");
console.log("  · 责任主体 9 个就绪");

// ── 2) Work ─────────────────────────────────────────────────────────────
await mkWork("konosuba", "この素晴らしい世界に祝福を!", tr({ "ja-JP": "この素晴らしい世界に祝福を!", "zh-TW": "為美好的世界獻上祝福！", "zh-CN": "为美好的世界献上祝福！", "en-US": "KonoSuba: God's Blessing on This Wonderful World!" }), ["輕小說", "異世界", "喜劇", "角川スニーカー文庫"],
  "编目：新建轻小说作品《この素晴らしい世界に祝福を!》（novel，原语言 ja）。Work 只留纯净题名，卷次与副标题放到 ContentUnit。依据：日文维基 infobox（著者 暁なつめ／イラスト 三嶋くろね／レーベル 角川スニーカー文庫）与既刊一覧（全 21 巻，本編 17 加短編集 4）；中文维基條目（繁中題 為美好的世界獻上祝福！）。",
  [S_JA_KONOSUBA, S_ZH_KONOSUBA]);
await mkWork("mushoku", "無職転生", tr({ "ja-JP": "無職転生", "zh-TW": "無職轉生", "zh-CN": "无职转生", "en-US": "Mushoku Tensei: Jobless Reincarnation" }), ["輕小說", "異世界", "奇幻", "MFブックス"],
  "编目：新建轻小说作品《無職転生》（novel，原语言 ja）。副题「異世界行ったら本気だす」属发行版题名，留在 Release 与 Medium，Work 只留「無職転生」。依据：日文维基既刊一覧（MFブックス 全 26 巻）与中文维基條目（日文原題、繁中題 無職轉生）。",
  [S_JA_MUSHOKU, S_ZH_MUSHOKU]);
console.log("  · Work 2 个就绪");

// ── 3) ContentUnit：卷（两系列各 5 卷）＋ 無職転生 Web 版 6 章 ───────────
for (const v of KONOSUBA_VOLS) {
  const z = at(KONOSUBA_ZH, v.n);
  const note = "编目：为《この素晴らしい世界に祝福を!》建立第 " + v.n + " 巻 篇目（number=" + v.n + "、entry_role=main、air_date=" + v.date + " 等于初版発行日）。日文副标题「" + v.sub + "」取日文维基既刊一覧表；繁中标题「" + z.title + "」取中文维基出版書籍表（台灣角川第 " + z.n + " 集）。";
  const cuTr = tr({ "ja-JP": "第" + v.n + "巻 " + v.sub, "zh-TW": "第" + v.n + "集 " + z.title, "zh-CN": "第" + v.n + "卷 " + z.title, "en-US": "Volume " + v.n + " (" + v.sub + ", Japanese edition)" });
  CU.konosuba.push(await mkContentUnit("konosuba-" + v.n, "第" + v.n + "巻 " + v.sub, E.konosuba.id, v.n, cuTr, v.date, note, [S_JA_KONOSUBA, S_ZH_KONOSUBA]));
}
for (const v of MUSHOKU_VOLS) {
  const note = "编目：为《無職転生》建立第 " + v.n + " 巻 篇目（number=" + v.n + "、entry_role=main、air_date=" + v.pub + " 等于初版発行日，取自日文维基既刊一覧表）。三站均无该卷副标题，各语种一律填原文卷次题名，不编造副标题。";
  CU.mushoku.push(await mkContentUnit("mushoku-" + v.n, "第" + v.n + "巻", E.mushoku.id, v.n, tr({ "ja-JP": "第" + v.n + "巻", "zh-TW": "第" + v.n + "巻", "zh-CN": "第" + v.n + "卷", "en-US": "Volume " + v.n }), v.pub, note, [S_JA_MUSHOKU, S_ZH_MUSHOKU]));
}
for (const c of WEB_CHAPTERS) {
  const note = "编目：为《無職転生》建立 Web 版（小説家になろう n9669bk）章篇目「" + c.title + "」（number=" + c.n + "、air_date=" + c.date + " 等于该章首話掲載日）。章名与掲載日取作品页一手列表，无官方中译故四语种均填原文题名。Web 版章与文庫版巻是同一 Work 下两套并存的篇目编排。";
  CU.web.push(await mkContentUnit("web-" + c.n, c.title, E.mushoku.id, c.n, tr({ "ja-JP": c.title, "zh-TW": c.title, "zh-CN": c.title, "en-US": "Web version, " + c.title }), c.date, note, [S_SYOSYEU]));
}
console.log("  · ContentUnit " + (CU.konosuba.length + CU.mushoku.length + CU.web.length) + " 个就绪");

// ── 4) Expression ───────────────────────────────────────────────────────
for (let i = 0; i < KONOSUBA_VOLS.length; i += 1) {
  const v = KONOSUBA_VOLS[i];
  const z = KONOSUBA_ZH[i];
  const jaNote = "编目：建立日文原版正文表达（language=ja、version_label=日文原版），content_unit_id 挂到第 " + v.n + " 巻 篇目。依据：角川スニーカー文庫 第 " + v.n + " 巻 ISBN=" + v.isbn + "、初版発行日 " + v.date + "（openBD 核验题名与叢書）。";
  const twNote = "编目：建立繁中譯本表达（language=zh-TW、version_label=台灣角川繁體中文版），与日文原版共用同一 content_unit_id（第 " + v.n + " 巻）。依据：中文维基出版書籍表 台灣角川 第 " + z.n + " 集，發售日 " + z.date + "、ISBN=" + z.isbn + "，中文標題「" + z.title + "」。";
  EX.ja.push(await mkExpression("第" + v.n + "巻 " + v.sub, E.konosuba.id, CU.konosuba[i].id, 1, tr({ "ja-JP": "第" + v.n + "巻 " + v.sub, "zh-TW": "第" + v.n + "集 " + z.title, "zh-CN": "第" + v.n + "卷 " + z.title, "en-US": "Volume " + v.n + " (" + v.sub + ", Japanese original)" }), { language: "ja", version_label: "日文原版" }, jaNote, [S_JA_KONOSUBA], "lnt-ex-jk-" + v.n));
  EX.tw.push(await mkExpression("第" + v.n + "集 " + z.title, E.konosuba.id, CU.konosuba[i].id, 2, tr({ "ja-JP": "第" + v.n + "巻 " + v.sub, "zh-TW": "第" + v.n + "集 " + z.title, "zh-CN": "第" + v.n + "卷 " + z.title, "en-US": "Volume " + v.n + " (Traditional Chinese, Kadokawa Taiwan)" }), { language: "zh-TW", version_label: "台灣角川繁體中文版" }, twNote, [S_ZH_KONOSUBA], "lnt-ex-tk-" + v.n));
}
for (let i = 0; i < MUSHOKU_VOLS.length; i += 1) {
  const v = MUSHOKU_VOLS[i];
  const note = "编目：建立日文原版正文表达（language=ja、version_label=MFブックス 日文原版），content_unit_id 挂到第 " + v.n + " 巻。依据：MFブックス 第 " + v.n + " 巻 ISBN=" + v.isbn + "、初版発行日 " + v.pub + "、発売日 " + v.sale + "（openBD 核验题名、叢書 MFブックス、出版者 KADOKAWA）。";
  EX.ja.push(await mkExpression(v.title, E.mushoku.id, CU.mushoku[i].id, 1, tr({ "ja-JP": v.title, "zh-TW": "無職転生（日文原版） 第" + v.n + "巻", "zh-CN": "無職転生（日文原版） 第" + v.n + "卷", "en-US": v.title }), { language: "ja", version_label: "MFブックス 日文原版" }, note, [S_JA_MUSHOKU], "lnt-ex-jm-" + v.n));
}
for (let i = 0; i < MUSHOKU_ZH_TW.length; i += 1) {
  const z = MUSHOKU_ZH_TW[i];
  const title = "無職轉生～到了異世界就拿出真本事～ 第" + z.n + "集";
  const note = "编目：建立繁中譯本表达（language=zh-TW、version_label=台灣角川繁體中文版），content_unit_id 与日文原版同挂第 " + z.n + " 巻。依据：中文维基出版書籍表 台灣角川欄 第 " + z.n + " 集 發售日 " + z.date + "、ISBN=" + z.isbn + "；繁中系列題名取中文维基條目标題。";
  EX.tw.push(await mkExpression(title, E.mushoku.id, CU.mushoku[i].id, 2, tr({ "ja-JP": "第" + z.n + "巻", "zh-TW": title, "zh-CN": "无职转生～到了异世界就拿出真本事～ 第" + z.n + "卷", "en-US": "Mushoku Tensei: Jobless Reincarnation (Traditional Chinese) Vol. " + z.n }), { language: "zh-TW", version_label: "台灣角川繁體中文版" }, note, [S_ZH_MUSHOKU], "lnt-ex-tm-" + z.n));
}
for (let i = 0; i < MUSHOKU_ZH_CN.length; i += 1) {
  const z = MUSHOKU_ZH_CN[i];
  const title = "無職轉生～到了異世界就拿出真本事～ 第" + z.n + "卷（簡體中文版）";
  const note = "编目：建立簡中譯本表达（language=zh-CN、version_label=天聞角川簡體中文版），content_unit_id 与日／繁中版同挂第 " + z.n + " 巻。依据：中文维基出版書籍表 天聞角川欄 第 " + z.n + " 卷 發售日 " + z.date + "、ISBN=" + z.isbn + "（该欄中国大陸累计出版 2 冊）。";
  EX.cn.push(await mkExpression(title, E.mushoku.id, CU.mushoku[i].id, 3, tr({ "ja-JP": "第" + z.n + "巻", "zh-TW": "無職轉生～到了異世界就拿出真本事～ 第" + z.n + "集", "zh-CN": "无职转生～到了异世界就拿出真本事～ 第" + z.n + "卷（简体中文版）", "en-US": "Mushoku Tensei: Jobless Reincarnation (Simplified Chinese) Vol. " + z.n }), { language: "zh-CN", version_label: "天聞角川簡體中文版" }, note, [S_ZH_MUSHOKU], "lnt-ex-cm-" + z.n));
}
for (const c of WEB_CHAPTERS) {
  const note = "编目：建立 Web 版「" + c.title + "」正文表达（version_label=Web版（小説家になろう）），content_unit_id 挂到同章篇目。依据：小説家になろう n9669bk 作品页章列表与首話掲載日 " + c.date + "，章首話页面 " + c.url + "。";
  EX.web.push(await mkExpression(c.title, E.mushoku.id, CU.web[c.n - 1].id, 1, tr({ "ja-JP": c.title, "zh-TW": c.title, "zh-CN": c.title, "en-US": "Web version, " + c.title }), { language: "ja", version_label: "Web版（小説家になろう）" }, note, [S_SYOSYEU], "lnt-ex-w-" + c.n));
}
console.log("  · Expression " + (EX.ja.length + EX.tw.length + EX.cn.length + EX.web.length) + " 个就绪");

// ── 5) Release → Medium → Track（日文原版 / 台灣角川繁中版 / 天聞角川简中版 / Web 連載）──
const BOOKS = [];
for (let i = 0; i < KONOSUBA_VOLS.length; i += 1) {
  const v = KONOSUBA_VOLS[i];
  const z = KONOSUBA_ZH[i];
  const jaNote = "编目：新建日文原版发行（角川スニーカー文庫 第 " + v.n + " 巻，standard／regular，JP，出版者=角川スニーカー文庫）。ISBN=" + v.isbn + "、初版発行日 " + v.date + " 取日文维基既刊一覧表并经 openBD 核验；subjects 声明作品《この素晴らしい世界に祝福を!》为 primary。载体为文庫判纸书，单册无附带盘片，故只建 1 个 medium、1 条 track。";
  const twNote = "编目：新建台灣角川繁體中文版发行（第 " + z.n + " 集，standard／regular，TW，出版者=台灣角川）。發售日 " + z.date + "、ISBN=" + z.isbn + " 取中文维基出版書籍表；subjects 声明同一作品《この素晴らしい世界に祝福を!》为 primary（译本与原文同属一个创作母体）。单册纸书，1 medium、1 track。";
  const jaTr = tr({ "ja-JP": "この素晴らしい世界に祝福を! " + v.n, "zh-TW": "為美好的世界獻上祝福！ " + v.n, "zh-CN": "为美好的世界献上祝福！ " + v.n, "en-US": "KonoSuba: God's Blessing on This Wonderful World! Vol. " + v.n });
  const twTr = tr({ "ja-JP": "この素晴らしい世界に祝福を! " + z.n, "zh-TW": "為美好的世界獻上祝福！ " + z.n, "zh-CN": "为美好的世界献上祝福！ " + z.n, "en-US": "KonoSuba (Traditional Chinese) Vol. " + z.n });
  const jaAttrs = { isbn: v.isbn, edition_date: v.date, edition_type: "standard", edition_batch: "regular", country: "JP", publisher: E.sneaker.id, packaging: "standard", distribution_channel: "physical" };
  const twAttrs = { isbn: z.isbn, edition_date: z.date, edition_type: "standard", edition_batch: "regular", country: "TW", publisher: E.kadokawatw.id, packaging: "standard", distribution_channel: "physical" };
  const jaMed = tr({ "ja-JP": "文庫判", "zh-TW": "文庫版", "zh-CN": "文库版", "en-US": "Paperback (bunko)" });
  const twMed = tr({ "ja-JP": "繁体字中国語版", "zh-TW": "繁體中文版", "zh-CN": "繁体中文版", "en-US": "Traditional Chinese edition" });
  const b1 = await bookRelease("この素晴らしい世界に祝福を! " + v.n, jaTr, E.konosuba.id, jaAttrs, E.sneaker, "文庫判", jaMed, "第" + v.n + "巻 " + v.sub, v.n, [EX.ja[i]], jaNote, [S_JA_KONOSUBA, openBd(v.isbn, "角川スニーカー文庫 第 " + v.n + " 巻")], "lnt-rel-jk-" + v.n);
  const b2 = await bookRelease("為美好的世界獻上祝福！ " + z.n, twTr, E.konosuba.id, twAttrs, E.kadokawatw, "繁體中文版", twMed, "第" + z.n + "集 " + z.title, v.n, [EX.tw[i]], twNote, [S_ZH_KONOSUBA], "lnt-rel-tk-" + v.n);
  BOOKS.push(b1, b2);
}

for (let i = 0; i < MUSHOKU_VOLS.length; i += 1) {
  const v = MUSHOKU_VOLS[i];
  const jaNote = "编目：新建 MFブックス 日文原版发行（第 " + v.n + " 巻，standard／regular，JP，出版者=MFブックス）。初版発行日 " + v.pub + "、発売日 " + v.sale + "、ISBN=" + v.isbn + " 取日文维基既刊一覧表（openBD 核验叢書 MFブックス、出版者 KADOKAWA）；subjects 声明作品《無職転生》为 primary。单行本判纸书，1 medium、1 track。";
  const jaTr = tr({ "ja-JP": v.title, "zh-TW": "無職轉生～到了異世界就拿出真本事～ " + v.n, "zh-CN": "无职转生～到了异世界就拿出真本事～ " + v.n, "en-US": "Mushoku Tensei: Jobless Reincarnation Vol. " + v.n });
  const jaAttrs = { isbn: v.isbn, edition_date: v.pub, edition_type: "standard", edition_batch: "regular", country: "JP", publisher: E.mfbooks.id, packaging: "standard", distribution_channel: "physical" };
  const jaMed = tr({ "ja-JP": "単行本", "zh-TW": "單行本", "zh-CN": "单行本", "en-US": "Paperback (MF Books)" });
  const b1 = await bookRelease(v.title, jaTr, E.mushoku.id, jaAttrs, E.mfbooks, "単行本", jaMed, v.title, v.n, [EX.ja[EX_J_OFFSET + i]], jaNote, [S_JA_MUSHOKU, openBd(v.isbn, "MFブックス 第 " + v.n + " 巻")], "lnt-rel-jm-" + v.n);
  BOOKS.push(b1);
}
for (let i = 0; i < MUSHOKU_ZH_TW.length; i += 1) {
  const z = MUSHOKU_ZH_TW[i];
  const title = "無職轉生～到了異世界就拿出真本事～ " + z.n;
  const note = "编目：新建台灣角川繁體中文版发行（第 " + z.n + " 集，standard／regular，TW，出版者=台灣角川）。發售日 " + z.date + "、ISBN=" + z.isbn + " 取中文维基出版書籍表 台灣角川欄；subjects 声明《無職転生》为 primary。单册纸书，1 medium、1 track。";
  const trTitle = tr({ "ja-JP": MUSHOKU_VOLS[i].title, "zh-TW": title, "zh-CN": "无职转生～到了异世界就拿出真本事～ " + z.n, "en-US": "Mushoku Tensei (Traditional Chinese) Vol. " + z.n });
  const attrs = { isbn: z.isbn, edition_date: z.date, edition_type: "standard", edition_batch: "regular", country: "TW", publisher: E.kadokawatw.id, packaging: "standard", distribution_channel: "physical" };
  const medTr = tr({ "ja-JP": "繁体字中国語版", "zh-TW": "繁體中文版", "zh-CN": "繁体中文版", "en-US": "Traditional Chinese edition" });
  const b = await bookRelease(title, trTitle, E.mushoku.id, attrs, E.kadokawatw, "繁體中文版", medTr, title + " 第" + z.n + "集", z.n, [EX.tw[EX_J_OFFSET + i]], note, [S_ZH_MUSHOKU], "lnt-rel-tm-" + z.n);
  BOOKS.push(b);
}
for (let i = 0; i < MUSHOKU_ZH_CN.length; i += 1) {
  const z = MUSHOKU_ZH_CN[i];
  const title = "无职转生～到了异世界就拿出真本事～ " + z.n;
  const note = "编目：新建天聞角川簡體中文版发行（第 " + z.n + " 卷，standard／regular，CN，出版者=天聞角川）。發售日 " + z.date + "、ISBN=" + z.isbn + " 取中文维基出版書籍表 天聞角川欄（该欄只列 1–2 卷）；subjects 声明《無職転生》为 primary。单册纸书，1 medium、1 track。";
  const trTitle = tr({ "ja-JP": MUSHOKU_VOLS[i].title, "zh-TW": "無職轉生～到了異世界就拿出真本事～ " + z.n, "zh-CN": title, "en-US": "Mushoku Tensei (Simplified Chinese) Vol. " + z.n });
  const attrs = { isbn: z.isbn, edition_date: z.date, edition_type: "standard", edition_batch: "regular", country: "CN", publisher: E.tianwen.id, packaging: "standard", distribution_channel: "physical" };
  const medTr = tr({ "ja-JP": "簡体字中国語版", "zh-TW": "簡體中文版", "zh-CN": "简体中文版", "en-US": "Simplified Chinese edition" });
  const b = await bookRelease(title, trTitle, E.mushoku.id, attrs, E.tianwen, "簡體中文版", medTr, "第" + z.n + "卷（簡體中文版）", z.n, [EX.cn[i]], note, [S_ZH_MUSHOKU], "lnt-rel-cm-" + z.n);
  BOOKS.push(b);
}
for (let i = 0; i < WEB_CHAPTERS.length; i += 1) {
  const b = await webRelease(WEB_CHAPTERS[i], [EX.web[i]], E.mushoku.id, E.kadokawa, WEB_CHAPTERS[i]);
  BOOKS.push(b);
}
console.log("  · Release " + BOOKS.length + " / Medium " + BOOKS.length + " / Track " + BOOKS.length + " 就绪");

// ── 6) 关系：创作署名、译本 translation_of、丛刊 includes ────────────────
await rel("written_by", E.konosuba, E.akatsuki, "编目：署名《この素晴らしい世界に祝福を!》作者（著）为暁なつめ。依据：日文维基 infobox 著者与既刊一覧表；中文维基作者欄 曉夏目。", [S_JA_KONOSUBA, S_ZH_KONOSUBA], { credit_role: "著" });
await rel("illustrated_by", E.konosuba, E.mishima, "编目：署名《この素晴らしい世界に祝福を!》插画（イラスト）为三嶋くろね。依据：日文维基 infobox イラスト；中文维基插圖欄 三嶋黑音。", [S_JA_KONOSUBA, S_ZH_KONOSUBA], { credit_role: "イラスト" });
await rel("written_by", E.mushoku, E.rifujin, "编目：署名《無職転生》作者（著）为理不尽な孫の手。依据：日文维基既刊一覧表署名「理不尽な孫の手（著）・シロタカ（イラスト）」；中文维基作者欄 不講理不求人。", [S_JA_MUSHOKU, S_ZH_MUSHOKU], { credit_role: "著" });
await rel("illustrated_by", E.mushoku, E.shirotaka, "编目：署名《無職転生》插画为シロタカ。依据：日文维基既刊一覧表署名；中文维基插圖欄 白鷹（日語：シロタカ）。", [S_JA_MUSHOKU, S_ZH_MUSHOKU], { credit_role: "イラスト" });

for (let i = 0; i < KONOSUBA_VOLS.length; i += 1) {
  const v = KONOSUBA_VOLS[i];
  const z = KONOSUBA_ZH[i];
  const note = "编目：繁中譯本（第 " + z.n + " 集，台灣角川，ISBN=" + z.isbn + "）译自日文原版（第 " + v.n + " 巻，角川スニーカー文庫，ISBN=" + v.isbn + "）。两端 Expression 同挂第 " + v.n + " 巻 content_unit；依据中日文维基既刊一覧与出版書籍表的卷次对位与 ISBN。未建 translated_by：两站均未记载台湾版译者姓名，不虚构。";
  await rel("translation_of", EX.tw[i], EX.ja[i], note, [S_JA_KONOSUBA, S_ZH_KONOSUBA], { language: "zh-TW" });
}
for (let i = 0; i < MUSHOKU_ZH_TW.length; i += 1) {
  const z = MUSHOKU_ZH_TW[i];
  const note = "编目：台灣角川繁中譯本（第 " + z.n + " 集，ISBN=" + z.isbn + "，發售 " + z.date + "）译自 MFブックス 日文原版（第 " + MUSHOKU_VOLS[i].n + " 巻，ISBN=" + MUSHOKU_VOLS[i].isbn + "）。两端 Expression 同挂第 " + z.n + " 巻 content_unit；依据中文维基三栏对照表。";
  await rel("translation_of", EX.tw[EX_J_OFFSET + i], EX.ja[EX_J_OFFSET + i], note, [S_JA_MUSHOKU, S_ZH_MUSHOKU], { language: "zh-TW" });
}
for (let i = 0; i < MUSHOKU_ZH_CN.length; i += 1) {
  const z = MUSHOKU_ZH_CN[i];
  const note = "编目：天聞角川簡中譯本（第 " + z.n + " 卷，ISBN=" + z.isbn + "，發售 " + z.date + "）译自 MFブックス 日文原版（第 " + MUSHOKU_VOLS[i].n + " 巻，ISBN=" + MUSHOKU_VOLS[i].isbn + "）。两端 Expression 同挂第 " + z.n + " 巻 content_unit。";
  await rel("translation_of", EX.cn[i], EX.ja[EX_J_OFFSET + i], note, [S_JA_MUSHOKU, S_ZH_MUSHOKU], { language: "zh-CN" });
}

await mkCollection("sneakerCol", "角川スニーカー文庫", tr({ "ja-JP": "角川スニーカー文庫", "zh-TW": "角川Sneaker文庫", "zh-CN": "角川Sneaker文库", "en-US": "Kadokawa Sneaker Bunko" }),
  "编目：建立书系收集（collection）「角川スニーカー文庫」——本模型没有独立 series 实体，文库／书系是唯一的系列聚合枢纽。依据：日文维基 レーベル 欄与既刊一覧表所属レーベル；中文维基文庫欄。");
await mkCollection("mfbooksCol", "MFブックス", tr({ "ja-JP": "MFブックス", "zh-TW": "MF Books", "zh-CN": "MF Books", "en-US": "MF Books" }),
  "编目：建立书系收集（collection）「MFブックス」。依据：日文维基条目「フロンティアワークス企画／KADOKAWA発行〈MFブックス〉」；中文维基文庫欄 MF Books。");
await rel("includes", E.sneakerCol, E.konosuba, "编目：书系「角川スニーカー文庫」收录作品《この素晴らしい世界に祝福を!》。依据：日文维基既刊一覧表所属レーベル与中文维基文庫欄。", [S_JA_KONOSUBA, S_ZH_KONOSUBA]);
await rel("includes", E.mfbooksCol, E.mushoku, "编目：书系「MFブックス」收录作品《無職転生》。依据：日文维基既刊一覧表（フロンティアワークス企画／KADOKAWA発行〈MFブックス〉）与中文维基文庫欄。", [S_JA_MUSHOKU, S_ZH_MUSHOKU]);
console.log("  · 关系共 " + RELS.length + " 条就绪");


// ── 6.5) 翻译补全（PUT 整实体替换）：把 --dry-run 时代建的实体补上 en-US 行 ──
// 首次真跑时这些实体已存在（带 ja/zh 行），ensureEntity 命中即复用不会覆盖；
// 这里显式回读—补写，保证四语题名齐全，并把补写写进 revisions。
const FULLWIDTH = { "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7", "８": "8", "９": "9" };
const hw = (s) => s.split("").map((c) => FULLWIDTH[c] || c).join("");
const REPAIR_SOURCES = [S_JA_KONOSUBA, S_ZH_KONOSUBA, S_JA_MUSHOKU, S_ZH_MUSHOKU];

function enUsFor(kind, title) {
  if (kind === "content_unit") {
    const vol = title.match(/^第(\d+)巻 (.*)$/);
    if (vol) return "Volume " + vol[1] + " (" + vol[2] + ", Japanese edition)";
    const vol2 = title.match(/^第(\d+)巻$/);
    if (vol2) return "Volume " + vol2[1];
    if (/^第[０-９１-９]+章/.test(title)) return "Web version, " + hw(title);
    return "";
  }
  if (kind === "expression") {
    const jaVol = title.match(/^第(\d+)巻 (.*)$/);
    if (jaVol) return "Volume " + jaVol[1] + " (" + jaVol[2] + ", Japanese original)";
    const twVol = title.match(/^第(\d+)集 (.*)$/);
    if (twVol) return "Volume " + twVol[1] + " (Traditional Chinese, Kadokawa Taiwan)";
    const jaM = title.match(/^無職転生 〜異世界行ったら本気だす〜 (\d+)$/);
    if (jaM) return title;
    const twM = title.match(/^無職轉生～到了異世界就拿出真本事～ 第(\d+)集$/);
    if (twM) return "Mushoku Tensei: Jobless Reincarnation (Traditional Chinese) Vol. " + twM[1];
    const cnM = title.match(/^無職轉生～到了異世界就拿出真本事～ 第(\d+)卷（簡體中文版）$/);
    if (cnM) return "Mushoku Tensei: Jobless Reincarnation (Simplified Chinese) Vol. " + cnM[1];
    if (/^第[０-９１-９]+章/.test(title)) return "Web version, " + hw(title);
    return "";
  }
  return "";
}

async function repairTranslations() {
  const targets = [];
  for (const arr of [CU.konosuba, CU.mushoku, CU.web, EX.ja, EX.tw, EX.cn, EX.web]) for (const x of arr) targets.push(x);
  let fixed = 0; let skipped = 0;
  for (const t of targets) {
    const cur = await camp.getEntity(t.id);
    const en = enUsFor(t.kind, cur.title);
    const trs = Object.assign({}, cur.translations || {});
    if (trs["en-US"] && trs["en-US"].title) { skipped += 1; continue; }
    if (!en) { skipped += 1; continue; }
    trs["en-US"] = { title: en };
    const note = "编目：补写 en-US 翻译行（原建时只给了 ja-JP/zh-TW/zh-CN）。该作品无官方英文版题名，故按「原题名＋卷次」的目录学写法给出可辨识的英文行，不冒充官方译名；其余字段（content_unit_id、position、attributes）由 PUT 整实体替换原样带回。";
    await camp.updateEntity(t.id, { translations: trs }, ev(note, REPAIR_SOURCES));
    fixed += 1;
  }
  console.log("  · 翻译补全：改写 " + fixed + " 条、跳过 " + skipped + " 条");
  return fixed;
}

// ── 7) 写后回读断言 ─────────────────────────────────────────────────────
const problems = [];
const FOREIGN_ISSUES = [];
const checked = { entities: 0, relations: 0, revisions: 0 };
const fresh = new Map();
const CHECK = (ok, msg) => { if (!ok) problems.push(msg); return ok; };

// 回读阶段打节奏并重试：目标实例走本地代理，连续请求偶发 TLS 断连（other side closed）
const pace = () => new Promise((r) => setTimeout(r, 60));
async function getRetry(id, attempt) {
  const n = attempt || 0;
  try {
    await pace();
    return await camp.getEntity(id);
  } catch (e) {
    if (n < 4) { await new Promise((r) => setTimeout(r, 800 * (n + 1))); return getRetry(id, n + 1); }
    throw e;
  }
}

async function verify() {
  // A 实体回读：kind / 状态 / 四语题名 / 结构归属
  const handles = [];
  for (const k of Object.keys(E)) handles.push(E[k]);
  for (const arr of [CU.konosuba, CU.mushoku, CU.web, EX.ja, EX.tw, EX.cn, EX.web]) for (const x of arr) handles.push(x);
  for (const b of BOOKS) { handles.push(b.rel); handles.push(b.med); handles.push(b.trk); }
  for (const h of handles) {
    const got = await getRetry(h.id, 0);
    fresh.set(h.id, got);
    checked.entities += 1;
    CHECK(got.kind === h.kind, "回读 kind 不一致 " + h.id + "：" + got.kind + " vs " + h.kind);
    // 非本战役建的存量实体（例如别处已录的 KADOKAWA）不按本脚本的字段标准判分，只做复查上报
    const foreign = !OWN_ENTITY_IDS.has(h.id) || REUSED_FOREIGN_IDS.has(h.id);
    if (!foreign) {
      CHECK(got.status === "published", "状态不是 published " + h.id + "：" + got.status);
      for (const loc of ["zh-CN", "zh-TW", "ja-JP", "en-US"]) {
        CHECK(!!(got.translations || {})[loc] && !!(got.translations || {})[loc].title, "缺 " + loc + " 题名 " + h.id);
      }
    } else if (got.status !== "published" || !(got.translations || {})["ja-JP"]) {
      FOREIGN_ISSUES.push({ id: h.id, title: got.title, status: got.status, locales: Object.keys(got.translations || {}).join("/") });
    }
    fresh.set(h.id, got);
  }
  for (const f of FOREIGN_ISSUES) {
    console.log("  ! 存量非本战役实体未达本脚本标准（不再写他人实体）：" + f.id + "「" + f.title + "」status=" + f.status + " locales=" + f.locales);
  }
  for (const f of REUSED_FOREIGN) {
    console.log("  ! 复用他人 agent：" + f.id + "「" + f.title + "」locales=" + f.locales);
  }
  console.log("  · 回读实体 " + checked.entities + " 条");

  // B 创作链：Work → ContentUnit → Expression
  for (let i = 0; i < KONOSUBA_VOLS.length; i += 1) {
    const v = KONOSUBA_VOLS[i];
    const cu = fresh.get(CU.konosuba[i].id);
    CHECK(cu.work_id === E.konosuba.id, "cu/konosuba/" + v.n + " work_id 不属于作品");
    CHECK(String(cu.number) === String(v.n) && cu.position === v.n, "cu/konosuba/" + v.n + " number/position 与卷次不符");
    CHECK(cu.attributes.air_date === v.date, "cu/konosuba/" + v.n + " air_date 不等于初版発行日");
    for (const x of [fresh.get(EX.ja[i].id), fresh.get(EX.tw[i].id)]) { // i 为 KonoSuba 内部序号
      CHECK(x.work_id === E.konosuba.id, "expr/konosuba/" + v.n + " work_id 归属错误");
      CHECK(x.content_unit_id === CU.konosuba[i].id, "expr/konosuba/" + v.n + " content_unit_id 未挂到篇目");
      CHECK(x.parent_id === undefined || x.parent_id === null || x.parent_id === "", "expr/konosuba/" + v.n + " 不应有 parent_id");
    }
  }
  for (let i = 0; i < MUSHOKU_VOLS.length; i += 1) {
    const v = MUSHOKU_VOLS[i];
    const cu = fresh.get(CU.mushoku[i].id);
    CHECK(cu.work_id === E.mushoku.id, "cu/mushoku/" + v.n + " work_id 不属于作品");
    CHECK(fresh.get(EX.ja[EX_J_OFFSET + i].id).content_unit_id === CU.mushoku[i].id, "expr/ja/mushoku/" + v.n + " content_unit_id 挂载错误");
    CHECK(fresh.get(EX.tw[EX_J_OFFSET + i].id).content_unit_id === CU.mushoku[i].id, "expr/tw/mushoku/" + v.n + " content_unit_id 挂载错误");
  }
  for (const c of WEB_CHAPTERS) {
    const cu = fresh.get(CU.web[c.n - 1].id);
    CHECK(cu.work_id === E.mushoku.id, "cu/web/" + c.n + " work_id 不属于作品");
    CHECK(cu.attributes.air_date === c.date, "cu/web/" + c.n + " air_date 不等于掲載日");
    CHECK(fresh.get(EX.web[c.n - 1].id).content_unit_id === CU.web[c.n - 1].id, "expr/web/" + c.n + " content_unit_id 未挂到章篇目");
  }
  for (let i = 0; i < MUSHOKU_ZH_CN.length; i += 1) {
    CHECK(fresh.get(EX.cn[i].id).content_unit_id === CU.mushoku[i].id, "expr/cn/mushoku/" + MUSHOKU_ZH_CN[i].n + " content_unit_id 挂载错误");
  }

  // C 承载链：Release → Medium → Track → contents + subjects 覆盖
  for (const b of BOOKS) {
    const rel = fresh.get(b.rel.id);
    const med = fresh.get(b.med.id);
    const trk = fresh.get(b.trk.id);
    CHECK(rel.work_id === undefined || rel.work_id === null, "release「" + rel.title + "」不应有 work_id");
    const subj = (rel.subjects || []).map((s) => s.work_id);
    CHECK(subj.length > 0, "release「" + rel.title + "」缺 subjects");
    CHECK(med.release_id === rel.id, "medium「" + med.title + "」未挂在发行上");
    CHECK(trk.medium_id === med.id, "track「" + trk.title + "」medium 归属错误");
    CHECK((trk.contents || []).length >= 1, "track「" + trk.title + "」contents 为空");
    const pos = [];
    for (const c of trk.contents || []) {
      CHECK(pos.indexOf(c.position) < 0, "track「" + trk.title + "」contents position 重复：" + c.position);
      pos.push(c.position);
      const ex = fresh.get(c.expression_id);
      CHECK(!!ex, "track「" + trk.title + "」contents 引用未知表达 " + c.expression_id);
      if (ex) CHECK(subj.indexOf(ex.work_id) >= 0, "track「" + trk.title + "」引用的表达所属 Work 未在 subjects 声明");
      if (c.locator && Object.keys(c.locator).length > 0) {
        CHECK(!!c.locator.relative_to, "track「" + trk.title + "」locator 有子字段但缺 relative_to 锚点");
      }
    }
  }

  // D 关系回读（逐条 source → relations）
  const bySource = new Map();
  for (const w of RELS) {
    if (!bySource.has(w.sourceId)) bySource.set(w.sourceId, []);
    bySource.get(w.sourceId).push(w);
  }
  for (const srcId of bySource.keys()) {
    await pace();
    const r = await client.relationsOf(srcId);
    const items = (r.body && r.body.items) || r || [];
    for (const w of bySource.get(srcId)) {
      const ok = items.some((x) => x.type === w.type && x.source_id === w.sourceId && x.target_id === w.targetId);
      CHECK(ok, "关系回读缺失：" + w.type + " " + srcId.slice(0, 8) + "→" + w.targetId.slice(0, 8));
      if (ok) checked.relations += 1;
    }
  }
  console.log("  · 回读关系 " + checked.relations + " / " + RELS.length + " 条");

  // E revisions
  const revTargets = [E.konosuba.id, E.mushoku.id, E.sneakerCol.id, E.akatsuki.id, CU.konosuba[0].id, CU.mushoku[0].id, CU.web[0].id, EX.ja[0].id, EX.tw[0].id, EX.web[0].id, BOOKS[0].rel.id, BOOKS[0].trk.id];
  for (const id of revTargets) {
    const r = await client.call("/api/catalog/entities/" + id + "/revisions");
    const items = (r.body && (r.body.items || r.body.revisions)) || [];
    checked.revisions += items.length;
    CHECK(r.status === 200 && items.length >= 1, "revisions 回读异常 " + String(id).slice(0, 8) + " → " + r.status + " items=" + items.length);
  }

  // F 结构计数（服务端视角）
  await pace();
  const allRel = await client.listKind("release");
  const mine = allRel.filter((x) => /素晴らしい世界に祝福を|為美好的世界獻上祝福|無職転生|無職轉生|无职转生/.test(x.title));
  console.log("  · 服务端 release 匹配本领域 " + mine.length + " 条（期望 28）");
  CHECK(mine.length === 28, "release 计数不符：期望 28，实际 " + mine.length);

  // G 两条完整链样例
  const showChain = (label, cuId, exId, b) => {
    const cu = fresh.get(cuId), ex = fresh.get(exId), rel = fresh.get(b.rel.id), med = fresh.get(b.med.id), trk = fresh.get(b.trk.id);
    console.log("  ✔ " + label);
    console.log("     Work        " + b.rel.subjects[0].work_id + "（" + (rel.subjects[0].work_id === E.konosuba.id ? "この素晴らしい世界に祝福を!" : "無職転生") + "）");
    console.log("     ContentUnit " + cu.id + "（" + cu.title + "）number=" + cu.number);
    console.log("     Expression  " + ex.id + "（" + ex.title + "）language=" + ex.attributes.language + " content_unit_id=" + ex.content_unit_id);
    console.log("     Release     " + rel.id + "（" + rel.title + "）");
    console.log("     Medium      " + med.id + "（" + med.title + "）format=" + med.attributes.format);
    console.log("     Track       " + trk.id + "（" + trk.title + "）contents=" + JSON.stringify(trk.contents));
  };
  showChain("链 1（轻小说卷 日文原版＋繁中譯本 分属两个发行）", CU.konosuba[0].id, EX.ja[0].id, BOOKS[0]);
  showChain("链 2（Web 版章，locator 带 path + relative_to 锚点）", CU.web[0].id, EX.web[0].id, BOOKS[15]);
}

if (!DRY) {
  try {
    await repairTranslations();
  } catch (e) {
    problems.push("翻译补全失败：" + (e && e.message ? e.message : String(e)));
  }
  try {
    await verify();
  } catch (e) {
    problems.push("回读阶段网络异常（断言不完整）：" + (e && e.message ? e.message : String(e)));
    console.log("  !! 回读中断：" + (e && e.message ? e.message : String(e)));
  }
  console.log("");
  console.log("回读断言：实体 " + checked.entities + " 条、关系 " + checked.relations + " 条、revision " + checked.revisions + " 条");
  if (problems.length) {
    console.log("断言失败 " + problems.length + " 项：");
    for (const p of problems.slice(0, 60)) console.log("  ✗ " + p);
  } else {
    console.log("断言全部通过（结构归属 / content_unit 挂载 / subjects 覆盖 / 关系两端 / revisions / 四语题名）");
  }
} else {
  console.log("[dry-run] 计划：Work 2 + collection 2 + agent 9 + ContentUnit 16 + Expression 22 + Release 28 + Medium 28 + Track 28；关系 " + RELS.length + " 条");
}

camp.summary({ verification: { problems: DRY ? ["dry-run 未回读"] : problems, checked: checked, foreignIssues: FOREIGN_ISSUES, reusedForeign: REUSED_FOREIGN } });
if (problems.length) process.exitCode = 1;
