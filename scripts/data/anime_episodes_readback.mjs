#!/usr/bin/env node
// 独立回读证据：按作品打印篇目列表（数量 + 题名 + position/number + external_ids + 修订证据）。
// 用法：MF_USER_PASS=… node scripts/data/anime_episodes_readback.mjs ["作品题名关键词" ...]
import fs from "node:fs";
const BASE = process.env.MF_BASE || "https://findverse.cc";
const USER = process.env.MF_USER || "curator01";
const PASS = process.env.MF_USER_PASS;
if (!PASS) { console.error("缺少 MF_USER_PASS"); process.exit(2); }
const needles = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync("scripts/data/anime_episodes_plan.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = (await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: USER, password: PASS }) })).json()).access_token;
const H = { Authorization: "Bearer " + tok };
async function get(p) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(BASE + p, { headers: H });
    if (r.ok) return await r.json();
    await sleep(2500);
  }
  throw new Error(p + " 重试耗尽");
}
const targets = needles.length ? plan.filter((p) => needles.some((n) => p.work.includes(n))) : plan;
for (const p of targets) {
  const j = await get("/api/catalog/entities?kind=content_unit&work_id=" + p.work_id + "&limit=50");
  const units = (j.items || []).sort((a, b) => a.position - b.position);
  console.log("### " + p.work + "   work_id=" + p.work_id + "   Bangumi=" + p.bgm_subject);
  console.log("    落库 " + units.length + " 篇 / total=" + j.total);
  for (const u of units) {
    console.log("    pos=" + String(u.position).padStart(2) + "  number=" + String(u.number).padStart(2) +
      "  " + u.title + "   ext=" + JSON.stringify(u.external_ids) + "  status=" + u.status);
  }
  if (units.length) {
    const rev = await get("/api/catalog/entities/" + units[0].id + "/revisions?limit=1");
    const it = (rev.items || rev || [])[0] || {};
    console.log("    修订证据（首话）：version=" + it.version + " actor=" + (it.actor_name || "?") +
      " note=" + String(it.edit_note || "").slice(0, 120));
    console.log("      sources=" + JSON.stringify(it.sources || it.source_urls || []).slice(0, 400));
  }
  await sleep(400);
}
