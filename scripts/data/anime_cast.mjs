#!/usr/bin/env node
// 给 BanG Dream! 系列影像作品补角色与声优：
//   Bangumi v0 GET /subjects/{id}/characters → agent(character / person) + character_in / voiced_by 关系。
//
// 幂等：实体按「题名 + 类型」查重后复用；关系按「type + 两端 + attributes.character」查重后跳过；
//       创建请求带 Idempotency-Key（24h 内同键返回首创结果）。重复运行不会造重复实体或重复边。
// 用法：MF_USER_PASS=<口令> node scripts/data/anime_cast.mjs                 # 干跑：只打印计划
//       MF_USER_PASS=<口令> node scripts/data/anime_cast.mjs --apply       # 写入
//       MF_USER_PASS=<口令> node scripts/data/anime_cast.mjs --verify      # 回读校验（不写）
//       …（可加作品筛选词，如 --apply MyGO / --apply 01a0a82b）
// 环境：MF_BASE（默认 https://findverse.cc）、MF_USER（默认 curator01）
// 凭据只从环境变量读，不落盘。
//
// 考据口径（官网优先、官网没有才用 Bangumi，且写明"官网无此数据"的原因）：
//   · 官网 bang-dream.com 的作品页/Anime 列表只公开乐队与主役阵容（各乐队成员表），
//     不逐条公开配角、路人角色与「角色 ↔ 声优」的完整对应 → 角色表与声优对应按 Bangumi 条目补充，
//     并在实体 sources 与关系 sources 里注明来源是 Bangumi 及其条目号。
//   · 只在 Bangumi 有角色/声优数据时写；Bangumi 条目本身缺 actor 的行一律跳过（宁缺勿错）。
//
// 关系方向（照站上既有做法，不猜）：读站上既有边得到——
//   character_in：source = 角色 agent，target = work，attributes.character_rank
//   voiced_by   ：source = work，target = 声优 agent，attributes.character = 角色 agent id（+ language）
//   即「作品 —voiced_by→ 声优」，角色用属性挂载；本脚本沿用该形状。

const BASE = process.env.MF_BASE || "https://findverse.cc";
const USER = process.env.MF_USER || "curator01";
const PASS = process.env.MF_USER_PASS;
const BGM_UA = process.env.MF_BGM_UA || "MetaFusionBot/0.1 (https://findverse.cc; catalog curation)";
const BGM_CACHE = process.env.MF_BGM_CACHE || "";

// ── 作品 ↔ Bangumi 条目对照 ──────────────────────────────────────────────
// siteId 取自站上已发布的 Work（标题同时登记，回读核对不上就报错停下）。
// bgm 是**一个或多个** Bangumi 条目：站上把「Episode of Roselia Ⅰ/Ⅱ」「MyGO 前編/後編」各合成了一个 Work，
// 所以一个 Work 取多条目的角色表并集。条目号经 POST /v0/search/subjects（type=2）与条目名/开播日逐条核对。
const WORKS = [
  { key: "tv1",        siteId: "01a0a82b-97a4-78fd-8569-60c6941cc79e", title: "BanG Dream!（バンドリ！）", bgm: [186515], label: "TV 动画第 1 期（2017）" },
  { key: "tv2",        siteId: "01a0a813-926f-71bc-a55e-d14f979b67ce", title: "BanG Dream! 2nd Season", bgm: [246429], label: "TV 动画 2nd Season（2019）" },
  { key: "tv3",        siteId: "01a0a813-baa8-78ed-aceb-41b3f0e7271b", title: "BanG Dream! 3rd Season", bgm: [246430], label: "TV 动画 3rd Season（2020）" },
  { key: "mujica",     siteId: "01a0a813-e2a1-7cb5-8a94-439a35bea98f", title: "BanG Dream! Ave Mujica", bgm: [454684], label: "TV 动画 Ave Mujica（2025）" },
  { key: "mygo",       siteId: "01a0a7e4-86c1-7969-9c17-7d764794576f", title: "BanG Dream! It's MyGO!!!!!", bgm: [428735], label: "TV 动画 It's MyGO!!!!!（2023）" },
  { key: "pico",       siteId: "01a0a82b-bf44-7039-8057-9d65e68c6af2", title: "BanG Dream! ガルパ☆ピコ", bgm: [246431], label: "TV 短篇动画 ガルパ☆ピコ（2018）" },
  { key: "pico-omori", siteId: "01a0a835-b3dd-722d-b157-025089aedc07", title: "BanG Dream! ガルパ☆ピコ ～大盛り～", bgm: [296295], label: "TV 短篇动画 ガルパ☆ピコ ～大盛り～（2020）" },
  { key: "pico-fever", siteId: "01a0a835-dcbc-7733-802e-79c96926043b", title: "BanG Dream! ガルパ☆ピコ ふぃーばー！", bgm: [338400], label: "TV 短篇动画 ガルパ☆ピコ ふぃーばー！（2021）" },
  { key: "morfonica",  siteId: "01a0a82b-e6a5-7998-9acd-d4b84f7ebd98", title: "BanG Dream! Morfonication", bgm: [385928], label: "TV 短篇动画 Morfonication（2022）" },
  { key: "genso",      siteId: "01a0a82c-0fc0-765d-ace5-95133ef38e05", title: "元祖！バンドリちゃん", bgm: [540449], label: "TV 短篇动画 元祖！バンドリちゃん（2025）" },
  { key: "yumemita",   siteId: "01a0a836-03ae-7b50-b99e-7c7c092046e4", title: "バンドリ！ ゆめ∞みた", bgm: [583729], label: "TV 动画 バンドリ！ ゆめ∞みた（2025）" },
  { key: "film-roselia", siteId: "01a0a838-7477-7928-8346-800f9d338fb5", title: "劇場版「BanG Dream! Episode of Roselia Ⅰ : 約束 / Ⅱ : Song I am.」", bgm: [305058, 315490], label: "剧场版 Episode of Roselia Ⅰ/Ⅱ（2021）" },
  { key: "film-mygo",  siteId: "01a0a838-4dfd-7402-abb7-aedf7cc6fc80", title: "劇場版「BanG Dream! It's MyGO!!!!! 前編 : 春の陽だまり、迷い猫 / 後編 : うたう、僕らになれるうた & FILM LIVE」", bgm: [473832, 473833], label: "剧场版 It's MyGO!!!!! 前編/後編（2024）" },
  { key: "film-popipa", siteId: "01a0a838-9965-756b-b2b4-b6d201ea7920", title: "劇場版「BanG Dream! ぽっぴん'どりーむ！」", bgm: [305059], label: "剧场版 ぽっぴん'どりーむ！（2022）" },
  { key: "film-prima", siteId: "01a0a838-2725-7dcc-a3ef-ef7e5bad93d0", title: "映画「BanG Dream! Ave Mujica prima aurora」", bgm: [578262], label: "剧场版 Ave Mujica prima aurora（2026）" },
];

// Bangumi 的 relation → 站上 character_rank 词项码。
// 「闲角」（无名小角色）在站上词表（主人公/脇役/客串/彩蛋登场/群像/旁白）里没有对应项 → 留空，不硬套。
const RANK = { "主角": "main", "配角": "supporting", "客串": "guest", "旁白": "narrator" };
const RANK_PRIORITY = { main: 0, supporting: 1, narrator: 2, guest: 3, "": 4 };

// 通用角色（路人 / 旁白 / 群体条目）不建实体：它们在目录里是噪声，且 Bangumi 侧也只是占位条目。
const SKIP_NAMES = new Set([
  "ナレーション", "アナウンス", "モブキャラクター", "MyGO!!!!!", "CRYCHIC", "マネージャー", "A子",
  "女子生徒", "店員", "学長", "教師", "編集者", "ファンA", "ファンB", "スタッフ", "生徒", "観客",
  "先生", "お客", "コメントの声", "社員A", "社員B", "社員C", "客A", "客B", "通行人A", "通行人B",
  "通行人C", "通行人D", "チキンサンド屋", "園児A", "園児B", "園児C", "園児D", "園児E",
  "中学校の先生", "インタビュアー",
]);
const SKIP_PATTERN = /の(母|父)$/; // 「愛音の母」这类亲属代称：不是角色名，留空不建

// Bangumi 把「Ave Mujica 代号 / 本名」拆成两条角色行，但站上先建的实体是代号 → 本名行复用该实体，
// 避免同一角色两个实体（同一 subject 内两行的 actor 相同，可互证是同一角色）。
const CHARACTER_ALIAS = {
  "豊川祥子": "オブリビオニス",
  "若葉睦": "モーティス",
  "三角初華": "ドロリス",
  "八幡海鈴": "ティモリス",
  "祐天寺にゃむ": "アモーリス",
};

// ── HTTP ────────────────────────────────────────────────────────────────
let token = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function raw(path, opts = {}, retry = 0) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, { ...opts, headers });
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
  if (r.status !== 200) throw new Error("登录失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
  token = r.body.token || r.body.access_token;
  const me = await api("/api/auth/me");
  console.log("已登录 " + me.username + "（" + (me.groups || []).join(",") + "）");
}

async function bgm(path, retry = 0) {
  const res = await fetch("https://api.bgm.tv" + path, { headers: { "User-Agent": BGM_UA } });
  if ((res.status === 429 || res.status >= 500) && retry < 6) { await sleep(1500 * (retry + 1)); return bgm(path, retry + 1); }
  if (res.status >= 400) throw new Error("Bangumi " + path + " -> " + res.status);
  return res.json();
}

const bgmCache = new Map();
async function bgmCharacters(subjectId) {
  const key = String(subjectId);
  if (bgmCache.has(key)) return bgmCache.get(key);
  const list = await bgm("/v0/subjects/" + key + "/characters");
  bgmCache.set(key, list);
  await sleep(350); // Bangumi 限流：逐条取即可，别并发打
  return list;
}

// ── 目录读写 ─────────────────────────────────────────────────────────────
async function listKind(kind) {
  const out = [];
  let off = 0, total = Infinity;
  while (out.length < total) {
    const r = await api("/api/catalog/entities?kind=" + kind + "&limit=50&offset=" + off);
    total = typeof r.total === "number" ? r.total : out.length + (r.items || []).length;
    out.push(...(r.items || []));
    if (!(r.items || []).length) break;
    off += 50;
  }
  return out;
}

async function getEntity(id) { return api("/api/catalog/entities/" + id); }
async function relationsOf(id) { const r = await api("/api/catalog/entities/" + id + "/relations"); return r.items || []; }

function evidence(note, url, citation) { return { edit_note: note, sources: [{ kind: "url", url, citation }] }; }

async function createEntity(entity, note, url, citation) {
  const body = { entity, expected_version: 0, ...evidence(note, url, citation) };
  // Idempotency-Key 只能是 ASCII（汉字题名直接进 header 会抛 ByteString 错误）：改成百分号编码
  const r = await raw("/api/catalog/entities", { method: "POST", headers: { "Idempotency-Key": "cast-entity-" + entity.kind + "-" + encodeURIComponent(entity.title) }, body: JSON.stringify(body) });
  if (r.status >= 400) throw new Error("创建 " + entity.kind + "「" + entity.title + "」失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 300));
  return r.body;
}

async function createRelation(type, sourceId, targetId, position, attributes, note, url, citation) {
  const body = { relation: { type, source_id: sourceId, target_id: targetId, position, attributes }, expected_version: 0, ...evidence(note, url, citation) };
  const key = "cast-rel-" + type + "-" + sourceId + "-" + targetId + "-" + encodeURIComponent(attributes.character || attributes.character_rank || "n");
  const r = await raw("/api/catalog/relations", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
  if (r.status >= 400) throw new Error("创建关系 " + type + " 失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 300));
  return r.body;
}

// ── 计划 ────────────────────────────────────────────────────────────────
function parts(name) { return String(name).split(" / ").map((s) => s.trim()).filter(Boolean); }

function buildPlan(list, work) {
  // 一份「角色 → 声优」计划：Bangumi 一个 subject 里同一角色可能有多行（本的代号行 + 本名行、
  // 主角行 + 闲角行），这里按角色合并：番位取最高的一条，声优取并集。
  const entries = [];
  const byKey = new Map();
  const skipped = [];
  for (const subjectId of work.bgm) {
    for (const c of (list[String(subjectId)] || [])) {
      const names = parts(c.name);
      if (names.some((n) => SKIP_NAMES.has(n)) || SKIP_PATTERN.test(c.name)) { skipped.push(c.name + "（通用角色）"); continue; }
      const alias = CHARACTER_ALIAS[c.name];
      const pool = alias ? [alias, ...names] : names;
      const rank = RANK[c.relation] || "";
      const key = pool[0]; // 展示/落库以第一个可用题名为准（Ave Mujica 代号优先）
      let e = byKey.get(key);
      if (!e) { e = { key, candidateNames: pool, rank, relations: [c.relation], actors: [] }; byKey.set(key, e); entries.push(e); }
      else if ((RANK_PRIORITY[rank] ?? 9) < (RANK_PRIORITY[e.rank] ?? 9)) { e.rank = rank; }
      e.relations.push(c.relation);
      for (const a of (c.actors || [])) if (!e.actors.some((x) => x.name === a.name)) e.actors.push({ name: a.name, id: a.id, images: a.images || null });
    }
  }
  return { entries, skipped };
}

// ── 主流程 ───────────────────────────────────────────────────────────────
const stats = { charNew: 0, charReuse: 0, personNew: 0, personReuse: 0, ciNew: 0, ciReuse: 0, vbNew: 0, vbReuse: 0, picNew: 0, picSkip: 0, skipped: [] };

async function resolveAgent(agents, title, type) {
  const same = agents.filter((a) => a.title === title);
  return same.find((a) => (a.types || []).includes(type)) || null;
}

// 「一次拉全量 + 分页」在并发写入下会漏项（本站常有多个代理同时写），创建前再用题名检索确认一次：
// 命中即复用，否则会造出同名同类型的第二个实体（实测踩到过一次：工藤晴香）。
async function resolveAgentDeep(agents, title, type) {
  const hit = await resolveAgent(agents, title, type);
  if (hit) return hit;
  const r = await api("/api/catalog/entities?kind=agent&q=" + encodeURIComponent(title) + "&limit=50");
  const found = (r.items || []).find((x) => x.title === title && (x.types || []).includes(type));
  if (found) agents.push(found);
  return found || null;
}

async function runWork(work, dry) {
  const agents = await listKind("agent");
  const entity = await getEntity(work.siteId);
  if (entity.title !== work.title) throw new Error("作品 " + work.siteId + " 题名不符：期望「" + work.title + "」实际「" + entity.title + "」");

  console.log("\n=== [" + work.key + "] " + work.label + " ===\n    " + work.title + "  bgm=" + work.bgm.join("+") + "  id=" + work.siteId.slice(0, 8));
  const list = {};
  for (const sid of work.bgm) list[String(sid)] = await bgmCharacters(sid);
  const plan = buildPlan(list, work);
  const rows = work.bgm.reduce((n, s) => n + (list[String(s)] || []).length, 0);
  console.log("    Bangumi 角色行 " + rows + "，合并后角色 " + plan.entries.length + "（有声优 " + plan.entries.filter((e) => e.actors.length).length + "），跳过通用行 " + plan.skipped.length);

  const bgmUrl = "https://bgm.tv/subject/" + work.bgm[0];
  const citation = "Bangumi 条目 " + work.bgm.join("/") + " 角色/声优表（v0 API /subjects/" + work.bgm.join(",") + "/characters）";
  const why = "；官网 bang-dream.com 的作品页只公开乐队与主役阵容，未逐条公开配角与角色↔声优对应 → 官网无此数据，改用 Bangumi 补充";

  // 1) 实体：角色 + 声优（角色按题名 + 类型查重，命中即复用，不造重复实体）
  const made = [];
  for (const e of plan.entries) {
    let character = null;
    for (const name of e.candidateNames) { character = await resolveAgentDeep(agents, name, "character"); if (character) break; }
    if (!character) {
      const name = e.candidateNames[0];
      if (dry) { console.log("      · [dry] 建角色 " + name); character = { id: "DRY-C-" + name, title: name }; }
      else {
        character = await createEntity({ kind: "agent", title: name, original_language: "ja", types: ["character"], translations: { "ja-JP": { title: name } }, status: "published" },
          "编目：" + work.label + " 的角色「" + name + "」（Bangumi 条目 " + work.bgm.join("/") + " 角色表，" + e.relations.join("/") + "）" + why, bgmUrl, citation);
        agents.push(character);
      }
      stats.charNew++;
    } else stats.charReuse++;

    const people = [];
    for (const a of e.actors) {
      let person = await resolveAgentDeep(agents, a.name, "person");
      if (!person) {
        if (dry) { console.log("      · [dry] 建声优 " + a.name + "（Bangumi person " + a.id + "）"); person = { id: "DRY-P-" + a.name, title: a.name }; }
        else {
          person = await createEntity({ kind: "agent", title: a.name, original_language: "ja", types: ["person"], translations: { "ja-JP": { title: a.name } }, status: "published" },
            "编目：声优「" + a.name + "」（Bangumi 条目 " + work.bgm.join("/") + " 角色表在案，担当「" + character.title + "」）" + why, bgmUrl, citation);
          agents.push(person);
        }
        stats.personNew++;
      } else stats.personReuse++;
      people.push(person);
    }
    made.push({ entry: e, character, people });
  }

  // 2) 关系：character_in（角色→作品）+ voiced_by（作品→声优，attributes.character 指角色；方向照站上既有边）
  const workRels = await relationsOf(work.siteId);
  let position = 0;
  for (const m of made) {
    const note = "编目：" + work.label + " 的角色「" + m.character.title + "」登场（Bangumi relation=" + m.entry.relations.join("/") + "）" + why;
    const attrs = m.entry.rank ? { character_rank: m.entry.rank } : {};
    const ciExists = workRels.some((x) => x.type === "character_in" && x.source_id === m.character.id && x.target_id === work.siteId);
    if (ciExists) stats.ciReuse++;
    else if (dry) { console.log("    · [dry] character_in " + m.character.title + " → 作品（rank=" + (m.entry.rank || "空") + "）"); stats.ciNew++; }
    else { await createRelation("character_in", m.character.id, work.siteId, position, attrs, note, bgmUrl, citation + why); stats.ciNew++; await sleep(150); }

    for (const p of m.people) {
      const vbAttrs = { character: m.character.id, language: "ja" };
      const exists = workRels.some((x) => x.type === "voiced_by" && x.source_id === work.siteId && x.target_id === p.id
        && x.attributes && x.attributes.character === m.character.id);
      if (exists) stats.vbReuse++;
      else if (dry) { console.log("    · [dry] voiced_by 作品 → " + p.title + "（角色 " + m.character.title + "）"); stats.vbNew++; }
      else { await createRelation("voiced_by", work.siteId, p.id, 0, vbAttrs, note, bgmUrl, citation + why); stats.vbNew++; await sleep(150); }
    }
    position++;
  }
  stats.skipped.push(...plan.skipped.map((s) => work.key + ": " + s));
  return { work, made, skipped: plan.skipped };
}

// ── 声优头像（可选模式，只在 Bangumi 有条目图且 URL 实测可用时写入） ────────
// 官网没有「声优个人照片」页（artist 页只发布角色立绘），因此这一项也来自 Bangumi；
// 外部图一律先 HEAD 验可达（官网图在浏览器里会被 ORB 拦，Bangumi 的 lain.bgm.tv 不会）。
async function headImageOk(url) {
  try {
    const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": BGM_UA } });
    return r.status === 200 && /^image\//.test(r.headers.get("content-type") || "");
  } catch { return false; }
}

async function putEntity(entity, note, url, citation) {
  const body = { entity, expected_version: entity.version, ...evidence(note, url, citation) };
  const r = await raw("/api/catalog/entities/" + entity.id, { method: "PUT", body: JSON.stringify(body) });
  if (r.status >= 400) throw new Error("更新 " + entity.id + " 失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 300));
  return r.body;
}

async function addPictures(work, dry) {
  const list = {};
  for (const sid of work.bgm) list[String(sid)] = await bgmCharacters(sid);
  const agents = await listKind("agent");
  const plan = buildPlan(list, work);
  console.log("=== [pictures] " + work.title);
  const seen = new Set();
  for (const e of plan.entries) {
    for (const a of e.actors) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      const person = await resolveAgentDeep(agents, a.name, "person");
      if (!person) { console.log("  · 无声优实体（跳过）：" + a.name); continue; }
      const full = await getEntity(person.id);
      if ((full.pictures || []).length) continue; // 已有头像（多为官网/前几轮补的）：不动
      const url = (a.images && (a.images.large || a.images.medium)) || "";
      if (!url) { console.log("  · Bangumi 条目无图，留空：" + a.name); stats.picSkip++; continue; }
      if (!(await headImageOk(url))) { console.log("  ! 图片 URL 不可达，跳过：" + a.name + " " + url); stats.picSkip++; continue; }
      if (dry) { console.log("  · [dry] 补头像 " + a.name + " ← " + url); stats.picNew++; continue; }
      const pics = [{ url, caption: {}, taken_at: "", source: { kind: "url", url: "https://bgm.tv/person/" + a.id, citation: "Bangumi 人物条目头像（官网无该声优个人照片页）" } }];
      await putEntity({ ...full, pictures: pics },
        "编目：补声优「" + a.name + "」头像——来源 Bangumi 人物条目 " + a.id + "（官网 artist 页只发布角色立绘，无该声优照片）；URL 已 HEAD 验可达",
        "https://bgm.tv/person/" + a.id, "Bangumi 人物条目");
      stats.picNew++;
      await sleep(200);
    }
  }
}

async function verifyWork(work) {
  const rels = await relationsOf(work.siteId);
  const ci = rels.filter((r) => r.type === "character_in" && r.target_id === work.siteId);
  const vb = rels.filter((r) => r.type === "voiced_by" && r.source_id === work.siteId);
  const missingVoice = vb.filter((r) => !ci.some((c) => c.source_id === (r.attributes || {}).character));
  const dup = {};
  for (const r of vb) { const k = r.target_id + "|" + ((r.attributes || {}).character || "-"); dup[k] = (dup[k] || 0) + 1; }
  const dupCount = Object.values(dup).filter((n) => n > 1).length;
  console.log("=== [" + work.key + "] " + work.title);
  console.log("    character_in=" + ci.length + "  voiced_by=" + vb.length + "  无对应 character_in 的 voiced_by=" + missingVoice.length + "  重复(声优,角色)对=" + dupCount);
  const byChar = new Map();
  for (const r of ci) byChar.set(r.source_id, { rank: (r.attributes || {}).character_rank || "", voice: [] });
  for (const r of vb) { const c = (r.attributes || {}).character; if (byChar.has(c)) byChar.get(c).voice.push(r.target_id); }
  const agents = await listKind("agent");
  const name = (id) => (agents.find((a) => a.id === id) || {}).title || id.slice(0, 8);
  const lines = [...byChar.entries()].map(([id, v]) => name(id) + "[" + (v.rank || "无番位") + "]" + (v.voice.length ? "←" + v.voice.map(name).join("+") : "（无声优）"));
  console.log("    " + lines.join("  /  "));
  return { ci: ci.length, vb: vb.length, missingVoice: missingVoice.length, dupCount };
}

async function main() {
  const args = process.argv.slice(2);
  const verify = args.includes("--verify");
  const pictures = args.includes("--pictures");
  const dry = !args.includes("--apply"); // 除 --apply 外一律干跑：--pictures 不带 --apply 也只打印
  const filters = args.filter((a) => !a.startsWith("--"));
  const works = filters.length ? WORKS.filter((w) => filters.some((f) => w.key.includes(f) || w.title.includes(f) || w.siteId.startsWith(f))) : WORKS;
  if (!works.length) throw new Error("没有匹配的作品：" + filters.join(","));
  await login();
  if (verify) {
    for (const w of works) await verifyWork(w);
    return;
  }
  if (pictures) {
    for (const w of works) await addPictures(w, dry);
    console.log("\n头像统计：" + JSON.stringify({ picNew: stats.picNew, picSkip: stats.picSkip }));
    return;
  }
  console.log((dry ? "[干跑] " : "[写入] ") + works.length + " 部作品：" + works.map((w) => w.key).join(", "));
  for (const w of works) await runWork(w, dry);
  console.log("\n统计：" + JSON.stringify(stats));
  if (stats.skipped.length) console.log("跳过通用/无源角色行 " + stats.skipped.length + " 条（示例：" + stats.skipped.slice(0, 8).join("，") + "）");
}

main().catch((e) => { console.error("失败：" + e.message); process.exit(1); });
