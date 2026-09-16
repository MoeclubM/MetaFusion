#!/usr/bin/env node
// 写入链路探针：在线上实例上完整走一遍"建实体 → 建关系 → 回读 → 清理"，
// 用来在 20 个领域脚本开工前，证明当前 API 契约（证据校验 / 四语翻译 / 结构归属 /
// 关系端点类型 / 幂等键 / 修订记录 / 生命周期删除）确实可用。全部探针实体随后删除。
//
// 用法：MF_USER_PASS=<admin 口令> node scripts/data/campaign/probe.mjs
// 退出码：0 全绿；1 有断言失败。

import { Campaign, Client, Index, src, sleep } from "./lib.mjs";

const SRC = src("https://findverse.cc/", "写入链路探针：本文件 scripts/data/campaign/probe.mjs 的执行记录");
const NOTE = "编目探针（自动清理）：验证实体创建/关系创建/回读/生命周期删除链路，探针数据随即删除，不作为目录事实。";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : "")); };

const client = new Client();
const me = await (async () => { await client.login(); const r = await client.call("/api/auth/me"); return r.body; })();
check("登录并取得身份", !!me && !!me.id, (me && me.username) + " permissions=" + JSON.stringify((me && me.permissions) || []));

const camp = new Campaign({ domain: "probe", client, index: Index.load() });
const ev = { note: NOTE, sources: [SRC] };
const created = [];

// 1) 实体：collection（无父级）→ work（无父级）→ content_unit（必须带 work_id）
const col = await camp.ensureEntity("collection", "编目探针 Collection（自动清理）", {
  original_language: "zh",
  types: ["collection"],
  translations: { "zh-CN": { title: "编目探针 Collection（自动清理）" }, "zh-TW": { title: "編目探針 Collection（自動清理）" }, "ja-JP": { title: "編目プローブ Collection（自動削除）" }, "en-US": { title: "Catalog probe collection (auto-removed)" } },
  attributes: {}, external_ids: {},
}, ev, { idemKey: "probe-col-1" });
created.push(col);
check("创建 collection", !!col && !!col.id && col.status === "published", (col && col.id) || "");

const work = await camp.ensureEntity("work", "编目探针 Work（自动清理）", {
  original_language: "zh",
  types: ["personal"],
  translations: { "zh-CN": { title: "编目探针 Work（自动清理）" }, "zh-TW": { title: "編目探針 Work（自動清理）" }, "ja-JP": { title: "編目プローブ Work（自動削除）" }, "en-US": { title: "Catalog probe work (auto-removed)" } },
  attributes: {}, external_ids: {},
}, ev, { idemKey: "probe-work-1" });
created.push(work);
check("创建 work", !!work && !!work.id && work.status === "published", (work && work.id) || "");

const unit = await camp.ensureEntity("content_unit", "编目探针 篇目（自动清理）", {
  work_id: work.id, position: 1, number: "1",
  original_language: "zh",
  types: ["content_unit"],
  translations: { "zh-CN": { title: "编目探针 篇目（自动清理）" }, "zh-TW": { title: "編目探針 篇目（自動清理）" }, "ja-JP": { title: "編目プローブ 篇目（自動削除）" }, "en-US": { title: "Catalog probe unit (auto-removed)" } },
  attributes: {}, external_ids: {},
}, ev, { idemKey: "probe-cu-1", allowServerLookup: false });
created.push(unit);
check("创建 content_unit 并带 work_id 结构归属", !!unit && !!unit.id && unit.work_id === work.id, (unit && unit.id) || "");

// 2) 缺证据必须被拒（服务端 evidence_required）——用一个明确的坏载荷验证
const bad = await client.call("/api/catalog/entities", { method: "POST", body: { entity: { kind: "work", title: "编目探针 缺证据", status: "draft", types: [], translations: { "zh-CN": { title: "x" } } }, expected_version: 0, edit_note: "", sources: [] } });
check("缺证据写入被拒", bad.status >= 400 && /evidence|invalid_source/.test(JSON.stringify(bad.body)), bad.status + " " + JSON.stringify(bad.body).slice(0, 120));

// 3) 缺 work_id 的 content_unit 必须被拒（parent_required）
const orphan = await client.call("/api/catalog/entities", { method: "POST", body: { entity: { kind: "content_unit", title: "编目探针 孤儿篇目", status: "draft", types: ["content_unit"], translations: { "zh-CN": { title: "编目探针 孤儿篇目" } }, attributes: {} }, expected_version: 0, edit_note: NOTE, sources: [SRC] } });
check("缺 work_id 的 content_unit 被拒", orphan.status >= 400 && /parent_required/.test(JSON.stringify(orphan.body)), orphan.status + " " + JSON.stringify(orphan.body).slice(0, 120));

// 4) 关系：includes（collection → work，acyclic）
const rel = await camp.createRelation("includes", col.id, work.id, ev, { idemKey: "probe-rel-1", skipIfExists: false });
check("创建 includes 关系", !!rel && !!rel.id, (rel && rel.id) || "");

// 5) 自环必须被拒
const selfRel = await client.call("/api/catalog/relations", { method: "POST", body: { relation: { type: "includes", source_id: col.id, target_id: col.id, position: 0, attributes: {} }, expected_version: 0, edit_note: NOTE, sources: [SRC] } });
check("自环关系被拒", selfRel.status >= 400, selfRel.status + " " + JSON.stringify(selfRel.body).slice(0, 120));

// 6) 回读：实体 / 关系 / 修订
const back = await camp.getEntity(unit.id);
check("回读 content_unit 结构归属一致", back.work_id === work.id, "work_id=" + back.work_id);
const rels = await client.relationsOf(col.id);
check("回读关系含 includes", rels.some((r) => r.type === "includes" && r.target_id === work.id), "count=" + rels.length);
const rev = await client.call("/api/catalog/entities/" + work.id + "/revisions");
check("修订记录可读", rev.status === 200 && ((rev.body && rev.body.items) || []).length >= 1, "revisions=" + ((rev.body && rev.body.items) || []).length);

// 7) 幂等：同 Idempotency-Key 重放不新建实体
const again = await client.call("/api/catalog/entities", { method: "POST", headers: { "Idempotency-Key": "probe-work-1" }, body: { entity: { kind: "work", title: "编目探针 Work（自动清理）", status: "published", types: ["personal"], original_language: "zh", translations: { "zh-CN": { title: "编目探针 Work（自动清理）" } }, attributes: {} }, expected_version: 0, edit_note: NOTE, sources: [SRC] } });
check("Idempotency-Key 重放返回首创结果", again.status === 200 && again.body && again.body.id === work.id, again.status + " id=" + ((again.body && again.body.id) || ""));

// 8) 清理：先删关系，再删除探针实体（生命周期删除，admin 权限）
const del = await client.call("/api/catalog/relations/" + rel.id, { method: "DELETE", body: { expected_version: rel.version, edit_note: NOTE, sources: [SRC] } });
check("删除探针关系", del.status < 400, del.status + " " + JSON.stringify(del.body).slice(0, 120));

for (const e of [...created].reverse()) {
  const fresh = await camp.getEntity(e.id);
  const r = await client.call("/api/catalog/entities/" + e.id + "/lifecycle", { method: "POST", body: { expected_version: fresh.version, target_id: "", edit_note: NOTE, sources: [SRC] } });
  check("删除探针实体 " + e.kind, r.status < 400 && r.body && r.body.status === "deleted", r.status + " " + JSON.stringify(r.body && r.body.status ? r.body.status : r.body).slice(0, 120));
  await sleep(120);
}

const failed = results.filter((r) => !r.ok);
console.log("\n探针结果：" + (results.length - failed.length) + "/" + results.length + " 通过");
if (failed.length) { console.log("失败项：" + failed.map((f) => f.name).join(" / ")); process.exit(1); }
