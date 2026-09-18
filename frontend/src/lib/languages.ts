import data from "./languages.data.json";

/**
 * 语言单一来源（Single Source of Truth）。
 *
 * 仓库里语种清单原本散落在至少 7 处（localeForm.ts / DynamicNamesEditor / catalog/Fields /
 * TitleDisplayOrderSetting / lib/titles 的 LOCALE_ORDER / LocaleSwitcher / i18n/routing），
 * 而且写法不一致（ja 与 ja-JP 混用）。这里收录一份完整语言表，其余各处只准引用它：
 * 候选、标签、等价写法、回退链顺序都由这里派生，不再各自维护常量。
 *
 * 数据来自 ./languages.data.json（生成物，随代码提交，运行时只读、不联网、不调 Intl）。
 * 重新生成：bun run langs:build；校验是否同步：bun run langs:check。
 *
 * ## 没有白名单
 *
 * 本模块是"选择器的候选来源"，不是"允许写入的语种白名单"。任何合法 BCP-47 代码都能入库：
 * 后端 validation.go 用 golang.org/x/text/language.Parse 只做格式校验（validateNameLocales /
 * validateEntityContent 都是 Parse 失败才报 invalid_locale），没有语种枚举；前端写入路径
 * （实体 translations 的 locale、标题显示优先级）同样不筛语种。因此校验一律用
 * isValidLanguageCode()（只看格式合法性），禁止用 LANGUAGES 的成员资格当校验 —— 那会把
 * 表外的合法语种挡在门外。
 *
 * ## ja 与 ja-JP：同一语言的两种写法，只在「取哪张表」上有区别
 *
 * 两者是同一种语言，不是两个语种。项目里之所以出现分叉，只是因为两张表用了不同的键：
 *
 * - 界面语言（messages/*.json 字典、NEXT_LOCALE cookie、html lang、i18n/routing 的 Locale）
 *   固定写作 ja-JP —— 字典文件名就是 ja-JP.json。
 * - 编目内容（实体 translations 的 locale 键、original_language、definitions 的多语言名称键）
 *   写作 ja；后端 validation.go 对日语单独判定（requiredNameLocales 里不含 ja，
 *   但 "ja 与 ja-JP 有其一非空" 即通过），所以存量数据里两种键都存在。
 *
 * 新代码照下面三条来，不要再分叉：
 *
 * 1. 读内容不区分写法：任何按 locale 取值的代码都必须两种都认，用 languageAliases() /
 *    equivalentLanguageCodes() / sameLanguage()，不要自己写 if (loc === "ja")。
 * 2. 写内容用 canonicalLanguageCode()：日语规范码是 ja-JP（与四语字典同键）。写 ja 后端
 *    也不会拒（只校验格式），但会让同一语言在同一实体上出现两个键，四语分组与标题回退链
 *    都得靠别名兜底 —— 自找麻烦。
 * 3. 只有「用字/正字确有差异」的语种才拆成两个条目：zh-CN 与 zh-TW（简体/繁体不是同一
 *    书写形式）、pt 与 pt-BR。en-US 与 en-GB 这类拼写差异在本项目按同一语言处理
 *    （en-GB 由语言子标签前缀回退解析成 en-US）。其余地区变体（fr-CA、de-CH、es-AR…）
 *    一律走前缀回退，不逐个建条目，避免语言表被变体淹没。
 */

export interface LanguageEntry {
  /** 规范码：写入侧优先使用它（界面四语与字典、后端四语铁律同键）。 */
  code: string;
  /** 自称（native name），列表首选展示项。 */
  native: string;
  /** 英文名，供英文检索使用。 */
  en: string;
  /** 简体中文名（CLDR zh-CN）：中文界面用户搜「威尔士」不必先知道代码。 */
  nameZh?: string;
  /** 日文名（CLDR ja-JP）。 */
  nameJa?: string;
  /** 同一语言的等价写法（不含自身）；与 code 双向等价。 */
  aliases?: string[];
  /** 本仓库是否提供该语种的界面字典（仅界面四语）。 */
  ui?: boolean;
  /** 是否进快捷 chip（常用语种）。 */
  popular?: boolean;
  /** 是否带地区书写差异的变体条目（zh-CN / zh-TW / pt-BR）。 */
  regional?: boolean;
}

export const LANGUAGES: readonly LanguageEntry[] = data.languages as readonly LanguageEntry[];

/** 界面四语：字典、NEXT_LOCALE cookie、html lang 用它；i18n/routing 的 locales 由它派生。 */
export const UI_LOCALE_CODES = ["zh-CN", "zh-TW", "ja-JP", "en-US"] as const;
export type UiLocale = (typeof UI_LOCALE_CODES)[number];

/** 命名四语铁律里的必填语种（日语在后端是 "ja 或 ja-JP 有其一即可"，见模块头注释）。 */
export const REQUIRED_NAME_LOCALES = ["zh-CN", "zh-TW", "en-US"] as const;

/** 名称类数据的核心语种：词典/货架/外部库的四语齐备校验按它取键。 */
export const CORE_LOCALE_CODES = ["zh-CN", "zh-TW", "ja-JP", "en-US"] as const;

/** 快捷 chip 的语种：一点即得，顺序即展示顺序。 */
export const QUICK_LOCALE_CODES = [
  "zh-CN",
  "zh-TW",
  "ja-JP",
  "en-US",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "it",
  "ru",
  "th",
  "vi",
] as const;

/** 默认标题/简介回退链顺序（未设用户优先级时用它）；languageRank 由它定位。 */
export const DEFAULT_TITLE_LOCALE_ORDER = ["zh-CN", "zh-TW", "ja-JP", "en-US", "ko"] as const;

/** 查询/比较用的归一键：去空白、小写、下划线当连字符（zh_CN 与 zh-CN 同一条目）。 */
function lookupKey(input: string): string {
  return String(input ?? "").trim().replace(/_/g, "-").toLowerCase();
}

const BY_CODE = new Map<string, LanguageEntry>();
const BY_ALIAS = new Map<string, string>();
const EQUIVALENTS = new Map<string, string[]>();

/** 按 lookupKey 去重后追加：ja 与 JA 这类大小写变体不能重复入队。 */
function pushUnique(list: string[], value: string): void {
  const key = lookupKey(value);
  if (!key) return;
  for (const existing of list) {
    if (lookupKey(existing) === key) return;
  }
  list.push(value);
}

for (const entry of LANGUAGES) {
  BY_CODE.set(lookupKey(entry.code), entry);
}
// 别名表的取值统一存 lookupKey（小写、下划线归连字符）：查表时两边口径不一致会把
// ja-JP 这种带大写的代码查空，进而掉进前缀回退，解析成完全无关的语种。
for (const entry of LANGUAGES) {
  for (const alias of entry.aliases || []) {
    BY_ALIAS.set(lookupKey(alias), lookupKey(entry.code));
  }
}
// 等价写法双向展开：写 if (loc === "ja") 的地方换成它，ja / ja-JP 两个方向都要通。
for (const entry of LANGUAGES) {
  const aliases = entry.aliases || [];
  const equiv: string[] = [];
  for (const alias of aliases) {
    pushUnique(equiv, alias);
    // 反向：别的条目的规范码恰好是本条目的别名写法时，也要能回指本条目。
    for (const other of LANGUAGES) {
      if (lookupKey(other.code) === lookupKey(alias)) pushUnique(equiv, other.code);
    }
  }
  if (equiv.length) EQUIVALENTS.set(lookupKey(entry.code), equiv);
  // 别名也登记一份，保证等价关系对称。
  for (const alias of aliases) {
    const key = lookupKey(alias);
    if (!key) continue;
    const rev: string[] = [];
    for (const v of EQUIVALENTS.get(key) || []) pushUnique(rev, v);
    pushUnique(rev, entry.code);
    for (const e of LANGUAGES) {
      if (lookupKey(e.code) === key) pushUnique(rev, e.code);
    }
    EQUIVALENTS.set(key, rev);
  }
}

/**
 * 按代码/别名解析语言条目：精确 → 别名 → 子标签 → 语言子标签前缀回退。
 * 都解析不到时返回 undefined（调用方展示原始代码兜底，不能报错或留空）。
 */
export function findLanguage(code?: string | null): LanguageEntry | undefined {
  const key = lookupKey(code || "");
  if (!key) return undefined;
  const direct = BY_CODE.get(key);
  if (direct) return direct;
  const aliased = BY_ALIAS.get(key);
  if (aliased) return BY_CODE.get(aliased);
  const parts = key.split("-");
  // 用更长的前缀再查一遍别名表（从长到短，最具体的写法优先）：zh-Hant-TW 要命中 zh-Hant
  // （zh-TW），而不是退回语言子标签 zh（zh-CN）。不按单个子标签查表 —— es-AR 的 AR 会
  // 撞上 ar（阿拉伯语）条目。
  for (let i = parts.length; i > 1; i--) {
    const owner = BY_ALIAS.get(parts.slice(0, i).join("-"));
    const hit = owner ? BY_CODE.get(owner) : undefined;
    if (hit) return hit;
  }
  // 前缀回退：fr-CA → fr、es-419 → es、ko-KR → ko。只对 2–3 字母语言子标签生效，
  // 避免把垃圾串当语言。
  if (/^[a-z]{2,3}$/.test(parts[0])) {
    const owner = BY_CODE.has(parts[0]) ? parts[0] : BY_ALIAS.get(parts[0]);
    const base = owner ? BY_CODE.get(owner) : undefined;
    if (base) return base;
  }
  return undefined;
}

/** 该代码的等价写法（不含自身）；未知代码返回空数组。 */
export function languageAliases(code?: string | null): string[] {
  const key = lookupKey(code || "");
  if (!key) return [];
  return EQUIVALENTS.get(key) || [];
}

/** 该代码 + 其等价写法（本身在前），用于回退链展开；未知代码只返回自身。 */
export function equivalentLanguageCodes(code?: string | null): string[] {
  const raw = String(code ?? "").trim();
  if (!raw) return [];
  return [raw, ...languageAliases(raw).filter((a) => lookupKey(a) !== lookupKey(raw))];
}

/** 两个代码是否指向同一语言（ja 与 ja-JP、zh 与 zh-CN 都为真）。 */
export function sameLanguage(a?: string | null, b?: string | null): boolean {
  const ka = lookupKey(a || "");
  const kb = lookupKey(b || "");
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ea = findLanguage(ka);
  return !!ea && equivalentLanguageCodes(ea.code).some((c) => lookupKey(c) === kb);
}

/**
 * BCP-47 格式校验（只校验格式合法性，不校验是否在语言表内 —— 表外语种照样能入库）。
 * 形状：language(-script)?(-region)?(-variant)*(-extension)*，只覆盖语言/文字/地区/变体四段，
 * 扩展段一律接受；后端 golang.org/x/text/language.Parse 是更严的判据，前端这层只挡明显不是
 * 语言代码的输入（含空格、纯数字、空串）。
 */
export function isValidLanguageCode(input?: string | null): boolean {
  const tag = String(input ?? "").trim().replace(/_/g, "-");
  if (!tag || /\s/.test(tag)) return false;
  const parts = tag.split("-");
  if (!/^[A-Za-z]{2,8}$/.test(parts[0])) return false;
  for (const part of parts.slice(1)) {
    if (!part) return false;
    if (/^[A-Za-z]{4}$/.test(part)) continue; // script：Latn / Hant
    if (/^[A-Za-z]{2}$/.test(part)) continue; // region：US / TW
    if (/^[0-9]{3}$/.test(part)) continue; // region（数字）：419
    if (/^[A-Za-z0-9]{5,8}$/.test(part)) continue; // variant：1901 / fonipa
    if (/^[a-zA-Z0-9]$/.test(part)) continue; // 扩展单字母段
    return false;
  }
  return true;
}

/** BCP-47 规范大小写：语言小写、文字首字母大写、地区大写、其余小写。 */
function canonicalizeTag(tag: string): string {
  return tag
    .split("-")
    .map((part, i) => {
      if (i === 0) return part.toLowerCase();
      if (/^[A-Za-z]{4}$/.test(part)) return part[0].toUpperCase() + part.slice(1).toLowerCase();
      if (/^[A-Za-z]{2}$/.test(part) || /^[0-9]{3}$/.test(part)) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join("-");
}

/**
 * 语种码归一：命中语言表就走规范码（ja → ja-JP、zh_CN → zh-CN），否则保留合法的 BCP-47
 * 写法并按规范大小写整理（cy-GB 保持原样）。既不是表内语种也不是合法 BCP-47 时返回空串 ——
 * 调用方据此拒绝写入，避免落出 zh-tw、ja jp 这类到后端才炸的键。
 */
export function canonicalLanguageCode(input?: string | null): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const found = findLanguage(raw);
  if (found) return found.code;
  return isValidLanguageCode(raw) ? canonicalizeTag(raw.replace(/_/g, "-")) : "";
}

/** 自称（native name）；表外语种回落到代码本身，不返回空串。 */
export function languageNativeName(code?: string | null): string {
  const found = findLanguage(code);
  return found ? found.native : String(code ?? "").trim();
}

/** 英文名；表外语种回落到代码本身。 */
export function languageEnglishName(code?: string | null): string {
  const found = findLanguage(code);
  return found ? found.en : String(code ?? "").trim();
}

/**
 * 展示标签：表内语种是「自称 (规范码)」，表外语种回落原始代码 —— 系统没见过的语种也必须
 * 显示成非空字符串，不能空白或报错。
 */
export function languageLabel(code?: string | null): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  const found = findLanguage(raw);
  if (!found) return raw;
  return found.native === found.code ? found.native : found.native + " (" + found.code + ")";
}

/** 该语种在默认回退链里的秩；不在链内的语种排在最后（等价写法按同一秩）。 */
export function languageRank(code?: string | null): number {
  const found = findLanguage(code);
  const mine = found ? found.code : String(code ?? "").trim();
  const i = (DEFAULT_TITLE_LOCALE_ORDER as readonly string[]).indexOf(mine);
  return i < 0 ? DEFAULT_TITLE_LOCALE_ORDER.length : i;
}

/** 检索用的名称集合：自称、英文名、中文名、日文名（后两项可能缺省）。 */
function searchableNames(entry: LanguageEntry): string[] {
  return [entry.native, entry.en, entry.nameZh || "", entry.nameJa || ""]
    .map((v) => v.toLowerCase())
    .filter(Boolean);
}

function score(entry: LanguageEntry, q: string, keys: string[]): number {
  const code = lookupKey(entry.code);
  const names = searchableNames(entry);
  if (code === q) return 0;
  if (keys.some((k) => lookupKey(k) === q)) return 1;
  if (code.startsWith(q)) return 2;
  if (keys.some((k) => lookupKey(k).startsWith(q))) return 3;
  if (names.some((n) => n.startsWith(q))) return 4;
  const words = names.flatMap((n) => n.split(/[\s/（）()]+/)).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 5;
  if (code.includes(q) || names.some((n) => n.includes(q))) return 6;
  if (keys.some((k) => lookupKey(k).includes(q))) return 7;
  return -1;
}

/**
 * 可搜索语言列表：自称、英文名、中文名、日文名、代码、别名都能命中
 * （ja / 日本 / Japanese / 日語 / 日语 / 威尔斯 都行）。
 * 空查询返回常用语种在前、其余按代码字典序的完整列表。
 */
export function searchLanguages(query?: string | null, limit?: number): LanguageEntry[] {
  const q = lookupKey(query || "");
  const scored: { entry: LanguageEntry; s: number }[] = [];
  for (const entry of LANGUAGES) {
    const s = q ? score(entry, q, entry.aliases || []) : entry.popular ? 0 : 1;
    if (s < 0) continue;
    scored.push({ entry, s });
  }
  scored.sort((a, b) => {
    if (a.s !== b.s) return a.s - b.s;
    const pa = a.entry.popular ? 0 : 1;
    const pb = b.entry.popular ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return languageRank(a.entry.code) - languageRank(b.entry.code) || a.entry.code.localeCompare(b.entry.code);
  });
  const out = scored.map((x) => x.entry);
  return limit && limit > 0 ? out.slice(0, limit) : out;
}

/** 快捷 chip 用的条目（数据来自同一份语言表）。 */
export function quickLanguages(): LanguageEntry[] {
  return (QUICK_LOCALE_CODES as readonly string[])
    .map((code) => findLanguage(code))
    .filter((e): e is LanguageEntry => !!e);
}

/** 界面四语条目，供 LocaleSwitcher 之类的界面语言选择器使用。 */
export function uiLanguages(): LanguageEntry[] {
  return (UI_LOCALE_CODES as readonly string[])
    .map((code) => findLanguage(code))
    .filter((e): e is LanguageEntry => !!e);
}

/** 已收录语言条数（自检与报告用）。 */
export const LANGUAGE_COUNT = LANGUAGES.length;
