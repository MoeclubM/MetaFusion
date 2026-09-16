#!/usr/bin/env node
// 领域脚本：同人 / Vocaloid CD（活动限定发行）— slug: doujin-vocaloid
//
// 真实数据来源（全部为可核对的一手/半一手页面，取到的字段见 SRC_* 的 citation）：
//   · Melonbooks 商品页（同人音楽 品类）：作品名、サークル名、作家名、ジャンル、発行日、
//     版型・メディア、イベント、トラックリスト（曲順 + feat. 表记）
//   · Bandcamp 官方页 JSON-LD：曲名、ISO8601 时长（换算成秒）、数字版发行日、封面
//   · 官方活动页：コミックマーケット107 / 108、初音ミク「マジカルミライ 2025」
//   · 重音テト官方站：CV / 音声素材 / 官方运营サークル
//
// 本脚本只使用 lib.mjs（不自己写 HTTP 客户端）。用法：
//   node scripts/data/campaign/domains/doujin-vocaloid.mjs --dry-run
//   node scripts/data/campaign/domains/doujin-vocaloid.mjs
//
// 模型缺口（详见 docs-local/data-campaign/logs/doujin-vocaloid-report.md）：
//   · 「頒布イベント（コミケ / M3 / マジカルミライ 等）」在本实例没有可写字段：
//     release 的 edition_* / packaging / country / distribution_channel 都不表达事件，
//     event 表记只能写进 sources/edit_note 与 release.summary（翻译行）。
//   · 同人 CD 没有品番/条码，catalog_number / barcode 留空；Melonbooks 商品 ID
//     只能当来源 URL，不能当 external_ids（页面没有发行方给出的编号）。

import { Campaign, Client, Index, src } from "../lib.mjs";

const DRY = process.argv.includes("--dry-run");
const VERIFY = process.argv.includes("--verify");
const AUDIT = process.argv.includes("--audit");

// ---------------------------------------------------------------- 证据来源

const SRC_ACT12 = src(
  "https://www.melonbooks.co.jp/detail/detail.php?product_id=3378724",
  "Melonbooks 商品页 prhythmatiq act:12：题名、サークル名=prhythmatiq、作家名=Aether_Eru/UtopiaLyric/Noah/ちばけんいち、ジャンル=VOCALOID,初音ミク、発行日=2025/12/31、版型・メディア=CD、イベント=コミックマーケット107、トラックリスト Tr.01-Tr.08",
);
const SRC_ACT12_CIRCLE = src(
  "https://www.melonbooks.co.jp/circle/index.php?circle_id=62481",
  "Melonbooks 社团页 prhythmatiq：同人音乐社团、作品数",
);
const SRC_ACT12_BOOTH = src(
  "https://prhythmatiq.booth.pm/",
  "prhythmatiq 官方 BOOTH 商店：社团自营通贩",
);
const SRC_VOCALODIA = src(
  "https://www.melonbooks.co.jp/detail/detail.php?product_id=3772082",
  "Melonbooks 商品页 Vocalodia：题名、サークル名=prhythmatiq、作家名=Aether_Eru、発行日=2026/08/16、版型・メディア=CD、イベント=コミックマーケット108、トラックリスト 01-14",
);
const SRC_CM107 = src(
  "https://www.comiket.co.jp/info-a/C107/C107Info.html",
  "コミックマーケット 官方页 C107：開催日 2025年12月30日～31日・東京ビッグサイト",
);
const SRC_CM108 = src(
  "https://www.comiket.co.jp/info-a/C108/C108Info.html",
  "コミックマーケット 官方页 C108：開催日・場所（夏コミ）",
);
const SRC_MIRAI2025 = src(
  "https://magicalmirai.com/2025/",
  "初音ミク「マジカルミライ 2025」官方页：FUKUOKA 8/17-18、TOKYO 8/30-9/1、OSAKA 10/12-14",
);
const SRC_BRIGHTNESS = src(
  "https://www.melonbooks.co.jp/detail/detail.php?product_id=3218975",
  "Melonbooks 商品页 BRIGHTNESS：题名、サークル名=Wakuwaku Miwaku、作家名=Mwk/金子開発/GA、ジャンル=オリジナル,VOCALOID、発行日=2025/08/03、版型・メディア=CD、イベント=マジカルミライ2025、トラックリスト Tr.1-Tr.14",
);
const SRC_BRIGHTNESS_BC = src(
  "https://mwk094.bandcamp.com/album/brightness",
  "Bandcamp 官方页 BRIGHTNESS（JSON-LD MusicAlbum）：14 曲曲名与 ISO8601 时长、byArtist=Wakuwaku Miwaku / Mwk、封面",
);
const SRC_BRIGHTNESS_CIRCLE = src(
  "https://www.melonbooks.co.jp/circle/index.php?circle_id=25532",
  "Melonbooks 社团页 Wakuwaku Miwaku：同人音乐社团、作品数",
);
const SRC_KAMIYADORI = src(
  "https://www.melonbooks.co.jp/detail/detail.php?product_id=1929732",
  "Melonbooks 商品页 KAMIYADORI：题名、サークル名=OTIKA、作家名=OTIKA/めるのめる、ジャンル=VOCALOID,初音ミク、発行日=2023/04/29、版型・メディア=CD、イベント=THE VOC@LOiD 超 M@STER 51、トラックリスト Tr.1-Tr.5",
);
const SRC_KAMIYADORI_BC = src(
  "https://otika.bandcamp.com/album/kamiyadori",
  "Bandcamp 官方页 KAMIYADORI（JSON-LD MusicAlbum）：5 曲曲名（含 feat. Hatsune Miku 表记）与时长、封面",
);
const SRC_KAMIYADORI_BOOTH = src(
  "https://booth.pm/ja/items/5215951",
  "OTIKA Official BOOTH 商品页 KAMIYADORI (feat. 初音ミク)：官方自营通贩页",
);
const SRC_CHIDARUMA = src(
  "https://www.melonbooks.co.jp/detail/detail.php?product_id=2379596",
  "Melonbooks 商品页 チダルマ：题名、サークル名=OTIKA、作家名=OTIKA/めるのめる、ジャンル=VOCALOID,初音ミク、発行日=2024/04/27、版型・メディア=CD、イベント=THE VOC@LOiD 超 M@STER 55、トラックリスト Tr.1-Tr.13",
);
const SRC_CHIDARUMA_BC = src(
  "https://otika.bandcamp.com/album/-",
  "Bandcamp 官方页 チダルマ（JSON-LD MusicAlbum）：13 曲曲名与时长、封面（曲顺与 Melonbooks 一致）",
);
const SRC_CHIDARUMA_BOOTH = src(
  "https://booth.pm/ja/items/5682547",
  "OTIKA Official BOOTH 商品页 チダルマ/初音ミク：官方自营通贩页",
);
const SRC_MIKU = src(
  "https://ja.wikipedia.org/wiki/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF",
  "ja.wikipedia 初音ミク：クリプトン・フューチャー・メディアのバーチャルシンガーソフトウェア／ピアプロキャラクターズのキャラクター",
);
const SRC_TETO = src(
  "https://kasaneteto.jp/about/",
  "重音テト官方站「重音テトとは？」：CV 小山乃舞世、音声素材由小山乃舞世录音加工、官方运营サークル ツインドリル",
);
const SRC_DOUJIN_GENRE = src(
  "https://www.melonbooks.co.jp/soft/list.php?category_id=30",
  "Melonbooks「同人音楽」品类入口：本条记录的ジャンル=同人音楽（同人社团自主制作・即卖会展位頒布）",
);

const EV = (note, sources) => ({ note, sources });

const EV_ACT12 = EV(
  "补录同人音乐社团 prhythmatiq 的 act:12：按 Melonbooks 商品页登记作品题名、社团、发行日 2025-12-31、载体 CD、頒布イベント コミックマーケット107 与 Tr.01-Tr.08 曲顺；曲目按官方曲名建作品/篇目/表达，未取得的信息一律留空。",
  [SRC_ACT12, SRC_ACT12_CIRCLE, SRC_CM107],
);
const EV_BRIGHTNESS = EV(
  "补录 Wakuwaku Miwaku（Mwk）专辑 BRIGHTNESS：Melonbooks 商品页给出发行日 2025-08-03、载体 CD、イベント マジカルミライ2025 与 Tr.1-Tr.14 曲顺；Bandcamp 官方页 JSON-LD 给出每曲时长（换算为秒）。",
  [SRC_BRIGHTNESS, SRC_BRIGHTNESS_BC, SRC_MIRAI2025],
);
const EV_KAMIYADORI = EV(
  "补录 OTIKA 专辑 KAMIYADORI：Melonbooks 商品页给出发行日 2023-04-29、载体 CD、頒布イベント THE VOC@LOiD 超 M@STER 51 与 Tr.1-Tr.5 曲顺；Bandcamp 官方页 JSON-LD 给出曲名（含 feat. 初音ミク 表记）与时长。",
  [SRC_KAMIYADORI, SRC_KAMIYADORI_BC, SRC_KAMIYADORI_BOOTH],
);
const EV_CHIDARUMA = EV(
  "补录 OTIKA 专辑 チダルマ：Melonbooks 商品页给出发行日 2024-04-27、载体 CD、頒布イベント THE VOC@LOiD 超 M@STER 55 与 Tr.1-Tr.13 曲顺；Bandcamp 官方页 JSON-LD 给出 13 曲曲名与时长。",
  [SRC_CHIDARUMA, SRC_CHIDARUMA_BC, SRC_CHIDARUMA_BOOTH],
);
const EV_PRH_MEMBER = EV(
  "按 Melonbooks 商品页 作家名 与社团页把 prhythmatiq 登记为同人音乐社团、Aether_Eru 为署名作曲家。",
  [SRC_ACT12, SRC_ACT12_CIRCLE],
);
const EV_WKW_MEMBER = EV(
  "按 Melonbooks 商品页 作家名 与社团页把 Wakuwaku Miwaku 登记为同人音乐社团、Mwk 为署名作曲家。",
  [SRC_BRIGHTNESS, SRC_BRIGHTNESS_CIRCLE],
);
const EV_OTIKA_MEMBER = EV(
  "按 Melonbooks 商品页把 OTIKA 登记为同人音乐社团与署名作曲家、めるのめる为共同署名。",
  [SRC_KAMIYADORI, SRC_CHIDARUMA],
);
const EV_MIKU = EV(
  "按 ja.wikipedia 登记 初音ミク 为虚拟歌手角色（character）主体，独立于任何一首歌曲。",
  [SRC_MIKU],
);
const EV_TETO = EV(
  "按重音テト官方站登记 重音テト 的 CV 为 小山乃舞世（音声素材由本人录音加工），并登记官方运营サークル ツインドリル。",
  [SRC_TETO],
);
const EV_VOCALOID_COLLECTION = EV(
  "为「使用 VOCALOID / 歌声合成音源演唱的虚拟歌手角色」建立聚合枢纽（collection），用于把各虚拟歌手角色与收录其演唱的发行挂起来；依据是各发行页面的 VOCALOID 分类与 cast 表记。",
  [SRC_MIKU, SRC_TETO, SRC_ACT12],
);

// ---------------------------------------------------------------- 数据表

// 时长单位：秒（由 Bandcamp JSON-LD 的 ISO8601 换算）
const RELEASES = [
  {
    key: "act12",
    albumTitle: "prhythmatiq act:12",
    cover:
      "https://melonbooks.akamaized.net/user_data/packages/resize_image.php?image=213001047877.jpg&width=450&height=450",
    releaseTitle: "コミックマーケット107 頒布盤",
    releaseDate: "2025-12-31",
    event: "コミックマーケット107（2025-12-30〜31・東京ビッグサイト）",
    releaseSummary: "2025-12-31 コミックマーケット107 頒布・CD。Melonbooks 商品页 トラックリスト Tr.01-Tr.08。",
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=3378724",
    ev: EV_ACT12,
    circle: "prhythmatiq",
    artists: ["aether_eru"],
    jacketCredit: "aether_eru",
    extraCredits: ["utopialyric", "noah", "chibakenichi"],
    feats: "none",
    tracks: [
      { n: "Tr.01", t: "I'm 4 U", dur: null },
      { n: "Tr.02", t: "夜をアップデート", dur: null },
      { n: "Tr.03", t: "ココロ・アーカイブ", dur: null },
      { n: "Tr.04", t: "七色グラデーション -Sunset Remix 2025-", dur: null },
      { n: "Tr.05", t: "エレクトロガール - Energy retune remix-", dur: null },
      { n: "Tr.06", t: "I'm 4 U (without Miku ver.)", dur: null },
      { n: "Tr.07", t: "夜をアップデート (without Miku ver.)", dur: null },
      { n: "Tr.08", t: "ココロ・アーカイブ (without Miku ver.)", dur: null },
    ],
    alternates: [
      { from: "Tr.06", to: "Tr.01" },
      { from: "Tr.07", to: "Tr.02" },
      { from: "Tr.08", to: "Tr.03" },
    ],
  },
  {
    key: "brightness",
    albumTitle: "BRIGHTNESS",
    cover:
      "https://melonbooks.akamaized.net/user_data/packages/resize_image.php?image=213001046759.jpg&width=450&height=450",
    releaseTitle: "マジカルミライ2025 頒布盤",
    releaseDate: "2025-08-03",
    event: "初音ミク「マジカルミライ 2025」（幕張メッセ TOKYO 会期 2025-08-30〜09-01；商品页 発行日 为 2025-08-03）",
    releaseSummary: "2025 年 CD。Melonbooks 商品页 Tr.1-Tr.14；Bandcamp 官方页给出各曲时长。",
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=3218975",
    ev: EV_BRIGHTNESS,
    circle: "wkwkmwk",
    artists: ["mwk"],
    jacketCredit: "mwk",
    extraCredits: ["kaneko", "ga"],
    feats: "none",
    tracks: [
      { n: "1", t: "BRIGHTNESS", dur: 199 },
      { n: "2", t: "Inferiority Complex", dur: 180 },
      { n: "3", t: "Awake", dur: 244 },
      { n: "4", t: "Northern Lights", dur: 200 },
      { n: "5", t: "Cool Me Down", dur: 193 },
      { n: "6", t: "Inside Me", dur: 180 },
      { n: "7", t: "Connected", dur: 180 },
      { n: "8", t: "Days", dur: 260 },
      { n: "9", t: "Snow Crystal", dur: 258 },
      { n: "10", t: "Anniv.", dur: 204 },
      { n: "11", t: "Beautiful Day", dur: 228 },
      { n: "12", t: "Damnation", dur: 306 },
      { n: "13", t: "End of Life", dur: 258 },
      { n: "14", t: "Virtual Reality (2025 Rework)", dur: 235 },
    ],
    alternates: [],
  },
  {
    key: "kamiyadori",
    albumTitle: "KAMIYADORI",
    cover: "https://f4.bcbits.com/img/a0602239656_10.jpg",
    releaseTitle: "THE VOC@LOiD 超 M@STER 51 頒布盤",
    releaseDate: "2023-04-29",
    event: "THE VOC@LOiD 超 M@STER 51（活动主页未取得，日期取 Melonbooks 商品页 発行日 2023/04/29）",
    releaseSummary: "2023-04-29 CD。Melonbooks 商品页 Tr.1-Tr.5；全曲表记 feat. 初音ミク。",
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=1929732",
    ev: EV_KAMIYADORI,
    circle: "otika",
    artists: ["otika"],
    jacketCredit: "merunomeru",
    extraCredits: ["merunomeru"],
    feats: "all",
    tracks: [
      { n: "1", t: "Helios", dur: 157 },
      { n: "2", t: "KAMIYADORI", dur: 176 },
      { n: "3", t: "Nirvana", dur: 200 },
      { n: "4", t: "Mantra", dur: 173 },
      { n: "5", t: "TRON", dur: 172 },
    ],
    alternates: [],
  },
  {
    key: "chidaruma",
    albumTitle: "チダルマ",
    cover:
      "https://melonbooks.akamaized.net/user_data/packages/resize_image.php?image=213001043685.jpg&width=450&height=450",
    releaseTitle: "THE VOC@LOiD 超 M@STER 55 頒布盤",
    releaseDate: "2024-04-27",
    event: "THE VOC@LOiD 超 M@STER 55（活动主页未取得，日期取 Melonbooks 商品页 発行日 2024/04/27）",
    releaseSummary: "2024-04-27 CD。Melonbooks 商品页 Tr.1-Tr.13；Tr.1（Cryout）与 Tr.6（Take Me Beyond）无 feat. 表记。",
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=2379596",
    ev: EV_CHIDARUMA,
    circle: "otika",
    artists: ["otika"],
    jacketCredit: "merunomeru",
    extraCredits: ["merunomeru"],
    feats: "partial",
    tracks: [
      { n: "1", t: "Cryout", dur: 169, feat: false },
      { n: "2", t: "蟒蛇", dur: 178, feat: true },
      { n: "3", t: "チダルマ", dur: 206, feat: true },
      { n: "4", t: "バビロン", dur: 158, feat: true },
      { n: "5", t: "病垂", dur: 181, feat: true },
      { n: "6", t: "Take Me Beyond", dur: 183, feat: false },
      { n: "7", t: "Run", dur: 145, feat: true },
      { n: "8", t: "FLASH BACK", dur: 168, feat: true },
      { n: "9", t: "DRAIN", dur: 156, feat: true },
      { n: "10", t: "LANDER", dur: 151, feat: true },
      { n: "11", t: "火の鳥", dur: 165, feat: true },
      { n: "12", t: "獏の子", dur: 154, feat: true },
      { n: "13", t: "TERA", dur: 159, feat: true },
    ],
    alternates: [],
  },
];

const AGENTS = [
  { key: "prhythmatiq", title: "prhythmatiq", kind: "group", ev: EV_PRH_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/circle/index.php?circle_id=62481" },
  { key: "aether_eru", title: "Aether_Eru", kind: "group", ev: EV_PRH_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=3378724" },
  { key: "utopialyric", title: "UtopiaLyric", kind: "group", ev: EV_PRH_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=3378724" },
  { key: "noah", title: "Noah", kind: "group", ev: EV_PRH_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=3378724" },
  { key: "chibakenichi", title: "ちばけんいち", kind: "group", ev: EV_PRH_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=3378724" },
  { key: "wkwkmwk", title: "Wakuwaku Miwaku", kind: "group", ev: EV_WKW_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/circle/index.php?circle_id=25532" },
  { key: "mwk", title: "Mwk", kind: "group", ev: EV_WKW_MEMBER,
    srcUrl: "https://mwk094.bandcamp.com/album/brightness" },
  { key: "kaneko", title: "金子開発", kind: "group", ev: EV_WKW_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=3218975" },
  { key: "ga", title: "GA", kind: "group", ev: EV_WKW_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=3218975" },
  { key: "otika", title: "OTIKA", kind: "group", ev: EV_OTIKA_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=1929732" },
  { key: "merunomeru", title: "めるのめる", kind: "group", ev: EV_OTIKA_MEMBER,
    srcUrl: "https://www.melonbooks.co.jp/detail/detail.php?product_id=1929732" },
  { key: "miku", title: "初音ミク", kind: "character", ev: EV_MIKU,
    srcUrl: "https://ja.wikipedia.org/wiki/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF" },
  { key: "teto", title: "重音テト", kind: "character", ev: EV_TETO,
    srcUrl: "https://kasaneteto.jp/about/" },
  { key: "yamanon", title: "小山乃舞世", kind: "person", ev: EV_TETO,
    srcUrl: "https://kasaneteto.jp/about/" },
  { key: "twin-drill", title: "ツインドリル", kind: "group", ev: EV_TETO,
    srcUrl: "https://kasaneteto.jp/about/" },
];

// ---------------------------------------------------------------- 工具

const tr = (ja, zh) => ({
  "ja-JP": { title: ja },
  "zh-CN": { title: zh || ja },
  "zh-TW": { title: zh || ja },
  "en-US": { title: ja },
});

const stripFeat = (t) =>
  t.replace(/\s*\((?:feat\.[^)]*|without Miku ver\.)\)\s*$/i, "").trim();

/**
 * 建 Work 时按 (题名 + types) 查重。
 * 本领域会出现「专辑同名曲」：专辑 Work「BRIGHTNESS」与曲目 Work「BRIGHTNESS」
 * 同名但 types 不同（album / song）。lib.mjs 的 Index.find 只在传 scope.types 时比较类型，
 * 服务端检索则不比较——这里显式复核 types，避免把曲目 Work 复用成专辑 Work。
 */
async function ensureTyped(kind, title, type, spec, ev, idemKey) {
  const hit = camp.index.find(kind, title, { types: type });
  if (hit) {
    camp.reused.entity++;
    camp.log({ op: "entity", status: "reuse", kind, title, id: hit.id });
    return hit;
  }
  if (!DRY) {
    const found = (await client.search(kind, title)).find(
      (x) => norm(x.title) === norm(title) && (x.types || []).includes(type),
    );
    if (found) {
      camp.reused.entity++;
      camp.index.add(found);
      camp.log({ op: "entity", status: "reuse-server", kind, title, id: found.id });
      return found;
    }
  }
  // 必须把 types 一并带进底层查重：ensureEntity 的本地索引查重**不看**服务端检索那条路径，
  // 不传 scope.types 时会按 kind+题名命中同名专辑 Work（本领域有「专辑同名曲」）。
  return camp.ensureEntity(kind, title, spec, ev, { idemKey, scope: { types: type }, allowServerLookup: false });
}
const ensureWork = (title, type, spec, ev, idemKey) => ensureTyped("work", title, type, spec, ev, idemKey);

const inScope = (x, scope) =>
  (!scope.work_id || x.work_id === scope.work_id) &&
  (!scope.release_id || x.release_id === scope.release_id) &&
  (!scope.medium_id || x.medium_id === scope.medium_id) &&
  (!scope.parent_id || x.parent_id === scope.parent_id);

/** 网络抖动（代理断连）重试：lib 只对 429/5xx 退避，fetch 层异常会直接冒泡。 */
async function withRetry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw last;
}

/** 服务端按题名精确检索（只取活体，limit 50，命中后本地再比对）。 */
async function listExact(kind, title) {
  const res = await withRetry(() =>
    client.call("/api/catalog/entities?kind=" + kind + "&status=published&q=" + encodeURIComponent(title) + "&limit=50"),
  );
  return ((res.body && res.body.items) || []).filter((x) => norm(x.title) === norm(title));
}

/**
 * 建结构实体（篇目 / 表达 / 载体 / 轨道 / 发行）时按「题名 + 父级作用域」查重。
 *
 * 归属（work_id / release_id / medium_id）在服务端**不可变**（PUT 改父级返回
 * immutable_scope），所以同名但错挂的旧行无法原地改父级：这里改为在正确父级下新建，
 * 并把错挂的旧行登记进 leftovers，收尾时软删（见 cleanLeftovers）。
 * 触发场景：本脚本第一版没把 types 带进底层查重，把「专辑同名曲」的曲目实体
 * （BRIGHTNESS / KAMIYADORI / チダルマ）挂到了同名专辑 Work 上。
 */
async function ensureOwned(kind, title, spec, ev, idemKey, scope = {}, { checkExtra, patchExtra } = {}) {
  // 需要核对附加字段（contents / content_unit_id）时必须走服务端并回读整实体：
  // 列表返回值与本地索引行都不带这些字段。
  const local = checkExtra ? null : camp.index.find(kind, title, scope);
  if (local) {
    camp.reused.entity++;
    camp.log({ op: "entity", status: "reuse", kind, title, id: local.id });
    return local;
  }
  if (!DRY) {
    let exact = await listExact(kind, title);
    if (checkExtra && exact.length) {
      exact = await Promise.all(exact.map((x) => camp.getEntity(x.id).catch(() => x)));
    }
    // 先把"同题名但父级不同"的历史遗留行登记为孤儿（父级不可变，只能在正确父级下重建后清理）。
    for (const bad of exact) {
      if (!inScope(bad, scope)) {
        leftovers.push({ kind, id: bad.id, title, scope: bad.work_id || bad.release_id || bad.medium_id });
      }
    }
    const hit = exact.find((x) => inScope(x, scope) && (!checkExtra || checkExtra(x)));
    if (hit) {
      camp.reused.entity++;
      camp.index.add(hit);
      camp.log({ op: "entity", status: "reuse-server", kind, title, id: hit.id });
      return hit;
    }
    // 同题名 + 同归属但附加条件不满足（如表达挂错篇目）：该字段可变，就地修正。
    if (patchExtra) {
      const near = exact.find((x) => inScope(x, scope));
      if (near) {
        const patch = patchExtra(near);
        if (patch && Object.keys(patch).length) {
          const fixed = await camp.updateEntity(near.id, patch, ev);
          if (!checkExtra || checkExtra(fixed)) return fixed;
        }
      }
    }
  }
  return camp.ensureEntity(kind, title, spec, ev, { idemKey, scope, allowServerLookup: false });
}
const leftovers = [];

/**
 * 把"同题名但父级作用域不符"的历史遗留行登记为待清理孤儿。
 * 列表返回值不一定带结构字段，这里逐条回读整实体再判定；
 * 只登记本脚本自己的题名（题名含专辑名 + 曲序/曲名），不会误伤别人的条目。
 */
async function flagOutOfScope(kind, title, scope, keepId) {
  if (DRY) return;
  const exact = await listExact(kind, title);
  for (const x of exact) {
    if (x.id === keepId) continue;
    const full = await withRetry(() => camp.getEntity(x.id)).catch(() => null);
    if (!full || full.status !== "published") continue;
    if (inScope(full, scope)) continue;
    if (leftovers.some((l) => l.id === full.id)) continue;
    leftovers.push({ kind, id: full.id, title, scope: full.work_id || full.release_id || full.medium_id });
  }
}

/** 软删自己建错的孤儿行（父级迁移不可行时的唯一清理路径）。 */
async function cleanLeftovers() {
  for (const l of leftovers) {
    const cur = await camp.getEntity(l.id);
    if (cur.status === "deleted") continue;
    const res = await client.call("/api/catalog/entities/" + l.id + "/lifecycle", {
      method: "POST",
      body: {
        expected_version: cur.version,
        edit_note: "清理本领域脚本第一版把曲目实体错挂到同名专辑 Work 下产生的孤儿行（父级不可变，无法原地修正）。",
        sources: [{ kind: "self", citation: "doujin-vocaloid 领域脚本自检：该行不在任何发行的 Track contents / subjects / 关系中" }],
      },
    });
    if (res.status >= 400) {
      camp.failed.push({ op: "lifecycle", id: l.id, status: res.status, code: JSON.stringify(res.body).slice(0, 120) });
      camp.log({ op: "lifecycle", status: "FAIL", kind: l.kind, title: l.title, id: l.id, code: res.status + " " + JSON.stringify(res.body).slice(0, 120) });
    } else {
      camp.log({ op: "lifecycle", status: "deleted", kind: l.kind, title: l.title, id: l.id });
    }
  }
}
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

/** 发行 subjects：本次收录表达所属 Work 的并集（专辑 primary + 各曲 compilation，同 Work 只声明一次）。 */
const wantSubjects = (albumWork, songs) => [
  { work_id: albumWork.id, role: "primary", position: 0 },
  ...uniqueSongWorks(songs).map((w, i) => ({ work_id: w.id, role: "compilation", position: i + 1 })),
];

// 顺序无关比较：服务端返回的 subjects 顺序不保证与提交一致，
// 用下标比较会导致每次运行都触发一次无意义的整实体替换。
const sameSubjects = (have, want) => {
  const key = (x) => x.work_id + "|" + x.role;
  const a = new Set((have || []).map(key));
  const b = new Set((want || []).map(key));
  return a.size === b.size && [...b].every((k) => a.has(k));
};

/** 发行 subjects 按 (work, role) 去重：同一 Work 只声明一次。 */
const uniqueSongWorks = (songs) => {
  const seen = new Set();
  const out = [];
  for (const s of songs) {
    if (seen.has(s.work.id)) continue;
    seen.add(s.work.id);
    out.push(s.work);
  }
  return out;
};

const sortKeys = (o) => {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
};

const assertions = [];
function check(name, ok, detail) {
  assertions.push({ name, ok: !!ok, detail: detail === undefined ? "" : String(detail) });
  if (!ok) console.log("  [ASSERT-FAIL] " + name + (detail ? " :: " + detail : ""));
  return ok;
}

// ---------------------------------------------------------------- 主流程

console.log("== doujin-vocaloid：同人 / Vocaloid CD（活动限定发行）" + (DRY ? " [DRY-RUN]" : "") + " ==");

const client = new Client();
if (!DRY) await client.login();
const camp = new Campaign({ domain: "doujin-vocaloid", client, index: Index.load() });

// --verify / --audit 只读：跑完回读复核就退出，不做任何写入。
if (VERIFY) {
  process.exitCode = (await verifyOnly()) ? 2 : 0;
  process.exit(process.exitCode);
}
if (AUDIT) {
  process.exitCode = (await auditOnly()) ? 2 : 0;
  process.exit(process.exitCode);
}

/**
 * --audit 只读自查（不写库）：按本领域的数据表逐条核对
 *   · 同 kind + 同题名 + 同父级作用域是否出现 ≥2 条活体实体（重跑造成的重复建档）
 *   · 统计本领域实际落库的实体/关系数量
 */
async function auditOnly() {
  console.log("\n== 本领域落库自查（--audit）==");
  const plan = [];
  for (const R of RELEASES) {
    const relHit = (await client.search("release", R.releaseTitle)).find((x) => x.title === R.releaseTitle && x.status === "published");
    const relId = relHit ? relHit.id : null;
    const mediumHit = relId
      ? (await client.call("/api/catalog/entities?kind=medium&status=published&release_id=" + relId)).body.items || []
      : [];
    const medId = mediumHit[0] ? mediumHit[0].id : null;
    plan.push({ kind: "work", title: R.albumTitle, types: "album" });
    plan.push({ kind: "release", title: R.releaseTitle });
    plan.push({ kind: "content_unit", title: R.albumTitle + "（专辑本篇）", scope: medId ? {} : {} });
    plan.push({ kind: "expression", title: R.albumTitle + "（CD 母版）" });
    plan.push({ kind: "medium", title: "CD", scope: { release_id: relId } });
    for (let i = 0; i < R.tracks.length; i++) {
      const base = stripFeat(R.tracks[i].t);
      plan.push({ kind: "work", title: base, types: "song" });
      plan.push({ kind: "track", title: R.tracks[i].t, scope: { medium_id: medId } });
      // 篇目 / 表达题名带专辑名 + 曲序，足够唯一，直接按题名查重
      plan.push({ kind: "content_unit", title: R.albumTitle + " " + R.tracks[i].n + " " + base });
      plan.push({ kind: "expression", title: R.tracks[i].t + "（" + R.albumTitle + " 収録）" });
    }
  }
  for (const a of AGENTS) plan.push({ kind: "agent", title: a.title });
  plan.push({ kind: "collection", title: "VOCALOID／歌声合成 虚拟歌手" });

  const counts = {};
  const dups = [];
  for (const p of plan) {
    const items = (await client.search(p.kind, p.title)).filter((x) => x.status === "published");
    // 同题名 + **同父级作用域** 才算重复：medium「CD」全库同名、专辑同名曲（album/song）
    // 与同名 Track 都不是重复。
    let exact = items.filter((x) => norm(x.title) === norm(p.title));
    if (p.scope) exact = exact.filter((x) => inScope(x, p.scope));
    if (p.types) exact = exact.filter((x) => (x.types || []).includes(p.types));
    counts[p.kind] = counts[p.kind] || { titles: 0, live: 0 };
    counts[p.kind].titles++;
    counts[p.kind].live += exact.length;
    if (exact.length > 1) dups.push({ ...p, ids: exact.map((x) => x.id) });
  }
  console.log("按数据表的活体实体统计：");
  for (const [k, v] of Object.entries(counts)) console.log("  " + k + ": 题名 " + v.titles + " 条 → 活体 " + v.live + " 条");
  console.log("重复（同 kind + 同题名 + 活体 ≥2）：" + dups.length);
  for (const d of dups) console.log("  ! " + d.kind + "「" + d.title + "」 " + d.ids.join(", "));

  // 关系条数：按常见 source 端去重统计（发行 4 + 专辑 Work 4 + 专辑母版表达 4 + 初音ミク agent 1）
  const seen = new Set();
  const relTypes = {};
  const sources = [];
  for (const R of RELEASES) {
    for (const [kind, title] of [
      ["release", R.releaseTitle],
      ["work", R.albumTitle],
      ["expression", R.albumTitle + "（CD 母版）"],
    ]) {
      const hit = (await client.search(kind, title)).find((x) => norm(x.title) === norm(title) && x.status === "published");
      if (hit) sources.push(hit.id);
    }
  }
  const miku = (await client.search("agent", "初音ミク")).find((x) => x.status === "published");
  if (miku) sources.push(miku.id);
  for (const s of sources) {
    for (const x of await client.relationsOf(s)) {
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      relTypes[x.type] = (relTypes[x.type] || 0) + 1;
    }
  }
  console.log("主要 source 端（不含 37 条曲目表达）上的关系：" + seen.size + " 条");
  console.log("  " + Object.entries(relTypes).map(([k, v]) => k + "=" + v).join(", "));
  return dups.length ? 2 : 0;
}

// --- 1. agent -------------------------------------------------------------

const agents = {};
for (const a of AGENTS) {
  agents[a.key] = await ensureTyped("agent", a.title, a.kind, {
    original_language: "ja",
    types: [a.kind],
    translations: tr(a.title),
    attributes: {},
  }, a.ev, "dv-agent-" + a.key);
}

// --- 2. collection --------------------------------------------------------

const vocaloidCollection = await camp.ensureEntity("collection", "VOCALOID／歌声合成 虚拟歌手", {
  original_language: "ja",
  types: ["collection"],
  translations: {
    "ja-JP": { title: "VOCALOID / 歌声合成バーチャルシンガー" },
    "zh-CN": { title: "VOCALOID / 歌声合成虚拟歌手" },
    "zh-TW": { title: "VOCALOID / 歌聲合成虛擬歌手" },
    "en-US": { title: "VOCALOID / singing-synthesis virtual singers" },
  },
  attributes: { language: "ja" },
}, EV_VOCALOID_COLLECTION, { idemKey: "dv-collection-vocaloid", allowServerLookup: !DRY });

// --- 3. 每个发行：album Work + CU + Expression；song Work + CU + Expression；
//        Release + Medium + Track ---------------------------------------------

const built = [];
for (const R of RELEASES) {
  const ev = R.ev;

  const albumWork = await ensureWork(R.albumTitle, "album", {
    original_language: "ja",
    types: ["album"],
    translations: tr(R.albumTitle),
    attributes: { tags: ["同人音楽", "VOCALOID"] },
    pictures: [{
      url: R.cover,
      caption: {
        "zh-CN": "官方封面（商品页）",
        "ja-JP": "公式ジャケット（商品ページ）",
        "en-US": "Official cover (product page)",
      },
      source: { kind: "url", citation: "Melonbooks 商品页封面", url: R.srcUrl },
    }],
  }, ev, "dv-work-album-" + R.key);

  const cu = await ensureOwned("content_unit", R.albumTitle + "（专辑本篇）", {
    work_id: albumWork.id,
    position: 1,
    number: "1",
    original_language: "ja",
    types: ["content_unit"],
    translations: tr("アルバム本編"),
    attributes: { language: "ja", entry_role: "main" },
  }, ev, "dv-cu-album-" + R.key, { work_id: albumWork.id });
  await flagOutOfScope("content_unit", R.albumTitle + "（专辑本篇）", { work_id: albumWork.id }, cu.id);

  const albumExpr = await ensureOwned("expression", R.albumTitle + "（CD 母版）", {
    work_id: albumWork.id,
    content_unit_id: cu.id,
    position: 1,
    original_language: "ja",
    types: ["expression"],
    translations: tr("アルバム本編（CD マスター）"),
    attributes: { language: "ja", version_label: "CD マスター（商品页掲載版）" },
  }, ev, "dv-expr-album-" + R.key, { work_id: albumWork.id }, {
    checkExtra: (x) => x.content_unit_id === cu.id,
    patchExtra: () => ({ content_unit_id: cu.id }),
  });
  await flagOutOfScope("expression", R.albumTitle + "（CD 母版）", { work_id: albumWork.id }, albumExpr.id);

  const songs = [];
  for (let i = 0; i < R.tracks.length; i++) {
    const T = R.tracks[i];
    const base = stripFeat(T.t);
    const work = await ensureWork(base, "song", {
      original_language: "ja",
      types: ["song"],
      translations: tr(base),
      attributes: { tags: ["同人音楽", "VOCALOID"] },
    }, ev, "dv-work-song-" + R.key + "-" + i);

    const scu = await ensureOwned("content_unit", R.albumTitle + " " + T.n + " " + base, {
      work_id: work.id,
      position: i + 1,
      number: T.n,
      original_language: "ja",
      types: ["content_unit"],
      translations: tr(R.albumTitle + " " + T.n + " " + base),
      attributes: { language: "ja", entry_role: "main" },
    }, ev, "dv-cu-song-" + R.key + "-" + i, { work_id: work.id });
    await flagOutOfScope("content_unit", R.albumTitle + " " + T.n + " " + base, { work_id: work.id }, scu.id);

    // 每个 Track 位置一个表达：同一曲目的母版与 without Miku 版是两条不同的录音，
    // 题名带上完整曲目标题（含版本后缀）以免两条表达撞名。
    const expr = await ensureOwned("expression", T.t + "（" + R.albumTitle + " 収録）", {
      work_id: work.id,
      content_unit_id: scu.id,
      position: 1,
      original_language: "ja",
      types: ["expression"],
      translations: tr(T.t),
      attributes: Object.assign({ language: "ja" }, T.dur ? { duration: T.dur } : {}),
    }, ev, "dv-expr-song-" + R.key + "-" + i, { work_id: work.id }, {
      checkExtra: (x) => x.content_unit_id === scu.id,
      patchExtra: () => ({ content_unit_id: scu.id }),
    });
    await flagOutOfScope("expression", T.t + "（" + R.albumTitle + " 収録）", { work_id: work.id }, expr.id);

    songs.push({ T, base, work, cu: scu, expr });
  }

  const release = await ensureOwned("release", R.releaseTitle, {
    original_language: "ja",
    types: ["release"],
    // 服务端按 (work_id, role) 去重：同一作品只能出现一次（duplicate_subject），
    // 同一专辑里出现两次的同一曲目（母版 + without Miku 版）只声明一次 subjects。
    subjects: wantSubjects(albumWork, songs),
    translations: {
      "ja-JP": { title: R.releaseTitle, summary: R.releaseSummary },
      "zh-CN": { title: R.releaseTitle, summary: R.releaseSummary },
      "zh-TW": { title: R.releaseTitle, summary: R.releaseSummary },
      "en-US": { title: R.releaseTitle, summary: R.releaseSummary },
    },
    attributes: {
      edition_date: R.releaseDate,
      edition_type: "limited",
      edition_batch: "first_press",
      country: "JP",
      publisher: agents[R.circle].id,
      packaging: "jewel",
      distribution_channel: "physical",
    },
    pictures: [{
      url: R.cover,
      caption: {
        "zh-CN": "官方封面（商品页）",
        "ja-JP": "公式ジャケット（商品ページ）",
        "en-US": "Official cover (product page)",
      },
      source: { kind: "url", citation: "Melonbooks 商品页封面", url: R.srcUrl },
    }],
  }, ev, "dv-release-" + R.key, {});

  // subjects 必须在写 Track contents 之前同步好：Track contents 引用到未声明 Work 的表达会被
  // 服务端拒（undeclared_release_subject）。历史遗留的发行（subjects 里少了曲目 Work）在这一步补齐。
  let releaseFinal = release;
  {
    const want = wantSubjects(albumWork, songs);
    // ensureOwned 返回的是列表行/索引行，不带 subjects；必须回读整实体再比较，
    // 否则每次运行都会误判"subjects 不一致"并做一次无意义的整实体替换。
    const cur = await camp.getEntity(release.id);
    if (!sameSubjects(cur.subjects || [], want)) {
      releaseFinal = await camp.updateEntity(release.id, { subjects: want }, EV(
        "同步「" + R.albumTitle + "」发行记录的 subjects：列出被其载体实际收录表达所属的全部 Work（专辑 primary、各曲 compilation）。",
        [R.ev.sources[0]],
      ));
    }
  }

  const medium = await ensureOwned("medium", "CD", {
    release_id: release.id,
    position: 1,
    original_language: "ja",
    types: ["medium"],
    translations: {
      "ja-JP": { title: "CD" },
      "zh-CN": { title: "CD" },
      "zh-TW": { title: "CD" },
      "en-US": { title: "CD" },
    },
    attributes: { format: "cd", role: "primary" },
  }, ev, "dv-medium-" + R.key, { release_id: release.id });

  const tracks = [];
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    // Track 题名用**印刷的完整曲名**：同一张盘里同一曲目的母版与 without Miku 版是两条
    // 不同的收录位置，用去重后的曲名会让两条 Track 撞名（本地索引按题名+载体查重会误复用）。
    const tk = await ensureOwned("track", s.T.t, {
      medium_id: medium.id,
      position: i + 1,
      original_language: "ja",
      types: ["track"],
      translations: tr(s.T.t),
      contents: [{ expression_id: s.expr.id, position: 1 }],
      attributes: Object.assign({ role: "primary" }, s.T.dur ? { duration: s.T.dur } : {}),
    }, ev, "dv-track-" + R.key + "-" + i, { medium_id: medium.id }, {
      checkExtra: (x) => {
        const c = (x.contents || [])[0];
        return !!c && c.expression_id === s.expr.id;
      },
      patchExtra: () => ({ contents: [{ expression_id: s.expr.id, position: 1 }] }),
    });
    tracks.push(tk);
  }

  built.push({ R, albumWork, cu, albumExpr, songs, release: releaseFinal, medium, tracks });
}

// --- 4. 关系 --------------------------------------------------------------

const drySkipped = [];
const rel = async (type, source, target, attributes, note, sources) => {
  // dry-run 下 lib.mjs 的合成 id 由 title 派生：同名实体会拿到同一 id，凭空造出自环。
  // 真实运行时两端是各自读回的真实 uuid，因此这里只跳过 dry-run 的假自环。
  if (source === target) {
    if (!DRY) throw new Error("关系两端相同（服务端会拒自环）：" + type);
    drySkipped.push(type);
    return null;
  }
  plannedEdges.push({ type, source, target, attributes: attributes || {} });
  return camp.createRelation(type, source, target, EV(note, sources), {
    attributes: attributes || {},
    skipIfExists: !DRY, // dry-run 下不查服务端（计划由脚本先记录）
  });
};
const plannedEdges = [];

// 4.1 membership：虚拟歌手角色 → collection（includes 的两端只允许 work/collection，
// 角色是 agent，必须走 character_in）。
for (const key of ["miku", "teto"]) {
  await rel("character_in", agents[key].id, vocaloidCollection.id, { character_rank: "main" },
    "把虚拟歌手角色「" + agents[key].title + "」归入 VOCALOID／歌声合成虚拟歌手聚合枢纽。",
    [SRC_MIKU, SRC_TETO]);
}
// 4.1b membership：声源提供者属于虚拟歌手角色
// 关系属性 role 是受控词表（primary/side/extra/supplement/commentary），
// 自由文本的职务必须放 credit_role。
await rel("member_of", agents.yamanon.id, agents.teto.id, { credit_role: "CV" },
  "重音テト官方站记载其 CV 为小山乃舞世（音声素材由本人录音加工）。", [SRC_TETO]);
// created_by 的两端只允许 work/content_unit/expression/release → agent；
// 角色归属官方运营サークル属于 agent→agent，走 member_of。
await rel("member_of", agents.teto.id, agents["twin-drill"].id, { credit_role: "官方运营サークル" },
  "重音テト官方站记载其运营由官方サークル「ツインドリル」负责。", [SRC_TETO]);

// （subjects 已在建 medium / track 之前同步，见上面的 releaseFinal。）

// 4.3 创作链：work→content_unit→expression 的署名与角色
for (const b of built) {
  const R = b.R;
  // albums 只收录"作品"一次（去重后的曲目 Work 集合）
  for (const s of uniqueSongWorks(b.songs)) {
    await rel("includes", b.albumWork.id, s.id, {},
      "专辑「" + R.albumTitle + "」收录曲目作品「" + s.title + "」。",
      [R.ev.sources[0]]);
  }
  await rel("created_by", b.albumExpr.id, agents[R.circle].id, { credit_role: "サークル / 制作" },
    "「" + R.albumTitle + "」的专辑母版由社团 " + agents[R.circle].title + " 制作（商品页 サークル名）。",
    [R.ev.sources[0]]);
  for (const akey of R.artists) {
    await rel("performed_by", b.albumExpr.id, agents[akey].id, { credit_role: "作曲" },
      "「" + R.albumTitle + "」的作曲署名（Melonbooks 商品页 作家名）。", [R.ev.sources[0]]);
    await rel("performed_by", b.release.id, agents[akey].id, { credit_role: "作家" },
      "「" + R.albumTitle + "」发行的署名作家（Melonbooks 商品页 作家名）。", [R.ev.sources[0]]);
  }
  await rel("illustrated_by", b.release.id, agents[R.jacketCredit].id, { credit_role: "ジャケット" },
    "「" + R.albumTitle + "」的封面署名（Melonbooks 商品页 作家名）。", [R.ev.sources[0]]);
  for (const akey of R.extraCredits) {
    if (R.artists.includes(akey)) continue;
    await rel("credit_for", b.release.id, agents[akey].id,
      { credit_role: akey === R.jacketCredit ? "ジャケット" : "署名" },
      "「" + R.albumTitle + "」商品页 作家名 署名（" + agents[akey].title + "）。", [R.ev.sources[0]]);
  }
  // 曲目表达 → 演唱主体（仅在有 feat. 表记的曲目上建）
  for (const s of b.songs) {
    const withMiku = R.feats === "all" ? true : R.feats === "partial" ? !!s.T.feat : false;
    if (!withMiku) continue;
    await rel("performed_by", s.expr.id, agents.miku.id, { credit_role: "ボーカル（初音ミク）" },
      "曲目「" + s.T.t + "」的演唱表记为初音ミク（Melonbooks トラックリスト / Bandcamp 官方页表记）。",
      [R.ev.sources[0], R.ev.sources[1]]);
    await rel("character_in", agents.miku.id, s.work.id, { character_rank: "main" },
      "虚拟歌手角色初音ミク以演唱者身份参与曲目「" + s.base + "」（表记 feat. 初音ミク）。",
      [R.ev.sources[0]]);
  }
  for (const alt of R.alternates || []) {
    const from = b.songs.find((x) => x.T.n === alt.from);
    const to = b.songs.find((x) => x.T.n === alt.to);
    // 每个 Track 位置一条表达；正常不会相等，dry-run 下 lib 的合成 id 可能撞同名实体。
    if (from.expr.id === to.expr.id) continue;
    // version_label 不是关系属性（关系属性只有 role/credit_role/character_rank/context/
    // character/language/begin_date/end_date/scope），版本差异写进 edit_note。
    await rel("alternate_take_of", from.expr.id, to.expr.id, {},
      "同一曲目的 without Miku 版与初音ミク版（Melonbooks トラックリスト " + alt.from + " / " + alt.to + "）。",
      [R.ev.sources[0]]);
  }
}

// ---------------------------------------------------------------- 4.9 清理孤儿行
// 第一版脚本把「专辑同名曲」的篇目/表达错挂到专辑 Work 下；父级不可变，只能在正确父级下
// 重建（上面的 ensureOwned 已做），这里把确认不再被任何发行/关系引用的旧行软删。
if (!DRY && leftovers.length) {
  console.log("\n== 清理错挂的孤儿行（" + leftovers.length + " 条）==");
  await cleanLeftovers();
}

// ---------------------------------------------------------------- 5. 写后回读断言

if (!DRY) {
  console.log("\n== 写后回读断言 ==");

  // 每条计划中的边都要能从 source 端回读出来（lib 的幂等键曾静默丢边：同键第二次调用
  // 被当成重放返回首条结果）。按 source 端分组，一次 relationsOf 校验多条。
  const bySource = new Map();
  for (const e of plannedEdges) {
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source).push(e);
  }
  for (const [source, edges] of bySource) {
    const got = await client.relationsOf(source);
    for (const e of edges) {
      const found = got.find((x) => x.type === e.type && x.source_id === e.source
        && x.target_id === e.target && !x.via
        && JSON.stringify(sortKeys(x.attributes || {})) === JSON.stringify(sortKeys(e.attributes)));
      check("edge:" + e.type + ":" + e.source.slice(0, 8) + "→" + e.target.slice(0, 8), !!found,
        found ? "" : "missing in relationsOf(source)");
    }
  }
  check("edges:planned=" + plannedEdges.length, plannedEdges.length > 0, plannedEdges.length);
  for (const b of built) {
    const R = b.R;
    const rr = await camp.getEntity(b.release.id);
    check("release:" + R.key + ":kind", rr.kind === "release");
    check("release:" + R.key + ":edition_type=limited", rr.attributes && rr.attributes.edition_type === "limited",
      rr.attributes && rr.attributes.edition_type);
    check("release:" + R.key + ":edition_date", rr.attributes && rr.attributes.edition_date === R.releaseDate,
      rr.attributes && rr.attributes.edition_date);
    check("release:" + R.key + ":publisher", rr.attributes && rr.attributes.publisher === agents[R.circle].id,
      rr.attributes && rr.attributes.publisher);
    check("release:" + R.key + ":no-work_id", !rr.work_id, rr.work_id);
    check("release:" + R.key + ":version>=1", (rr.version || 0) >= 1, rr.version);
    check("release:" + R.key + ":translations=4", Object.keys(rr.translations || {}).length === 4,
      Object.keys(rr.translations || {}).join(","));

    const subjects = rr.subjects || [];
    const expectedSubjects = uniqueSongWorks(b.songs).length + 1;
    check("release:" + R.key + ":subjects=" + expectedSubjects,
      subjects.length === expectedSubjects, subjects.length);

    const mm = await camp.getEntity(b.medium.id);
    check("medium:" + R.key + ":release_id", mm.release_id === b.release.id);
    check("medium:" + R.key + ":format=cd", mm.attributes && mm.attributes.format === "cd",
      mm.attributes && mm.attributes.format);

    const referencedWorks = new Set();
    let contentsCount = 0;
    for (let i = 0; i < b.tracks.length; i++) {
      const t = await camp.getEntity(b.tracks[i].id);
      check("track:" + R.key + ":" + (i + 1) + ":medium_id", t.medium_id === b.medium.id);
      check("track:" + R.key + ":" + (i + 1) + ":position", t.position === i + 1, t.position);
      const c = (t.contents || [])[0];
      if (!c) { check("track:" + R.key + ":" + (i + 1) + ":contents", false, "no contents"); continue; }
      contentsCount++;
      if (c.expression_id !== b.songs[i].expr.id) {
        check("track:" + R.key + ":" + (i + 1) + ":expression_id", false, c.expression_id);
      }
      const ex = await camp.getEntity(c.expression_id);
      if (ex.work_id !== b.songs[i].work.id) check("expr:" + R.key + ":" + (i + 1) + ":work_id", false, ex.work_id);
      if (!ex.content_unit_id) {
        check("expr:" + R.key + ":" + (i + 1) + ":content_unit_id", false, "null");
      } else {
        const ecu = await camp.getEntity(ex.content_unit_id);
        if (ecu.work_id !== ex.work_id) check("expr:" + R.key + ":" + (i + 1) + ":cu-work", false, ecu.work_id);
      }
      referencedWorks.add(ex.work_id);
    }
    check("track:" + R.key + ":contents-count", contentsCount === b.tracks.length, contentsCount);

    const albumExpr = await camp.getEntity(b.albumExpr.id);
    check("albumExpr:" + R.key + ":content_unit_id", !!albumExpr.content_unit_id, albumExpr.content_unit_id);
    check("albumExpr:" + R.key + ":work_id", albumExpr.work_id === b.albumWork.id);

    const subjectWorks = new Set(subjects.map((s) => s.work_id));
    const missing = [...referencedWorks].filter((w) => !subjectWorks.has(w));
    check("release:" + R.key + ":subjects-cover-track-contents", missing.length === 0, missing.join(","));

    const rels = await client.relationsOf(b.albumWork.id);
    const inc = rels.filter((x) => x.type === "includes" && x.source_id === b.albumWork.id && !x.via);
    const expectedIncludes = uniqueSongWorks(b.songs).length;
    check("relations:" + R.key + ":album-includes=" + expectedIncludes, inc.length === expectedIncludes, inc.length);
    for (const x of inc) {
      if (!x.target_id) check("relations:" + R.key + ":includes-target", false, JSON.stringify(x).slice(0, 120));
    }
    const performed = rels.length;
    check("relations:" + R.key + ":album-work-has-relations", performed > 0, performed);
  }

  // collection 枢纽
  const colRels = await client.relationsOf(vocaloidCollection.id);
  check("relations:collection-character_in", colRels.filter((x) => x.type === "character_in").length >= 2, colRels.length);

  // 关系两端实体确实存在
  const mikuRels = await client.relationsOf(agents.miku.id);
  for (const x of mikuRels.slice(0, 200)) {
    const other = x.source_id === agents.miku.id ? x.target_id : x.source_id;
    if (!other) continue;
    if (!camp.index.byId(other)) {
      const g = await camp.getEntity(other).catch(() => null);
      check("relations:miku:peer-exists:" + other.slice(0, 8), !!g, "peer missing");
    }
  }

  // 审计修订：抽查 release 与一条曲目表达
  for (const b of built.slice(0, 1)) {
    for (const id of [b.release.id, b.songs[0].expr.id]) {
      const rv = await camp.client.call("/api/catalog/entities/" + id + "/revisions");
      const items = (rv.body && rv.body.items) || [];
      check("revisions:" + id.slice(0, 8) + ":exists", items.length >= 1, items.length);
      if (items.length) {
        const srcs = items[0].sources || items[0].Sources || [];
        check("revisions:" + id.slice(0, 8) + ":sources", srcs.length >= 1, srcs.length);
      }
    }
  }
}

const failedAssert = assertions.filter((a) => !a.ok);
const out = camp.summary({
  assertions: { total: assertions.length, failed: failedAssert.length, failedNames: failedAssert.map((a) => a.name) },
  entityPlan: {
    works: RELEASES.reduce((n, R) => n + 1 + R.tracks.length, 0),
    contentUnits: RELEASES.reduce((n, R) => n + 1 + R.tracks.length, 0),
    expressions: RELEASES.reduce((n, R) => n + 1 + R.tracks.length, 0),
    releases: RELEASES.length,
    mediums: RELEASES.length,
    tracks: RELEASES.reduce((n, R) => n + R.tracks.length, 0),
    agents: AGENTS.length,
    collections: 1,
  },
});

if (failedAssert.length && !DRY) {
  console.error("\n断言失败 " + failedAssert.length + " 项：");
  for (const f of failedAssert.slice(0, 40)) console.error(" - " + f.name + (f.detail ? " :: " + f.detail : ""));
  process.exitCode = 2;
}

// ---------------------------------------------------------------- 6. --verify：只读结构复核
// 用法：node …/doujin-vocaloid.mjs --verify
// 按题目/父级作用域回读整套层级，打印 专辑 Work / 曲目 Work / 篇目 / 表达 / 发行 / 载体 / 轨道
// 的实际归属与类型，并检查两条链是否闭合（不写库）。
async function verifyOnly() {
  console.log("\n== 只读结构复核（--verify）==");
  const listBy = async (kind, params) => {
    const qs = Object.entries(params).map(([k, v]) => "&" + k + "=" + encodeURIComponent(v)).join("");
    const res = await client.call("/api/catalog/entities?kind=" + kind + "&status=published&limit=50" + qs);
    return (res.body && res.body.items) || [];
  };
  let badCount = 0;
  const rows = [];
  for (const R of RELEASES) {
    const rel = (await listBy("release", { q: R.releaseTitle })).find((x) => x.title === R.releaseTitle);
    if (!rel) { console.log("[缺] release " + R.releaseTitle); badCount++; continue; }
    const albumWork = (await listBy("work", { q: R.albumTitle })).find((x) => x.title === R.albumTitle && (x.types || []).includes("album"));
    const mediums = await listBy("medium", { release_id: rel.id });
    const relFull = await camp.getEntity(rel.id);
    console.log("\n# " + R.albumTitle + " | release " + rel.id + " | subjects=" + (relFull.subjects || []).length
      + " | mediums=" + mediums.length + " | " + R.releaseDate);
    console.log("  album work: " + (albumWork ? albumWork.id + " types=" + JSON.stringify(albumWork.types) : "(缺)"));
    for (const m of mediums) {
      const tracks = (await listBy("track", { medium_id: m.id })).sort((a, b) => a.position - b.position);
      console.log("  medium " + m.id + " format=" + (m.attributes && m.attributes.format) + " tracks=" + tracks.length);
      for (const t of tracks) {
        const tk = await camp.getEntity(t.id);
        const inc = (tk.contents || [])[0];
        if (!inc) { console.log("    [缺 contents] " + t.position + " " + t.title); badCount++; continue; }
        const ex = await camp.getEntity(inc.expression_id);
        const w = await camp.getEntity(ex.work_id);
        const cu = ex.content_unit_id ? await camp.getEntity(ex.content_unit_id) : null;
        const ok = (w.types || []).includes("song") && cu && cu.work_id === ex.work_id;
        if (!ok) badCount++;
        rows.push({ rel: R.key, pos: t.position, track: t.title, expr: ex.id, work: w.id, workTitle: w.title, workTypes: w.types, ok });
        console.log("    " + (ok ? "OK " : "BAD") + " Tr" + t.position + " 「" + t.title + "」 → expr " + ex.id.slice(0, 8)
          + " → work " + w.id.slice(0, 8) + " 「" + w.title + "」 types=" + JSON.stringify(w.types)
          + " | cu=" + (cu ? cu.id.slice(0, 8) : "null") + (cu ? " cu.work=" + cu.work_id.slice(0, 8) : ""));
      }
    }
  }
  const songWorkIds = new Set(rows.filter((x) => x.ok).map((x) => x.work));
  console.log("\n曲目 Work（types=song，被表达引用）共 " + songWorkIds.size + " 条；结构异常 " + badCount + " 处");
  console.log("=== 只读复核结束 ===");
  return badCount;
}
