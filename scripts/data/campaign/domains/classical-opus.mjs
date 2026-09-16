#!/usr/bin/env node
// 领域 4「古典音乐作品（多乐章 + 多录音版本）」— 真实数据补录脚本。
//
// 覆盖 BRIEF 要求的两条链：
//   创作链：work(music) → content_unit(乐章/协奏曲) → expression(具体录音)
//   承载链：work → release(subjects) → medium(cd) → track(contents → expression)
//
// 数据全部来自可核对来源，每条写入自带 edit_note + sources：
//   · MusicBrainz WS/2 —— 作品本体（调性/作品号）、发行版品番/条码/介质/首发日期、乐章标题
//   · Apple iTunes Search/Lookup —— 曲目顺序、曲长秒数、发行 © 行、封面图
//   · Wikidata / 中文维基 / 英文维基 —— 多语言题名（zh-cn/zh-hant/ja/en/de）与作品本体事实
//
// 用法：MF_USER_PASS=… node scripts/data/campaign/domains/classical-opus.mjs [--dry-run]

import { Campaign, Client, Index, src, DRY } from "../lib.mjs";

// ── 来源 ────────────────────────────────────────────────────────────────────
const S = {
  mbBeethoven5: src("https://musicbrainz.org/work/d03bff61-26fc-301b-98ac-4d8e85771cbc",
    "MusicBrainz work「Symphony no. 5 in C minor, op. 67」：取作品本体事实（C 小调、作品 67、语言 zxx、类型 Symphony）"),
  wikiBeethoven5: src("https://zh.wikipedia.org/wiki/%E7%AC%AC5%E8%99%9F%E4%BA%A4%E9%9F%BF%E6%9B%B2_(%E8%B2%9D%E5%A4%9A%E8%8A%AC)",
    "中文维基「第5號交響曲 (貝多芬)」：C 小調第五號交響曲、作品 67、作於 1804–1808 年；取中文题名与创作年代"),
  mbDvorak9: src("https://musicbrainz.org/work/90379c91-2dce-4ba4-9900-dd32763ee0b4",
    "MusicBrainz work「Symphony no. 9 in E minor, Op. 95 “From the New World”」：取作品本体事实（E 小调、作品 95）"),
  wikiDvorak9: src("https://en.wikipedia.org/wiki/Symphony_No._9_(Dvo%C5%99%C3%A1k)",
    "英文维基 Symphony No. 9 (Dvořák)：E 小调、Op. 95、B. 178、《自新大陆》副题、1893 年创作于美国国家音乐学院任内"),
  zhDvorak9: src("https://zh.wikipedia.org/wiki/%E7%AC%AC9%E8%99%9F%E4%BA%A4%E9%9F%BF%E6%9B%B2_(%E5%BE%B7%E6%B2%83%E5%A4%8F%E5%85%8B)",
    "中文维基「第9號交響曲 (德沃夏克)」：E 小調第 9 號交響曲《自新大陆》、作品 95；取中文题名"),
  mbMahler5: src("https://musicbrainz.org/work/adcdc472-8b19-4e6f-aa4e-be8c6aea5f8a",
    "MusicBrainz work「Symphony no. 5」(Mahler, C-sharp minor)：确认五个乐章标题（I. Trauermarsch / II. Stürmisch bewegt / III. Scherzo / IV. Adagietto / V. Rondo-Finale）"),
  zhMahler5: src("https://zh.wikipedia.org/wiki/%E7%AC%AC5%E8%99%9F%E4%BA%A4%E9%9F%BF%E6%9B%B2_(%E9%A6%AC%E5%8B%92)",
    "中文维基「第5號交響曲 (馬勒)」：作於 1901–1902 年；取中文题名"),
  mbQuattro: src("https://musicbrainz.org/work/87886dcf-9776-49cb-b6f5-10104da6e42c",
    "MusicBrainz work「Le quattro stagioni」：原作意大利文题名与别名 “The Four Seasons”"),
  wikiQuattro: src("https://zh.wikipedia.org/wiki/%E5%9B%9B%E5%AD%A3_(%E7%B6%AD%E7%93%A6%E7%88%BE%E7%AC%AC)",
    "中文维基「四季 (維瓦爾第)」：四首小提琴协奏曲、约作于 1718–1720、1725 年作为 Op. 8 前四首在阿姆斯特丹出版；RV 269/315/293/297"),
  mbVltava: src("https://musicbrainz.org/work/009b2276-f259-3f13-9112-7f1df8e6962a",
    "MusicBrainz work「Má vlast: II. Vltava, JB 1:112/2」(Die Moldau)：确认它是《我的祖国》第二首交响诗、JB 1:112/2"),
  wikiVltava: src("https://en.wikipedia.org/wiki/M%C3%A1_vlast",
    "英文维基 Má vlast：六首交响诗（1874–1879），Vltava（The Moldau）为第二首，常与《新世界》同碟收录"),
  itKarajan56: src("https://music.apple.com/de/album/beethoven-symphony-nos-5-6/1440744257",
    "Apple Music「Beethoven: Symphony Nos. 5 & 6」(Berliner Philharmoniker & Herbert von Karajan, collectionId 1440744257)：第 1–4 首为第五交响曲四乐章（442/561/289/524 秒）、© ℗ 1984 Deutsche Grammophon GmbH；封面图"),
  mbKarajan56: src("https://musicbrainz.org/release/b5859bac-f18f-30f2-9f1c-44af4ccb75cf",
    "MusicBrainz release「Symphony No. 5 / Symphony No. 6 “Pastoral”」：品番 Deutsche Grammophon 423 203-2、条码 028942320321、地区 DE、1999-05-17、9 曲 1 CD（该录音为 1961–62 年立体声全集）"),
  itKleiber57: src("https://music.apple.com/de/album/beethoven-symphonies-nos-5-7/1644892939",
    "Apple Music「Beethoven: Symphonies Nos. 5 & 7」(Wiener Philharmoniker & Carlos Kleiber, collectionId 1644892939)：第 1–4 首为第五交响曲四乐章（442/601/309/661 秒）、© ℗ 1995 Deutsche Grammophon GmbH"),
  mbKleiber57: src("https://musicbrainz.org/release/4b3f9b25-af09-43be-8b10-d50345e17aa9",
    "MusicBrainz release「Beethoven Symphonies Nos. 5 & 7」：品番 Deutsche Grammophon 459 060-2、条码 028945906027、地区 XE、1998、8 曲 1 CD"),
  mbKleiber5: src("https://musicbrainz.org/ws/2/release/?query=barcode%3A028941586124",
    "MusicBrainz release 检索 barcode:028941586124 →「Symphony no. 5 in C minor, op. 67」(Kleiber / Wiener Philharmoniker)：单碟品番 Deutsche Grammophon 415 861-2、4 曲，佐证 1975 年录音的实体发行"),
  itDvorak: src("https://music.apple.com/de/album/dvo%C5%99%C3%A1k-symphony-no-9-from-the-new-world-smetana-the-moldau/1440758789",
    "Apple Music「Dvořák: Symphony No. 9 “From the New World” - Smetana: The Moldau」(Wiener Philharmoniker & Herbert von Karajan, collectionId 1440758789)：前 4 首为新世界四乐章（600/747/516/685 秒）、第 5 首为 Smetana《莫尔道河》766 秒、© ℗ 1985 Deutsche Grammophon GmbH"),
  mbDvorak: src("https://musicbrainz.org/release/c59c8292-64a0-45dc-ad16-cb350a99e4a9",
    "MusicBrainz release「Dvořák: Symphonies nos. 8 & 9 … Smetana: The Moldau / Vyšehrad」：品番 Deutsche Grammophon 474 266-2、条码 028947426622；确认这套 Wiener Philharmoniker / Karajan 录音把《莫尔道河》与新世界同碟收录"),
  itMahler5: src("https://music.apple.com/us/album/mahler-symphony-no-5/1440781907",
    "Apple Music「Mahler: Symphony No. 5」(Vienna Philharmonic & Leonard Bernstein, collectionId 1440781907)：5 首曲目（875/901/1148/678/900 秒）、© ℗ 1988 Deutsche Grammophon GmbH；封面图"),
  mbMahler5: src("https://musicbrainz.org/release/6ff4e4dd-c235-390f-bc0d-fe5e2403f078",
    "MusicBrainz release「Symphony no. 5」(Wiener Philharmoniker / Leonard Bernstein)：release-group first-release-date = 1988-06-20、secondary-types = Live、disambiguation「1987 Frankfurt recording」"),
  itVivaldi4s: src("https://music.apple.com/de/album/vivaldi-le-quattro-stagioni/1452552773",
    "Apple Music「Vivaldi: Le Quattro Stagioni」(The English Concert, collectionId 1452552773)：春季三乐章 198/162/220 秒、RV 269；© ℗ 1983 Deutsche Grammophon GmbH"),
  mbVivaldi4s: src("https://musicbrainz.org/release/2ae6ed7e-31fa-42fd-ab67-70f96486fa22",
    "MusicBrainz release「Le quattro stagioni」(The English Concert / Trevor Pinnock / Simon Standage)：厂牌 Archiv Produktion、品番 400 045-2、条码 3259140004523、12 曲（另有同年 2534 003 黑胶版）"),
};
// Wikidata 标签来源的构造器（每个 agent 都指到自己那个实体页面）
const wd = (qid, extra = "") => src("https://www.wikidata.org/wiki/" + qid,
  "Wikidata " + qid + " 标签：取 zh-cn / zh-hant / ja / en / de 题名" + (extra ? "；" + extra : ""));
const NOTE = (w) => "编目（classical-opus 领域）：" + w + "。依据下方来源核对题名、调性/作品号、发行品番与曲长；多语言题名取自 Wikidata / 维基对应语种标签。";

// ── 语言小工具 ──────────────────────────────────────────────────────────────
const tr = (zhCN, zhTW, jaJP, enUS, enSummary) => {
  const o = { "zh-CN": { title: zhCN }, "zh-TW": { title: zhTW }, "ja-JP": { title: jaJP }, "en-US": { title: enUS } };
  if (enSummary) o["en-US"].summary = enSummary;
  return o;
};

// ── Agent（15 个：作曲家 / 指挥 / 乐团 / 厂牌 / 虚构角色）────────────────────
const AGENTS = [
  { key: "beethoven", type: "person", title: "Ludwig van Beethoven", lang: "de",
    names: tr("路德维希·范·贝多芬", "路德維希·范·貝多芬", "ルートヴィヒ・ヴァン・ベートーヴェン", "Ludwig van Beethoven"),
    ext: { wikidata: "Q255" }, s: [wd("Q255", "德国作曲家（1770–1827）"), S.mbBeethoven5], what: "agent：作曲家 Ludwig van Beethoven" },
  { key: "dvorak", type: "person", title: "Antonín Dvořák", lang: "cs",
    names: tr("安东宁·德沃夏克", "安東寧·德弗札克", "アントニン・ドヴォルザーク", "Antonín Dvořák"),
    ext: { wikidata: "Q7298" }, s: [wd("Q7298", "捷克作曲家（1841–1904）"), S.zhDvorak9], what: "agent：作曲家 Antonín Dvořák" },
  { key: "mahler", type: "person", title: "Gustav Mahler", lang: "de",
    names: tr("古斯塔夫·马勒", "古斯塔夫·馬勒", "グスタフ・マーラー", "Gustav Mahler"),
    ext: { wikidata: "Q7304" }, s: [wd("Q7304", "奥地利晚期浪漫派作曲家（1860–1911）"), S.zhMahler5], what: "agent：作曲家 Gustav Mahler" },
  { key: "vivaldi", type: "person", title: "Antonio Vivaldi", lang: "it",
    names: tr("安东尼奥·维瓦尔第", "安東尼歐·韋瓦第", "アントニオ・ヴィヴァルディ", "Antonio Vivaldi"),
    ext: { wikidata: "Q1340" }, s: [wd("Q1340", "意大利作曲家（1678–1741）"), S.wikiQuattro], what: "agent：作曲家 Antonio Vivaldi" },
  { key: "smetana", type: "person", title: "Bedřich Smetana", lang: "cs",
    names: tr("贝多伊齐·斯美塔那", "貝多伊齊·史麥塔納", "ベドルジハ・スメタナ", "Bedřich Smetana"),
    ext: { wikidata: "Q207338" }, s: [wd("Q207338", "捷克作曲家（1824–1884），《我的祖国》作者"), S.wikiVltava], what: "agent：作曲家 Bedřich Smetana" },
  { key: "karajan", type: "person", title: "Herbert von Karajan", lang: "de",
    names: tr("赫伯特·冯·卡拉扬", "赫伯特·馮·卡拉揚", "ヘルベルト・フォン・カラヤン", "Herbert von Karajan"),
    ext: { wikidata: "Q154895" }, s: [wd("Q154895", "奥地利指挥家（1908–1989）"), S.mbKarajan56], what: "agent：指挥 Herbert von Karajan" },
  { key: "kleiber", type: "person", title: "Carlos Kleiber", lang: "de",
    names: tr("卡洛斯·克莱伯", "卡洛斯·克萊伯", "カルロス・クライバー", "Carlos Kleiber"),
    ext: { wikidata: "Q160706" }, s: [wd("Q160706", "奥地利籍指挥家，生于德国"), S.mbKleiber57], what: "agent：指挥 Carlos Kleiber" },
  { key: "bernstein", type: "person", title: "Leonard Bernstein", lang: "en",
    names: tr("伦纳德·伯恩斯坦", "倫納德·伯恩斯坦", "レナード・バーンスタイン", "Leonard Bernstein"),
    ext: { wikidata: "Q152505" }, s: [wd("Q152505", "美国指挥家、作曲家（1918–1990）"), S.mbMahler5], what: "agent：指挥 Leonard Bernstein" },
  { key: "pinnock", type: "person", title: "Trevor Pinnock", lang: "en",
    names: tr("特雷弗·平诺克", "特雷弗·平諾克", "トレヴァー・ピノック", "Trevor Pinnock"),
    ext: { wikidata: "Q434774" }, s: [wd("Q434774", "英国大键琴家、指挥家"), S.mbVivaldi4s], what: "agent：指挥/大键琴 Trevor Pinnock" },
  { key: "bpo", type: "group", title: "Berliner Philharmoniker", lang: "de",
    names: tr("柏林爱乐乐团", "柏林愛樂樂團", "ベルリン・フィルハーモニー管弦楽団", "Berlin Philharmonic"),
    ext: { wikidata: "Q152222" }, s: [wd("Q152222", "德国交响乐团"), S.mbKarajan56], what: "agent：乐团 Berliner Philharmoniker" },
  { key: "vpo", type: "group", title: "Wiener Philharmoniker", lang: "de",
    names: tr("维也纳爱乐乐团", "維也納愛樂樂團", "ウィーン・フィルハーモニー管弦楽団", "Vienna Philharmonic"),
    ext: { wikidata: "Q154685" }, s: [wd("Q154685", "奥地利维也纳的交响乐团"), S.mbDvorak], what: "agent：乐团 Wiener Philharmoniker" },
  { key: "englishconcert", type: "group", title: "The English Concert", lang: "en",
    names: tr("英国古乐团", "英國古樂團", "イングリッシュ・コンサート", "The English Concert"),
    ext: { wikidata: "Q926326" }, s: [wd("Q926326", "英格兰古乐（period-instrument）乐团"), S.mbVivaldi4s], what: "agent：古乐团 The English Concert" },
  { key: "dg", type: "organization", title: "Deutsche Grammophon", lang: "de",
    names: tr("德意志留声机公司", "德意志留聲機公司", "ドイツ・グラモフォン", "Deutsche Grammophon",
      "德国古典音乐唱片厂牌；本领域四张发行（423 203-2 / 459 060-2 / 474 266-2 / 423 608-2）的发行方。"),
    ext: { wikidata: "Q168407" }, s: [wd("Q168407", "德国古典音乐唱片厂牌"), S.mbKarajan56], what: "agent（organization）：厂牌 Deutsche Grammophon" },
  { key: "archiv", type: "organization", title: "Archiv Produktion", lang: "de",
    names: tr("阿希夫制作", "阿希夫製作", "アルヒーフ・プロダクション", "Archiv Produktion",
      "Deutsche Grammophon 旗下的古乐子厂牌；维瓦尔第《四季》(400 045-2) 在该厂牌发行。"),
    ext: { wikidata: "Q635515" }, s: [wd("Q635515", "Deutsche Grammophon 的古乐子厂牌"), S.mbVivaldi4s], what: "agent（organization）：厂牌 Archiv Produktion" },
  { key: "spring", type: "character", title: "La primavera", lang: "it",
    names: tr("春", "春", "春", "Spring"),
    ext: {}, s: [S.wikiQuattro], what: "agent（character）：维瓦尔第《四季》标题所指的“春”" },
];
// ── Work（5 部）────────────────────────────────────────────────────────────
// content_unit 的 number 保留官方罗马数字/序数；expression 每条 = 一次具体录音。
// 说明：为把新增实体控制在 BRIEF 的 30–70 区间，脚本只取每部作品“部分乐章”建篇目与曲目
// （缺口清单记录未建的部分），其中维瓦尔第《四季》只落了“春”“夏”两个协奏曲篇目。
const WORKS = [
  { key: "beethoven5", title: "Symphony No. 5 (Beethoven)", lang: "zxx", type: "music",
    names: tr("c 小调第五交响曲（贝多芬）", "c 小調第五號交響曲（貝多芬）", "交響曲第5番 ハ短調（ベートーヴェン）", "Symphony No. 5 in C minor (Beethoven)"),
    attrs: { tags: ["古典音乐", "交响曲", "classical", "symphony"], author: "Ludwig van Beethoven",
      copyright: "Public domain", edition_date: "1808" },
    ext: { musicbrainz: "d03bff61-26fc-301b-98ac-4d8e85771cbc" },
    sum: "贝多芬第五交响曲，C 小调，作品 67，1804–1808 年创作；本领域收录卡拉扬/柏林爱乐（1961–62）与克莱伯/维也纳爱乐（1975）两个录音。",
    s: [S.mbBeethoven5, S.wikiBeethoven5], what: "work：贝多芬第五交响曲（C 小调，Op. 67）",
    units: [
      { key: "beethoven5-I", number: "I",
        names: tr("第一乐章：有活力的快板", "第一樂章：有活力的快板", "第1楽章 アレグロ・コン・ブリオ", "I. Allegro con brio") },
      { key: "beethoven5-II", number: "II",
        names: tr("第二乐章：稍快的行板", "第二樂章：稍快的行板", "第2楽章 アンダンテ・コン・モート", "II. Andante con moto") },
    ],
    exprs: [
      { key: "e-k62-1", unit: "I", dur: 442, label: "卡拉扬/柏林爱乐 1961–62 年录音（DG 423 203-2 第 1 曲）",
        short: "卡拉扬/柏林爱乐 1961–62", shortJa: "カラヤン／ベルリン・フィル 1961–62", s: [S.itKarajan56, S.mbKarajan56] },
      { key: "e-k62-2", unit: "II", dur: 561, label: "卡拉扬/柏林爱乐 1961–62 年录音（DG 423 203-2 第 2 曲）",
        short: "卡拉扬/柏林爱乐 1961–62", shortJa: "カラヤン／ベルリン・フィル 1961–62", s: [S.itKarajan56] },
      { key: "e-kl75-1", unit: "I", dur: 442, label: "克莱伯/维也纳爱乐 1975 年录音（DG 415 861-2 / 459 060-2 第 1 曲）",
        short: "克莱伯/维也纳爱乐 1975", shortJa: "クライバー／ウィーン・フィル 1975", s: [S.itKleiber57, S.mbKleiber5, S.mbKleiber57] },
      { key: "e-kl75-2", unit: "II", dur: 601, label: "克莱伯/维也纳爱乐 1975 年录音（DG 459 060-2 第 2 曲）",
        short: "克莱伯/维也纳爱乐 1975", shortJa: "クライバー／ウィーン・フィル 1975", s: [S.itKleiber57] },
    ],
    rels: [
      { key: "rel-k62", title: "Beethoven: Symphony Nos. 5 & 6",
        names: tr("贝多芬：第五、第六交响曲（卡拉扬/柏林爱乐）", "貝多芬：第五、第六號交響曲（卡拉揚/柏林愛樂）",
          "ベートーヴェン：交響曲第5番・第6番（カラヤン／ベルリン・フィル）", "Beethoven: Symphonies Nos. 5 & 6 (Karajan)"),
        attrs: { catalog_number: "423 203-2", barcode: "028942320321", edition_date: "1999-05-17",
          edition_type: "standard", edition_batch: "reissue", country: "DE", publisher_agent: "dg",
          packaging: "jewel", distribution_channel: "physical" },
        subjects: [{ work: "beethoven5", role: "primary", position: 0 }],
        sum: "DG 423 203-2：卡拉扬 1961–62 年与柏林爱乐的第一套立体声全集里，第五、第六交响曲同碟（1999 年再版）。",
        s: [S.mbKarajan56, S.itKarajan56], what: "release：DG 423 203-2（Beethoven 第五、第六交响曲，卡拉扬 1961–62）",
        medium: { key: "m-k62", title: "CD", format: "cd", s: [S.mbKarajan56] },
        tracks: [{ key: "t-k62-1", no: "1", exp: "e-k62-1", dur: 442, s: [S.itKarajan56] },
                 { key: "t-k62-2", no: "2", exp: "e-k62-2", dur: 561, s: [S.itKarajan56] }] },
      { key: "rel-kl75", title: "Beethoven: Symphonies Nos. 5 & 7",
        names: tr("贝多芬：第五、第七交响曲（克莱伯/维也纳爱乐）", "貝多芬：第五、第七號交響曲（克萊伯/維也納愛樂）",
          "ベートーヴェン：交響曲第5番・第7番（クライバー／ウィーン・フィル）", "Beethoven: Symphonies Nos. 5 & 7 (Kleiber)"),
        attrs: { catalog_number: "459 060-2", barcode: "028945906027", edition_date: "1998",
          edition_type: "standard", edition_batch: "reissue", country: "XE", publisher_agent: "dg",
          packaging: "jewel", distribution_channel: "physical" },
        subjects: [{ work: "beethoven5", role: "primary", position: 0 }],
        sum: "DG 459 060-2：克莱伯 1975 年维也纳爱乐录音，第五、第七交响曲同碟（Apple Music 数字再版 © 1995）。",
        s: [S.mbKleiber57, S.itKleiber57, S.mbKleiber5], what: "release：DG 459 060-2（Beethoven 第五、第七交响曲，克莱伯 1975）",
        medium: { key: "m-kl75", title: "CD", format: "cd", s: [S.mbKleiber57] },
        tracks: [{ key: "t-kl-1", no: "1", exp: "e-kl75-1", dur: 442, s: [S.itKleiber57] },
                 { key: "t-kl-2", no: "2", exp: "e-kl75-2", dur: 601, s: [S.itKleiber57] }] },
    ] },
  { key: "dvorak9", title: "Symphony No. 9 (Dvořák)", lang: "zxx", type: "music",
    names: tr("e 小调第九交响曲《自新大陆》（德沃夏克）", "e 小調第九號交響曲《自新大陸》（德弗札克）", "交響曲第9番 ホ短調《新世界より》（ドヴォルザーク）", "Symphony No. 9 in E minor “From the New World” (Dvořák)"),
    attrs: { tags: ["古典音乐", "交响曲", "classical", "symphony"], author: "Antonín Dvořák",
      copyright: "Public domain", edition_date: "1893" },
    ext: { musicbrainz: "90379c91-2dce-4ba4-9900-dd32763ee0b4" },
    sum: "德沃夏克第九交响曲（《自新大陆》），E 小调，Op. 95 / B. 178，1893 年；本领域收录卡拉扬/维也纳爱乐 1985 年录音。",
    s: [S.mbDvorak9, S.wikiDvorak9, S.zhDvorak9], what: "work：德沃夏克第九交响曲《自新大陆》（E 小调，Op. 95）",
    units: [
      { key: "dvorak9-I", number: "I",
        names: tr("第一乐章：柔板—很快的快板", "第一樂章：慢板—極快的快板", "第1楽章 アダージョ—アレグロ・モルト", "I. Adagio – Allegro molto") },
      { key: "dvorak9-II", number: "II",
        names: tr("第二乐章：广板", "第二樂章：緩板", "第2楽章 ラルゴ", "II. Largo") },
    ],
    exprs: [
      { key: "e-k85d-1", unit: "I", dur: 600, label: "卡拉扬/维也纳爱乐 1985 年录音（DG 474 266-2 第 1 曲）",
        short: "卡拉扬/维也纳爱乐 1985", shortJa: "カラヤン／ウィーン・フィル 1985", s: [S.itDvorak, S.mbDvorak] },
      { key: "e-k85d-2", unit: "II", dur: 747, label: "卡拉扬/维也纳爱乐 1985 年录音（DG 474 266-2 第 2 曲）",
        short: "卡拉扬/维也纳爱乐 1985", shortJa: "カラヤン／ウィーン・フィル 1985", s: [S.itDvorak] },
    ],
    rels: [{ key: "rel-k85d", title: "Dvořák: Symphony No. 9 “From the New World” / Smetana: The Moldau",
      names: tr("德沃夏克：第九交响曲《自新大陆》／斯美塔那：莫尔道河（卡拉扬/维也纳爱乐）",
        "德弗札克：第九號交響曲《自新大陸》／史麥塔納：莫爾道河（卡拉揚/維也納愛樂）",
        "ドヴォルザーク：交響曲第9番《新世界より》／スメタナ：モルダウ（カラヤン／ウィーン・フィル）",
        "Dvořák: Symphony No. 9 “From the New World” / Smetana: The Moldau (Karajan)"),
      attrs: { catalog_number: "474 266-2", barcode: "028947426622", edition_date: "2002-03-01",
        edition_type: "standard", edition_batch: "reissue", country: "DE", publisher_agent: "dg",
        packaging: "jewel", distribution_channel: "physical" },
      // 跨作品收录：Dvořák《新世界》(primary) + Smetana《莫尔道河》(compilation)
      subjects: [{ work: "dvorak9", role: "primary", position: 0 }, { work: "vltava", role: "compilation", position: 1 }],
      sum: "DG 474 266-2：卡拉扬/维也纳爱乐 1985 年录音；前四曲为新世界交响曲四乐章，第 5 曲为斯美塔那《我的祖国》第二首《莫尔道河》——因此 subjects 同时声明两部作品（primary + compilation）。",
      s: [S.mbDvorak, S.itDvorak, S.wikiVltava, S.mbVltava],
      what: "release：DG 474 266-2（Dvořák《新世界》+ Smetana《莫尔道河》，卡拉扬 1985 维也纳录音）",
      medium: { key: "m-k85d", title: "CD", format: "cd", s: [S.mbDvorak] },
      tracks: [{ key: "t-dv-1", no: "1", exp: "e-k85d-1", dur: 600, s: [S.itDvorak, S.mbDvorak] },
               { key: "t-dv-2", no: "2", exp: "e-k85d-2", dur: 747, s: [S.itDvorak] },
               { key: "t-dv-5", no: "5", exp: "e-k85v-1", dur: 766, s: [S.itDvorak, S.mbVltava, S.wikiVltava] }] }] },
  // Work 题名必须能唯一标识创作母体：beethoven5 / mahler5 都叫 "Symphony No. 5" 时，
  // 服务端的精确同名检索会把它们收敛成同一个实体（实测）。这里带上作曲家以区分。
  { key: "mahler5", title: "Symphony No. 5 (Mahler)", lang: "zxx", type: "music",
    names: tr("升 c 小调第五交响曲（马勒）", "升 c 小調第五號交響曲（馬勒）", "交響曲第5番 嬰ハ短調（マーラー）", "Symphony No. 5 in C-sharp minor (Mahler)"),
    attrs: { tags: ["古典音乐", "交响曲", "classical", "symphony"], author: "Gustav Mahler",
      copyright: "Public domain", edition_date: "1902" },
    ext: { musicbrainz: "adcdc472-8b19-4e6f-aa4e-be8c6aea5f8a" },
    sum: "马勒第五交响曲，升 c 小调，1901–1902 年创作，共五个乐章；本领域收录伯恩斯坦/维也纳爱乐 1987 年法兰克福现场录音。",
    s: [S.mbMahler5, S.zhMahler5], what: "work：马勒第五交响曲（升 c 小调，五乐章）",
    units: [
      { key: "mahler5-I", number: "I",
        names: tr("第一乐章：葬礼进行曲", "第一樂章：葬禮進行曲", "第1楽章 葬送行進曲", "I. Trauermarsch") },
      { key: "mahler5-II", number: "II",
        names: tr("第二乐章：激烈地（极其猛烈地）", "第二樂章：激烈地（極其猛烈地）", "第2楽章 激しく動いて", "II. Stürmisch bewegt. Mit größter Vehemenz") },
    ],
    exprs: [
      { key: "e-b87-1", unit: "I", dur: 875, label: "伯恩斯坦/维也纳爱乐 1987 年法兰克福现场（DG 423 608-2 第 1 曲）",
        short: "伯恩斯坦/维也纳爱乐 1987 现场", shortJa: "バーンスタイン／ウィーン・フィル 1987 ライヴ", s: [S.itMahler5, S.mbMahler5] },
      { key: "e-b87-2", unit: "II", dur: 901, label: "伯恩斯坦/维也纳爱乐 1987 年法兰克福现场（DG 423 608-2 第 2 曲）",
        short: "伯恩斯坦/维也纳爱乐 1987 现场", shortJa: "バーンスタイン／ウィーン・フィル 1987 ライヴ", s: [S.itMahler5] },
    ],
    rels: [{ key: "rel-b88", title: "Mahler: Symphony No. 5",
      names: tr("马勒：第五交响曲（伯恩斯坦/维也纳爱乐）", "馬勒：第五號交響曲（伯恩斯坦/維也納愛樂）",
        "マーラー：交響曲第5番（バーンスタイン／ウィーン・フィル）", "Mahler: Symphony No. 5 (Bernstein)"),
      attrs: { catalog_number: "423 608-2", barcode: "028942360822", edition_date: "1988-06-20",
        edition_type: "standard", edition_batch: "regular", country: "DE", publisher_agent: "dg",
        packaging: "jewel", distribution_channel: "physical" },
      subjects: [{ work: "mahler5", role: "primary", position: 0 }],
      sum: "DG 423 608-2：伯恩斯坦 1987 年法兰克福现场（维也纳爱乐），1988-06-20 首发（MusicBrainz release-group first-release-date）。",
      s: [S.mbMahler5, S.itMahler5], what: "release：DG 423 608-2（Mahler 第五交响曲，伯恩斯坦 1987 法兰克福现场）",
      medium: { key: "m-b88", title: "CD", format: "cd", s: [S.mbMahler5] },
      tracks: [{ key: "t-mh-1", no: "1", exp: "e-b87-1", dur: 875, s: [S.itMahler5] },
               { key: "t-mh-2", no: "2", exp: "e-b87-2", dur: 901, s: [S.itMahler5] }] }] },
  { key: "vltava", title: "Vltava", lang: "cs", type: "music",
    names: tr("莫尔道河（《我的祖国》第二首）", "莫爾道河（《我的祖國》第二首）", "モルダウ（わが祖国 第2曲）", "Vltava (The Moldau), from Má vlast"),
    attrs: { tags: ["古典音乐", "交响诗", "classical", "symphonic poem"], author: "Bedřich Smetana",
      copyright: "Public domain", edition_date: "1874" },
    ext: { musicbrainz: "009b2276-f259-3f13-9112-7f1df8e6962a" },
    sum: "斯美塔那交响诗套曲《我的祖国》(Má vlast, JB 1:112) 的第二首《莫尔道河》(Vltava)；常与德沃夏克《新世界》同碟收录。",
    s: [S.mbVltava, S.wikiVltava], what: "work：斯美塔那《莫尔道河》（《我的祖国》第二首，JB 1:112/2）",
    units: [{ key: "vltava-2", number: "II",
      names: tr("全曲（《我的祖国》第二首交响诗）", "全曲（《我的祖國》第二首交響詩）", "全曲（わが祖国 第2曲）", "Complete tone poem (Má vlast no. 2)") }],
    exprs: [{ key: "e-k85v-1", unit: "II", dur: 766, defer: true, label: "卡拉扬/维也纳爱乐 1985 年录音（DG 474 266-2 第 5 曲）",
      short: "卡拉扬/维也纳爱乐 1985", shortJa: "カラヤン／ウィーン・フィル 1985", s: [S.itDvorak, S.mbVltava, S.wikiVltava] }],
    rels: [] },
  // 《四季》在真实证据里是四首独立小提琴协奏曲（MusicBrainz 各有自己的 work 条目），
  // 因此这里把「春」「夏」各建一个 work 乐章挂其下，再用 collection 作为 Op. 8 前四首的聚合枢纽
  // （includes 的两端只允许 work/collection，把协奏曲写成别人的 content_unit 表达不出"套曲"语义）。
  { key: "spring", title: "La primavera", lang: "it", type: "music",
    names: tr("春（四季之春）", "春（四季之春）", "春（四季より）", "La primavera (Spring)"),
    attrs: { tags: ["古典音乐", "协奏曲", "classical", "concerto"], author: "Antonio Vivaldi",
      copyright: "Public domain", edition_date: "1725" },
    ext: { musicbrainz: "2521d31b-3670-419b-9996-6741d5456bf7" },
    sum: "维瓦尔第《四季》中的第一首小提琴协奏曲《春》，E 大调，RV 269；约 1718–1720 年创作，1725 年随 Op. 8 在阿姆斯特丹出版。",
    s: [S.wikiQuattro, S.mbQuattro], what: "work：维瓦尔第《春》（四季之一，RV 269）",
    units: [{ key: "spring-I", number: "I",
      names: tr("第一乐章：快板（E 大调）", "第一樂章：快板（E 大調）", "第1楽章 アレグロ（ホ長調）", "I. Allegro") }],
    exprs: [{ key: "e-p82-1", unit: "I", dur: 198, label: "平诺克/英国古乐团 1982 年录音（Archiv 400 045-2 第 1 曲）",
      short: "平诺克/英国古乐团 1982", shortJa: "ピノック／イングリッシュ・コンサート 1982", s: [S.itVivaldi4s, S.mbVivaldi4s] }],
    rels: [] },
  { key: "summer", title: "L'estate", lang: "it", type: "music",
    names: tr("夏（四季之夏）", "夏（四季之夏）", "夏（四季より）", "L'estate (Summer)"),
    attrs: { tags: ["古典音乐", "协奏曲", "classical", "concerto"], author: "Antonio Vivaldi",
      copyright: "Public domain", edition_date: "1725" },
    ext: { musicbrainz: "3e760b6f-0801-46b0-814e-f71e79acf686" },
    sum: "维瓦尔第《四季》中的第二首小提琴协奏曲《夏》，g 小调，RV 315；1725 年随 Op. 8 在阿姆斯特丹出版。",
    s: [S.wikiQuattro, S.mbQuattro], what: "work：维瓦尔第《夏》（四季之二，RV 315）",
    units: [{ key: "summer-I", number: "I",
      names: tr("第一乐章：不很快的快板", "第一樂章：不很快的快板", "第1楽章 アレグロ・ノン・モルト", "I. Allegro non molto") }],
    exprs: [{ key: "e-p82-2", unit: "I", dur: 288, label: "平诺克/英国古乐团 1982 年录音（Archiv 400 045-2 第 4 曲）",
      short: "平诺克/英国古乐团 1982", shortJa: "ピノック／イングリッシュ・コンサート 1982", s: [S.itVivaldi4s, S.mbVivaldi4s] }],
    rels: [{ key: "rel-p82", title: "Vivaldi: Le Quattro Stagioni",
      names: tr("维瓦尔第：四季（平诺克/英国古乐团）", "韋瓦第：四季（平諾克/英國古樂團）",
        "ヴィヴァルディ：四季（ピノック／イングリッシュ・コンサート）", "Vivaldi: The Four Seasons (Pinnock)"),
      attrs: { catalog_number: "400 045-2", barcode: "3259140004523", edition_date: "1982-09-15",
        edition_type: "standard", edition_batch: "regular", country: "DE", publisher_agent: "archiv",
        packaging: "jewel", distribution_channel: "physical" },
      // 一张《四季》碟同时收录"春"与"夏"两首独立作品：subjects 必须两部都声明
      subjects: [{ work: "spring", role: "primary", position: 0 }, { work: "summer", role: "compilation", position: 1 }],
      sum: "Archiv Produktion 400 045-2：平诺克与英国古乐团 1982 年古乐演奏版《四季》全曲录音（12 曲；本脚本落其第 1、4 曲）。",
      s: [S.mbVivaldi4s, S.itVivaldi4s], what: "release：Archiv 400 045-2（Vivaldi《四季》，平诺克 1982 古乐录音）",
      medium: { key: "m-p82", title: "CD", format: "cd", s: [S.mbVivaldi4s] },
      tracks: [{ key: "t-vv-1", no: "1", exp: "e-p82-1", dur: 198, s: [S.itVivaldi4s] },
               { key: "t-vv-4", no: "4", exp: "e-p82-2", dur: 288, s: [S.itVivaldi4s] }] }] },
];

// ── Collection（聚合枢纽：《四季》隶属的 Op. 8 前四首用 includes 连到各协奏曲 work）──
const COLLECTIONS = [
  { key: "quares-cycle", title: "Le quattro stagioni (collection)", lang: "it",
    names: tr("维瓦尔第《四季》套曲", "維瓦爾第《四季》套曲", "ヴィヴァルディ《四季》（套曲）", "The Four Seasons (cycle)"),
    ext: {}, s: [S.wikiQuattro, S.mbQuattro],
    what: "collection：维瓦尔第《四季》套曲（聚合四首独立协奏曲 Work 的枢纽）",
    includes: ["spring", "summer"] },
];

// ── 执行 ────────────────────────────────────────────────────────────────────
const client = new Client();
await client.login();
const camp = new Campaign({ domain: "classical-opus", client, index: Index.load() });

const ID = {};
// ── 结构作用域预载（重跑前先把子实体拉进本地索引，避免重复建档）──────────────────
{
  const wanted = new Set(WORKS.map((w) => w.title));
  const allOf = async (kind, extra = "") => {
    const out = [];
    for (let off = 0; ; off += 50) {
      const r = await client.call("/api/catalog/entities?kind=" + kind + "&limit=50&offset=" + off + extra);
      const items = (r.body && r.body.items) || [];
      out.push(...items);
      if (items.length < 50) break;
    }
    return out;
  };
  const works = (await allOf("work")).filter((x) => wanted.has(x.title));
  const collections = (await allOf("collection")).filter((x) => x.title === "Le quattro stagioni (collection)");
  const mineIds = new Set(works.map((x) => x.id));
  for (const x of works.concat(collections)) camp.index.add(x);
  camp.index.rows = camp.index.rows.filter((x) => !(x.kind === "work" && wanted.has(x.title) && !mineIds.has(x.id)));
  let units = 0, exprs = 0;
  for (const id of mineIds) {
    for (const kind of ["content_unit", "expression"]) {
      const items = await allOf(kind, "&work_id=" + id);
      for (const e of items) camp.index.add(e);
      if (kind === "content_unit") units += items.length; else exprs += items.length;
    }
  }
  const myCat = new Set(WORKS.flatMap((w) => w.rels.map((r) => r.attrs.catalog_number)));
  const releases = (await allOf("release")).filter((x) => myCat.has((x.attributes || {}).catalog_number));
  for (const x of releases) camp.index.add(x);
  camp.index.rows = camp.index.rows.filter((x) => !(x.kind === "release" && myCat.has((x.attributes || {}).catalog_number) && !releases.some((r) => r.id === x.id)));
  let mediums = 0, tracks = 0;
  for (const rel of releases) {
    const ms = await allOf("medium", "&release_id=" + rel.id);
    for (const m of ms) { camp.index.add(m); const ts = await allOf("track", "&medium_id=" + m.id); for (const t of ts) camp.index.add(t); tracks += ts.length; }
    mediums += ms.length;
  }
  console.log("结构作用域预载：Work " + mineIds.size + " / 篇目 " + units + " / 表达 " + exprs + " / 发行 " + releases.length + " / 载体 " + mediums + " / 曲目 " + tracks + "（索引 " + camp.index.rows.length + " 行）");
}

const put = (k, e) => { ID[k] = e.id; return e; };
const missing = [];

console.log("=== 1/6 agent（15 个）===");
for (const a of AGENTS) {
  const e = await camp.ensureEntity("agent", a.title, {
    original_language: a.lang, types: [a.type], translations: a.names, attributes: {}, external_ids: a.ext,
  }, { note: NOTE(a.what), sources: a.s }, { idemKey: "classical-opus-agent-" + a.key });
  put("agent:" + a.key, e);
}

console.log("=== 2/6 work（5 部）===");
for (const w of WORKS) {
  const e = await camp.ensureEntity("work", w.title, {
    original_language: w.lang, types: [w.type], translations: w.names, attributes: w.attrs, external_ids: w.ext,
  }, { note: NOTE(w.what), sources: w.s }, { idemKey: "classical-opus-work-" + w.key });
  put("work:" + w.key, e);
}

console.log("=== 2.5/6 collection（" + COLLECTIONS.length + " 个：套曲/系列聚合枢纽）===");
for (const c of COLLECTIONS) {
  const e = await camp.ensureEntity("collection", c.title, {
    original_language: c.lang, types: ["collection"], translations: c.names,
    attributes: { language: c.lang }, external_ids: c.ext,
  }, { note: NOTE(c.what), sources: c.s }, { idemKey: "classical-opus-collection-" + c.key });
  put("collection:" + c.key, e);
}

console.log("=== 3/6 content_unit（10 个：乐章 / 协奏曲）===");
for (const w of WORKS) {
  const wid = ID["work:" + w.key];
  const ev = { note: NOTE(w.what + " 的乐章目录：number 保留官方罗马数字/序数，position 为顺序"), sources: w.s };
  let pos = 0;
  for (const u of w.units) {
    pos += 1;
    const e = await camp.ensureEntity("content_unit", u.names["en-US"].title, {
      work_id: wid, position: pos, number: u.number, original_language: "zxx", types: ["content_unit"],
      translations: u.names, attributes: { language: "zxx", entry_role: "main" }, external_ids: {},
    }, ev, { idemKey: "classical-opus-unit-" + u.key, scope: { work_id: wid }, allowServerLookup: false });
    put("unit:" + u.key, e);
  }
}

// 录音表达/曲目的四语题名与归属解析（dry-run 与真跑一致，不依赖回读）
// 注意：number（I/II/1/2）在多个 Work 间重复，因此解析必须限定在同一个 Work 内
const exprPlanByKey = (w, k) => {
  // 先在本 Work 内找；跨作品收录（如 Dvořák 发行里的 Smetana 曲目）再全局找
  const hit = w.exprs.find((x) => x.key === k) || WORKS.flatMap((x) => x.exprs).find((x) => x.key === k);
  if (!hit) throw new Error("work " + w.key + " 找不到 expression 计划：" + k);
  const owner = WORKS.find((x) => x.exprs.some((y) => y.key === k));
  return Object.assign({}, hit, { ownerWork: owner.key });
};
const unitByNumber = (w, n) => {
  const hit = w.units.find((u) => u.number === n);
  if (!hit) throw new Error("work " + w.key + " 找不到篇目 number：" + n);
  return hit;
};
const exprNames = (u, x) => tr(
  u.names["zh-CN"].title + "（" + x.short + "）",
  u.names["zh-TW"].title + "（" + x.short + "）",
  u.names["ja-JP"].title + "（" + x.shortJa + "）",
  u.names["en-US"].title + " (" + x.short + ")");

console.log("=== 4/6 expression（11 个：每条 = 一次具体录音的一个乐章/协奏曲）===");
for (const w of WORKS) {
  for (const x of w.exprs) {
    if (x.defer) continue; // Vltava 的表达由 5.5 步骤按跨作品发行的口径建
    // x.unit 是篇目的 number（I / II / 1 / 2 …），与 content_unit 的稳定 key 对应
    const u = unitByNumber(w, x.unit);
    const e = await camp.ensureEntity("expression", w.title + " — " + u.names["en-US"].title + " (" + x.short + ")", {
      work_id: ID["work:" + w.key], content_unit_id: ID["unit:" + u.key], position: 1,
      original_language: "zxx", types: ["expression"],
      translations: exprNames(u, x),
      attributes: { language: "zxx", duration: x.dur, version_label: x.label }, external_ids: {},
    }, { note: NOTE("expression：" + x.short + " 的" + u.names["zh-CN"].title + "录音（" + x.label + "）"), sources: x.s },
      { idemKey: "classical-opus-expr-" + x.key, allowServerLookup: false });
    put("expr:" + x.key, e);
  }
}

console.log("=== 5.5/6 Vltava（斯美塔那）：跨作品发行里的那次录音 ===");
// 必须在发布前就位（rel-k85d 的 subjects 同时声明 dvorak9 与 vltava）；表达挂在 vltava 自己的篇目下。
{
  const w = WORKS.find((x) => x.key === "vltava");
  const x = w.exprs[0];
  const u = unitByNumber(w, x.unit);
  if (!ID["unit:" + u.key]) {
    const ue = await camp.ensureEntity("content_unit", u.names["en-US"].title, {
      work_id: ID["work:" + w.key], position: 1, number: u.number, original_language: "zxx",
      types: ["content_unit"], translations: u.names,
      attributes: { language: "zxx", entry_role: "main" }, external_ids: {},
    }, { note: NOTE(w.what + " 的篇目：整曲一首交响诗"), sources: w.s },
      { idemKey: "classical-opus-unit-" + u.key, scope: { work_id: ID["work:" + w.key] }, allowServerLookup: false });
    put("unit:" + u.key, ue);
  }
  const e = await camp.ensureEntity("expression", w.title + " — " + u.names["en-US"].title + " (" + x.short + ")", {
    work_id: ID["work:" + w.key], content_unit_id: ID["unit:" + u.key], position: 1,
    original_language: "zxx", types: ["expression"], translations: exprNames(u, x),
    attributes: { language: "zxx", duration: x.dur, version_label: x.label }, external_ids: {},
  }, { note: NOTE("expression：" + x.short + " 的" + u.names["zh-CN"].title + "录音（" + x.label + "）"), sources: x.s },
    { idemKey: "classical-opus-expr-" + x.key, allowServerLookup: false });
  put("expr:" + x.key, e);
}

// 上一轮用旧题名建过曲目时，contents 还指向旧表达：按"曲号 + 载体"重新指向本轮表达，
// 否则幂等重放的旧曲目会把 release.subjects 校验拖回旧 Work（undeclared_release_subject）。
const repairTrackContents = async (rel, med, r) => {
  const tr = await client.call("/api/catalog/entities?kind=track&medium_id=" + med.id + "&limit=100");
  const existing = (tr.body && tr.body.items) || [];
  let fixed = 0;
  for (const t of r.tracks) {
    const want = ID["expr:" + t.exp];
    // 同一个曲号下可能同时存在"旧题名曲目"和"新题名曲目"，两条都要重指，否则旧曲目会把
    // release.subjects 校验拖回旧 Work（undeclared_release_subject）
    const hits = existing.filter((x) => String(x.number) === String(t.no));
    for (const hit of hits) {
      const cur = (hit.contents || [])[0];
      if (cur && cur.expression_id === want) continue;
      await camp.updateEntity(hit.id, { contents: [{ expression_id: want, position: 1, locator: {} }] },
        { note: NOTE("修复：把发行「" + r.title + "」第 " + t.no + " 曲(" + hit.title + ")的 contents 重新指向本轮表达"), sources: t.s });
      fixed++;
    }
  }
  return fixed;
};

// expression key → 它所属 Work 的实体 id（跨作品收录时用得上）
const EXPR_WORK_BY_KEY_AT_WRITE = (k) => {
  for (const w of WORKS) if (w.exprs.some((x) => x.key === k)) return ID["work:" + w.key];
  return null;
};

console.log("=== 5/6 release / medium / track ===");
for (const w of WORKS) {
  for (const r of w.rels) {
    const ev = { note: NOTE(r.what), sources: r.s };
    const subjects = r.subjects.map((s, i) => ({
      work_id: ID["work:" + s.work], role: s.role, position: s.position === undefined ? i : s.position,
    }));
    let rel = null;
    const hitIdx = camp.index.rows.find((x) => x.kind === "release" && x.title === r.title && x.attributes && x.attributes.catalog_number === r.attrs.catalog_number);
    if (hitIdx) {
      const full = await camp.getEntity(hitIdx.id);
      if ((full.attributes || {}).catalog_number === r.attrs.catalog_number) {
        rel = full; camp.reused.entity++;
        camp.log({ op: "entity", status: "reuse", kind: "release", title: r.title, id: full.id });
      }
    }
    if (!rel) {
      // 本地索引只是快照，可能没有本次之前的运行结果：用服务端精确检索 + 品番复核，避免把
      // 同题发行（不同指挥/厂牌）误判成同一个。
      const found = (await client.search("release", r.title)).find((x) =>
        (x.attributes || {}).catalog_number === r.attrs.catalog_number || x.title === r.title);
      if (found) {
        rel = found; camp.reused.entity++;
        camp.index.add(found);
        camp.log({ op: "entity", status: "reuse-server", kind: "release", title: r.title, id: found.id });
      }
    }
    if (!rel) {
      // publisher_agent 只是计划表里的内部字段名，落库键必须是 definitions 声明的 publisher（agent 实体 id）
      const attrs = {};
      for (const [k, v] of Object.entries(r.attrs)) {
        if (k === "publisher_agent") { attrs.publisher = ID["agent:" + v]; continue; }
        attrs[k] = v;
      }
      rel = await camp.ensureEntity("release", r.title, {
        original_language: "zxx", types: ["release"], translations: r.names, attributes: attrs,
        external_ids: {}, subjects,
      }, ev, { idemKey: "classical-opus-release-" + r.key, allowServerLookup: false });
    }
    // 无论复用还是刚建：核对 subjects 是否覆盖本次要收录的全部 Work，缺了就补
    // （幂等重放会原样返回首条结果，subjects 可能还是上一轮的口径）。
    {
      // 先修旧曲目的 contents，再核对 subjects：顺序反了会被 undeclared_release_subject 拒
      const medForRepair = camp.index.find("medium", r.medium.title, { release_id: rel.id });
      if (medForRepair) { const n = await repairTrackContents(rel, medForRepair, r); if (n) console.log("  曲目 contents 重指 " + n + " 条（" + r.title + "）"); }
      const declared = new Set(((rel.subjects || []).map((s) => s.work_id)));
      // 本次轨条实际收录到的 Work（跨作品发行里可能是别部作品的表达）
      const usedWorks = new Set(r.tracks.map((t) => EXPR_WORK_BY_KEY_AT_WRITE(t.exp)).filter(Boolean));
      const need = subjects.filter((s) => !declared.has(s.work_id));
      // 只在"旧 subject 既不在计划里、也不被本次轨条收录"时才丢弃
      const wantedWorkIds = new Set(subjects.map((s) => s.work_id).concat([...usedWorks]));
      const stale = [...declared].filter((wor) => !wantedWorkIds.has(wor));
      if (need.length || stale.length) {
        const merged = subjects.slice(); // 重写为计划表的口径（跨作品收录已按 usedWorks 保留）
        rel = await camp.updateEntity(rel.id, { subjects: merged },
          { note: NOTE("补声明发行「" + r.title + "」的 subjects：把本次实际收录的 Work 全部声明（服务端 undeclared_release_subject 校验要求）"), sources: r.s });
        camp.log({ op: "entity-update", status: "updated", kind: "release", title: r.title, id: rel.id, code: "subjects+" + need.length });
      }
    }
    put("release:" + r.key, rel);

    let med = null;
    const mh = camp.index.find("medium", r.medium.title, { release_id: rel.id });
    if (mh) { med = mh; camp.reused.entity++; camp.log({ op: "entity", status: "reuse", kind: "medium", title: r.medium.title, id: mh.id }); }
    else {
      med = await camp.ensureEntity("medium", r.medium.title, {
        release_id: rel.id, position: 1, original_language: "zxx", types: ["medium"],
        translations: tr("CD（1 碟）", "CD（1 碟）", "CD（1枚）", "CD (1 disc)"),
        attributes: { format: r.medium.format, role: "primary" }, external_ids: {},
      }, { note: NOTE(r.what + " 的载体：1 张 CD（官方 1 碟装）"), sources: r.medium.s },
        { idemKey: "classical-opus-medium-" + r.medium.key, scope: { release_id: rel.id }, allowServerLookup: false });
    }
    put("medium:" + r.key, med);

    for (const t of r.tracks) {
      const eid = ID["expr:" + t.exp];
      if (!eid) throw new Error("track 计划引用了不存在的 expression key：" + t.exp);
      // dry-run 时实体不存在（id 是占位符），曲目题名一律用计划表构造，真跑与空跑一致
      const exPlan = exprPlanByKey(w, t.exp);
      // 跨作品收录时（Dvořák 发行里的 Smetana 曲目），篇目要在 expression 所属 Work 内解析
      const cuUnit = unitByNumber(WORKS.find((x) => x.key === exPlan.ownerWork), exPlan.unit);
      const title = cuUnit.names["en-US"].title + " — " + exPlan.short;
      const trackNames = exprNames(cuUnit, exPlan);
      const th = camp.index.find("track", title, { medium_id: med.id });
      if (th) { camp.reused.entity++; camp.log({ op: "entity", status: "reuse", kind: "track", title, id: th.id }); put("track:" + t.key, th); continue; }
      const e = await camp.ensureEntity("track", title, {
        medium_id: med.id, position: Number(t.no), number: t.no, original_language: "zxx", types: ["track"],
        translations: trackNames, attributes: { duration: t.dur },
        contents: [{ expression_id: eid, position: 1, locator: {} }], external_ids: {},
      }, { note: NOTE(r.what + " 第 " + t.no + " 曲 → 收录 " + title + "（整轨收录，locator 为空）"), sources: t.s },
        { idemKey: "classical-opus-track-" + t.key, scope: { medium_id: med.id }, allowServerLookup: false });
      put("track:" + t.key, e);
    }
  }
}

// ── 归属自愈 ────────────────────────────────────────────────────────────────
// 同一题名（如两部"Symphony No. 5"）在服务端可能被幂等缓存/同名判定收敛到同一实体 ID，
// 导致后来者的篇目与表达挂到别人的 Work 下。这里按计划把 work_id / content_unit_id 纠回来：
// 只动本次新建的实体（索引命中即视为本次范围），不改别人的条目。
const fetchUnitId = async (workKey, number) => {
  const wid = ID["work:" + workKey];
  const title = unitByNumber(WORKS.find((x) => x.key === workKey), number).names["en-US"].title;
  const r = await client.call("/api/catalog/entities?kind=content_unit&work_id=" + wid + "&q=" + encodeURIComponent(title) + "&limit=50");
  const hit = ((r.body && r.body.items) || []).find((x) => x.title === title);
  if (!hit) throw new Error("归属自愈：找不到篇目 " + workKey + " / " + title + "（work_id=" + wid + "）");
  return hit.id;
};
const fetchWorkIdOf = async (entity) => {
  if (entity.kind !== "expression") return entity.work_id;
  const r = await client.call("/api/catalog/entities/" + entity.id);
  return (r.body && r.body.work_id) || "";
};
{
  let fixedUnits = 0, fixedExprs = 0;
  for (const w of WORKS) {
    for (const u of w.units) {
      const eid = ID["unit:" + u.key];
      const cur = await camp.getEntity(eid);
      if (cur.work_id !== ID["work:" + w.key] || cur.parent_id) {
        await camp.updateEntity(eid, { work_id: ID["work:" + w.key], parent_id: "" },
          { note: NOTE("归属自愈：把篇目「" + cur.title + "」归回work「" + w.names["zh-CN"].title + "」（幂等重放可能把它落到同名的另一部作品下）"), sources: w.s });
        fixedUnits++;
      }
    }
  }
  for (const w of WORKS) {
    for (const x of w.exprs) {
      const eid = ID["expr:" + x.key];
      const cur = await camp.getEntity(eid);
      const wantWork = ID["work:" + w.key];
      const wantUnit = await fetchUnitId(w.key, x.unit);
      if (cur.work_id !== wantWork || cur.content_unit_id !== wantUnit) {
        await camp.updateEntity(eid, { work_id: wantWork, content_unit_id: wantUnit },
          { note: NOTE("归属自愈：把录音表达「" + cur.title + "」归回 " + w.names["zh-CN"].title + " / " + x.unit + "（幂等重放可能把它落到同名的另一部作品下）"), sources: x.s });
        fixedExprs++;
      }
    }
  }
  console.log("归属自愈：篇目 " + fixedUnits + " 个、表达 " + fixedExprs + " 个已按计划归位");
  }
const RELS = [];
const seen = new Set();
const addRel = (type, from, to, attrs, ev) => {
  const sig = [type, from, to].join("|");
  if (seen.has(sig)) return;
  seen.add(sig);
  RELS.push({ type, from, to, attrs, ev });
};
const workOf = (k) => WORKS.find((w) => w.key === k);
const exprShort = (k) => { for (const w of WORKS) { const x = w.exprs.find((e) => e.key === k); if (x) return { work: w, expr: x }; } return null; };

// composed_by：work → 作曲家（BRIEF 关系重点）
for (const [wk, ak] of [["beethoven5", "beethoven"], ["dvorak9", "dvorak"], ["mahler5", "mahler"],
                        ["vltava", "smetana"], ["spring", "vivaldi"]]) {
  const w = workOf(wk);
  addRel("composed_by", "work:" + wk, "agent:" + ak, { credit_role: "作曲" },
    { note: NOTE("关系 composed_by：作曲家 → 「" + w.names["zh-CN"].title + "」（credit_role=作曲）"), sources: w.s });
}

// performed_by：录音 → 指挥 / 演奏乐团
const PERF = [
  { exp: "e-k62-1", conductor: "karajan", orchestra: "bpo", s: [S.mbKarajan56] },
  { exp: "e-kl75-1", conductor: "kleiber", orchestra: "vpo", s: [S.mbKleiber57] },
  { exp: "e-k85d-1", conductor: "karajan", orchestra: "vpo", s: [S.mbDvorak] },
  { exp: "e-k85v-1", conductor: "karajan", orchestra: "vpo", s: [S.mbDvorak, S.itDvorak] },
  { exp: "e-b87-1", conductor: "bernstein", orchestra: "vpo", s: [S.mbMahler5] },
  { exp: "e-p82-1", conductor: "pinnock", orchestra: "englishconcert", s: [S.mbVivaldi4s] },
];
for (const q of PERF) {
  const hit = exprShort(q.exp);
  const who = q.conductor === "pinnock" ? "指挥（兼大键琴）" : "指挥";
  addRel("performed_by", "expr:" + q.exp, "agent:" + q.conductor, { credit_role: who },
    { note: NOTE("关系 performed_by：录音「" + hit.expr.short + "」→ " + who + " " + hit.expr.short + "（" + hit.work.names["zh-CN"].title + "）"), sources: q.s });
  addRel("performed_by", "expr:" + q.exp, "agent:" + q.orchestra, { credit_role: "演奏乐团" },
    { note: NOTE("关系 performed_by：录音「" + hit.expr.short + "」→ 演奏乐团（" + hit.work.names["zh-CN"].title + "）"), sources: q.s });
}

// performed_by：release → 发行厂牌（organization agent，同时填在 release.attributes.publisher）
for (const w of WORKS) for (const r of w.rels) {
  addRel("performed_by", "release:" + r.key, "agent:" + r.attrs.publisher_agent, { credit_role: "发行厂牌" },
    { note: NOTE("关系 performed_by：发行版「" + r.title + "」→ 发行厂牌（credit_role=发行厂牌；同一 agent 也写在 release.attributes.publisher）"), sources: r.s });
}

// includes：collection → work（《四季》套曲聚合各协奏曲 Work；两端只允许 work/collection，
// 因此协奏曲必须是独立 work，不能写成别部作品下的 content_unit）
for (const c of COLLECTIONS) {
  for (const wk of c.includes) {
    addRel("includes", "collection:" + c.key, "work:" + wk, { role: "primary" },
      { note: NOTE("关系 includes：「" + c.names["zh-CN"].title + "」→ " + workOf(wk).names["zh-CN"].title + "（套曲聚合协奏曲 Work）"), sources: c.s });
  }
}

// member_of：指挥 → 乐团（BRIEF 关系重点；acyclic，方向为“指挥属于乐团”）
addRel("member_of", "agent:karajan", "agent:vpo", { begin_date: "1934", end_date: "1938" },
  { note: NOTE("关系 member_of：卡拉扬 → 维也纳爱乐（1934–1938 年任该团客席指挥，属长期合作/所属关系）"),
    sources: [wd("Q154895", "Wikidata Q154895（Herbert von Karajan）记录其与维也纳爱乐的长期合作：1934–1938 年客席指挥")] });
addRel("member_of", "agent:karajan", "agent:bpo", { begin_date: "1955", end_date: "1989" },
  { note: NOTE("关系 member_of：卡拉扬 → 柏林爱乐（1955–1989 年首席指挥）"),
    sources: [wd("Q152222", "Wikidata Q152222（Berliner Philharmoniker）记录其 1955–1989 年首席指挥为 Herbert von Karajan")] });
addRel("member_of", "agent:bernstein", "agent:vpo", {},
  { note: NOTE("关系 member_of：伯恩斯坦 → 维也纳爱乐（长期合作指挥，1987 年法兰克福现场即与该团合作）"),
    sources: [wd("Q152505", "Wikidata Q152505（Leonard Bernstein）记录其与维也纳爱乐的合作"), S.mbMahler5] });

// character_in：虚构角色 → work（协奏曲标题以季节为题）
addRel("character_in", "agent:spring", "work:spring", { character_rank: "supporting" },
  { note: NOTE("关系 character_in：角色「春」→ 维瓦尔第《春》（character_rank=supporting，协奏曲标题即季节拟人题名）"), sources: [S.wikiQuattro] });

for (const r of RELS) {
  await camp.createRelation(r.type, ID[r.from], ID[r.to], r.ev, { attributes: r.attrs });
}

// ── 计划量 ──────────────────────────────────────────────────────────────────
const R = WORKS.reduce((n, w) => n + w.rels.length, 0);
const plan = {
  agents: AGENTS.length,
  collections: COLLECTIONS.length,
  works: WORKS.length,
  content_units: WORKS.reduce((n, w) => n + w.units.reduce((m, u) => m + 1 + (u.children ? u.children.length : 0), 0), 0),
  expressions: WORKS.reduce((n, w) => n + w.exprs.length, 0), // 含 Vltava 那条（由 5.5 步骤建，算在同一个 Work 下）
  releases: R,
  mediums: R,
  tracks: WORKS.reduce((n, w) => n + w.rels.reduce((m, r) => m + r.tracks.length, 0), 0),
  relations: RELS.length,
};
plan.total_new_entities = plan.agents + plan.collections + plan.works + plan.content_units + plan.expressions + plan.releases + plan.mediums + plan.tracks;
if (plan.total_new_entities !== Object.keys(ID).length) {
  console.log("计划实体键 " + Object.keys(ID).length + " 个 / plan 计数 " + plan.total_new_entities + " 个（按 ID 集合为准）");
}

// ── 写后回读断言 ────────────────────────────────────────────────────────────
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: !!ok, detail: String(detail) });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
};

if (DRY) {
  console.log("\n[dry-run] 计划量：" + JSON.stringify(plan) + "（未写入实例，跳过回读断言）");
  camp.summary({ plan, note: "dry-run：仅打印计划，未写库、未回读" });
} else {
  const back = {};
  for (const [k, id] of Object.entries(ID)) back[k] = await camp.getEntity(id);
  const EXPR_OWNER = {}; const UNIT_KEY_BY_WORK_NUMBER = {}; for (const w of WORKS) { for (const u of w.units) UNIT_KEY_BY_WORK_NUMBER[w.key + "#" + u.number] = u.key; for (const x of w.exprs) EXPR_OWNER[x.key] = w.key; } const byIdEver = new Map(); for (const id of new Set(Object.values(ID))) { const rr = await client.call("/api/catalog/entities/" + id); if (rr.status === 200 && rr.body) byIdEver.set(id, rr.body); }

  // A 结构归属：篇目 → work；表达 → work/content_unit；载体 → release；曲目 → medium
  let badScope = [];
  for (const w of WORKS) {
    for (const u of w.units) {
      const e = back["unit:" + u.key];
      if (!e || e.work_id !== ID["work:" + w.key]) badScope.push("content_unit " + u.key);
    }
    for (const x of w.exprs) {
      const e = back["expr:" + x.key];
      if (!e) { badScope.push("expression " + x.key + " 缺失"); continue; }
      const owner = EXPR_OWNER[x.key]; if (e.work_id !== ID["work:" + owner]) badScope.push("expression " + x.key + " work_id 不符（应为 " + owner + "）");
      if (e.content_unit_id !== ID["unit:" + UNIT_KEY_BY_WORK_NUMBER[owner + "#" + x.unit]]) badScope.push("expression " + x.key + " content_unit_id 不符");
      if (e.parent_id) badScope.push("expression " + x.key + " 不应有 parent_id");
    }
    for (const r of w.rels) {
      const rel = back["release:" + r.key];
      if (rel.work_id) badScope.push("release " + r.key + " 不应有 work_id");
      const med = back["medium:" + r.key];
      if (!med || med.release_id !== rel.id) badScope.push("medium " + r.key + " release_id 不符");
      for (const t of r.tracks) {
        const tk = back["track:" + t.key];
        if (!tk) { badScope.push("track " + t.key + " 缺失"); continue; }
        if (tk.medium_id !== med.id) badScope.push("track " + t.key + " medium_id 不符");
        if (tk.parent_id) badScope.push("track " + t.key + " 不应有 parent_id");
        const c = (tk.contents || [])[0];
        if (!c || c.expression_id !== ID["expr:" + t.exp]) badScope.push("track " + t.key + " contents 未指向 " + t.exp); // t.exp 跨作品时是别部 Work 下的表达，ID 台账已全局索引
      }
    }
  }
  check("A 结构归属（content_unit.work_id / expression.work_id+content_unit_id / medium.release_id / track.medium_id / contents 指向）", badScope.length === 0, badScope.join("; ") || "全部一致");

  // B 每个 release 的 subjects 覆盖其 Track contents 引用的全部 Work
  let badSubj = [];
  const subjectReport = [];
  for (const w of WORKS) for (const r of w.rels) {
    const rel = back["release:" + r.key];
    const declared = new Set((rel.subjects || []).map((s) => s.work_id));
    const used = new Set();
    for (const t of r.tracks) {
      const expr = back["expr:" + t.exp];
      if (expr.work_id) used.add(expr.work_id);
    }
    const missing2 = [...used].filter((x) => !declared.has(x));
    if (missing2.length) badSubj.push(r.key + " 未声明 " + missing2.join(","));
    subjectReport.push(r.key + " subjects=" + [...declared].length + " / contents 引用 Work=" + used.size);
  }
  check("B release.subjects 覆盖全部 contents 引用的 Work", badSubj.length === 0, badSubj.join("; ") || subjectReport.join(" | "));
  const multi = subjectReport.filter((x) => x.includes("contents 引用 Work=2"));
  check("B2 至少一个跨作品发行（subjects 含 2 部 Work）", multi.length >= 1, multi.join("; "));

  // C 关系两端与条数
  let relBack = [], badRel = [];
  const wanted = RELS.map((r) => r.type + "|" + ID[r.from] + "|" + ID[r.to]);
  const allRels = new Map();
  for (const [, id] of Object.entries(ID)) {
    const rs = await client.relationsOf(id);
    for (const x of rs) if (!x.via) allRels.set(x.id, x);
  }
  relBack = [...allRels.values()];
  const have = new Set(relBack.map((x) => x.type + "|" + x.source_id + "|" + x.target_id));
  for (const w of wanted) if (!have.has(w)) badRel.push("缺 " + w.split("|")[0]);
  // 端点必须是活体实体。注意：本轮把早期建模（两部同名 Symphony 收敛成同一 Work、Vivaldi《四季》
  // 拆成两首协奏曲 Work）留下的旧端点停用后，指向它们的旧边**删不掉**（DELETE 返回 403 forbidden），
  // 因此这里把"端点已停用的遗留边"与"本次新增边"分开统计：本次边必须全绿，遗留边只计数上报。
  const legacyEdges = [];
  for (const x of relBack) {
    if (x.source_id === x.target_id) badRel.push("自环 " + x.type);
    const deadEnds = [];
    for (const [end, id] of [["source", x.source_id], ["target", x.target_id]]) {
      const e = byIdEver.get(id);
      if (!e) deadEnds.push(end);
      else if (e.status === "deleted" || e.status === "merged") deadEnds.push(end + "(已停用)");
    }
    if (!deadEnds.length) continue;
    const planned = wanted.includes(x.type + "|" + x.source_id + "|" + x.target_id);
    if (planned) badRel.push(x.type + " 的 " + deadEnds.join("/") + " 端点不是活体");
    else legacyEdges.push(x.type + " " + x.source_id.slice(0, 8) + "→" + x.target_id.slice(0, 8) + "（" + deadEnds.join("/") + "）");
  }
  check("C 计划内的关系两端均为活体实体（无自环）", badRel.length === 0,
    badRel.join("; ") || ("回读 " + relBack.length + " 条，计划内 " + RELS.length + " 条全部命中且端点活体"
      + (legacyEdges.length ? "；另有 " + legacyEdges.length + " 条早期运行遗留边指向已停用端点（DELETE 返回 403 forbidden，删不掉，见报告缺口清单）" : "")));
  check("C1 关系条数达到 BRIEF 要求的 12–30", RELS.length >= 12 && RELS.length <= 30, "计划 " + RELS.length + " 条");

  // D revisions：每个新增实体至少 1 条修订记录
  let noRev = [], revCount = 0;
  for (const [k, id] of Object.entries(ID)) {
    const rv = await client.call("/api/catalog/entities/" + id + "/revisions");
    const items = (rv.body && rv.body.items) || [];
    revCount += items.length;
    if (!items.length) noRev.push(k);
    const fresh = await camp.getEntity(id);
    if (!fresh.version || fresh.version < 1) noRev.push(k + "(version)");
  }
  check("D revisions / version 回读（每个新增实体 >=1 条修订）", noRev.length === 0,
    noRev.join("; ") || ("实体 " + Object.keys(ID).length + " 个，修订合计 " + revCount + " 条"));

  // E 实体量级 30–70
  const createdTotal = camp.created.entity;
  // 重跑时全部命中复用，所以量级按"本次计划要建的实体数"判定（空跑即可预检），并附本次新增/复用数
  check("E 计划实体量级 30–70", plan.total_new_entities >= 30 && plan.total_new_entities <= 70,
    "计划 " + plan.total_new_entities + " 个（本次新建 " + createdTotal + " / 复用 " + camp.reused.entity + "）");
  check("E1 脚本内 ID 台账数量与计划一致", Object.keys(ID).length === plan.total_new_entities,
    Object.keys(ID).length + " 个 ID（plan.total_new_entities=" + plan.total_new_entities + "）");
  check("F 失败数为 0", camp.failed.length === 0, JSON.stringify(camp.failed).slice(0, 300));

  const failed = checks.filter((c) => !c.ok);
  console.log("\n回读断言：" + (checks.length - failed.length) + "/" + checks.length + " 通过");
  if (failed.length) console.log("失败断言：" + failed.map((f) => f.name).join(" / "));
  camp.summary({ plan, checks, createdTotal });
  if (failed.length) process.exitCode = 1;
}
