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
 * 下限取 2:3、上限取 1:1：三种建议比例（音乐 1:1 / 影视 2:3 / 书籍 3:4）全部落在区间内，
 * 再宽（横图）或再窄（长图）的封面都在边界上按 `object-fit: cover` 裁掉溢出部分，
 * 因此容器既不会出现两侧留白，也不会被极端比例的图撑坏版式。
 */
export const MIN_COVER_ASPECT = 2 / 3;
export const MAX_COVER_ASPECT = 1;

/**
 * 网格/卡片场景的统一容器比例，取区间内的 3:4。
 * 同一排用同一个容器比例才能对齐；3:4 是区间内**最坏裁剪率最小**的取值：
 * 1:1 或 2:3 的容器对上异形封面最坏要裁掉 33% 的短边，3:4 最坏只裁 25%。
 */
export const GRID_COVER_ASPECT = 3 / 4;

export function clampCoverRatio(ratio: number): number {
  if (!isFinite(ratio) || ratio <= 0) return GRID_COVER_ASPECT;
  return Math.min(MAX_COVER_ASPECT, Math.max(MIN_COVER_ASPECT, ratio));
}
