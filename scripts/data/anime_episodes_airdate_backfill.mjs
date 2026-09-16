#!/usr/bin/env node
// 给已有篇目（content_unit）回填放送日字段 attributes.air_date。
//
// 口径（编目铁律）：
//   · 放送日只有**可考据来源**才写：取自实体 external_ids.bangumi_episode → Bangumi 单集条目
//     `GET https://api.bgm.tv/v0/episodes/{id}` 的 airdate（必须带 User-Agent）。
//     官网故事页只给题名与梗概，没有逐话日期 —— 这一事实写进 sources 的 citation。
//   · 拿不到 airdate（未放送、条目缺值）就**留空**，不猜、不用相邻话推算。
//   · 整实体替换（PUT）：先 GET 全量 → 只加 attributes.air_date → expected_version 原样回带。
//     题名 / position / number / work_id / parent_id / external_ids / translations / pictures /
//     status 一律原样回带，不做任何"顺手修一下"。
//   · 幂等：待回填列表按"attributes.air_date 为空"判定；写完再跑一次应为 0 条待回填。
//   · 字段必须已在实例 definitions 里声明（content_unit 的字段集含 air_date）。没声明时写会
//     被 unknown_field 拒绝 —— 先部署后执行 `mf-migrate seed`（或重启服务，启动时会自动合并）。
//
// 用法：
//   MF_USER_PASS=<curator 口令> node scripts/data/anime_episodes_airdate_backfill.mjs [--dry-run] [--only 关键词] [--report 文件]
//   MF_USER_PASS=<口令> node scripts/data/anime_episodes_airdate_backfill.mjs --verify   # 只读核对，不写
// 凭据只走环境变量，绝不写进仓库。

import fs from "node:fs";

const BASE = process.env.MF_BASE || "https://findverse.cc";
const USER = process.env.MF_USER || "curator01";
const PASS = process.env.MF_USER_PASS;
const DRY = process.argv.includes("--dry-run");
const VERIFY = process.argv.includes("--verify");
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > -1 ? process.argv[onlyArg + 1] || "" : "";
const reportArg = process.argv.indexOf("--report");
const REPORT = reportArg > -1 ? process.argv[reportArg + 1] || "" : "";
// 计划表默认用仓库里冻结的一份（含 work_id 与 Bangumi 条目）；MF_EPISODES_PLAN 可指向别的副本
// （例如本地演练实例里 work_id 不同的那份），便于在测试实例上原样复跑同一个脚本。
const PLAN_PATH = process.env.MF_EPISODES_PLAN || "scripts/data/anime_episodes_plan.json";
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

if (!PASS) { console.error("缺少 MF_USER_PASS（凭据只走环境变量）"); process.exit(2); }
if (!fs.existsSync(PLAN_PATH)) { console.error("缺少 " + PLAN_PATH + "（篇目计划表，含 work_id 与 Bangumi 条目）"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "MetaFusion-Catalog/1.0 (https://findverse.cc; " + USER + ")" };

// ---------------------------------------------------------------- 站上目录
let token = "";
const auth = () => ({ "Content-Type": "application/json", Authorization: "Bearer " + token });

async function login() {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const j = await r.json().catch(() => ({}));
  token = j.access_token || j.token || "";
  if (!token) throw new Error("登录失败: " + r.status + " " + JSON.stringify(j).slice(0, 200));
}

// 网关偶发 429/5xx（实测过）：读取退避重试，写入不重试（靠幂等键重跑脚本）。
async function retryFetch(url, init, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let r;
    try {
      r = await fetch(url, init);
    } catch (e) {
      if (attempt === 5) throw new Error(label + " 网络错误: " + e.message);
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (r.ok) return r;
    if (r.status !== 429 && r.status < 500) return r;
    const wait = r.status === 429 ? 3000 * (attempt + 1) : 1000 * (attempt + 1);
    console.error("  … " + label + " 第 " + (attempt + 1) + " 次 " + r.status + "，退避 " + wait + "ms");
    await sleep(wait);
  }
  throw new Error(label + " 重试耗尽");
}

// 列表接口的 limit 被服务端截到 50（实测），必须按 total 翻页，否则漏掉第 50 条之后的篇目。
async function listContentUnits(workId) {
  const out = [];
  let offset = 0, total = null;
  for (;;) {
    const q = new URLSearchParams({ kind: "content_unit", work_id: workId, limit: "50", offset: String(offset) });
    const r = await retryFetch(BASE + "/api/catalog/entities?" + q, { headers: auth() }, "list content_unit");
    if (!r.ok) throw new Error("list content_unit -> " + r.status);
    const j = await r.json();
    const items = j.items || [];
    if (total === null) total = Number(j.total || items.length);
    out.push(...items);
    offset += items.length;
    if (!items.length || out.length >= total) break;
    await sleep(150);
  }
  return { total: total === null ? out.length : total, items: out };
}

// ---------------------------------------------------------------- 放送日来源
const bgmCache = new Map();
async function bgmAirdate(epId) {
  if (bgmCache.has(epId)) return bgmCache.get(epId);
  const r = await retryFetch("https://api.bgm.tv/v0/episodes/" + epId, { headers: UA }, "bgm ep " + epId);
  let out;
  if (r.status === 404) out = { error: "Bangumi 单集条目不存在（404）" };
  else if (!r.ok) out = { error: "Bangumi 单集条目读取失败 " + r.status };
  else {
    const j = await r.json().catch(() => ({}));
    out = { airdate: String(j.airdate || "").trim(), name: String(j.name || "") };
  }
  bgmCache.set(epId, out);
  await sleep(300); // Bangumi 匿名速率有限，串行 + 间隔
  return out;
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  const targets = ONLY ? plan.filter((p) => p.work.includes(ONLY) || p.work_id === ONLY) : plan;
  if (!targets.length) { console.error("没有匹配的作品：" + ONLY); process.exit(3); }

  await login();
  console.log("已登录 " + USER + " @ " + BASE + (VERIFY ? "  [verify 只读]" : DRY ? "  [dry-run]" : ""));

  const stats = { pending: 0, filled: 0, skipped: 0, already: 0, failed: 0 };
  const reasons = { no_ext: [], no_airdate: [], other: [] };
  const failures = [];
  const perWork = [];

  for (const p of targets) {
    const { total, items } = await listContentUnits(p.work_id);
    if (total !== items.length) console.error("  ! " + p.work + " 列表 total=" + total + " 实取 " + items.length + "（分页可能漏项）");
    const units = items.slice().sort((a, b) => a.position - b.position);
    let filled = 0, missing = 0;
    console.log("\n### " + p.work + "  work_id=" + p.work_id + "  Bangumi=" + p.bgm_subject + "  篇目=" + units.length + "（total=" + total + "）");
    for (const u of units) {
      const pos = String(u.position).padStart(2);
      const cur = u.attributes && u.attributes.air_date ? String(u.attributes.air_date) : "";
      if (cur) {
        stats.already++; filled++;
        console.log("  pos=" + pos + " #" + u.number + " " + u.title + " -> 已有 air_date=" + cur + "（跳过）");
        continue;
      }
      missing++;
      const epId = u.external_ids && u.external_ids.bangumi_episode ? String(u.external_ids.bangumi_episode) : "";
      if (!epId) {
        stats.skipped++; reasons.no_ext.push(p.work + " pos=" + u.position + " " + u.title);
        console.log("  pos=" + pos + " #" + u.number + " " + u.title + " -> 跳过：无 external_ids.bangumi_episode");
        continue;
      }
      const bgm = await bgmAirdate(epId);
      if (bgm.error) {
        stats.failed++; failures.push({ work: p.work, id: u.id, position: u.position, reason: bgm.error });
        console.log("  pos=" + pos + " #" + u.number + " " + u.title + " -> 失败：" + bgm.error + "（bgm ep " + epId + "）");
        continue;
      }
      if (!bgm.airdate || !DATE_RE.test(bgm.airdate)) {
        stats.skipped++;
        reasons.no_airdate.push(p.work + " pos=" + u.position + " " + u.title + " (bgm ep " + epId + ")");
        console.log("  pos=" + pos + " #" + u.number + " " + u.title + " -> 跳过：Bangumi 未给 airdate（未放送/未公布），留空不猜（bgm ep " + epId + "）");
        continue;
      }
      stats.pending++;
      if (VERIFY || DRY) {
        console.log("  pos=" + pos + " #" + u.number + " " + u.title + " -> " + (VERIFY ? "待回填" : "将回填") + " air_date=" + bgm.airdate + "（bgm ep " + epId + "）");
        continue;
      }

      // 写入前重新 GET 全量：列表里的 version 可能已被其他编辑者推进。
      const gr = await retryFetch(BASE + "/api/catalog/entities/" + u.id, { headers: auth() }, "get entity");
      if (!gr.ok) {
        stats.failed++; failures.push({ work: p.work, id: u.id, position: u.position, reason: "GET 实体失败 " + gr.status });
        console.log("  pos=" + pos + " -> 失败：GET 实体 " + gr.status);
        continue;
      }
      const e = await gr.json();
      const storyUrl = p.official_story || "";
      const sources = [
        { kind: "url", url: "https://bgm.tv/ep/" + epId, citation: "Bangumi 单集条目放送日 airdate=" + bgm.airdate },
        { kind: "url", url: storyUrl, citation: "官网故事页无逐话放送日期（只给题名与梗概），放送日改用 Bangumi 单集条目" },
      ];
      const entity = {
        id: e.id, kind: e.kind, title: e.title, original_language: e.original_language,
        translations: e.translations || {}, types: e.types || [],
        attributes: Object.assign({}, e.attributes || {}, { air_date: bgm.airdate }),
        external_ids: e.external_ids || {}, status: e.status,
        work_id: e.work_id, position: e.position, number: e.number,
      };
      if (e.parent_id) entity.parent_id = e.parent_id;
      if (e.pictures && e.pictures.length) entity.pictures = e.pictures;
      const payload = {
        entity, expected_version: e.version,
        edit_note: "回填：第" + e.number + "話「" + e.title + "」放送日 " + bgm.airdate +
          "（来源 Bangumi 单集条目 " + epId + "；官网故事页不含逐话放送日期）。仅新增 air_date，其余字段原样回带。",
        sources,
      };
      const pr = await fetch(BASE + "/api/catalog/entities/" + e.id, { method: "PUT", headers: auth(), body: JSON.stringify(payload) });
      const body = await pr.text();
      if (pr.status === 200) {
        let saved = {};
        try { saved = JSON.parse(body); } catch {}
        const got = saved.attributes && saved.attributes.air_date;
        const sameIdentity = saved.title === e.title && String(saved.number) === String(e.number) &&
          saved.position === e.position && saved.work_id === e.work_id && (saved.parent_id || "") === (e.parent_id || "");
        if (got !== bgm.airdate || !sameIdentity) {
          stats.failed++;
          const why = got !== bgm.airdate ? "回读 air_date=" + got : "回读发现其它字段被改动";
          failures.push({ work: p.work, id: e.id, position: e.position, reason: why });
          console.log("  pos=" + pos + " #" + e.number + " -> 失败：" + why);
        } else {
          stats.filled++; filled++;
          console.log("  pos=" + pos + " #" + e.number + " " + e.title + " -> 已写入 air_date=" + bgm.airdate + "（bgm ep " + epId + "）");
        }
      } else if (pr.status === 409) {
        // 版本冲突：别的编辑者先写了一步。重读一次，已经是我们的值就算成功（幂等）。
        const rr = await retryFetch(BASE + "/api/catalog/entities/" + e.id, { headers: auth() }, "get entity again");
        const again = rr.ok ? await rr.json() : {};
        if (again.attributes && again.attributes.air_date === bgm.airdate) {
          stats.filled++; filled++;
          console.log("  pos=" + pos + " #" + e.number + " -> 已写入（并发写入后值一致）air_date=" + bgm.airdate);
        } else {
          stats.failed++;
          failures.push({ work: p.work, id: e.id, position: e.position, reason: "version_conflict（重跑脚本即可）" });
          console.log("  pos=" + pos + " #" + e.number + " -> 失败：version_conflict（重跑脚本即可）");
        }
      } else {
        stats.failed++;
        const hint = body.includes("unknown_field") ? "  ← 实例 definitions 还没有 air_date 字段：先部署并执行 mf-migrate seed（或重启服务）" : "";
        failures.push({ work: p.work, id: e.id, position: e.position, reason: pr.status + " " + body.slice(0, 200) });
        console.log("  pos=" + pos + " #" + e.number + " -> 失败：" + pr.status + " " + body.slice(0, 160) + hint);
        if (pr.status === 429) await sleep(2000);
      }
      await sleep(220); // 网关有 IP 限流，串行 + 间隔比并发稳
    }
    perWork.push({ work: p.work, work_id: p.work_id, units: units.length, with_air_date: filled, pending: missing });
  }

  console.log("\n=== 结果 ===");
  console.log((VERIFY ? "待回填" : "本次待回填") + " " + stats.pending + " / 写入成功 " + stats.filled + " / 跳过 " + stats.skipped + " / 失败 " + stats.failed + " / 原本已有值 " + stats.already);
  if (reasons.no_ext.length) console.log("  跳过 · 无 Bangumi 单集 id（" + reasons.no_ext.length + "）：" + reasons.no_ext.join("；"));
  if (reasons.no_airdate.length) console.log("  跳过 · Bangumi 无 airdate（" + reasons.no_airdate.length + "，留空不猜）：" + reasons.no_airdate.join("；"));
  if (failures.length) console.log("  失败逐条：" + failures.map((x) => x.work + " pos=" + x.position + " " + x.reason).join("；"));

  // 回读核对：按作品统计"有 air_date 的篇目数 / 篇目总数"
  if (!VERIFY && !DRY) {
    console.log("\n=== 回读核对 ===");
    for (const p of targets) {
      const { total, items } = await listContentUnits(p.work_id);
      const withDate = items.filter((u) => u.attributes && u.attributes.air_date).length;
      console.log("  " + p.work + " : air_date " + withDate + " / 篇目 " + items.length + "（total=" + total + "）");
      const row = perWork.find((x) => x.work_id === p.work_id);
      if (row) { row.readback_with_air_date = withDate; row.readback_units = items.length; }
    }
  }
  if (REPORT) {
    fs.writeFileSync(REPORT, JSON.stringify({ base: BASE, mode: VERIFY ? "verify" : DRY ? "dry-run" : "apply", stats, perWork, failures }, null, 1));
    console.log("\n报告已写入 " + REPORT);
  }
  if (stats.pending && (VERIFY || DRY)) console.log("（" + (VERIFY ? "--verify" : "--dry-run") + " 只读，未写入任何实体）");
  if (stats.failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
