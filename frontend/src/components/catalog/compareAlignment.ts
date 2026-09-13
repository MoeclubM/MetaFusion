// 发行对比的内容对齐算法（纯函数，便于单点验证与复用）。
//
// 旧实现只按 work_id 聚合变体、并用"Expression 集合是否相等"判断仅载体差异，
// 会产生两类错误结论：
//   1) 同一作品下不同章节（不同 ContentUnit）各自有表达时，被误报为"同曲异录音"；
//   2) 同一表达的收录范围不同（完整录音 vs 片段）被漏判，仍显示"仅载体不同"。
//
// 新算法按以下顺序对齐：
//   ① 内容身份：有 content_unit_id 用章节，否则用 work_id；
//   ② 各发行实际引用的 Expression；
//   ③ 收录范围（locator/position）与重复次数、顺序；
//   ④ 载体结构（格式/盘数/轨数）。
// 只有 ①②③ 全部一致、仅 ④ 不同，才显示"仅载体不同"；资料缺失时归为"待确认"。

export interface CompareInclusionLike {
  expression_id?: string;
  position?: number;
  locator?: Record<string, any>;
}

export interface CompareTrackLike {
  id?: string;
  parent_id?: string;
  contents?: CompareInclusionLike[];
}

export interface CompareMediumLike {
  medium?: { attributes?: Record<string, any> };
  tracks?: CompareTrackLike[];
}

export interface CompareItemLike {
  media?: CompareMediumLike[];
}

export interface CompareExprEntityLike {
  work_id?: string;
  content_unit_id?: string;
}

/** 每个发行自身的目录完整性，用于区分"尚未编目"与"已确认相同"。 */
export interface CompareItemCompleteness {
  /** 有载体但没有任何曲目：结构已建、内容未录入。 */
  mediaWithoutTracks: number;
  /** 曲目存在但没有内容引用（expression）：收录未录入。 */
  tracksWithoutContents: number;
  /** 完全没有载体与曲目。 */
  empty: boolean;
}

export interface AlignmentResult {
  /** 表达 → 出现于哪些发行下标（保留原渲染口径）。 */
  perExpr: Map<string, { releaseIndex: number }[]>;
  /** 所有选中发行都收录的表达。 */
  shared: string[];
  /** 只在部分发行出现的表达。 */
  partial: { id: string; in: number[] }[];
  /** 同一内容身份下的不同表达（同章/同曲的不同录音）。 */
  workVariants: { contentKey: string; ids: string[] }[];
  /** 内容一致、仅载体结构不同。 */
  carrierOnly: [number, number][];
  /** 引用表达一致，但收录范围/重复/顺序不同（实际内容截取变化）。 */
  rangeDiffer: [number, number][];
  /** 内容与范围一致，仅本版定位不同（如页码/时间码整体平移）。 */
  locatingDiffer: [number, number][];
  /** 存在无法解析身份的表达（缺少 work/章节元数据），结论需人工确认。 */
  pendingConfirm: boolean;
  /** 目录不完整（缺曲目/内容引用）的发行下标：不得据此下内容一致性结论。 */
  incomplete: number[];
}

function locatorKey(loc?: Record<string, any>): string {
  if (!loc || Object.keys(loc).length === 0) return "";
  try {
    return JSON.stringify(loc);
  } catch {
    return "";
  }
}

// excerptExtentOf 只描述"实际截取了多少内容"，不含绝对起点：页区间长度、时间区间长度。
// 同一份译文从第 20 页排到第 25 页，长度不变，属本版定位变化而非内容变化；
// 完整 3 分钟 vs 前 30 秒则长度不同，才是真正的收录范围变化。
function excerptExtentOf(loc?: Record<string, any>): string {
  if (!loc) return "";
  const num = (v: any): number | null => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  const parts: string[] = [];
  const ps = num(loc.page_start);
  const pe = num(loc.page_end);
  if (ps !== null || pe !== null) parts.push(`p:${ps !== null && pe !== null ? pe - ps : "?"}`);
  const ts = num(loc.time_start_ms);
  const te = num(loc.time_end_ms);
  if (ts !== null || te !== null) parts.push(`t:${ts !== null && te !== null ? te - ts : "?"}`);
  return parts.join("|");
}

function contentKeyOf(exprId: string, exprEntities: Record<string, CompareExprEntityLike | undefined>): string {
  const e = exprEntities[exprId];
  if (!e) return "";
  return e.content_unit_id || e.work_id || "";
}

// 把载体的轨道列表还原成"父在前、子紧随"的树序。接口返回的是按 position 排的
// 扁平列表，而各层 position 各自起算；直接平铺会把子轨与相邻容器的子轨交错，
// 让收录顺序（进而"仅顺序不同"的判定）失真。容器轨自身的内容排在子轨之前。
function orderedTracks(tracks: CompareTrackLike[]): CompareTrackLike[] {
  const byParent = new Map<string, CompareTrackLike[]>();
  const ids = new Set<string>();
  for (const tr of tracks) if (tr.id) ids.add(tr.id);
  for (const tr of tracks) {
    // 父轨不在本载体内的孤儿节点按顶层处理，避免整棵子树消失。
    const key = tr.parent_id && ids.has(tr.parent_id) ? tr.parent_id : "";
    const list = byParent.get(key) || [];
    list.push(tr);
    byParent.set(key, list);
  }
  const out: CompareTrackLike[] = [];
  const walk = (parent: string) => {
    for (const tr of byParent.get(parent) || []) {
      out.push(tr);
      if (tr.id) walk(tr.id);
    }
  };
  walk("");
  // 极端情况下（数据成环）未被走到的节点追加在末尾，保证不丢内容。
  if (out.length < tracks.length) {
    const seen = new Set(out);
    for (const tr of tracks) if (!seen.has(tr)) out.push(tr);
  }
  return out;
}

// 每条发行上按载体→轨道→收录顺序展开两份有序指纹（都保留顺序与重复次数）：
//   seq   完整指纹（含绝对定位与轨内位置）；
//   shape 只含"内容身份＋表达＋截取长度＋顺序"，不含绝对起点。
// seq 相同＝完全相同；shape 相同而 seq 不同＝仅本版定位变化；shape 不同＝内容范围变化。
function sequenceOf(
  item: CompareItemLike,
  exprEntities: Record<string, CompareExprEntityLike | undefined>,
): { content: string[]; exprs: string[]; seq: string[]; shape: string[]; unknown: boolean } {
  const content: string[] = [];
  const exprs: string[] = [];
  const seq: string[] = [];
  const shape: string[] = [];
  let unknown = false;
  for (const m of item.media || []) {
    for (const tr of orderedTracks(m.tracks || [])) {
      for (const c of tr.contents || []) {
        const id = c.expression_id;
        if (!id) continue;
        exprs.push(id);
        const ck = contentKeyOf(id, exprEntities);
        if (!ck) unknown = true;
        content.push(ck);
        seq.push(`${ck}|${id}|${locatorKey(c.locator)}|${c.position ?? ""}`);
        shape.push(`${ck}|${id}|${excerptExtentOf(c.locator)}`);
      }
    }
  }
  return { content, exprs, seq, shape, unknown };
}

function structureOf(item: CompareItemLike): string {
  const formats: string[] = [];
  let tracks = 0;
  for (const m of item.media || []) {
    formats.push(String(m.medium?.attributes?.format || "").trim());
    tracks += (m.tracks || []).length;
  }
  return `${formats.sort().join("+")}/${(item.media || []).length}M/${tracks}T`;
}

// 目录完整性：空内容集合不能当成"已确认相同"。只有载体结构的发行（曲目未录入）
// 或曲目存在但没有内容引用（收录未录入）都属资料不足，不能与其他发行比内容。
//
// 导航节点不算漏录：黑胶 A/B 面、多盘装的总目轨这类容器轨只负责分组，内容挂在
// 其子轨上，本身不需要直接引用 Expression。因此只对**叶子轨**要求内容引用。
function completenessOf(item: CompareItemLike): CompareItemCompleteness {
  let mediaWithoutTracks = 0;
  let tracksWithoutContents = 0;
  let totalTracks = 0;
  const media = item.media || [];
  // 载体内的父轨集合：任一被别的轨当作 parent 的轨即容器（导航节点）。
  const containerIds = new Set<string>();
  for (const m of media) {
    for (const tr of m.tracks || []) {
      if (tr.parent_id) containerIds.add(tr.parent_id);
    }
  }
  for (const m of media) {
    const tracks = m.tracks || [];
    if (tracks.length === 0) mediaWithoutTracks += 1;
    for (const tr of tracks) {
      totalTracks += 1;
      // 容器轨（导航节点）不要求直接内容引用，其子轨各自受检。
      const isContainer = !!tr.id && containerIds.has(tr.id);
      if (isContainer) continue;
      if (!(tr.contents || []).some((c) => c.expression_id)) tracksWithoutContents += 1;
    }
  }
  return { mediaWithoutTracks, tracksWithoutContents, empty: media.length === 0 && totalTracks === 0 };
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function computeAlignment(
  items: CompareItemLike[],
  exprEntities: Record<string, CompareExprEntityLike | undefined>,
): AlignmentResult {
  const perExpr = new Map<string, { releaseIndex: number }[]>();
  const n = items.length;
  let pendingConfirm = false;

  const facts = items.map((item) => sequenceOf(item, exprEntities));
  // 目录不完整（无载体/载体无曲目/曲目无内容引用）的发行：不参与内容一致性结论，
  // 单独列出让人工补录，而不是把空集合当成"已确认一致"。
  const incomplete: number[] = [];
  const complete: boolean[] = items.map((item, i) => {
    const c = completenessOf(item);
    if (c.empty || c.mediaWithoutTracks > 0 || c.tracksWithoutContents > 0) {
      incomplete.push(i);
      return false;
    }
    return true;
  });
  for (let i = 0; i < n; i++) {
    if (facts[i].unknown) pendingConfirm = true;
    for (const id of facts[i].exprs) {
      const list = perExpr.get(id) || [];
      list.push({ releaseIndex: i });
      perExpr.set(id, list);
    }
  }

  const shared: string[] = [];
  const partial: { id: string; in: number[] }[] = [];
  Array.from(perExpr.entries()).forEach(([id, occs]) => {
    const inSet = Array.from(new Set(occs.map((o) => o.releaseIndex))).sort((a, b) => a - b);
    if (inSet.length === n) shared.push(id);
    else partial.push({ id, in: inSet });
  });

  // 同内容身份下的多个不同表达：按章节（content_unit）而非整作品聚合，
  // 避免同一作品不同章节被误报为"同曲异录音"。
  const byContent = new Map<string, { id: string }[]>();
  Array.from(perExpr.keys()).forEach((id) => {
    const ck = contentKeyOf(id, exprEntities);
    if (!ck) return;
    const list = byContent.get(ck) || [];
    list.push({ id });
    byContent.set(ck, list);
  });
  const workVariants: { contentKey: string; ids: string[] }[] = [];
  Array.from(byContent.entries()).forEach(([contentKey, list]) => {
    if (list.length > 1) workVariants.push({ contentKey, ids: list.map((x) => x.id) });
  });

  const carrierOnly: [number, number][] = [];
  const rangeDiffer: [number, number][] = [];
  const locatingDiffer: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = facts[i];
      const b = facts[j];
      // 身份无法解析、或任一侧目录不完整时不给结论，交由 pendingConfirm/incomplete 提示。
      if (a.unknown || b.unknown) continue;
      if (!complete[i] || !complete[j]) continue;
      const sameContent = arraysEqual(sortedUnique(a.content), sortedUnique(b.content));
      const sameExprs = arraysEqual(sortedUnique(a.exprs), sortedUnique(b.exprs));
      // ③ 收录范围/重复/顺序：序列完全相同才算一致。
      const sameSeq = arraysEqual(a.seq, b.seq);
      if (sameExprs && !sameSeq) {
        // 截取长度与顺序一致、仅绝对定位不同 → 本版定位变化，不是内容范围变化。
        if (arraysEqual(a.shape, b.shape)) locatingDiffer.push([i, j]);
        else rangeDiffer.push([i, j]);
        continue;
      }
      if (sameContent && sameExprs && sameSeq) {
        if (structureOf(items[i]) !== structureOf(items[j])) carrierOnly.push([i, j]);
      }
    }
  }

  return { perExpr, shared, partial, workVariants, carrierOnly, rangeDiffer, locatingDiffer, pendingConfirm, incomplete };
}
