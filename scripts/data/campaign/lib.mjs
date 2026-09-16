#!/usr/bin/env node
// MetaFusion 真实数据补录共用工具库（编目战役）。
//
// 目的：领域脚本只写"这条真实数据长什么样、建哪些层级"，HTTP 细节（登录、限流重试、
// 幂等键、证据校验、回读）统一收敛在这里，避免 20 个脚本各写一套客户端。
//
// 约定（全部来自实例实测，见 docs-local/data-campaign/BRIEF.md）：
//   · 入口是 /api，没有版本前缀；实体走 POST/PUT /api/catalog/entities，关系走 POST /api/catalog/relations；
//   · 每次写入必须带 edit_note + 至少一条 sources（kind=url/publication/self，citation 必填）；
//   · 创建实体/关系支持 Idempotency-Key（24h，进程内存）；更新靠 expected_version；
//   · 列表类 GET 按 IP+路由限流（120/分钟），429 带 Retry-After，库内自动等待重试；
//   · 凭据只从环境变量 MF_USER_PASS 读，绝不落盘、绝不写进仓库。

import fs from "node:fs";
import path from "node:path";

export const BASE = (process.env.MF_BASE || "https://findverse.cc").replace(/\/+$/, "");
export const USER = process.env.MF_USER || "admin";
export const PASS = process.env.MF_USER_PASS || "";
export const DRY = process.argv.includes("--dry-run");
export const INDEX_PATH = process.env.MF_ENTITY_INDEX || "docs-local/data-campaign/entity-index.json";
export const LOG_DIR = process.env.MF_LOG_DIR || "docs-local/data-campaign/logs";
const UA = "MetaFusion-Campaign/1.0 (+https://findverse.cc)";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 证据：edit_note + sources（服务端强制校验，缺一即 evidence_required）。 */
export function evidence(note, sources) {
  if (!note || !String(note).trim()) throw new Error("evidence 缺少 edit_note");
  const list = (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
  if (!list.length) throw new Error("evidence 至少需要一条来源");
  return {
    edit_note: String(note),
    sources: list.map((s) => {
      const out = { kind: s.kind || "url", citation: String(s.citation || "").trim() };
      if (s.url) out.url = s.url;
      if (!out.citation) throw new Error("source.citation 必填");
      return out;
    }),
  };
}
/** 常用来源简写：src("https://...", "页面标题 / 取哪几个字段") */
export const src = (url, citation) => ({ kind: "url", url, citation });

export class Client {
  constructor({ base = BASE, user = USER, pass = PASS } = {}) {
    this.base = base;
    this.user = user;
    this.pass = pass;
    this.token = "";
  }

  async login(attempt = 0) {
    if (!this.pass) throw new Error("缺少 MF_USER_PASS 环境变量（口令只走环境变量）");
    const r = await fetch(this.base + "/api/auth/login", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.user, password: this.pass }),
    });
    const j = await r.json().catch(() => ({}));
    const token = j.token || j.access_token;
    if (!r.ok || !token) {
      if (r.status >= 500 && attempt < 3) { await sleep(1500 * (attempt + 1)); return this.login(attempt + 1); }
      throw new Error("登录失败 " + r.status + " " + JSON.stringify(j).slice(0, 200));
    }
    this.token = token;
    return token;
  }

  /** 统一调用：429 按 Retry-After 等待重试，401 重登一次，5xx 指数退避。 */
  async call(pathname, { method = "GET", body, headers = {}, retry = 0 } = {}) {
    if (!this.token) await this.login();
    const h = { "User-Agent": UA, Accept: "application/json", Authorization: "Bearer " + this.token, ...headers };
    let payload;
    if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(this.base + pathname, { method, headers: h, body: payload });
    const text = await r.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; } }
    if (r.status === 429 && retry < 8) {
      const wait = Number(r.headers.get("retry-after") || 5);
      await sleep((Math.max(1, wait) + 1) * 1000);
      return this.call(pathname, { method, body, headers, retry: retry + 1 });
    }
    if (r.status === 401 && retry < 2) { await this.login(); return this.call(pathname, { method, body, headers, retry: retry + 1 }); }
    if (r.status >= 500 && retry < 4) { await sleep(1200 * (retry + 1)); return this.call(pathname, { method, body, headers, retry: retry + 1 }); }
    return { status: r.status, body: json };
  }

  get(p) { return this.call(p); }

  /** 一次性精确检索（走服务端 q=，用得起就少用：列表路由 120/分钟）。 */
  async search(kind, q, extra = "") {
    const r = await this.call("/api/catalog/entities?kind=" + kind + "&q=" + encodeURIComponent(q) + "&limit=50" + extra);
    return (r.body && r.body.items) || [];
  }

  async listKind(kind, { status } = {}) {
    const out = [];
    let offset = 0;
    for (;;) {
      const r = await this.call("/api/catalog/entities?kind=" + kind + "&limit=50&offset=" + offset + (status ? "&status=" + status : ""));
      const items = (r.body && r.body.items) || [];
      out.push(...items);
      if (items.length < 50) return out;
      offset += 50;
      await sleep(150);
    }
  }

  async relationsOf(id) {
    const r = await this.call("/api/catalog/entities/" + id + "/relations");
    return (r.body && r.body.items) || [];
  }
}

export class Index {
  static load(file = INDEX_PATH) {
    try {
      const rows = JSON.parse(fs.readFileSync(file, "utf8"));
      return new Index(Array.isArray(rows) ? rows : []);
    } catch {
      return new Index([]);
    }
  }
  constructor(rows = []) { this.rows = rows; }

  add(e) {
    if (!e || !e.id) return;
    // 按 id 覆盖而不是"有就跳过"：列表接口分页可能重复返回同一实体，
    // 同一个 id 第二次带新题名/新归属时必须刷新，否则后续查重会用陈旧值误建重复实体。
    const i = this.rows.findIndex((r) => r.id === e.id);
    const row = {
      id: e.id, kind: e.kind, title: e.title, status: e.status, types: (e.types || []).join("|"),
      original_language: e.original_language, work_id: e.work_id, release_id: e.release_id,
      medium_id: e.medium_id, parent_id: e.parent_id, number: e.number,
    };
    if (i >= 0) this.rows[i] = row; else this.rows.push(row);
  }

  byId(id) { return this.rows.find((r) => r.id === id) || null; }

  /** 精确查重：kind + 题名（+ 可选结构归属），用于"命中即复用"。 */
  find(kind, title, scope = {}) {
    const t = norm(title);
    return this.rows.find((r) => r.kind === kind && norm(r.title) === t
      && (!scope.work_id || r.work_id === scope.work_id)
      && (!scope.release_id || r.release_id === scope.release_id)
      && (!scope.medium_id || r.medium_id === scope.medium_id)
      && (!scope.parent_id || r.parent_id === scope.parent_id)
      && (scope.number === undefined || String(r.number || "") === String(scope.number))
      && (scope.types === undefined || r.types === scope.types)) || null;
  }

  /** 模糊查找：题名包含（用于"是不是已经有人录过"的初判）。 */
  search(query, kind) {
    const q = norm(query);
    if (!q) return [];
    return this.rows.filter((r) => (!kind || r.kind === kind) && norm(r.title).includes(q));
  }
}
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

/** 实体更新时回写的字段白名单：PUT 是整实体替换，只带服务端认识的键（DisallowUnknownFields）。 */
const ENTITY_KEYS = ["id", "kind", "version", "title", "original_language", "translations", "types", "attributes",
  "external_ids", "pictures", "status", "created_by", "redirect_id", "work_id", "content_unit_id", "release_id",
  "medium_id", "parent_id", "position", "number", "contents", "subjects"];

export class Campaign {
  constructor({ domain, client, index, logDir = LOG_DIR, structure = null } = {}) {
    if (!domain) throw new Error("Campaign 需要 domain 名");
    this.domain = domain;
    this.client = client || new Client();
    this.index = index || Index.load();
    this.logDir = logDir;
    this.created = { entity: 0, relation: 0 };
    this.reused = { entity: 0, relation: 0 };
    this.failed = [];
    this.rows = [];
    fs.mkdirSync(this.logDir, { recursive: true });
    this.logFile = path.join(this.logDir, domain + ".jsonl");
    if (structure) this.structure = structure;
  }

  log(row) {
    const rec = { ts: new Date().toISOString(), domain: this.domain, ...row };
    this.rows.push(rec);
    if (!DRY) fs.appendFileSync(this.logFile, JSON.stringify(rec) + "\n", "utf8");
    const mark = row.op === "relation" ? "  · " : "";
    console.log(mark + [row.op, row.status, row.kind, row.title || "", row.id || "", row.code || ""].filter(Boolean).join(" | "));
    return rec;
  }

  /** 创建实体（幂等：命中索引即复用，不重复建）。返回实体对象（含 id）。 */
  async ensureEntity(kind, title, spec, ev, { idemKey, scope = {}, allowServerLookup = true } = {}) {
    // 同名不同性质的实体（电影「君の名は。」vs 其 OST 专辑「君の名は。」）在只按题名查重时会被合并，
    // 造成"表达/篇目挂错作品、关系挂到专辑上"。声明了 types 就把它纳入复用判定。
    // 实测踩到过：第一次重跑时 OST 专辑 Work 被当成电影 Work 复用。
    const wantTypes = spec && Array.isArray(spec.types) ? spec.types : [];
    const typesOf = (x) => (Array.isArray(x.types) ? x.types : String(x.types || "").split("|")).filter(Boolean);
    const typeOk = (x) => wantTypes.length === 0 || wantTypes.some((w) => typesOf(x).includes(w));
    const hitRow = this.index.find(kind, title, scope);
    const hit = hitRow && typeOk(hitRow) ? hitRow : null;
    if (hit) { this.reused.entity++; this.log({ op: "entity", status: "reuse", kind, title, id: hit.id }); return hit; }
    if (allowServerLookup) {
      // 结构实体（篇目/表达/载体/轨道）题名高度重复（"第1話"、"Track 1"），必须带父级作用域过滤，
      // 否则会误判成同名同类而错误复用别人的条目。服务端支持 work_id/release_id/medium_id/parent_id 过滤。
      const scopeQ = ["work_id", "release_id", "medium_id", "parent_id"].filter((k) => scope[k]).map((k) => "&" + k + "=" + scope[k]).join("");
      const r = await this.client.call("/api/catalog/entities?kind=" + kind + "&q=" + encodeURIComponent(title) + "&limit=50" + scopeQ);
      const found = ((r.body && r.body.items) || []).find((x) => typeOk(x) && norm(x.title) === norm(title)
        && (!scope.work_id || x.work_id === scope.work_id)
        && (!scope.release_id || x.release_id === scope.release_id)
        && (!scope.medium_id || x.medium_id === scope.medium_id)
        && (!scope.parent_id || x.parent_id === scope.parent_id)
        && (scope.number === undefined || String(x.number || "") === String(scope.number)));
      if (found) { this.reused.entity++; this.index.add(found); this.log({ op: "entity", status: "reuse-server", kind, title, id: found.id }); return found; }
    }
    const entity = { kind, title, status: "published", ...spec };
    if (DRY) { this.log({ op: "entity", status: "dry-run", kind, title }); return { id: "DRY-" + kind + "-" + String(title).slice(0, 20), ...entity }; }
    const body = { entity, expected_version: 0, ...evidence(ev.note, ev.sources) };
    // 同 createRelation：幂等键按载荷派生，避免不同实体共用一个键时被当成重放（200 返回首创结果，实体静默缺失）。
    // 标题 + 父级作用域还不够：同名不同版次（黑胶版 vs CD 版、限定盤 vs 通常盤）会被服务端当成重放，
    // 第二个 POST 直接返回首创结果、第二片载体并进同一条发行（实测踩到过）。把载荷摘要并入键，
    // 既保留"同一载荷重跑即幂等"，又让不同版次各自成条。
    const auto = [kind, encodeURIComponent(String(title)), scope.work_id || "", scope.release_id || "", scope.medium_id || "", scope.parent_id || "", digest(JSON.stringify(sortedObj({ ...spec, translations: undefined, id: undefined })))].join("|");
    const headers = { "Idempotency-Key": headerKey((idemKey ? idemKey + "|" : "") + auto) };
    const r = await this.client.call("/api/catalog/entities", { method: "POST", body, headers });
    if (r.status >= 400) {
      const code = (r.body && (r.body.error || r.body.message)) || JSON.stringify(r.body).slice(0, 200);
      this.failed.push({ op: "entity", kind, title, status: r.status, code });
      this.log({ op: "entity", status: "FAIL", kind, title, code: r.status + " " + code });
      const err = new Error(kind + "「" + title + "」创建失败 " + r.status + " " + code);
      err.http = r.status; err.code = code;
      throw err;
    }
    this.created.entity++;
    this.index.add(r.body);
    this.log({ op: "entity", status: "created", kind, title, id: r.body.id, code: (r.body.types || []).join("+") });
    return r.body;
  }

  async getEntity(id) {
    const r = await this.client.call("/api/catalog/entities/" + id);
    if (r.status !== 200) throw new Error("回读实体失败 " + id + " -> " + r.status);
    return r.body;
  }

  /** 整实体替换：先读全量，改 patch 里给的键，其余原样带回。 */
  async updateEntity(id, patch, ev) {
    if (DRY) { this.log({ op: "entity-update", status: "dry-run", id }); return { id }; }
    const cur = await this.getEntity(id);
    const entity = {};
    for (const k of ENTITY_KEYS) if (cur[k] !== undefined) entity[k] = cur[k];
    Object.assign(entity, patch);
    const body = { entity, expected_version: cur.version, ...evidence(ev.note, ev.sources) };
    const r = await this.client.call("/api/catalog/entities/" + id, { method: "PUT", body });
    if (r.status >= 400) {
      const code = (r.body && (r.body.error || r.body.message)) || JSON.stringify(r.body).slice(0, 200);
      this.failed.push({ op: "entity-update", id, title: entity.title, status: r.status, code });
      this.log({ op: "entity-update", status: "FAIL", kind: entity.kind, title: entity.title, id, code: r.status + " " + code });
      const err = new Error("更新 " + id + " 失败 " + r.status + " " + code);
      err.http = r.status; err.code = code;
      throw err;
    }
    this.created.entity++;
    this.index.add(r.body);
    this.log({ op: "entity-update", status: "updated", kind: r.body.kind, title: r.body.title, id: r.body.id, code: "v" + r.body.version });
    return r.body;
  }

  /** 创建关系（幂等：同 type+两端+关键属性 已存在即跳过）。
   *
   * 幂等键必须**由载荷自身派生**：服务端的幂等缓存键是「路由|用户|Idempotency-Key」，不做载荷哈希，
   * 同一键的第二次调用会被当成重放、直接返回首条结果（200 + 首条 id），后面那条边**静默丢失**。
   * 实测踩到过：同一 Work 的多条 character_in 共用一个 "…type+target" 键，5 条只落 1 条。 */
  async createRelation(type, sourceId, targetId, ev, { position = 0, attributes = {}, idemKey, skipIfExists = true } = {}) {
    if (sourceId === targetId) throw new Error("关系两端相同（服务端会拒自环）：" + type);
    if (skipIfExists) {
      const exist = await this.client.relationsOf(sourceId);
      const dup = exist.find((x) => x.type === type && x.source_id === sourceId && x.target_id === targetId && !x.via
        && keyAttrs(x.attributes) === keyAttrs(attributes));
      if (dup) { this.reused.relation++; this.log({ op: "relation", status: "reuse", title: type, id: dup.id, code: sourceId.slice(0, 8) + "→" + targetId.slice(0, 8) }); return dup; }
    }
    if (DRY) { this.log({ op: "relation", status: "dry-run", title: type, code: sourceId.slice(0, 8) + "→" + targetId.slice(0, 8) }); return { id: "DRY-REL" }; }
    const body = { relation: { type, source_id: sourceId, target_id: targetId, position, attributes }, expected_version: 0, ...evidence(ev.note, ev.sources) };
    const auto = [type, sourceId, targetId, position, encodeURIComponent(keyAttrs(attributes))].join("|");
    const headers = { "Idempotency-Key": headerKey((idemKey ? idemKey + "|" : "") + auto) };
    const r = await this.client.call("/api/catalog/relations", { method: "POST", body, headers });
    if (r.status >= 400) {
      const code = (r.body && (r.body.error || r.body.message)) || JSON.stringify(r.body).slice(0, 200);
      this.failed.push({ op: "relation", type, sourceId, targetId, status: r.status, code });
      this.log({ op: "relation", status: "FAIL", title: type, code: r.status + " " + code });
      const err = new Error("关系 " + type + " 创建失败 " + r.status + " " + code);
      err.http = r.status; err.code = code;
      throw err;
    }
    this.created.relation++;
    this.log({ op: "relation", status: "created", title: type, id: r.body.id, code: sourceId.slice(0, 8) + "→" + targetId.slice(0, 8) });
    return r.body;
  }

  /** 领域脚本收尾：写一份可读摘要，便于主代理汇总。 */
  summary(extra = {}) {
    const out = {
      domain: this.domain,
      base: BASE,
      dryRun: DRY,
      created: this.created,
      reused: this.reused,
      failed: this.failed,
      ...extra,
    };
    if (!DRY) {
      fs.mkdirSync(this.logDir, { recursive: true });
      fs.writeFileSync(path.join(this.logDir, this.domain + "-summary.json"), JSON.stringify(out, null, 2), "utf8");
    }
    console.log("\n=== " + this.domain + " 汇总 ===");
    console.log("新建实体 " + this.created.entity + " / 复用 " + this.reused.entity
      + " / 新建关系 " + this.created.relation + " / 复用关系 " + this.reused.relation
      + " / 失败 " + this.failed.length);
    if (this.failed.length) console.log("失败明细：" + JSON.stringify(this.failed, null, 2));
    return out;
  }
}

/** HTTP 头值只能是 ASCII：幂等键里带中文（题名/人名）会让 undici 直接抛 ByteString 异常、
 * 整轮写入中断。统一在这里转义并夹长度。 */
const headerKey = (s) => {
  const v = String(s);
  // 纯 ASCII 时保持原样：键值一变，24h 幂等缓存就失效，"重跑"会变成"再建一份"。
  return /^[\x20-\x7E]*$/.test(v) ? v.slice(0, 250) : encodeURIComponent(v).slice(0, 250);
};

const keyAttrs = (a) => JSON.stringify(sortedObj(a || {}));

/** djb2：把载荷摘要并进幂等键（键必须稳定，重跑同载荷要得到同一个键）。 */
const digest = (s) => { let h = 5381; const v = String(s); for (let i = 0; i < v.length; i++) h = ((h * 33) ^ v.charCodeAt(i)) >>> 0; return h.toString(36); };
function sortedObj(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}