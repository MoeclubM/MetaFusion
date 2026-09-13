import type { Entity } from "@/components/catalog/api";

const getApiBase = () => {
  if (typeof window !== "undefined") {
    // 浏览器端：使用网关相对路径，自适应任何主机/域名/IP
    return "/api";
  }
  // 服务端 (SSR)：使用容器内网
  return process.env.INTERNAL_API_URL || "http://backend:8080/api";
};

export interface User {
  id: string;
  username: string;
  display_name?: string | null;
  email: string;
  role: string;
  invite_code?: string;
  invites_remaining?: number;
  invited_by?: string;
  avatar_url?: string;
  bio?: string;
  favorites_public?: boolean;
  email_public?: boolean;
  is_email_verified?: boolean;
  created_at?: string;
  updated_at?: string;
  inviter?: User;
}

// ── 收藏 ──
// target_type 直接就是实体 kind（固定八种骨架），不再使用旧词表别名。
export type FavoriteTargetType =
  | "agent"
  | "collection"
  | "work"
  | "content_unit"
  | "expression"
  | "release"
  | "medium"
  | "track";

export interface FavoriteItem {
  id: string;
  target_type: FavoriteTargetType;
  target_id: string;
  created_at: string;
  /** 被收藏实体本身；展示按 target_type 与实体的 translations/kind 渲染。 */
  entity?: Entity;
}

/** 切换收藏状态，返回切换后是否已收藏 */
export async function toggleFavorite(targetType: FavoriteTargetType, targetId: string): Promise<boolean> {
  const res = await fetchApi<{ favorited: boolean }>("/favorites/toggle", {
    method: "POST",
    body: JSON.stringify({ target_type: targetType, target_id: targetId }),
  });
  return res.favorited;
}

/** 批量查询当前用户对若干目标是否已收藏 */
export async function fetchFavoriteStatus(targetType: FavoriteTargetType, targetIds: string[]): Promise<Set<string>> {
  if (targetIds.length === 0) return new Set();
  const res = await fetchApi<{ favorited: string[] }>(
    `/favorites/status?target_type=${encodeURIComponent(targetType)}&target_ids=${encodeURIComponent(targetIds.join(","))}`
  );
  return new Set(res.favorited || []);
}

/** 拉取收藏列表（本人或公开用户），visible=false 表示对方未公开 */
export async function fetchFavorites(
  userIdOrMine: string,
  opts: { targetType?: FavoriteTargetType; page?: number; pageSize?: number } = {}
): Promise<{ items: FavoriteItem[]; total: number; visible: boolean }> {
  const endpoint = userIdOrMine === "mine" ? "/favorites/mine" : `/users/${userIdOrMine}/favorites`;
  const params = new URLSearchParams();
  if (opts.targetType) params.set("target_type", opts.targetType);
  if (opts.page) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("page_size", String(opts.pageSize));
  const qs = params.toString();
  return fetchApi(`${endpoint}${qs ? `?${qs}` : ""}`);
}

export function displayNameOf(u: Pick<User, "username" | "display_name">): string {
  const dn = (u as any).display_name;
  if (typeof dn === "string" && dn.trim() !== "") return dn.trim();
  return u.username;
}

export interface InviteInfoResponse {
  invite_code: string;
  invited_count: number;
  invited_users: User[];
}

export interface AdminStats {
  total_users: number;
  total_works: number;
  total_releases: number;
  verified_releases: number;
  total_mediums: number;
  total_tracks: number;
  total_assets?: number;
  total_asset_files: number;
  total_storage_bytes: number;
  total_topics: number;
  total_comments: number;
}

// 展示用词表已收敛：标签走 attributes.tags + /catalog/tags，货架走 /catalog/shelves。
// 不存在自定义货架端点，用户偏好落 /catalog/me/home-preferences。

/** 编目实体枢纽就是固定八种骨架，不再有"其余 code 是主体上的动态类型"这套旧分层。 */
export const CATALOG_HUBS = [
  "agent",
  "collection",
  "work",
  "content_unit",
  "expression",
  "release",
  "medium",
  "track",
] as const;
export type CatalogHub = (typeof CATALOG_HUBS)[number];

export function isCatalogHub(type: string): type is CatalogHub {
  return (CATALOG_HUBS as readonly string[]).includes(type);
}

export function catalogHubOf(type: string): CatalogHub {
  const normalized = (type || "").toLowerCase();
  if (isCatalogHub(normalized)) return normalized;
  return "work";
}


export interface Tag {
  id: number;
  name: string;
  group_type: string;
}



/** 动态多语言字段映射解析辅助函数（names: Record<string, string> / JSONB 结构，按语言链回退） */
export function pickLocalizedName(
  locale: string,
  names?: Record<string, string> | null,
  defaultSlug?: string
): string {
  if (names && typeof names === "object") {
    // 1. 精确匹配当前语言，如 zh-CN, en-US, ja, ko
    if (names[locale] && typeof names[locale] === "string" && names[locale].trim()) {
      return names[locale].trim();
    }
    // 2. 前缀匹配语言家族，如 zh 匹配 zh-CN, en 匹配 en-US
    const prefix = locale.split("-")[0]?.toLowerCase();
    if (prefix) {
      for (const [k, v] of Object.entries(names)) {
        if (k.toLowerCase().startsWith(prefix) && typeof v === "string" && v.trim()) {
          return v.trim();
        }
      }
    }
    // 3. 回退至 zh-CN
    if (names["zh-CN"] && typeof names["zh-CN"] === "string" && names["zh-CN"].trim()) {
      return names["zh-CN"].trim();
    }
    // 4. 回退至 zh-TW / zh-Hant（繁中与简中互为回退，不再直跳英文）
    if (names["zh-TW"] && typeof names["zh-TW"] === "string" && names["zh-TW"].trim()) {
      return names["zh-TW"].trim();
    }
    if (names["zh-Hant"] && typeof names["zh-Hant"] === "string" && names["zh-Hant"].trim()) {
      return names["zh-Hant"].trim();
    }
    // 5. 回退至 ja / ja-JP
    if (names["ja"] && typeof names["ja"] === "string" && names["ja"].trim()) {
      return names["ja"].trim();
    }
    if (names["ja-JP"] && typeof names["ja-JP"] === "string" && names["ja-JP"].trim()) {
      return names["ja-JP"].trim();
    }
    // 6. 回退至 en-US
    if (names["en-US"] && typeof names["en-US"] === "string" && names["en-US"].trim()) {
      return names["en-US"].trim();
    }
    // 7. 任意非空值
    for (const v of Object.values(names)) {
      if (typeof v === "string" && v.trim()) {
        return v.trim();
      }
    }
  }

  return defaultSlug || "";
}



export interface ConnectedEntityItem {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  original_name?: string;
  cover_url?: string;
  cover_aspect?: string;
  country?: string;
  relationship_type: string;
  relationship_name: string;
  qualifier?: string;
  direction: 'forward' | 'reverse';
  label: string;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  is_current?: boolean;
  date_span?: string;
  attributes: Record<string, any>;
}

export interface EntityRevision {
  id: string;
  target_type: string;
  target_id: string;
  editor_id?: string;
  edit_type: string;
  summary: string;
  edit_note: string;
  source_urls?: string[];
  before_state: Record<string, any>;
  after_state: Record<string, any>;
  diff: Record<string, { old: any; new: any }>;
  status: string;
  created_at: string;
  editor?: User;
}

export interface EntityRelationship {
  id?: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relationship_type: string;
  qualifier?: string;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  attributes: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface RelationType {
  code: string;
  domain: string;
  names?: Record<string, string>;
  description?: string;
  allowed_source_types?: string[];
  allowed_target_types?: string[];
  is_symmetric: boolean;
  is_hierarchical: boolean;
  // 是否具有时间语义（任期/隶属/合约期）：为 true 时编辑器展示 begin/end/ended 输入。
  is_temporal?: boolean;
  attribute_schema?: { fields?: any[] } | any[];
  color: string;
  icon: string;
  sort_order: number;
  is_system: boolean;
  is_enabled: boolean;
  created_at?: string;
  display_name?: string;
  forward_label?: string;
  reverse_label?: string;
}









// Admin/API compatibility name. Runtime data is backed by AssetRegistry + AssetBinding.







export function catalogEntityHref(type: string, id: string): string {
  // 专用详情路由只覆盖 work / release / medium；其余 kind 走通用兜底 /catalog/:id。
  switch (catalogHubOf(type)) {
    case "work":
      return `/works/${id}`;
    case "release":
      return `/releases/${id}`;
    case "medium":
      return `/mediums/${id}`;
    default:
      return `/catalog/${id}`;
  }
}

export interface GraphNode {
  id: string;
  name: string;
  original_name?: string;
  type: string;
  category: string;
  role?: string;
  level: number;
  cover_image_url?: string;
  disambiguation?: string;
  country?: string;
  status?: string;
}

export interface GraphLink {
  id?: string;
  source: string;
  target: string;
  source_type?: string;
  target_type?: string;
  type: string;
  label: string;
  /** definitions 中的关系分组（credits/creative/membership），供图谱按语义筛选。 */
  group?: string;
  qualifier?: string;
  color?: string;
  attributes?: Record<string, any>;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  is_hierarchical?: boolean;
}

export interface ForumPost {
  id: string;
  topic_id: string;
  post_number: number;
  user_id: string;
  content: string;
  reply_to_post_number?: number | null;
  reply_to_post_id?: string | null;
  created_at: string;
  updated_at?: string;
  user?: User;
}

export interface DiscussionTopic { is_pinned?:boolean; pinned_at?:string; 
  id: string;
  user_id: string;
  board_code: string;
  /** 锚定的目录实体（若评论/主题挂在某个实体上）；标题与 kind 由后端补齐。 */
  entity_id?: string;
  entity_title?: string;
  entity_kind?: string;
  title: string;
  content: string;
  view_count: number;
  reply_count: number;
  created_at: string;
  updated_at: string;
  user?: User;
  comments?: Comment[];
  posts?: ForumPost[];
  tags?: Tag[];
}

export interface CreateTopicPayload {
  board_code: string;
  title: string;
  content: string;
  language?: string;
  work_id?: string;
  tag_ids?: number[];
  tag_names?: string[];
}

export interface CreatePostPayload {
  content: string;
  reply_to_post_number?: number | null;
  reply_to_post_id?: string | null;
}

export interface Comment {
  id: string;
  topic_id?: string;
  work_id?: string;
  release_id?: string;
  user_id: string;
  parent_id?: string;
  content: string;
  created_at: string;
  user?: User;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  updated_at: string;
  sender?: { id: string; username: string; role: string; avatar_url?: string };
  receiver?: { id: string; username: string; role: string; avatar_url?: string };
}

export interface ConversationItem {
  peer: { id: string; username: string; role: string; avatar_url?: string; bio?: string; created_at: string };
  last_message?: DirectMessage;
  unread_count: number;
}

export interface Invitation {
  id: string;
  code: string;
  is_used: boolean;
  expires_at: string;
  created_at: string;
}

/**
 * 板块名称/描述为四语映射，展示用 boardDisplayName / boardDisplayDesc。
 * nameKey/descKey 指向 messages 中的 board.* 词条，作为 translator 可用时的权威来源；
 * names/descriptions 是服务端下发的同一份数据，也是离线兜底。
 */
export interface ForumBoard {
  code: string;
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
  /** i18n keys — 复用已存在的 board.* 翻译（board.all / board.announcement / ...） */
  nameKey: string;
  descKey: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon?: string;
  sort_order?: number;
  is_enabled?: boolean;
  show_in_feed?: boolean;
}

const BOARD_PALETTE: Record<string, { color: string; bgColor: string; borderColor: string }> = {
  emerald: { color: "text-emerald-400", bgColor: "bg-emerald-500/15", borderColor: "border-emerald-500/30" },
  amber: { color: "text-amber-400", bgColor: "bg-amber-500/15", borderColor: "border-amber-500/30" },
  sky: { color: "text-sky-400", bgColor: "bg-sky-500/15", borderColor: "border-sky-500/30" },
  purple: { color: "text-purple-400", bgColor: "bg-purple-500/15", borderColor: "border-purple-500/30" },
  cyan: { color: "text-cyan-400", bgColor: "bg-cyan-500/15", borderColor: "border-cyan-500/30" },
  rose: { color: "text-rose-400", bgColor: "bg-rose-500/15", borderColor: "border-rose-500/30" },
  indigo: { color: "text-indigo-400", bgColor: "bg-indigo-500/15", borderColor: "border-indigo-500/30" },
  teal: { color: "text-teal-400", bgColor: "bg-teal-500/15", borderColor: "border-teal-500/30" },
};

export function normalizeBoard(raw: any): ForumBoard {
  const palette = BOARD_PALETTE[raw.color] || BOARD_PALETTE.emerald;
  return {
    code: raw.code,
    nameKey: raw.nameKey || `board.${raw.code}`,
    descKey: raw.descKey || `board.${raw.code}Desc`,
    names: (raw.names as Record<string, string>) || undefined,
    descriptions: (raw.descriptions as Record<string, string>) || undefined,
    color: palette.color,
    bgColor: palette.bgColor,
    borderColor: palette.borderColor,
    icon: raw.icon || "BookOpen",
    sort_order: raw.sort_order ?? 0,
    is_enabled: raw.is_enabled ?? true,
    show_in_feed: raw.show_in_feed ?? raw.showInFeed ?? true,
  };
}

/** 板块显示名：有 translator 时以 board.* 词条为权威，否则走 names 的语言回退链。 */
export function boardDisplayName(board: ForumBoard, locale?: string, t?: (k: string) => string): string {
  return localizedBoardText(board.nameKey, board.code, board.names, locale, t);
}

/** 板块多语言描述：有 translator 时以 board.*Desc 词条为权威，否则走 descriptions 的语言回退链。 */
export function boardDisplayDesc(board: ForumBoard, locale?: string, t?: (k: string) => string): string {
  return localizedBoardText(board.descKey, board.code, board.descriptions, locale, t, "");
}

function localizedBoardText(
  key: string,
  code: string,
  values: Record<string, string> | undefined,
  locale?: string,
  t?: (k: string) => string,
  fallback = code
): string {
  if (t) {
    const translated = (() => { try { const v = t(key); return v !== key ? v : ""; } catch { return ""; } })();
    if (translated) return translated;
  }
  const loc = locale || "zh-CN";
  if (values) {
    if (values[loc]) return values[loc];
    const prefix = loc.slice(0, 2);
    for (const [k, v] of Object.entries(values)) {
      if (k.startsWith(prefix) && v) return v;
    }
    if (values["zh-CN"]) return values["zh-CN"];
    if (values["en-US"]) return values["en-US"];
    for (const v of Object.values(values)) {
      if (v) return v;
    }
  }
  return fallback;
}


const VIRTUAL_ALL_BOARD: ForumBoard = {
  code: "all",
  nameKey: "board.all",
  descKey: "board.allDesc",
  names: { "zh-CN": "全部分区", "en-US": "All Boards" },
  descriptions: { "zh-CN": "全站论坛讨论总览", "en-US": "All forum boards overview" },
  color: "text-gray-300",
  bgColor: "bg-gray-500/20",
  borderColor: "border-gray-500/40",
  icon: "Layers",
};

let boardsCache: ForumBoard[] | null = null;
let boardsCacheAt = 0;
const BOARDS_TTL_MS = 5 * 60 * 1000;

// nameKey/descKey 复用既有翻译：board.announcement / board.casual / board.qa / board.reviews / board.bug_report / board.comment
const FALLBACK_BOARDS: ForumBoard[] = [
  VIRTUAL_ALL_BOARD,
  {
    code: "announcement",
    nameKey: "board.announcement",
    descKey: "board.announcementDesc",
    names: { "zh-CN": "站点公告", "en-US": "Announcements" },
    descriptions: { "zh-CN": "站点公告与运营通知", "en-US": "Announcements & operations" },
    color: "text-amber-400",
    bgColor: "bg-amber-500/15",
    borderColor: "border-amber-500/30",
    icon: "Megaphone",
    sort_order: 10,
    is_enabled: true,
    show_in_feed: true,
  },
  {
    code: "casual",
    nameKey: "board.casual",
    descKey: "board.casualDesc",
    names: { "zh-CN": "闲聊杂谈", "en-US": "Casual Chat" },
    descriptions: { "zh-CN": "轻松闲聊与站内日常交流", "en-US": "Casual chat & discussions" },
    color: "text-purple-400",
    bgColor: "bg-purple-500/15",
    borderColor: "border-purple-500/30",
    icon: "Coffee",
    sort_order: 20,
    is_enabled: true,
    show_in_feed: true,
  },
  {
    code: "qa",
    nameKey: "board.qa",
    descKey: "board.qaDesc",
    names: { "zh-CN": "求助答疑", "en-US": "Q&A" },
    descriptions: { "zh-CN": "使用问题、编目与功能答疑", "en-US": "Questions, cataloging & help" },
    color: "text-teal-400",
    bgColor: "bg-teal-500/15",
    borderColor: "border-teal-500/30",
    icon: "Hash",
    sort_order: 30,
    is_enabled: true,
    show_in_feed: true,
  },
  {
    code: "reviews",
    nameKey: "board.reviews",
    descKey: "board.reviewsDesc",
    names: { "zh-CN": "考据评注", "en-US": "Archive Reviews" },
    descriptions: { "zh-CN": "版本考证、原盘评析与文献释读", "en-US": "Edition analysis & archive reviews" },
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/15",
    borderColor: "border-emerald-500/30",
    icon: "BookOpen",
    sort_order: 40,
    is_enabled: true,
    show_in_feed: true,
  },
  {
    code: "bug_report",
    nameKey: "board.bug_report",
    descKey: "board.bug_reportDesc",
    names: { "zh-CN": "反馈与建议", "en-US": "Feedback & Bug Reports" },
    descriptions: { "zh-CN": "缺陷反馈、功能建议与复现信息", "en-US": "Bug reports & feature feedback" },
    color: "text-rose-400",
    bgColor: "bg-rose-500/15",
    borderColor: "border-rose-500/30",
    icon: "Bug",
    sort_order: 50,
    is_enabled: true,
    show_in_feed: true,
  },
  {
    code: "comment",
    nameKey: "board.comment",
    descKey: "board.commentDesc",
    names: { "zh-CN": "评论专用", "en-US": "Comments" },
    descriptions: { "zh-CN": "作品与讨论的评论承载区，不进入信息流与全站聚合", "en-US": "Comment carrier for works & topics, excluded from feeds" },
    color: "text-sky-400",
    bgColor: "bg-sky-500/15",
    borderColor: "border-sky-500/30",
    icon: "MessageCircle",
    sort_order: 60,
    is_enabled: true,
    show_in_feed: false,
  },
];

export const FORUM_BOARDS: ForumBoard[] = FALLBACK_BOARDS;

export async function fetchBoards(opts?: { force?: boolean }): Promise<ForumBoard[]> {
  const now = Date.now();
  if (!opts?.force && boardsCache && now - boardsCacheAt < BOARDS_TTL_MS) return boardsCache;
  try {
    const raw = await fetchApi<any[]>("/community/boards");
    const normalized = raw.map((r: any) => normalizeBoard(r));
    const result: ForumBoard[] = [VIRTUAL_ALL_BOARD, ...normalized.filter((b) => b.code !== "all")];
    boardsCache = result;
    boardsCacheAt = now;
    try {
      if (typeof window !== "undefined") localStorage.setItem("mf_boards_cache", JSON.stringify({ at: now, boards: result }));
    } catch {}
    return result;
  } catch {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem("mf_boards_cache");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.boards && Array.isArray(parsed.boards) && now - parsed.at < BOARDS_TTL_MS * 3) {
            boardsCache = parsed.boards;
            boardsCacheAt = parsed.at;
            return parsed.boards as ForumBoard[];
          }
        }
      } catch {}
    }
    boardsCache = FALLBACK_BOARDS;
    boardsCacheAt = now;
    return FALLBACK_BOARDS;
  }
}

export function getBoardSync(code: string, boards?: ForumBoard[]): ForumBoard {
  const list = boards || boardsCache || FALLBACK_BOARDS;
  return list.find((b) => b.code === code) || list.find((b) => b.code === "announcement") || VIRTUAL_ALL_BOARD;
}

/**
 * 论坛分享：优先使用系统原生分享面板，失败或不支持时降级为剪贴板复制
 * 返回 'shared' | 'copied' | 'failed' 供调用方展示反馈
 */
export async function shareContent(opts: { title: string; text?: string; url: string }): Promise<'shared' | 'copied' | 'failed'> {
  const url = opts.url;
  // 1) 尝试 Web Share API (移动端最友好)
  try {
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      const canShare = !(navigator as any).canShare || (navigator as any).canShare({ title: opts.title, text: opts.text, url });
      if (canShare) {
        await (navigator as any).share({ title: opts.title, text: opts.text, url });
        return 'shared';
      }
    }
  } catch (e: any) {
    // 用户取消分享（AbortError）视为未失败，不再尝试剪贴板
    if (e && (e.name === 'AbortError' || String(e.message || '').includes('Abort'))) {
      return 'failed';
    }
  }

  // 2) 降级：剪贴板复制
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch {}

  // 3) 最后兜底：创建一个隐藏 textarea 执行 copy
  try {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function buildShareUrl(topicId: string, highlightPostId?: string): string {
  if (typeof window === 'undefined') return `/community/${topicId}`;
  const base = window.location.origin;
  const hash = highlightPostId ? `#post-${highlightPostId}` : '';
  return `${base}/community/${topicId}${hash}`;
}

function readLocaleCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export async function createTopic(payload: CreateTopicPayload): Promise<DiscussionTopic> {
  return fetchApi<DiscussionTopic>("/community/topics", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createPost(topicId: string, payload: CreatePostPayload): Promise<ForumPost> {
  return fetchApi<ForumPost>(`/community/topics/${topicId}/posts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

let refreshPromise: Promise<string | null> | null = null;

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("metafusion_token");
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("metafusion_refresh_token");
}

export function setAuthTokens(accessToken: string, refreshToken?: string | null): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("metafusion_token", accessToken);
  if (refreshToken) {
    localStorage.setItem("metafusion_refresh_token", refreshToken);
  }
}

export function clearAuthTokens(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("metafusion_token");
  localStorage.removeItem("metafusion_refresh_token");
}

async function requestTokenRefresh(): Promise<string | null> {
  // 后端 /auth/refresh 以 Bearer/Cookie 识别调用方，不读 body 里的 refresh_token；
  // HttpOnly Cookie 会随同源请求自动携带，因此没有存储 refresh_token 也能续期。
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        clearAuthTokens();
        return null;
      }

      const data = await res.json();
      const newAccessToken = data.access_token || data.token;
      const newRefreshToken = data.refresh_token;

      if (newAccessToken) {
        setAuthTokens(newAccessToken, newRefreshToken);
        return newAccessToken;
      } else {
        clearAuthTokens();
        return null;
      }
    } catch {
      clearAuthTokens();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let token = getAccessToken();
  const locale = typeof window !== "undefined" ? readLocaleCookie() : null;
  const headers: Record<string, string> = {
    ...(!(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (locale) {
    if (!headers["x-locale"] && !headers["X-Locale"]) headers["x-locale"] = locale;
    if (!headers["Accept-Language"]) headers["Accept-Language"] = locale;
  }
  const baseUrl = getApiBase();
  let res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  });

  // 处理 401 Unauthorized：静默续期后重试一次（凭 HttpOnly Cookie，无需 refresh_token）。
  const isAuthEndpoint =
    endpoint.startsWith("/auth/login") ||
    endpoint.startsWith("/auth/register") ||
    endpoint.startsWith("/auth/refresh") ||
    endpoint.startsWith("/auth/logout");

  if (res.status === 401 && !isAuthEndpoint && (getRefreshToken() || getAccessToken())) {
    const freshToken = await requestTokenRefresh();
    if (freshToken) {
      headers["Authorization"] = `Bearer ${freshToken}`;
      res = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers,
      });
    }
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function uploadAvatar(file: File): Promise<{ avatar_url: string; user: User; message: string }> {
  const formData = new FormData();
  formData.append("avatar", file);
  return fetchApi<{ avatar_url: string; user: User; message: string }>("/auth/avatar", {
    method: "POST",
    body: formData,
  });
}

export async function deleteAvatar(): Promise<{ avatar_url: string; user: User; message: string }> {
  return fetchApi<{ avatar_url: string; user: User; message: string }>("/auth/avatar", {
    method: "DELETE",
  });
}


export async function fetchDirectMessages(
  userId: string,
  page = 1,
  pageSize = 50
): Promise<{ peer: User; messages: DirectMessage[]; total: number; page: number }> {
  return fetchApi(`/messages/with/${userId}?page=${page}&page_size=${pageSize}`);
}

export async function sendDirectMessage(userId: string, content: string): Promise<DirectMessage> {
  return fetchApi<DirectMessage>(`/messages/with/${userId}`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

// 修订历史走实体端点 /catalog/entities/:id/revisions：返回 {id,version,actor_*,edit_note,
// sources,snapshot,created_at}。编辑类型与字段级 diff 由前端对比相邻快照得出。
export async function fetchEntityRevisions(targetId: string): Promise<{ items: EntityRevision[]; total: number }> {
  const res = await fetchApi<{ items: Record<string, any>[] }>(`/catalog/entities/${targetId}/revisions`);
  const rows = res.items || [];
  const items: EntityRevision[] = rows.map((row, i) => {
    const sources = Array.isArray(row.sources) ? row.sources : [];
    const prev = i + 1 < rows.length ? rows[i + 1]?.snapshot : undefined;
    return {
      id: String(row.id ?? ""),
      target_type: String(row.snapshot?.kind ?? ""),
      target_id: targetId,
      edit_type: Number(row.version) === 1 ? "create" : "update",
      summary: "",
      edit_note: row.edit_note || "",
      source_urls: sources.map((s: any) => s?.url).filter(Boolean),
      before_state: prev || {},
      after_state: row.snapshot || {},
      diff: diffSnapshots(prev, row.snapshot),
      status: String(row.snapshot?.status ?? ""),
      created_at: row.created_at,
      editor: row.actor_id
        ? { id: row.actor_id, username: row.actor_name || "system", role: row.actor_role || "editor" } as User
        : undefined,
    };
  });
  return { items, total: items.length };
}

// diffSnapshots 对相邻两个实体快照做字段级对比：标量与常用结构字段逐项比较，
// attributes/translations 按键比较。值经 JSON 归一后比较，避免顺序差异误报。
function diffSnapshots(before: any, after: any): Record<string, { old: any; new: any }> {
  const diff: Record<string, { old: any; new: any }> = {};
  const norm = (v: any) => JSON.stringify(v === undefined ? null : v);
  const put = (key: string, o: any, n: any) => {
    if (norm(o) !== norm(n)) diff[key] = { old: o ?? null, new: n ?? null };
  };
  const b = before || {};
  const a = after || {};
  for (const key of ["title", "status", "number", "position", "original_language", "summary"]) {
    put(key, b[key], a[key]);
  }
  put("types", b.types, a.types);
  put("external_ids", b.external_ids, a.external_ids);
  const attrKeys = Array.from(new Set([...Object.keys(b.attributes || {}), ...Object.keys(a.attributes || {})]));
  for (const k of attrKeys) put(`attributes.${k}`, b.attributes?.[k], a.attributes?.[k]);
  const locales = Array.from(new Set([...Object.keys(b.translations || {}), ...Object.keys(a.translations || {})]));
  for (const loc of locales) put(`translations.${loc}`, b.translations?.[loc], a.translations?.[loc]);
  return diff;
}

// 合并走实体生命周期端点：POST /catalog/entities/:id/lifecycle（action=merge 语义由
// target_id 表达，服务端把 source 并入 target 并改写引用）。
export async function mergeEntities(payload: {
  source_id: string;
  target_id: string;
  merge_note: string;
  source_urls?: string[];
}): Promise<{ message: string; target_id: string }> {
  const source = await fetchApi<{ version: number }>(`/catalog/entities/${payload.source_id}`);
  await fetchApi(`/catalog/entities/${payload.source_id}/lifecycle`, {
    method: "POST",
    body: JSON.stringify({
      expected_version: source.version,
      target_id: payload.target_id,
      edit_note: payload.merge_note,
      sources: (payload.source_urls || []).map((u) => ({ kind: "url", citation: payload.merge_note, url: u })),
    }),
  });
  return { message: "merged", target_id: payload.target_id };
}

// ── MusicBrainz 风格 PAT 管理 ──
export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTokenResponse {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
  token: string;
  message: string;
}

export function listApiTokens(): Promise<{ items: ApiToken[]; total: number }> {
  return fetchApi<{ items: ApiToken[]; total: number }>("/auth/tokens");
}

export function createApiToken(payload: { name: string; scopes?: string[]; expires_at?: string | null }): Promise<CreateTokenResponse> {
  return fetchApi<CreateTokenResponse>("/auth/tokens", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteApiToken(id: string): Promise<{ status: string }> {
  return fetchApi<{ status: string }>(`/auth/tokens/${id}`, { method: "DELETE" });
}

// ── OmniSource Importer 多源权威数字馆藏一键导入套件 ──
export interface ImporterPreviewRequest {
  source?: string;
  url_or_id: string;
  entity_type?: string;
  media_type_hint?: string;
}

export interface ImporterTranslationItem {
  locale: string;
  title: string;
  summary: string;
  /** 同语种并列标题（后端 translate-preview 的 TranslationItem.aliases） */
  aliases?: string[];
}

export interface ImporterWorkPreview {
  title: string;
  original_title: string;
  aliases: string[];
  release_date: string;
  begin_date?: string;
  country: string;
  language: string;
  original_language?: string;
  summary: string;
  cover_image_url: string;
  cover_aspect: string;
  content_rating: string;
  tags: string[];
  translations: ImporterTranslationItem[];
  catalog_metadata?: Record<string, any>;
}

export interface ImporterArtistPreview {
  id?: string;
  name: string;
  original_name?: string;
  role: string;
  entity_type: string;
  country?: string;
  biography?: string;
  disambiguation?: string;
  language?: string;
  avatar_url?: string;
  character_name?: string;
  aliases?: string[];
  external_ids?: Record<string, any>;
  translations?: ImporterTranslationItem[];
  matched_artist?: Entity;
  /** 该关联应落到的 definitions 关系码（directed_by / voiced_by / character_in 等） */
  relation_type?: string;
  /** 角色番位词表项（primary / supplement / extra） */
  relation_role?: string;
}

export interface StaffAssociation {
  parsed_name: string;
  parsed_original?: string;
  parsed_role: string;
  entity_type: string;
  action: "create" | "link" | "skip";
  target_artist_id?: string;
  custom_role?: string;
  character_name?: string;
  country?: string;
  biography?: string;
  language?: string;
  avatar_url?: string;
  external_ids?: Record<string, any>;
  translations?: ImporterTranslationItem[];
  relation_type?: string;
  relation_role?: string;
}

export interface ImporterTrackPreview {
  position: number;
  title: string;
  duration_seconds: number;
  artist_credit?: string;
  isrc?: string;
  recording_mbid?: string;
  /** 手工匹配的既有表达（同 Work），优先于后端自动对齐。 */
  expression_id?: string;
  /** 该曲目对应的 canonical_entries 下标：结构绑定到本次清单的稳定节点，不靠标题传递。 */
  entry_index?: number;
}

export interface ImporterMediumPreview {
  position: number;
  number?: string;
  name: string;
  format: string;
  media_category: string;
  role?: "primary" | "supplement" | string;
  original_language?: string;
  translations?: Record<string, { name?: string }>;
  tracks: ImporterTrackPreview[];
}

export interface ImporterReleasePreview {
  cover_image_url?: string;
  cover_aspect?: string;
  original_language?: string;
  translations?: Record<string, { edition_name?: string; notes?: string }>;
  edition_name: string;
  catalog_number?: string;
  barcode?: string;
  publisher?: string;
  packaging?: string;
  country?: string;
  language?: string;
  distribution_channel?: string;
  edition_date?: string;
  notes?: string;
  catalog_metadata?: Record<string, any>;
}

export interface ImporterCanonicalEntryPreview {
  title: string;
  translations?: Record<string, { title?: string; summary?: string }>;
  position: number;
  number?: string;
  entry_role?: string;
  original_language?: string;
  duration_seconds?: number;
  attributes?: Record<string, any>;
  external_ids?: Record<string, any>;
  /** 落库层级：content_unit（篇目/分集）或 expression（默认，录音/正文）。 */
  entry_kind?: string;
  /** 同一 canonical_entries 数组内父级下标（章节树），顶层省略或为 -1。 */
  parent_index?: number;
  /** 手工匹配的既有表达（可跨 Work），优先于自动对齐。 */
  expression_id?: string;
}

export interface ImporterPreviewResponse {
  source: string;
  entity_type?: string;
  external_id: string;
  external_url: string;
  media_type: string;
  work?: ImporterWorkPreview;
  artist?: ImporterArtistPreview;
  artists?: ImporterArtistPreview[];
  has_release?: boolean;
  canonical_entries?: ImporterCanonicalEntryPreview[];
  release?: ImporterReleasePreview | null;
  mediums?: ImporterMediumPreview[];
  tags: string[];
  /** 来源抓取不完整等告警（如分集 total 与实取不符），前端需提示而非当作完整。 */
  warnings?: string[];
}

export interface ImporterImportRequest {
  entity_type?: string;
  source?: string;
  url_or_id?: string;
  external_id?: string;
  media_type_hint?: string;
  work?: ImporterWorkPreview;
  artist?: ImporterArtistPreview;
  artists?: ImporterArtistPreview[];
  staff_associations?: StaffAssociation[];
  has_release?: boolean;
  canonical_entries?: ImporterCanonicalEntryPreview[];
  release?: ImporterReleasePreview | null;
  mediums?: ImporterMediumPreview[];
  download_cover?: boolean;
  edit_note?: string;
  source_urls?: string[];
  is_master_verified?: boolean;
  target_work_id?: string;
  link_mode?: "new_work" | "append_release_to_work" | "merge_translations" | "create_relation";
  relation_type?: string;
}

export interface ImporterImportResponse {
  success: boolean;
  entity_type?: string;
  work_id?: string;
  release_id?: string;
  artist_id?: string;
  /** 落库后返回的目标实体（work / release / agent 统一 DTO）。 */
  work?: Entity;
  release?: Entity;
  artist?: Entity;
  imported_counts: {
    artists: number;
    mediums: number;
    tracks: number;
    /** 落库的篇目/分集数（ContentUnit）。 */
    content_units?: number;
  };
  redirect_url: string;
}

export function previewExternalCatalog(payload: ImporterPreviewRequest): Promise<ImporterPreviewResponse> {
  return fetchApi<ImporterPreviewResponse>("/importer/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function importExternalCatalog(payload: ImporterImportRequest): Promise<ImporterImportResponse> {
  return fetchApi<ImporterImportResponse>("/importer/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── 插件系统 (Plugin System) ──

export interface PluginConfigField {
  key: string;
  label: string;
  type: string; // "string" | "password" | "number" | "boolean" | "select" | "textarea"
  default_value?: any;
  description?: string;
  required?: boolean;
  options?: string[];
}

export interface PluginConfigSchema {
  fields: PluginConfigField[];
}

export interface PluginHealthStatus {
  status: "healthy" | "warning" | "unhealthy" | "disabled" | "unknown";
  message: string;
  latency_ms: number;
  last_checked: string;
}

export interface PluginItem {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  type: "native" | "external_http" | "webhook";
  endpoint_url?: string;
  capabilities: string[];
  dependencies?: Record<string, string>;
  dependents?: string[];
  dependency_status?: "satisfied" | "missing_dependencies" | "unmet_versions" | "inactive_dependencies" | string;
  missing_dependencies?: string[];
  inactive_dependencies?: string[];
  load_order?: number;
  config_schema: PluginConfigSchema;
  config: Record<string, any>;
  is_enabled: boolean;
  is_system: boolean;
  health: PluginHealthStatus;
  supported_sources?: string[];
  supported_formats?: string[];
  supported_events?: string[];
  created_at: string;
  updated_at: string;
}

export interface RegisterExternalPluginPayload {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  icon?: string;
  type?: string;
  endpoint_url: string;
  secret_token?: string;
  capabilities: string[];
  dependencies?: Record<string, string>;
  config_schema?: PluginConfigSchema;
  config?: Record<string, any>;
  is_enabled?: boolean;
}

export interface UpdatePluginPayload {
  is_enabled?: boolean;
  config?: Record<string, any>;
  cascade?: boolean;
}

export function fetchPublicPlugins(capability?: string): Promise<{ items: PluginItem[]; count: number }> {
  const query = capability ? `?capability=${encodeURIComponent(capability)}` : "";
  return fetchApi<{ items: PluginItem[]; count: number }>(`/plugins${query}`);
}

export function fetchAdminPlugins(): Promise<{ items: PluginItem[]; count: number }> {
  return fetchApi<{ items: PluginItem[]; count: number }>("/admin/plugins");
}

export function fetchAdminPlugin(id: string): Promise<PluginItem> {
  return fetchApi<PluginItem>(`/admin/plugins/${id}`);
}

export function registerExternalPlugin(payload: RegisterExternalPluginPayload): Promise<{ message: string; plugin: PluginItem }> {
  return fetchApi<{ message: string; plugin: PluginItem }>("/admin/plugins", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePlugin(id: string, payload: UpdatePluginPayload): Promise<{ message: string; plugin: PluginItem }> {
  return fetchApi<{ message: string; plugin: PluginItem }>(`/admin/plugins/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deletePlugin(id: string): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/admin/plugins/${id}`, {
    method: "DELETE",
  });
}

export function testPluginHealth(id: string): Promise<PluginHealthStatus> {
  return fetchApi<PluginHealthStatus>(`/admin/plugins/${id}/test`, {
    method: "POST",
  });
}

export function testPluginNotification(): Promise<{ message: string }> {
  return fetchApi<{ message: string }>("/admin/plugins/test-notify", {
    method: "POST",
  });
}

// ── 外部权威数据库预设定义 ──
export interface ExternalDatabaseDefinition {
  code: string;
  /** 四语名称映射；zh-CN 为必填基准。 */
  names: Record<string, string>;
  /** 适用实体 kind："all" 或固定八实体 kind 之一。 */
  category: string;
  url_pattern: string;
  icon: string;
  icon_url: string;
  validation_regex: string;
  description: string;
  sort_order: number;
  is_enabled: boolean;
  is_system: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ExternalLinkDisplay {
  code: string;
  name: string;
  icon: string;
  icon_url: string;
  external_id: string;
  url: string;
}

export function fetchExternalDatabases(category?: string): Promise<{ items: ExternalDatabaseDefinition[] }> {
  const q = category ? `?category=${encodeURIComponent(category)}` : "";
  // 统一通过主系统 /api/catalog/external-databases 获取
  return fetch(`/api/catalog/external-databases${q}`, { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) return { items: [] };
      return res.json();
    })
    .catch(() => ({ items: [] }));
}

export function fetchAdminExternalDatabases(): Promise<{ items: ExternalDatabaseDefinition[] }> {
  return fetch("/api/admin/external-databases", { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json();
    });
}

export function createExternalDatabase(data: Partial<ExternalDatabaseDefinition>): Promise<{ message: string; data: ExternalDatabaseDefinition }> {
  return fetch("/api/admin/external-databases", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  });
}

export function updateExternalDatabase(code: string, data: Partial<ExternalDatabaseDefinition>): Promise<{ message: string; data: ExternalDatabaseDefinition }> {
  return fetch(`/api/admin/external-databases/${encodeURIComponent(code)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  });
}

export function deleteExternalDatabase(code: string): Promise<{ message: string }> {
  return fetch(`/api/admin/external-databases/${encodeURIComponent(code)}`, {
    method: "DELETE",
    credentials: "same-origin",
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  });
}

// ── 目录关系图谱拓扑与关系边 ──
// ── OOBE 开箱初始化设置 ──
export interface SetupStatusResponse {
  is_initialized: boolean;
  has_admin: boolean;
  site_name: string;
  total_users: number;
}

export interface InitialSetupPayload {
  username: string;
  display_name?: string;
  email: string;
  password: string;
  site_name?: string;
  registration_enabled?: boolean;
  invite_required?: boolean;
}

export interface InitialSetupResult {
  message: string;
  user: User;
  token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export async function fetchSetupStatus(): Promise<SetupStatusResponse> {
  try {
    const res = await fetch("/api/setup", { credentials: "same-origin" });
    if (res.ok) {
      const data = await res.json();
      return { is_initialized: !data.needed, has_admin: !data.needed, site_name: "MetaFusion", total_users: 1 };
    }
  } catch {}
  return { is_initialized: true, has_admin: true, site_name: "MetaFusion", total_users: 1 };
}

export interface PublicAuthSettings {
  registration_enabled: boolean;
  invite_required: boolean;
  require_email_verification: boolean;
  email_verification_enabled: boolean;
  rate_limit_enabled?: boolean;
  auth_rate_limit_enabled?: boolean;
}

export function fetchAuthSettings(): Promise<PublicAuthSettings> {
  return fetchApi<PublicAuthSettings>("/auth/settings");
}

export async function performInitialSetup(payload: InitialSetupPayload): Promise<InitialSetupResult> {
  const setupRes = await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: payload.username,
      email: payload.email,
      password: payload.password,
    }),
  });
  if (!setupRes.ok) {
    const err = await setupRes.json().catch(() => ({}));
    throw new Error(err.error || "setup_failed");
  }
  const user = await setupRes.json();
  const loginRes = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: payload.username,
      password: payload.password,
    }),
  });
  const loginData = loginRes.ok ? await loginRes.json() : {};
  return {
    message: "setup_success",
    user: loginData.user || user,
    token: loginData.token || "",
    access_token: loginData.token || "",
    refresh_token: "",
    expires_in: 86400,
    token_type: "Bearer",
  };
}

// ── 系统健康监控与任务队列治理 (Health & Asynq Queues) ──
export interface ComponentHealthInfo {
  status: "healthy" | "warning" | "unhealthy";
  latency_ms: number;
  message?: string;
  details?: Record<string, any>;
  last_checked: string;
}

export interface QueueStatItem {
  queue: string;
  memory_usage: number;
  latency_ms: number;
  size: number;
  active: number;
  pending: number;
  scheduled: number;
  retry: number;
  archived: number;
  completed: number;
  paused: boolean;
  timestamp: string;
}

export interface SystemHealthDetail {
  status: "healthy" | "warning" | "unhealthy";
  timestamp: string;
  components: Record<string, ComponentHealthInfo>;
  queues: QueueStatItem[];
  system_stats: {
    goroutines: number;
    cpus: number;
    alloc_bytes: number;
    total_alloc: number;
    sys_bytes: number;
    num_gc: number;
    heap_alloc: number;
    heap_sys: number;
    heap_inuse: number;
    go_version: string;
  };
}

export interface QueueStatsResponse {
  queues: QueueStatItem[];
  transcode_summary: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  timestamp: string;
}

export function fetchSystemHealthDetail(): Promise<SystemHealthDetail> {
  return fetchApi<SystemHealthDetail>("/admin/system/health");
}

export function fetchSystemQueues(): Promise<QueueStatsResponse> {
  return fetchApi<QueueStatsResponse>("/admin/system/queues");
}

export function pauseQueue(name: string): Promise<{ status: string; queue: string }> {
  return fetchApi<{ status: string; queue: string }>(`/admin/system/queues/${encodeURIComponent(name)}/pause`, {
    method: "POST",
  });
}

export function unpauseQueue(name: string): Promise<{ status: string; queue: string }> {
  return fetchApi<{ status: string; queue: string }>(`/admin/system/queues/${encodeURIComponent(name)}/unpause`, {
    method: "POST",
  });
}

// ── 邮箱验证与 SMTP 接口 ──

export function sendVerificationEmail(): Promise<{ message: string; expires_in: number }> {
  return fetchApi<{ message: string; expires_in: number }>("/auth/send-verification-email", {
    method: "POST",
  });
}

export function verifyEmail(code: string): Promise<{ message: string; user: User }> {
  return fetchApi<{ message: string; user: User }>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function testSendEmail(toEmail: string): Promise<{ message: string; to_email: string }> {
  return fetchApi<{ message: string; to_email: string }>("/admin/settings/test-email", {
    method: "POST",
    body: JSON.stringify({ to_email: toEmail }),
  });
}








