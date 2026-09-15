// 一个"真人"编辑者的浏览器行为：只用界面操作，产出实体、关系与修订。
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// 可移植引用：容器里是常规的 node_modules，本机是全局 npm 目录
let pw;
try { pw = require("playwright"); } catch { pw = require(process.env.APPDATA + "/npm/node_modules/playwright"); }
export const BASE = process.env.MF_BASE || "https://findverse.cc";

export async function login(page, user, pass) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    try {
      await page.locator("input[type=text], input[type=email]").first().fill(user, { timeout: 15000 });
      await page.locator("input[type=password]").first().fill(pass, { timeout: 15000 });
      await page.locator("button[type=submit]").first().click({ timeout: 15000 });
    } catch { await page.waitForTimeout(3000); continue; }
    await page.waitForTimeout(3000);
    // 校验真的登录成功：/auth/me 返回 200 且用户名一致
    const who = await page.evaluate(async () => { try { const r = await fetch("/api/auth/me"); if (!r.ok) return ""; const j = await r.json(); return j.username || ""; } catch { return ""; } });
    if (who === user) return page.url();
    await page.waitForTimeout(2000);
  }
  return "LOGIN_FAILED:" + page.url();
}

// 新建实体：按界面标签定位（不依赖 DOM 结构，改版也不易失效）。
// 流程与真人一致：选题材层级 → 勾类型 → 填基础题名 → 写修改说明与来源 → 保存。
export async function createEntity(page, opts) {
  const label = (text) => page.locator("label", { hasText: text }).first();
  // 表单就绪判定：等「实体层级」标签出现；失败重试一次（并发下页面偶发慢）
  let ready = false;
  for (let attempt = 0; attempt < 2 && !ready; attempt++) {
    await page.goto(BASE + "/new", { waitUntil: "domcontentloaded", timeout: 60000 });
    try { await label("实体层级").waitFor({ state: "visible", timeout: 12000 }); ready = true; }
    catch { await page.waitForTimeout(1200); }
  }
  if (!ready) return { status: 0, url: page.url(), body: "表单未就绪" };
  await label("实体层级").locator("select").selectOption(opts.kind);
  await page.waitForTimeout(700);
  // 类型是复选框列表（来自 definitions）：勾一个可用的
  if (opts.typeLabel) {
    const t = page.locator("label", { hasText: opts.typeLabel }).first();
    if (await t.count()) { const b = t.locator("input[type=checkbox]"); if (await b.count() && !(await b.isChecked())) await b.check(); }
  } else {
    const first = page.locator("label:has(input[type=checkbox])").first();
    try { const b = first.locator("input[type=checkbox]"); if (!(await b.isChecked())) await b.check(); } catch {}
  }
  await page.waitForTimeout(400);
  // definitions 加载完成后会重渲染身份区，早填的题名会被清掉：先等它稳定，再填并回读补填。
  await page.waitForTimeout(2000);
  const titleInput = label("基础题名").locator("input").first();
  await titleInput.fill(opts.title);
  if (opts.lang) { const og = label("原语言代码").locator("input").first(); if (await og.count()) await og.fill(opts.lang); }
  await label("发布状态").locator("select").selectOption(opts.status || "draft");
  // 证据：修改说明 + 来源声明。并发下这一段渲染更慢，必须等它可见再填，填完回读确认——
  // 否则客户端校验会直接拦下提交（表现为"没有发出请求"，很容易被误判成服务端问题）。
  // 必须按 fieldset 语义取证据区：页面里还有「多语言题名与别名」的简介/别名 textarea，
  // 用 textarea.first() 会把修改说明写进"别名"，而证据区仍为空 → 校验直接拦下提交。
  const ev = page.locator("fieldset", { hasText: "编辑说明与来源" }).first();
  const note = ev.locator("textarea").first();
  await note.waitFor({ state: "visible", timeout: 12000 });
  await note.fill(opts.note);
  if ((await note.inputValue()) !== opts.note) await note.fill(opts.note);
  const cite = page.locator('input[placeholder*="来源声明"]').last();
  await cite.waitFor({ state: "visible", timeout: 10000 });
  if ((await cite.inputValue()) !== opts.source) await cite.fill(opts.source);
  // 不要动「来源类型」：切到"网页来源"却不填网址会被校验拒绝（且提示只说证据缺失，极易误判）。
  // 与手工探针一致：保持默认自述类型，只填来源声明。
  // 保存前最后一道自检：题名/说明/来源都必须还在（前面任一重渲染都可能清空）
  if ((await titleInput.inputValue()) !== opts.title) await titleInput.fill(opts.title);
  if ((await note.inputValue()) !== opts.note) await note.fill(opts.note);
  if ((await cite.inputValue()) !== opts.source) await cite.fill(opts.source);
  const noteOk = (await note.inputValue()) === opts.note;
  const citeOk = (await cite.inputValue()) === opts.source;
  if (!noteOk || !citeOk) return { status: 0, url: page.url(), body: "证据区未就绪 note=" + noteOk + " cite=" + citeOk };
  const resp = page.waitForResponse((r) => r.url().includes("/api/catalog/entities") && r.request().method() === "POST", { timeout: 30000 }).catch(() => null);
  const save = page.locator("button", { hasText: "保存" }).first();
  if (await save.count()) await save.click(); else await page.locator("button[type=submit]").first().click();
  const res = await resp;
  await page.waitForTimeout(1100);
  // 没发出请求时，把界面上的提示抓出来，便于定位是客户端校验还是别的
  let alert = "";
  if (!res) {
    // 现场快照：把关键字段的当前值、类型勾选状态、按钮禁用情况一起带出来
    alert = await page.evaluate(() => {
      const el = document.querySelector("[role=alert], .cv-error");
      const msg = el ? (el.textContent || "").trim().slice(0, 60) : "";
      const ta = document.querySelector("textarea");
      const cite = document.querySelector('input[placeholder*="来源声明"]');
      const checked = Array.from(document.querySelectorAll("label:has(input[type=checkbox])")).filter((l) => l.querySelector("input").checked).map((l) => (l.innerText || "").trim().slice(0, 8));
      const titleInput = document.querySelector('label input[type=text]');
      const disabled = Array.from(document.querySelectorAll("button")).filter((b) => b.disabled).map((b) => (b.textContent || "").trim().slice(0, 10));
      return msg + " | note=" + JSON.stringify((ta && ta.value || "").slice(0, 18)) + " cite=" + JSON.stringify((cite && cite.value || "").slice(0, 18)) + " title=" + JSON.stringify((titleInput && titleInput.value || "").slice(0, 16)) + " types=" + JSON.stringify(checked) + " disabled=" + JSON.stringify(disabled);
    }).catch((e) => "诊断失败: " + String(e).slice(0, 60));
  }
  return { status: res ? res.status() : 0, url: page.url(), body: res ? (await res.text().catch(() => "")).slice(0, 160) : alert };
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
// 修改已有实体：详情页 → 编辑条目 → 改题名 → 写说明/来源 → 保存（PUT）
export async function updateEntity(page, id, tag, agent) {
  await page.goto(BASE + "/catalog/" + id, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  const editBtn = page.locator("button", { hasText: "编辑" }).first();
  if (!(await editBtn.count())) return { status: 0, body: "没有编辑入口（权限或条目状态不允许）" };
  await editBtn.click();
  const title = page.locator('label:has-text("基础题名")').locator("input").first();
  try { await title.waitFor({ state: "visible", timeout: 25000 }); } catch { return { status: 0, body: "编辑表单未出现" }; }
  const before = await title.inputValue();
  await title.fill(before.replace(/ \[[^\]]*\]$/, "") + " [" + tag + "]");
  const ev = page.locator("fieldset", { hasText: "编辑说明与来源" }).first();
  const note = ev.locator("textarea").first();
  await note.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await note.fill("仿真修订：" + agent + " 更新题名标记 " + tag);
  const cite = page.locator('input[placeholder*="来源声明"]').last();
  if (await cite.count() && !(await cite.inputValue())) await cite.fill("https://example.org/sim/" + agent + "-upd");
  const resp = page.waitForResponse((r) => /\/api\/catalog\/entities\//.test(r.url()) && r.request().method() === "PUT", { timeout: 30000 }).catch(() => null);
  const save = page.locator("button", { hasText: "保存" }).first();
  await save.click();
  const res = await resp;
  await page.waitForTimeout(1500);
  let body = "";
  if (!res) body = await page.evaluate(() => { const el = document.querySelector("[role=alert], .cv-error"); return el ? (el.textContent || "").trim().slice(0, 110) : ""; }).catch(() => "");
  return { status: res ? res.status() : 0, body };
}

// 加关系：在编辑态的关系区选类型 → 选目标 → 提交（关系是独立资源，立即写入）
export async function addRelation(page, id, relType, targetQuery, agent) {
  await page.goto(BASE + "/catalog/" + id, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  const editBtn = page.locator("button", { hasText: "编辑" }).first();
  if (!(await editBtn.count())) return { status: 0, body: "没有编辑入口" };
  await editBtn.click();
  await page.waitForTimeout(2200);
  const relSelect = page.locator('label:has-text("关系类型")').locator("select").first();
  if (!(await relSelect.count())) return { status: 0, body: "关系区未出现" };
  const opts = await relSelect.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  const pick = relType && opts.includes(relType) ? relType : opts[0];
  if (!pick) return { status: 0, body: "无可用关系类型" };
  await relSelect.selectOption(pick);
  await page.waitForTimeout(1500);
  // 目标选择器：关系区里的搜索框（placeholder 含搜索/题名）
  const search = page.locator('input[placeholder*="搜索"], input[placeholder*="题名"]').last();
  if (!(await search.count())) return { status: 0, body: "目标选择器未出现" };
  await search.fill(targetQuery);
  await page.waitForTimeout(2000);
  const item = page.locator("li, button, div").filter({ hasText: targetQuery }).first();
  if (!(await item.count())) return { status: 0, body: "找不到目标条目" };
  await item.click();
  await page.waitForTimeout(1200);
  const ev = page.locator("fieldset", { hasText: "编辑说明与来源" }).first();
  const note = ev.locator("textarea").first();
  if (await note.count() && !(await note.inputValue())) await note.fill("仿真关系：" + agent + " 建立 " + pick);
  const cite = page.locator('input[placeholder*="来源声明"]').first();
  if (await cite.count() && !(await cite.inputValue())) await cite.fill("https://example.org/sim/" + agent + "-rel");
  const resp = page.waitForResponse((r) => r.url().includes("/api/catalog/relations") && r.request().method() === "POST", { timeout: 30000 }).catch(() => null);
  const add = page.locator("button", { hasText: "添加" }).first();
  if (await add.count()) await add.click(); else return { status: 0, body: "没有添加按钮" };
  const res = await resp;
  await page.waitForTimeout(1500);
  return { status: res ? res.status() : 0, body: res ? "" : "关系未提交（客户端校验或未选中目标）" };
}