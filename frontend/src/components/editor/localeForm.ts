export const CATALOG_LOCALES = [
  { code: "zh-CN", labelKey: "editor.core.langZhHans", romaji: false },
  { code: "ja", labelKey: "editor.core.langJa", romaji: true },
  { code: "en-US", labelKey: "editor.core.langEn", romaji: false },
  { code: "zh-TW", labelKey: "editor.core.langZhHant", romaji: false },
  { code: "ko", labelKey: "editor.core.langKo", romaji: false },
] as const;

export const CATALOG_LOCALE_CODES = CATALOG_LOCALES.map((l) => l.code);

export type LocaleEntry = { title: string; summary: string; aliases?: string[] };

/** 逗号/换行分隔的并列标题字符串 ↔ 数组互转（与实体级 aliasesStr 一致）。 */
export function parseLocaleAliases(input?: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(input ?? "").split(/[,，\n]/)) {
    const v = part.trim();
    const low = v.toLocaleLowerCase();
    if (!v || seen.has(low)) continue;
    seen.add(low);
    out.push(v);
  }
  return out;
}

function readRowAliases(row: Record<string, any>): string[] {
  if (Array.isArray(row.aliases)) {
    return parseLocaleAliases((row.aliases as unknown[]).map((a) => String(a ?? "")).join(","));
  }
  return [];
}

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
      aliases: readRowAliases(row),
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
      aliases: [],
    };
  }

  return { translations, language };
}

export function translationsPayload(translations: Record<string, LocaleEntry>) {
  return Object.entries(translations)
    .map(([locale, e]) => {
      const title = (e.title || "").trim();
      const summary = (e.summary || "").trim();
      const seen = new Set([title.toLocaleLowerCase()]);
      const aliases = ((e.aliases || []) as string[])
        .map((a) => String(a ?? "").trim())
        .filter((a) => {
          const low = a.toLocaleLowerCase();
          if (!a || seen.has(low)) return false;
          seen.add(low);
          return true;
        });
      return { locale, title, summary, aliases };
    })
    .filter((row) => row.title || row.summary || row.aliases.length > 0)
    .map(({ locale, title, summary, aliases }) => ({
      locale,
      title,
      name: title,
      summary,
      biography: summary,
      aliases,
    }));
}
