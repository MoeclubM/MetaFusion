#!/usr/bin/env node
// 从 Bushiroad Music 厂牌官网（bushiroad-music.com）补录发行版的「渠道特典」到 release.attributes.store_bonuses。
//
// 来源与形状（已实测）：
//   · 站内 slug 就是品番小写（例 brmm-10489）；REST：
//     GET https://bushiroad-music.com/wp-json/wp/v2/musics?slug=<品番小写>（必须带 User-Agent，否则被拒）。
//   · acf.d_contents 是「店舗別特典」区块的 HTML：以「▼店名」开一组，组内每行「限定版/通常盤：特典内容」为一条。
//     同一字段里还混有【収録内容】【初回生産分限定封入特典】等其它区块 —— 解析只取 ▼ 分组，遇到下一个【…】大标题即结束该分区。
//   · acf.d_displaydate（例「2022年1月5日(水)」）/ d_sortdate（ISO）只用于**交叉核对** edition_date，从不改写。
//   · 站上只收录同一商品的一个品番（另一个品番 HTML 直接 404）；曲目表在 HTML 与 acf 里都没有，本脚本不碰曲目。
//
// 写入口径（照 definitions 的 store_bonuses.items.fields 填，不新增子字段）：
//   · label      —— 多语言、必填：特典内容原文（ja-JP）
//   · condition  —— 版本条件原文（限定版 / 通常盤 / Blu-ray付生産限定盤 …）
//   · channel    —— 店铺名原文（▼ 后面的串）
//   · source_url —— 官网品番页
//   店铺名放 channel 而不是 store：store 是 entity(agent) 引用，站上没有这些零售店实体，
//   本脚本不越界新建实体（要改判 store 引用得先建 agent，属另一个任务）。
//   attachments 未写：官网只给特典示意图，没有包装同梱物信息。
//
// 边界：只改 attributes.store_bonuses，其余字段（题名 / translations / subjects / contents / pictures / external_ids …）
// 一律原样回传（PUT 是整实体替换）。幂等：目标值与解析结果逐字段一致即跳过，不产生空修订。
//
// 用法：
//   MF_USER_PASS=<口令> node scripts/data/bushiroad_music_bonuses.mjs                 # 写入全部命中的发行版
//   MF_USER_PASS=<口令> node scripts/data/bushiroad_music_bonuses.mjs --verify        # 只读：打印将写入的内容与日期核对
//   MF_USER_PASS=<口令> node scripts/data/bushiroad_music_bonuses.mjs --only BRMM-10489,BRMM-10801   # 逗号分隔，可分批
// 环境：MF_BASE（默认 https://findverse.cc）、MF_USER（默认 curator01）；口令只从环境变量读，不落盘。

const BASE = process.env.MF_BASE || "https://findverse.cc";
const USER = process.env.MF_USER || "curator01";
const PASS = process.env.MF_USER_PASS;
const SITE = "https://bushiroad-music.com";
const CITATION = "Bushiroad Music 官方品番页";
const UA = { "User-Agent": "MetaFusion-Catalog/1.0 (https://findverse.cc; curator01)", Accept: "application/json" };

const argv = process.argv.slice(2);
const VERIFY = argv.includes("--verify");
// --only 支持逗号分隔（品番或实体 id），便于分批跑
const ONLY = (() => {
  const i = argv.indexOf("--only");
  if (i < 0) return [];
  return String(argv[i + 1] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── HTTP（站内 API 要令牌；官网要 UA，429/5xx/网络抖动一律退避重试）────────────
let token = "";
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
  if (r.status !== 200 || !r.body?.token) throw new Error("登录失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
  token = r.body.token;
  const me = await api("/api/auth/me");
  console.log("已登录 " + me.username + "（role=" + me.role + "）");
}

// REST 命中不了时再问一次 HTML 页面状态，把"官网没收录这个品番"与"接口漏了"区分开
async function htmlStatus(slug, retry = 0) {
  try {
    const res = await fetch(SITE + "/musics/" + slug + "/", { headers: UA });
    return res.status;
  } catch (e) {
    if (retry < 3) { await sleep(600 * (retry + 1)); return htmlStatus(slug, retry + 1); }
    return -1;
  }
}

async function wpMusics(slug, retry = 0) {
  try {
    const res = await fetch(SITE + "/wp-json/wp/v2/musics?slug=" + encodeURIComponent(slug), { headers: UA });
    if (res.status === 429 || res.status >= 500) throw new Error("http " + res.status);
    const body = await res.json().catch(() => null);
    return { status: res.status, post: Array.isArray(body) ? body[0] || null : null };
  } catch (e) {
    if (retry < 4) { await sleep(700 * (retry + 1)); return wpMusics(slug, retry + 1); }
    return { status: -1, error: String(e).slice(0, 120), post: null };
  }
}

// 列表接口把 limit 截到 50，靠 total + offset 翻页
async function listAllReleases() {
  const out = [];
  for (let offset = 0; ; offset += 50) {
    const r = await api("/api/catalog/entities?kind=release&limit=50&offset=" + offset);
    const items = r.items || [];
    out.push(...items);
    const total = typeof r.total === "number" ? r.total : out.length;
    if (items.length < 50 || out.length >= total) break;
  }
  return out.sort((a, b) => String(a.attributes?.catalog_number || "").localeCompare(String(b.attributes?.catalog_number || "")));
}

// ── 解析 d_contents ───────────────────────────────────────────────────────
const NAMED = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", times: "×", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", middot: "·", yen: "¥" };
function decodeEntities(s) {
  return String(s)
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n.toLowerCase()] ?? m);
}
function htmlToLines(html) {
  const text = decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h[1-6]|div|li|ul|ol|tr|td|section|article)>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  );
  return text.split("\n").map((l) => l.replace(/[\u3000\s]+/g, " ").trim()).filter(Boolean);
}
// 「▼店名」开一组；组内「条件：内容」为一条；条件缺失时按原文整行记为内容（官网确有这样的行）。
function parseStoreBonuses(html) {
  const recs = [];
  let store = null;
  for (const line of htmlToLines(html)) {
    if (line.startsWith("▼")) { store = line.replace(/^▼\s*/, "").trim(); continue; }
    if (store === null) continue;                                  // 还没进入店舗别分区（収録内容 / 封入特典 …）
    if (/^【.*】$/.test(line)) { store = null; continue; }           // 下一个大标题 → 分区结束
    if (/^[※*]/.test(line)) continue;                              // 注记（特典获取条件、随机封入说明…）
    const m = line.match(/^([^：:]{1,30})[：:]\s*(.+)$/);
    recs.push(m ? { store, condition: m[1].trim(), content: m[2].trim() } : { store, condition: "", content: line });
  }
  return recs;
}
function buildRecords(parsed, slug) {
  const url = SITE + "/musics/" + slug + "/";
  return parsed.map((p) => {
    const rec = { label: { "ja-JP": p.content } };
    if (p.condition) rec.condition = p.condition;
    if (p.store) rec.channel = p.store;
    rec.source_url = url;
    return rec;
  });
}
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = canon(v[k]); return o; }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

// ── 日期交叉核对（只报不改）───────────────────────────────────────────────
function officialDate(post) {
  const d = post?.acf?.d_displaydate || "";
  const m = String(d).match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) return { iso: m[1] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[3]).padStart(2, "0"), display: d };
  const s = String(post?.acf?.d_sortdate || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return s ? { iso: s[1], display: d || s[1] } : null;
}

// ── 主流程 ───────────────────────────────────────────────────────────────
const results = { written: [], planned: [], unchanged: [], failed: [], uncovered: [], dateOk: 0, dateMismatch: [], noDate: 0 };

async function processRelease(rel) {
  const cn = String(rel.attributes?.catalog_number || "").trim();
  const label = rel.title + "（" + (cn || "无品番") + "）";
  if (!cn) { results.uncovered.push({ id: rel.id, title: rel.title, reason: "发行版没有 catalog_number，无从匹配官网品番" }); return; }
  const slug = cn.toLowerCase();
  const { status, post, error } = await wpMusics(slug);
  if (error) { results.failed.push({ id: rel.id, title: label, reason: "官网请求失败：" + error }); return; }
  if (!post) {
    const html = await htmlStatus(slug);
    results.uncovered.push({
      id: rel.id, title: label,
      reason: html === 404
        ? "官网未收录该品番（REST slug 无结果 + 页面 404）"
        : "官网页面 HTTP " + html + " 但 REST slug 无对应 post（异常，需人工确认）",
    });
    return;
  }
  const parsed = parseStoreBonuses(post.acf?.d_contents || "");
  if (!parsed.length) {
    results.uncovered.push({ id: rel.id, title: label, reason: "官网品番页存在，但 d_contents 未以文本给出店舗別特典条目（多为整张图片）", url: SITE + "/musics/" + slug + "/" });
    return;
  }
  const desired = buildRecords(parsed, slug);
  const stores = [...new Set(parsed.map((p) => p.store))];

  // 日期核对
  const od = officialDate(post);
  const ed = String(rel.attributes?.edition_date || "");
  let dateLine = "";
  if (!od) { results.noDate++; dateLine = "官网无发售日，无法核对"; }
  else if (od.iso === ed) { results.dateOk++; dateLine = "官网 " + od.display + " 与 edition_date " + od.iso + " 一致"; }
  else { results.dateMismatch.push({ id: rel.id, title: label, official: od.iso + "（" + od.display + "）", site: ed || "(空)" }); dateLine = "不一致：官网 " + od.iso + " / 站上 " + (ed || "(空)") + "，未改动"; }

  const before = rel.attributes?.store_bonuses;
  if (same(before, desired)) {
    results.unchanged.push({ id: rel.id, title: label, count: desired.length, stores: stores.length });
    console.log("  = 已一致 " + label + " —— " + desired.length + " 条 / " + stores.length + " 店（跳过写入）");
    return;
  }
  if (VERIFY) {
    results.planned.push({ id: rel.id, title: label, count: desired.length, stores: stores.length });
    console.log("  ~ [verify] " + label + " 将写 " + desired.length + " 条 / " + stores.length + " 店；" + dateLine);
    if (before) console.log("    ! 现有 store_bonuses 非空（" + (before.length || 0) + " 条），将被整组替换");
    return;
  }

  // 整实体回传：先读全量（带 version），只改 store_bonuses
  const full = await api("/api/catalog/entities/" + rel.id);
  const next = { ...full, attributes: { ...(full.attributes || {}), store_bonuses: desired } };
  const note = "补录渠道特典（store_bonuses）：取自 Bushiroad Music 官方品番页 " + slug + " 的「店舗別特典」清单" +
    "（REST /wp-json/wp/v2/musics?slug=" + slug + " 的 acf.d_contents 逐条对应，共 " + desired.length + " 条 / " + stores.length + " 家店铺）；" +
    "本次只写 store_bonuses，题名 / subjects / contents / 其它属性未改；发售日交叉核对：" + dateLine + "。";
  const r = await raw("/api/catalog/entities/" + rel.id, {
    method: "PUT",
    body: JSON.stringify({ entity: next, expected_version: full.version, edit_note: note, sources: [{ kind: "url", url: SITE + "/musics/" + slug + "/", citation: CITATION }] }),
  });
  if (r.status >= 400) { results.failed.push({ id: rel.id, title: label, reason: "PUT " + r.status + " " + JSON.stringify(r.body).slice(0, 300) }); console.log("  ✗ " + label + " 写入失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 200)); return; }

  // 写完立刻回读核对
  const back = await api("/api/catalog/entities/" + rel.id);
  const ok = same(back.attributes?.store_bonuses, desired);
  results.written.push({ id: rel.id, title: label, count: desired.length, stores: stores.length, version: back.version, verified: ok, dateLine });
  console.log("  + " + label + " 写入 " + desired.length + " 条 / " + stores.length + " 店，回读" + (ok ? "一致 ✓" : "不一致 ✗") + "；" + dateLine);
  if (!ok) results.failed.push({ id: rel.id, title: label, reason: "回读与写入不一致" });
}

async function main() {
  console.log("目标实例 " + BASE + "；模式 " + (VERIFY ? "只读核对（--verify）" : "写入") + (ONLY.length ? "；只处理 " + ONLY.join(",") : ""));
  if (!VERIFY) await login();
  const releases = await listAllReleases();
  const targets = ONLY.length
    ? releases.filter((r) => ONLY.includes(r.id.toLowerCase()) || ONLY.includes(String(r.attributes?.catalog_number || "").toLowerCase()))
    : releases;
  console.log("站上发行版 " + releases.length + " 个；本次处理 " + targets.length + " 个\n");
  for (const rel of targets) await processRelease(rel);

  console.log("\n=== 汇总 ===");
  const covered = results.written.length + results.unchanged.length + results.planned.length;
  const records = [...results.written, ...results.unchanged, ...results.planned].reduce((a, x) => a + (x.count || 0), 0);
  console.log("发行版总数 " + releases.length + "；命中 " + covered + "（" + (VERIFY ? "待写 " + results.planned.length
    : "写入 " + results.written.length) + "；已一致跳过 " + results.unchanged.length + "）；未覆盖 " + results.uncovered.length + "；失败 " + results.failed.length);
  console.log("覆盖发行版 " + covered + " 个；" + (VERIFY ? "涉及" : "写入") + "特典记录 " + records + " 条");
  console.log("日期核对：一致 " + results.dateOk + "；不一致 " + results.dateMismatch.length + "；官网无发售日 " + results.noDate);
  for (const m of results.dateMismatch) console.log("  ! " + m.title + "：官网 " + m.official + " / 站上 " + m.site);
  console.log("\n未覆盖清单：");
  for (const u of results.uncovered) console.log("  - " + u.title + "： " + u.reason + (u.url ? " " + u.url : ""));
  if (results.failed.length) {
    console.log("\n失败：");
    for (const f of results.failed) console.log("  x " + f.title + "： " + f.reason);
    process.exitCode = 1;
  }
}

await main();
