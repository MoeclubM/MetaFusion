#!/usr/bin/env node
// 按 BanG Dream! 官网 discography 条目补录唱片：歌曲 Work → 录音 Expression → Release（一品番一 Release）
// → Medium（按商品タイプ的盘数）→ Track（contents 引用 expression），并补 performed_by / includes 关系。
//
// 幂等：每个实体先按题名（或品番）查重，命中即复用；重复运行不会造重复实体，也不会改既有实体的其它字段。
// 用法：MF_USER_PASS=<口令> node scripts/data/discography_batch.mjs 4213 4177
//       MF_USER_PASS=<口令> node scripts/data/discography_batch.mjs --verify 4213   # 只回读，不写
// 环境：MF_BASE（默认 https://findverse.cc）、MF_USER（默认 curator01）
// 凭据只从环境变量读，不落盘。
//
// 建模口径（与站上既有 6+ 样本一致）：
//   · release.subjects = 该版收录的【歌曲作品】，role=primary；instrumental 不单建曲目；
//   · 同一首曲在两个版里共用同一个 expression（跨发行复用），各版 Track 各自 contents 引用它；
//   · Release 题名保持纯净（= 创作主名），版别由 attributes.catalog_number + edition_type 区分；
//   · Blu-ray 等影像盘只建 Medium，不建曲目（官网未给可考据的曲目分轨或其为整段影像）。

const BASE = process.env.MF_BASE || "https://findverse.cc";
const USER = process.env.MF_USER || "curator01";
const PASS = process.env.MF_USER_PASS;
const COLLECTION_TITLE = "BanG Dream!"; // 系列集合，歌曲经 includes 归属

// ── 计划表 ────────────────────────────────────────────────────────────────
// 数据全部取自官网 /discographies/<id>/ ：品番、発売日、商品タイプ（盘数）、収録内容（明列曲名）。
// media 元素：[介质题名, format 词项码, 是否有可考据曲目]
const PLANS = {
  4213: {
    band: "Poppin'Party",
    releaseTitle: "スキップ･スランプ･スリッパ",
    date: "2026-10-14",
    headline: "Poppin'Party 23rd Single「スキップ･スランプ･スリッパ」",
    songs: [
      { title: "スキップ･スランプ･スリッパ" },
      { title: "Amore" },
    ],
    editions: [
      { catalogNumber: "BRMM-11077", editionType: "limited", typeLabel: "グッズ付初回生産限定盤（シングルCD＋グッズ）", media: [["CD", "cd", true]] },
      { catalogNumber: "BRMM-11078", editionType: "standard", typeLabel: "通常盤（シングルCD）", media: [["CD", "cd", true]] },
    ],
  },
  4177: {
    band: "Poppin'Party",
    releaseTitle: "どきどきデエト",
    date: "2026-04-29",
    headline: "Poppin'Party 22nd Single「どきどきデエト」",
    songs: [
      { title: "どきどきデエト" },
      { title: "Game Changer" },
    ],
    editions: [
      { catalogNumber: "BRMM-11031", editionType: "limited", typeLabel: "Blu-ray付生産限定盤（シングルCD＋Blu-ray，BD 收录 2026 年 New Year LIVE「Happy BanG Year!!」）", media: [["CD", "cd", true], ["Blu-ray", "bd", false]] },
      { catalogNumber: "BRMM-11032", editionType: "standard", typeLabel: "通常盤（シングルCD）", media: [["CD", "cd", true]] },
    ],
  },
  4102: {
    band: "Poppin'Party",
    releaseTitle: "Drive Your Heart",
    date: "2025-12-24",
    headline: "Poppin'Party 21st Single「Drive Your Heart」",
    songs: [
      { title: "Drive Your Heart" },
      { title: "とっておきAnswer" },
      { title: "世界中の青空をあつめて" },
    ],
    editions: [
      { catalogNumber: "BRMM-10994", editionType: "limited", typeLabel: "Blu-ray付生産限定盤（シングルCD＋Blu-ray，BD 收录トークイベント「ポピパの新学期！」）", media: [["CD", "cd", true], ["Blu-ray", "bd", false]] },
      { catalogNumber: "BRMM-10995", editionType: "standard", typeLabel: "通常盤（シングルCD）", media: [["CD", "cd", true]] },
    ],
  },
  3574: {
    band: "Poppin'Party",
    releaseTitle: "新しい季節に",
    date: "2024-01-24",
    headline: "Poppin'Party 19th Single「新しい季節に」",
    songs: [
      { title: "新しい季節に" },
      { title: "ほな！" },
      { title: "Chu Chueen!" },
    ],
    editions: [
      { catalogNumber: "BRMM-10759", editionType: "limited", typeLabel: "Blu-ray付生産限定盤（シングルCD＋Blu-ray，BD 收录「ぽぴばん！のおでかけin SUMMER」）", media: [["CD", "cd", true], ["Blu-ray", "bd", false]] },
      { catalogNumber: "BRMM-10760", editionType: "standard", typeLabel: "通常盤（シングルCD）", media: [["CD", "cd", true]] },
    ],
  },
  2684: {
    band: "Poppin'Party",
    releaseTitle: "Live Beyond!!",
    date: "2021-08-18",
    headline: "Poppin'Party ミニAlbum「Live Beyond!!」",
    // 官网明列 5 曲；「Moonlight Walk」与「ここから先は歌にならない」分别是「進化の実」「ぼくたちのリメイク」的主题歌，
    // 但这两个动画作品站上没有、且不在 BanG Dream! 企划内 → 不建 soundtrack_of（宁缺勿错），记入跳过清单。
    songs: [
      { title: "Live Beyond!!" },
      { title: "Sweets BAN!" },
      { title: "キミが始まる！" },
      { title: "Moonlight Walk" },
      { title: "ここから先は歌にならない" },
    ],
    editions: [
      { catalogNumber: "BRMM-10424", editionType: "limited", typeLabel: "Blu-ray付生産限定盤（ミニアルバム CD＋Blu-ray）", media: [["CD", "cd", true], ["Blu-ray", "bd", false]] },
      { catalogNumber: "BRMM-10425", editionType: "standard", typeLabel: "通常盤（ミニアルバム CD）", media: [["CD", "cd", true]] },
    ],
  },
  736: {
    band: "Poppin'Party",
    releaseTitle: "Jumpin'",
    date: "2019-02-20",
    headline: "Poppin'Party 13th Single「Jumpin'」",
    songs: [
      { title: "Jumpin'", soundtrackOf: "BanG Dream! 2nd Season" },
      { title: "What's the POPIPA!?" },
    ],
    editions: [
      { catalogNumber: "BRMM-10158", editionType: "limited", typeLabel: "Blu-ray付生産限定盤（シングルCD＋Blu-ray，BD 收录「BanG Dream! 5th☆LIVE」Day1）", media: [["CD", "cd", true], ["Blu-ray", "bd", false]] },
      { catalogNumber: "BRMM-10159", editionType: "standard", typeLabel: "通常盤（シングルCD）", media: [["CD", "cd", true]] },
    ],
  },
  961: {
    band: "Poppin'Party",
    releaseTitle: "Dreamers Go!/Returns",
    date: "2019-05-15",
    headline: "Poppin'Party 14th Single「Dreamers Go!/Returns」",
    // 官网写明两曲均为动画「BanG Dream! 2nd Season」的“挿入歌”（不是 OP/ED）→ 按口径不加 soundtrack_of，记入跳过清单。
    songs: [
      { title: "Dreamers Go!" },
      { title: "Returns" },
    ],
    editions: [
      { catalogNumber: "BRMM-10190", editionType: "limited", typeLabel: "Blu-ray付生産限定盤（シングルCD＋Blu-ray，BD 收录动画 2nd Season #1～#2 等）", media: [["CD", "cd", true], ["Blu-ray", "bd", false]] },
      { catalogNumber: "BRMM-10191", editionType: "standard", typeLabel: "通常盤（シングルCD）", media: [["CD", "cd", true]] },
    ],
  },
  632: {
    band: "Poppin'Party",
    releaseTitle: "キズナミュージック♪",
    date: "2018-12-12",
    headline: "Poppin'Party 12th Single「キズナミュージック♪」",
    songs: [
      { title: "キズナミュージック♪", soundtrackOf: "BanG Dream! 2nd Season" },
      { title: "Home Street" },
    ],
    editions: [
      { catalogNumber: "BRMM-10140", editionType: "limited", typeLabel: "Blu-ray付生産限定盤（シングルCD＋Blu-ray，BD 收录动画 OP 无字幕影像）", media: [["CD", "cd", true], ["Blu-ray", "bd", false]] },
      { catalogNumber: "BRMM-10141", editionType: "standard", typeLabel: "通常盤（シングルCD）", media: [["CD", "cd", true]] },
    ],
  },
  511: {
    band: "Poppin'Party",
    releaseTitle: "ガールズコード",
    date: "2018-10-03",
    headline: "Poppin'Party 11th Single「ガールズコード」",
    songs: [
      { title: "ガールズコード" },
      { title: "切ないSandglass" },
    ],
    // 官网该条只有一个品番、商品タイプ「シングルCD」（无 Blu-ray 盘），无动画主题歌记载
    editions: [
      { catalogNumber: "BRMM-10135", editionType: "standard", typeLabel: "通常盤（シングルCD，初回生産分のみ封入特典）", media: [["CD", "cd", true]] },
    ],
  },
  193: {
    band: "Poppin'Party",
    releaseTitle: "二重の虹/最高",
    date: "2018-07-11",
    headline: "Poppin'Party 10th Single「二重の虹(ダブル レインボウ)/最高(さあ行こう)！」",
    // 括号内是读音不是题名的一部分：Work 取纯净题名，官方写法进 alias。
    // 「最高」是 TVアニメ「フューチャーカード 神バディファイト」OP，但该动画站上没有且不属本企划 → 不建 soundtrack_of（记入跳过清单）
    songs: [
      { title: "二重の虹", aliases: ["二重の虹(ダブル レインボウ)"] },
      { title: "最高", aliases: ["最高(さあ行こう)！"] },
    ],
    editions: [
      { catalogNumber: "BRMM-10125", editionType: "limited", typeLabel: "Blu-ray付生産限定盤（CD＋Blu-ray）", media: [["CD", "cd", true], ["Blu-ray", "bd", false]] },
      { catalogNumber: "BRMM-10126", editionType: "standard", typeLabel: "通常盤（CD）", media: [["CD", "cd", true]] },
    ],
  },
};

// ── HTTP ─────────────────────────────────────────────────────────────────
let token = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function raw(path, opts = {}, retry = 0) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, { ...opts, headers });
  // 429 限流与网关 5xx 都是瞬时故障：退避重试，不要把半截结果当成"实体不存在"（曾把 502 当成空列表）
  if ((res.status === 429 || res.status >= 500) && retry < 6) { await sleep(1200 * (retry + 1)); return raw(path, opts, retry + 1); }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

async function api(path, opts = {}) {
  const r = await raw(path, opts);
  if (r.status >= 400) throw new Error((opts.method || "GET") + " " + path + " -> " + r.status + " " + JSON.stringify(r.body).slice(0, 300));
  return r.body;
}

async function login() {
  if (!PASS) throw new Error("缺少 MF_USER_PASS（口令只从环境变量读）");
  const r = await raw("/api/auth/login", { method: "POST", body: JSON.stringify({ username: USER, password: PASS }) });
  if (r.status !== 200 || !r.body?.token) throw new Error("登录失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
  token = r.body.token;
  const me = await api("/api/auth/me");
  console.log("已登录 " + me.username + "（" + (me.groups || []).join(",") + "）");
}

const enc = encodeURIComponent;

// 列表接口服务端把 limit 截到 50，靠 total + offset 翻页；q / *_id 过滤参数是真正生效的（实测 total 随之收敛）
async function listAll(kind, extra = "") {
  const out = [];
  for (let offset = 0; ; offset += 50) {
    const r = await api("/api/catalog/entities?kind=" + kind + "&limit=50&offset=" + offset + extra);
    const items = r.items || [];
    out.push(...items);
    const total = typeof r.total === "number" ? r.total : out.length;
    if (items.length < 50 || out.length >= total) break;
  }
  return out;
}

async function search(kind, q) {
  return listAll(kind, "&q=" + enc(q));
}

async function getEntity(id) { return api("/api/catalog/entities/" + id); }

// 子实体查询：问服务端归属过滤（release_id / medium_id / work_id），再本地复核一次字段，
// 避免"过滤参数被忽略"时把全量当成子项、或把别人的子项当成自己的。
async function children(kind, param, value) {
  const items = await listAll(kind, "&" + param + "=" + enc(value));
  return items.filter((x) => x[param] === value);
}

async function relationsOf(id) {
  const r = await api("/api/catalog/entities/" + id + "/relations");
  return r.items || [];
}

// ── 写入原语 ─────────────────────────────────────────────────────────────
function evidence(note, url, citation) {
  return { edit_note: note, sources: [{ kind: "url", url, citation }] };
}

async function createEntity(entity, note, url, citation) {
  const body = { entity, expected_version: 0, ...evidence(note, url, citation) };
  const r = await raw("/api/catalog/entities", { method: "POST", body: JSON.stringify(body) });
  if (r.status >= 400) throw new Error("创建 " + entity.kind + "「" + entity.title + "」失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 400));
  return r.body;
}

async function createRelation(type, sourceId, targetId, note, url, citation) {
  const body = { relation: { type, source_id: sourceId, target_id: targetId, position: 0, attributes: {} }, expected_version: 0, ...evidence(note, url, citation) };
  const r = await raw("/api/catalog/relations", { method: "POST", body: JSON.stringify(body) });
  if (r.status >= 400) throw new Error("创建关系 " + type + " 失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 300));
  return r.body;
}

// ── 领域原语（幂等） ──────────────────────────────────────────────────────
const stats = { created: {}, reused: {}, skipped: [] };
function bump(kind, isNew) { const k = kind + (isNew ? "_created" : "_reused"); stats.created[k] = (stats.created[k] || 0) + 1; }

async function ensureAgent(title) {
  const hits = await search("agent", title);
  const hit = hits.find((x) => x.title === title && (x.types || []).includes("group"));
  if (!hit) throw new Error("找不到乐队实体：" + title);
  return hit;
}

async function ensureAnime(title) {
  const hits = await search("work", title);
  const hit = hits.find((x) => x.title === title && (x.types || []).includes("animation"));
  if (!hit) throw new Error("找不到动画作品：" + title + "（已有候选：" + JSON.stringify(hits.map((x) => x.title)) + "）");
  return hit;
}

async function ensureCollection(title) {
  const hits = await search("collection", title);
  const hit = hits.find((x) => x.title === title);
  if (!hit) throw new Error("找不到系列集合：" + title);
  return hit;
}

async function ensureSongWork(title, plan, sourceUrl, citation, dry) {
  const hits = await search("work", title);
  const same = hits.filter((x) => x.title === title);
  const hit = same.find((x) => (x.types || []).includes("song"));
  if (hit) { console.log("    · 复用歌曲 Work「" + title + "」" + hit.id.slice(0, 8)); bump("work", false); return hit; }
  if (same.length) console.log("    ! 同名 Work 已存在但类型非 song，另建： " + JSON.stringify(same.map((x) => x.types)));
  if (dry) { console.log("    · [dry] 将创建歌曲 Work「" + title + "」"); bump("work", true); return { id: "DRY", title }; }
  const ja = { title };
  if (plan.songs.find((s) => s.title === title)?.aliases) ja.aliases = plan.songs.find((s) => s.title === title).aliases;
  const created = await createEntity({
    kind: "work", title, original_language: "ja", types: ["song"],
    translations: { "ja-JP": ja }, status: "published",
  }, "编目：" + plan.headline + " 收录曲「" + title + "」（题名保持纯净，单曲/品番等发行信息落 Release）", sourceUrl, citation);
  console.log("    + 新建歌曲 Work「" + title + "」" + created.id.slice(0, 8));
  bump("work", true);
  return created;
}

async function ensureExpression(work, title, plan, sourceUrl, citation, dry) {
  const kids = await children("expression", "work_id", work.id);
  const hit = kids.find((x) => x.title === title);
  if (hit) { console.log("    · 复用录音表达「" + title + "」" + hit.id.slice(0, 8)); bump("expression", false); return hit; }
  if (dry) { console.log("    · [dry] 将创建录音表达「" + title + "」"); bump("expression", true); return { id: "DRY" }; }
  const created = await createEntity({
    kind: "expression", work_id: work.id, title, original_language: "ja",
    translations: { "ja-JP": { title } }, status: "published",
  }, "编目：" + plan.headline + "「" + title + "」的录音表达（跨发行版复用的母版），供发行曲目 contents 引用", sourceUrl, citation);
  console.log("    + 新建录音表达「" + title + "」" + created.id.slice(0, 8));
  bump("expression", true);
  return created;
}

async function ensureRelease(plan, edition, subjectWorks, sourceUrl, citation, dry) {
  const hits = await search("release", plan.releaseTitle);
  let hit = null;
  for (const h of hits) {
    if (h.title !== plan.releaseTitle) continue;
    const full = await getEntity(h.id);
    if ((full.attributes || {}).catalog_number === edition.catalogNumber) { hit = full; break; }
  }
  if (hit) { console.log("    · 复用发行版 " + edition.catalogNumber + " " + hit.id.slice(0, 8)); bump("release", false); return hit; }
  const subjects = subjectWorks.map((w, i) => ({ work_id: w.id, role: "primary", position: i }));
  if (dry) { console.log("    · [dry] 将创建发行版 " + edition.catalogNumber); bump("release", true); return { id: "DRY", subjects }; }
  const created = await createEntity({
    kind: "release", title: plan.releaseTitle, original_language: "ja", types: ["release"],
    subjects,
    attributes: { catalog_number: edition.catalogNumber, edition_date: plan.date, edition_type: edition.editionType, distribution_channel: "physical" },
    translations: { "ja-JP": { title: plan.releaseTitle } },
    status: "published",
  }, "编目：" + plan.headline + " 的 " + edition.typeLabel + "（品番 " + edition.catalogNumber + "，发售日 " + plan.date + "）；一品番一 Release，subjects 声明本版收录的各歌曲作品", sourceUrl, citation);
  console.log("    + 新建发行版 " + edition.catalogNumber + " " + created.id.slice(0, 8));
  bump("release", true);
  return created;
}

async function ensureMedium(release, title, position, format, plan, sourceUrl, citation, dry) {
  const kids = await children("medium", "release_id", release.id);
  const hit = kids.find((x) => x.title === title && x.position === position);
  if (hit) { console.log("      · 复用载体「" + title + "」" + hit.id.slice(0, 8)); bump("medium", false); return hit; }
  if (dry) { console.log("      · [dry] 将创建载体「" + title + "」"); bump("medium", true); return { id: "DRY" }; }
  const created = await createEntity({
    kind: "medium", release_id: release.id, title, position, types: ["medium"],
    attributes: { format, role: "primary" },
    translations: { "ja-JP": { title } }, status: "published",
  }, "编目：" + plan.headline + "（" + release.attributes.catalog_number + "）的第 " + (position + 1) + " 张载体：" + title, sourceUrl, citation);
  console.log("      + 新建载体「" + title + "」" + created.id.slice(0, 8));
  bump("medium", true);
  return created;
}

async function ensureTrack(medium, title, position, expressionId, plan, sourceUrl, citation, dry) {
  const kids = await children("track", "medium_id", medium.id);
  const hit = kids.find((x) => x.title === title && x.position === position);
  if (hit) { console.log("        · 复用曲目「" + title + "」"); bump("track", false); return hit; }
  if (dry) { console.log("        · [dry] 将创建曲目「" + title + "」"); bump("track", true); return { id: "DRY" }; }
  const created = await createEntity({
    kind: "track", medium_id: medium.id, title, position, types: ["track"],
    contents: [{ expression_id: expressionId, position, locator: null }],
    translations: { "ja-JP": { title } }, status: "published",
  }, "编目：" + plan.headline + " 曲目 " + (position + 1) + "「" + title + "」，收录表达指向该曲的录音 expression", sourceUrl, citation);
  console.log("        + 新建曲目「" + title + "」");
  bump("track", true);
  return created;
}

async function ensureRelation(type, source, target, note, sourceUrl, citation, dry) {
  if (dry) { console.log("    · [dry] 将创建关系 " + type + " → " + target.title); bump("relation", true); return; }
  const existing = await relationsOf(source.id);
  if (existing.some((r) => r.type === type && r.target_id === target.id)) { console.log("    · 关系已存在 " + type); bump("relation", false); return; }
  await createRelation(type, source.id, target.id, note, sourceUrl, citation);
  console.log("    + 关系 " + type + " → " + target.title);
  bump("relation", true);
}

// ── 回读验证 ─────────────────────────────────────────────────────────────
async function verifyPlan(plan) {
  const lines = [];
  const releases = [];
  const hits = await search("release", plan.releaseTitle);
  for (const h of hits) {
    if (h.title !== plan.releaseTitle) continue;
    const full = await getEntity(h.id);
    if (plan.editions.some((e) => e.catalogNumber === (full.attributes || {}).catalog_number)) releases.push(full);
  }
  releases.sort((a, b) => String(a.attributes.catalog_number).localeCompare(String(b.attributes.catalog_number)));
  for (const rel of releases) {
    const subjectTitles = [];
    for (const s of rel.subjects || []) { const w = await getEntity(s.work_id); subjectTitles.push(s.role + ":" + w.title); }
    lines.push("  [发行版] " + rel.attributes.catalog_number + " | " + rel.title + " | 发售日 " + rel.attributes.edition_date + " | edition_type=" + rel.attributes.edition_type + " | status=" + rel.status + " | v" + rel.version + " | id=" + rel.id);
    lines.push("      subjects(" + (rel.subjects || []).length + ") = " + subjectTitles.join("，"));
    const seen = new Set();
    for (const s of rel.subjects || []) {
      if (seen.has(s.work_id)) continue;
      seen.add(s.work_id);
      const rels = await relationsOf(s.work_id);
      const parts = [];
      for (const r of rels) {
        const t = await getEntity(r.target_id);
        parts.push(r.type + "→" + t.title);
      }
      lines.push("     曲目关系 [" + subjectTitles[(rel.subjects || []).findIndex((x) => x.work_id === s.work_id)].split(":")[1] + "] = " + (parts.join("，") || "（无）"));
    }
    const meds = (await children("medium", "release_id", rel.id)).sort((a, b) => a.position - b.position);
    for (const m of meds) {
      const ts = (await children("track", "medium_id", m.id)).sort((a, b) => a.position - b.position);
      lines.push("     载体 pos" + m.position + " " + m.title + " [" + ((m.attributes || {}).format || "-") + "] id=" + m.id + " 曲目(" + ts.length + ") = " + ts.map((t) => t.title + "@" + t.position + "{exp:" + (t.contents?.[0]?.expression_id || "-") + "}").join("，"));
    }
  }
  return lines;
}

// ── 主流程 ───────────────────────────────────────────────────────────────
async function runPlan(id, dry) {
  const plan = PLANS[id];
  if (!plan) throw new Error("未在 PLANS 中登记条目 " + id);
  const sourceUrl = "https://bang-dream.com/discographies/" + id + "/";
  const citation = "bang-dream.com discography " + id + "：" + plan.headline;
  console.log("\n=== [" + id + "] " + plan.headline + " ===");
  const band = await ensureAgent(plan.band);
  const collection = await ensureCollection(COLLECTION_TITLE);
  const works = [];
  for (const song of plan.songs) {
    const w = await ensureSongWork(song.title, plan, sourceUrl, citation, dry);
    const exp = await ensureExpression(w, song.title, plan, sourceUrl, citation, dry);
    works.push({ ...song, work: w, expression: exp });
    await sleep(120);
  }
  for (const edition of plan.editions) {
    const rel = await ensureRelease(plan, edition, works.map((x) => x.work), sourceUrl, citation, dry);
    let pos = 0;
    for (const [title, format, hasTracks] of edition.media) {
      const med = await ensureMedium(rel, title, pos, format, plan, sourceUrl, citation, dry);
      if (hasTracks) {
        for (let i = 0; i < works.length; i++) {
          await ensureTrack(med, works[i].title, i, works[i].expression.id, plan, sourceUrl, citation, dry);
          await sleep(80);
        }
      }
      pos++;
      await sleep(80);
    }
    await sleep(120);
  }
  for (const w of works) {
    await ensureRelation("performed_by", w.work, band, "编目：" + plan.headline + "「" + w.title + "」由 " + plan.band + " 演唱", sourceUrl, citation, dry);
    await ensureRelation("includes", collection, w.work, "编目：" + plan.headline + "「" + w.title + "」归入 BanG Dream! 系列集合", sourceUrl, citation, dry);
    if (w.soundtrackOf) {
      const anime = await ensureAnime(w.soundtrackOf);
      await ensureRelation("soundtrack_of", w.work, anime, "编目：" + plan.headline + "「" + w.title + "」为官网明载的动画主题歌（" + w.soundtrackOf + "）", sourceUrl, citation, dry);
    }
    await sleep(80);
  }
  console.log("  —— 回读 ——");
  (await verifyPlan(plan)).forEach((l) => console.log(l));
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const ids = args.filter((a) => !a.startsWith("--"));
  if (!ids.length) { console.log("用法：node scripts/data/discography_batch.mjs [--dry|--verify] <官网条目id>…\n已登记：" + Object.keys(PLANS).join(" ")); return; }
  await login();
  for (const id of ids) {
    if (process.argv.includes("--verify")) {
      console.log("\n=== [verify " + id + "] " + PLANS[id].headline + " ===");
      (await verifyPlan(PLANS[id])).forEach((l) => console.log(l));
    } else {
      await runPlan(id, dry);
    }
  }
  console.log("\n统计：" + JSON.stringify(stats.created) + (stats.skipped.length ? " 跳过：" + stats.skipped.length : ""));
}

main().catch((e) => { console.error("失败：" + e.message); process.exit(1); });
