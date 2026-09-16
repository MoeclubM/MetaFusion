#!/usr/bin/env node
// 给 BanG Dream! 系列影像作品补**制作人员**（监督/脚本/音乐/作画/制片…）：
//   Bangumi v0 GET /subjects/{id}/persons → agent(person / group) + 署名关系。
//
// 幂等：实体按「题名 + 类型」查重后复用（创建前再用 ?q= 深查一次）；关系按「type + 两端 + attributes」判重后跳过；
//       创建请求带 Idempotency-Key（24h 内同键返回首创结果）。重复运行不会造重复实体或重复边。
// 用法：MF_USER_PASS=<口令> node scripts/data/anime_staff.mjs              # 干跑：只打印计划
//       MF_USER_PASS=<口令> node scripts/data/anime_staff.mjs --apply    # 写入
//       MF_USER_PASS=<口令> node scripts/data/anime_staff.mjs --verify   # 回读校验（不写）
//       MF_USER_PASS=<口令> node scripts/data/anime_staff.mjs --report   # 只打印职务映射/未映射清单（不连站）
//       …（可加作品筛选词，如 --apply MyGO / --apply 01a0a82b）
// 环境：MF_BASE（默认 https://findverse.cc）、MF_USER（默认 curator01）
// 凭据只从环境变量读，不落盘。
//
// 考据口径（官网优先、官网没有才用 Bangumi，且写明"官网无此数据"的原因）：
//   · 官网 bang-dream.com 的作品页只公开作品/乐队/主役阵容，**没有逐项制作人员清单**（无监督/脚本/音乐/作画表）
//     → 制作人员一律取自 Bangumi v0 的 /subjects/{id}/persons，并在实体 sources 与关系 sources 里注明
//       来源条目号与「官网无逐项制作人员清单」这一原因。
//   · 宁缺勿错：Bangumi 该接口里 type=2（公司）与个别实际是机构的行不建 person 实体（列进跳过清单）；
//     能落库的只有定义里真实存在的署名关系码与 attributes.credit_role 原文。
//
// 关系方向与 attributes（照站上既有边，不猜）：
//   读站上 6 部《ドラえもん》剧场版的既有边得到 —— 署名关系一律 **source = work，target = agent**，
//   attributes.credit_role 写职务名（既有边写的就是「导演 / 脚本 / 原作 / 音乐」四个中文职务名）。
//   definitions 也一致：directed_by / written_by / composed_by / created_by / credit_for /
//   illustrated_by / lyricist_of / arranged_by / performed_by 的 source_kinds 都含 work、target_kinds = [agent]。

const BASE = process.env.MF_BASE || "https://findverse.cc";
const USER = process.env.MF_USER || "curator01";
const PASS = process.env.MF_USER_PASS;
const BGM_UA = process.env.MF_BGM_UA || "MetaFusionBot/0.1 (https://findverse.cc; catalog curation)";

// ── 作品 ↔ Bangumi 条目对照 ──────────────────────────────────────────────
// 与 scripts/data/anime_cast.mjs 同一批 15 部影像作品（站上 types 含 animation/film 的 BanG Dream! 作品），
// siteId 取自站上已发布的 Work（标题同时登记，回读核对不上就报错停下）。
// bgm 是**一个或多个** Bangumi 条目：站上把「Episode of Roselia Ⅰ/Ⅱ」「MyGO 前編/後編」各合成了一个 Work，
// 所以一个 Work 取多条目的制作人员并集。
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

// ── 职务映射：Bangumi relation（中文职务名）→ 站上已发布的关系码 ─────────────
// 关系码来自 GET /api/catalog/definitions（当前 29 个，全部 enabled）；这里只用**该表里真实存在**的码，
// 不给未发布的码（如「art_directed_by」「produced_by」）硬塞。
// 只有职务语义与关系码语义对得上才走专用码；其余 person 级署名一律落通用署名关系 credit_for，
// 职务原文写进 attributes.credit_role（既有《ドラえもん》剧场版的边就是这么做的）。
const ROLE_MAP = {
  "导演":       "directed_by",     // 監督
  "总导演":     "directed_by",     // 総監督
  "副导演":     "directed_by",     // 副監督
  "脚本":       "written_by",      // 脚本
  "系列构成":   "written_by",      // シリーズ構成（编剧职能）
  "音乐":       "composed_by",     // 音楽
  "主题歌作曲": "composed_by",     // 主題歌作曲
  "插入歌作曲": "composed_by",     // 挿入歌作曲
  "主题歌作词": "lyricist_of",     // 主題歌作詞
  "插入歌作词": "lyricist_of",     // 挿入歌作詞
  "主题歌编曲": "arranged_by",     // 主題歌編曲
  "插入歌编曲": "arranged_by",     // 挿入歌編曲
  "主题歌演出": "performed_by",    // 主題歌歌唱（多为主体乐队 agent）
  "插入歌演出": "performed_by",    // 挿入歌歌唱
  "原作":       "created_by",      // 原作
  "原案":       "created_by",      // 原案
  "人物设定":   "illustrated_by",  // キャラクターデザイン（绘制人物设定）
  "人物原案":   "illustrated_by",  // キャラクター原案
  "副人物设定": "illustrated_by",
  "客座人物设定": "illustrated_by",
};
const DEFAULT_CODE = "credit_for";  // 通用署名：作画监督/总作画监督/演出/分镜/企画/制片人/色彩设计/音响监督…

// 不写进目录的职务行（Bangumi 侧的整页职务行，非个人署名）：当前为空 —— 逐条看过，没有纯噪声职务。
const SKIP_ROLES = new Set([]);

// 机构行不建 person 实体：一是 Bangumi 该接口里 type=2 的行，二是**标了 type=1 但实际是机构**的行 ——
// 后者的 type 不可信（实测 ニチカライン / ブシロード / 草薙 / lXlXl 都标 1），所以按条目的 summary 逐个人工核对后
// 落成白名单；ORG_PATTERN 只作兜底，避免以后新增的「◯◯スタジオ」被当成人员。全部列进跳过清单回报。
const CURATED_ORGS = new Set(["ニチカライン", "ブシロード", "草薙", "lXlXl", "BN Pictures", "TOKYO MX", "HALF H・P STUDIO", "ウルトラスーパーピクチャーズ", "スタジオリングス"]);
const ORG_PATTERN = /株式会社|有限会社|合同会社|スタジオ|Studio|Pictures|Production|プロダクション|アニメーション|フィルム|テレビ|放送|ミュージック|レコード|エンターテインメント|Inc\.|LLC/;
const isOrg = (p) => p.type === 2 || CURATED_ORGS.has(p.name) || ORG_PATTERN.test(p.name);

// ── HTTP ────────────────────────────────────────────────────────────────
let token = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 本站对短时间内的连打会 429（实测：连续搜索 ~400 次就被限流）→ 所有请求先过节流阀，
// 429/5xx 再退避重试；把错误页/限流当成「空结果」会重复建实体。
const MIN_GAP = 170;
let lastCall = 0;
async function throttle() { const wait = lastCall + MIN_GAP - Date.now(); if (wait > 0) await sleep(wait); lastCall = Date.now(); }

async function raw(path, opts = {}, retry = 0) {
  await throttle();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, { ...opts, headers });
  if ((res.status === 429 || res.status >= 500) && retry < 8) { await sleep((res.status === 429 ? 2500 : 1200) * (retry + 1)); return raw(path, opts, retry + 1); }
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
async function bgmPersons(subjectId) {
  const key = String(subjectId);
  if (bgmCache.has(key)) return bgmCache.get(key);
  const list = await bgm("/v0/subjects/" + key + "/persons");
  bgmCache.set(key, Array.isArray(list) ? list : []);
  await sleep(350); // Bangumi 限流：逐条取即可，别并发打
  return bgmCache.get(key);
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

// agent 全量列表只拉一次并跨作品复用：新建的实体随即并入缓存；真正的并发防护在创建前的 ?q= 深查（见 resolveAgentDeep）
let agentCache = null;
async function allAgents() { if (!agentCache) agentCache = await listKind("agent"); return agentCache; }

async function getEntity(id) { return api("/api/catalog/entities/" + id); }
async function relationsOf(id) { const r = await api("/api/catalog/entities/" + id + "/relations"); return r.items || []; }

function evidence(note, sources) { return { edit_note: note, sources }; }

async function createEntity(entity, note, sources) {
  const body = { entity, expected_version: 0, ...evidence(note, sources) };
  // Idempotency-Key 只能是 ASCII（汉字题名直接进 header 会抛 ByteString 错误）：改成百分号编码
  const r = await raw("/api/catalog/entities", { method: "POST", headers: { "Idempotency-Key": "staff-entity-" + entity.kind + "-" + encodeURIComponent(entity.title) }, body: JSON.stringify(body) });
  if (r.status >= 400) throw new Error("创建 " + entity.kind + "「" + entity.title + "」失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 300));
  return r.body;
}

async function createRelation(type, sourceId, targetId, attributes, note, sources) {
  const body = { relation: { type, source_id: sourceId, target_id: targetId, position: 0, attributes }, expected_version: 0, ...evidence(note, sources) };
  // 去重唯一索引是 (source_id,target_id,type,attributes)：同一人同一作品可以有多条不同职务的边
  const key = "staff-rel-" + type + "-" + sourceId + "-" + targetId + "-" + encodeURIComponent(attributes.credit_role || "n");
  const r = await raw("/api/catalog/relations", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
  if (r.status >= 400) throw new Error("创建关系 " + type + " 失败 " + r.status + " " + JSON.stringify(r.body).slice(0, 300));
  return r.body;
}

// ── 计划 ────────────────────────────────────────────────────────────────
// Bangumi /persons 的 type：1 = 个人、2 = 公司、3 = 组合/乐队（多出现在「主题歌演出」「插入歌演出」）。
// 个人建 person 实体；组合复用站上已有的 group 实体；公司行不建实体。
function buildPlan(list, work) {
  const entries = new Map();   // name -> { name, bgmType, roles: Map(relation -> Set(subjectId)) }
  const orgs = [];             // 机构行（不建实体）
  const skippedRoles = [];
  for (const subjectId of work.bgm) {
    for (const p of (list[String(subjectId)] || [])) {
      if (SKIP_ROLES.has(p.relation)) { skippedRoles.push(p.name + "（" + p.relation + "）"); continue; }
      if (isOrg(p)) { orgs.push(p.name + "（" + p.relation + "，type=" + p.type + "）"); continue; }
      if (!entries.has(p.name)) entries.set(p.name, { name: p.name, bgmType: p.type, roles: new Map() });
      const e = entries.get(p.name);
      if (!e.roles.has(p.relation)) e.roles.set(p.relation, new Set());
      e.roles.get(p.relation).add(subjectId);
    }
  }
  return { entries: [...entries.values()], orgs, skippedRoles };
}

// ── 主流程 ───────────────────────────────────────────────────────────────
const stats = { personNew: 0, personReuse: 0, groupReuse: 0, groupMissing: 0, relNew: 0, relReuse: 0, orgs: [], byCode: {}, unmappedRoles: new Map(), unmappedRoleNames: new Set() };

async function resolveAgent(agents, title, types) {
  return agents.find((a) => a.title === title && types.some((t) => (a.types || []).includes(t))) || null;
}

// 「一次拉全量 + 分页」在并发写入下会漏项（本站常有多个代理同时写），创建前再用题名检索确认一次：
// 命中即复用，否则会造出同名同类型的第二个实体。
async function resolveAgentDeep(agents, title, types) {
  const hit = await resolveAgent(agents, title, types);
  if (hit) return hit;
  const r = await api("/api/catalog/entities?kind=agent&q=" + encodeURIComponent(title) + "&limit=50");
  const found = (r.items || []).find((x) => x.title === title && types.some((t) => (x.types || []).includes(t)));
  if (found) agents.push(found);
  return found || null;
}

function sourcesFor(subjectIds, role) {
  return subjectIds.map((sid) => ({
    kind: "url",
    url: "https://bgm.tv/subject/" + sid + "/persons",
    citation: "Bangumi 条目 " + sid + " 制作人员表（v0 API /subjects/" + sid + "/persons）职务「" + role + "」；官网 bang-dream.com 只公开作品/乐队/主役阵容，无逐项制作人员清单",
  }));
}

async function runWork(work, dry) {
  const agents = await allAgents();
  const entity = await getEntity(work.siteId);
  if (entity.title !== work.title) throw new Error("作品 " + work.siteId + " 题名不符：期望「" + work.title + "」实际「" + entity.title + "」");

  console.log("\n=== [" + work.key + "] " + work.label + " ===\n    " + work.title + "  bgm=" + work.bgm.join("+") + "  id=" + work.siteId.slice(0, 8));
  const list = {};
  for (const sid of work.bgm) list[String(sid)] = await bgmPersons(sid);
  const plan = buildPlan(list, work);
  const rows = work.bgm.reduce((n, s) => n + (list[String(s)] || []).length, 0);
  const relCount = plan.entries.reduce((n, e) => n + e.roles.size, 0);
  console.log("    Bangumi 制作人员行 " + rows + " → 人参 " + plan.entries.length + " / 待写署名边 " + relCount + "；跳过机构行 " + plan.orgs.length + "、跳过职务行 " + plan.skippedRoles.length);

  // 1) 实体：个人建 person，组合复用既有 group（不造重复实体）
  const workRels = await relationsOf(work.siteId);
  const existing = new Set(workRels.map((x) => x.type + "|" + x.target_id + "|" + JSON.stringify(x.attributes || {}) + "|" + x.source_id));

  for (const e of plan.entries) {
    const isGroup = e.bgmType === 3;
    let agent = await resolveAgentDeep(agents, e.name, isGroup ? ["group", "organization"] : ["person"]);
    if (!agent && isGroup) {
      console.log("    ! 组合实体不存在，跳过：" + e.name);
      stats.groupMissing++;
      continue;
    }
    if (!agent) {
      const firstRole = [...e.roles.keys()][0];
      const sids = [...e.roles.get(firstRole)];
      if (dry) {
        console.log("      · [dry] 建人员 " + e.name + "（首个职务 " + firstRole + "）");
        agent = { id: "DRY-P-" + e.name, title: e.name, types: ["person"] };
        agents.push(agent);   // 干跑也记进内存表，同一人在别的作品里直接命中，不再重复检索
        stats.personNew++;
      }
      else {
        try {
          agent = await createEntity({ kind: "agent", title: e.name, original_language: "ja", types: ["person"], translations: { "ja-JP": { title: e.name } }, status: "published" },
            "编目：制作人员「" + e.name + "」——" + work.label + " 的 Bangumi 制作人员表在案（职务「" + firstRole + "」等）",
            sourcesFor(sids, firstRole));
          agents.push(agent);
          stats.personNew++;
        } catch (err) {
          // 本站常有别的代理同时写：题名唯一索引撞重就改成复用，不中断整轮（真错误照常抛）
          const again = await resolveAgentDeep(agents, e.name, ["person"]);
          if (!again) throw err;
          console.log("      · 并发撞重，改为复用既有实体：" + e.name);
          agent = again;
          stats.personReuse++;
        }
      }
    } else if (isGroup) stats.groupReuse++;
    else stats.personReuse++;

    for (const [role, sidSet] of e.roles) {
      const code = ROLE_MAP[role] || DEFAULT_CODE;
      if (!ROLE_MAP[role]) { stats.unmappedRoles.set(role, (stats.unmappedRoles.get(role) || 0) + 1); stats.unmappedRoleNames.add(role); }
      const attrs = { credit_role: role };
      const sig = code + "|" + agent.id + "|" + JSON.stringify(attrs) + "|" + work.siteId;
      const note = "编目：" + work.label + " 的制作人员「" + e.name + "」署名「" + role + "」→ " + code + "（Bangumi 条目 " + [...sidSet].join("/") + " 制作人员表）；官网无逐项制作人员清单";
      if (existing.has(sig)) { stats.relReuse++; continue; }
      if (dry) { console.log("      · [dry] " + code + " 作品 → " + e.name + "（credit_role=" + role + "）"); stats.relNew++; }
      else { await createRelation(code, work.siteId, agent.id, attrs, note, sourcesFor([...sidSet], role)); stats.relNew++; await sleep(120); }
      stats.byCode[code] = (stats.byCode[code] || 0) + 1;
    }
  }
  stats.orgs.push(...plan.orgs.map((s) => work.key + ": " + s));
}

async function verifyWork(work) {
  const rels = await relationsOf(work.siteId);
  const codes = new Set([...Object.values(ROLE_MAP), DEFAULT_CODE]);
  const mine = rels.filter((r) => r.source_id === work.siteId && codes.has(r.type));
  const byCode = {};
  for (const r of mine) byCode[r.type] = (byCode[r.type] || 0) + 1;
  console.log("\n=== [" + work.key + "] " + work.title);
  console.log("    署名边 " + mine.length + " 条：" + Object.entries(byCode).map(([k, v]) => k + "=" + v).join("  "));
  const agents = await allAgents();
  const name = (id) => (agents.find((a) => a.id === id) || {}).title || id.slice(0, 8);
  // 职务 → 人员
  const byRole = new Map();
  for (const r of mine) {
    const role = ((r.attributes || {}).credit_role) || "(未写职务)";
    const k = r.type + " · " + role;
    if (!byRole.has(k)) byRole.set(k, []);
    byRole.get(k).push(name(r.target_id));
  }
  for (const [k, v] of [...byRole.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log("    " + k + "（" + v.length + "）: " + v.join("、"));
  }
  return { total: mine.length, byCode };
}

// ── 职务映射报告（--report，不连站）：哪些职务映射到专用码、哪些落通用码、哪些行被跳过 ──
async function reportRoles() {
  const agg = new Map();   // relation -> { rows, persons:Set, types:Map, code }
  const orgRows = [];
  for (const work of WORKS) {
    for (const sid of work.bgm) {
      for (const p of await bgmPersons(sid)) {
        if (isOrg(p)) { orgRows.push(p.relation + " ← " + p.name); continue; }
        if (!agg.has(p.relation)) agg.set(p.relation, { rows: 0, persons: new Set(), types: new Map() });
        const a = agg.get(p.relation);
        a.rows++; a.persons.add(p.name); a.types.set(p.type, (a.types.get(p.type) || 0) + 1);
      }
    }
  }
  const mapped = [...agg.entries()].filter(([r]) => ROLE_MAP[r]);
  const generic = [...agg.entries()].filter(([r]) => !ROLE_MAP[r]);
  const line = ([r, a]) => "  " + r.padEnd(14) + " 行 " + String(a.rows).padStart(4) + " / 人 " + String(a.persons.size).padStart(3) + "  type=" + [...a.types.entries()].map(([t, n]) => t + ":" + n).join(",") + " → " + (ROLE_MAP[r] || DEFAULT_CODE + "（通用署名）");
  console.log("=== 映射到专用关系码的职务（" + mapped.length + " 种）===");
  for (const x of mapped.sort((a, b) => b[1].rows - a[1].rows)) console.log(line(x));
  console.log("\n=== 无专用码、落通用署名 credit_for 的职务（" + generic.length + " 种）===");
  for (const x of generic.sort((a, b) => b[1].rows - a[1].rows)) console.log(line(x));
  console.log("\n=== 机构行（type=2 或机构名，不建 person 实体）：" + orgRows.length + " 行 ===");
  console.log([...new Set(orgRows)].sort().join("\n"));
}

async function main() {
  const args = process.argv.slice(2);
  const verify = args.includes("--verify");
  const report = args.includes("--report");
  const dry = !args.includes("--apply"); // 除 --apply 外一律干跑
  const filters = args.filter((a) => !a.startsWith("--"));
  const works = filters.length ? WORKS.filter((w) => filters.some((f) => w.key.includes(f) || w.title.includes(f) || w.siteId.startsWith(f))) : WORKS;
  if (!works.length) throw new Error("没有匹配的作品：" + filters.join(","));
  if (report) { await reportRoles(); return; }
  await login();
  if (verify) {
    for (const w of works) await verifyWork(w);
    return;
  }
  console.log((dry ? "[干跑] " : "[写入] ") + works.length + " 部作品：" + works.map((w) => w.key).join(", "));
  for (const w of works) await runWork(w, dry);
  console.log("\n统计：" + JSON.stringify({ personNew: stats.personNew, personReuse: stats.personReuse, groupReuse: stats.groupReuse, groupMissing: stats.groupMissing, relNew: stats.relNew, relReuse: stats.relReuse }));
  console.log("按关系码：" + JSON.stringify(stats.byCode));
  if (stats.unmappedRoles.size) {
    const u = [...stats.unmappedRoles.entries()].sort((a, b) => b[1] - a[1]);
    console.log("未映射到专用码、落通用署名 credit_for 的署名边 " + [...stats.unmappedRoles.values()].reduce((a, b) => a + b, 0) + " 条 / 职务 " + stats.unmappedRoleNames.size + " 种（" + u.slice(0, 12).map(([k, v]) => k + "×" + v).join("、") + "…）");
  }
  if (stats.orgs.length) console.log("跳过机构行 " + stats.orgs.length + " 条（示例：" + [...new Set(stats.orgs)].slice(0, 6).join("，") + "）");
}

main().catch((e) => { console.error("失败：" + e.message); process.exit(1); });
