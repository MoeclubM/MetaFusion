import { UI_LOCALE_CODES, findLanguage } from "@/lib/languages";

// 界面四语（是否提供字典）来自语言单一来源：字典、NEXT_LOCALE cookie、html lang 共用这一份，
// 不再各自写一遍语种清单。语言表里标了 ui 的条目与本列表一致（生成器自检会拦不一致）。
export const locales = UI_LOCALE_CODES;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "zh-CN";
export const localeCookieName = "NEXT_LOCALE";
export const validLocales = new Set<string>(locales);

/**
 * 归一界面语言：只认四语字典覆盖的那四种。
 * 精确命中优先；其次交给语言表解析等价写法（zh-Hant/zh-HK → zh-TW、ja → ja-JP、en-GB → en-US）；
 * 解析结果不是四语之一（例如 cy）时回落默认语言——界面没有该语种字典，回退总好过空白。
 */
export function normalizeLocale(input?: string | null): Locale {
  if (!input) return defaultLocale;
  const v = input.trim();
  if (validLocales.has(v)) return v as Locale;
  const found = findLanguage(v);
  if (found && validLocales.has(found.code)) return found.code as Locale;
  return defaultLocale;
}

export function parseAcceptLanguage(header?: string | null): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim();
    if (!tag) continue;
    if (validLocales.has(tag)) return tag as Locale;
    const found = findLanguage(tag);
    if (found && validLocales.has(found.code)) return found.code as Locale;
  }
  return null;
}
