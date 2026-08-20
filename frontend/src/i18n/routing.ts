export const locales = ["zh-CN", "en-US"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "zh-CN";
export const localeCookieName = "NEXT_LOCALE";
export const validLocales = new Set<string>(locales);

export function normalizeLocale(input?: string | null): Locale {
  if (!input) return defaultLocale;
  const v = input.trim();
  if (validLocales.has(v)) return v as Locale;
  const low = v.toLowerCase();
  if (low.startsWith("en")) return "en-US";
  if (low.startsWith("zh")) return "zh-CN";
  return defaultLocale;
}

export function parseAcceptLanguage(header?: string | null): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim();
    if (!tag) continue;
    if (validLocales.has(tag)) return tag as Locale;
    const low = tag.toLowerCase();
    if (low.startsWith("en")) return "en-US";
    if (low.startsWith("zh")) return "zh-CN";
  }
  return null;
}
