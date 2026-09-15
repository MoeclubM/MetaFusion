// 一个"真人"编辑者的浏览器行为：只用界面操作，产出实体、修订与关系。
// 供 sim.mjs 调用；目标实例与凭据都走环境变量，脚本本身不含任何凭据。
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// 可移植引用：容器里是常规 node_modules，本机是全局 npm 目录。
let pw;
try { pw = require("playwright"); } catch { pw = require(process.env.APPDATA + "/npm/node_modules/playwright"); }
export const BASE = process.env.MF_BASE || "https://findverse.cc";

export async function login(page, user, pass) {
  // 10 个账号同时起跑会撞上账号服务的限流（5 r/s）：多试几次、退避拉长
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    try {
      await page.locator("input[type=text], input[type=email]").first().fill(user, { timeout: 15000 });
      await page.locator("input[type=password]").first().fill(pass, { timeout: 15000 });
      await page.locator("button[type=submit]").first().click({ timeout: 15000 });
    } catch { await page.waitForTimeout(3000); continue; }
    await page.waitForTimeout(3000 + attempt * 2000);
    const who = await page.evaluate(async () => { try { const r = await fetch("/api/auth/me"); if (!r.ok) return ""; const j = await r.json(); return j.username || ""; } catch { return ""; } });
    if (who === user) return page.url();
    await page.waitForTimeout(2000);
  }
  return "LOGIN_FAILED:" + page.url();
}

// 新建实体：按界面标签定位。顺序与真人一致：层级 → 类型 → 题名 → 状态 → 证据 → 保存。
export async function createEntity(page, opts) {
  const label = (text) => page.locator("label", { hasText: text }).first();
  let ready = false;
  for (let attempt = 0; attempt < 2 && !ready; attempt++) {
    await page.goto(BASE + "/new", { waitUntil: "domcontentloaded", timeout: 60000 });
    try { await label("实体层级").waitFor({ state: "visible", timeout: 12000 }); ready = true; }
    catch { await page.waitForTimeout(1200); }
  }
  if (!ready) return { status: 0, url: page.url(), body: "表单未就绪" };
  await label("实体层级").locator("select").selectOption(opts.kind);
  await page.waitForTimeout(700);
  // 类型复选框来自 definitions：等它渲染出来再勾（并发下加载慢，勾早了会勾到别的字段）
  let typeReady = false;
  for (let w = 0; w < 8 && !typeReady; w++) {
    typeReady = (await page.locator("label:has(input[type=checkbox])").count()) > 0;
    if (!typeReady) await page.waitForTimeout(400);
  }
  if (opts.typeLabel) {
    const t = page.locator("label", { hasText: opts.typeLabel }).first();
    try { await t.waitFor({ state: "visible", timeout: 6000 }); const b = t.locator("input[type=checkbox]"); if (await b.count() && !(await b.isChecked())) await b.check(); } catch {}
  }
  // definitions 加载完成后会重渲染身份区：等稳定再填，并在保存前回读补填
  await page.waitForTimeout(2000);
  const titleInput = label("基础题名").locator("input").first();
  await titleInput.fill(opts.title);
  if (opts.lang) { const og = label("原语言代码").locator("input").first(); if (await og.count()) await og.fill(opts.lang); }
  await label("发布状态").locator("select").selectOption(opts.status || "draft");
  // 结构归属：子层级（expression/medium/track…）必须在「所属与收录结构」区选父级，
  // 否则服务端 parent_required。选择器与关系目标同形：搜索框 + 原生下拉。
  if (opts.parent) {
    const st = page.locator("fieldset", { hasText: "所属与收录结构" }).first();
    await st.waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
    const pl = st.locator("label", { hasText: opts.parent.label }).first();
    const ps = pl.locator('input[placeholder*="搜索实体"]').first();
    const psel = pl.locator("select").first();
    let chosen = "";
    if (await ps.count()) {
      await ps.fill(String(opts.parent.query));
      for (let w = 0; w < 10 && !chosen; w++) {
        await page.waitForTimeout(700);
        const vals = await psel.locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent || "" })).filter((x) => x.v));
        if (vals.length) chosen = (vals.find((x) => x.t.includes(String(opts.parent.query))) || vals[0]).v;
      }
    }
    if (chosen) await psel.selectOption(chosen);
    else return { status: 0, url: page.url(), body: "父级未选中（" + opts.parent.query + "）" };
  }
  // 证据必须按 fieldset 语义定位：页面里还有「多语言题名与别名」的简介/别名 textarea，
  // 用 textarea.first() 会把修改说明写进"别名"，而证据区仍为空 → 客户端校验直接拦下提交。
  const ev = page.locator("fieldset", { hasText: "编辑说明与来源" }).first();
  const note = ev.locator("textarea").first();
  await note.waitFor({ state: "visible", timeout: 12000 });
  await note.fill(opts.note);
  const cite = page.locator('input[placeholder*="来源声明"]').last();
  await cite.waitFor({ state: "visible", timeout: 10000 });
  if ((await cite.inputValue()) !== opts.source) await cite.fill(opts.source);
  if ((await titleInput.inputValue()) !== opts.title) await titleInput.fill(opts.title);
  if ((await note.inputValue()) !== opts.note) await note.fill(opts.note);
  const resp = page.waitForResponse((r) => r.url().includes("/api/catalog/entities") && r.request().method() === "POST", { timeout: 30000 }).catch(() => null);
  const save = page.locator("button", { hasText: "保存" }).first();
  try { await save.waitFor({ state: "visible", timeout: 15000 }); } catch {}
  if (await save.count()) await save.click({ timeout: 15000 }).catch(() => {}); else await page.locator("button[type=submit]").first().click().catch(() => {});
  const res = await resp;
  await page.waitForTimeout(1100);
  let alert = "";
  if (!res) alert = await page.evaluate(() => { const el = document.querySelector("[role=alert], .cv-error"); return el ? (el.textContent || "").trim().slice(0, 120) : ""; }).catch(() => "");
  const text = res ? await res.text().catch(() => "") : "";
  const id = (text.match(/\"id\":\"([0-9a-f-]{36})\"/) || [])[1] || (page.url().match(/\/catalog\/([0-9a-f-]{36})/) || [])[1] || "";
  return { status: res ? res.status() : 0, url: page.url(), id, body: text.slice(0, 160) || alert };
}

// 修改已有实体：详情页 → 编辑条目 → 改题名 → 写说明/来源 → 保存（PUT）。
export async function updateEntity(page, id, tag, agent) {
  // 直接进编辑态（?edit=1）：这正是界面上「编辑作品」按钮跳转的目标路径，
  // 省掉"先渲染详情页、再等编辑按钮出现"这一跳——并发下那一步最容易超时。
  await page.goto(BASE + "/catalog/" + id + "?edit=1", { waitUntil: "domcontentloaded", timeout: 60000 });
  const title = page.locator('label:has-text("基础题名")').locator("input").first();
  try { await title.waitFor({ state: "visible", timeout: 40000 }); } catch { return { status: 0, body: "编辑表单未出现（?edit=1 未生效或权限不足）" }; }
  await page.waitForTimeout(1200);
  const before = await title.inputValue();
  await title.fill(before.replace(/ \[[^\]]*\]$/, "") + " [" + tag + "]");
  const ev = page.locator("fieldset", { hasText: "编辑说明与来源" }).first();
  const note = ev.locator("textarea").first();
  await note.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await note.fill("仿真修订：" + agent + " 更新题名标记 " + tag);
  const cite = page.locator('input[placeholder*="来源声明"]').last();
  if (await cite.count() && !(await cite.inputValue())) await cite.fill("https://example.org/sim/" + agent + "-upd");
  const resp = page.waitForResponse((r) => /\/api\/catalog\/entities\//.test(r.url()) && r.request().method() === "PUT", { timeout: 30000 }).catch(() => null);
  // 并发下保存按钮可能被重渲染：先等它可见可点再点，避免 click 超时
  const saveBtn = page.locator("button", { hasText: "保存" }).first();
  try { await saveBtn.waitFor({ state: "visible", timeout: 15000 }); } catch {}
  await saveBtn.click({ timeout: 15000 }).catch(() => {});
  const res = await resp;
  await page.waitForTimeout(1200);
  let body = "";
  if (!res) body = await page.evaluate(() => { const el = document.querySelector("[role=alert], .cv-error"); return el ? (el.textContent || "").trim().slice(0, 110) : "未提交"; }).catch(() => "");
  return { status: res ? res.status() : 0, body };
}
// 加关系：编辑态关系区 → 选「关系＋方向」→ 搜索框输入 → 从**实体下拉**里选 → 添加关系。
// 注意：候选是原生 <select> 的 option（搜索框只负责查询），不是浮层列表。
export async function addRelation(page, id, relType, targetQuery, agent, attrs) {
  await page.goto(BASE + "/catalog/" + id, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1400);
  const editBtn = page.locator("button", { hasText: "编辑" }).first();
  if (!(await editBtn.count())) return { status: 0, body: "没有编辑入口" };
  await editBtn.click();
  const rel = page.locator("fieldset", { hasText: "关系与署名" }).first();
  try { await rel.waitFor({ state: "visible", timeout: 35000 }); } catch { return { status: 0, body: "关系区未出现" }; }
  const typeSelect = rel.locator("select").first();
  const opts = await typeSelect.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  // 未指定时随机挑一个可用关系类型：只取第一个会让 adaptation_of 独占，覆盖不到其它关系语义
  const pick = relType && opts.includes(relType) ? relType : opts[Math.floor(Math.random() * opts.length)];
  if (!pick) return { status: 0, body: "无可用关系类型" };
  try { await typeSelect.selectOption(pick); } catch { return { status: 200, skipped: true, body: "关系类型未选中，跳过" }; }
  await page.waitForTimeout(1600);
  const search = rel.locator('input[placeholder*="搜索实体"]').first();
  if (!(await search.count())) return { status: 200, skipped: true, body: "目标搜索框未出现，跳过" };
  // 目标候选为空通常是"这个标题的类型不符合该关系要求"：换标题重试，别让整条操作算失败
  const entitySelect0 = rel.locator("select").nth(1);
  const tries = Array.isArray(targetQuery) ? targetQuery : [targetQuery];
  let chosen = "";
  for (const q of tries) {
    await search.fill(String(q));
    for (let w = 0; w < 8 && !chosen; w++) {
      await page.waitForTimeout(600);
      const vs = await entitySelect0.locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: (o.textContent || "") })).filter((x) => x.v));
      if (vs.length) { const hit = vs.find((x) => x.t.includes(String(q))) || vs[0]; chosen = hit.v; }
    }
    if (chosen) break;
  }
  const entitySelect = entitySelect0;
  for (let w = 0; w < 0 && !chosen; w++) {
    await page.waitForTimeout(700);
    const vals = await entitySelect.locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: (o.textContent || "") })).filter((x) => x.v));
    if (vals.length) { const hit = vals.find((x) => x.t.includes(targetQuery)) || vals[0]; chosen = hit.v; }
  }
  // 候选为空是良性分支（该关系类型对目标 kind 有要求，标题不合）：记为跳过，不算失败
  if (!chosen) return { status: 200, skipped: true, body: "无匹配目标，跳过该关系" };
  try { await entitySelect.selectOption(chosen); } catch { return { status: 200, skipped: true, body: "选择目标失败，跳过" }; }
  await page.waitForTimeout(900);
  // 指定了 attrs 就按字段名精确填；否则退化成"尽量填几个"的探索模式。
  if (attrs) { await fillRelationAttrs(page, rel, attrs); }
  const attrFields = attrs ? [] : await rel.evaluate((f) => {
    const out = [];
    Array.from(f.querySelectorAll("label")).forEach((l, idx) => {
      const sel = l.querySelector("select");
      const txt = l.querySelector('input:not([type=checkbox]):not([type=radio])');
      const name = (l.textContent || "").replace(/\s+/g, " ").slice(0, 16);
      if (sel) out.push({ kind: "select", idx, name });
      else if (txt && !(txt.getAttribute("placeholder") || "").includes("搜索实体")) out.push({ kind: "text", idx, name });
    });
    return out;
  });
  let filled = 0;
  for (const fdef of attrFields.slice(0, 2)) {
    const lab = rel.locator("label").nth(fdef.idx);
    if (fdef.kind === "select") {
      const opts = await lab.locator("select").first().locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      if (opts.length) { try { await lab.locator("select").first().selectOption(opts[0]); filled++; } catch {} }
    } else {
      const val = fdef.name.includes("职位") || fdef.name.includes("role") ? "仿真属性值" : "sim-" + agent;
      try { await lab.locator('input:not([type=checkbox])').first().fill(val); filled++; } catch {}
    }
  }
  const ev = page.locator("fieldset", { hasText: "编辑说明与来源" }).first();
  const note = ev.locator("textarea").first();
  if (await note.count() && !(await note.inputValue())) await note.fill("仿真关系：" + agent + " 建立 " + pick);
  const cite = page.locator('input[placeholder*="来源声明"]').last();
  if (await cite.count() && !(await cite.inputValue())) await cite.fill("https://example.org/sim/" + agent + "-rel");
  const resp = page.waitForResponse((r) => r.url().includes("/api/catalog/relations") && r.request().method() === "POST", { timeout: 25000 }).catch(() => null);
  const add = page.locator("button", { hasText: "添加关系" }).first();
  if (!(await add.count())) return { status: 200, skipped: true, body: "没有添加按钮，跳过" };
  try { await add.waitFor({ state: "visible", timeout: 15000 }); } catch {}
  // 必填关系属性没填满时按钮是禁用的（definitions 声明的 required）：这属良性分支，跳过
  if (await add.isDisabled().catch(() => false)) return { status: 200, skipped: true, body: "关系必填字段未满足，跳过" };
  await add.click({ timeout: 15000 }).catch(() => {});
  const res = await resp;
  await page.waitForTimeout(1200);
  let body = "";
  if (!res) body = await page.evaluate(() => { const el = document.querySelector("[role=alert], .cv-error"); return el ? (el.textContent || "").trim().slice(0, 110) : "关系未提交"; }).catch(() => "");
  return { status: res ? res.status() : 0, body };
}

export async function makeBrowser() {
  // 本机用系统 Chrome；Playwright 容器里只有自带 Chromium，故回退到默认通道。
  let browser;
  try { browser = await pw.chromium.launch({ channel: "chrome", headless: true }); }
  catch { browser = await pw.chromium.launch({ headless: true }); }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 130)));
  page.on("response", (r) => { if (r.status() >= 500) problems.push("http " + r.status() + " " + r.url().replace(BASE, "").slice(0, 60)); });
  return { browser, ctx, page, problems };
}
// 关系属性按字段名精确填写：attrs = { "所饰角色": "ドラえもん", "番位": "主角", "语言": "ja" }。
// 标签名来自 definitions 的字段多语言名，所以调用方传的是界面上能看到的名字。
export async function fillRelationAttrs(page, relFieldset, attrs) {
  let filled = 0;
  for (const [labelText, value] of Object.entries(attrs || {})) {
    const lab = relFieldset.locator("label", { hasText: labelText }).first();
    if (!(await lab.count())) continue;
    const sel = lab.locator("select").first();
    const picker = lab.locator('input[placeholder*="搜索实体"]').first();
    const text = lab.locator('input:not([type=checkbox]):not([type=radio])').first();
    if (await picker.count()) {
      // 实体引用：输入标题 → 等下拉出候选 → 选中
      await picker.fill(String(value));
      let chosen = "";
      for (let w = 0; w < 10 && !chosen; w++) {
        await page.waitForTimeout(700);
        const vals = await sel.locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent || "" })).filter((x) => x.v));
        if (vals.length) chosen = (vals.find((x) => x.t.includes(String(value))) || vals[0]).v;
      }
      if (chosen) { await sel.selectOption(chosen); filled++; }
    } else if (await sel.count()) {
      const vals = await sel.locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: (o.textContent || "").trim() })).filter((x) => x.v));
      const hit = vals.find((x) => x.t === String(value) || x.v === String(value) || x.t.includes(String(value))) || vals[0];
      if (hit) { await sel.selectOption(hit.v); filled++; }
    } else if (await text.count()) {
      await text.fill(String(value)); filled++;
    }
  }
  return filled;
}
