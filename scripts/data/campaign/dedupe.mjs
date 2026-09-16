#!/usr/bin/env node
// 战役数据去重与孤儿清理（默认只读报告，写操作必须显式开开关）。
//
// 背景：20 个子代理并发写同一实例，两个领域可能对同一条真实数据分别建档；
// 加上中途修补过 lib 的幂等键算法，出现过"同一次任务跑两遍"的重复建档。
// 本脚本只处理**自己战役日志里出现过的实体**（不碰别人的数据），并且：
//   · 重复组：默认只报告；--merge 时用 lifecyle 合并（loser → keeper，服务端会改写引用），
//     合并要求同 kind 且 work_id/release_id/medium_id/parent_id 全等（服务端 invalid_merge_target）；
//   · 孤儿：父级已删除/不存在的实体（结构悬挂），--fix-orphans 时按层级自底向上停用。
//
// 用法：MF_USER_PASS=… node scripts/data/campaign/dedupe.mjs [--merge] [--fix-orphans]

import fs from "node:fs";
import path from "node:path";
import { Client, LOG_DIR } from "./lib.mjs";

const DO_MERGE = process.argv.includes("--merge");
const FIX_ORPHANS = process.argv.includes("--fix-orphans");
const KINDS = ["agent", "collection", "work", "content_unit", "expression", "release", "medium", "track"];

const client = new Client();
await client.login();

// 战役自己建过的实体（严格边界：只在日志里出现过的 id 才允许被本脚本改动）
const mine = new Map();
for (const f of fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).filter((x) => x.endsWith(".jsonl")) : []) {
  for (const line of fs.readFileSync(path.join(LOG_DIR, f), "utf8").trim().split("\n").filter(Boolean)) {
    try {
      const r = JSON.parse(line);
      if (r.id && (r.op === "entity") && r.status === "created") mine.set(r.id, r.domain);
    } catch { /* 忽略坏行 */ }
  }
}

const rows = [];
for (const k of KINDS) rows.push(...await client.listKind(k));
const live = rows.filter((e) => e.status !== "deleted" && e.status !== "merged");
const byId = new Map(live.map((e) => [e.id, e]));
console.log("活体实体 " + live.length + " · 本战役建过 " + mine.size + " 个 id");

const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
// 发行没有父级作用域，"同名"往往只是不同版次（限定盤/通常盤/地区版）→ 把能区分版次的字段并入键，
// 否则会把合法的多版次误判成重复。其余 kind 题名 + 父级作用域 + 编号已经足够。
const keyOf = (e) => {
  const a = e.attributes || {};
  const extra = e.kind === "release" ? [a.catalog_number || "", a.barcode || "", a.isbn || "", a.edition_date || "", a.edition_type || ""].join("~") : "";
  return [e.kind, norm(e.title), e.work_id || "", e.release_id || "", e.medium_id || "", e.parent_id || "", e.number || "", extra].join("|");
};

// ── 1) 重复组 ────────────────────────────────────────────────────────────
const groups = new Map();
for (const e of live) {
  const k = keyOf(e);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(e);
}
const domOf = (e) => mine.get(e.id) || "(非本战役)";
const dupGroups = [...groups.values()].filter((g) => g.length > 1);
console.log("\n=== 重复组：" + dupGroups.length + " ===");
const merges = [];
for (const g of dupGroups) {
  const tagged = g.map((e) => ({ e, dom: domOf(e), inMine: mine.has(e.id) }));
  console.log("- " + g[0].kind + "「" + g[0].title + "」×" + g.length + "  " + tagged.map((t) => t.e.id.slice(0, 8) + "(" + t.dom + ")").join(" "));
  const allMine = tagged.every((t) => t.inMine);
  if (!allMine) { console.log("    · 含非本战役实体，跳过（不动别人的数据）"); continue; }
  // keeper：子级/引用更多的那个；并列时取最早创建
  const score = (e) => (e.kind === "work" ? live.filter((x) => x.work_id === e.id).length : 0)
    + (e.kind === "content_unit" ? live.filter((x) => x.content_unit_id === e.id).length : 0)
    + (e.kind === "release" ? live.filter((x) => x.release_id === e.id).length : 0)
    + (e.kind === "medium" ? live.filter((x) => x.medium_id === e.id).length : 0);
  const sorted = [...g].sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
  const keeper = sorted[0];
  for (const loser of sorted.slice(1)) {
    const sameScope = keeper.work_id === loser.work_id && keeper.release_id === loser.release_id
      && keeper.medium_id === loser.medium_id && keeper.parent_id === loser.parent_id;
    if (sameScope && keeper.status === "published") merges.push({ keeper, loser, dom: domOf(keeper) });
    else console.log("    · " + loser.id.slice(0, 8) + " 作用域不同或 keepr 非 published，无法合并（需人工）");
  }
}

// ── 2) 孤儿（父级缺失或已删除）───────────────────────────────────────────
const all = new Map();
for (const k of KINDS) all.set(k, rows);
const statusOf = (id) => { const e = rows.find((x) => x.id === id); return e ? e.status : "(不存在)"; };
const orphans = [];
for (const e of live) {
  for (const [field, kind] of [["work_id", "work"], ["release_id", "release"], ["medium_id", "medium"], ["parent_id", e.kind], ["content_unit_id", "content_unit"]]) {
    const v = e[field];
    if (!v) continue;
    const st = statusOf(v);
    if (st !== "published" && st !== "draft" && st !== "pending_review") orphans.push({ e, field, missing: v, st });
  }
}
console.log("\n=== 孤儿（父级缺失/已删除）：" + orphans.length + " ===");
for (const o of orphans) console.log("- " + o.e.kind + "「" + o.e.title + "」" + o.e.id + " ." + o.field + " -> " + o.missing + " (" + o.st + ")  属主=" + domOf(o.e));

// ── 3) 写操作（显式开关）─────────────────────────────────────────────────
if (DO_MERGE && merges.length) {
  console.log("\n=== 执行合并 " + merges.length + " 组 ===");
  const ev = { note: "编目战役收尾：合并同领域重复建档（同一真实数据被并发子代理各建一份），保留子级/引用更完整的一条，服务端改写引用。", sources: [{ kind: "self", citation: "scripts/data/campaign/dedupe.mjs 并发战役去重" }] };
  for (const m of merges) {
    const r = await client.call("/api/catalog/entities/" + m.loser.id + "/lifecycle", { method: "POST", body: { target_id: m.keeper.id, expected_version: m.loser.version, edit_note: ev.note, sources: ev.sources } });
    console.log((r.status < 400 ? "OK   " : "FAIL ") + m.loser.kind + " " + m.loser.id.slice(0, 8) + " -> " + m.keeper.id.slice(0, 8) + " " + r.status + " " + JSON.stringify(r.body && r.body.error ? r.body.error : (r.body && r.body.status) || "").slice(0, 120));
  }
}
if (FIX_ORPHANS && orphans.length) {
  console.log("\n=== 清理孤儿 " + orphans.length + " 条 ===");
  const order = { track: 0, medium: 1, expression: 2, content_unit: 3, release: 4, work: 5, agent: 6, collection: 6 };
  for (const o of orphans.sort((a, b) => (order[a.e.kind] ?? 9) - (order[b.e.kind] ?? 9))) {
    if (!mine.has(o.e.id)) { console.log("SKIP(非本战役) " + o.e.id.slice(0, 8)); continue; }
    const r = await client.call("/api/catalog/entities/" + o.e.id + "/lifecycle", { method: "POST", body: { expected_version: o.e.version, edit_note: "编目战役收尾：父级已删除导致结构悬挂，停用该孤儿实体（仅处理本战役创建的条目）。", sources: [{ kind: "self", citation: "scripts/data/campaign/dedupe.mjs 孤儿清理" }] } });
    console.log((r.status < 400 ? "OK   " : "FAIL ") + o.e.kind + " " + o.e.id.slice(0, 8) + " " + r.status);
  }
}
if (!DO_MERGE && !FIX_ORPHANS) console.log("\n（只读报告；加 --merge / --fix-orphans 才写）");
