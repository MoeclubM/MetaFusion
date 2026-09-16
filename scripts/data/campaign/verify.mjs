#!/usr/bin/env node
// 全库只读完整性校验（编目战役验收工具）。
//
// 口径：以**实例实际响应**为准，不读数据库、不假设服务端没做过的校验。
//   A 结构归属：work_id / release_id / medium_id / parent_id / content_unit_id 的作用域与必填
//   B 承载链：track.contents → expression 存在；表达的 Work 必须在该 Release 的 subjects 中声明
//   C 创作链：expression 的 work_id / content_unit_id 归属；篇目覆盖率
//   D 关系：自环、端点存在、类型-两端 kind、无环类型的环检测
//   E 多语言：四语题名缺失与"某语种逐字等于英文"的占位
//   F 统计：按 kind 计数、与基线快照（docs-local/data-campaign/entity-index.json）的增量
//
// 用法：MF_USER_PASS=… node scripts/data/campaign/verify.mjs [--json]
// 退出码：0 = 无 P0/P1；1 = 存在 P0/P1。

import fs from "node:fs";
import path from "node:path";
import { Client, Index } from "./lib.mjs";

const BASE = process.env.MF_BASE || "https://findverse.cc";
const KINDS = ["agent", "collection", "work", "content_unit", "expression", "release", "medium", "track"];
const ACYCLIC = ["adaptation_of", "alternate_take_of", "bonus_included_in", "cover_of", "includes", "member_of",
  "pressing_of", "revision_of", "sequel_of", "soundtrack_of", "spin_off_of", "store_bonus_for", "translation_of"];
const REL_ENDPOINTS = {   // 来自线上 definitions：type → [source_kinds, target_kinds]
  adaptation_of: [["work"], ["work"]], alternate_take_of: [["expression"], ["expression"]],
  arranged_by: [["work", "expression"], ["agent"]], bonus_included_in: [["expression"], ["release", "medium"]],
  character_in: [["agent"], ["work", "collection"]], composed_by: [["work", "content_unit", "expression"], ["agent"]],
  cover_of: [["expression"], ["expression"]], created_by: [["work", "content_unit", "expression", "release"], ["agent"]],
  credit_for: [["work", "content_unit", "expression", "release"], ["agent"]],
  developed_by: [["work", "content_unit", "expression", "release"], ["agent"]],
  directed_by: [["work", "content_unit"], ["agent"]],
  illustrated_by: [["work", "content_unit", "release"], ["agent"]],
  includes: [["collection", "work"], ["work", "collection"]],
  lyricist_of: [["work", "content_unit", "expression"], ["agent"]], member_of: [["agent"], ["agent"]],
  modeled_by: [["work", "content_unit", "expression", "release"], ["agent"]],
  narrated_by: [["expression", "release"], ["agent"]],
  performed_by: [["work", "content_unit", "expression", "release"], ["agent"]],
  photographed_by: [["work", "content_unit", "expression", "release"], ["agent"]],
  pressing_of: [["release"], ["release"]], revision_of: [["expression"], ["expression"]],
  sequel_of: [["work"], ["work"]], soundtrack_of: [["work"], ["work"]], spin_off_of: [["work"], ["work"]],
  store_bonus_for: [["expression", "release"], ["agent"]], translated_by: [["work", "content_unit", "expression"], ["agent"]],
  translation_of: [["expression"], ["expression"]], voiced_by: [["work", "content_unit", "expression", "release"], ["agent"]],
  written_by: [["work", "content_unit"], ["agent"]],
};

const P0 = [], P1 = [], P2 = [];
const add = (bucket, msg) => bucket.push(msg);

const client = new Client();
await client.login();

// ── 全量拉取（写路径不受限，列表路由 120/分钟，Client 内已按 Retry-After 退避）────────
const byId = new Map();
for (const kind of KINDS) {
  const rows = await client.listKind(kind);
  for (const e of rows) byId.set(e.id, e);
  console.log("拉取 " + kind + " × " + rows.length);
}
const entities = [...byId.values()];
const live = entities.filter((e) => e.status !== "deleted" && e.status !== "merged");
const liveIds = new Set(live.map((e) => e.id));
const kindOf = (id) => { const e = byId.get(id); return e ? e.kind : null; };
const titleOf = (id) => { const e = byId.get(id); return e ? e.title : "(缺失)"; };

// 基线快照：区分"战役新增"与"存量问题"
const baseline = Index.load();
const baselineIds = new Set(baseline.rows.map((r) => r.id));
const isNew = (id) => !baselineIds.has(id);
const tag = (id) => (isNew(id) ? "[新增]" : "[存量]") + id.slice(0, 8) + " ";

// ── A 结构归属 ────────────────────────────────────────────────────────────
for (const e of live) {
  const ref = (val, expectKinds, field) => {
    if (!val) return;
    const t = byId.get(val);
    if (!t) { add(P0, tag(e.id) + e.kind + "「" + e.title + "」." + field + " 指向不存在的实体 " + val); return; }
    if (t.status === "deleted" || t.status === "merged") add(P0, tag(e.id) + e.kind + "「" + e.title + "」." + field + " 指向已删除实体 " + t.kind + "「" + t.title + "」");
    if (!expectKinds.includes(t.kind)) add(P0, tag(e.id) + e.kind + "「" + e.title + "」." + field + " 指向错误层级 " + t.kind);
    return t;
  };
  if (e.kind === "content_unit") {
    if (!e.work_id) add(P0, tag(e.id) + "content_unit「" + e.title + "」缺 work_id");
    else ref(e.work_id, ["work"], "work_id");
    if (e.parent_id) {
      const p = ref(e.parent_id, ["content_unit"], "parent_id");
      if (p && e.work_id && p.work_id !== e.work_id) add(P0, tag(e.id) + "content_unit「" + e.title + "」parent 跨 Work：" + p.work_id + " ≠ " + e.work_id);
    }
  }
  if (e.kind === "expression") {
    if (e.parent_id) add(P0, tag(e.id) + "expression「" + e.title + "」不允许有 parent_id（表达层不是目录树）");
    if (!e.work_id) add(P0, tag(e.id) + "expression「" + e.title + "」缺 work_id");
    else ref(e.work_id, ["work"], "work_id");
    if (e.content_unit_id) {
      const u = ref(e.content_unit_id, ["content_unit"], "content_unit_id");
      if (u && e.work_id && u.work_id !== e.work_id) add(P0, tag(e.id) + "expression「" + e.title + "」content_unit 跨 Work");
    }
  }
  if (e.kind === "release") {
    if (e.work_id) add(P0, tag(e.id) + "release「" + e.title + "」不允许有 work_id（收录走 subjects）");
    if (!e.subjects || !e.subjects.length) add(P2, tag(e.id) + "release「" + e.title + "」没有任何 subjects");
  }
  if (e.kind === "medium") {
    if (!e.release_id) add(P0, tag(e.id) + "medium「" + e.title + "」缺 release_id");
    else ref(e.release_id, ["release"], "release_id");
    if (e.parent_id) {
      const p = ref(e.parent_id, ["medium"], "parent_id");
      if (p && e.release_id && p.release_id !== e.release_id) add(P0, tag(e.id) + "medium「" + e.title + "」parent 跨 Release");
    }
  }
  if (e.kind === "track") {
    if (!e.medium_id) add(P0, tag(e.id) + "track「" + e.title + "」缺 medium_id");
    else ref(e.medium_id, ["medium"], "medium_id");
    if (e.parent_id) {
      const p = ref(e.parent_id, ["track"], "parent_id");
      if (p && e.medium_id && p.medium_id !== e.medium_id) add(P0, tag(e.id) + "track「" + e.title + "」parent 跨 Medium");
    }
  }
  if (e.kind === "work" || e.kind === "agent" || e.kind === "collection") {
    for (const f of ["work_id", "release_id", "medium_id", "parent_id", "content_unit_id"]) {
      if (e[f]) add(P1, tag(e.id) + e.kind + "「" + e.title + "」不该有结构字段 " + f);
    }
  }
}

// ── B/C 承载链与创作链 ────────────────────────────────────────────────────
const releases = live.filter((e) => e.kind === "release");
const mediums = live.filter((e) => e.kind === "medium");
const tracks = live.filter((e) => e.kind === "track");
const expressions = live.filter((e) => e.kind === "expression");
const units = live.filter((e) => e.kind === "content_unit");
const works = live.filter((e) => e.kind === "work");

const coveredWorks = new Set();
let trackContentRefs = 0;
let releaseWithContents = 0;
for (const r of releases) {
  const subj = new Set((r.subjects || []).map((s) => s.work_id));
  const ms = mediums.filter((m) => m.release_id === r.id);
  const ts = tracks.filter((t) => ms.some((m) => m.id === t.medium_id));
  let refs = 0;
  for (const t of ts) {
    const seenPos = new Set();
    for (const c of t.contents || []) {
      refs++; trackContentRefs++;
      if (seenPos.has(c.position)) add(P1, tag(t.id) + "track「" + t.title + "」contents position 重复 " + c.position);
      seenPos.add(c.position);
      const ex = byId.get(c.expression_id);
      if (!ex) { add(P0, tag(r.id) + "release「" + r.title + "」的 track「" + t.title + "」contents 指向不存在的 expression " + c.expression_id); continue; }
      if (ex.kind !== "expression") add(P0, tag(r.id) + "release「" + r.title + "」contents 引用非 expression：" + ex.kind);
      if (ex.work_id && !subj.has(ex.work_id)) {
        add(P0, tag(r.id) + "release「" + r.title + "」收录了未声明的 Work「" + titleOf(ex.work_id) + "」（服务端 undeclared_release_subject 应当已拦）");
      }
      for (const s of subj) coveredWorks.add(s);
    }
  }
  if (refs) releaseWithContents++;
  else if (r.status === "published") add(P2, tag(r.id) + "release「" + r.title + "」没有带 contents 的 Track（承载链只到 Medium）");
  if (!ms.length && r.status === "published") add(P2, tag(r.id) + "release「" + r.title + "」没有 Medium");
}

// 创作链覆盖率
let exprWithUnit = 0, exprTotal = 0;
const worksWithUnit = new Set(units.map((u) => u.work_id));
for (const ex of expressions) { exprTotal++; if (ex.content_unit_id) exprWithUnit++; }
const worksWithExpr = new Set(expressions.map((e) => e.work_id));
const worksWithRelease = new Set();
for (const r of releases) for (const s of r.subjects || []) worksWithRelease.add(s.work_id);

// ── D 关系 ───────────────────────────────────────────────────────────────
const edges = new Map();
let cursor = 0;
const ids = live.map((e) => e.id);
async function worker() {
  while (cursor < ids.length) {
    const id = ids[cursor++];
    const r = await client.call("/api/catalog/entities/" + id + "/relations");
    for (const rel of (r.body && r.body.items) || []) if (!rel.via) edges.set(rel.id, rel);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log("拉取关系边 " + edges.size + " 条");
const rels = [...edges.values()];

const graphAll = new Map();
for (const rel of rels) {
  graphAll.set(rel.type, graphAll.get(rel.type) || []);
  graphAll.get(rel.type).push(rel);
  if (rel.source_id === rel.target_id) add(P0, "关系自环 " + rel.type + " " + rel.id);
  for (const [end, id] of [["source", rel.source_id], ["target", rel.target_id]]) {
    const e = byId.get(id);
    if (!e) { add(P0, "关系 " + rel.type + " 的 " + end + " 端点不存在 " + id); continue; }
    if (e.status === "deleted" || e.status === "merged") add(P1, "关系 " + rel.type + " 的 " + end + " 端点已删除：" + e.kind + "「" + e.title + "」");
    const spec = REL_ENDPOINTS[rel.type];
    if (!spec) { add(P1, "关系码不在已核对清单：" + rel.type); continue; }
    const want = end === "source" ? spec[0] : spec[1];
    if (!want.includes(e.kind)) add(P1, "关系 " + rel.type + " 的 " + end + " 端 kind=" + e.kind + "（应为 " + want.join("/") + "）：" + e.title);
  }
}
// 无环类型：DFS 找环
function findCycle(type, list) {
  const adj = new Map();
  for (const r of list) { if (!adj.has(r.source_id)) adj.set(r.source_id, []); adj.get(r.source_id).push(r.target_id); }
  const color = new Map(); // 0/undefined 未访问 · 1 在栈上 · 2 已完成
  const stack = [];
  let cycle = null;
  const dfs = (n) => {
    color.set(n, 1); stack.push(n);
    for (const m of adj.get(n) || []) {
      if (cycle) return true;
      if (color.get(m) === 1) { cycle = [...stack.slice(stack.indexOf(m)), m]; return true; }
      if (!color.has(m) && dfs(m)) return true;
    }
    color.set(n, 2); stack.pop(); return false;
  };
  for (const n of [...adj.keys()]) { if (!color.has(n)) dfs(n); if (cycle) break; }
  return cycle;
}
for (const type of ACYCLIC) {
  const list = graphAll.get(type) || [];
  if (!list.length) continue;
  const cyc = findCycle(type, list);
  if (cyc) add(P0, "无环关系 " + type + " 存在环：" + cyc.map((i) => titleOf(i)).join(" → "));
}

// ── D2 重复建档（幂等键变更/重跑最容易踩的坑）─────────────────────────────
const dupKey = (e) => [e.kind, e.title.replace(/\s+/g, "").toLowerCase(), e.work_id || "", e.release_id || "",
  e.medium_id || "", e.parent_id || "", e.number || ""].join("|");
const dupGroups = new Map();
for (const e of live) {
  if (!isNew(e.id)) continue;                     // 只看本次战役新增，存量重复另论
  const k = dupKey(e);
  if (!dupGroups.has(k)) dupGroups.set(k, []);
  dupGroups.get(k).push(e);
}
for (const [, arr] of dupGroups) {
  if (arr.length > 1) add(P1, "疑似重复建档：" + arr[0].kind + "「" + arr[0].title + "」×" + arr.length
    + "（" + arr.map((x) => x.id).join(", ") + "）");
}

// ── E 多语言 ─────────────────────────────────────────────────────────────
const LOCALES = ["zh-CN", "zh-TW", "en-US"];
let missingLoc = 0, placeholder = 0, noTranslation = 0;
for (const e of live) {
  const tr = e.translations || {};
  const keys = Object.keys(tr);
  if (!keys.length) { noTranslation++; add(P1, tag(e.id) + e.kind + "「" + e.title + "」没有任何翻译行"); continue; }
  const en = (tr["en-US"] || {}).title;
  const miss = LOCALES.filter((l) => !(tr[l] || {}).title);
  if (miss.length) { missingLoc++; add(P2, tag(e.id) + e.kind + "「" + e.title + "」缺语种 " + miss.join(",")); }
  if (en) {
    const same = keys.filter((l) => l !== "en-US" && (tr[l] || {}).title && (tr[l] || {}).title === en);
    if (same.length === keys.length - 1 && keys.length > 1) { placeholder++; add(P2, tag(e.id) + e.kind + "「" + e.title + "」各语种题名与 en-US 逐字相同（英文占位）"); }
  }
}

// ── F 统计 ───────────────────────────────────────────────────────────────
const counts = {};
for (const k of KINDS) counts[k] = { total: live.filter((e) => e.kind === k).length, added: live.filter((e) => e.kind === k && isNew(e.id)).length };
console.log("\n=== 层级统计（↑新增）===");
for (const k of KINDS) console.log("  " + k.padEnd(13) + counts[k].total + " (+" + counts[k].added + ")");
console.log("  relations    " + rels.length + " (+" + rels.filter((r) => isNew(r.id)).length + ")");

const chainStats = {
  works: works.length,
  worksWithContentUnit: worksWithUnit.size,
  worksWithExpression: worksWithExpr.size,
  worksWithRelease: worksWithRelease.size,
  expressions: exprTotal,
  expressionsWithContentUnit: exprWithUnit,
  trackContentRefs,
  releasesWithTrackContents: releaseWithContents,
};

const report = { base: BASE, generatedAt: new Date().toISOString(), counts, chainStats, P0, P1, P2 };
const outDir = "docs-local/data-campaign/logs";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "verify-report.json"), JSON.stringify(report, null, 2), "utf8");

const lines = [];
lines.push("# 线上数据完整性校验报告");
lines.push("");
lines.push("- 实例：" + BASE + "（管理员只读遍历，未写入）");
lines.push("- 生成时间：" + report.generatedAt);
lines.push("- 实体：活体 " + live.length + " 条（含草稿）；关系边 " + rels.length + " 条");
lines.push("");
lines.push("## 层级统计");
lines.push("");
lines.push("| kind | 总数 | 本次新增 |");
lines.push("| --- | --- | --- |");
for (const k of KINDS) lines.push("| " + k + " | " + counts[k].total + " | " + counts[k].added + " |");
lines.push("| relations | " + rels.length + " | " + rels.filter((r) => isNew(r.id)).length + " |");
lines.push("");
lines.push("## 链路覆盖");
lines.push("");
lines.push("- Work " + chainStats.works + " 部；有篇目的 " + chainStats.worksWithContentUnit + "；有表达的 " + chainStats.worksWithExpression + "；出现在发行 subjects 里的 " + chainStats.worksWithRelease);
lines.push("- Expression " + chainStats.expressions + " 条，其中挂到篇目 " + chainStats.expressionsWithContentUnit + " 条");
lines.push("- Track contents 引用 " + chainStats.trackContentRefs + " 处，分布在 " + chainStats.releasesWithTrackContents + " 个发行");
lines.push("");
for (const [name, bucket] of [["P0 结构/完整性错误（必须修）", P0], ["P1 明确问题", P1], ["P2 提示/口径", P2]]) {
  lines.push("## " + name + "（" + bucket.length + "）");
  lines.push("");
  for (const m of bucket.slice(0, 400)) lines.push("- " + m);
  if (bucket.length > 400) lines.push("- …还有 " + (bucket.length - 400) + " 条，见 verify-report.json");
  lines.push("");
}
fs.writeFileSync(path.join(outDir, "verify-report.md"), lines.join("\n"), "utf8");

console.log("\n=== 完整性校验 ===");
console.log("  P0 结构/完整性错误 " + P0.length);
console.log("  P1 明确问题 " + P1.length);
console.log("  P2 提示/口径 " + P2.length);
for (const m of P0.slice(0, 25)) console.log("  P0 " + m);
for (const m of P1.slice(0, 15)) console.log("  P1 " + m);
console.log("\n报告：docs-local/data-campaign/logs/verify-report.md");
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
process.exit(P0.length || P1.length ? 1 : 0);
