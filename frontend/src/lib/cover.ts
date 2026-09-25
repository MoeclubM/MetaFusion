/**
 * 封面比例推断。
 * 作品没有 media_type 字段，分类依赖标签 + 虚拟货架 channel，
 * 这里仅根据标签关键词猜测封面惯例比例：
 *   音乐类（专辑/单曲/EP/OST）→ 1:1
 *   影视海报类（电影/剧集/动画）→ 2:3
 *   书籍类（小说/漫画）→ 3:4
 */

export type CoverTagInput = string | { name?: string } | null | undefined;

/** 调用方显式指定的展示比例（如 "1:1"/"2:3"/"3:4"）：不是数据库字段，空/未知 = 走推断与自然比例 */
export function parseManualRatio(aspect?: string | null): number | null {
  if (!aspect) return null;
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

const SQUARE_EXACT = [
  "album", "single", "ep", "lp", "cd", "ost",
  "专辑", "单曲", "迷你专辑", "原声带", "原声", "配乐", "唱片", "音乐",
];

const POSTER_KEYWORDS = [
  "movie", "film", "series", "anime", "tv", "theatrical", "ova", "special",
  "电影", "影片", "剧场版", "映画", "动画", "動畫", "剧集", "電視劇", "电视剧", "特摄", "特攝", "海报", "海報",
];

const BOOK_KEYWORDS = [
  "novel", "book", "comic", "manga", "light novel",
  "小说", "小說", "轻小说", "輕小說", "漫画", "漫畫", "书籍", "書籍", "文库", "文庫", "画集", "畫集",
];

function normalizeTags(tags?: CoverTagInput[]): string[] {
  return (tags || [])
    .map((t) => (typeof t === "string" ? t : t?.name || ""))
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 返回宽高比数值（width / height），可直接用于 CSS aspect-ratio。
 */
export function inferCoverRatio(tags?: CoverTagInput[]): number {
  const names = normalizeTags(tags);
  if (names.length === 0) return 3 / 4;

  const hasSquare = names.some(
    (n) => SQUARE_EXACT.includes(n) || (n.length > 4 && SQUARE_EXACT.some((k) => n.includes(k)))
  );
  if (hasSquare) return 1;

  const hitAny = (keywords: string[]) =>
    names.some((n) => keywords.some((k) => n === k || n.includes(k)));

  if (hitAny(POSTER_KEYWORDS)) return 2 / 3;
  if (hitAny(BOOK_KEYWORDS)) return 3 / 4;
  return 3 / 4;
}

/**
 * 封面容器允许的比例区间（宽/高）。
 * 下限 2:3 保住竖版海报/书封惯例；上限放宽到 2:1 容纳影视横剧照与横幅图。
 * 图片一律 object-fit: contain：区间内的图完整显示，超出区间的图只在边界留衬底，
 * 任何比例都不裁切主体（旧上限 1:1 配 cover 会把 2.39:1 的剧照裁掉约七成宽度）。
 */
export const MIN_COVER_ASPECT = 2 / 3;
export const MAX_COVER_ASPECT = 2;

/**
 * 网格/卡片场景的统一容器比例：同排对齐优先，取 3:4 维持目录的竖版视觉。
 * 图片按 contain 完整放入容器（见 AdaptiveCardCover），比例不合的部分留衬底
 * （像相框卡纸），不再为了填满而裁切主体。
 */
export const GRID_COVER_ASPECT = 3 / 4;

export function clampCoverRatio(ratio: number): number {
  if (!isFinite(ratio) || ratio <= 0) return GRID_COVER_ASPECT;
  return Math.min(MAX_COVER_ASPECT, Math.max(MIN_COVER_ASPECT, ratio));
}

/**
 * 封面派生：实体自己没有 `pictures` 时，按"直接关联实体"顺序借用一张。
 *
 * 为什么必须把 `origin` 一路带到界面上：目录里曾出现过把整张借来的图当成本实体自己的
 * 封面来标注的情况（把所属发行的通用美术写成"该曲官方封面"、把官网首页横幅写成
 * "官方主视觉"）。展示侧借用是合理的兜底，**不写明借自哪里**才是问题，
 * 所以 `origin !== "self"` 时调用方必须渲染 `CoverOriginNote`。
 *
 * 这里只认结构，不 import Entity：列表与详情用的是同一个 DTO，
 * 关联实体只有 id 时传 `undefined` 即可，不会误判成"有封面"。
 */
export type CoverOrigin = "self" | "release" | "work" | "subject_work" | "mother_work" | "none";

export interface CoverBearing {
  id?: string;
  title?: string;
  pictures?: Array<{ url?: string | null } | null> | null;
}

export interface ResolvedCover<T extends CoverBearing = CoverBearing> {
  url: string;
  origin: CoverOrigin;
  /** 提供这张图的实体（origin 为 self 时就是本实体；none 时为 undefined） */
  from?: T;
}

export type CoverChainHop<T extends CoverBearing = CoverBearing> = {
  origin: Exclude<CoverOrigin, "self" | "none">;
  entity: T | null | undefined;
};

/** 只看实体自己收录的第一张图；空串表示没有。 */
export const ownCoverUrl = (entity?: CoverBearing | null): string =>
  String(entity?.pictures?.[0]?.url || "").trim();

export function resolveCover<T extends CoverBearing>(
  self: T | null | undefined,
  chain: CoverChainHop<T>[] = [],
): ResolvedCover<T> {
  const own = ownCoverUrl(self);
  if (own) return { url: own, origin: "self", from: self ?? undefined };
  for (const hop of chain) {
    const url = ownCoverUrl(hop.entity);
    if (url) return { url, origin: hop.origin, from: hop.entity ?? undefined };
  }
  return { url: "", origin: "none" };
}
