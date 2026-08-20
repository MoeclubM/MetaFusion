import { normalizeLocale, type Locale } from "./routing";
import zhCN from "@/messages/zh-CN.json";
import enUS from "@/messages/en-US.json";

const catalog: Record<string, Record<string, string>> = {
  "zh-CN": zhCN as Record<string, string>,
  "en-US": enUS as Record<string, string>,
};

export function getMessages(locale?: string | null): Record<string, string> {
  const loc = normalizeLocale(locale);
  return catalog[loc] || catalog["zh-CN"]!;
}

export function translate(
  messages: Record<string, string>,
  key: string,
  vars?: Record<string, string | number>
): string {
  let s = messages[key];
  if (s == null) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
