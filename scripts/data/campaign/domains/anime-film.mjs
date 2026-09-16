#!/usr/bin/env node
// 领域 11：动画剧场版（BD/DVD 发行 + 改编关系）
//
// 三条真实链（全部来自官方 / 维基 / Bangumi / openBD / 唱片公司页面，逐条见 SRC*）：
//   A 君の名は。（2016）          作品 → 篇目（本編 / 予告・プロモ映像集）→ 表达 → BD/DVD 发行 → 载体 → 轨道
//                                  + 同名 OST 专辑（Universal Music，品番 UPCH-20423，4 首主題歌中的 2 首）
//   B 劇場版「鬼滅の刃」無限列車編（2020） 作品 → 本編 → 表达 → BD → 载体 → 轨道；TV 动画（続編关系）；
//                                  ノベライズ（集英社，ISBN 978-4-08-703503-2）作为 adaptation_of
//   C 劇場版 少女☆歌劇 レヴュースタァライト（2021） 作品 → 本編 → 表达 → BD（OVXN-0058）→ 载体 → 轨道；
//                                  TV 动画（2018）作为 sequel_of
//
// 只写真实数据；拿不到证据的字段留空（并在报告缺口清单里写明）。

import { Campaign, Client, Index, src } from "../lib.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

// ---------- 来源 ----------
const jaWiki = (t) => "https://ja.wikipedia.org/wiki/" + encodeURIComponent(t);
const zhWiki = (t) => "https://zh.wikipedia.org/wiki/" + encodeURIComponent(t);
const bgmSub = (id) => "https://bgm.tv/subject/" + id;

const SRC = {
  // 君の名は。
  knnWiki: src(jaWiki("君の名は。"), "ja.wikipedia「君の名は。」：ホームメディア（発売形態 4 形态与品番 TBR27260D/61D/62D・TDV27263D、映像特典内容表）、スタッフ（監督・脚本 新海誠、音楽 RADWIMPS）、上映時間（BD 版 106 分 29 秒）"),
  knnZhWiki: src(zhWiki("你的名字。"), "zh.wikipedia「你的名字。」：中文题名与剧场版定位"),
  knnBgm: src(bgmSub(160209), "Bangumi 条目 160209《君の名は。》：中文名「你的名字。」、上映日 2016-08-26、封面"),
  knnOst: src("https://www.universal-music.co.jp/radwimps/products/upch-20423/", "UNIVERSAL MUSIC JAPAN 商品页《君の名は。［通常盤］》：品番 UPCH-20423、发售日 2016.08.24、レーベル EMI Records、発売元 ユニバーサル ミュージック合同会社、全 27 曲目（1 夢灯籠 / 8 前前前世 (movie ver.) / 24 スパークル (movie ver.)）"),
  knnNdl: src("https://ndlsearch.ndl.go.jp/api/opensearch?title=" + encodeURIComponent("君の名は") + "&cnt=20", "国立国会図書館サーチ：确认《君の名は。 : Blu-rayコレクターズ・エディション》由東宝 2017.7 发售"),
  // 劇場版 鬼滅の刃 無限列車編
  kmWiki: src(jaWiki("劇場版「鬼滅の刃」無限列車編"), "ja.wikipedia「劇場版「鬼滅の刃」無限列車編」：監督 外崎春雄、脚本制作・アニメーション制作 ufotable、音楽 梶浦由記・椎名豪、主題歌 LiSA「炎」、上映時間 117 分、声の出演、関連商品（Blu-ray/DVD 2021-06-16 アニプレックス発売・完全生産限定版、ノベライズ ISBN）"),
  kmTvWiki: src(jaWiki("鬼滅の刃 (アニメ)"), "ja.wikipedia「鬼滅の刃 (アニメ)」：劇場版被明确记为电视动画第 1 期『竈門炭治郎 立志編』的続編；TV 版 2019-04-06 起播出"),
  kmZhWiki: src(zhWiki("鬼滅之刃劇場版 無限列車篇"), "zh.wikipedia「鬼滅之刃劇場版 無限列車篇」：繁中题名"),
  kmBgm: src(bgmSub(291494), "Bangumi 条目 291494：中文名「剧场版 鬼灭之刃 无限列车篇」、上映日 2020-10-16、封面"),
  kmOpenBd: src("https://api.openbd.jp/v1/get?isbn=9784087035032", "openBD ISBN 978-4-08-703503-2：『劇場版鬼滅の刃無限列車編 : ノベライズ』、集英社、2020-10、シリーズ JUMP j BOOKS、著者 吾峠呼世晴/矢島綾/ufotable"),
  // 劇場版 少女☆歌劇 レヴュースタァライト
  rsWiki: src(jaWiki("劇場版 少女☆歌劇 レヴュースタァライト"), "ja.wikipedia「劇場版 少女☆歌劇 レヴュースタァライト」：監督 古川知宏、脚本 樋口達人、音楽 藤澤慶昌・加藤達也、原作 ブシロード/ネルケプランニング/キネマシトラス、上映時間 120 分、上映日 2021-06-04、Blu-ray 2021-12-22 オーバーラップ 品番 OVXN-0058、キャスト表"),
  rsTvWiki: src(jaWiki("少女☆歌劇 レヴュースタァライト"), "ja.wikipedia「少女☆歌劇 レヴュースタァライト」：2018 年 TV 动画原作（剧场版为其续作）"),
  rsBgm: src(bgmSub(294135), "Bangumi 条目 294135：中文名「剧场版 少女☆歌剧 Revue Starlight」、上映日 2021-06-04、封面"),
};

// ---------- 工具 ----------
const tr4 = (ja, zhCN, zhTW, en) => ({
  "ja-JP": { title: ja },
  "zh-CN": { title: zhCN || ja },
  "zh-TW": { title: zhTW || zhCN || ja },
  "en-US": { title: en || ja },
});
const trJa = (ja) => ({ "ja-JP": { title: ja } });
// 没有官方译名时，各语种填原文题名（BRIEF 第 0.4 条），不编造译名
const trAll = (ja) => ({ "ja-JP": { title: ja }, "zh-CN": { title: ja }, "zh-TW": { title: ja }, "en-US": { title: ja } });

const pic = (url, cite, url2, caption) => ([{
  url,
  caption: { "ja-JP": caption, "zh-CN": caption },
  source: { kind: "url", citation: cite, url: url2 },
}]);

const client = new Client();
await client.login();
const camp = new Campaign({ domain: "anime-film", client, index: Index.load() });

// 运行时读一遍 definitions：entry_role 词表在文档与实例之间曾有出入（BRIEF 表里没有 trailer，
// 但实例 definitions 有）。这里按实例口径选择码，避免写出一条注定被拒的篇目。
const defs = await client.call("/api/catalog/definitions");
const entryRoleTerms = Object.keys((((defs.body || {}).document || {}).vocabularies || {}).entry_role?.terms || {});
const PROMO_ENTRY_ROLE = entryRoleTerms.includes("trailer") ? "trailer" : "extra";
console.log("definitions base_version=" + (defs.body || {}).base_version + " entry_role 含 trailer=" + (PROMO_ENTRY_ROLE === "trailer"));

// 结构作用域预载：把全库现有实体（含 types 与 work_id/release_id/medium_id/parent_id）先灌进本地索引。
// 原因（实测）：服务端 ?q= 对「君の名は。」这类带标点的题名匹配不到（q=君の名は。→0 条，q=君の名は→2 条），
// 而 lib 的服务端复用判定没有 types 维度，会把同名跨 kind 的条目（电影 Work 与同名 OST 专辑）误判成同一条。
// 预载后所有创建改为只按本地索引查重，重跑安全。
async function preloadIndex() {
  const kinds = ["collection", "work", "agent", "content_unit", "expression", "release", "medium", "track"];
  let n = 0;
  for (const k of kinds) {
    const rows = await client.listKind(k);
    for (const r of rows) camp.index.add(r);
    n += rows.length;
    console.log("preload " + k + " = " + rows.length);
  }
  console.log("预载完成：拉取 " + n + " 条，本地索引 " + camp.index.rows.length + " 条");
}
await preloadIndex();

const E = {};   // 内部名 -> 实体
const EXPR_WORK = {}; // expression id -> work id（用于 subjects 覆盖断言）
const TRACK_REL = []; // { releaseKey, trackIds[] }

async function mk(name, kind, title, spec, ev, opts = {}) {
  // 查重只走预载的本地索引（allowServerLookup 默认关；需要时可在 opts 里单独打开）
  const e = await camp.ensureEntity(kind, title, spec, ev, { allowServerLookup: false, ...opts });
  // dry-run 时 lib 用「kind+题名前 20 字」生成占位 id，同名实体（电影与同名 OST 专辑）会撞成同一个 id，
  // 关系两端就会误判自环；而复用命中若也被改 id，子级作用域查重就全部落空、看不出真实复用情况。
  // 所以只给"将要新建"的实体换按内部名唯一的占位 id，复用命中保留真实 id。
  if (DRY_RUN && String(e.id).startsWith("DRY-")) e.id = "DRY-" + kind + "-" + name;
  E[name] = e;
  if (kind === "expression" && spec.work_id) EXPR_WORK[e.id] = spec.work_id;
  return e;
}

// =====================================================================
// A. 君の名は。（2016 剧场版）
// =====================================================================
const A = { note: "编目：2016 年剧场版动画《君の名は。》的创作母体、篇目、表达与 BD/DVD 发行；字段取自 ja 维基百科「君の名は。」（発売形態/映像特典内容/スタッフ）、UNIVERSAL MUSIC 商品页与 Bangumi 条目 160209。", sources: [SRC.knnWiki, SRC.knnNdl, SRC.knnBgm] };

// --- agents ---
await mk("shinkai", "agent", "新海誠", {
  original_language: "ja", types: ["person"], translations: trJa("新海誠"),
}, { note: "编目：新海誠（1973- ），《君の名は。》原作・脚本・監督（ja 维基百科 スタッフ 表）。", sources: [SRC.knnWiki] }, { idemKey: "anime-film-agent-shinkai" });

await mk("radwimps", "agent", "RADWIMPS", {
  original_language: "ja", types: ["group"], translations: trJa("RADWIMPS"),
}, { note: "编目：RADWIMPS，日本摇滚乐队；《君の名は。》音楽担当（ja 维基百科 スタッフ 表）兼同名 OST 专辑演奏者（UNIVERSAL MUSIC 商品页 艺术家 RADWIMPS）。", sources: [SRC.knnWiki, SRC.knnOst] }, { idemKey: "anime-film-agent-radwimps" });

await mk("noda", "agent", "野田洋次郎", {
  original_language: "ja", types: ["person"], translations: trJa("野田洋次郎"),
}, { note: "编目：野田洋次郎，RADWIMPS 主唱；Bangumi 条目 187695 的资料把 OST 专辑的作词/作曲归他。", sources: [SRC.knnOst, src(bgmSub(187695), "Bangumi 条目 187695《君の名は。》OST：艺术家 RADWIMPS、作词 野田洋次郎、作曲 野田洋次郎/桑原彰/武田祐介")] }, { idemKey: "anime-film-agent-noda" });

await mk("cwfilms", "agent", "コミックス・ウェーブ・フィルム", {
  original_language: "ja", types: ["organization"], translations: trJa("コミックス・ウェーブ・フィルム"),
}, { note: "编目：コミックス・ウェーブ・フィルム（CoMix Wave Films），《君の名は。》制作公司（ja 维基百科 スタッフ 表「制作」）。", sources: [SRC.knnWiki] }, { idemKey: "anime-film-agent-cwfilms" });

await mk("toho", "agent", "東宝", {
  original_language: "ja", types: ["organization"], translations: trJa("東宝"),
}, { note: "编目：東宝，日本发行公司；《君の名は。》BD/DVD 発売・販売（国立国会図書館サーチ 书目）与剧场配给。", sources: [SRC.knnNdl, SRC.knnWiki] }, { idemKey: "anime-film-agent-toho" });

await mk("universal", "agent", "ユニバーサル ミュージック合同会社", {
  original_language: "ja", types: ["organization"], translations: trJa("ユニバーサル ミュージック合同会社"),
}, { note: "编目：《君の名は。》OST 专辑的発売元（UNIVERSAL MUSIC JAPAN 商品页）。", sources: [SRC.knnOst] }, { idemKey: "anime-film-agent-universal" });

await mk("taki", "agent", "立花瀧", {
  original_language: "ja", types: ["character"], translations: trJa("立花瀧"),
}, { note: "编目：立花瀧，《君の名は。》主人公之一（ja 维基百科 登場人物，声 神木隆之介）。", sources: [SRC.knnWiki] }, { idemKey: "anime-film-agent-taki" });

await mk("mitsuha", "agent", "宮水三葉", {
  original_language: "ja", types: ["character"], translations: trJa("宮水三葉"),
}, { note: "编目：宮水三葉，《君の名は。》主人公之一（ja 维基百科 登場人物，声 上白石萌音）。", sources: [SRC.knnWiki] }, { idemKey: "anime-film-agent-mitsuha" });

await mk("kamiki", "agent", "神木隆之介", {
  original_language: "ja", types: ["person"], translations: trJa("神木隆之介"),
}, { note: "编目：神木隆之介，《君の名は。》立花瀧 声优（ja 维基百科 登場人物/映像特典 ビジュアルコメンタリー）。", sources: [SRC.knnWiki] }, { idemKey: "anime-film-agent-kamiki", allowServerLookup: true });

await mk("kamishiraishi", "agent", "上白石萌音", {
  original_language: "ja", types: ["person"], translations: trJa("上白石萌音"),
}, { note: "编目：上白石萌音，《君の名は。》宮水三葉 声优（ja 维基百科 登場人物）。", sources: [SRC.knnWiki] }, { idemKey: "anime-film-agent-kamishiraishi" });

// --- work / content_unit / expression ---
const filmA = await mk("filmA", "work", "君の名は。", {
  original_language: "ja", types: ["film"],
  translations: tr4("君の名は。", "你的名字。", "你的名字。", "your name."),
  attributes: { duration: 6389, language: "ja", tags: ["アニメーション映画", "劇場版"] },
  external_ids: { bangumi: "160209", wikipedia: zhWiki("你的名字。") },
  pictures: pic("https://lain.bgm.tv/pic/cover/l/20/15/160209_2UzU8.jpg", "Bangumi 条目 160209 官方海报封面（剧场版《你的名字。》）", bgmSub(160209), "《君の名は。》剧场版封面（Bangumi 条目 160209）"),
}, A, { idemKey: "anime-film-work-knn", scope: { types: "film" } });

const cuMainA = await mk("cuMainA", "content_unit", "本編", {
  work_id: filmA.id, position: 1, number: "",
  original_language: "ja", types: ["content_unit"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { language: "ja", entry_role: "main" },
}, A, { idemKey: "anime-film-cu-knn-main", scope: { work_id: filmA.id } });

const exprMainA = await mk("exprMainA", "expression", "本編", {
  work_id: filmA.id, content_unit_id: cuMainA.id, position: 1,
  original_language: "ja", types: ["expression"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { language: "ja", duration: 6389, version_label: "劇場公開版（BD 収録 106 分 29 秒）" },
}, A, { idemKey: "anime-film-expr-knn-main", scope: { work_id: filmA.id } });

// 映像特典内容表：本編ディスク 另收「英語主題歌版本編」「プロモーション映像集（特報・予告・TVスポットなど）」
const cuPromoA = await mk("cuPromoA", "content_unit", "予告編・プロモーション映像集", {
  work_id: filmA.id, position: 2, number: "",
  original_language: "ja", types: ["content_unit"],
  translations: tr4("予告編・プロモーション映像集", "预告 / 宣传影像集", "預告 / 宣傳影像集", "Trailers and promotional videos"),
  attributes: { language: "ja", entry_role: PROMO_ENTRY_ROLE },
}, A, { idemKey: "anime-film-cu-knn-promo", scope: { work_id: filmA.id } });

const exprPromoA = await mk("exprPromoA", "expression", "予告編・プロモーション映像集", {
  work_id: filmA.id, content_unit_id: cuPromoA.id, position: 2,
  original_language: "ja", types: ["expression"],
  translations: tr4("予告編・プロモーション映像集", "预告 / 宣传影像集", "預告 / 宣傳影像集", "Trailers and promotional videos"),
  attributes: { language: "ja", version_label: "特報・予告・TVスポット 他" },
}, A, { idemKey: "anime-film-expr-knn-promo", scope: { work_id: filmA.id } });

const exprEnEdA = await mk("exprEnEdA", "expression", "英語主題歌版本編", {
  work_id: filmA.id, content_unit_id: cuMainA.id, position: 3,
  original_language: "en", types: ["expression"],
  translations: tr4("英語主題歌版本編", "英语主题歌版正片", "英語主題歌版正片", "English theme song version"),
  attributes: { language: "en", duration: 6389, version_label: "英語主題歌版" },
}, A, { idemKey: "anime-film-expr-knn-enedition", scope: { work_id: filmA.id } });

// --- releases ---
const relBdA = await mk("relBdA", "release", "「君の名は。」Blu-ray スペシャル・エディション", {
  original_language: "ja", types: ["release"],
  translations: tr4("「君の名は。」Blu-ray スペシャル・エディション", "《你的名字。》Blu-ray 特别版", "《你的名字。》Blu-ray 特別版", "Your Name. Blu-ray Special Edition"),
  attributes: {
    catalog_number: "TBR27261D", edition_date: "2017-07-26", edition_type: "deluxe",
    country: "JP", publisher: E.toho.id, distribution_channel: "physical",
  },
  subjects: [{ work_id: filmA.id, role: "primary", position: 0 }],
}, A, { idemKey: "anime-film-rel-knn-bd-special" });

const medBdA = await mk("medBdA", "medium", "本編ディスク（Blu-ray）", {
  release_id: relBdA.id, position: 1,
  original_language: "ja", types: ["medium"],
  translations: tr4("本編ディスク", "正片碟", "正片碟", "Main feature disc"),
  attributes: { format: "bd", role: "primary" },
}, A, { idemKey: "anime-film-med-knn-bd-main", scope: { release_id: relBdA.id } });

const trkBdMainA = await mk("trkBdMainA", "track", "本編", {
  medium_id: medBdA.id, position: 1, number: "1",
  original_language: "ja", types: ["track"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { duration: 6389, role: "primary" },
  contents: [{ expression_id: exprMainA.id, position: 1, locator: null }],
}, A, { idemKey: "anime-film-trk-knn-bd-main", scope: { medium_id: medBdA.id } });

const trkBdPromoA = await mk("trkBdPromoA", "track", "予告編・プロモーション映像集", {
  medium_id: medBdA.id, position: 2, number: "2",
  original_language: "ja", types: ["track"],
  translations: tr4("予告編・プロモーション映像集", "预告 / 宣传影像集", "預告 / 宣傳影像集", "Trailers and promotional videos"),
  attributes: { role: "supplement" },
  contents: [{ expression_id: exprPromoA.id, position: 1, locator: null }],
}, A, { idemKey: "anime-film-trk-knn-bd-promo", scope: { medium_id: medBdA.id } });

const trkBdEnA = await mk("trkBdEnA", "track", "英語主題歌版本編", {
  medium_id: medBdA.id, position: 3, number: "3",
  original_language: "en", types: ["track"],
  translations: tr4("英語主題歌版本編", "英语主题歌版正片", "英語主題歌版正片", "English theme song version"),
  attributes: { duration: 6389, role: "supplement" },
  contents: [{ expression_id: exprEnEdA.id, position: 1, locator: null }],
}, A, { idemKey: "anime-film-trk-knn-bd-enedition", scope: { medium_id: medBdA.id } });
TRACK_REL.push({ release: "relBdA", tracks: ["trkBdMainA", "trkBdPromoA", "trkBdEnA"] });

const relDvdA = await mk("relDvdA", "release", "「君の名は。」DVD スタンダード・エディション", {
  original_language: "ja", types: ["release"],
  translations: tr4("「君の名は。」DVD スタンダード・エディション", "《你的名字。》DVD 标准版", "《你的名字。》DVD 標準版", "Your Name. DVD Standard Edition"),
  attributes: {
    catalog_number: "TDV27263D", edition_date: "2017-07-26", edition_type: "standard",
    country: "JP", publisher: E.toho.id, distribution_channel: "physical",
  },
  subjects: [{ work_id: filmA.id, role: "primary", position: 0 }],
}, A, { idemKey: "anime-film-rel-knn-dvd-standard" });

const medDvdA = await mk("medDvdA", "medium", "本編ディスク（DVD）", {
  release_id: relDvdA.id, position: 1,
  original_language: "ja", types: ["medium"],
  translations: tr4("本編ディスク", "正片碟", "正片碟", "Main feature disc"),
  attributes: { format: "dvd", role: "primary" },
}, A, { idemKey: "anime-film-med-knn-dvd-main", scope: { release_id: relDvdA.id } });

const trkDvdMainA = await mk("trkDvdMainA", "track", "本編", {
  medium_id: medDvdA.id, position: 1, number: "1",
  original_language: "ja", types: ["track"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { duration: 6389, role: "primary" },
  contents: [{ expression_id: exprMainA.id, position: 1, locator: null }],
}, A, { idemKey: "anime-film-trk-knn-dvd-main", scope: { medium_id: medDvdA.id } });
TRACK_REL.push({ release: "relDvdA", tracks: ["trkDvdMainA"] });

// --- OST 专辑（RADWIMPS「君の名は。」UPCH-20423）：只有 4 首主題歌中有据可查的两首单独建 Work ---
const ostaNote = { note: "编目：《君の名は。》OST 专辑及其中 2 首主題歌；曲目号与曲名取自 UNIVERSAL MUSIC JAPAN 商品页（通常盤 UPCH-20423）的 CD 収録内容表。", sources: [SRC.knnOst, SRC.knnBgm] };
// 注意：OST 专辑与电影 Work 同名（官方题名都是「君の名は。」）。lib 的复用判定只按 kind+题名，
// 会把刚建好的电影 Work 当成同名条目复用掉，所以这里先按 types 精确查一次服务端；
// 命中专辑就复用，否则带 types 作用域创建（Index.find 支持 types，服务端 q= 不支持按 types 过滤）。
const albAHit = (await client.search("work", "君の名は。")).find((x) => (x.types || []).includes("album"));
const albASpec = {
  original_language: "ja", types: ["album"],
  translations: tr4("君の名は。", "你的名字。", "你的名字。", "君の名は。"),
  attributes: { language: "ja", tags: ["サウンドトラック", "劇場アニメ主題歌"] },
  external_ids: { bangumi: "187695" },
  pictures: pic("https://lain.bgm.tv/pic/cover/l/8e/98/187695_jp.jpg", "Bangumi 条目 187695（OST 通常盤）封面", bgmSub(187695), "OST《君の名は。》封面（Bangumi 条目 187695）"),
};
const albA = albAHit
  ? await (async () => { camp.reused.entity++; camp.log({ op: "entity", status: "reuse-server", kind: "work", title: "君の名は。", id: albAHit.id, code: "types=album" }); E.albA = albAHit; return albAHit; })()
  : await mk("albA", "work", "君の名は。", albASpec, ostaNote, { idemKey: "anime-film-work-knn-ost", scope: { types: "album" }, allowServerLookup: false });

const songPre = await mk("songPre", "work", "前前前世", {
  original_language: "ja", types: ["song"],
  translations: trAll("前前前世"),
  attributes: { language: "ja", tags: ["劇場アニメ主題歌"] },
}, ostaNote, { idemKey: "anime-film-work-song-zenzenzense", scope: { types: "song" } });

const songSpar = await mk("songSpar", "work", "スパークル", {
  original_language: "ja", types: ["song"],
  translations: trAll("スパークル"),
  attributes: { language: "ja", tags: ["劇場アニメ主題歌"] },
}, ostaNote, { idemKey: "anime-film-work-song-sparkle", scope: { types: "song" } });

const exprPre = await mk("exprPre", "expression", "前前前世 (movie ver.)", {
  work_id: songPre.id, position: 1,
  original_language: "ja", types: ["expression"],
  translations: trAll("前前前世 (movie ver.)"),
  attributes: { language: "ja", version_label: "movie ver." },
}, ostaNote, { idemKey: "anime-film-expr-zenzenzense-movie", scope: { work_id: songPre.id } });

const exprSpar = await mk("exprSpar", "expression", "スパークル (movie ver.)", {
  work_id: songSpar.id, position: 2,
  original_language: "ja", types: ["expression"],
  translations: trAll("スパークル (movie ver.)"),
  attributes: { language: "ja", version_label: "movie ver." },
}, ostaNote, { idemKey: "anime-film-expr-sparkle-movie", scope: { work_id: songSpar.id } });

const relOstA = await mk("relOstA", "release", "君の名は。 [通常盤]", {
  original_language: "ja", types: ["release"],
  translations: tr4("君の名は。 [通常盤]", "你的名字。 [通常盘]", "你的名字。 [通常盤]", "君の名は。 [Regular Edition]"),
  attributes: {
    catalog_number: "UPCH-20423", edition_date: "2016-08-24", edition_type: "standard",
    country: "JP", publisher: E.universal.id, distribution_channel: "physical",
  },
  subjects: [
    { work_id: albA.id, role: "primary", position: 0 },
    { work_id: songPre.id, role: "compilation", position: 1 },
    { work_id: songSpar.id, role: "compilation", position: 2 },
  ],
}, ostaNote, { idemKey: "anime-film-rel-knn-ost-regular" });

const medCdA = await mk("medCdA", "medium", "CD", {
  release_id: relOstA.id, position: 1,
  original_language: "ja", types: ["medium"],
  translations: tr4("CD", "CD", "CD", "CD"),
  attributes: { format: "cd", role: "primary" },
}, ostaNote, { idemKey: "anime-film-med-knn-ost-cd", scope: { release_id: relOstA.id } });

const trkPre = await mk("trkPre", "track", "前前前世 (movie ver.)", {
  medium_id: medCdA.id, position: 1, number: "8",
  original_language: "ja", types: ["track"],
  translations: trAll("前前前世 (movie ver.)"),
  attributes: { role: "primary" },
  contents: [{ expression_id: exprPre.id, position: 1, locator: null }],
}, ostaNote, { idemKey: "anime-film-trk-zenzenzense", scope: { medium_id: medCdA.id } });

const trkSpar = await mk("trkSpar", "track", "スパークル (movie ver.)", {
  medium_id: medCdA.id, position: 2, number: "24",
  original_language: "ja", types: ["track"],
  translations: trAll("スパークル (movie ver.)"),
  attributes: { role: "primary" },
  contents: [{ expression_id: exprSpar.id, position: 1, locator: null }],
}, ostaNote, { idemKey: "anime-film-trk-sparkle", scope: { medium_id: medCdA.id } });
TRACK_REL.push({ release: "relOstA", tracks: ["trkPre", "trkSpar"] });

// =====================================================================
// B. 劇場版「鬼滅の刃」無限列車編（2020）
// =====================================================================
const B = { note: "编目：剧场版《鬼滅の刃 無限列車編》的创作母体/篇目/表达/Blu-ray，及电视动画母体与ノベライズ（改编）关系；取自 ja 维基百科「劇場版「鬼滅の刃」無限列車編」「鬼滅の刃 (アニメ)」与 openBD。", sources: [SRC.kmWiki, SRC.kmTvWiki, SRC.kmZhWiki, SRC.kmBgm] };

await mk("sotozaki", "agent", "外崎春雄", {
  original_language: "ja", types: ["person"], translations: trJa("外崎春雄"),
}, { note: "编目：外崎春雄，《劇場版「鬼滅の刃」無限列車編》監督（ja 维基百科 スタッフ）。", sources: [SRC.kmWiki] }, { idemKey: "anime-film-agent-sotozaki" });

await mk("ufotable", "agent", "ufotable", {
  original_language: "ja", types: ["organization"], translations: trJa("ufotable"),
}, { note: "编目：ufotable，《劇場版「鬼滅の刃」無限列車編》脚本制作・アニメーション制作（ja 维基百科 スタッフ）。", sources: [SRC.kmWiki] }, { idemKey: "anime-film-agent-ufotable" });

await mk("aniplex", "agent", "アニプレックス", {
  original_language: "ja", types: ["organization"], translations: trJa("アニプレックス"),
}, { note: "编目：アニプレックス，《劇場版「鬼滅の刃」無限列車編》Blu-ray/DVD 发售元与製作出品（ja 维基百科 関連商品/スタッフ）。", sources: [SRC.kmWiki] }, { idemKey: "anime-film-agent-aniplex" });

await mk("shueisha", "agent", "集英社", {
  original_language: "ja", types: ["organization"], translations: trJa("集英社"),
}, { note: "编目：集英社，ノベライズ（JUMP j BOOKS）出版社（openBD ISBN 978-4-08-703503-2）。", sources: [SRC.kmOpenBd] }, { idemKey: "anime-film-agent-shueisha" });

await mk("hanae", "agent", "花江夏樹", {
  original_language: "ja", types: ["person"], translations: trJa("花江夏樹"),
}, { note: "编目：花江夏樹，《劇場版「鬼滅の刃」無限列車編》竈門炭治郎 声（ja 维基百科 声の出演）。", sources: [SRC.kmWiki] }, { idemKey: "anime-film-agent-hanae" });

await mk("tanjiro", "agent", "竈門炭治郎", {
  original_language: "ja", types: ["character"], translations: trJa("竈門炭治郎"),
}, { note: "编目：竈門炭治郎，剧场版《無限列車編》主人公（ja 维基百科 声の出演 表）。", sources: [SRC.kmWiki] }, { idemKey: "anime-film-agent-tanjiro" });

await mk("gotouge", "agent", "吾峠呼世晴", {
  original_language: "ja", types: ["person"], translations: trJa("吾峠呼世晴"),
}, { note: "编目：吾峠呼世晴，《鬼滅の刃》原作者，也是ノベライズ 的著者之一（openBD ISBN 978-4-08-703503-2）。", sources: [SRC.kmWiki, SRC.kmOpenBd] }, { idemKey: "anime-film-agent-gotouge" });

await mk("yajima", "agent", "矢島綾", {
  original_language: "ja", types: ["person"], translations: trJa("矢島綾"),
}, { note: "编目：矢島綾，ノベライズ 执笔者（openBD ISBN 978-4-08-703503-2 著者字段）。", sources: [SRC.kmOpenBd] }, { idemKey: "anime-film-agent-yajima" });

const tvB = await mk("tvB", "work", "鬼滅の刃", {
  original_language: "ja", types: ["animation"],
  translations: tr4("鬼滅の刃", "鬼灭之刃", "鬼滅之刃", "鬼滅の刃"),
  attributes: { episodes: 26, broadcast_start: "2019-04-06", language: "ja", tags: ["TVアニメ"] },
  external_ids: { bangumi: "245665", wikipedia: zhWiki("鬼滅之刃") },
}, { note: "编目：电视动画《鬼滅の刃》（竈門炭治郎 立志編，2019-04-06 起，全 26 话）；剧场版被记为它的続編（ja 维基百科「鬼滅の刃 (アニメ)」劇場アニメ 段）。", sources: [SRC.kmTvWiki] }, { idemKey: "anime-film-work-kimetsu-tv", scope: { types: "animation" } });

const filmB = await mk("filmB", "work", "劇場版「鬼滅の刃」無限列車編", {
  original_language: "ja", types: ["film"],
  translations: tr4("劇場版「鬼滅の刃」無限列車編", "剧场版 鬼灭之刃 无限列车篇", "鬼滅之刃劇場版 無限列車篇", "劇場版「鬼滅の刃」無限列車編"),
  attributes: { duration: 7020, language: "ja", tags: ["アニメーション映画", "劇場版"] },
  external_ids: { bangumi: "291494", wikipedia: zhWiki("鬼滅之刃劇場版 無限列車篇") },
  pictures: pic("https://lain.bgm.tv/pic/cover/l/3c/64/291494_2kB2n.jpg", "Bangumi 条目 291494 封面（劇場版「鬼滅の刃」無限列車編）", bgmSub(291494), "《劇場版「鬼滅の刃」無限列車編》封面（Bangumi 条目 291494）"),
}, B, { idemKey: "anime-film-work-kimetsu-movie", scope: { types: "film" } });

const cuMainB = await mk("cuMainB", "content_unit", "本編", {
  work_id: filmB.id, position: 1, number: "",
  original_language: "ja", types: ["content_unit"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { language: "ja", entry_role: "main" },
}, B, { idemKey: "anime-film-cu-kimetsu-main", scope: { work_id: filmB.id } });

const exprMainB = await mk("exprMainB", "expression", "本編", {
  work_id: filmB.id, content_unit_id: cuMainB.id, position: 1,
  original_language: "ja", types: ["expression"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { language: "ja", duration: 7020, version_label: "劇場公開版（117 分）" },
}, B, { idemKey: "anime-film-expr-kimetsu-main", scope: { work_id: filmB.id } });

const relBdB = await mk("relBdB", "release", "劇場版「鬼滅の刃」無限列車編 Blu-ray 完全生産限定版", {
  original_language: "ja", types: ["release"],
  translations: tr4("劇場版「鬼滅の刃」無限列車編 Blu-ray 完全生産限定版", "剧场版 鬼灭之刃 无限列车篇 Blu-ray 完全生产限定版", "鬼滅之刃劇場版 無限列車篇 Blu-ray 完全生產限定版", "劇場版「鬼滅の刃」無限列車編 Blu-ray 完全生産限定版"),
  attributes: {
    edition_date: "2021-06-16", edition_type: "limited",
    country: "JP", publisher: E.aniplex.id, distribution_channel: "physical",
  },
  subjects: [{ work_id: filmB.id, role: "primary", position: 0 }],
}, B, { idemKey: "anime-film-rel-kimetsu-bd-limited" });

const medBdB = await mk("medBdB", "medium", "本編ディスク（Blu-ray）", {
  release_id: relBdB.id, position: 1,
  original_language: "ja", types: ["medium"],
  translations: tr4("本編ディスク", "正片碟", "正片碟", "Main feature disc"),
  attributes: { format: "bd", role: "primary" },
}, B, { idemKey: "anime-film-med-kimetsu-bd-main", scope: { release_id: relBdB.id } });

const trkBdB = await mk("trkBdB", "track", "本編", {
  medium_id: medBdB.id, position: 1, number: "1",
  original_language: "ja", types: ["track"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { duration: 7020, role: "primary" },
  contents: [{ expression_id: exprMainB.id, position: 1, locator: null }],
}, B, { idemKey: "anime-film-trk-kimetsu-bd-main", scope: { medium_id: medBdB.id } });
TRACK_REL.push({ release: "relBdB", tracks: ["trkBdB"] });

// --- ノベライズ（改编） ---
const novelNote = { note: "编目：剧场版《無限列車編》的ノベライズ（小说化改编），字段取自 openBD（ISBN 978-4-08-703503-2）与 ja 维基百科 関連商品 書籍 表。", sources: [SRC.kmOpenBd, SRC.kmWiki] };
const novelB = await mk("novelB", "work", "劇場版鬼滅の刃無限列車編 ノベライズ", {
  original_language: "ja", types: ["novel"],
  translations: tr4("劇場版鬼滅の刃無限列車編 ノベライズ", "剧场版 鬼灭之刃 无限列车篇 小说版", "劇場版 鬼滅之刃 無限列車篇 小說版", "劇場版鬼滅の刃無限列車編 ノベライズ"),
  attributes: { language: "ja", tags: ["ノベライズ", "ジュブナイル"] },
}, novelNote, { idemKey: "anime-film-work-kimetsu-novelize", scope: { types: "novel" } });

const exprNovelB = await mk("exprNovelB", "expression", "日本語版", {
  work_id: novelB.id, position: 1,
  original_language: "ja", types: ["expression"],
  translations: tr4("日本語版", "日文版", "日文版", "Japanese edition"),
  attributes: { language: "ja" },
}, novelNote, { idemKey: "anime-film-expr-kimetsu-novelize-jp", scope: { work_id: novelB.id } });

const relNovelB = await mk("relNovelB", "release", "劇場版鬼滅の刃無限列車編 ノベライズ", {
  original_language: "ja", types: ["release"],
  translations: tr4("劇場版鬼滅の刃無限列車編 ノベライズ", "剧场版 鬼灭之刃 无限列车篇 小说版", "劇場版 鬼滅之刃 無限列車篇 小說版", "劇場版鬼滅の刃無限列車編 ノベライズ"),
  attributes: {
    isbn: "9784087035032", edition_date: "2020-10-16", edition_type: "standard",
    country: "JP", publisher: E.shueisha.id, distribution_channel: "physical",
  },
  subjects: [{ work_id: novelB.id, role: "primary", position: 0 }],
}, novelNote, { idemKey: "anime-film-rel-kimetsu-novelize" });

const medPaperB = await mk("medPaperB", "medium", "本冊", {
  release_id: relNovelB.id, position: 1,
  original_language: "ja", types: ["medium"],
  translations: tr4("本冊", "书籍本体", "書籍本體", "Book"),
  attributes: { format: "paper", role: "primary" },
}, novelNote, { idemKey: "anime-film-med-kimetsu-novelize-paper", scope: { release_id: relNovelB.id } });

const trkNovelB = await mk("trkNovelB", "track", "本文", {
  medium_id: medPaperB.id, position: 1, number: "",
  original_language: "ja", types: ["track"],
  translations: tr4("本文", "正文", "正文", "Body text"),
  attributes: { role: "primary" },
  contents: [{ expression_id: exprNovelB.id, position: 1, locator: null }],
}, novelNote, { idemKey: "anime-film-trk-kimetsu-novelize-body", scope: { medium_id: medPaperB.id } });
TRACK_REL.push({ release: "relNovelB", tracks: ["trkNovelB"] });

// =====================================================================
// C. 劇場版 少女☆歌劇 レヴュースタァライト（2021）
// =====================================================================
const C = { note: "编目：剧场版《少女☆歌劇 レヴュースタァライト》的创作母体/篇目/表达/Blu-ray，及电视动画母体（续作关系）；取自 ja 维基百科两条目（関連商品 表给出品番 OVXN-0058）与 Bangumi 294135。", sources: [SRC.rsWiki, SRC.rsTvWiki, SRC.rsBgm] };

await mk("furukawa", "agent", "古川知宏", {
  original_language: "ja", types: ["person"], translations: trJa("古川知宏"),
}, { note: "编目：古川知宏，《劇場版 少女☆歌劇 レヴュースタァライト》監督（ja 维基百科 スタッフ）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-furukawa" });

await mk("higuchi", "agent", "樋口達人", {
  original_language: "ja", types: ["person"], translations: trJa("樋口達人"),
}, { note: "编目：樋口達人，剧场版脚本（ja 维基百科 スタッフ）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-higuchi" });

await mk("fujisawa", "agent", "藤澤慶昌", {
  original_language: "ja", types: ["person"], translations: trJa("藤澤慶昌"),
}, { note: "编目：藤澤慶昌，剧场版音楽（与加藤達也共同，ja 维基百科 スタッフ）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-fujisawa" });

await mk("kinema", "agent", "キネマシトラス", {
  original_language: "ja", types: ["organization"], translations: trJa("キネマシトラス"),
}, { note: "编目：キネマシトラス，剧场版アニメーション制作兼原作方之一（ja 维基百科 スタッフ/原作）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-kinema" });

await mk("bushiroad", "agent", "ブシロード", {
  original_language: "ja", types: ["organization"], translations: trJa("ブシロード"),
}, { note: "编目：ブシロード，原作方之一兼配給（ja 维基百科 原作/配給）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-bushiroad" });

await mk("overlap", "agent", "オーバーラップ", {
  original_language: "ja", types: ["organization"], translations: trJa("オーバーラップ"),
}, { note: "编目：オーバーラップ，剧场版 Blu-ray 发售元（ja 维基百科 関連商品 Blu-ray 表：2021-12-22・OVXN-0058）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-overlap" });

await mk("koyama", "agent", "小山百代", {
  original_language: "ja", types: ["person"], translations: trJa("小山百代"),
}, { note: "编目：小山百代，愛城華恋 役（ja 维基百科 登場人物 表）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-koyama" });

await mk("karen", "agent", "愛城華恋", {
  original_language: "ja", types: ["character"], translations: trJa("愛城華恋"),
}, { note: "编目：愛城華恋，剧场版主人公（ja 维基百科 登場人物 表）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-karen" });

await mk("mimori", "agent", "三森すずこ", {
  original_language: "ja", types: ["person"], translations: trJa("三森すずこ"),
}, { note: "编目：三森すずこ，神楽ひかり 役（ja 维基百科 登場人物 表）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-mimori" });

await mk("hikari", "agent", "神楽ひかり", {
  original_language: "ja", types: ["character"], translations: trJa("神楽ひかり"),
}, { note: "编目：神楽ひかり，剧场版主要角色（ja 维基百科 登場人物 表）。", sources: [SRC.rsWiki] }, { idemKey: "anime-film-agent-hikari" });

const tvC = await mk("tvC", "work", "少女☆歌劇 レヴュースタァライト", {
  original_language: "ja", types: ["animation"],
  translations: tr4("少女☆歌劇 レヴュースタァライト", "少女☆歌剧 Revue Starlight", "少女☆歌劇 Revue Starlight", "少女☆歌劇 レヴュースタァライト"),
  attributes: { episodes: 12, broadcast_start: "2018-07-12", language: "ja", tags: ["TVアニメ"] },
  external_ids: { bangumi: "214265" },
}, { note: "编目：2018 年 TV 动画《少女☆歌劇 レヴュースタァライト》母体（剧场版为其续作，同为古川知宏监督/キネマシトラス制作）。", sources: [SRC.rsTvWiki, SRC.rsBgm] }, { idemKey: "anime-film-work-revue-tv", scope: { types: "animation" } });

const filmC = await mk("filmC", "work", "劇場版 少女☆歌劇 レヴュースタァライト", {
  original_language: "ja", types: ["film"],
  translations: tr4("劇場版 少女☆歌劇 レヴュースタァライト", "剧场版 少女☆歌剧 Revue Starlight", "劇場版 少女☆歌劇 Revue Starlight", "劇場版 少女☆歌劇 レヴュースタァライト"),
  attributes: { duration: 7200, language: "ja", tags: ["アニメーション映画", "劇場版"] },
  external_ids: { bangumi: "294135" },
  pictures: pic("https://lain.bgm.tv/pic/cover/l/1e/41/294135_cvCcW.jpg", "Bangumi 条目 294135 封面（劇場版 少女☆歌劇 レヴュースタァライト）", bgmSub(294135), "《劇場版 少女☆歌劇 レヴュースタァライト》封面（Bangumi 条目 294135）"),
}, C, { idemKey: "anime-film-work-revue-movie", scope: { types: "film" } });

const cuMainC = await mk("cuMainC", "content_unit", "本編", {
  work_id: filmC.id, position: 1, number: "",
  original_language: "ja", types: ["content_unit"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { language: "ja", entry_role: "main" },
}, C, { idemKey: "anime-film-cu-revue-main", scope: { work_id: filmC.id } });

const exprMainC = await mk("exprMainC", "expression", "本編", {
  work_id: filmC.id, content_unit_id: cuMainC.id, position: 1,
  original_language: "ja", types: ["expression"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { language: "ja", duration: 7200, version_label: "劇場公開版（120 分）" },
}, C, { idemKey: "anime-film-expr-revue-main", scope: { work_id: filmC.id } });

const relBdC = await mk("relBdC", "release", "劇場版 少女☆歌劇 レヴュースタァライト Blu-ray", {
  original_language: "ja", types: ["release"],
  translations: tr4("劇場版 少女☆歌劇 レヴュースタァライト Blu-ray", "剧场版 少女☆歌剧 Revue Starlight Blu-ray", "劇場版 少女☆歌劇 Revue Starlight Blu-ray", "劇場版 少女☆歌劇 レヴュースタァライト Blu-ray"),
  attributes: {
    catalog_number: "OVXN-0058", edition_date: "2021-12-22", edition_type: "standard",
    country: "JP", publisher: E.overlap.id, distribution_channel: "physical",
  },
  subjects: [{ work_id: filmC.id, role: "primary", position: 0 }],
}, C, { idemKey: "anime-film-rel-revue-bd" });

const medBdC = await mk("medBdC", "medium", "本編ディスク（Blu-ray）", {
  release_id: relBdC.id, position: 1,
  original_language: "ja", types: ["medium"],
  translations: tr4("本編ディスク", "正片碟", "正片碟", "Main feature disc"),
  attributes: { format: "bd", role: "primary" },
}, C, { idemKey: "anime-film-med-revue-bd-main", scope: { release_id: relBdC.id } });

const trkBdC = await mk("trkBdC", "track", "本編", {
  medium_id: medBdC.id, position: 1, number: "1",
  original_language: "ja", types: ["track"],
  translations: tr4("本編", "正片", "正片", "Main feature"),
  attributes: { duration: 7200, role: "primary" },
  contents: [{ expression_id: exprMainC.id, position: 1, locator: null }],
}, C, { idemKey: "anime-film-trk-revue-bd-main", scope: { medium_id: medBdC.id } });
TRACK_REL.push({ release: "relBdC", tracks: ["trkBdC"] });

// 守卫：同名跨 kind 的工作母体必须各自独立（Index.find 不带 types 作用域时会把电影 Work 与
// 同名 OST 专辑判成同一条，进而在错误的父级下建篇目、把关系挂错端；本次重跑实测踩到过）。
const typeOf = (name) => { const e = E[name]; return Array.isArray(e.types) ? e.types.join("|") : String(e.types || ""); };
for (const [name, want] of [["filmA", "film"], ["albA", "album"], ["filmB", "film"], ["tvB", "animation"], ["novelB", "novel"], ["filmC", "film"], ["tvC", "animation"]]) {
  if (!typeOf(name).split("|").includes(want)) throw new Error("工作母体类型不符：" + name + " 期望 " + want + " 实际 " + typeOf(name));
}
{
  const names = ["filmA", "albA", "filmB", "tvB", "novelB", "filmC", "tvC"];
  const ids = names.map((n) => E[n].id);
  if (new Set(ids).size !== ids.length) throw new Error("工作母体 id 重复（同名跨 kind 被误复用）：" + names.map((n, i) => n + "=" + ids[i]).join(", "));
}

// =====================================================================
// 关系
// =====================================================================
const REL = [
  // A 君の名は。
  ["directed_by", "filmA", "shinkai", { credit_role: "監督" }, A],
  ["written_by", "filmA", "shinkai", { credit_role: "脚本・原作" }, A],
  ["created_by", "filmA", "cwfilms", { credit_role: "アニメーション制作" }, A],
  ["soundtrack_of", "albA", "filmA", { role: "primary" }, { note: "编目：OST 专辑《君の名は。》是剧场版《君の名は。》的原创原声带（UNIVERSAL MUSIC 商品页与 ja 维基百科 音楽）。", sources: [SRC.knnOst, SRC.knnWiki] }],
  ["composed_by", "albA", "radwimps", { credit_role: "音楽" }, A],
  ["performed_by", "albA", "radwimps", { credit_role: "演奏" }, A],
  ["composed_by", "songPre", "noda", { credit_role: "作曲" }, { note: "编目：《前前前世》作词・作曲 野田洋次郎（Bangumi 条目 187695 资料）。", sources: [src(bgmSub(187695), "Bangumi 条目 187695《君の名は。》OST：作词 野田洋次郎、作曲 野田洋次郎/桑原彰/武田祐介")] }],
  ["lyricist_of", "songPre", "noda", { credit_role: "作詞" }, { note: "编目：《前前前世》作词 野田洋次郎（Bangumi 条目 187695 资料）。", sources: [src(bgmSub(187695), "Bangumi 条目 187695《君の名は。》OST：作词 野田洋次郎")] }],
  ["character_in", "taki", "filmA", { character_rank: "main" }, A],
  ["character_in", "mitsuha", "filmA", { character_rank: "main" }, A],
  ["voiced_by", "filmA", "kamiki", { character: "taki", language: "ja" }, A],
  ["voiced_by", "filmA", "kamishiraishi", { character: "mitsuha", language: "ja" }, A],
  ["alternate_take_of", "exprEnEdA", "exprMainA", { role: "extra" }, { note: "编目：BD 本編ディスク 另收「英語主題歌版本編」，与日语主题歌版本編是同一本編的不同表达（ja 维基百科 映像特典内容 表）。", sources: [SRC.knnWiki] }],
  // B 鬼滅
  ["sequel_of", "filmB", "tvB", {}, { note: "编目：剧场版《無限列車編》是电视动画第 1 期《竈門炭治郎 立志編》的続編（ja 维基百科「鬼滅の刃 (アニメ)」劇場版 段）。", sources: [SRC.kmTvWiki] }],
  ["directed_by", "filmB", "sotozaki", { credit_role: "監督" }, B],
  ["created_by", "filmB", "ufotable", { credit_role: "アニメーション制作" }, B],
  ["adaptation_of", "novelB", "filmB", {}, { note: "编目：ノベライズ（小说化）以剧场版《無限列車編》为改编来源（openBD 书目 + ja 维基百科 関連商品 書籍 表）。", sources: [SRC.kmOpenBd, SRC.kmWiki] }],
  ["written_by", "novelB", "yajima", { credit_role: "著" }, novelNote],
  ["character_in", "tanjiro", "filmB", { character_rank: "main" }, B],
  ["voiced_by", "filmB", "hanae", { character: "tanjiro", language: "ja" }, B],
  // C 少女☆歌劇
  ["sequel_of", "filmC", "tvC", {}, { note: "编目：剧场版是 2018 年 TV 动画《少女☆歌劇 レヴュースタァライト》的续作（同为古川知宏监督、キネマシトラス 制作，ja 维基百科 两条目 スタッフ/公開）。", sources: [SRC.rsWiki, SRC.rsTvWiki] }],
  ["directed_by", "filmC", "furukawa", { credit_role: "監督" }, C],
  ["written_by", "filmC", "higuchi", { credit_role: "脚本" }, C],
  ["composed_by", "filmC", "fujisawa", { credit_role: "音楽" }, C],
  ["created_by", "filmC", "kinema", { credit_role: "アニメーション制作" }, C],
  ["created_by", "filmC", "bushiroad", { credit_role: "原作" }, C],
  ["character_in", "karen", "filmC", { character_rank: "main" }, C],
  ["character_in", "hikari", "filmC", { character_rank: "main" }, C],
  ["voiced_by", "filmC", "koyama", { character: "karen", language: "ja" }, C],
  ["voiced_by", "filmC", "mimori", { character: "hikari", language: "ja" }, C],
];

const createdRels = [];
for (const [type, srcName, tgtName, attributes, ev] of REL) {
  const s = E[srcName], t = E[tgtName];
  if (!s || !t) throw new Error("关系端点缺失：" + type + " " + srcName + " -> " + tgtName);
  // character 属性必须是 agent 实体 id
  const attrs = { ...attributes };
  if (attrs.character) {
    const ch = E[attrs.character];
    if (!ch) throw new Error("character 属性引用的实体不存在：" + attrs.character);
    attrs.character = ch.id;
  }
  const rel = await camp.createRelation(type, s.id, t.id, ev, { attributes: attrs, idemKey: "anime-film-rel-" + type + "-" + srcName + "-" + tgtName });
  createdRels.push({ type, source: srcName, target: tgtName, attributes: attrs, id: rel.id });
}

// =====================================================================
// 写后回读断言
// =====================================================================
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

if (DRY_RUN) {
  camp.summary({ assertions: "dry-run：跳过回读断言" });
} else {
  // 1) 结构归属
  const structExpect = [
    ["filmA", "work", {}], ["filmB", "work", {}], ["filmC", "work", {}],
    ["cuMainA", "content_unit", { work_id: E.filmA.id }],
    ["cuMainB", "content_unit", { work_id: E.filmB.id }],
    ["cuMainC", "content_unit", { work_id: E.filmC.id }],
    ["cuPromoA", "content_unit", { work_id: E.filmA.id }],
    ["exprMainA", "expression", { work_id: E.filmA.id, content_unit_id: E.cuMainA.id }],
    ["exprMainB", "expression", { work_id: E.filmB.id, content_unit_id: E.cuMainB.id }],
    ["exprMainC", "expression", { work_id: E.filmC.id, content_unit_id: E.cuMainC.id }],
    ["exprPromoA", "expression", { work_id: E.filmA.id, content_unit_id: E.cuPromoA.id }],
    ["exprEnEdA", "expression", { work_id: E.filmA.id, content_unit_id: E.cuMainA.id }],
    ["exprPre", "expression", { work_id: E.songPre.id }],
    ["exprSpar", "expression", { work_id: E.songSpar.id }],
    ["exprNovelB", "expression", { work_id: E.novelB.id }],
    ["medBdA", "medium", { release_id: E.relBdA.id }],
    ["medDvdA", "medium", { release_id: E.relDvdA.id }],
    ["medCdA", "medium", { release_id: E.relOstA.id }],
    ["medBdB", "medium", { release_id: E.relBdB.id }],
    ["medPaperB", "medium", { release_id: E.relNovelB.id }],
    ["medBdC", "medium", { release_id: E.relBdC.id }],
    ["trkBdMainA", "track", { medium_id: E.medBdA.id }],
    ["trkBdPromoA", "track", { medium_id: E.medBdA.id }],
    ["trkBdEnA", "track", { medium_id: E.medBdA.id }],
    ["trkDvdMainA", "track", { medium_id: E.medDvdA.id }],
    ["trkPre", "track", { medium_id: E.medCdA.id }],
    ["trkSpar", "track", { medium_id: E.medCdA.id }],
    ["trkBdB", "track", { medium_id: E.medBdB.id }],
    ["trkNovelB", "track", { medium_id: E.medPaperB.id }],
    ["trkBdC", "track", { medium_id: E.medBdC.id }],
  ];
  check(E.filmA.id !== E.albA.id, "电影 Work 与同名 OST 专辑 Work 落成了同一条实体");
  {
    const fa = await camp.getEntity(E.filmA.id);
    check((fa.types || []).includes("film"), "filmA types 不含 film：" + JSON.stringify(fa.types));
    const ab = await camp.getEntity(E.albA.id);
    check((ab.types || []).includes("album"), "albA types 不含 album：" + JSON.stringify(ab.types));
  }
  let versioned = 0;
  for (const [name, kind, expect] of structExpect) {
    const e = E[name];
    if (!e || !e.id) { check(false, "实体缺失：" + name); continue; }
    const cur = await camp.getEntity(e.id);
    check(cur.kind === kind, name + " kind 期望 " + kind + " 实际 " + cur.kind);
    for (const [k, v] of Object.entries(expect)) check(cur[k] === v, name + " 归属 " + k + " 期望 " + v + " 实际 " + cur[k]);
    check(Number(cur.version) >= 1, name + " version 异常：" + cur.version);
    if (Number(cur.version) >= 1) versioned++;
    if (kind === "expression") check(cur.parent_id === undefined || cur.parent_id === null || cur.parent_id === "", name + " expression 不应有 parent_id");
  }
  check(versioned === structExpect.length, "回读 version 计数不符：" + versioned + "/" + structExpect.length);

  // 2) 每个 Release 的 subjects 覆盖其 Track contents 引用的全部 Expression 所属 Work
  for (const { release, tracks } of TRACK_REL) {
    const rel = await camp.getEntity(E[release].id);
    const declared = new Set((rel.subjects || []).map((s) => s.work_id));
    const need = new Set();
    for (const tn of tracks) {
      const t = await camp.getEntity(E[tn].id);
      for (const c of t.contents || []) {
        const w = EXPR_WORK[c.expression_id];
        check(!!w, tn + " contents 引用的 expression 不在本次创建集合：" + c.expression_id);
        if (w) need.add(w);
      }
    }
    for (const w of need) check(declared.has(w), release + " subjects 未声明收录 Work " + w);
  }

  // 3) 关系两端与落库
  for (const r of createdRels) {
    const s = E[r.source].id, t = E[r.target].id;
    const list = await camp.client.relationsOf(s);
    const hit = list.find((x) => x.type === r.type && x.source_id === s && x.target_id === t && !x.via);
    check(!!hit, "关系未落库：" + r.type + " " + r.source + " -> " + r.target);
    if (hit) {
      for (const [k, v] of Object.entries(r.attributes)) check(hit.attributes && hit.attributes[k] === v, "关系属性丢失：" + r.type + " " + k + " 期望 " + v + " 实际 " + (hit.attributes || {})[k]);
      check(hit.source_id === s && hit.target_id === t, "关系端点不符：" + r.type);
    }
    const se = await camp.getEntity(s), te = await camp.getEntity(t);
    check(se.kind && te.kind, "关系端点实体读取失败：" + r.type);
  }

  // 4) revisions（抽样：每种 kind 一条）
  const sample = ["filmA", "cuMainA", "exprMainA", "relBdA", "medBdA", "trkBdMainA", "shinkai"];
  let revOk = 0;
  for (const name of sample) {
    const id = E[name].id;
    const r = await camp.client.call("/api/catalog/entities/" + id + "/revisions");
    if (r.status === 200) {
      const items = (r.body && (r.body.items || r.body.revisions)) || [];
      check(Array.isArray(items) && items.length >= 1, "revisions 为空：" + name);
      if (Array.isArray(items) && items.length >= 1) revOk++;
    } else {
      check(false, "revisions 路由不可用 " + name + " -> HTTP " + r.status);
    }
  }
  console.log("revisions 抽样通过 " + revOk + "/" + sample.length);

  const summary = camp.summary({ assertions: { total: structExpect.length + createdRels.length, failed: problems.length } });
  if (problems.length) {
    console.error("\n!!! 写后断言失败 " + problems.length + " 条：");
    for (const p of problems.slice(0, 40)) console.error("  - " + p);
    process.exitCode = 1;
  } else {
    console.log("写后回读断言全部通过（结构归属 / subjects 覆盖 / 关系两端 / revisions）");
  }
}
