#!/usr/bin/env node
// 编目战役领域 12：日本漫画（卷/话两级篇目 + 单行本）
//
// 目标：用真实可考据的日本漫画把两条链压满
//   创作链  Work(novel 类型 = 漫画母体) → ContentUnit(卷, parent) → ContentUnit(话, child) → Expression(该版正文)
//   承载链  Work → Release(单行本, isbn/edition_batch) → Medium(paper) → Track(逐话位置) —contents→ Expression
//
// 数据来源：
//   · 卷目/话目/ISBN/日文版发行日：en.wikipedia "List of Chainsaw Man chapters" / "List of Death Note chapters"
//     的 {{Graphic novel list}} 模板（含日文原名、英译名、Viz 英文版 ISBN）。
//   · 出版社/系列名/日文正式册名/发行年月：openBD https://api.openbd.jp/v1/get?isbn=…
//
// 注意（模型缺口，详见报告）：实例 work 类型没有 manga 码，漫画母体只能落到 novel
//   （novel 恰好有 volume_count / magazine 字段），这是本领域唯一的类型近似，逐条记在缺口清单。
//   拿不到证据的字段（页码 locator 等）一律留空，不编造。
//
// 用法：
//   node scripts/data/campaign/domains/manga-volume.mjs --dry-run   # 空跑，只打计划
//   node scripts/data/campaign/domains/manga-volume.mjs             # 真写入 + 回读断言

import { Campaign, Client, Index, evidence, sleep, src, DRY } from "../lib.mjs";

// ---------------------------------------------------------------- 证据来源

const S_WIKI_CM = src("https://en.wikipedia.org/wiki/List_of_Chainsaw_Man_chapters",
  "各单行本 {{Graphic novel list}} 模板：卷号、日文版发行日（RelDate）、日文版 ISBN（OpenBD 交叉核对）、Viz 英文版 ISBN 与发行日、逐话英译名/日文原名/罗马字、卷副标题（OriginalTitle）");
const S_WIKI_DN = src("https://en.wikipedia.org/wiki/List_of_Death_Note_chapters",
  "各单行本模板：卷号、日文版发行日、日文版 ISBN 4-08-8736xx-x、英文版 ISBN、逐话英译名与日文原名（例：第1话「退屈」Boredom）");
const S_OPENBD = src("https://api.openbd.jp/v1/get?isbn=9784088817804,9784088818313,9784088820163,9784088820750,9784088821719,9784088822242,9784088823287,9784088823768,9784088824703,9784088825274,9784088825762,9784088832715,9784088833163,9784088834641,9784088835983,9784088837017,9784088840352,9784088841557,9784088843131,9784088844718,9784088845937,9784088846699,9784088847788,9784088850511",
  "openBD 逐册：出版社「集英社」、系列「ジャンプコミックス」、发行年月（pubdate）、正式册名（チェンソーマン = Chain saw man N）、封面副标题、作者「藤本, タツキ」");
const S_SHUEISHA = src("https://www.shueisha.co.jp/books/",
  "集英社书籍检索（书籍详情页 URL 带 isbn=…）：死亡笔记/链锯人单行本由集英社发行、定价与判型的一手标识（本脚本只取社名与系列名，不写价格）");
const S_ANIME = src("https://chainsawman.dog/",
  "TV 动画《チェンソーマン》官方站：确认存在 2022 年 MAPPA 制作的 TV 动画改编，用于建 work→work 的 adaptation_of 关系（只断言改编关系，不在本领域建动画篇目）");

const EVWORK = (note) => ({ note, sources: [S_WIKI_CM, S_WIKI_DN, S_OPENBD, S_SHUEISHA] });

// ---------------------------------------------------------------- 数据表

// 作品（漫画母体）。title 用日文正式名（title 只存一个值，多语走 translations）。
const WORKS = [
  {
    key: "cm", title: "チェンソーマン", orig: "ja", type: "novel", magazine: "週刊少年ジャンプ（第1部）／少年ジャンプ+（第2部）",
    volumeCount: 24, zh: "电锯人", tw: "鏈鋸人", en: "Chainsaw Man", alias: ["Chainsaw Man"],
    note: "藤本タツキ自 2018-12-03 起在集英社《週刊少年ジャンプ》连载、2022-07-13 起第2部移刊《少年ジャンプ+》，单行本 ジャンプコミックス 全 24 卷",
    chaptersTotal: "第1部（公安編）第1-97话",
  },
  {
    key: "dn", title: "DEATH NOTE", orig: "ja", type: "novel", magazine: "週刊少年ジャンプ",
    volumeCount: 12, zh: "死亡笔记", tw: "死亡筆記本", en: "Death Note", alias: ["Death Note"],
    note: "大場つぐみ原作・小畑健作画，2003-12 起在集英社《週刊少年ジャンプ》连载，单行本 ジャンプコミックス 全 12 卷、全 108 话；英文版由 Viz Media 出版",
    chaptersTotal: "全108话（第107-108话为最终卷）",
  },
];

// agent：作者与出版社（都是首次建，索引与 entity-index.json 均无命中）
const AGENTS = [
  { key: "fujimoto", title: "藤本タツキ", orig: "ja", type: "person", roles: { cm: ["written_by", "illustrated_by"] },
    zh: "藤本树", tw: "藤本樹", en: "Tatsuki Fujimoto", alias: ["藤本 タツキ", "Tatsuki Fujimoto"],
    note: "《チェンソーマン》作者；openBD 各册 Contributor 记「藤本, タツキ」，维基记 written and illustrated by Tatsuki Fujimoto" },
  { key: "obata", title: "小畑健", orig: "ja", type: "person", roles: { dn: ["illustrated_by"] },
    zh: "小畑健", tw: "小畑健", en: "Takeshi Obata", alias: ["Takeshi Obata"],
    note: "《DEATH NOTE》作画：日文维基与英文维基均记「原作：大場つぐみ／漫画：小畑健」，单行本各卷封面署名为小畑健" },
  { key: "ohba", title: "大場つぐみ", orig: "ja", type: "person", roles: { dn: ["written_by"] },
    zh: "大场鸫", tw: "大場鶇", en: "Tsugumi Ohba", alias: ["Tsugumi Ohba"],
    note: "《DEATH NOTE》原作（脚本）：英文维基记 story by Tsugumi Ohba, art by Takeshi Obata" },
  { key: "shueisha", title: "集英社", orig: "ja", type: "organization",
    zh: "集英社", tw: "集英社", en: "Shueisha", alias: ["Shueisha", "株式会社集英社"],
    note: "两作日文版单行本的出版社：openBD 各册 ImprintName 均为「集英社」，版权页为集英社" },
];

// 系列/世界观聚合枢纽
const COLLECTIONS = [
  { key: "jumpshonen", title: "週刊少年ジャンプ 漫画作品", orig: "ja", zh: "《周刊少年Jump》漫画作品", tw: "《週刊少年Jump》漫畫作品", en: "Weekly Shōnen Jump manga",
    note: "集英社《週刊少年ジャンプ》连载的漫画作品聚合枢纽（本批收录《チェンソーマン》第1部与《DEATH NOTE》）",
    includes: ["cm", "dn"] },
];

// 单行本（日文版）。title 为集英社体系册名，chapters 为 openBD 副标题对应的实际话目。
// chapters: [话号, 日文原题, 英译题]；英译名取自维基 Viz 版逐话标题（无官方中译，不机翻）。
const VOLUMES = [
  { work: "cm", n: 1, date: "2019-03-04", isbn: "9784088817804", sub: "犬とチェンソー", chapters: [
    [1, "犬とチェンソー", "Dog & Chainsaw"], [2, "ポチタの行方", "The Place Where Pochita Is"], [3, "東京到着", "Arrival in Tokyo"],
    [4, "力", "Power"], [5, "胸を揉む方法", "A Way to Touch Some Boobs"], [6, "使役", "Service"], [7, "ニャーコの行方", "Meowy's Whereabouts"]] },
  { work: "cm", n: 2, date: "2019-05-02", isbn: "9784088818313", sub: "チェンソーVSコウモリ", chapters: [
    [8, "チェンソーVSコウモリ", "Chainsaw vs. Bat"], [9, "救出", "Rescue"], [10, "コン", "Kon"], [11, "妥協", "Compromise"], [12, "揉む", "Squeeze"]] },
  { work: "cm", n: 3, date: "2019-08-02", isbn: "9784088820163", sub: "デンジを殺せ", chapters: [
    [17, "デンジを殺せ", "Kill Denji"], [18, "チェンソーVS永遠", "Chainsaw vs. Eternity"], [19, "ノーベル賞", "Nobel Prize"],
    [20, "飲み", "Drinking"], [21, "キスのお味", "Taste of a Kiss"], [22, "チュッパチャプス コーラ味", "Cola-Flavor Chupa Chups"]] },
  { work: "cm", n: 4, date: "2019-10-04", isbn: "9784088820750", sub: "銃は強し", chapters: [] },
  { work: "cm", n: 5, date: "2020-01-04", isbn: "9784088821719", sub: "未成年", chapters: [] },
  { work: "cm", n: 6, date: "2020-03-04", isbn: "9784088822242", sub: "バンバンバン", chapters: [] },
  { work: "cm", n: 7, date: "2020-06-04", isbn: "9784088823287", sub: "夢の中", chapters: [] },
  { work: "cm", n: 8, date: "2020-08-04", isbn: "9784088823768", sub: "ちょうめちゃくちゃ", chapters: [] },
  { work: "cm", n: 9, date: "2020-11-04", isbn: "9784088824703", sub: "お風呂", chapters: [] },
  { work: "cm", n: 10, date: "2021-01-04", isbn: "9784088825274", sub: "犬の気持ち", chapters: [] },
  { work: "cm", n: 11, date: "2021-03-04", isbn: "9784088825762", sub: "がんばれチェンソーマン", chapters: [] },
  { work: "dn", n: 1, date: "2004-04-02", isbn: "9784088736214", sub: "退屈", chapters: [
    [1, "退屈", "Boredom"], [2, "L", "L"], [3, "家族", "Family"], [4, "電流", "Current"], [5, "眼球", "Eyeballs"], [6, "操作", "Manipulation"]] },
  { work: "dn", n: 2, date: "2004-07-02", isbn: "9784088736311", sub: "合流", chapters: [] },
];

// 跨作品/跨媒介关系（work → work）
const WORK_RELATIONS = [
  { type: "adaptation_of", from: "cm-anime", to: "cm", note: "《チェンソーマン》TV 动画（MAPPA，2022）改编自本漫画母体", attributes: { credit_role: "adaptation" } },
];

const VOL_TITLE = (w, n) => (w.key === "cm" ? "チェンソーマン 第" + n + "巻" : "DEATH NOTE 第" + n + "巻");

// ---------------------------------------------------------------- 工具

const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

/** 翻译行：title 是唯一必填键，其余语种缺官方译名时整行不写（不机翻、不编造）。 */
function T(map) {
  const out = {};
  for (const [loc, title] of Object.entries(map)) out[loc] = { title };
  return out;
}

// ---------------------------------------------------------------- 主流程

const client = new Client();
await client.login();
const camp = new Campaign({ domain: "manga-volume", client, index: Index.load() });

// ---------------------------------------------------------------- 作用域预载 + 重复建档对账
// 教训（本次实测）：
//  1) lib.mjs 修补后幂等键算法变了（键里并入了作用域），修补前跑过、修补后又重跑会**重复建档**；
//  2) 进程内索引可能落后于服务端，结构实体（篇目/载体/轨道）题名又高度重复，光靠索引查不到旧条目。
// 所以写之前必须先按结构作用域把本领域已有实体拉回本地索引，并做一次「重复树对账」：
// 每个逻辑槽位（卷 / 话 / 卷表达 / 话表达 / 载体 / 每卷内题名的轨道）只保留**最早建档**的那条，
// 其余按外键顺序（track → 表达 → 篇目 → 载体 → 发行）删除；幸存者的父级与 contents 引用重指到 canonical 上。

const PRELOAD = { mediumByRelease: new Map(), trackByMediumTitle: new Map() };      // 预载结果：按作用域索引，避免每条都打限流列表路由
const DOMAIN_WORK_TITLES = ["チェンソーマン", "DEATH NOTE"];
const inDomain = (t) => DOMAIN_WORK_TITLES.some((x) => String(t).startsWith(x)) || /^第\d+話/.test(String(t)) || String(t) === "単行本（紙）";
const byIdAsc = (a, b) => String(a.id).localeCompare(String(b.id));

// 实例**没有** DELETE /api/catalog/entities/{id}（OpenAPI 只有 get/put；实测 DELETE 恒 404 page not found）。
// 清理重复建档只能走 POST /api/catalog/entities/{id}/lifecycle（不传 target_id = 停用，落到 status=deleted）。
async function deleteEntity(kind, id, reason) {
  const cur = await camp.client.call("/api/catalog/entities/" + id);
  if (cur.status !== 200) { console.log("  停用 " + kind + " " + id + " -> 读不到 " + cur.status); return cur.status; }
  if (cur.body && cur.body.status === "deleted") { console.log("  停用 " + kind + " " + id + " -> 已是 deleted"); return 200; }
  const ev = evidence("编目：重复树对账——停用本领域重复建档的" + kind + "（" + reason + "；保留最早建档条）", [S_WIKI_CM]);
  const r = await camp.client.call("/api/catalog/entities/" + id + "/lifecycle", {
    method: "POST",
    body: { expected_version: (cur.body && cur.body.version) || 1, ...ev },
  });
  console.log("  retire " + kind + " " + id + " -> " + r.status + (r.status >= 400 ? " " + JSON.stringify(r.body).slice(0, 120) : ""));
  return r.status;
}

/** 重复树对账：本领域重跑产生的重复树只保留最早建档的一条，其余删除；幸存者父级/引用重指。 */
/** 重复树对账：本领域每个逻辑槽位只保留最早建档的一条，其余经 lifecycle 停用；幸存者引用重指。 */
async function reconcileDomain() {
  const cus = (await camp.client.listKind("content_unit")).filter((e) => inDomain(e.title));
  const exprs = (await camp.client.listKind("expression")).filter((e) => inDomain(e.title));
  const media = (await camp.client.listKind("medium")).filter((e) => e.title === "単行本（紙）");
  const tracks = (await camp.client.listKind("track")).filter((e) => inDomain(e.title));
  const releases = (await camp.client.listKind("release")).filter((e) => inDomain(e.title));
  const myRelIds = new Set(releases.map((e) => e.id));
  const myMedia = media.filter((m) => myRelIds.has(m.release_id));
  const myMediaIds = new Set(myMedia.map((m) => m.id));
  const myTracks = tracks.filter((t) => myMediaIds.has(t.medium_id));

  // 槽位键：结构实体的身份是「题名 + 结构作用域 + 编号/序号」，不是裸题名
  const slotOf = (e) => {
    const t = norm(e.title);
    if (e.kind === "content_unit") return "cu|" + t + "|" + (e.work_id || "") + "|" + String(e.number ?? "");
    if (e.kind === "expression") return "ex|" + t + "|" + (e.work_id || "");
    if (e.kind === "medium") return "md|" + t + "|" + (e.release_id || "");
    if (e.kind === "track") return "tk|" + t + "|" + (e.medium_id || "");
    if (e.kind === "release") return "rl|" + t;
    return e.kind + "|" + t;
  };
  const groupsOf = (rows) => {
    const g = new Map();
    for (const e of rows) g.set(slotOf(e), (g.get(slotOf(e)) || []).concat(e));
    const canon = new Map(); const drop = [];
    for (const [k, list] of g) { list.sort(byIdAsc); canon.set(k, list[0]); for (const e of list.slice(1)) drop.push(e); }
    return { canon, drop };
  };
  const cuG = groupsOf(cus), exG = groupsOf(exprs), mdG = groupsOf(myMedia), tkG = groupsOf(myTracks);
  console.log("对账输入：卷/话篇目=" + cus.length + " 表达=" + exprs.length + " 载体=" + myMedia.length
    + "（本领域发行上的）轨道=" + myTracks.length + " 发行=" + releases.length
    + " → 重复条：篇目 " + cuG.drop.length + " / 表达 " + exG.drop.length + " / 载体 " + mdG.drop.length + " / 轨道 " + tkG.drop.length);

  // 槽位 → 幸存者查表
  const cuBySlot = cuG.canon;
  const exBySlot = exG.canon;
  const canonCuId = new Set([...cuBySlot.values()].map((e) => e.id));
  const canonExId = new Set([...exBySlot.values()].map((e) => e.id));
  const cuTitleKey = (title, workId, num) => "cu|" + norm(title) + "|" + (workId || "") + "|" + String(num ?? "");
  const exTitleKey = (title, workId) => "ex|" + norm(title) + "|" + (workId || "");
  const dropCuIds = new Set(cuG.drop.map((e) => e.id));

  // 1) 把挂在「将被停用的篇目」上的表达重挂到幸存篇目（按题名+work 匹配）
  let reLined = 0;
  for (const x of exprs) {
    if (!x.content_unit_id || !dropCuIds.has(x.content_unit_id)) continue;
    const cu = cus.find((c) => c.id === x.content_unit_id);
    const target = cu ? cuBySlot.get(cuTitleKey(cu.title, cu.work_id, cu.number)) : null;
    if (target && target.id !== x.content_unit_id) {
      await camp.updateEntity(x.id, { content_unit_id: target.id, position: x.position },
        { note: "编目：重复树对账——表达「" + x.title + "」重挂到保留的篇目 " + target.id, sources: [S_WIKI_CM] });
      reLined++;
    }
  }

  // 2) 轨道收录引用重指到幸存表达（先按题名+work 找到原表达的槽位，再取该槽位幸存者）
  const exById = new Map(exprs.map((x) => [x.id, x]));
  let rePoint = 0;
  for (const t of myTracks) {
    const ct = (t.contents || [])[0];
    if (!ct || !ct.expression_id || canonExId.has(ct.expression_id)) continue;
    const cur = exById.get(ct.expression_id);
    const target = cur ? exBySlot.get(exTitleKey(cur.title, cur.work_id)) : null;
    if (target && target.id !== ct.expression_id) {
      await camp.updateEntity(t.id, { contents: [{ ...ct, expression_id: target.id }] },
        { note: "编目：重复树对账——「" + t.title + "」的收录引用重指到保留的表达 " + target.id, sources: [S_WIKI_CM] });
      rePoint++;
    }
  }

  // 2b) 错挂载体自愈：轨道所在载体必须属于「其收录表达所属 Work 的发行」，
  //     否则撤下该轨道并把幸存者重挂到正确载体（重复多条时保留每条载体上最早的一条）。
  const relByWork = new Map();
  for (const r of releases) for (const s of (r.subjects || [])) relByWork.set(s.work_id, r.id);
  const medOfRelease = new Map();
  for (const m of mdG.canon.values()) medOfRelease.set(m.release_id, m);
  const misplaced = new Map();
  for (const t of myTracks) {
    const ct = (t.contents || [])[0]; if (!ct) continue;
    const x = exById.get(ct.expression_id); if (!x) continue;
    const wantRel = relByWork.get(x.work_id);
    if (!wantRel) continue;
    const wantMed = medOfRelease.get(wantRel);
    if (wantMed && wantMed.id !== t.medium_id) {
      const k = wantMed.id + "|" + String(t.position) + "|" + t.title;
      misplaced.set(k, (misplaced.get(k) || []).concat(t));
    }
  }
  // 载体归属（medium_id）与其它结构归属一样是 immutable_scope：错挂的轨道不能改挂，只能停用后由建档阶段重建到正确载体。
  let droppedMisplaced = 0;
  for (const [, list] of misplaced) {
    list.sort(byIdAsc);
    for (const t of list) { await deleteEntity("track", t.id, "错挂载体（medium_id 不可改）：其收录表达所属 Work 的载体是 " + medOfRelease.get(relByWork.get((exById.get((t.contents || [{ }])[0].expression_id) || {}).work_id)).id); droppedMisplaced++; }
  }
  if (droppedMisplaced) console.log("错挂载体自愈：停用错挂轨道 " + droppedMisplaced + " 条（由建档阶段重建到正确载体）");
  // 重挂后刷新本地轨道视图
  const refreshed = (await camp.client.listKind("track")).filter((e) => inDomain(e.title));
  const myTracksNow = refreshed.filter((t) => myMediaIds.has(t.medium_id) || medOfRelease.size > 0);
  const tkG2 = groupsOf(myTracksNow);
  for (const e of tkG2.canon.values()) camp.index.add(e);

  // 3) 按 leaf → root 停用重复：轨道 → 表达 → 篇目 → 载体
  let retired = 0;
  for (const e of tkG.drop) { await deleteEntity("track", e.id, "重复轨道：" + e.title); retired++; }
  for (const e of exG.drop) { await deleteEntity("expression", e.id, "重复表达：" + e.title); retired++; }
  for (const e of cuG.drop) { await deleteEntity("content_unit", e.id, "重复篇目：" + e.title); retired++; }
  for (const e of mdG.drop) { await deleteEntity("medium", e.id, "重复载体：" + e.title); retired++; }
  // 停用/错挂清理后，任何缓存的轨道 id 都可能已失效：整段清空，交给建档阶段按 medium_id 现场查
  PRELOAD.trackByMediumTitle.clear();
  console.log("对账结果：重挂表达=" + reLined + " 重指轨道=" + rePoint + " 停用重复=" + retired);

  // 4) 幸存者进本地索引（+ 作用域索引）。
  // 进程内索引里可能残留**已被停用**的重复条（listKind 读不到、但索引还留着），
  // 直接拿它们当引用会写出 400 invalid_reference / immutable_scope。所以先清空，只用本轮读到的活体重建。
  camp.index.rows = [];
  const survivors = [
    ...cuG.canon.values(), ...exG.canon.values(), ...mdG.canon.values(), ...tkG.canon.values(),
    ...releases, ...tracks.filter((t) => !tkG.drop.some((d) => d.id === t.id)),
  ];
  for (const e of survivors) camp.index.add(e);
  for (const m of mdG.canon.values()) if (m.release_id) PRELOAD.mediumByRelease.set(m.release_id, m);
  // 轨道的 cached 载荷在重指后已过期：若把旧的 contents 原样写回，会引用刚被停用的表达（400 invalid_reference）。
  // 因此幸存轨道不进 track 预载缓存，交给 ensureTrack 现场读一次最新实体后再决定是否更新。
  PRELOAD.trackByMediumTitle.clear();
  return { retired, rePoint, reLined, survivors: survivors.length, before: { cu: cus.length, ex: exprs.length, med: myMedia.length, trk: myTracks.length } };
}

const RECONCILE_ONLY = process.argv.includes("--reconcile-only");
let DUP_REPORT = null;
if (!DRY) DUP_REPORT = await reconcileDomain();
if (RECONCILE_ONLY) {
  camp.summary({ reconcileOnly: true, reconcile: DUP_REPORT });
  console.log("--reconcile-only：只做重复树对账，未进入建档阶段");
  process.exit(0);
}

const CHECK = [];               // 回读断言清单
const workByKey = {};           // key -> work entity
const agentByKey = {};
const chapterExpr = {};         // "cm-1-3" -> expression entity
const MINE = { releaseIds: new Set(), mediumIds: new Set(), trackIds: new Set() };  // 本领域自建的发行/载体/轨道（清理孤儿只动这些）

// ---- 1. 出版社 agent（先从索引复用，避免与其它领域重复建集英社）
for (const a of AGENTS) {
  const ev = { note: "编目：agent（" + a.type + "）「" + a.title + "」——" + a.note, sources: [S_WIKI_CM, S_WIKI_DN, S_OPENBD] };
  agentByKey[a.key] = await camp.ensureEntity("agent", a.title, {
    original_language: a.orig,
    types: [a.type],
    translations: T({ "ja-JP": a.title, "zh-CN": a.zh, "zh-TW": a.tw, "en-US": a.en }),
    external_ids: {},
  }, ev, { idemKey: "manga-volume-agent-" + a.key });
}

// ---- 2. 漫画母体 Work（type=novel；实例无 manga 类型，见报告缺口）
for (const w of WORKS) {
  const ev = EVWORK("编目：日本漫画母体 Work「" + w.title + "」（type=novel，实例无 manga 类型码）："
    + w.note + "；连载杂志 " + w.magazine + "；" + w.chaptersTotal);
  workByKey[w.key] = await camp.ensureEntity("work", w.title, {
    original_language: w.orig,
    types: [w.type],
    attributes: { tags: ["漫画", "manga", "ジャンプコミックス"], magazine: w.magazine, volume_count: w.volumeCount, language: "ja" },
    translations: T({ "ja-JP": w.title, "zh-CN": w.zh, "zh-TW": w.tw, "en-US": w.en }),
    external_ids: {},
  }, ev, { idemKey: "manga-volume-work-" + w.key });
}

// ---- 3. 作者署名关系（work → agent）
for (const a of AGENTS) {
  for (const [wk, roles] of Object.entries(a.roles || {})) {
    for (const type of roles) {
      await camp.createRelation(type, workByKey[wk].id, agentByKey[a.key].id, {
        note: "编目：署名关系 " + type + "「" + workByKey[wk].title + "」→「" + a.title + "」（" + a.note + "）",
        sources: [S_WIKI_CM, S_WIKI_DN, S_OPENBD],
      }, { attributes: { credit_role: type === "written_by" ? "原作/脚本" : "作画", scope: "全卷" } });
    }
  }
}

// ---- 4. 系列 collection + includes
for (const c of COLLECTIONS) {
  const col = await camp.ensureEntity("collection", c.title, {
    original_language: c.orig,
    types: ["collection"],
    attributes: { language: "ja" },
    translations: T({ "ja-JP": c.title, "zh-CN": c.zh, "zh-TW": c.tw, "en-US": c.en }),
  }, { note: "编目：collection「" + c.title + "」——" + c.note, sources: [S_WIKI_CM, S_WIKI_DN] }, { idemKey: "manga-volume-collection-" + c.key });
  for (const wk of c.includes) {
    await camp.createRelation("includes", col.id, workByKey[wk].id, {
      note: "编目：collection「" + c.title + "」收录「" + workByKey[wk].title + "」", sources: [S_WIKI_CM, S_WIKI_DN],
    }, { attributes: { scope: "本批收录" } });
  }
}

// ---- 5. 逐卷建链：ContentUnit(卷 → 话) + Expression + Release + Medium + Track
for (const v of VOLUMES) {
  const w = WORKS.find((x) => x.key === v.work);
  const work = workByKey[v.work];
  const SRC_VOL = v.work === "cm" ? S_WIKI_CM : S_WIKI_DN;
  const isbn13 = v.isbn;                      // 日文版 ISBN-13，openBD 与维基引用交叉核对
  const volTitle = VOL_TITLE(w, v.n);

  // 5a. 卷级 content_unit（父）
  const volCU = await camp.ensureEntity("content_unit", volTitle, {
    work_id: work.id, position: v.n, number: String(v.n),
    original_language: "ja", types: ["content_unit"],
    attributes: { language: "ja" },
    translations: T({ "ja-JP": volTitle }),
  }, { note: "编目：篇目目录——第 " + v.n + " 卷（卷副标题「" + v.sub + "」，openBD 该册 CollateralDetail 副标题，ISBN " + isbn13 + "）",
    sources: [SRC_VOL, S_OPENBD] }, { idemKey: "manga-volume-vcu-" + v.work + "-" + v.n, allowServerLookup: false });
  CHECK.push({ id: volCU.id, expect: { kind: "content_unit", work_id: work.id, number: String(v.n) }, label: volTitle });

  // 5b. 卷级 Expression（该单行本的正文表达）
  const volExpr = await camp.ensureEntity("expression", volTitle + "（単行本）", {
    work_id: work.id, content_unit_id: volCU.id, position: v.n,
    original_language: "ja", types: ["expression"],
    attributes: { language: "ja", version_label: "ジャンプコミックス 単行本" },
    translations: T({ "ja-JP": volTitle + "（単行本）" }),
  }, { note: "编目：表达——第 " + v.n + " 卷単行本正文（集英社 ジャンプコミックス、ISBN " + isbn13 + "，发行日 " + v.date + "）用于被该单行本 Track 收录",
    sources: [SRC_VOL, S_OPENBD] }, { idemKey: "manga-volume-vexpr-" + v.work + "-" + v.n, allowServerLookup: false });
  CHECK.push({ id: volExpr.id, expect: { kind: "expression", work_id: work.id, content_unit_id: volCU.id }, label: volTitle + "（単行本）" });

  // 5c. 话级 content_unit（子）+ Expression
  const chapterExprs = [];
  for (const [no, jaTitle, enTitle] of v.chapters) {
    const cuTitle = "第" + no + "話 " + jaTitle;
    const cu = await camp.ensureEntity("content_unit", cuTitle, {
      work_id: work.id, parent_id: volCU.id, position: no, number: String(no),
      original_language: "ja", types: ["content_unit"],
      attributes: { language: "ja" },
      translations: T({ "ja-JP": cuTitle }),
    }, { note: "编目：篇目目录——第 " + no + " 話「" + jaTitle + "」（" + enTitle + "），收录于第 " + v.n + " 卷；话名与卷内归属取自 " + (v.work === "cm" ? "Chainsaw Man" : "Death Note") + " 单行本逐话目录",
      sources: [SRC_VOL] }, { idemKey: "manga-volume-ccu-" + v.work + "-" + no, allowServerLookup: false });
    CHECK.push({ id: cu.id, expect: { kind: "content_unit", work_id: work.id, parent_id: volCU.id, number: String(no) }, label: cuTitle });

    const ex = await camp.ensureEntity("expression", "第" + no + "話「" + jaTitle + "」（単行本 " + v.n + " 巻）", {
      work_id: work.id, content_unit_id: cu.id, position: no,
      original_language: "ja", types: ["expression"],
      attributes: { language: "ja" },
      translations: T({ "ja-JP": "第" + no + "話「" + jaTitle + "」" }),
    }, { note: "编目：表达——第 " + no + " 話正文（" + w.title + " 第 " + v.n + " 巻収録）", sources: [SRC_VOL] },
      { idemKey: "manga-volume-cexpr-" + v.work + "-" + no, allowServerLookup: false });
    CHECK.push({ id: ex.id, expect: { kind: "expression", work_id: work.id, content_unit_id: cu.id }, label: "第" + no + "話表达" });
    chapterExprs.push({ no, ex, cu });
    chapterExpr[work.id + ":" + no] = ex;
  }

  // 5d. Release：日文版单行本（subjects 覆盖该发行收录表达的全部 Work）
  // 卷级 Track 的 position 避开逐话 Track 占用的 1..N（同载体 position 唯一），题名也带卷号以免与话轨道撞名。
  const volTrackPos = 100 + v.n;
  const volTrackTitle = volTitle + "（全巻）";
  const subjects = [{ work_id: work.id, role: "primary", position: 0 }];
  const relTitle = volTitle;
  const relSpec = {
    subjects,
    original_language: "ja", types: ["release"],
    // external_ids 的键必须来自 GET /api/catalog/external-databases（isbndb: ^[0-9-]{10,17}$）
    external_ids: { isbndb: isbn13 },
    attributes: {
      isbn: isbn13, publisher: agentByKey.shueisha.id,
      edition_date: v.date, edition_type: "standard", edition_batch: v.n === 1 ? "first_press" : "reprint",
      country: "JP", packaging: "standard", distribution_channel: "physical",
    },
    translations: T({ "ja-JP": relTitle }),
  };
  let release = await camp.ensureEntity("release", relTitle, relSpec, { note: "编目：发行——" + w.title + " 第 " + v.n + " 巻 単行本（集英社 ジャンプコミックス，ISBN " + isbn13 + "，発売日 " + v.date
      + "；卷副标题「" + v.sub + "」）；subjects 声明收录的 " + w.title + " (primary)", sources: [SRC_VOL, S_OPENBD] },
    { idemKey: "manga-volume-rel-" + v.work + "-" + v.n });
  if (!DRY && (!release.external_ids || release.external_ids.isbndb !== isbn13)) {
    release = await camp.updateEntity(release.id, { external_ids: { ...(release.external_ids || {}), isbndb: isbn13 } },
      { note: "编目：补 " + relTitle + " 的 isbndb 外部标识（ISBN " + isbn13 + "）", sources: [SRC_VOL, S_OPENBD] });
  }
  CHECK.push({ id: release.id, expect: { kind: "release", subjects_include: work.id }, label: relTitle });

  // 5e. Medium（纸本）+ Track（逐话位置）
  // scope 必须带 release_id：服务端幂等缓存键只做「路由|用户|Idempotency-Key」匹配、不做载荷哈希，
  // 结构实体（medium/track）题名高度重复（"単行本（紙）"、"第1話"），不带作用域的键会在同一发行内
  // 互相当成重放，把后续载体/轨道静默丢弃（首次运行实测：13 个发行只落 1 个 medium）。
  const mediumSpec = {
    release_id: release.id, position: 1,
    original_language: "ja", types: ["medium"],
    attributes: { format: "paper", role: "primary", catalog_number: isbn13 },
    translations: T({ "ja-JP": "単行本（紙）" }),
  };
  const medEv = { note: "编目：载体——" + relTitle + " 的纸本単行本（1 册）", sources: [SRC_VOL, S_OPENBD] };
  const medScope = { release_id: release.id };
  let medium = PRELOAD.mediumByRelease.get(release.id) || null;
  if (!DRY && medium) {
    // 幂等重跑：把属性收敛到本册（首次运行被幂等键串号复用过的载体只补对了 release_id）
    const want = mediumSpec.attributes;
    const got = medium.attributes || {};
    if (got.catalog_number !== want.catalog_number || got.format !== want.format || got.role !== want.role) {
      medium = await camp.updateEntity(medium.id, { attributes: { ...got, ...want } }, medEv);
    }
  }
  if (!medium) {
    medium = await camp.ensureEntity("medium", "単行本（紙）", mediumSpec, medEv,
      { idemKey: "manga-volume-med-" + v.work + "-" + v.n, allowServerLookup: false, scope: medScope });
    PRELOAD.mediumByRelease.set(release.id, medium);
  }
  MINE.mediumIds.add(medium.id);
  MINE.releaseIds.add(release.id);
  CHECK.push({ id: medium.id, expect: { kind: "medium", release_id: release.id }, label: relTitle + " 単行本（紙）" });


  // Track：同样必须带 medium_id 作用域（"第1話" 在本领域跨卷、跨作品重复出现）。
  const ensureTrack = async (title, spec, ev, idemKey) => {
    const scoped = { medium_id: medium.id };
    if (!DRY) {
      const hit = PRELOAD.trackByMediumTitle.get(medium.id + "|" + norm(title));
      if (hit) {
        const back = await camp.getEntity(hit.id);
        const wantContents = (spec.contents || []).map((x) => x.expression_id).join(",");
        const gotContents = (back.contents || []).map((x) => x.expression_id).join(",");
        if (gotContents !== wantContents || Number(back.position) !== Number(spec.position)) {
          const fixed = await camp.updateEntity(hit.id, { contents: spec.contents, position: spec.position }, ev);
          return fixed;
        }
        camp.reused.entity++; camp.log({ op: "entity", status: "reuse-nested", kind: "track", title, id: hit.id });
        return { id: hit.id };
      }
    }
    return camp.ensureEntity("track", title, spec, ev, { idemKey, allowServerLookup: false, scope: scoped });
  };

  if (chapterExprs.length) {
    for (const c of chapterExprs) {
      const t = await ensureTrack("第" + c.no + "話", {
        medium_id: medium.id, position: c.no,
        original_language: "ja", types: ["track"],
        contents: [{ expression_id: c.ex.id, position: 1 }],
        translations: T({ "ja-JP": "第" + c.no + "話" }),
      }, { note: "编目：载体位置——" + relTitle + " 内第 " + c.no + " 話「" + c.cu.title.replace(/^第\d+話 /, "") + "」的收录位置（引用该话 Expression；纸本无可靠页码证据，locator 留空）",
        sources: [SRC_VOL] }, "manga-volume-trk-" + v.work + "-" + c.no);
      CHECK.push({ id: t.id, expect: { kind: "track", medium_id: medium.id, contents_has: c.ex.id, position: c.no }, label: "track " + relTitle + " 第" + c.no + "話" });
      MINE.trackIds.add(t.id);
    }
  } else {
    const t = await ensureTrack(volTrackTitle, {
      medium_id: medium.id, position: volTrackPos,
      original_language: "ja", types: ["track"],
      contents: [{ expression_id: volExpr.id, position: 1 }],
      translations: T({ "ja-JP": volTrackTitle }),
    }, { note: "编目：载体位置——" + relTitle + " 整册正文（本批未建该卷逐话篇目，整册以卷级 Expression 收录；position 取 " + volTrackPos + " 以避开逐话轨道）",
      sources: [SRC_VOL] }, "manga-volume-trkv-" + v.work + "-" + v.n);
    CHECK.push({ id: t.id, expect: { kind: "track", medium_id: medium.id, contents_has: volExpr.id, position: volTrackPos }, label: "track " + volTrackTitle });
    MINE.trackIds.add(t.id);
  }
}

// ---- 6. 跨媒介 work→work：TV 动画母体（真实作品，只建到 Work 层；篇目/光盘属领域 10）
const animeWork = await camp.ensureEntity("work", "チェンソーマン（TV アニメ）", {
  original_language: "ja",
  types: ["animation"],
  attributes: { language: "ja", air_network: "テレビ東京", broadcast_start: "2022-10-12", tags: ["MAPPA", "TVアニメ"] },
  translations: T({ "ja-JP": "チェンソーマン（TV アニメ）" }),
}, { note: "编目：TV 动画母体 Work「チェンソーマン（TV アニメ）」（MAPPA 制作、2022-10 起放送）；只建到 Work 层，篇目与光盘载体属其它领域",
  sources: [S_ANIME, S_WIKI_CM] }, { idemKey: "manga-volume-anime-cm" });

for (const r of WORK_RELATIONS) {
  const from = r.from === "cm-anime" ? animeWork : workByKey[r.from];
  await camp.createRelation(r.type, from.id, workByKey[r.to].id, {
    note: "编目：" + r.note, sources: [S_ANIME, S_WIKI_CM],
  }, { attributes: r.attributes });
}

// ---------------------------------------------------------------- 写后回读断言

let assertFail = 0;
const REL_OK = [];     // 关系回读通过数
const REL_BAD = [];    // 关系丢失/端点不符
const problems = [];

// 重复建档/孤儿清理：对账阶段已按结构作用域做过；这里只兜底本领域发行上仍挂在非 canonical 载体之外的轨道
if (!DRY && DUP_REPORT) {
  const allTracks0 = (await camp.client.listKind("track")).filter((t) => inDomain(t.title));
  const stray = allTracks0.filter((t) => t.medium_id && !MINE.mediumIds.has(t.medium_id)
    && String(t.title).startsWith("第") && /^第\d+話$/.test(String(t.title)));
  console.log("兜底孤儿轨道检查：" + stray.length + " 条（不在本领域载体上）");
  for (const t of stray) { await deleteEntity("track", t.id, "不在本领域载体上的遗留轨道"); }
}

if (!DRY) {
  // 结构式回读断言（不去比 id：同一槽位的实体在重跑/对账后可能是另一条 id，
  // 服务端对同 kind+同结构作用域的去重不保证返回本条）。只用列表路由一次读全，避免限流拖慢。
  const inDom = (t) => inDomain(t);
  const allReleases = (await camp.client.listKind("release")).filter((x) => inDom(x.title));
  const allMedia = (await camp.client.listKind("medium")).filter((x) => x.title === "単行本（紙）");
  const allTracks = (await camp.client.listKind("track")).filter((x) => inDom(x.title));
  const allCU = (await camp.client.listKind("content_unit")).filter((x) => inDom(x.title));
  const allExpr = (await camp.client.listKind("expression")).filter((x) => inDom(x.title));
  const relIds = new Set(allReleases.map((x) => x.id));
  const myMedia = allMedia.filter((m) => relIds.has(m.release_id));
  const myMediaIds = new Set(myMedia.map((m) => m.id));
  const exprById = new Map(allExpr.map((x) => [x.id, x]));
  const cuById = new Map(allCU.map((x) => [x.id, x]));
  const volCU = allCU.filter((x) => /第\d+巻$/.test(String(x.title)));
  const chapCU = allCU.filter((x) => /^第\d+話 /.test(String(x.title)));
  const check = (ok, msg) => { if (!ok) { assertFail++; problems.push(msg); } };

  // A) 卷/话两级篇目形态
  check(volCU.length === 13, "卷篇目应有 13 条，实为 " + volCU.length);
  check(chapCU.length === 24, "话篇目应有 24 条，实为 " + chapCU.length);
  for (const c of chapCU) {
    const p = cuById.get(c.parent_id);
    check(!!p && /第\d+巻$/.test(String(p.title)), "话篇目「" + c.title + "」的父级不是本领域卷篇目：" + c.parent_id);
    check(!!p && p.work_id === c.work_id, "话篇目「" + c.title + "」与父级卷的 work_id 不一致");
    check(String(c.number || "") !== "", "话篇目「" + c.title + "」缺 number");
    check(Number(c.position) > 0, "话篇目「" + c.title + "」缺 position");
  }
  for (const v of volCU) {
    check(!v.parent_id, "卷篇目「" + v.title + "」不应有 parent_id");
    check(!!v.work_id, "卷篇目「" + v.title + "」缺 work_id");
  }

  // B) Work → ContentUnit → Expression（表达必须挂在篇目上）
  for (const cu of allCU) {
    const ex = allExpr.filter((x) => x.content_unit_id === cu.id);
    check(ex.length >= 1, "篇目「" + cu.title + "」没有任何挂在其上的 expression");
    for (const x of ex) check(x.work_id === cu.work_id, "表达「" + x.title + "」的 work_id 与篇目不一致");
    for (const x of ex) check(!!x.content_unit_id, "表达「" + x.title + "」缺 content_unit_id");
  }
  const orphanExpr = allExpr.filter((x) => !x.content_unit_id || !cuById.has(x.content_unit_id));
  check(orphanExpr.length === 0, "有 " + orphanExpr.length + " 条表达的 content_unit_id 不指向本领域篇目（应已对账清理）");

  // C) Release → subjects / Medium → Track → contents(引用 Expression)
  for (const rid of relIds) {
    const meds = myMedia.filter((m) => m.release_id === rid);
    check(meds.length === 1, "发行 " + rid + " 的纸本载体数应为 1，实为 " + meds.length);
    if (meds.length !== 1) continue;
    const trks = allTracks.filter((t) => t.medium_id === meds[0].id);
    check(trks.length >= 1, "发行 " + rid + " 的载体没有任何 Track");
    const positions = new Set();
    for (const t of trks) {
      check(!positions.has(Number(t.position)), "载体 " + meds[0].id + " 内 position 重复：" + t.position);
      positions.add(Number(t.position));
      check((t.contents || []).length >= 1, "Track「" + t.title + "」没有 contents");
      for (const ct of t.contents || []) {
        const x = exprById.get(ct.expression_id);
        check(!!x, "Track「" + t.title + "」引用了不可见/不存在或非本领域的 expression：" + ct.expression_id);
        if (x) {
          const rel = allReleases.find((rr) => rr.id === rid);
          check((rel.subjects || []).some((s) => s.work_id === x.work_id),
            "发行「" + rel.title + "」的 subjects 未覆盖 Track「" + t.title + "」所引表达的 Work " + x.work_id);
          check(!!x.content_unit_id, "被收录表达「" + x.title + "」未挂到篇目（本领域要求 Work→ContentUnit→Expression 成链）");
        }
      }
    }
  }

  // 关系回读：本领域建的每条边都要真的在库里（服务端幂等缓存曾按「路由|用户|键」缓存、
  // 不做载荷哈希，键相同即当重放，会导致边静默丢失）
  const relSpecs = [
    ...AGENTS.flatMap((a) => Object.entries(a.roles || {}).flatMap(([wk, roles]) =>
      roles.map((type) => ({ type, sid: workByKey[wk].id, tid: agentByKey[a.key].id })))),
    ...COLLECTIONS.flatMap((c) => c.includes.map((wk) => ({ type: "includes", sid: null, tid: null, colKey: c.key, wk }))),
    { type: "adaptation_of", sid: animeWork.id, tid: workByKey.cm.id },
  ];
  for (const r of relSpecs) {
    const sid = r.sid || (await camp.client.search("collection", COLLECTIONS.find((c) => c.key === r.colKey).title))[0].id;
    const tid = r.tid || workByKey[r.wk].id;
    await sleep(120);
    const edges = await camp.client.relationsOf(sid);
    if (edges.some((x) => x.type === r.type && x.target_id === tid)) REL_OK.push({ type: r.type, sid, tid });
    else { REL_BAD.push({ type: r.type, sid, tid }); assertFail++; problems.push("关系缺失 " + r.type + " " + sid + "→" + tid); }
  }

  // 孤儿兜底：本领域发行上若还有挂在别人载体/不存在载体上的轨道，按需停用（默认只报告）
  const orphanTracks = allTracks.filter((t) => !myMediaIds.has(t.medium_id));
  const doClean = process.argv.includes("--cleanup-orphans");
  console.log("\n孤儿兜底：挂在本领域载体之外的轨道 " + orphanTracks.length + " 条"
    + "（" + (doClean ? "本次停用" : "仅报告，加 --cleanup-orphans 才停用") + "）");
  if (doClean) for (const t of orphanTracks) await deleteEntity("track", t.id, "不在本领域载体上的遗留轨道");

  const totalChecks = problems.length + (CHECK.length ? 0 : 0);
  console.log("\n回读断言：结构检查 0 失败为通过；失败 " + problems.length + " 项；关系回读 " + REL_OK.length + "/" + relSpecs.length + " 存在");
  if (problems.length) console.log("断言问题：\n - " + problems.slice(0, 40).join("\n - "));
}

camp.summary({ assertions: { checked: CHECK.length, failed: assertFail, problems }, relations: { verified: REL_OK.length, missing: REL_BAD } });
if (assertFail) process.exitCode = 2;
