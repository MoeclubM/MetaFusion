#!/usr/bin/env node
// 战役数据落地审计：日志说"建了"，实例上是不是真有？
//
// 背景：服务端的幂等缓存键是「路由|用户|Idempotency-Key」且不做载荷哈希，
// 同一个键的第二次调用会被当成重放、直接返回**首条**结果（200 + 首条 id）——
// 调用方以为写成功，实际那条边/实体根本没落库。本脚本只读审计每个领域日志里的
// 实体与关系是否真的存在于实例上，专门抓这类"静默丢失"。
//
// 用法：MF_USER_PASS=… node scripts/data/campaign/audit-relations.mjs

import fs from "node:fs";
import path from "node:path";
import { Client, LOG_DIR } from "./lib.mjs";

const client = new Client();
await client.login();

const KINDS = ["agent", "collection", "work", "content_unit", "expression", "release", "medium", "track"];
const liveIds = new Set();
for (const k of KINDS) for (const e of await client.listKind(k)) liveIds.add(e.id);

const files = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl") && f !== "probe.jsonl") : [];
const report = [];
let totalMissingEntities = 0, totalMissingEdges = 0;

for (const f of files) {
  const domain = f.replace(/\.jsonl$/, "");
  const rows = fs.readFileSync(path.join(LOG_DIR, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const entityRows = rows.filter((r) => (r.op === "entity" || r.op === "entity-update") && r.id);
  const relRows = rows.filter((r) => r.op === "relation" && r.status === "created" && r.code && r.code.includes("→"));

  const missingEntities = [...new Set(entityRows.filter((r) => !liveIds.has(r.id)).map((r) => r.kind + "「" + r.title + "」" + r.id))];

  // 关系：按日志里记录的 "src8→tgt8" 前缀对，用 relationsOf(每个参与实体) 复核边是否真的存在
  const expected = new Map();
  for (const r of relRows) {
    const [s, t] = r.code.split("→");
    expected.set(s + "→" + t + "|" + r.title, r);
  }
  const ids = [...new Set(entityRows.map((r) => r.id))];
  const actual = new Set();
  let cursor = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      for (const rel of await client.relationsOf(id)) {
        if (rel.via) continue;
        actual.add(rel.source_id.slice(0, 8) + "→" + rel.target_id.slice(0, 8) + "|" + rel.type);
      }
    }
  });
  await Promise.all(workers);
  const missingEdges = [...expected.keys()].filter((k) => !actual.has(k)).map((k) => expected.get(k).title + " " + k);

  totalMissingEntities += missingEntities.length;
  totalMissingEdges += missingEdges.length;
  report.push({ domain, entities: entityRows.length, relationsLogged: expected.size, missingEntities, missingEdges });
  console.log(domain.padEnd(26) + " 实体日志 " + String(entityRows.length).padStart(4)
    + " · 关系日志 " + String(expected.size).padStart(4)
    + " · 缺失实体 " + missingEntities.length + " · 缺失边 " + missingEdges.length);
  for (const m of missingEdges.slice(0, 8)) console.log("    ✗ " + m);
}

const out = path.join(LOG_DIR, "audit-relations.json");
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), totalMissingEntities, totalMissingEdges, report }, null, 2), "utf8");
console.log("\n合计：缺失实体 " + totalMissingEntities + " · 缺失关系边 " + totalMissingEdges);
console.log("明细：" + out);
