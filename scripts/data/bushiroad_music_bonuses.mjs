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
//   · 兄弟品番回填：同一商品页把两版条件都列全（例 brmm-10759 页上「Blu-ray付生産限定盤」「通常盤」成对出现），
//     且 acf.d_description 的【品番】区块给出官方「版本名：品番」对应（Blu-ray付生産限定盤：BRMM-10759 / 通常盤：BRMM-10760）。
//     本版官网无页面、或本版页没有 ▼ 分组文本时，把兄弟页清单里**条件命中本版版本名**的行写到本版：
//     条件按「/」拆成段逐一比对，逐段等值才算命中（「Blu-ray付生産限定盤/通常盤」两版都命中）；
//     整行没有「条件：」的行不写（原文没写版本，无法归属）；本版已有 store_bonuses 的一律不覆盖。
//     兄弟页没有官方【品番】对应证据（也无 d_pnumber 佐证）时一律不回填；
//     兄弟页必须**成对列出**两版条件（页面上得有属于其它版本的行），只列单版的不回填 —— 无从区分。
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
//   兄弟品番回填默认开启（--no-siblings 关闭）；--verify 下同样只预演不写入。
// 环境：MF_BASE（默认 https://findverse.cc）、MF_USER（默认 curator01）；口令只从环境变量读，不落盘。

const BASE = process.env.MF_BASE || "https://findverse.cc";
const USER = process.env.MF_USER || "curator01";
const PASS = process.env.MF_USER_PASS;
const SITE = "https://bushiroad-music.com";
const CITATION = "Bushiroad Music 官方品番页";
const UA = { "User-Agent": "MetaFusion-Catalog/1.0 (https://findverse.cc; curator01)", Accept: "application/json" };

const argv = process.argv.slice(2);
const VERIFY = argv.includes("--verify");
const SIBLINGS = !argv.includes("--no-siblings");   // 本版官网无页面时用兄弟品番页回填（默认开）
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
// ── 兄弟品番回填：证据与筛选 ───────────────────────────────────────────────
// d_description 的【品番】区块是官方给出的「版本名：品番」对应，用它把本版品番钉到某个版本条件上。
function plainDescription(html) {
  return decodeEntities(String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "))
    .replace(/<[^>]*>/g, "")                       // 解码后仍有 &lt;…&gt; 形式的伪标签
    .replace(/[ \t\u3000]+/g, " ")
    .trim();
}
function officialEditionMap(post) {
  const map = {};
  for (const m of plainDescription(post?.acf?.d_description).matchAll(/([^\n：:]{0,60}?)[：:]\s*(BRMM-\d{5})/g)) {
    const label = m[1].replace(/^[・\s]+/, "").replace(/\s+/g, " ").trim();
    if (label && label !== "品番") map[m[2].toUpperCase()] = label;   // 収録内容里的「品番：BRMM-…」不是版本名
  }
  return map;
}
// 版本名归一：空白与「版/盤」差异不影响比对
function normEdition(s) {
  return String(s).replace(/[\s\u3000]+/g, "").replace(/限定版/g, "限定盤").replace(/通常版/g, "通常盤");
}
// 版本类别：官网【品番】区块写「Blu-ray付生産限定盤」、特典行却可能只写「限定盤」，比对类别才够稳
function editionKind(s) {
  const n = normEdition(s);
  if (!n) return "";
  if (/通常盤/.test(n)) return "regular";
  if (/限定|特装/.test(n)) return "limited";
  return "other:" + n;
}
function rowMatchesEdition(condition, label) {
  const cands = [...new Set([normEdition(label), normEdition(String(label).split(" ").pop())])].filter(Boolean);
  if (!cands.length) return false;
  const parts = String(condition).replace(/／/g, "/").split("/").map((p) => normEdition(p));
  return parts.some((p) => cands.includes(p));
}
// 没有【品番】区块时的兜底：由 edition_type 与页面条件反推本版版本名（唯一命中才用）
function labelFromEdition(rel, recs) {
  const et = String(rel.attributes?.edition_type || "").toLowerCase();
  const parts = [...new Set(recs.flatMap((r) => String(r.condition).replace(/／/g, "/").split("/").map((s) => s.trim()).filter(Boolean)))];
  if (et === "standard") return parts.find((p) => /通常盤/.test(normEdition(p))) || "";
  const limited = parts.filter((p) => /限定|特装/.test(p) && !/通常盤/.test(normEdition(p)));
  return limited.length === 1 ? limited[0] : "";
}
// 页面是否成对列出两版：该页要存在属于**别的版本**的行；只列单版时本版行无从与其它版本区分
function pageListsOtherEditions(recs, label) {
  const mine = editionKind(label);
  return recs.some((r) => {
    const k = editionKind(r.condition);
    return k !== "" && k !== mine;
  });
}
// 兄弟页候选：同题名 + 同发售日 + 有品番，且页面给出「本版品番属于该商品」的官方证据
async function pickSiblings(rel, all, cache) {
  const cn = String(rel.attributes?.catalog_number || "").trim().toUpperCase();
  const date = String(rel.attributes?.edition_date || "");
  const hits = [];
  const unpaired = [];
  const noText = [];
  for (const c of all) {
    if (c.id === rel.id || c.title !== rel.title) continue;
    if (String(c.attributes?.edition_date || "") !== date) continue;
    const sibCn = String(c.attributes?.catalog_number || "").trim().toUpperCase();
    if (!sibCn) continue;
    const slug = sibCn.toLowerCase();
    let entry = cache.get(slug);
    if (!entry) {
      const { post } = await wpMusics(slug);
      entry = { post, recs: post ? parseStoreBonuses(post.acf?.d_contents || "") : [] };
      cache.set(slug, entry);
    }
    if (!entry.post || !entry.recs.length) {               // 兄弟页也没有 ▼ 分组文本 → 无依据
      if (entry.post) noText.push(sibCn);
      continue;
    }
    const map = officialEditionMap(entry.post);
    let label = map[cn] || "";
    let how = label ? "【品番】区块的版本名" : "";
    if (!label) {                                         // 兜底：d_pnumber 佐证同商品 + 由条件反推版本名
      const pn = String(entry.post.acf?.d_pnumber || "").toUpperCase().split(",").map((s) => s.trim());
      if (pn.includes(cn)) { label = labelFromEdition(rel, entry.recs); how = "d_pnumber 佐证 + 条件反推的版本名"; }
    }
    if (!label) continue;
    const picked = entry.recs.filter((r) => rowMatchesEdition(r.condition, label));
    if (!picked.length) continue;
    if (!pageListsOtherEditions(entry.recs, label)) {            // 该页只列本版这一类条件 → 缺依据，不回填
      unpaired.push({ sibCn, slug, label, total: entry.recs.length, picked: picked.length });
      continue;
    }
    hits.push({ sibCn, slug, label, how, picked, post: entry.post, total: entry.recs.length });
  }
  return { hits, unpaired, noText };
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
const results = { written: [], planned: [], unchanged: [], failed: [], uncovered: [], dateOk: 0, dateMismatch: [], noDate: 0, sibWritten: [], sibPlanned: [], sibSkipped: [] };

// 本版官网无页面（或本版页没有 ▼ 分组文本）时的兄弟品番回填；handled=true 表示已得结论（写入/跳过/失败），
// note 供未覆盖原因补充兄弟页探测结果（有兄弟页但页上同样没有 ▼ 分组文本）。
async function backfillFromSibling(rel, all, cache, cn) {
  if (!SIBLINGS) return { handled: false, note: "" };
  const { hits, unpaired, noText } = await pickSiblings(rel, all, cache);
  const label = rel.title + "（" + cn + "）";
  if (!hits.length) {                                    // 没有可用兄弟页 → 交回原有未覆盖分类
    if (unpaired.length) {
      const u = unpaired[0];
      results.sibSkipped.push({ id: rel.id, title: label, reason: "兄弟页 " + u.sibCn + " 只列出单版条件（无成对行，" + u.picked + "/" + u.total + " 条），按约束不回填" });
      console.log("  ! " + label + "：兄弟页 " + u.sibCn + " 只列单版条件，按约束不回填");
      return { handled: true, note: "" };
    }
    return { handled: false, note: noText.length ? "；同商品兄弟页 " + noText.join("、") + " 存在但同样没有 ▼ 分组特典文本" : "" };
  }
  if (hits.length > 1) {
    results.sibSkipped.push({ id: rel.id, title: label, reason: "同标题同发售日下多个兄弟页都命中本版条件（" + hits.map((h) => h.sibCn).join("、") + "），有歧义不回填" });
    console.log("  ? " + label + "：兄弟页歧义（" + hits.map((h) => h.sibCn).join("、") + "），不写入");
    return { handled: true, note: "" };
  }
  const h = hits[0];
  const url = SITE + "/musics/" + h.slug + "/";
  const desired = buildRecords(h.picked, h.slug);
  const stores = [...new Set(h.picked.map((p) => p.store))];
  const skipped = h.total - h.picked.length;
  const before = rel.attributes?.store_bonuses;
  const beforeN = Array.isArray(before) ? before.length : 0;

  const od = officialDate(h.post);
  const ed = String(rel.attributes?.edition_date || "");
  const dateLine = !od ? "官网无发售日，无法核对"
    : od.iso === ed ? "官网 " + od.display + " 与 edition_date " + od.iso + " 一致"
    : "不一致：官网 " + od.iso + " / 站上 " + (ed || "(空)") + "，未改动";

  if (same(before, desired)) {
    results.unchanged.push({ id: rel.id, title: label, count: desired.length, stores: stores.length });
    console.log("  = 已一致（兄弟回填）" + label + " —— " + desired.length + " 条 / " + stores.length + " 店（跳过写入）");
    return { handled: true, note: "" };
  }
  if (beforeN) {                                         // 任务约束：已有 store_bonuses 的发行版不覆盖
    results.sibSkipped.push({ id: rel.id, title: label, reason: "本版已有 store_bonuses（" + beforeN + " 条），按约束不覆盖" });
    console.log("  ! " + label + " 已有 store_bonuses（" + beforeN + " 条），跳过兄弟回填");
    return { handled: true, note: "" };
  }
  if (VERIFY) {
    results.sibPlanned.push({ id: rel.id, title: label, count: desired.length, stores: stores.length, from: h.sibCn, condition: h.label });
    console.log("  ~ [verify] 兄弟回填 " + label + " ← " + h.sibCn + "「" + h.label + "」将写 " + desired.length + " 条 / " + stores.length + " 店（该页 " + h.total + " 条，未取 " + skipped + " 条）；" + dateLine);
    return { handled: true, note: "" };
  }
  const full = await api("/api/catalog/entities/" + rel.id);
  const next = { ...full, attributes: { ...(full.attributes || {}), store_bonuses: desired } };
  const note = "兄弟品番回填：本版（" + cn + "）官网无独立页面，特典清单取自兄弟品番 " + h.sibCn + " 页面（" + url + "），" +
    "并按该页" + h.how + "「" + h.label + "」筛选出 " + desired.length + " 条 / " + stores.length + " 家店铺" +
    "（该页 ▼ 分组共 " + h.total + " 条：命中 " + desired.length + " 条，另 " + skipped + " 条属其它版本或整行无版本条件，未取）；" +
    "本次只写 store_bonuses，题名 / subjects / contents / 其它属性未改；发售日交叉核对：" + dateLine + "。";
  const r = await raw("/api/catalog/entities/" + rel.id, {
    method: "PUT",
    body: JSON.stringify({ entity: next, expected_version: full.version, edit_note: note, sources: [{ kind: "url", url, citation: CITATION + "（兄弟品番 " + h.sibCn + "）" }] }),
  });
  if (r.status >= 400) {
    results.failed.push({ id: rel.id, title: label, reason: "PUT " + r.status + " " + JSON.stringify(r.body).slice(0, 300) });
    console.log("  ✗ " + label + " 兄弟回填写入失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
    return { handled: true, note: "" };
  }
  const back = await api("/api/catalog/entities/" + rel.id);
  const ok = same(back.attributes?.store_bonuses, desired);
  results.sibWritten.push({ id: rel.id, title: label, count: desired.length, stores: stores.length, from: h.sibCn, condition: h.label, version: back.version, verified: ok, dateLine });
  console.log("  + " + label + " ← " + h.sibCn + "「" + h.label + "」兄弟回填 " + desired.length + " 条 / " + stores.length + " 店，回读" + (ok ? "一致 ✓" : "不一致 ✗") + "；" + dateLine);
  if (!ok) results.failed.push({ id: rel.id, title: label, reason: "回读与写入不一致" });
  return { handled: true, note: "" };
}

async function processRelease(rel, all, pageCache) {
  const cn = String(rel.attributes?.catalog_number || "").trim();
  const label = rel.title + "（" + (cn || "无品番") + "）";
  if (!cn) { results.uncovered.push({ id: rel.id, title: rel.title, reason: "发行版没有 catalog_number，无从匹配官网品番" }); return; }
  const slug = cn.toLowerCase();
  const { status, post, error } = await wpMusics(slug);
  if (error) { results.failed.push({ id: rel.id, title: label, reason: "官网请求失败：" + error }); return; }
  if (!post) {
    const sib = await backfillFromSibling(rel, all, pageCache, cn);
    if (sib.handled) return;
    const html = await htmlStatus(slug);
    results.uncovered.push({
      id: rel.id, title: label,
      reason: (html === 404
        ? "官网未收录该品番（REST slug 无结果 + 页面 404）"
        : "官网页面 HTTP " + html + " 但 REST slug 无对应 post（异常，需人工确认）") + sib.note,
    });
    return;
  }
  const parsed = parseStoreBonuses(post.acf?.d_contents || "");
  if (!parsed.length) {
    const sib = await backfillFromSibling(rel, all, pageCache, cn);
    if (sib.handled) return;
    results.uncovered.push({ id: rel.id, title: label, reason: "官网品番页存在，但 d_contents 的店舗別特典没有 ▼ 分组文本（整张图片，或旧格式仅「店舗名…内容」）" + sib.note, url: SITE + "/musics/" + slug + "/" });
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
  console.log("目标实例 " + BASE + "；模式 " + (VERIFY ? "只读核对（--verify）" : "写入") + "；兄弟品番回填 " + (SIBLINGS ? "开" : "关") + (ONLY.length ? "；只处理 " + ONLY.join(",") : ""));
  if (!VERIFY) await login();
  const releases = await listAllReleases();
  const targets = ONLY.length
    ? releases.filter((r) => ONLY.includes(r.id.toLowerCase()) || ONLY.includes(String(r.attributes?.catalog_number || "").toLowerCase()))
    : releases;
  console.log("站上发行版 " + releases.length + " 个；本次处理 " + targets.length + " 个\n");
  const pageCache = new Map();                 // 兄弟页会被多次探测，缓存一次
  for (const rel of targets) await processRelease(rel, releases, pageCache);

  console.log("\n=== 汇总 ===");
  const covered = results.written.length + results.unchanged.length + results.planned.length;
  const records = [...results.written, ...results.unchanged, ...results.planned].reduce((a, x) => a + (x.count || 0), 0);
  const sibCovered = results.sibWritten.length + results.sibPlanned.length;
  const sibRecords = [...results.sibWritten, ...results.sibPlanned].reduce((a, x) => a + (x.count || 0), 0);
  console.log("发行版总数 " + releases.length + "；命中 " + covered + "（" + (VERIFY ? "待写 " + results.planned.length
    : "写入 " + results.written.length) + "；已一致跳过 " + results.unchanged.length + "）；未覆盖 " + results.uncovered.length + "；失败 " + results.failed.length);
  console.log("覆盖发行版 " + covered + " 个；" + (VERIFY ? "涉及" : "写入") + "特典记录 " + records + " 条");
  console.log("兄弟品番回填 " + sibCovered + " 个（" + (VERIFY ? "待写 " + results.sibPlanned.length : "写入 " + results.sibWritten.length) + "；跳过 " + results.sibSkipped.length + "）；涉及特典记录 " + sibRecords + " 条");
  for (const x of results.sibWritten) console.log("  + " + x.title + " ← " + x.from + "「" + x.condition + "」" + x.count + " 条 / " + x.stores + " 店（version " + x.version + "）");
  for (const x of results.sibPlanned) console.log("  ~ [verify] " + x.title + " ← " + x.from + "「" + x.condition + "」" + x.count + " 条 / " + x.stores + " 店");
  if (results.sibSkipped.length) { console.log("兄弟回填跳过："); for (const x of results.sibSkipped) console.log("  - " + x.title + "： " + x.reason); }
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
