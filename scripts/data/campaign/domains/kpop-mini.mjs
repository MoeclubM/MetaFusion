#!/usr/bin/env node
// 编目战役领域 6：K-pop 迷你专辑（实体版 + 数字版）
//
// 目标：用真实可考据的 K-pop 迷你专辑把两条链压满
//   创作链  Work(song) → ContentUnit(曲目篇目) → Expression(录音)
//   承载链  Work(album) → Release(实体 CD / 数字下载) → Medium → Track —contents→ Expression
//
// 数据全部来自 MusicBrainz / iTunes Search API / 维基百科，逐字段可回溯；
// 拿不到证据的字段（ISRC、批号、条码、价格等）一律留空，不编造。
//
// 用法：
//   node scripts/data/campaign/domains/kpop-mini.mjs --dry-run   # 空跑，只打计划
//   node scripts/data/campaign/domains/kpop-mini.mjs             # 真写入 + 回读断言

import { Campaign, Client, Index, src, DRY } from "../lib.mjs";

// 本领域的写入口径（写给后续维护者）：
//  · 服务端存在同名实体（别的领域可能有同曲名）时**绝不**按题名到服务端复用——
//    Work 用本地索引 + 幂等键查重，其余层级（content_unit / expression / medium / track / release）
//    只认本地索引与结构作用域，避免把别人的实体挂进本领域的关系图。
//  · 每次写入都在 lib 更新后带唯一 Idempotency-Key（含专辑 key + 曲序 + 版别）。
//  · 关系去重由领域脚本自己的 relationsOf 回读断言负责（跳过 lib 的建前查询以省列表路由限流）。
const LOCAL_ONLY = true;
// 关系的建前查重（lib 的 relationsOf 查询）在本领域关掉：每条边都要 1 次列表路由请求，
// 十几个并发子代理下会互相挤 120/分钟限流；改由脚本收尾的 relationsOf 回读断言覆盖。
const REL_DEDUP = false;

// ---------------------------------------------------------------- 证据来源

const S_WIKI = {
  twice: src("https://en.wikipedia.org/wiki/With_You-th", "Infobox：发行日 2024-02-23、厂牌 JYP/Republic、6 曲、总时长 17:31；Track listing 段：逐曲 lyrics/music/arrangement 署名与秒数"),
  nj: src("https://en.wikipedia.org/wiki/Get_Up_(EP)", "Infobox：发行日 2023-07-21、厂牌 ADOR、总时长 12:10；Track listing 段：逐曲署名与秒数；Personnel 段：制作人 Park Jin-su / 250 / Frankie Scoca / Smerz"),
  aespa: src("https://en.wikipedia.org/wiki/My_World_(Aespa_EP)", "Infobox：发行日 2023-05-08、厂牌 SM/Warner/Dreamus、6 曲、总时长 20:23；Track listing 段：逐曲署名与秒数"),
  idle: src("https://en.wikipedia.org/wiki/I_Feel", "Infobox：数字版 2023-05-15 / 实体 2023-05-16、厂牌 Cube/Kakao、总时长 17:03；Track listing 段：逐曲署名与秒数（含 Queencard 韩文名 퀸카）"),
};
const S_MB = {
  twice: src("https://musicbrainz.org/release/b2acd51d-9e84-4439-b710-27d4c942b4ed", "MB KR 版 release（JYPK 1762，2024-02-23）：6 曲 CD 曲序与毫秒时长（与数字版曲目一致）"),
  nj: src("https://musicbrainz.org/release/0230cf89-6b69-4c31-bc7b-b5c7d540550c", "MB KR 版 release：label ADOR、品番 ADR0281、1 CD / 6 曲；同组数字版 release 23020d7f 曲目同为 6 曲"),
  aespa: src("https://musicbrainz.org/release/5d92bf8c-8b3a-440e-9b29-b843ddbb04f9", "MB KR 版 release：label SM Entertainment、品番 SMK1692、2023-05-08、1 CD / 6 曲"),
  idle: src("https://musicbrainz.org/release/0b1edd18-5cf8-473b-892e-311b5c9dff9b", "MB KR 实体 release：label CUBE Entertainment、品番 L200002588、2023-05-16、1 CD / 6 曲；数字版 release 14069b29 为 2023-05-15"),
};
const S_ITUNES = {
  twice: src("https://itunes.apple.com/lookup?id=1726087580&entity=song&country=US", "iTunes：With YOU-th - EP，JYP Entertainment，2024-02-23，6 曲及秒数（与 CD 曲序一致）"),
  nj: src("https://itunes.apple.com/lookup?id=1695951888&entity=song&country=US", "iTunes：NewJeans 2nd EP 'Get Up'，ADOR，2023-07-21，6 曲及秒数"),
  aespa: src("https://itunes.apple.com/lookup?id=1685399618&entity=song&country=US", "iTunes：MY WORLD - The 3rd Mini Album - EP，SM Entertainment，2023-05-08，6 曲及秒数"),
  idle: src("https://itunes.apple.com/search?term=(G)I-DLE%20I%20feel&entity=album&country=US", "iTunes：I feel - EP，CUBE ENTERTAINMENT INC.，2023-05-15"),
};
const S_AESPA_KR = src("https://itunes.apple.com/lookup?id=1685399618&country=KR", "iTunes KR storefront：专辑名「MY WORLD - The 3rd Mini Album - EP」，艺人名 aespa，佐证官方版名与「第 3 张迷你专辑」的说法");
const S_NJ_KR = src("https://itunes.apple.com/lookup?id=1695951888&country=KR", "iTunes KR storefront：官方专辑名「NewJeans 2nd EP 'Get Up'」，艺人名 뉴진스，佐证官方版名与团体韩文名");

// ---------------------------------------------------------------- 数据表
// 曲目时长取 MusicBrainz / iTunes 实测秒数；实体 CD 与数字版时长略有差异时各取对应来源。

const ALBUMS = [
  {
    key: "twice",
    album: {
      title: "With YOU-th",
      artist: "TWICE",
      group_ko: "트와이스",
      label: "JYP Entertainment",
      type_labels: "13th mini album；收录首支英文单曲 I GOT YOU 与主打 ONE SPARK",
      ext: { musicbrainz: "e97e9436-e0fd-4df6-8688-975c01f4c5d5", wikidata: "Q124110274" },
    },
    releases: [
      { kind: "physical", title: "With YOU-th (With YOU-th ver.)", catalog: "JYPK 1762", date: "2024-02-23", country: "KR", packaging: "standard", channel: "physical", format: "cd", medium: "CD" },
      { kind: "digital", title: "With YOU-th (digital)", catalog: "", date: "2024-02-23", country: "KR", packaging: "standard", channel: "digital", format: "digital", medium: "Digital Media" },
    ],
    tracks: [
      { title: "I GOT YOU", dur: { cd: 174, web: 173 }, lang: "en" },
      { title: "ONE SPARK", dur: { cd: 185, web: 184 } },
      { title: "RUSH", dur: { cd: 157, web: 156 } },
      { title: "NEW NEW", dur: { cd: 183, web: 182 } },
      { title: "BLOOM", dur: { cd: 204, web: 203 } },
      { title: "YOU GET ME", dur: { cd: 153, web: 153 } },
    ],
    credits: [
      { song: "I GOT YOU", lyrics: ["Jonah Marais", "Daniel Seavey", "David Wilson", "Jake Torrey", "Lexxi Saal"], music: ["Jonah Marais", "Daniel Seavey", "David Wilson", "Jake Torrey", "Lexxi Saal"], arrange: ["Dwilly"] },
      { song: "ONE SPARK", lyrics: ["Sim Eunjee", "Melanie Fontana"], music: ["Kyler Niko", "Earattack", "Paulina Cerrilla", "Lee Woo-hyun"], arrange: ["Earattack", "Lee Woo-hyun"] },
      { song: "RUSH", lyrics: ["CHAEYOUNG"], music: ["Mich Hansen", "Chris Burton", "Carl Wallevik"], arrange: ["Cutfather", "Carl Altino"] },
      { song: "NEW NEW", lyrics: ["Lee Seu Ran"], music: ["Lee Woo-min", "Paulina Cerrilla", "Kyler Niko"], arrange: ["Lee Woo-min"] },
      { song: "BLOOM", lyrics: ["JEONGYEON"], music: ["Melanie Fontana", "Earattack", "Lindgren", "GG Ramirez", "Lee Woo-hyun"], arrange: ["Earattack", "Lindgren", "Lee Woo-hyun"] },
      { song: "YOU GET ME", lyrics: ["DAHYUN"], music: ["Brooke Tomlinson", "Sofia Kay", "Jeoff Harris"], arrange: ["Jeoff Harris"] },
    ],
    sources: [S_WIKI.twice, S_MB.twice, S_ITUNES.twice],
  },
  {
    key: "nj",
    album: {
      title: "Get Up",
      artist: "NewJeans",
      group_ko: "뉴진스",
      label: "ADOR",
      type_labels: "NewJeans 2nd EP；三首单曲 Super Shy / ETA / Cool with You",
      ext: { musicbrainz: "d2b0e110-fe62-4c91-9504-5dbfbedf1374", wikidata: "Q119834713" },
    },
    releases: [
      { kind: "physical", title: "Get Up (Weverse Albums ver.)", catalog: "ADR0281", date: "2023-07-21", country: "KR", packaging: "standard", channel: "physical", format: "cd", medium: "CD" },
      { kind: "digital", title: "Get Up (digital)", catalog: "", date: "2023-07-21", country: "KR", packaging: "standard", channel: "digital", format: "digital", medium: "Digital Media" },
    ],
    tracks: [
      { title: "New Jeans", dur: { cd: 109, web: 109 } },
      { title: "Super Shy", dur: { cd: 155, web: 155 } },
      { title: "ETA", dur: { cd: 151, web: 151 } },
      { title: "Cool With You", dur: { cd: 148, web: 148 } },
      { title: "Get Up", dur: { cd: 36, web: 36 }, nolang: true },
      { title: "ASAP", dur: { cd: 134, web: 134 } },
    ],
    credits: [
      { song: "New Jeans", lyrics: ["Gigi", "Erika de Casier", "Fine Glindvad Jensen", "HAERIN"], music: ["Park Jin-su", "Frankie Scoca", "Erika de Casier", "Fine Glindvad Jensen"], arrange: ["Park Jin-su", "Frankie Scoca"] },
      { song: "Super Shy", lyrics: ["Gigi", "Kim Dong-hyun", "Erika de Casier", "Kristine Bogan", "DANIELLE"], music: ["Frankie Scoca", "Erika de Casier", "Kristine Bogan"], arrange: ["Frankie Scoca"] },
      { song: "ETA", lyrics: ["Lim Sung-bin", "Gigi", "Ylva Dimberg"], music: ["250", "Ylva Dimberg"], arrange: ["250"] },
      { song: "Cool With You", lyrics: ["Gigi", "Kim Dong-hyun", "Erika de Casier", "Fine Glindvad Jensen", "DANIELLE"], music: ["Park Jin-su", "Frankie Scoca", "Erika de Casier", "Fine Glindvad Jensen"], arrange: ["Park Jin-su", "Frankie Scoca"] },
      { song: "Get Up", lyrics: ["Freekind"], music: ["250", "Freekind"], arrange: ["250"] },
      { song: "ASAP", lyrics: ["Gigi", "Erika de Casier", "Fine Glindvad Jensen", "Catharina Stoltenberg", "Henriette Motzfeldt", "DANIELLE"], music: ["250", "Catharina Stoltenberg", "Henriette Motzfeldt", "Erika de Casier", "Fine Glindvad Jensen"], arrange: ["250", "Catharina Stoltenberg", "Henriette Motzfeldt"] },
    ],
    sources: [S_WIKI.nj, S_MB.nj, S_ITUNES.nj, S_NJ_KR],
  },
  {
    key: "aespa",
    album: {
      title: "MY WORLD",
      artist: "aespa",
      group_ko: "에스파",
      label: "SM Entertainment",
      type_labels: "The 3rd Mini Album；预公开曲 Welcome to MY World、主打 Spicy",
      ext: { musicbrainz: "36f4c763-a09f-4527-9bb3-ae425f8ee0aa", wikidata: "Q118118760" },
    },
    releases: [
      { kind: "physical", title: "MY WORLD (My World ver.)", catalog: "SMK1692", date: "2023-05-08", country: "KR", packaging: "standard", channel: "physical", format: "cd", medium: "CD" },
      { kind: "digital", title: "MY WORLD (digital)", catalog: "", date: "2023-05-08", country: "KR", packaging: "standard", channel: "digital", format: "digital", medium: "Digital Media" },
    ],
    tracks: [
      { title: "Welcome to MY World", dur: { cd: 207, web: 207 }, note: "feat. nævis" },
      { title: "Spicy", dur: { cd: 198, web: 197 } },
      { title: "Salty & Sweet", dur: { cd: 202, web: 202 } },
      { title: "Thirsty", dur: { cd: 194, web: 193 } },
      { title: "I'm Unhappy", dur: { cd: 206, web: 206 } },
      { title: "'Til We Meet Again", dur: { cd: 218, web: 218 } },
    ],
    credits: [
      { song: "Welcome to MY World", lyrics: ["Ellie Suh", "Hyun Ji-won", "Danke"], music: ["Mich Hansen", "Jacob Uchorczak", "Celine Svanbäck", "Patrizia Helander"], arrange: ["Cutfather", "Ubizz"] },
      { song: "Spicy", lyrics: ["Bang Hye-hyun"], music: ["Ludvig Evers", "Jonatan Gusmark", "Emily Yeonseo Kim", "Moa Carlebecker"], arrange: ["Moonshine", "Jinbyjin"] },
      { song: "Salty & Sweet", lyrics: ["Bang Hye-hyun"], music: ["Anne Judith Wik", "Moa Carlebecker", "Jinbyjin"], arrange: ["Jinbyjin"] },
      { song: "Thirsty", lyrics: ["Kim Bo-eun"], music: ["Geek Boy Al Swettenham", "Kyler Niko", "Paulina Cerrilla"], arrange: ["Geek Boy Al Swettenham"] },
      { song: "I'm Unhappy", lyrics: ["Lee Seu-ran"], music: ["Barry Cohen", "Sophie Hintze", "Ally Ahern"], arrange: ["Gingerbread"] },
      { song: "'Til We Meet Again", lyrics: ["Choi Jae-yeon"], music: ["Jake K", "Maria Marcus", "Andreas Öberg", "MCK"], arrange: ["Jake K", "MCK"] },
    ],
    sources: [S_WIKI.aespa, S_MB.aespa, S_ITUNES.aespa, S_AESPA_KR],
  },
  {
    key: "idle",
    album: {
      title: "I feel",
      artist: "(G)I-DLE",
      group_ko: "(여자)아이들",
      label: "Cube Entertainment",
      type_labels: "第六张韩语迷你专辑；主打 Queencard（퀸카）、先行曲 Allergy；实体三个版本 Cat / Butterfly / Queen",
      ext: { musicbrainz: "e988de57-e00e-4dae-91d8-d147bf18e70a" },
    },
    releases: [
      { kind: "physical", title: "I feel (Cat ver.)", catalog: "L200002588", date: "2023-05-16", country: "KR", packaging: "standard", channel: "physical", format: "cd", medium: "CD" },
      { kind: "digital", title: "I feel (digital)", catalog: "", date: "2023-05-15", country: "KR", packaging: "standard", channel: "digital", format: "digital", medium: "Digital Media" },
    ],
    tracks: [
      { title: "Queencard", ko: "퀸카", dur: { cd: 161, web: 161 } },
      { title: "Allergy", dur: { cd: 162, web: 162 } },
      { title: "Lucid", dur: { cd: 175, web: 175 }, lang: "en" },
      { title: "All Night", dur: { cd: 146, web: 146 } },
      { title: "Paradise", dur: { cd: 189, web: 189 }, lang: "en" },
      { title: "Peter Pan", ko: "어린 어른", dur: { cd: 190, web: 190 } },
    ],
    credits: [
      { song: "Queencard", lyrics: ["SOYEON"], music: ["SOYEON", "PopTime", "Daily", "Likey"], arrange: ["PopTime", "Daily", "Likey", "SOYEON"] },
      { song: "Allergy", lyrics: ["SOYEON"], music: ["SOYEON", "PopTime", "Daily", "Likey", "Kako"], arrange: ["PopTime", "Daily", "Likey", "SOYEON"] },
      { song: "Lucid", lyrics: ["MINNIE", "SOYEON"], music: ["MINNIE", "BreadBeat", "Sinkung"], arrange: ["BreadBeat", "Sinkung"] },
      { song: "All Night", lyrics: ["YUQI", "Wooseok"], music: ["YUQI", "Siixk Jun"], arrange: ["Siixk Jun"] },
      { song: "Paradise", lyrics: ["MINNIE", "B.O", "SOYEON"], music: ["MINNIE", "BreadBeat"], arrange: ["BreadBeat"] },
      { song: "Peter Pan", lyrics: ["SOYEON", "YUQI"], music: ["YUQI", "Siixk Jun", "Wooseok"], arrange: ["Siixk Jun"] },
    ],
    sources: [S_WIKI.idle, S_MB.idle, S_ITUNES.idle],
    sequel_of_title: "I Love",
  },
];

// 团体成员（出道阵容，取自各团体官方英文维基条目 infobox 的成员列表）
const MEMBERS = {
  twice: [["NAYEON", "나연"], ["JEONGYEON", "정연"], ["MOMO", "모모"], ["SANA", "사나"], ["JIHYO", "지효"], ["MINA", "미나"], ["DAHYUN", "다현"], ["CHAEYOUNG", "채영"], ["TZUYU", "쯔위"]],
  nj: [["MINJI", "민지"], ["HANNI", "하니"], ["DANIELLE", "다니엘"], ["HAERIN", "해린"], ["HYEIN", "혜인"]],
  aespa: [["KARINA", "카리나"], ["GISELLE", "지젤"], ["WINTER", "윈터"], ["NINGNING", "닝닝"]],
  idle: [["MIYEON", "미연"], ["MINNIE", "민니"], ["SOYEON", "소연"], ["YUQI", "우기"], ["SHUHUA", "슈화"]],
};

// 厂牌 agent
const LABELS = [
  { title: "JYP Entertainment", ko: "JYP엔터테인먼트", url: "https://en.wikipedia.org/wiki/JYP_Entertainment" },
  { title: "ADOR", ko: "어도어", url: "https://en.wikipedia.org/wiki/ADOR" },
  { title: "SM Entertainment", ko: "SM엔터테인먼트", url: "https://en.wikipedia.org/wiki/SM_Entertainment" },
  { title: "Cube Entertainment", ko: "큐브엔터테인먼트", url: "https://en.wikipedia.org/wiki/Cube_Entertainment" },
];

// ---------------------------------------------------------------- 工具

/**
 * 四语翻译：没有官方译名时，按 BRIEF 要求「该语种填原文题名即可，绝不编造」，
 * 所以其余三个语种一律填 original_language 的原文题名（不机翻、不臆造）。
 */
function L4(orig, title, extra = {}) {
  const out = {};
  for (const loc of ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"]) {
    out[loc] = { title, ...(loc === orig ? extra : {}) };
  }
  return out;
}

const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

// ---------------------------------------------------------------- 主流程

const client = new Client();

// 并发战役下经代理访问时常出现 "fetch failed / other side closed"（TCP reset），
// lib.mjs 只对 429/5xx 重试，网络异常会直接抛出。这里在**本领域脚本内**给 call 包一层重试
// （不改共用库）：写入都带 Idempotency-Key 或 expected_version，重试是幂等的。
{
  const rawCall = client.call.bind(client);
  client.call = async (pathname, opts = {}) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await rawCall(pathname, opts);
      } catch (err) {
        const msg = String((err && err.message) || "");
        const transient = /fetch failed|socket|ECONNRESET|ETIMEDOUT|other side closed|UND_ERR/i.test(msg);
        if (!transient || attempt >= 6) throw err;
        console.log("  ~ net-retry(" + (attempt + 1) + ") " + (opts.method || "GET") + " " + pathname.slice(0, 60));
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  };
}

await client.login();
const camp = new Campaign({ domain: "kpop-mini", client, index: Index.load() });

const CREATED = [];       // 供回读断言使用：[{ entity, expect }]
const labelAgent = {};
const groupAgent = {};
const memberAgents = {};
const albumWorkByKey = {};
const songWorkByKey = {};   // key -> { title: workId }
const expressionByKey = {}; // key -> { title: { cd, web } }
const personCache = {};

async function ensurePerson(name, al, role) {
  const key = name.toLowerCase().replace(/\W+/g, "-");
  if (personCache[key]) return personCache[key];
  const ev = {
    note: "编目：音乐署名者 agent（person）「" + name + "」——《" + al.album.title + "》的" + role + "署名",
    sources: al.sources,
  };
  const p = await camp.ensureEntity("agent", name, {
    original_language: "en",
    types: ["person"],
    translations: L4("en", name),
    external_ids: {},
  }, ev, { idemKey: "kpop-mini-credit-" + key, allowServerLookup: true });
  personCache[key] = p;
  return p;
}

/**
 * 建实体 + 兜底：并发子代理可能已经先建出同名实体（服务端返回 4xx），
 * 或本地索引快照落后于服务端。此时退回服务端精确查重复用，避免硬失败。
 */
/** 网络抖动（ECONNRESET / fetch failed / 429）重试；服务端 4xx 不重试。 */
async function withRetry(fn, label, attempt = 0) {
  try {
    return await fn();
  } catch (err) {
    const transient = err && (err.name === "TypeError" || /fetch failed|socket|ECONN|ETIMEDOUT|终止/i.test(String(err.message)));
    if (transient && attempt < 5) {
      const wait = 2000 * (attempt + 1);
      console.log("  ~ retry(" + (attempt + 1) + ") " + label + "：" + String(err.message).slice(0, 80));
      await new Promise((r) => setTimeout(r, wait));
      return withRetry(fn, label, attempt + 1);
    }
    throw err;
  }
}

/** 建关系 + 网络抖动重试（lib 的 relationsOf 查询在代理抖动时会抛 fetch failed）。 */
function relate(type, sourceId, targetId, ev, opts) {
  return withRetry(() => camp.createRelation(type, sourceId, targetId, ev, opts), "relation " + type);
}

async function ensureSafely(kind, title, spec, ev, opts) {
  try {
    return await camp.ensureEntity(kind, title, spec, ev, opts);
  } catch (err) {
    if (err.http && err.http < 500) {
      const found = (await client.search(kind, title)).find((x) => norm(x.title) === norm(title));
      if (found) {
        camp.reused.entity++;
        camp.index.add(found);
        camp.log({ op: "entity", status: "reuse-server-fallback", kind, title, id: found.id, code: "原失败 " + err.http + " " + err.code });
        return found;
      }
    }
    throw err;
  }
}

/**
 * 幂等键携带父级作用域：服务端幂等缓存不做载荷哈希，同键第二次调用会被当成重放，
 * 因此 track 必须把 medium_id 并入幂等键（不同载体的同名曲目是不同的实体）。
 */
const keyWithParent = (prefix, parentId, ...rest) =>
  [prefix, String(parentId).slice(0, 18), ...rest].join("-");

/** 把某个作用域下的子实体先拉进本地索引，保证"先查重再建"不会重复建档。 */
const preloaded = new Set();
async function preload(scopeKey, value, kind) {
  if (!value) return 0;
  const key = kind + "|" + scopeKey + "|" + value;
  if (preloaded.has(key)) return 0;
  preloaded.add(key);
  const have = camp.index.rows.filter((r) => r.kind === kind && r[scopeKey] === value).length;
  if (have) return 0;
  const list = await client.listKind(kind);
  let added = 0;
  for (const e of list) if (e[scopeKey] === value) { if (!camp.index.byId(e.id)) { camp.index.add(e); added++; } }
  return added;
}

// —— 1. 厂牌 agent
for (const l of LABELS) {
  const ev = {
    note: "编目：K-pop 厂牌 agent（organization）「" + l.title + "」——本批 4 张迷你专辑的发行方",
    sources: [src(l.url, "厂牌条目：官方名称与韩文名 " + l.ko + "，用于确认发行方归属")],
  };
  labelAgent[l.title] = await camp.ensureEntity("agent", l.title, {
    original_language: "ko",
    types: ["organization"],
    translations: L4("ko", l.title, { aliases: [l.ko] }),
    external_ids: {},
  }, ev, { idemKey: "kpop-mini-label-" + l.title.replace(/\W+/g, "-").toLowerCase(), allowServerLookup: true });
}

// —— 2. 团体 + 成员（member_of）
for (const al of ALBUMS) {
  const ev = {
    note: "编目：K-pop 女子团体 agent（group）「" + al.album.artist + "」，韩文名 " + al.album.group_ko + "；表演者角色由 performed_by 关系表达",
    sources: al.sources,
  };
  const g = await camp.ensureEntity("agent", al.album.artist, {
    original_language: "ko",
    types: ["group"],
    translations: L4("ko", al.album.artist, { aliases: [al.album.group_ko] }),
    external_ids: {},
  }, ev, { idemKey: "kpop-mini-group-" + al.key, allowServerLookup: true });
  groupAgent[al.key] = g;

  memberAgents[al.key] = {};
  for (const [name, ko] of MEMBERS[al.key]) {
    const mev = {
      note: "编目：团体成员 agent（person）「" + name + "」（" + ko + "），隶属 " + al.album.artist,
      sources: al.sources,
    };
    const m = await camp.ensureEntity("agent", name, {
      original_language: "ko",
      types: ["person"],
      translations: L4("ko", name, { aliases: [ko] }),
      external_ids: {},
    }, mev, { idemKey: "kpop-mini-member-" + al.key + "-" + name.toLowerCase(), allowServerLookup: true });
    memberAgents[al.key][name] = m;
    await relate("member_of", m.id, g.id, {
      note: "编目：成员关系 " + name + " → " + al.album.artist,
      sources: al.sources,
    }, { attributes: {}, skipIfExists: !REL_DEDUP });
  }
}

// —— 3. 合集 collection
const collection = await camp.ensureEntity("collection", "2023–2024 K-pop 迷你专辑", {
  original_language: "ko",
  types: ["collection"],
  attributes: { language: "ko" },
  translations: L4("ko", "2023–2024 K-pop 迷你专辑"),
}, {
  note: "编目：合集（collection）「2023–2024 K-pop 迷你专辑」，聚合本批 K-pop 迷你专辑作品（用 includes 关系）",
  sources: [S_WIKI.twice, S_WIKI.nj, S_WIKI.aespa, S_WIKI.idle],
}, { idemKey: "kpop-mini-collection", allowServerLookup: true });

// —— 4. 逐专辑建链
for (const al of ALBUMS) {
  const label = labelAgent[al.album.label];
  const group = groupAgent[al.key];

  // album Work
  const album = await camp.ensureEntity("work", al.album.title, {
    original_language: "ko",
    types: ["album"],
    attributes: { tags: ["K-pop", "mini album", "EP"] },
    translations: L4("ko", al.album.title, { aliases: [al.album.artist + " - " + al.album.title] }),
    external_ids: al.album.ext || {},
  }, {
    note: "编目：K-pop 迷你专辑《" + al.album.title + "》（" + al.album.artist + "）建为 album Work（纯净题名，版本信息放 Release）；" + al.album.type_labels,
    sources: al.sources,
  }, { idemKey: "kpop-mini-album-" + al.key, allowServerLookup: false });
  albumWorkByKey[al.key] = album;
  CREATED.push({ entity: album, expect: {} });

  await relate("performed_by", album.id, group.id, {
    note: "编目：《" + al.album.title + "》的表演者为 " + al.album.artist,
    sources: al.sources,
  }, { attributes: { credit_role: "performer" }, skipIfExists: !REL_DEDUP });
  await relate("created_by", album.id, label.id, {
    note: "编目：《" + al.album.title + "》由 " + al.album.label + " 制作发行",
    sources: al.sources,
  }, { attributes: { credit_role: "label" }, skipIfExists: !REL_DEDUP });

  const subs = [{ work_id: album.id, role: "primary", position: 0 }];
  expressionByKey[al.key] = {};
  songWorkByKey[al.key] = {};

  for (let i = 0; i < al.tracks.length; i++) {
    const t = al.tracks[i];
    const pos = i + 1;
    const cred = al.credits.find((c) => c.song === t.title) || {};
    const lang = t.lang || "ko";

    // song Work
    const sw = await camp.ensureEntity("work", t.title, {
      original_language: lang,
      types: ["song"],
      attributes: { tags: ["K-pop"] },
      translations: t.ko ? L4("ko", t.title, { aliases: [t.ko] }) : L4(lang, t.title, { aliases: [al.album.artist + " - " + t.title] }),
      external_ids: {},
    }, {
      note: "编目：K-pop 迷你专辑《" + al.album.title + "》第 " + pos + " 首曲目「" + t.title + "」建为 song Work"
        + (cred.lyrics ? "；署名 作词 " + cred.lyrics.join("/") + "；作曲 " + (cred.music || []).join("/") + "；编曲 " + (cred.arrange || []).join("/") : ""),
      sources: al.sources,
    }, { idemKey: "kpop-mini-song-" + al.key + "-" + pos, allowServerLookup: false });
    songWorkByKey[al.key][t.title] = sw.id;
    subs.push({ work_id: sw.id, role: "compilation", position: pos });
    CREATED.push({ entity: sw, expect: {} });

    await relate("performed_by", sw.id, group.id, {
      note: "编目：曲目「" + t.title + "」由 " + al.album.artist + " 演唱（收录于《" + al.album.title + "》）",
      sources: al.sources,
    }, { attributes: { credit_role: "performer" }, skipIfExists: !REL_DEDUP });

    // 篇目 ContentUnit（曲目在专辑里的位置）
    const cu = await camp.ensureEntity("content_unit", t.title, {
      work_id: sw.id,
      position: pos,
      number: String(pos),
      original_language: lang,
      types: ["content_unit"],
      attributes: { entry_role: "main", language: lang },
      translations: t.ko ? L4("ko", t.title, { aliases: [t.ko] }) : L4(lang, t.title),
      external_ids: {},
    }, {
      note: "编目：专辑《" + al.album.title + "》第 " + pos + " 首「" + t.title + "」的篇目（ContentUnit）：number 保留官方曲序、position 表示排序；parent 为空，父级由 work_id 归属"
        + (t.note ? "；官方标注 " + t.note : ""),
      sources: al.sources,
    }, { idemKey: "kpop-mini-cu-" + al.key + "-" + pos, allowServerLookup: false });
    CREATED.push({ entity: cu, expect: { work_id: sw.id, position: pos } });

    // 署名关系：挂在 song Work 与篇目上。
    // 注意 definitions 里的两端 kind：lyricist_of / composed_by 允许 work+content_unit+expression，
    // 而 arranged_by 只允许 work+expression（**不含 content_unit**）——所以编曲只挂在 Work 上。
    const pairs = [
      ["lyricist", "lyricist_of", cred.lyrics, "作词", true],
      ["composer", "composed_by", cred.music, "作曲", true],
      ["arranger", "arranged_by", cred.arrange, "编曲", false],
    ];
    for (const [role, type, names, cn, onUnit] of pairs) {
      if (!names || !names.length) continue;
      for (const nm of names) {
        const ag = await ensurePerson(nm, al, cn);
        const relNote = "编目：《" + al.album.title + "》曲目「" + t.title + "」的" + cn + "署名 " + nm;
        await relate(type, sw.id, ag.id, { note: relNote, sources: al.sources }, { attributes: { credit_role: role }, skipIfExists: !REL_DEDUP });
        if (onUnit) await relate(type, cu.id, ag.id, { note: relNote, sources: al.sources }, { attributes: { credit_role: role }, skipIfExists: !REL_DEDUP });
      }
    }

    // Expression：实体 CD 版 / 数字版两条录音表达，都用 content_unit_id 挂到篇目
    const exprIds = {};
    for (const kind of ["cd", "web"]) {
      const zh = kind === "cd" ? "实体 CD" : "数字下载";
      const e = await camp.ensureEntity("expression", t.title + " (" + (kind === "cd" ? "CD" : "digital") + ")", {
        work_id: sw.id,
        content_unit_id: cu.id,
        position: pos,
        original_language: lang,
        types: ["expression"],
        attributes: { language: lang, duration: t.dur[kind] },
        translations: t.ko ? L4("ko", t.title, { aliases: [t.ko] }) : L4(lang, t.title),
        external_ids: {},
      }, {
        note: "编目：《" + al.album.title + "》" + zh + "版第 " + pos + " 首「" + t.title + "」的录音表达（Expression），content_unit_id 挂到该曲目篇目；时长 " + t.dur[kind] + " 秒取自实测曲目表",
        sources: al.sources,
      }, { idemKey: "kpop-mini-expr-" + al.key + "-" + pos + "-" + kind, allowServerLookup: false });
      exprIds[kind] = e.id;
      CREATED.push({ entity: e, expect: { work_id: sw.id, content_unit_id: cu.id, position: pos } });
    }
    expressionByKey[al.key][t.title] = exprIds;
  }

  // —— Release / Medium / Track
  for (const spec of al.releases) {
    const isCd = spec.kind === "physical";
    const existingRel = camp.index.rows.find((r) => r.kind === "release" && r.title === spec.title);
    if (existingRel) await preload("release_id", existingRel.id, "medium");
    if (existingRel) for (const m of camp.index.rows.filter((r) => r.kind === "medium" && r.release_id === existingRel.id)) await preload("medium_id", m.id, "track");
    const zh = isCd ? "实体 CD 版" : "数字下载版";
    const relAttrs = {
      edition_date: spec.date,
      edition_type: "standard",
      edition_batch: isCd ? "first_press" : "regular",
      country: spec.country,
      publisher: label.id,
      packaging: spec.packaging,
      distribution_channel: spec.channel,
    };
    if (spec.catalog) relAttrs.catalog_number = spec.catalog;

    const rel = await camp.ensureEntity("release", spec.title, {
      original_language: "ko",
      types: ["release"],
      attributes: relAttrs,
      translations: L4("ko", spec.title, { aliases: [al.album.artist + " - " + spec.title] }),
      external_ids: {},
      subjects: subs,
    }, {
      note: "编目：《" + al.album.title + "》" + zh + "发行版（Release）：发行日 " + spec.date + "、厂牌 " + al.album.label
        + (spec.catalog ? "、品番 " + spec.catalog : "") + "；subjects 声明该发行收录的专辑 Work（primary）与全部曲目 Work（compilation）",
      sources: al.sources,
    }, { idemKey: "kpop-mini-release-" + al.key + "-" + spec.kind, allowServerLookup: false });

    await relate("performed_by", rel.id, group.id, {
      note: "编目：发行版《" + spec.title + "》的表演者为 " + al.album.artist,
      sources: al.sources,
    }, { attributes: { credit_role: "performer" }, skipIfExists: !REL_DEDUP });
    await relate("created_by", rel.id, label.id, {
      note: "编目：发行版《" + spec.title + "》由 " + al.album.label + " 发行",
      sources: al.sources,
    }, { attributes: { credit_role: "label" }, skipIfExists: !REL_DEDUP });

    await preload("release_id", rel.id, "medium");
    const med = await camp.ensureEntity("medium", spec.medium, {
      release_id: rel.id,
      position: 1,
      original_language: "ko",
      types: ["medium"],
      attributes: { format: spec.format, role: "primary" },
      translations: L4("ko", spec.medium),
      external_ids: {},
    }, {
      note: "编目：发行版《" + spec.title + "》的载体（Medium）——" + spec.medium + "，format=" + spec.format + "，position 1",
      sources: al.sources,
    }, { idemKey: keyWithParent("kpop-mini-medium", rel.id, al.key, spec.kind), allowServerLookup: false, scope: { release_id: rel.id } });
    CREATED.push({ entity: med, expect: { release_id: rel.id, position: 1 } });

    await preload("medium_id", med.id, "track");
    for (let i = 0; i < al.tracks.length; i++) {
      const t = al.tracks[i];
      const pos = i + 1;
      const lang = t.lang || "ko";
      const exprId = expressionByKey[al.key][t.title][isCd ? "cd" : "web"];
      const trk = await camp.ensureEntity("track", t.title, {
        medium_id: med.id,
        position: pos,
        number: String(pos),
        original_language: lang,
        types: ["track"],
        attributes: { role: "primary", duration: t.dur[isCd ? "cd" : "web"] },
        translations: t.ko ? L4("ko", t.title, { aliases: [t.ko] }) : L4(lang, t.title),
        external_ids: {},
      }, {
        note: "编目：《" + spec.title + "》" + spec.medium + " 第 " + pos + " 轨「" + t.title + "」，做载体位置项",
        sources: al.sources,
      }, { idemKey: keyWithParent("kpop-mini-track", med.id, al.key, spec.kind, pos), allowServerLookup: false });

      if (DRY) {
        CREATED.push({ entity: trk, expect: { medium_id: med.id, position: pos, contents: [exprId] } });
      } else {
        const upd = await camp.updateEntity(trk.id, {
          contents: [{ expression_id: exprId, position: pos, locator: null }],
        }, {
          note: "编目：回填 Track contents——引用《" + al.album.title + "》第 " + pos + " 首曲目的 " + (isCd ? "CD" : "数字") + "版 Expression（整轨收录，locator 为空）",
          sources: al.sources,
        });
        CREATED.push({ entity: upd, expect: { medium_id: med.id, position: pos, contents: [exprId] } });
      }
    }

    CREATED.push({ entity: rel, expect: { subjects: subs.map((s) => s.work_id) } });
  }

}

// —— 5. 补充关系：includes / sequel_of / bonus_included_in
for (const al of ALBUMS) {
  await relate("includes", collection.id, albumWorkByKey[al.key].id, {
    note: "编目：合集「2023–2024 K-pop 迷你专辑」收录《" + al.album.title + "》",
    sources: al.sources,
  }, { attributes: {}, skipIfExists: !REL_DEDUP });
}

for (const al of ALBUMS) {
  if (!al.sequel_of_title) continue;
  const prev = camp.index.rows.find((r) => r.kind === "work" && norm(r.title) === norm(al.sequel_of_title));
  if (prev) {
    await relate("sequel_of", albumWorkByKey[al.key].id, prev.id, {
      note: "编目：《I feel》是 (G)I-DLE 上一张韩语迷你专辑《" + al.sequel_of_title + "》(2022) 的后续作品",
      sources: al.sources,
    }, { attributes: {}, skipIfExists: !REL_DEDUP });
  } else {
    camp.log({ op: "relation", status: "skip", title: "sequel_of", code: "前作《" + al.sequel_of_title + "》不在本地索引，不新建 Work（避免虚构）" });
  }
}

for (const al of ALBUMS) {
  const rel = camp.index.rows.find((r) => r.kind === "release" && r.title === al.releases[0].title);
  if (!rel) continue;
  const t2 = al.tracks[1].title;
  await relate("bonus_included_in", expressionByKey[al.key][t2].web, rel.id, {
    note: "编目：《" + al.album.title + "》数字版录音「" + t2 + "」也被实体 CD 发行《" + al.releases[0].title + "》收录（同一 Expression 跨 Release 复用）",
    sources: al.sources,
  }, { attributes: { role: "supplement" }, skipIfExists: !REL_DEDUP });
}

// ---------------------------------------------------------------- 写后回读断言
//
// 三级断言：
//   A. 结构归属：work_id / content_unit_id / release_id / medium_id / position / subjects / contents / version
//   B. 关系落库（lib 幂等键修补后必须逐条回读）：每个 source 的 relationsOf 里，期望边一条不少、且无重复边
//   C. 反向覆盖：collection.includes 覆盖 4 张专辑；子实体归属与父实体一致
const problems = [];
let checked = 0;
const SAMPLE = !process.argv.includes("--full-assert");

if (!DRY) {
  // ---- A. 结构归属 + 写后版本/revision
  const seen = new Set();
  for (const rec of CREATED) {
    const id = rec.entity && rec.entity.id;
    if (!id || id.startsWith("DRY-") || seen.has(id)) continue;
    seen.add(id);
    const e = rec.expect || {};
    const mustCheck = e.subjects !== undefined || e.contents !== undefined || e.work_id !== undefined
      || e.content_unit_id !== undefined || e.release_id !== undefined || e.medium_id !== undefined || !SAMPLE;
    if (!mustCheck) continue;
    const cur = await camp.getEntity(id);
    checked++;
    const kind = cur.kind;
    if (e.work_id !== undefined && cur.work_id !== e.work_id) problems.push(kind + " " + id + " work_id 期望 " + e.work_id + " 实际 " + cur.work_id);
    if (e.content_unit_id !== undefined && cur.content_unit_id !== e.content_unit_id) problems.push(kind + " " + id + " content_unit_id 期望 " + e.content_unit_id + " 实际 " + cur.content_unit_id);
    if (e.release_id !== undefined && cur.release_id !== e.release_id) problems.push(kind + " " + id + " release_id 期望 " + e.release_id + " 实际 " + cur.release_id);
    if (e.medium_id !== undefined && cur.medium_id !== e.medium_id) problems.push(kind + " " + id + " medium_id 期望 " + e.medium_id + " 实际 " + cur.medium_id);
    if (e.position !== undefined && cur.position !== e.position) problems.push(kind + " " + id + " position 期望 " + e.position + " 实际 " + cur.position);
    if (e.subjects !== undefined) {
      const got = (cur.subjects || []).map((s) => s.work_id).sort();
      const want = e.subjects.slice().sort();
      if (got.length !== want.length || got.some((x, i) => x !== want[i])) problems.push("release " + id + " subjects 覆盖不足：期望 " + want.length + " 项，实际 " + got.length + " 项");
    }
    if (e.contents !== undefined) {
      const got = (cur.contents || []).map((c) => c.expression_id);
      if (JSON.stringify(got) !== JSON.stringify(e.contents)) problems.push("track " + id + " contents 期望 " + JSON.stringify(e.contents) + " 实际 " + JSON.stringify(got));
    }
    if (!(cur.version >= 1)) problems.push(kind + " " + id + " version/revision 缺失");
  }

  // ---- B/C. 关系回读：按 source 聚合期望边，逐条核对落库 + 无重复
  const expectEdges = [];
  const addEdge = (srcId, type, tgtId, label) => { if (srcId && tgtId) expectEdges.push({ srcId, type, tgtId, label }); };

  for (const al of ALBUMS) {
    const g = groupAgent[al.key];
    const rel = camp.index.rows.find((r) => r.kind === "release" && r.title === al.releases[0].title);
    addEdge(albumWorkByKey[al.key].id, "performed_by", g.id, "album " + al.album.title);
    addEdge(albumWorkByKey[al.key].id, "created_by", labelAgent[al.album.label].id, "album " + al.album.title);
    if (rel) {
      addEdge(rel.id, "performed_by", g.id, "release " + rel.title);
      addEdge(rel.id, "created_by", labelAgent[al.album.label].id, "release " + rel.title);
    }
    for (const [name] of MEMBERS[al.key]) addEdge(memberAgents[al.key][name].id, "member_of", g.id, "member " + name);
    for (const t of al.tracks) {
      const sw = songWorkByKey[al.key][t.title];
      addEdge(sw, "performed_by", g.id, "song " + t.title);
      const cred = al.credits.find((c) => c.song === t.title) || {};
      for (const nm of cred.lyrics || []) addEdge(sw, "lyricist_of", personCache[nm.toLowerCase().replace(/\W+/g, "-")].id, "song " + t.title);
      for (const nm of cred.music || []) addEdge(sw, "composed_by", personCache[nm.toLowerCase().replace(/\W+/g, "-")].id, "song " + t.title);
      for (const nm of cred.arrange || []) addEdge(sw, "arranged_by", personCache[nm.toLowerCase().replace(/\W+/g, "-")].id, "song " + t.title);
    }
    addEdge(collection.id, "includes", albumWorkByKey[al.key].id, "collection includes " + al.album.title);
    addEdge(expressionByKey[al.key][al.tracks[1].title].web, "bonus_included_in", rel ? rel.id : "", "bonus " + al.tracks[1].title);
  }

  // 每个 source 一次 relationsOf
  const bySrc = new Map();
  for (const ed of expectEdges) {
    if (!bySrc.has(ed.srcId)) bySrc.set(ed.srcId, []);
    bySrc.get(ed.srcId).push(ed);
  }
  let relChecked = 0;
  const dupEdges = [];
  for (const [srcId, eds] of bySrc) {
    const got = await client.relationsOf(srcId);
    relChecked += got.length;
    for (const ed of eds) {
      const hits = got.filter((r) => r.type === ed.type && r.target_id === ed.tgtId);
      if (!hits.length) problems.push("关系未落库：" + ed.type + " " + srcId.slice(0, 8) + "→" + ed.tgtId.slice(0, 8) + "（" + ed.label + "）");
      else if (hits.length > 1) dupEdges.push(ed.type + " " + srcId.slice(0, 8) + "→" + ed.tgtId.slice(0, 8) + " ×" + hits.length);
    }
  }
  if (dupEdges.length) problems.push("同源同靶重复边 " + dupEdges.length + " 组：" + dupEdges.slice(0, 12).join("；"));
  console.log("关系回读：source " + bySrc.size + " 个，期望边 " + expectEdges.length + " 条，实读边 " + relChecked + " 条");
  globalThis.__relChecked = relChecked;
  globalThis.__expectEdges = expectEdges.length;
}
const relChecked = globalThis.__relChecked || 0;
const expectEdgesN = globalThis.__expectEdges || 0;

// 计划量统计（dry-run 也能看出规模）
const plan = {};
for (const rec of CREATED) {
  const k = rec.entity && rec.entity.kind;
  if (!k) continue;
  plan[k] = (plan[k] || 0) + 1;
}
console.log("\n计划实体（含 Release/Medium/Track/Expression 断言记录）：" + JSON.stringify(plan));

console.log("\n=== 回读断言 ===");
console.log("回读实体 " + checked + " 条，期望关系边 " + expectEdgesN + " 条 / 实读边 " + relChecked + " 条，问题 " + problems.length + " 条");
for (const p of problems) console.log("  ✗ " + p);

const summary = camp.summary({
  albums: ALBUMS.map((a) => ({
    key: a.key,
    album_work: albumWorkByKey[a.key] && albumWorkByKey[a.key].id,
    title: a.album.title,
    songs: a.tracks.length,
    first_song_work: songWorkByKey[a.key] && songWorkByKey[a.key][a.tracks[0].title],
  })),
  readback: { entities_checked: checked, expected_edges: expectEdgesN, relations_read: relChecked, problems },
});
process.exitCode = (camp.failed.length === 0 && problems.length === 0) ? 0 : 1;