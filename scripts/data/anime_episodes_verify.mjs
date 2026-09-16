#!/usr/bin/env node
// 回读校验：按作品列出篇目（content_unit），核对数量、position、题名、external_ids。
// 用法：MF_USER_PASS=… node scripts/data/anime_episodes_verify.mjs [--all]
import fs from "node:fs";

const BASE = process.env.MF_BASE || "https://findverse.cc";
const USER = process.env.MF_USER || "curator01";
const PASS = process.env.MF_USER_PASS;
const ALL = process.argv.includes("--all");
if (!PASS) { console.error("缺少 MF_USER_PASS"); process.exit(2); }

const plan = JSON.parse(fs.readFileSync("scripts/data/anime_episodes_plan.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = (await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: USER, password: PASS }) })).json()).access_token;
const H = { Authorization: "Bearer " + tok };

async function units(workId) {
  const out = [];
  let off = 0;
  for (;;) {
    const r = await fetch(BASE + "/api/catalog/entities?kind=content_unit&work_id=" + workId + "&limit=50&offset=" + off, { headers: H });
    if (!r.ok) { await sleep(1200); continue; }
    const j = await r.json();
    const b = j.items || [];
    out.push(...b);
    if (b.length < 50) break;
    off += b.length;
  }
  return out.sort((a, b) => a.position - b.position);
}

let bad = 0;
for (const p of plan) {
  const want = p.episodes.filter((e) => e.title);
  const got = await units(p.work_id);
  const numSet = new Set(got.map((u) => u.number));
  const missing = want.filter((e) => !numSet.has(e.number));
  const titleMismatch = got.filter((u) => {
    const w = want.find((e) => e.number === u.number);
    return w && w.title.normalize("NFC") !== u.title.normalize("NFC");
  });
  const noExt = got.filter((u) => !(u.external_ids && u.external_ids.bangumi_episode));
  const ok = got.length === want.length && !missing.length && !titleMismatch.length;
  if (!ok) bad++;
  console.log((ok ? "✓ " : "✗ ") + p.work + " : 落库 " + got.length + " / 计划 " + want.length +
    (missing.length ? " 缺 " + missing.map((e) => e.number).join(",") : "") +
    (titleMismatch.length ? " 题名不符 " + titleMismatch.length + " 条" : "") +
    (noExt.length ? " 缺 external_ids " + noExt.length + " 条" : ""));
  if (ALL || process.argv.length > 3) {
    for (const u of got) console.log("      #" + u.number + " pos=" + u.position + " " + u.title + "  " + JSON.stringify(u.external_ids));
  }
  await sleep(250);
}
console.log(bad ? "\n" + bad + " 部不一致" : "\n全部一致");
