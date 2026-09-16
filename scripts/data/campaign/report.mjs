#!/usr/bin/env node
// 编目战役汇总：把各领域脚本写出的日志与摘要聚合成一份可读报告（只读本地文件 + 可选回读实例）。
//
// 用法：node scripts/data/campaign/report.mjs [--check]
//   --check 会登录实例，按日志里的 id 抽检实体是否真实存在（默认只读本地）。

import fs from "node:fs";
import path from "node:path";
import { Client, LOG_DIR } from "./lib.mjs";

const CHECK = process.argv.includes("--check");
const files = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR) : [];
const domains = [...new Set(files.filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, "")))]
  .filter((d) => d !== "probe");

const perDomain = [];
const byKind = {};
let totals = { created: 0, reused: 0, relations: 0, relReused: 0, failed: 0 };
const allFailed = [];

for (const d of domains) {
  const rows = fs.readFileSync(path.join(LOG_DIR, d + ".jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const createdEntities = rows.filter((r) => r.op === "entity" && r.status === "created");
  const createdRelations = rows.filter((r) => r.op === "relation" && r.status === "created");
  const reused = rows.filter((r) => r.op === "entity" && (r.status === "reuse" || r.status === "reuse-server"));
  const relReused = rows.filter((r) => r.op === "relation" && r.status === "reuse");
  const failed = rows.filter((r) => r.status === "FAIL" || (r.status === "FAIL"));
  const kinds = {};
  for (const r of createdEntities) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  for (const [k, v] of Object.entries(kinds)) byKind[k] = (byKind[k] || 0) + v;
  totals.created += createdEntities.length;
  totals.reused += reused.length;
  totals.relations += createdRelations.length;
  totals.relReused += relReused.length;
  totals.failed += failed.length;
  for (const f of failed) allFailed.push(d + ": " + JSON.stringify(f));
  perDomain.push({
    domain: d, entities: createdEntities.length, kinds,
    relations: createdRelations.length, reused: reused.length, relReused: relReused.length,
    failed: failed.length, lastTs: rows[rows.length - 1] ? rows[rows.length - 1].ts : "",
  });
}

perDomain.sort((a, b) => b.entities - a.entities);

const lines = [];
lines.push("# 编目战役汇总");
lines.push("");
lines.push("- 领域数：" + perDomain.length + "（日志目录 " + LOG_DIR + "）");
lines.push("- 新建实体 " + totals.created + " · 复用存量实体 " + totals.reused
  + " · 新建关系 " + totals.relations + " · 复用关系 " + totals.relReused + " · 失败 " + totals.failed);
lines.push("- 按 kind：" + Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + "=" + v).join(" / "));
lines.push("");
lines.push("| 领域 | 实体 | 关系 | 复用实体 | 失败 | 分层 |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const d of perDomain) {
  lines.push("| " + d.domain + " | " + d.entities + " | " + d.relations + " | " + d.reused + " | " + d.failed + " | "
    + Object.entries(d.kinds).map(([k, v]) => k + ":" + v).join(" ") + " |");
}
if (allFailed.length) {
  lines.push("");
  lines.push("## 失败明细");
  lines.push("");
  for (const f of allFailed.slice(0, 200)) lines.push("- " + f);
}
lines.push("");

if (CHECK) {
  const client = new Client();
  await client.login();
  const sample = perDomain.slice(0, 4);
  lines.push("## 实例抽检（最近日志里的实体 id 是否真实存在）");
  lines.push("");
  for (const d of sample) {
    const rows = fs.readFileSync(path.join(LOG_DIR, d.domain + ".jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const ids = rows.filter((r) => r.op === "entity" && r.status === "created" && r.id).slice(0, 3);
    for (const it of ids) {
      const r = await client.call("/api/catalog/entities/" + it.id);
      lines.push("- " + d.domain + " " + it.kind + "「" + it.title + "」-> " + r.status + (r.body && r.body.id === it.id ? " 存在" : " 不存在"));
    }
  }
  lines.push("");
}

const out = path.join(LOG_DIR, "CAMPAIGN-SUMMARY.md");
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log(lines.join("\n"));
console.log("\n写入 " + out);
