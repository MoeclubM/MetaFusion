// 分波仿真：node sim2.mjs <agents> <opsPerAgent> [startIndex]
// 并发 3、错峰启动、每次操作带重试，结果写 JSONL 便于跨波次统计。
import fs from "fs";
import { login, createEntity, updateEntity, addRelation, makeBrowser } from "./human.mjs";

const AGENTS = Number(process.argv[2] || 3);
const OPS = Number(process.argv[3] || 40);
const START = Number(process.argv[4] || 1);
// MF_AGENTS="1,3,7" 可指定任意账号组合（默认是 startIndex 起连续 AGENTS 个）：
// 每轮的波次优先补进度最少的账号，避免总是同一组先跑满。
const AGENT_LIST = (process.env.MF_AGENTS || "").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
const PASS = process.env.MF_USER_PASS;
const OUT = (process.env.MF_LOG_DIR || "C:/Users/QwQ/AppData/Local/Temp/mf-ui") + "/";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const WAVE = process.argv[5] || "w" + Date.now();
// 只创建可独立存在的层级：content_unit/expression 必须有 work_id、medium 必须有 release_id、
  // track 必须有 medium_id（服务端 parent_required），在"新建"表单里没有父级可选的场景下先不建它们。
const KINDS = ["work", "agent", "collection", "release", "work", "agent"];
const TYPES = { work: ["动画", "电影", "专辑", "小说"], agent: ["个人", "团体", "虚构角色"], collection: [], release: [], expression: [] };

async function runAgent(n) {
  const agent = "sim" + String(n).padStart(2, "0");
  // 每次波次一个独立日志文件：多波次并发写同一文件会让失败原因互相覆盖
  const log = fs.createWriteStream(OUT + "run-" + WAVE + "-" + agent + ".jsonl", { flags: "a" });
  const { browser, page, problems } = await makeBrowser();
  let ok = 0, fail = 0, created = [], createdTitles = [];
  try {
    const url = await login(page, agent, PASS);
    if (String(url).startsWith("LOGIN_FAILED")) { log.write(JSON.stringify({ action: "login-failed", url }) + "\n"); console.log("[" + agent + "] 登录失败 " + url); log.end(); await browser.close(); return { agent, ok, fail, login: false }; }
    let relogins = 0;
    for (let i = 1; i <= OPS; i++) {
      const kind = KINDS[i % KINDS.length];
      const types = TYPES[kind] || [];
      const typeLabel = types.length ? types[i % types.length] : undefined;
      const title = agent + "-" + kind + "-" + i;
      // 混合负载：约 1/4 的操作是"修改已有实体"（更接近真人的编辑分布，也能覆盖编辑入口与 PUT 路径）
      const useUpdate = i % 4 === 3 && created.length > 0;
      // 约 1/5 的操作建关系：目标用同批已建的作品标题去搜（覆盖关系链路与实体选择器）
      const useRel = i % 5 === 0 && createdTitles.length > 2 && created.length > 2;
      let r = { status: 0, url: "", body: "" };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          r = useRel
            ? await addRelation(page, created[(i * 3) % created.length], null, createdTitles.slice().sort(() => Math.random() - 0.5).slice(0, 3), agent)
            : useUpdate
              ? await updateEntity(page, created[(i * 7) % created.length], "u" + i, agent)
              : await createEntity(page, { kind, typeLabel, title, lang: "ja", status: "draft", note: "仿真：" + agent + " 新建第 " + i + " 条（" + kind + "）", source: "https://example.org/sim/" + agent + "/" + i });
        } catch (e) { r = { status: 0, url: page.url(), body: String(e).slice(0, 80) }; }
        if (r.status === 200 || r.status === 201) break;
        await page.waitForTimeout(2000);
      }
      const id = r.id || "";
      if (r.status === 200 || r.status === 201) { ok++; created.push(id); if (!useUpdate && !useRel) createdTitles.push(title); }
      else {
        fail++;
        // 401 = 会话失效（令牌过期且续期失败、或被登出）：真人会重新登录后继续，
        // 这里照做（每个账号最多 2 次），避免一次掉线把整波作废。
        if (r.status === 401 && relogins < 2) {
          relogins++;
          const again = await login(page, agent, PASS);
          log.write(JSON.stringify({ i, action: "relogin", attempt: relogins, url: String(again).slice(0, 40) }) + "\n");
        }
      }
      log.write(JSON.stringify({ wave: WAVE, i, action: useRel ? "relation" : useUpdate ? "update" : "create", kind, title, status: r.status, id, body: String(r.body).slice(0, 110) }) + "\n");
      if (i % 10 === 0) console.log("[" + agent + "] " + i + "/" + OPS + " ok=" + ok + " fail=" + fail);
    }
  } catch (e) {
    log.write(JSON.stringify({ action: "agent-error", err: String(e).slice(0, 160) }) + "\n");
    console.log("[" + agent + "] 中断: " + String(e).slice(0, 110));
  }
  log.write(JSON.stringify({ action: "wave-summary", ok, fail, created: created.length, problems: problems.slice(0, 4) }) + "\n");
  log.end();
  await browser.close();
  return { agent, ok, fail, login: true, problems: problems.slice(0, 2) };
}

// 并发上限 3，错峰 4 秒启动
const queue = AGENT_LIST.length ? AGENT_LIST.slice() : Array.from({ length: AGENTS }, (_, k) => START + k);
const results = [];
const CONCURRENCY = Number(process.env.MF_CONCURRENCY || 2);
const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async (_, w) => {
  while (queue.length) {
    const n = queue.shift();
    await new Promise((r) => setTimeout(r, 4000 * w));
    results.push(await runAgent(n));
  }
});
await Promise.all(workers);
let ok = 0, fail = 0;
for (const r of results) { ok += r.ok; fail += r.fail; console.log(r.agent + ": ok=" + r.ok + " fail=" + r.fail + (r.login ? "" : "（登录失败）") + (r.problems && r.problems.length ? " | " + JSON.stringify(r.problems) : "")); }
console.log("本波合计: ok=" + ok + " fail=" + fail);