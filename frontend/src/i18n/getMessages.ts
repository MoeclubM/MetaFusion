import { normalizeLocale, type Locale } from "./routing";
import zhCN from "@/messages/zh-CN.json";
import zhTW from "@/messages/zh-TW.json";
import jaJP from "@/messages/ja-JP.json";
import enUS from "@/messages/en-US.json";

const catalog: Record<string, Record<string, string>> = {
  "zh-CN": zhCN as Record<string, string>,
  "zh-TW": zhTW as Record<string, string>,
  "ja-JP": jaJP as Record<string, string>,
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

// translateOr 缺键时返回后备值而非裸 key。
// translate 缺键返回 key 本身（非空），`t(key) || fallback` 永不触发，
// 动态拼接键（catalog.kind/status 等）缺键会直接把 key 显示出来。
export function translateOr(
  messages: Record<string, string>,
  key: string,
  fallback: string,
  vars?: Record<string, string | number>
): string {
  if (messages[key] == null) return fallback;
  return translate(messages, key, vars);
}
