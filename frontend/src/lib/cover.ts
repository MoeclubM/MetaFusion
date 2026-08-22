/**
 * 封面比例推断。
 * 作品没有 media_type 字段，分类依赖标签 + 虚拟货架 channel，
 * 这里仅根据标签关键词猜测封面惯例比例：
 *   音乐类（专辑/单曲/EP/OST）→ 1:1
 *   影视海报类（电影/剧集/动画）→ 2:3
 *   书籍类（小说/漫画）→ 3:4
 */

export type CoverTagInput = string | { name?: string } | null | undefined;

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

/** 容器比例的钳制范围，避免极端长图撑爆列表布局 */
export const MIN_COVER_RATIO = 0.45;
export const MAX_COVER_RATIO = 2.2;

export function clampCoverRatio(ratio: number): number {
  return Math.min(MAX_COVER_RATIO, Math.max(MIN_COVER_RATIO, ratio));
}
