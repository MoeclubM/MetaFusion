const getApiBase = () => {
  if (typeof window !== "undefined") {
    // 浏览器端：使用网关相对路径，自适应任何主机/域名/IP
    return "/api/v1";
  }
  // 服务端 (SSR)：使用容器内网
  return process.env.INTERNAL_API_URL || "http://backend:8080/api/v1";
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
  created_at?: string;
  updated_at?: string;
  inviter?: User;
}

// ── 收藏 ──
export type FavoriteTargetType = "work" | "release" | "artist" | "franchise";

export interface FavoriteItem {
  id: string;
  target_type: FavoriteTargetType;
  target_id: string;
  created_at: string;
  work?: { id: string; title: string; cover_image_url?: string };
  release?: { id: string; work_id: string; edition_name: string };
  artist?: { id: string; name: string; original_name?: string; entity_type?: string };
  franchise?: { id: string; title: string; original_title?: string; cover_image_url?: string };
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
  total_asset_files: number;
  total_storage_bytes: number;
  total_topics: number;
  total_comments: number;
}

export interface Category {
  code: string;
  parent_code?: string;
  name_zh: string;
  name_en: string;
  name?: string;
  media_type: string;
  sort_order: number;
  clc_prefix?: string;
}

export interface VirtualShelf {
  id?: string;
  slug: string;
  parent_slug?: string;
  name_zh: string;
  name_en: string;
  name?: string;
  description?: string;
  icon?: string;
  sort_order: number;
  query_tags: string[];
  require_all_tags: boolean;
  exclude_tags: string[];
  children?: VirtualShelf[];
}

/** Work browse/editor facets. spec (规格) is carrier-only and excluded. */
export const WORK_TAG_GROUPS = ["format", "medium", "genre", "theme", "general"] as const;

export function isWorkTagGroup(group: string): boolean {
  return (WORK_TAG_GROUPS as readonly string[]).includes(group);
}

export function workFacetTagGroups(groups: Record<string, Tag[]> | undefined): [string, Tag[]][] {
  return Object.entries(groups || {}).filter(([key, tags]) => isWorkTagGroup(key) && (tags?.length ?? 0) > 0);
}

export interface TaxonomyResponse {
  categories: Category[];
  shelves?: VirtualShelf[];
  tags?: Tag[];
  tag_groups?: Record<string, Tag[]>;
  media_types: DictTerm[];
  entity_types?: DictTerm[];
  roles: DictTerm[];
  packagings: DictTerm[];
  formats: { id: string; name: string }[];
  languages: { code: string; name: string }[];
}

/** 词表条目。展示名以服务端按请求 locale 填好的 name 为准，不在前端维护类型译文。 */
export type DictTerm = {
  id: string;
  name?: string;
  name_zh?: string;
  name_en?: string;
  desc?: string;
  desc_zh?: string;
  desc_en?: string;
  color?: string;
  bg_color?: string;
  border_color?: string;
  forward?: string;
  reverse?: string;
};

export function dictTermLabel(code: string | undefined | null, terms?: DictTerm[] | null): string {
  if (!code) return '';
  const hit = terms?.find((t) => t.id === code);
  if (!hit) return code;
  return (hit.name || hit.name_zh || hit.name_en || code).trim() || code;
}

/** 四类编目枢纽；其余 code 都是主体（artists）上的动态 entity_type。 */
export const CATALOG_HUBS = ['work', 'artist', 'release', 'franchise', 'canonical_entry'] as const;
export type CatalogHub = (typeof CATALOG_HUBS)[number];

export function isCatalogHub(type: string): type is CatalogHub {
  return (CATALOG_HUBS as readonly string[]).includes(type);
}

export function catalogHubOf(type: string): CatalogHub {
  const normalized = (type || '').toLowerCase();
  if (isCatalogHub(normalized)) return normalized;
  return 'artist';
}

export function getBoardName(code: string, t: (k: string) => string): string {
  return t(`board.${code}`);
}
export function getBoardDesc(code: string, t: (k: string) => string): string {
  return t(`board.${code}Desc`);
}

export function categoryDisplayName(cat: Category, locale?: string): string {
  if (cat.name && cat.name.trim()) return cat.name;
  if (locale === 'en-US' && cat.name_en) return cat.name_en;
  if (locale === 'zh-CN' && cat.name_zh) return cat.name_zh;
  return cat.name_zh || cat.name_en || cat.code;
}

export interface Tag {
  id: number;
  name: string;
  group_type: string;
}

export interface EntityTranslation {
  locale: string;
  title?: string;
  name?: string;
  summary?: string;
  biography?: string;
}

export function pickLocalized(
  locale: string,
  translations: EntityTranslation[] | undefined,
  fallbackTitle: string,
  fallbackBody?: string
): { title: string; body: string } {
  const rows = translations || [];
  const exact = rows.find((r) => r.locale === locale);
  if (exact) {
    return {
      title: (exact.title || exact.name || fallbackTitle || "").trim() || fallbackTitle,
      body: (exact.summary || exact.biography || fallbackBody || "").trim() || (fallbackBody || ""),
    };
  }
  return {
    title: (fallbackTitle || "").trim(),
    body: (fallbackBody || "").trim(),
  };
}

export interface Artist {
  id: string;
  name: string;
  original_name?: string;
  disambiguation?: string;
  entity_type: string;
  country?: string;
  biography?: string;
  language?: string;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  external_ids: Record<string, any>;
  translations?: EntityTranslation[];
}

export interface ArtistWorkItem {
  work: Work;
  role: string;
}

export interface ConnectedEntityItem {
  entity_id: string;
  entity_name: string;
  entity_type: string;
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
  color: string;
  icon: string;
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
  name_zh: string;
  name_en: string;
  names?: Record<string, string>;
  description?: string;
  forward_label_zh: string;
  reverse_label_zh: string;
  forward_label_en: string;
  reverse_label_en: string;
  allowed_source_types?: string[];
  allowed_target_types?: string[];
  is_symmetric: boolean;
  is_hierarchical: boolean;
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

export interface ArtistDetailResponse {
  artist: Artist;
  works: ArtistWorkItem[];
  releases: Release[];
  connected_entities?: ConnectedEntityItem[];
}

export interface WorkArtistRelation {
  id: number;
  work_id: string;
  artist_id: string;
  role: string;
  artist?: Artist;
}

export interface CanonicalEntry {
  id: string;
  title: string;
  sort_title?: string;
  duration?: number;
  duration_seconds?: number;
  isrc?: string;
  isbn?: string;
  artist_credit?: string;
  recording_date?: string;
  work_id?: string;
  external_ids?: Record<string, any>;
  created_at?: string;
}

export interface Track {
  id: string;
  medium_id: string;
  canonical_entry_id?: string;
  work_id?: string;
  position: number;
  title: string;
  title_override?: string;
  duration_seconds?: number;
  isrc?: string;
  artist_credit?: string;
  canonical_entry?: CanonicalEntry;
}

export interface AssetFile {
  id: string;
  release_id: string;
  medium_id?: string;
  track_id?: string;
  canonical_entry_id?: string;
  file_role: string;
  file_name: string;
  s3_bucket: string;
  s3_key: string;
  file_size: number;
  sha256_hash: string;
  mime_type: string;
  technical_specs: Record<string, any>;
  transcode_status: string;
  transcode_error?: string;
  release?: Release;
}

export interface AdminAuditLog {
  id: string;
  actor_id?: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: Record<string, any>;
  ip: string;
  created_at: string;
}

export interface Medium {
  id: string;
  release_id: string;
  position: number;
  name: string;
  format: string;
  media_category: string;
  track_count: number;
  tracks?: Track[];
  asset_files?: AssetFile[];
}

export interface Release {
  id: string;
  work_id: string;
  publisher_id?: string;
  edition_name: string;
  catalog_number?: string;
  barcode?: string;
  publisher?: string;
  packaging?: string;
  edition_date?: string;
  country?: string;
  language?: string;
  distribution_channel?: string;
  catalog_metadata?: Record<string, any>;
  uploader?: User;
  publisher_entity?: Artist;
  work?: Work;
  is_master_verified: boolean;
  notes?: string;
  mediums?: Medium[];
  asset_files?: AssetFile[];
}

export interface Work {
  id: string;
  category_code?: string;
  title: string;
  original_title?: string;
  aliases?: string[];
  release_date?: string;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  country?: string;
  language?: string;
  original_language?: string;
  summary?: string;
  cover_image_url?: string;
  content_rating?: string;
  status: string;
  view_count: number;
  favorite_count?: number;
  catalog_metadata: Record<string, any>;
  category?: Category;
  tags?: Tag[];
  artist_relations?: WorkArtistRelation[];
  releases?: Release[];
  connected_entities?: ConnectedEntityItem[];
  relations?: EntityRelationship[];
  translations?: EntityTranslation[];
  created_by?: string;
  creator?: User;
  created_at?: string;
  updated_at?: string;
}

export interface Franchise {
  id: string;
  title: string;
  original_title?: string;
  aliases?: string[];
  disambiguation?: string;
  summary?: string;
  cover_image_url?: string;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  country?: string;
  language?: string;
  external_ids?: Record<string, any>;
  catalog_metadata?: Record<string, any>;
  favorite_count?: number;
  tags?: Tag[];
  translations?: EntityTranslation[];
  created_at?: string;
}

export interface FranchiseDetailResponse {
  franchise: Franchise;
  parents?: Franchise[];
  children?: Franchise[];
  works?: Work[];
  agents?: Artist[];
  connected_entities?: ConnectedEntityItem[];
  relations?: EntityRelationship[];
}

export function catalogEntityHref(type: string, id: string): string {
  switch (catalogHubOf(type)) {
    case "work":
      return `/works/${id}`;
    case "artist":
      return `/artists/${id}`;
    case "release":
      return `/releases/${id}`;
    case "franchise":
      return `/franchises/${id}`;
    case "canonical_entry":
      return `/explore`;
    default:
      return `/artists/${id}`;
  }
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  category: string;
  role?: string;
  level: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  label: string;
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
  work_id?: string;
  release_id?: string;
  title: string;
  content: string;
  view_count: number;
  reply_count: number;
  created_at: string;
  updated_at: string;
  user?: User;
  work?: Work;
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
 * i18n: 板块名称/描述以 translation key 为权威来源（board.<code> / board.<code>Desc）。
 * name/desc / name_zh / description 为 legacy offline fallback（英文），展示层应优先用:
 *   - getBoardName(code, t) / getBoardDesc(code, t) 或
 *   - getBoardName(code, t) / getBoardDesc(code, t) / boardDisplayName(board, locale, t) / normalizeBoard 增强
 * 后端已下发的 name_en / name_zh 若存在仍可作为次级回退，但不应直接渲染硬编码中文。
 */
export interface ForumBoard {
  code: string;
  /** legacy fallback fields — 展示层请勿直接用，优先走 t(`board.${code}`) */
  name_zh: string;
  name_en?: string;
  name: string;
  description?: string;
  desc: string;
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

export function normalizeBoard(raw: any, t?: (k: string) => string): ForumBoard {
  const palette = BOARD_PALETTE[raw.color] || BOARD_PALETTE.emerald;
  const nameKey = raw.nameKey || `board.${raw.code}`;
  const descKey = raw.descKey || `board.${raw.code}Desc`;
  // 若传入 t，优先以 i18n 键为准；否则以 name_en / name 作为英文 fallback，绝不回落硬编码中文
  const nameEnFromT = t && raw.code ? (() => { try { const v = t(nameKey); return v !== nameKey ? v : ""; } catch { return ""; } })() : "";
  const nameZh = raw.name_zh || raw.name || raw.code;
  const nameEn = raw.name_en || nameEnFromT || "";
  const names = raw.names as Record<string, string> | undefined;
  const resolvedName = raw.name && raw.name !== nameZh ? raw.name : (names ? (names["zh-CN"] || names["en-US"] || nameZh) : (nameZh || nameEn));
  const name = raw.name && typeof raw.name === "string" && raw.name.trim() !== "" && raw.name !== nameZh ? raw.name : (nameEnFromT || nameZh || nameEn || raw.code);
  const desc = raw.description ?? raw.desc ?? "";
  return {
    code: raw.code,
    nameKey,
    descKey,
    name_zh: nameZh,
    name_en: nameEn,
    name: name || resolvedName || nameZh,
    description: desc,
    desc,
    color: palette.color,
    bgColor: palette.bgColor,
    borderColor: palette.borderColor,
    icon: raw.icon || "BookOpen",
    sort_order: raw.sort_order ?? 0,
    is_enabled: raw.is_enabled ?? true,
    show_in_feed: raw.show_in_feed ?? raw.showInFeed ?? true,
  };
}

/**
 * 板块显示名：
 * - 若传入 t：以 t(board.code) 为权威（复用 messages 中 board.all / board.announcement 等既有词条），不渲染硬编码中文
 * - 否则按 locale 分支取后端 name_en / name，legacy name_zh 仅作最末兜底
 */
export function boardDisplayName(board: ForumBoard, locale?: string, t?: (k: string) => string): string {
  if (t) {
    // t 分支已国际化，直接取翻译键；若 key 缺失则 t 会返回 key 本身，回落到 name_en / code
    const translated = (() => { try { const v = t(board.nameKey || `board.${board.code}`); return v !== (board.nameKey || `board.${board.code}`) ? v : ""; } catch { return ""; } })();
    if (translated) return translated;
  }
  if (locale === "en-US" && board.name_en) return board.name_en;
  if (locale === "zh-CN") return board.name_zh;
  // fallback 链：优先非中文的 name_en / name，再到 code；避免在 locale===en-US 时误回中文
  if (board.name_en) return board.name_en;
  if (board.name && board.name !== board.name_zh) return board.name;
  return board.name_zh || board.code;
}

const VIRTUAL_ALL_BOARD: ForumBoard = {
  code: "all",
  nameKey: "board.all",
  descKey: "board.allDesc",
  // legacy offline fallbacks — 英文，不再直接渲染中文；中文由 t(board.all) 提供
  name_zh: "All Boards",
  name: "All Boards",
  name_en: "All Boards",
  description: "All forum boards overview",
  desc: "All forum boards overview",
  color: "text-gray-300",
  bgColor: "bg-gray-500/20",
  borderColor: "border-gray-500/40",
  icon: "Layers",
};

let boardsCache: ForumBoard[] | null = null;
let boardsCacheAt = 0;
const BOARDS_TTL_MS = 5 * 60 * 1000;

// nameKey/descKey 复用既有翻译：board.announcement / board.bug_report / board.comment 均已在 messages 中存在
const FALLBACK_BOARDS: ForumBoard[] = [
  VIRTUAL_ALL_BOARD,
  { code: "announcement", nameKey: "board.announcement", descKey: "board.announcementDesc", name_zh: "Announcements", name: "Announcements", name_en: "Announcements", description: "Announcements & operations", desc: "Announcements & operations", color: "text-amber-400", bgColor: "bg-amber-500/15", borderColor: "border-amber-500/30", icon: "Megaphone", show_in_feed: true },
  { code: "bug_report", nameKey: "board.bug_report", descKey: "board.bug_reportDesc", name_zh: "Bug Reports", name: "Bug Reports", name_en: "Bug Reports", description: "Bug reports & reproductions", desc: "Bug reports & reproductions", color: "text-rose-400", bgColor: "bg-rose-500/15", borderColor: "border-rose-500/30", icon: "Bug", show_in_feed: true },
  { code: "comment", nameKey: "board.comment", descKey: "board.commentDesc", name_zh: "Comments Only", name: "Comments Only", name_en: "Comments Only", description: "Comment carrier for works & topics, excluded from feeds", desc: "Comment carrier for works & topics, excluded from feeds", color: "text-sky-400", bgColor: "bg-sky-500/15", borderColor: "border-sky-500/30", icon: "MessageCircle", show_in_feed: false },
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

export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("metafusion_token") : null;
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
  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  });

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


export interface UserCustomShelf {
  id: string;
  owner_id: string;
  slug: string;
  name_zh: string;
  name_en: string;
  description?: string;
  icon?: string;
  sort_order: number;
  query_tags: string[];
  require_all_tags: boolean;
  exclude_tags: string[];
  is_public: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface UserHomeLayout {
  hidden_system_slugs: string[];
  order_json: string[];
}

export function syncPresetShelves(overwrite: boolean = false): Promise<{ items: UserCustomShelf[]; order: string[] }> {
  return fetchApi<{ items: UserCustomShelf[]; order: string[] }>("/catalog/shelves/custom/sync-presets", {
    method: "POST",
    body: JSON.stringify({ overwrite }),
  });
}

export function forkPresetShelf(slug: string): Promise<{ shelf: UserCustomShelf; order: string[] }> {
  return fetchApi<{ shelf: UserCustomShelf; order: string[] }>(`/catalog/shelves/custom/fork/${slug}`, {
    method: "POST",
  });
}

export function ensureDefaultShelves(): Promise<{ items: UserCustomShelf[]; order: string[] }> {
  return fetchApi<{ items: UserCustomShelf[]; order: string[] }>("/catalog/shelves/custom/ensure-defaults", {
    method: "POST",
  });
}

export function resetDefaultShelves(): Promise<{ items: UserCustomShelf[]; order: string[] }> {
  return fetchApi<{ items: UserCustomShelf[]; order: string[] }>("/catalog/shelves/custom/reset-defaults", {
    method: "POST",
  });
}

export function updateWorkStatus(id: string, status: string): Promise<{ status: string; work_status: string }> {
  return fetchApi<{ status: string; work_status: string }>(`/admin/works/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
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

export async function fetchEntityRevisions(targetType: string, targetId: string): Promise<{ items: EntityRevision[]; total: number }> {
  return fetchApi<{ items: EntityRevision[]; total: number }>(`/catalog/revisions?target_type=${targetType}&target_id=${targetId}`);
}

export async function updateWork(id: string, payload: Record<string, any>): Promise<{ status: string; work: Work }> {
  return fetchApi<{ status: string; work: Work }>(`/catalog/works/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function updateArtist(id: string, payload: Record<string, any>): Promise<{ status: string; artist: Artist }> {
  return fetchApi<{ status: string; artist: Artist }>(`/catalog/artists/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function updateRelease(id: string, payload: Record<string, any>): Promise<{ status: string; release: Release }> {
  return fetchApi<{ status: string; release: Release }>(`/catalog/releases/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function updateFranchise(id: string, payload: Record<string, any>): Promise<{ status: string; franchise: Franchise }> {
  return fetchApi<{ status: string; franchise: Franchise }>(`/catalog/franchises/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function mergeEntities(payload: {
  target_type: string;
  source_id: string;
  target_id: string;
  merge_note: string;
  source_urls?: string[];
}): Promise<{ message: string; target_id: string }> {
  return fetchApi<{ message: string; target_id: string }>("/catalog/merge", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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

