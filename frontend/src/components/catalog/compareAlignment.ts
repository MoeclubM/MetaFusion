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
  /** 引用表达一致，但收录范围/重复/顺序不同。 */
  rangeDiffer: [number, number][];
  /** 存在无法解析身份的表达（缺少 work/章节元数据），结论需人工确认。 */
  pendingConfirm: boolean;
}

function locatorKey(loc?: Record<string, any>): string {
  if (!loc || Object.keys(loc).length === 0) return "";
  try {
    return JSON.stringify(loc);
  } catch {
    return "";
  }
}

function contentKeyOf(exprId: string, exprEntities: Record<string, CompareExprEntityLike | undefined>): string {
  const e = exprEntities[exprId];
  if (!e) return "";
  return e.content_unit_id || e.work_id || "";
}

// 每条发行上按载体→轨道→收录顺序展开一份有序指纹（保留顺序与重复次数）。
function sequenceOf(
  item: CompareItemLike,
  exprEntities: Record<string, CompareExprEntityLike | undefined>,
): { content: string[]; exprs: string[]; seq: string[]; unknown: boolean } {
  const content: string[] = [];
  const exprs: string[] = [];
  const seq: string[] = [];
  let unknown = false;
  for (const m of item.media || []) {
    for (const tr of m.tracks || []) {
      for (const c of tr.contents || []) {
        const id = c.expression_id;
        if (!id) continue;
        exprs.push(id);
        const ck = contentKeyOf(id, exprEntities);
        if (!ck) unknown = true;
        content.push(ck);
        seq.push(`${ck}|${id}|${locatorKey(c.locator)}|${c.position ?? ""}`);
      }
    }
  }
  return { content, exprs, seq, unknown };
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
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = facts[i];
      const b = facts[j];
      // 身份无法解析时不给结论，交由 pendingConfirm 提示。
      if (a.unknown || b.unknown) continue;
      const sameContent = arraysEqual(sortedUnique(a.content), sortedUnique(b.content));
      const sameExprs = arraysEqual(sortedUnique(a.exprs), sortedUnique(b.exprs));
      // ③ 收录范围/重复/顺序：序列完全相同才算一致。
      const sameSeq = arraysEqual(a.seq, b.seq);
      if (sameExprs && !sameSeq) {
        rangeDiffer.push([i, j]);
        continue;
      }
      if (sameContent && sameExprs && sameSeq) {
        if (structureOf(items[i]) !== structureOf(items[j])) carrierOnly.push([i, j]);
      }
    }
  }

  return { perExpr, shared, partial, workVariants, carrierOnly, rangeDiffer, pendingConfirm };
}
