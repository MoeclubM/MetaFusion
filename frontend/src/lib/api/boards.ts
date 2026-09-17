// 社区分区（论坛服务 /api/community/boards）管理端的薄封装。
//
// 契约来源（只读核对，未改论坛服务代码）：
//   metafusion-community/internal/handler/board.go:97-188 —— PUT 是"只改传入字段"的补丁语义、
//     四语校验（boardLocales = zh-CN/zh-TW/ja-JP/en-US）、空载荷 400、code 是路径参数不可改；
//     本服务没有创建与删除端点
//   metafusion-community/internal/handler/forum.go:114-149 —— 列表返回裸数组，字段就是下面这 10 个
//
// 刻意不复用 ./community.ts 的 fetchBoards()：那里的 normalizeBoard 会把 color 收敛成 tailwind
// class、再注入一个虚拟 "all" 分区，管理台需要的是能原样回写、能显示原始值的行。

import { ApiError, fetchApi } from "./client";

/** 服务端 forumBoard 的对外形状，管理台不发明字段，也不做展示层归一化。 */
export interface BoardRow {
  code: string;
  names: Record<string, string>;
  descriptions: Record<string, string>;
  /** 兼容/回退单值，由多语言 map 的 zh-CN 派生；只作展示兜底，接口没有写入口。 */
  name: string;
  description: string;
  color: string;
  icon: string;
  sort_order: number;
  is_enabled: boolean;
  show_in_feed: boolean;
}

/** PUT 载荷：只带改动过的字段；服务端把"一个字段都没传"判成 invalid_payload。 */
export interface BoardPatch {
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
  color?: string;
  icon?: string;
  sort_order?: number;
  is_enabled?: boolean;
  show_in_feed?: boolean;
}

/** 表单态的值：与 BoardRow 同构，只用于和库里的行做差分。 */
export interface BoardFormValues {
  names: Record<string, string>;
  descriptions: Record<string, string>;
  color: string;
  icon: string;
  sort_order: number;
  is_enabled: boolean;
  show_in_feed: boolean;
}

/** 与 i18n 的 t 同形：错误码表只依赖这个形状，不依赖具体 provider。 */
export type BoardTranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** 固定语种清单，顺序与后端 boardLocales 一致（错误码里的缺语种列表按它排列）。 */
export const BOARD_LOCALES = ["zh-CN", "zh-TW", "ja-JP", "en-US"] as const;

/**
 * color 存的是调色板名（不是 tailwind class）。清单来自 community.ts 的 BOARD_PALETTE，
 * 但那份表是渲染用的静态映射，这里是写入口的候选值，所以自己声明一份：
 * 清单外的值仍然原样保留，不做纠正（见 paletteUnknown 文案）。
 */
export const BOARD_COLORS: readonly string[] = [
  "emerald",
  "amber",
  "sky",
  "purple",
  "cyan",
  "rose",
  "indigo",
  "teal",
];

/** 图标是 lucide 组件名（默认 BookOpen）。候选而已，不是白名单。 */
export const BOARD_ICON_SUGGESTIONS: readonly string[] = [
  "BookOpen",
  "Megaphone",
  "Coffee",
  "Hash",
  "Bug",
  "MessageCircle",
  "Layers",
  "Tag",
  "Sparkles",
  "Flame",
  "Bookmark",
  "MessageSquare",
  "Globe",
  "Cpu",
  "Archive",
  "Newspaper",
  "Pin",
  "Star",
];

export function fetchBoardRows(): Promise<BoardRow[]> {
  // 列表匿名可读、没有查询参数；搜索是纯前端过滤。
  return fetchApi<BoardRow[]>("/community/boards");
}

/** code 是路由参数与 topic.board_code 的锚点，body 里带 code 也会被忽略，所以只发补丁字段。 */
export function updateBoard(code: string, patch: BoardPatch): Promise<BoardRow> {
  return fetchApi<BoardRow>(`/community/boards/${encodeURIComponent(code)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

// ── 纯函数：展示、校验、差分、错误文案 ──

function trimMap(values: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) out[key] = (value ?? "").trim();
  return out;
}

/**
 * 展示用文本回退链：请求语言 → en-US → zh-CN → 任意非空 → fallback。
 * 单值列（name/description）只作兜底，不参与回写。
 */
export function boardText(
  values: Record<string, string> | undefined,
  locale: string,
  fallback = ""
): string {
  const map = values ?? {};
  for (const code of [locale, "en-US", "zh-CN"]) {
    const hit = (map[code] ?? "").trim();
    if (hit) return hit;
  }
  for (const value of Object.values(map)) {
    const hit = (value ?? "").trim();
    if (hit) return hit;
  }
  return fallback;
}

export type LocaleMapState = { ok: true; cleared: boolean } | { ok: false; missing: string[] };

/**
 * 四语判定，逐字对齐后端 resolveBoardLocales：
 * 逐值 TrimSpace 后四语齐备即通过；"所有传入的键都是空串"视为显式清空（cleared=true，落库为 {}）；
 * 其余（含 `{}` 这种键都不传的）都算缺语种。
 */
export function checkLocaleMap(values: Record<string, string> | undefined): LocaleMapState {
  const trimmed = trimMap(values);
  const missing = BOARD_LOCALES.filter((code) => (trimmed[code] ?? "") === "");
  if (missing.length === 0) return { ok: true, cleared: false };
  const keys = Object.keys(trimmed);
  const allEmpty = keys.every((key) => (trimmed[key] ?? "") === "");
  if (allEmpty && keys.length > 0) return { ok: true, cleared: true };
  return { ok: false, missing: [...missing] };
}

/** 按服务端的 TrimSpace 口径比较：只多了个尾空格不算改动。 */
function sameLocaleMap(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const left = trimMap(a);
  const right = trimMap(b);
  const keys = Object.keys(left);
  for (const key of Object.keys(right)) {
    if (!keys.includes(key)) keys.push(key);
  }
  for (const key of keys) {
    if ((left[key] ?? "") !== (right[key] ?? "")) return false;
  }
  return true;
}

/** 只挑出真正改动过的字段：空补丁会被服务端 400 拒，所以调用方要据此拦下"未做任何修改"。 */
export function diffBoardPatch(row: BoardRow, next: BoardFormValues): BoardPatch {
  const patch: BoardPatch = {};
  if (!sameLocaleMap(row.names, next.names)) patch.names = trimMap(next.names);
  if (!sameLocaleMap(row.descriptions, next.descriptions)) patch.descriptions = trimMap(next.descriptions);
  const color = next.color.trim();
  const icon = next.icon.trim();
  if (color !== (row.color ?? "").trim()) patch.color = color;
  if (icon !== (row.icon ?? "").trim()) patch.icon = icon;
  if (next.sort_order !== row.sort_order) patch.sort_order = next.sort_order;
  if (next.is_enabled !== row.is_enabled) patch.is_enabled = next.is_enabled;
  if (next.show_in_feed !== row.show_in_feed) patch.show_in_feed = next.show_in_feed;
  return patch;
}

const FOUR_LOCALE_MARKER = "four_locale_names_required";

/**
 * 解析缺语种错误码：形如 `four_locale_names_required: zh-TW,ja-JP`。
 * 它是"机器可判但非结构化"的（冒号 + 一个空格后是逗号无空格的语种名），
 * 只认前缀容易漏掉被外层字段码包裹的情况，所以按标记出现的位置切。
 * 拿不到语种清单时返回 null，由调用方回退到通用文案，不臆造缺失语种。
 */
export function parseMissingLocales(raw: string | undefined | null): string[] | null {
  if (!raw) return null;
  const at = raw.indexOf(FOUR_LOCALE_MARKER);
  if (at < 0) return null;
  const rest = raw.slice(at + FOUR_LOCALE_MARKER.length).replace(/^:\s*/, "").trim();
  const list = rest
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/** 语种清单的展示分隔：中日文用顿号，拉丁语境用逗号加空格。 */
export function formatLocaleList(list: string[], locale: string): string {
  const separator = locale.startsWith("zh") || locale.startsWith("ja") ? "、" : ", ";
  return list.join(separator);
}

/** 服务端稳定错误码 → 字典键；未知码回退原文，不把没覆盖的码伪装成已解释。 */
const BOARD_ERROR_KEYS: Record<string, string> = {
  invalid_payload: "admin.boards.errInvalidPayload",
  not_found: "admin.boards.errNotFound",
  module_error: "admin.boards.errModule",
  authentication_required: "admin.boards.errUnauthorized",
};

/**
 * 把论坛服务的错误翻成如实提示：缺语种单独解析成"还缺哪些语种"，
 * 403 说清缺哪个权限码，5xx/网络错误说清论坛服务不可达，其余把错误码原样带出。
 */
export function describeBoardError(
  err: unknown,
  t: BoardTranslateFn,
  locale: string,
  requiredPermission: string
): string {
  if (err instanceof ApiError) {
    const code = String(err.message || "");
    const missing = parseMissingLocales(code);
    if (missing) {
      return t("admin.boards.errFourLocales", { locales: formatLocaleList(missing, locale) });
    }
    const key = BOARD_ERROR_KEYS[code.trim()];
    if (key) return t(key);
    if (err.status === 401) return t("admin.boards.errUnauthorized");
    if (err.status === 403) return t("admin.account.errForbidden", { code: requiredPermission });
    if (err.status === 404) return t("admin.boards.errNotFound");
    if (err.status >= 502 && err.status <= 504) {
      return t("admin.boards.errUpstream", { status: err.status });
    }
    return t("admin.boards.errFailed", { status: err.status, message: code });
  }
  return t("admin.boards.errNetwork", {
    message: err instanceof Error ? err.message : String(err),
  });
}
