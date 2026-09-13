
/** Show original_title only when it differs from the primary display title. */
export function isDistinctOriginalTitle(
  originalTitle?: string | null,
  displayTitle?: string | null,
): boolean {
  const original = (originalTitle ?? "").trim();
  if (!original) return false;
  const display = (displayTitle ?? "").trim();
  if (!display) return true;
  return original.toLocaleLowerCase() !== display.toLocaleLowerCase();
}

export interface LocaleTitleGroup {
  locale: string;
  /** 该语种主标题（翻译行 title/name） */
  primary: string;
  /** 该语种并列标题（翻译行 aliases） */
  aliases: string[];
  /** 是否为原始语言（由 original_language 推导） */
  isOriginal: boolean;
}

const LOCALE_ORDER = ["zh-CN", "zh-TW", "ja", "en-US", "ko"];

/** 同一语种的不同写法（界面语言 ja-JP 与编目语种 ja 必须互通）。键为小写。 */
const LOCALE_ALIASES: Record<string, string[]> = {
  "ja-jp": ["ja"],
  ja: ["ja-JP"],
  jpn: ["ja", "ja-JP"],
  "en-us": ["en"],
  en: ["en-US"],
  "zh-cn": ["zh"],
  zh: ["zh-CN"],
  "zh-tw": ["zh-TW", "zh-Hant"],
  "zh-hant": ["zh-TW"],
  "ko-kr": ["ko"],
  ko: ["ko-KR"],
  kor: ["ko", "ko-KR"],
};

/** 取某语种代码的等价写法（不含自身）。 */
export function localeAliases(loc: string): string[] {
  const low = (loc || "").trim().toLowerCase();
  if (!low) return [];
  return LOCALE_ALIASES[low] || [];
}

function localeRank(locale: string): number {
  const v = (locale || "").trim();
  if (v === "ja-JP" || v === "ja") return LOCALE_ORDER.indexOf("ja");
  if (v === "en-US" || v === "en") return LOCALE_ORDER.indexOf("en-US");
  if (v === "zh-CN" || v === "zh") return LOCALE_ORDER.indexOf("zh-CN");
  if (v === "zh-TW") return LOCALE_ORDER.indexOf("zh-TW");
  const i = LOCALE_ORDER.indexOf(v);
  return i < 0 ? LOCALE_ORDER.length : i;
}

function normalizeOriginalLocale(originalLanguage?: string | null): string {
  const v = (originalLanguage ?? "").trim().toLowerCase();
  if (v.startsWith("zh")) return v.includes("tw") || v.includes("hk") || v.includes("hant") ? "zh-TW" : "zh-CN";
  if (v.startsWith("en")) return "en-US";
  if (v.startsWith("ja") || v === "jpn") return "ja";
  if (v.startsWith("ko") || v === "kor") return "ko";
  if (v.startsWith("fr")) return "fr";
  if (v.startsWith("de")) return "de";
  return "";
}

/**
 * 将实体多语言标题按语种归并：每语种一组（主标题 + 同语种并列标题），
 * 原始语言仅作组内标记。调用方用 original_language 判定哪一组是原始语言，
 * 用 displayTitle 判定主标题行已展示过的标题不再重复。
 * 输入为统一 DTO 的 translations（按 locale 分组的对象：{loc:{title,aliases}}）。
 */
export function groupTitlesByLocale(
  translations: Record<string, { title?: string; name?: string; aliases?: string[] }> | undefined,
  originalLanguage?: string | null,
): LocaleTitleGroup[] {
  const origLocale = normalizeOriginalLocale(originalLanguage);
  const groups: LocaleTitleGroup[] = [];
  const seen = new Set<string>();
  for (const [locale, row] of Object.entries(translations || {})) {
    const loc = (locale || "").trim() || "zh-CN";
    const primary = (row?.title || row?.name || "").trim();
    const aliases = Array.isArray(row?.aliases)
      ? row!.aliases!.map((a) => String(a ?? "").trim()).filter(Boolean)
      : [];
    if (!primary && aliases.length === 0) continue;
    const key = `${loc}\u0000${primary.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({
      locale: loc,
      primary: primary || aliases[0] || "",
      aliases: primary ? aliases : aliases.slice(1),
      isOriginal:
        !!origLocale &&
        (loc === origLocale || localeAliases(loc).includes(origLocale)),
    });
  }
  groups.sort((a, b) => {
    if (a.isOriginal !== b.isOriginal) return a.isOriginal ? -1 : 1;
    return localeRank(a.locale) - localeRank(b.locale);
  });
  return groups;
}

export const TITLE_DISPLAY_ORDER_KEY = "metafusion_title_display_order";
export const TITLE_ORDER_CHANGED_EVENT = "mf:title-display-order-changed";

function normalizeLocaleCode(input: unknown): string {
  const v = String(input ?? "").trim();
  return v;
}

/** 用户自定义的标题显示语言优先级（localStorage，未设置返回空数组即默认回退链）。 */
export function getTitleDisplayOrder(): string[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(TITLE_DISPLAY_ORDER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of arr) {
      const code = normalizeLocaleCode(v);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
    return out;
  } catch {
    return [];
  }
}

export function setTitleDisplayOrder(order: string[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const v of order || []) {
      const code = normalizeLocaleCode(v);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      clean.push(code);
    }
    window.localStorage.setItem(TITLE_DISPLAY_ORDER_KEY, JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent(TITLE_ORDER_CHANGED_EVENT));
  } catch {
    /* 存储不可用时保持默认回退链 */
  }
}

export function resetTitleDisplayOrder(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(TITLE_DISPLAY_ORDER_KEY);
    window.dispatchEvent(new CustomEvent(TITLE_ORDER_CHANGED_EVENT));
  } catch {
    /* 存储不可用时保持默认回退链 */
  }
}

const TITLE_LOCALE_LABEL_KEYS: Record<string, string> = {
  "zh-CN": "editor.core.langZhHans",
  "zh-TW": "editor.core.langZhHant",
  ja: "editor.core.langJa",
  "en-US": "editor.core.langEn",
  ko: "editor.core.langKo",
};

/** 语种展示标签的 i18n 键；未知语种返回 null，调用方直接展示原始 locale 代码。 */
export function titleLocaleLabelKey(locale: string): string | null {
  return TITLE_LOCALE_LABEL_KEYS[locale] ?? null;
}

/** ISO 639-1 内容语言映射到编目语种（与后端的 catalogLocaleFromContentLang 对齐）。 */
export function mapOriginalLanguageToLocale(originalLanguage?: string | null): string {
  return normalizeOriginalLocale(originalLanguage);
}

export interface TitlePickOptions {
  /** 用户自定义优先级；缺省时读取 localStorage，未设置则走默认回退链。 */
  order?: string[];
  /** 实体内容语言（ISO 639-1），参与回退链。 */
  originalLanguage?: string | null;
}

/**
 * 标题/简介选取链：
 * 用户优先级（含等价写法）→ 界面语言（含等价写法）→ 原始语言（含等价写法）
 * → en-US → zh-CN → zh-TW → ja/ja-JP → 行内剩余语种（按语种秩）。
 * original_language 经 mapOriginalLanguageToLocale 归一化后参与回退，
 * ISO 639-1（ja/jpn、zh、en、ko 等）与编目语种（ja、zh-CN…）互通。
 */
export function buildTitleChain(
  uiLocale: string,
  opts?: TitlePickOptions,
  rowLocales?: Array<string | null | undefined>,
): string[] {
  const chain: string[] = [];
  const push = (loc?: string | null) => {
    const v = (loc ?? "").trim();
    if (v && !chain.includes(v)) chain.push(v);
  };
  const pushWithAliases = (loc?: string | null) => {
    const v = (loc ?? "").trim();
    if (!v) return;
    push(v);
    for (const a of localeAliases(v)) push(a);
  };
  const order = Array.isArray(opts?.order) ? opts!.order! : getTitleDisplayOrder();
  for (const loc of order) pushWithAliases(loc);
  pushWithAliases(uiLocale);
  pushWithAliases(mapOriginalLanguageToLocale(opts?.originalLanguage));
  pushWithAliases("en-US");
  pushWithAliases("zh-CN");
  push("zh-TW");
  push("ja");
  push("ja-JP");
  const rest = (rowLocales || [])
    .map((l) => (l ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => localeRank(a) - localeRank(b));
  for (const loc of rest) pushWithAliases(loc);
  return chain;
}

/** 在翻译行数组中按链定位：精确匹配优先，其次等价写法（ja-JP↔ja 等）。 */
export function findRowForLocale<
  T extends { locale?: string | null },
>(rows: T[], loc: string): T | undefined {
  const exact = rows.find((r) => (r.locale || "").trim() === loc);
  if (exact) return exact;
  const aliases = localeAliases(loc);
  for (const a of aliases) {
    const hit = rows.find((r) => (r.locale || "").trim() === a);
    if (hit) return hit;
  }
  // 大小写/短码兜底：ja-JP 行 vs ja 链等
  const low = loc.trim().toLowerCase();
  const short = low.split("-")[0];
  for (const r of rows) {
    const rl = ((r.locale || "").trim().toLowerCase());
    if (rl === low || rl === short) return r;
  }
  return undefined;
}

/** 翻译行为 Record<string, {title/name/summary/biography}> 形态时的统一标题选取。 */
export function pickRecordTitle(
  uiLocale: string,
  translations: Record<string, { title?: string; name?: string; summary?: string; biography?: string } | undefined | null> | undefined,
  fallbackTitle: string,
  opts?: TitlePickOptions,
): string {
  const rec = translations || {};
  const rows = Object.entries(rec)
    .filter(([loc, row]) => loc && row && (((row.title || row.name || "").trim())))
    .map(([loc, row]) => ({ locale: loc, title: (row!.title || row!.name || "").trim() }));
  const chain = buildTitleChain(uiLocale, opts, rows.map((r) => r.locale));
  for (const loc of chain) {
    const row = findRowForLocale(rows, loc);
    if (row && row.title) return row.title;
  }
  return (fallbackTitle || "").trim();
}

/** Record 形态翻译行的标题+简介选取（详情/预览链共用）。 */
export function pickRecordEntry(
  uiLocale: string,
  translations: Record<string, { title?: string; name?: string; summary?: string; biography?: string } | undefined | null> | undefined,
  fallbackTitle: string,
  fallbackBody?: string,
  opts?: TitlePickOptions,
): { title: string; body: string } {
  const rec = translations || {};
  const rows = Object.entries(rec)
    .filter(([loc, row]) => loc && row)
    .map(([loc, row]) => ({
      locale: loc,
      title: ((row!.title || row!.name || "").trim()),
      body: ((row!.summary || row!.biography || "").trim()),
    }));
  const chain = buildTitleChain(uiLocale, opts, rows.map((r) => r.locale));
  for (const loc of chain) {
    const row = findRowForLocale(rows, loc);
    if (row && (row.title || row.body)) {
      return { title: row.title || fallbackTitle, body: row.body || fallbackBody || "" };
    }
  }
  return {
    title: (fallbackTitle || "").trim(),
    body: (fallbackBody || "").trim(),
  };
}

/**
 * 去掉与主展示标题重复且无并列标题的分组，避免详情页标题行与资料行显示同一文本。
 */
export function visibleTitleGroups(groups: LocaleTitleGroup[], displayTitle?: string | null): LocaleTitleGroup[] {
  const display = (displayTitle ?? "").trim().toLocaleLowerCase();
  if (!display) return groups;
  return groups.filter(
    (g) => g.aliases.length > 0 || g.primary.toLocaleLowerCase() !== display,
  );
}

/**
 * 实体级 aliases 过滤：已在任一翻译标题（主标题或同语种并列标题）中
 * 出现过的值不再作为别名展示——原语言标题归属翻译行，不进别名。
 */
