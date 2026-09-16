#!/usr/bin/env node
// 给「BanG Dream! 企划动画」补建篇目层（content_unit）。
//
// 口径（编目铁律）：
//   · 每集题名以**官网故事页**的日文原题为唯一权威；官网列表缺该话时才回落到 Bangumi 单集条目，
//     并在 edit_note / sources 里写明"官网 STORY 归档未列出该话"。
//   · 放送日取 Bangumi 单集 airdate（官网故事页不逐话标注日期），冲突以官网为准（实测无冲突）。
//   · 题名保留官网原文（不塞「第 N 话」前缀——编号由 number/position 承载）。
//   · 属性只写实例 definitions 已声明的字段：content_unit 只声明 language / entry_role。
//     **没有 air_date 字段** —— 放送日写进 edit_note 与 sources.citation，作为机读缺口如实上报。
//   · 幂等：先按 external_ids.bangumi_episode / (work_id, number) 查重，命中即跳过。
//
// 用法：MF_USER_PASS=<curator01 口令> node scripts/data/anime_episodes.mjs [--dry-run]
// 凭据只走环境变量，绝不写进仓库。

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.MF_BASE || "https://findverse.cc";
const USER = process.env.MF_USER || "curator01";
const PASS = process.env.MF_USER_PASS;
const DRY = process.argv.includes("--dry-run");
const BGM_UA = { "User-Agent": "MetaFusion-Catalog/1.0 (https://findverse.cc; " + USER + ")", "Content-Type": "application/json" };
const WEB_UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const OUT_DIR = "scripts/data";

if (!PASS) { console.error("缺少 MF_USER_PASS（凭据只走环境变量）"); process.exit(2); }

// ---------------------------------------------------------------- 数据源：官网
// 每部作品的官网（官网 Anime 列表 https://bang-dream.com/anime/ 上的链接）。
// kind=picoFamily 的页面把每一话写成 <div class="sub-Content"> 块，其余页面各有各的标记，
// 统一用「多个锚点模式取并集」的方式提取，避免为每站写一套解析。
const OFFICIAL_SITES = [
  { code: "1st",        url: "https://anime.bang-dream.com/1st/story/",                 kind: "page" },
  { code: "2nd",        url: "https://anime.bang-dream.com/2nd/story/",                 kind: "page" },
  { code: "3rd",        url: "https://anime.bang-dream.com/3rd/story/",                 kind: "page" },
  { code: "mygo",       url: "https://anime.bang-dream.com/mygo/story/",                kind: "page" },
  { code: "avemujica",  url: "https://anime.bang-dream.com/avemujica/story/",           kind: "page" },
  { code: "pico_1",     url: "https://anime.bang-dream.com/pico/story/1st/",            kind: "picoFamily" },
  { code: "pico_ohmori",url: "https://anime.bang-dream.com/pico/story/ohmori/",         kind: "picoFamily" },
  { code: "pico_fever", url: "https://anime.bang-dream.com/pico/story/",                kind: "picoFamily" },
  { code: "morfonica",  url: "https://morfonica-anime.bang-dream.com/story/",           kind: "page" },
  { code: "bandorichan",url: "https://anime.bang-dream.com/bandorichan/story/",         kind: "paged", pages: 6 },
  { code: "yumemita",   url: "https://anime.bang-dream.com/yumemita/story/",            kind: "page" },
];

// 站上作品题名 -> 官网站点 + Bangumi subject。
// Bangumi id 是"同名 + 年份/平台"人工比对过的，不是模糊搜索第一名；
// 这 11 条里 9 条的 subject id 在站上既有封面修订里已被引用（见 dev-log 的多源补图记录）。
const WORKS = [
  { title: "BanG Dream!（バンドリ！）",                  site: "1st",         bgm: 186515, note: "TV 第1期（2017-01 起）" },
  { title: "BanG Dream! 2nd Season",                     site: "2nd",         bgm: 246429, note: "TV 第2期（2019-01 起）" },
  { title: "BanG Dream! 3rd Season",                     site: "3rd",         bgm: 246430, note: "TV 第3期（2020-01 起）" },
  { title: "BanG Dream! It's MyGO!!!!!",                 site: "mygo",        bgm: 428735, note: "TV（2023-06 起）" },
  { title: "BanG Dream! Ave Mujica",                     site: "avemujica",   bgm: 454684, note: "TV（2025-01 起）" },
  { title: "BanG Dream! ガルパ☆ピコ",                    site: "pico_1",      bgm: 246431, note: "迷你动画 第1期（2018-07 起）" },
  { title: "BanG Dream! ガルパ☆ピコ ～大盛り～",          site: "pico_ohmori", bgm: 296295, note: "迷你动画 第2期（2020-05 起）" },
  { title: "BanG Dream! ガルパ☆ピコ ふぃーばー！",        site: "pico_fever",  bgm: 338400, note: "迷你动画 第3期（2021-10 起）" },
  { title: "BanG Dream! Morfonication",                  site: "morfonica",   bgm: 385928, note: "前后篇 ONA（2022-07）" },
  { title: "元祖！バンドリちゃん",                        site: "bandorichan", bgm: 540449, note: "迷你动画（2025-10 起，官网定位全 52 话）" },
  { title: "バンドリ！ ゆめ∞みた",                        site: "yumemita",    bgm: 583729, note: "TV（2026-07 起）" },
];

const strip = (s) => String(s).replace(/<[^>]+>/g, " ")
  .replace(/&#8217;|&rsquo;|&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&hellip;/g, "…").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/[\u00a0\u200b]/g, " ").replace(/\s+/g, " ").trim();

// 各站故事页的锚点模式：取并集，先到先得。官网改名不改语义，多写几种比写死一种稳。
const ANCHORS = [
  /<p class="st-list_item_label"><span class="en">#\s*(\d+)<\/span>([^<]*)<\/p>/g,
  /id="episode-(\d+)\s*">[\s\S]{0,200}?<h3>([^<]*)<\/h3>/g,
  /<h3 class="story-List_Item_Ttl"><span class="num barlow-b">#\s*(\d+)<\/span>([^<]*)<\/h3>/g,
  /<h2 class="heading"><span class="number">#\s*(\d+)<\/span><span class="title">([^<]*)<\/span><\/h2>/g,
  /<h2 class="episode-Detail_Heading"><span class="number">#\s*(\d+)<\/span><span class="title">([^<]*)<\/span><\/h2>/g,
  /<h2 class="ttl"><span class="num Lato">[\s\S]{0,120}?<div class="num-Inner">#\s*(\d+)<\/div>[\s\S]{0,80}?<span class="txt">([^<]*)<\/span>/g,
  /<div class="heading"><span class="num cardo-700">#\s*(\d+)<\/span><\/div>[\s\S]{0,80}?<div class="ttl">([^<]*)<\/div>/g,
  /<span class="p-story-episode__article-head-num">#\s*(\d+)<\/span><span class="p-story-episode__article-head-title">([^<]*)<\/span>/g,
  /<p class="p-story-content__number u-weight--900">第\s*(\d+)\s*話<\/p>[\s\S]{0,300}?<p class="p-story-content__title u-weight--700">([^<]*)<\/p>/g,
];
const PICO_BLOCK_TITLE = /<span class="number">#?(\d+)<\/span>[\s\S]{0,80}?<span class="title">([^<]*)<\/span>/g;

async function officialTitles(site) {
  const map = new Map();
  const urls = [site.url];
  for (let p = 2; p <= (site.pages || 1); p++) urls.push(site.url.replace(/\/$/, "") + "/page/" + p + "/");
  for (const u of urls) {
    const r = await fetch(u, { headers: WEB_UA, redirect: "follow" });
    if (!r.ok) continue;
    const html = await r.text();
    if (site.kind === "picoFamily") {
      for (const m of html.matchAll(PICO_BLOCK_TITLE)) {
        const n = Number(m[1]); const t = strip(m[2]);
        if (n > 0 && t && !map.has(n)) map.set(n, t);
      }
      continue;
    }
    for (const re of ANCHORS) {
      for (const m of html.matchAll(re)) {
        const n = Number(m[1]); const t = strip(m[2]);
        if (n > 0 && t && !map.has(n)) map.set(n, t);
      }
    }
    await sleep(250);
  }
  return map;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bgmEpisodes(subject) {
  const out = [];
  let off = 0;
  for (;;) {
    const r = await fetch("https://api.bgm.tv/v0/episodes?subject_id=" + subject + "&type=0&limit=100&offset=" + off, { headers: { "User-Agent": BGM_UA["User-Agent"] } });
    if (!r.ok) throw new Error("bgm episodes " + subject + " -> " + r.status);
    const j = await r.json();
    const b = j.data || [];
    out.push(...b);
    if (b.length < 100) break;
    off += b.length;
    await sleep(300);
  }
  return out.sort((a, b) => a.sort - b.sort);
}

// ---------------------------------------------------------------- 数据源：站上目录
let token = "";
const auth = () => ({ "Content-Type": "application/json", Authorization: "Bearer " + token });
async function login() {
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: USER, password: PASS }) });
  const j = await r.json().catch(() => ({}));
  token = j.access_token || j.token || "";
  if (!token) throw new Error("登录失败: " + r.status + " " + JSON.stringify(j).slice(0, 200));
}

// 网关偶发 502（实测一次），读取一律带退避重试；写入不重试（靠 external_ids 幂等，重跑脚本即可）。
async function listEntities(kind, workId) {
  const out = [];
  let off = 0;
  for (;;) {
    const q = new URLSearchParams({ kind, limit: "50", offset: String(off) });
    if (workId) q.set("work_id", workId);
    let j = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch(BASE + "/api/catalog/entities?" + q, { headers: auth() });
      if (r.ok) { j = await r.json(); break; }
      // 429 是网关 IP 限流（不是应用错误），502 是网关偶发；两者都退避重试。
      if (r.status !== 429 && r.status < 500) throw new Error("list " + kind + " -> " + r.status);
      const wait = r.status === 429 ? 3000 * (attempt + 1) : 1000 * (attempt + 1);
      console.error("  … list " + kind + " 第 " + (attempt + 1) + " 次 " + r.status + "，退避 " + wait + "ms");
      await sleep(wait);
    }
    if (!j) throw new Error("list " + kind + " -> 重试耗尽");
    const b = j.items || [];
    out.push(...b);
    if (b.length < 50) break;
    off += b.length;
  }
  return out;
}

// ---------------------------------------------------------------- 主流程
async function main() {
  await login();
  console.log("已登录 " + USER + " @ " + BASE + (DRY ? "  [dry-run]" : ""));

  const works = await listEntities("work");
  const byTitle = new Map(works.map((w) => [w.title, w]));
  const missing = WORKS.filter((w) => !byTitle.has(w.title));
  if (missing.length) { console.error("站上找不到作品: " + missing.map((m) => m.title).join(" / ")); process.exit(3); }

  const plan = [];
  const report = [];
  for (const spec of WORKS) {
    const work = byTitle.get(spec.title);
    const site = OFFICIAL_SITES.find((s) => s.code === spec.site);
    const offi = await officialTitles(site);
    const eps = await bgmEpisodes(spec.bgm);
    const rows = [];
    for (const e of eps) {
      const n = Number(e.sort);
      const officialTitle = offi.get(n) || "";
      const title = (officialTitle || e.name || "").normalize("NFC").trim();
      rows.push({
        position: n,
        number: String(e.ep ?? e.sort),
        title,
        title_official: !!officialTitle,
        air_date: e.airdate || "",
        bgm_ep_id: String(e.id),
      });
    }
    const noTitle = rows.filter((r) => !r.title);
    plan.push({ spec, work, site, offiCount: offi.size, rows });
    report.push({
      title: spec.title, work_id: work.id, bgm: spec.bgm,
      official_count: offi.size, bgm_count: rows.length,
      no_title: noTitle.map((r) => r.position),
      bgm_only: rows.filter((r) => !r.title_official).map((r) => r.position),
    });
    console.log("  计划 " + spec.title + "：官网 " + offi.size + " 话 / Bangumi " + rows.length + " 话" +
      (noTitle.length ? "（无题名跳过 " + noTitle.map((r) => r.position).join(",") + "）" : ""));
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "anime_episodes_plan.json"), JSON.stringify(plan.map((p) => ({
    work: p.spec.title, work_id: p.work.id, bgm_subject: p.spec.bgm,
    official_story: p.site.url, episodes: p.rows,
  })), null, 1));

  // 写入
  const existing = new Map(); // key: work_id|number -> entity ; ext: bangumi_episode id
  const extIndex = new Map();
  for (const p of plan) {
    const units = await listEntities("content_unit", p.work.id);
    for (const u of units) {
      existing.set(p.work.id + "|" + u.number, u);
      const be = u.external_ids && u.external_ids.bangumi_episode;
      if (be) extIndex.set(p.work.id + "|" + String(be), u);
    }
  }

  let created = 0, skipped = 0, failed = 0, planned = 0;
  const createdIds = [];
  const failures = [];
  for (const p of plan) {
    for (const row of p.rows) {
      if (!row.title) continue;
      planned++;
      const key = p.work.id + "|" + row.number;
      const hit = existing.get(key) || extIndex.get(p.work.id + "|" + row.bgm_ep_id);
      if (hit) { skipped++; continue; }

      const sources = [];
      if (row.title_official) {
        sources.push({ kind: "url", url: p.site.url, citation: "官网故事页（第" + row.number + "話 題名）" });
      } else {
        sources.push({ kind: "url", url: "https://bgm.tv/ep/" + row.bgm_ep_id, citation: "Bangumi 单集条目（官网 STORY 归档未列出该话，题名取 Bangumi 日文原名）" });
      }
      sources.push({ kind: "url", url: "https://bgm.tv/subject/" + p.spec.bgm, citation: "Bangumi 条目 放送日" + (row.air_date ? " " + row.air_date : "（该话无放送日）") });
      sources.push({ kind: "url", url: p.site.url, citation: "官网无逐话放送日期（故事页只给题名与梗概），放送日改用 Bangumi" });

      const payload = {
        entity: {
          kind: "content_unit",
          work_id: p.work.id,
          title: row.title,
          original_language: "ja",
          number: row.number,
          position: row.position,
          types: ["content_unit"],
          attributes: { language: "ja", entry_role: "main" },
          external_ids: { bangumi_episode: row.bgm_ep_id, bangumi: String(p.spec.bgm) },
          translations: { ja: { title: row.title } },
          status: "published",
        },
        expected_version: 0,
        edit_note: "编目：" + p.spec.title + " 第" + row.number + "話「" + row.title + "」建篇目；题名取官网故事页日文原名，放送日 " +
          (row.air_date || "（无）") + " 取 Bangumi 条目 " + p.spec.bgm + " 单集 " + row.bgm_ep_id +
          "（官网故事页不含逐话放送日期）。",
        sources,
      };
      if (DRY) { created++; continue; }
      try {
        const r = await fetch(BASE + "/api/catalog/entities", { method: "POST", headers: auth(), body: JSON.stringify(payload) });
        const t = await r.text();
        if (r.status === 200 || r.status === 201) {
          created++;
          let id = ""; try { id = JSON.parse(t).id || ""; } catch {}
          createdIds.push({ work: p.spec.title, number: row.number, id });
          existing.set(key, { id, number: row.number });
          extIndex.set(p.work.id + "|" + row.bgm_ep_id, { id });
        } else {
          failed++;
          failures.push({ work: p.spec.title, number: row.number, status: r.status, body: t.slice(0, 200) });
          console.error("  ✗ " + p.spec.title + " #" + row.number + " -> " + r.status + " " + t.slice(0, 160));
          if (r.status === 429) await sleep(1500);
        }
      } catch (e) {
        failed++;
        failures.push({ work: p.spec.title, number: row.number, status: 0, body: String(e.message).slice(0, 200) });
      }
      await sleep(220); // 网关有 IP 限流，串行 + 间隔比并发稳
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "anime_episodes_created.json"), JSON.stringify({ createdIds, failures }, null, 1));
  console.log("\n结果：计划 " + planned + " / 新建 " + created + " / 已存在跳过 " + skipped + " / 失败 " + failed);
  if (failures.length) console.log("失败明细见 " + path.join(OUT_DIR, "anime_episodes_created.json"));

  // 回读：按 work 重新拉 content_unit，核对数量与题名
  console.log("\n=== 回读（GET /api/catalog/entities?kind=content_unit&work_id=…）===");
  for (const p of plan) {
    const units = (await listEntities("content_unit", p.work.id)).sort((a, b) => a.position - b.position);
    console.log("  " + p.spec.title + " : " + units.length + " 篇（计划 " + p.rows.filter((r) => r.title).length + "）" +
      (units.length ? " 首话=" + units[0].title + " / 末话=" + units[units.length - 1].title : ""));
    await sleep(200);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
