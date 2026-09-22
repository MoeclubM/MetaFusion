/** 服务端多语言名称：请求语种、同语系、简中、繁中、日文、英文、其余非空值。 */
export function resolveLocalizedName(
  names: Record<string, string> | undefined | null,
  locale: string,
  fallback = ""
): string {
  if (!names) return fallback;
  const get = (code: string): string => {
    const v = names[code];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };
  if (get(locale)) return get(locale);
  const short = locale.trim().toLowerCase().split("-")[0];
  for (const [k, v] of Object.entries(names)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const kl = k.trim().toLowerCase();
    if (kl === short || kl.split("-")[0] === short) return v.trim();
  }
  if (get("zh-CN")) return get("zh-CN");
  if (get("zh-TW") || get("zh-Hant")) return get("zh-TW") || get("zh-Hant");
  if (get("ja") || get("ja-JP")) return get("ja") || get("ja-JP");
  if (get("en-US") || get("en")) return get("en-US") || get("en");
  const values = Object.values(names).filter((v) => typeof v === "string" && v.trim());
  return values.length > 0 ? (values[0] as string).trim() : fallback;
}
