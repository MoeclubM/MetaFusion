export const CATALOG_LOCALES = [
  { code: "zh-CN", labelKey: "editor.core.langZhHans", romaji: false },
  { code: "ja", labelKey: "editor.core.langJa", romaji: true },
  { code: "en-US", labelKey: "editor.core.langEn", romaji: false },
  { code: "zh-TW", labelKey: "editor.core.langZhHant", romaji: false },
  { code: "ko", labelKey: "editor.core.langKo", romaji: false },
] as const;

export const CATALOG_LOCALE_CODES = CATALOG_LOCALES.map((l) => l.code);

export type LocaleEntry = { title: string; summary: string };

export function normalizeCatalogLocale(input?: string): string {
  if (!input) return "zh-CN";
  const v = input.trim();
  if ((CATALOG_LOCALE_CODES as readonly string[]).includes(v)) return v;
  const low = v.toLowerCase();
  if (low === "ja-jp" || low === "ja") return "ja";
  if (low === "ko-kr" || low === "ko") return "ko";
  if (low === "zh-tw" || low === "zh-hk") return "zh-TW";
  if (low.startsWith("en")) return "en-US";
  if (low.startsWith("zh")) return "zh-CN";
  return "zh-CN";
}

/** Edit: translations only. If the row has none yet, seed one pack from canonical title/summary. Create: empty. */
export function seedLocaleForm(
  d: Record<string, any>,
  mode: "create" | "edit",
  uiLocale?: string
): {
  translations: Record<string, LocaleEntry>;
  language: string;
} {
  const fallbackLang = uiLocale === "en-US" ? "en-US" : "zh-CN";
  if (mode === "create") {
    return { translations: {}, language: d.language ? normalizeCatalogLocale(d.language) : fallbackLang };
  }

  const translations: Record<string, LocaleEntry> = {};
  const rows = Array.isArray(d.translations) ? d.translations : [];
  for (const row of rows) {
    const loc = normalizeCatalogLocale(row.locale);
    translations[loc] = {
      title: row.title || row.name || "",
      summary: row.summary || row.biography || "",
    };
  }

  let language = d.language ? normalizeCatalogLocale(d.language) : "";
  const canonicalTitle = String(d.title || d.name || "").trim();
  if (!language && canonicalTitle) {
    const hit = Object.entries(translations).find(([, e]) => e.title === canonicalTitle);
    if (hit) language = hit[0];
  }
  if (!language) language = fallbackLang;

  if (Object.keys(translations).length === 0 && canonicalTitle) {
    translations[language] = {
      title: canonicalTitle,
      summary: String(d.summary || d.biography || "").trim(),
    };
  }

  return { translations, language };
}

export function translationsPayload(translations: Record<string, LocaleEntry>) {
  return Object.entries(translations)
    .filter(([, e]) => (e.title || "").trim() || (e.summary || "").trim())
    .map(([locale, e]) => ({
      locale,
      title: (e.title || "").trim(),
      name: (e.title || "").trim(),
      summary: (e.summary || "").trim(),
      biography: (e.summary || "").trim(),
    }));
}
