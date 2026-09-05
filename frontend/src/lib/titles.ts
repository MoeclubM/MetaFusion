import type { EntityTranslation } from "./api";

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

function localeRank(locale: string): number {
  const i = LOCALE_ORDER.indexOf(locale);
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
 */
export function groupTitlesByLocale(
  translations: EntityTranslation[] | undefined,
  originalLanguage?: string | null,
): LocaleTitleGroup[] {
  const rows = translations || [];
  const origLocale = normalizeOriginalLocale(originalLanguage);
  const groups: LocaleTitleGroup[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const locale = (row.locale || "").trim() || "zh-CN";
    const primary = (row.title || row.name || "").trim();
    const aliases = Array.isArray(row.aliases)
      ? row.aliases.map((a) => String(a ?? "").trim()).filter(Boolean)
      : [];
    if (!primary && aliases.length === 0) continue;
    const key = `${locale}\u0000${primary.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({
      locale,
      primary: primary || aliases[0] || "",
      aliases: primary ? aliases : aliases.slice(1),
      isOriginal: !!origLocale && locale === origLocale,
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
 * 标题/简介选取链：用户优先级 → 界面语言 → en-US → 原始语言 → 行内剩余语种。
 * 调用方按此顺序取首个非空标题/简介。
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
  const order = Array.isArray(opts?.order) ? opts!.order! : getTitleDisplayOrder();
  for (const loc of order) push(loc);
  push(uiLocale);
  push("en-US");
  push(mapOriginalLanguageToLocale(opts?.originalLanguage));
  const rest = (rowLocales || [])
    .map((l) => (l ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => localeRank(a) - localeRank(b));
  for (const loc of rest) push(loc);
  return chain;
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
export function filterDisplayAliases(
  aliases: string[] | undefined,
  translations: EntityTranslation[] | undefined,
  extraKnown?: Array<string | null | undefined>,
): string[] {
  const known = new Set<string>();
  for (const row of translations || []) {
    for (const t of [row.title, row.name, ...(row.aliases || [])]) {
      const v = (t ?? "").toString().trim().toLocaleLowerCase();
      if (v) known.add(v);
    }
  }
  for (const t of extraKnown || []) {
    const v = (t ?? "").toString().trim().toLocaleLowerCase();
    if (v) known.add(v);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of aliases || []) {
    const v = String(a ?? "").trim();
    const low = v.toLocaleLowerCase();
    if (!v || known.has(low) || seen.has(low)) continue;
    seen.add(low);
    out.push(v);
  }
  return out;
}
