// 由 frontend/src/lib/api.ts 按域拆分而来（机械搬运：导出名、签名、行为与拆分前一致）。
// 域：互动服务 /api/community、/api/favorites、/api/records 与 /api/messages 客户端
import { fetchApi } from "./client";
import type { Tag } from "./catalog";
import type { User } from "./client";
import type { Entity } from "@/components/catalog/api";

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

// 板块名称与描述是**内容**，不是 UI 文案：2026-09-16 起论坛不再分语言，
// 服务端的 community.boards 只有单个 name/description（见迁移 000002）。
// UI 文案（community.* 词条）仍然走 useI18n()，两者不要混。
export interface ForumBoard {
  code: string;
  name: string;
  description: string;
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
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    color: palette.color,
    bgColor: palette.bgColor,
    borderColor: palette.borderColor,
    icon: raw.icon || "BookOpen",
    sort_order: raw.sort_order ?? 0,
    is_enabled: raw.is_enabled ?? true,
    show_in_feed: raw.show_in_feed ?? raw.showInFeed ?? true,
  };
}

// 板块名与描述是**内容**、单语言（2026-09-16 起论坛不再分语言，服务端只有 name/description）。
// 名称空值时回退 code：板块身份是 code，名称缺失不该渲染成一片空白。
export function boardDisplayName(board: ForumBoard): string {
  return (board.name || "").trim() || board.code;
}

/** 描述可为空（运营配置里不是必填），为空就是空串——不拿别的字段顶上。 */
export function boardDisplayDesc(board: ForumBoard): string {
  return (board.description || "").trim();
}


const VIRTUAL_ALL_BOARD: ForumBoard = {
  code: "all",
  name: "全部分区",
  description: "全站论坛讨论总览",
  color: "text-gray-300",
  bgColor: "bg-gray-500/20",
  borderColor: "border-gray-500/40",
  icon: "Layers",
};

let boardsCache: ForumBoard[] | null = null;

let boardsCacheAt = 0;

const BOARDS_TTL_MS = 5 * 60 * 1000;

// 兜底板块清单：**仅离线兜底**——服务端不可达时展示，与 community.boards 的种子一致。
// 板块名是内容不是 UI 文案：正常一律来自服务端单字段 name/description（2026-09-16 起论坛不分语言），
// 这里的字面量是降级值，不是某个语种的版本。
const FALLBACK_BOARDS: ForumBoard[] = [
  VIRTUAL_ALL_BOARD,
  {
    code: "announcement",
    name: "站点公告",
    description: "站点公告与运营通知",
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
    name: "闲聊杂谈",
    description: "轻松闲聊与站内日常交流",
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
    name: "求助答疑",
    description: "使用问题、编目与功能答疑",
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
    name: "考据评注",
    description: "版本考证、原盘评析与文献释读",
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
    name: "反馈与建议",
    description: "缺陷反馈、功能建议与复现信息",
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
    name: "评论专用",
    description: "作品与讨论的评论承载区，不进入信息流与全站聚合",
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
