#!/usr/bin/env node
// 线上名称四语补齐：只改名称字段，别的数据一律不碰。
//
// 为什么需要它：名称四语齐备已经是写入硬约束，但线上实例的存量行是"约束之前"写进去的：
//   · catalog 外部权威库 35 条只有 zh-CN / en-US；
//   · 货架 creations 的日文位填的是简中写法；
//   · 账号服务的 6 个系统权限组 descriptions 只有 zh-CN / en-US。
// 新版部署后启动回填会自动处理；实例还没升级时用本脚本把数据补齐（幂等，可重复跑）。
//
// 用法（凭据只走环境变量，不写进仓库）：
//   BASE=https://findverse.cc ADMIN_USER=admin ADMIN_PASSWORD=*** node scripts/data/live-name-locales.mjs
//   ... 同上 ... 加上 --apply 才真正写入；不带 --apply 是预演。
//
// 译文不写死在本脚本里，而是解析种子源码（避免脚本与种子漂移）：
//   --catalog-seeds  默认 backend/internal/catalog
//   --auth-seeds     默认 ../metafusion-auth/internal/store/seed_groups.go（找不到就跳过权限组）

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const BASE = (process.env.BASE || "https://findverse.cc").replace(/\/+$/, "");
const USER = process.env.ADMIN_USER || "admin";
const PASSWORD = process.env.ADMIN_PASSWORD || "";
const CATALOG_SEEDS = argOf("--catalog-seeds", path.join("backend", "internal", "catalog"));
const AUTH_SEEDS = argOf("--auth-seeds", path.join("..", "metafusion-auth", "internal", "store", "seed_groups.go"));
const LOCALES = ["zh-CN", "zh-TW", "ja-JP", "en-US"];

if (!PASSWORD) {
  console.error("缺少 ADMIN_PASSWORD（凭据只走环境变量）");
  process.exit(2);
}

async function api(pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "MetaFusion-LiveNames/1.0 (+https://findverse.cc)",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

// 种子解析：格式由 backend/internal/catalog/external_databases.go 与 shelves.go 决定，
// 解析失败就报错退出，绝不"猜"译文。
function parseNameMap(text) {
  const out = {};
  for (const m of text.matchAll(/"([A-Za-z-]+)":\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]] = JSON.parse('"' + m[2] + '"');
  }
  return out;
}
function readCatalogSeeds() {
  const extText = fs.readFileSync(path.join(CATALOG_SEEDS, "external_databases.go"), "utf8");
  const shelfText = fs.readFileSync(path.join(CATALOG_SEEDS, "shelves.go"), "utf8");
  const external = {};
  for (const m of extText.matchAll(/\{Code: "([a-z0-9_]+)", Names: map\[string\]string\{([^}]*)\}/g)) {
    external[m[1]] = parseNameMap(m[2]);
  }
  const shelves = {};
  for (const m of shelfText.matchAll(/\{Slug: "([a-z0-9_]+)", Names: map\[string\]string\{([^}]*)\}/g)) {
    shelves[m[1]] = parseNameMap(m[2]);
  }
  if (!Object.keys(external).length || !Object.keys(shelves).length) {
    throw new Error("种子解析为空，检查 --catalog-seeds 指向的目录");
  }
  return { external, shelves };
}
function readAuthGroupSeeds() {
  if (!fs.existsSync(AUTH_SEEDS)) return {};
  const text = fs.readFileSync(AUTH_SEEDS, "utf8");
  const out = {};
  for (const m of text.matchAll(/code:\s*"([a-z_]+)",[\s\S]*?names: map\[string\]string\{([^}]*)\},\s*desc:\s*map\[string\]string\{([^}]*)\}/g)) {
    out[m[1]] = { names: parseNameMap(m[2]), desc: parseNameMap(m[3]) };
  }
  return out;
}

// 补齐规则（只增不改 + 只换"拿中文顶替日文"这一种已知脏值）：
//   · 缺键或空值 → 用种子译文补；
//   · 日文位与繁中位逐字相同、种子给出的日文与繁中不同 → 判为中文占位，换成种子日文；
//   · 已有的人工译文（与种子不同且非上述占位）一律不动。
function mergeNames(cur, seed) {
  const out = { ...(cur || {}) };
  const filled = [];
  for (const loc of LOCALES) {
    const want = seed[loc];
    if (!want) continue;
    const now = (out[loc] || "").trim();
    if (!now) { out[loc] = want; filled.push(loc); }
  }
  // ja 键只在种子本身使用它时补：目录种子写 ja + ja-JP，账号服务的名称表只用 ja-JP，
  // 给账号侧加一个 ja 会破坏那边的规范键序（nameLocaleOrder）。
  for (const loc of ["ja", "ja-JP"]) {
    const want = loc === "ja" ? seed["ja"] : seed["ja-JP"] || seed["ja"];
    if (!want) continue;
    const now = (out[loc] || "").trim();
    const zhTW = (out["zh-TW"] || "").trim();
    const seedZhTW = (seed["zh-TW"] || "").trim();
    if (!now) { out[loc] = want; filled.push(loc); continue; }
    if (now === zhTW && want !== seedZhTW) { out[loc] = want; filled.push(loc + "(换占位)"); }
  }
  return { merged: out, filled };
}

const report = [];
function note(what, detail) { report.push({ what, detail }); console.log("- " + what + ": " + detail); }

(async () => {
  const { external, shelves } = readCatalogSeeds();
  const groups = readAuthGroupSeeds();
  const login = await api("/api/auth/login", { method: "POST", body: { username: USER, password: PASSWORD } });
  if (login.status !== 200 || !login.body?.token) {
    console.error("登录失败：" + login.status + " " + JSON.stringify(login.body));
    process.exit(1);
  }
  const token = login.body.token;
  console.log("已登录 " + BASE + "（" + USER + "，模式：" + (APPLY ? "写入" : "预演") + "）\n");

  // 1) 外部权威库
  const ext = await api("/api/admin/external-databases", { token });
  if (ext.status !== 200) { console.error("读外部权威库失败：" + ext.status + " " + JSON.stringify(ext.body)); process.exit(1); }
  console.log("外部权威库 " + ext.body.items.length + " 条");
  for (const item of ext.body.items) {
    const seed = external[item.code];
    if (!seed) { note("跳过未知外部库", item.code); continue; }
    const { merged, filled } = mergeNames(item.names, seed);
    if (!filled.length) continue;
    if (!APPLY) { note("待补 " + item.code, filled.join(",")); continue; }
    const res = await api("/api/admin/external-databases/" + item.code, { method: "PUT", token, body: { ...item, names: merged } });
    note("已补 " + item.code, filled.join(",") + " -> " + res.status);
    if (res.status !== 200) console.error("   失败：" + JSON.stringify(res.body));
  }

  // 2) 货架
  const sh = await api("/api/admin/shelves", { token });
  if (sh.status !== 200) { console.error("读货架失败：" + sh.status + " " + JSON.stringify(sh.body)); process.exit(1); }
  console.log("\n货架 " + sh.body.items.length + " 个");
  for (const item of sh.body.items) {
    const seed = shelves[item.slug];
    if (!seed) { note("跳过未在种子里的货架", item.slug); continue; }
    const { merged, filled } = mergeNames(item.names, seed);
    if (!filled.length) continue;
    if (!APPLY) { note("待补货架 " + item.slug, filled.join(",")); continue; }
    const res = await api("/api/admin/shelves/" + item.id, { method: "PUT", token, body: { ...item, names: merged } });
    note("已补货架 " + item.slug, filled.join(",") + " -> " + res.status);
    if (res.status !== 200) console.error("   失败：" + JSON.stringify(res.body));
  }

  // 3) 账号服务系统权限组（描述）
  if (!Object.keys(groups).length) {
    console.log("\n跳过权限组：未找到种子文件 " + AUTH_SEEDS);
  } else {
    const gr = await api("/api/admin/groups", { token });
    if (gr.status !== 200) { console.error("读权限组失败：" + gr.status + " " + JSON.stringify(gr.body)); process.exit(1); }
    console.log("\n权限组 " + gr.body.items.length + " 个（种子 " + Object.keys(groups).length + " 个）");
    for (const item of gr.body.items) {
      const seed = groups[item.code];
      if (!seed) continue;
      const n = mergeNames(item.names, seed.names);
      const d = mergeNames(item.descriptions, seed.desc);
      const filled = [...n.filled.map((x) => "names." + x), ...d.filled.map((x) => "descriptions." + x)];
      if (!filled.length) continue;
      if (!APPLY) { note("待补权限组 " + item.code, filled.join(",")); continue; }
      const res = await api("/api/admin/groups/" + item.code, { method: "PUT", token, body: { ...item, names: n.merged, descriptions: d.merged } });
      note("已补权限组 " + item.code, filled.join(",") + " -> " + res.status);
      if (res.status !== 200) console.error("   失败：" + JSON.stringify(res.body));
    }
  }

  // 4) 回读核对：四语齐备才算完
  console.log("\n回读核对：");
  const gaps = [];
  const check = (label, names) => {
    const missing = LOCALES.filter((l) => !(names || {})[l] || !String(names[l]).trim());
    if (missing.length) gaps.push(label + " 缺 " + missing.join(","));
  };
  const ext2 = await api("/api/admin/external-databases", { token });
  for (const item of ext2.body.items) check("external_databases." + item.code, item.names);
  const sh2 = await api("/api/admin/shelves", { token });
  for (const item of sh2.body.items) check("shelves." + item.slug, item.names);
  if (Object.keys(groups).length) {
    const gr2 = await api("/api/admin/groups", { token });
    for (const item of gr2.body.items) {
      if (!groups[item.code]) continue;
      check("groups." + item.code + ".names", item.names);
      check("groups." + item.code + ".descriptions", item.descriptions);
    }
  }
  console.log(gaps.length ? "仍有缺口：\n  " + gaps.join("\n  ") : "全部四语齐备");
  console.log("\n" + (APPLY ? "改动 " : "预演待补 ") + report.filter((r) => !r.what.startsWith("跳过")).length + " 项");
})();
