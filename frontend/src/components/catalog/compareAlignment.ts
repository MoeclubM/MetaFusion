// 发行对比的内容对齐算法（纯函数，便于单点验证与复用）。
//
// 三层语义必须分开，否则结论必然错：
//   ① 内容身份：有 content_unit_id 用章节，否则用 work_id；
//   ② 各发行实际引用的 Expression（同一章节可能有原文/译文/不同录音）；
//   ③ **内容选择范围**：引用整份表达，还是原文/原录音的某个片段；
//   ④ **载体内位置**：该内容位于本版第几页、什么时间、文件路径/锚点；
//   ⑤ 载体结构（格式/盘数/轨数）。
//
// ③ 与 ④ 的界线不能靠字段名或区间长度猜：完整章节换字体导致页数改变，不改变内容身份；
// 原录音前 30 秒与后 30 秒长度相等，却不是同一个片段。因此本算法的规则**来自
// definitions 声明**（Field.Semantics 闭集）：声明 "content" 的子字段参与 ③，
// 其余 locator 子字段（默认）参与 ④。未声明的收录附加属性既不属于 ③ 也不属于 ④，
// 一旦两侧不同只能归为"无法判断"，不得据此断言"仅载体不同"。
//
// 各类结论：
//   ①②③ 全同、仅 ⑤ 不同 → 仅载体差异（carrierOnly）
//   ①② 同、③ 不同        → 收录范围/顺序不同（rangeDiffer）
//   ①②③ 同、④ 不同       → 仅本版定位不同（locatingDiffer）
//   ①② 同、附加属性不同    → 无法判断（attributeDiffer）
//   身份元数据解析不全      → 待确认（pendingConfirm）

export interface CompareInclusionLike {
  expression_id?: string;
  position?: number;
  locator?: Record<string, any>;
  /** 收录附加属性：子字段由 definitions 的 inclusion_attributes 声明。 */
  attributes?: Record<string, any>;
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
  // 结构子树：发行/载体为 [{medium, tracks}]，其余层级为空（entity-only 对比只比属性表）。
  children?: CompareMediumLike[];
}

export interface CompareExprEntityLike {
  work_id?: string;
  content_unit_id?: string;
}

export interface SlotSemantics {
  /** 声明为"内容选择范围"的点分路径（Field.Semantics === "content"）。 */
  content: string[];
  /** 声明为"本版定位"的点分路径（Field.Semantics === "locating"）。 */
  locating: string[];
}

/** 对比语义声明：分别推导 locator 与 inclusion_attributes 的点分语义路径。 */
export interface CompareSemantics {
  locator: SlotSemantics;
  inclusion_attributes: SlotSemantics;
  /** 向前兼容旧顶层数组 */
  content?: string[];
  locating?: string[];
}

function collectSlotPaths(groupDef: any, prefix = ""): { path: string; semantics: string }[] {
  const fields = groupDef?.fields || {};
  const out: { path: string; semantics: string }[] = [];
  for (const [k, f] of Object.entries(fields as Record<string, any>)) {
    if (f?.enabled === false) continue; // 绝不能过滤 hidden：hidden 仅为 UI 表现层，业务对比语义必须保留
    const path = prefix ? `${prefix}.${k}` : k;
    const sem = String(f?.semantics || "").trim();
    if (sem === "content" || sem === "locating") {
      out.push({ path, semantics: sem });
    }
    if (f?.type === "group" && f?.fields) {
      out.push(...collectSlotPaths(f, path));
    }
  }
  return out;
}

// compareSemanticsOf 从 definitions 分别读出 locator 与 inclusion_attributes 的对比语义声明。
// 递归收集包括嵌套 group 在内的点分路径，且严格隔离两个槽位，不互相污染。
export function compareSemanticsOf(defs: any): CompareSemantics {
  const buildSlot = (code: string): SlotSemantics => {
    const list = collectSlotPaths(defs?.fields?.[code]);
    const content: string[] = [];
    const locating: string[] = [];
    for (const item of list) {
      if (item.semantics === "content") content.push(item.path);
      else if (item.semantics === "locating") locating.push(item.path);
    }
    return { content, locating };
  };
  const locSlot = buildSlot("locator");
  const incSlot = buildSlot("inclusion_attributes");
  return {
    locator: locSlot,
    inclusion_attributes: incSlot,
    content: [...locSlot.content, ...incSlot.content],
    locating: [...locSlot.locating, ...incSlot.locating],
  };
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
  /** 引用表达一致，但内容选择范围/重复/顺序不同（真正的收录范围变化）。 */
  rangeDiffer: [number, number][];
  /** 内容与范围一致，仅本版定位（页码/时间码/路径）不同。 */
  locatingDiffer: [number, number][];
  /** 内容一致，但记录级附加属性不同，无法确认是否仅为载体差异。 */
  attributeDiffer: [number, number][];
  /** 存在无法解析身份的表达（缺少 work/章节元数据），结论需人工确认。 */
  pendingConfirm: boolean;
  /** 目录不完整（缺曲目/内容引用）的发行下标：不得据此下内容一致性结论。 */
  incomplete: number[];
}

function getPathValue(obj: any, path: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === undefined || cur === null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function flattenLeafPaths(obj: any, prefix = ""): { path: string; value: any }[] {
  if (!obj || typeof obj !== "object") return [];
  const out: { path: string; value: any }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      const children = flattenLeafPaths(v, path);
      if (children.length > 0) {
        out.push(...children);
      } else {
        out.push({ path, value: v });
      }
    } else {
      out.push({ path, value: v });
    }
  }
  return out;
}

// keyOfPaths 按指定点分路径提取对象中的值并稳定序列化。
function keyOfPaths(source: Record<string, any> | undefined, paths: string[]): string {
  if (!source) return "";
  const parts: string[] = [];
  for (const p of [...paths].sort()) {
    const v = getPathValue(source, p);
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${p}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join(",");
}

// contentRangeKeyOf 只描述"实际引用了多少内容"：
// 分别从 locator 与 inclusion_attributes 中按各自声明为 content 的点分路径提取值。
function contentRangeKeyOf(
  loc: Record<string, any> | undefined,
  attrs: Record<string, any> | undefined,
  semantics: CompareSemantics,
): string {
  const locPaths = semantics.locator?.content || [];
  const attrPaths = semantics.inclusion_attributes?.content || [];
  return keyOfPaths(loc, locPaths) + "|" + keyOfPaths(attrs, attrPaths);
}

// locatingKeyOf 描述"本版如何定位"：
// 1. locator 中所有非 content 语义的叶子路径（未声明者默认作为定位处理）；
// 2. inclusion_attributes 中显式声明为 locating 的点分路径。
function locatingKeyOf(
  loc: Record<string, any> | undefined,
  attrs: Record<string, any> | undefined,
  semantics: CompareSemantics,
): string {
  const parts: string[] = [];
  if (loc) {
    const locContentSet = new Set(semantics.locator?.content || []);
    const leaves = flattenLeafPaths(loc).filter((x) => !locContentSet.has(x.path));
    leaves.sort((a, b) => a.path.localeCompare(b.path));
    for (const leaf of leaves) {
      parts.push(`loc:${leaf.path}=${typeof leaf.value === "object" ? JSON.stringify(leaf.value) : String(leaf.value)}`);
    }
  }
  if (attrs) {
    const incLocating = semantics.inclusion_attributes?.locating || [];
    for (const p of [...incLocating].sort()) {
      const v = getPathValue(attrs, p);
      if (v !== undefined && v !== null && v !== "") {
        parts.push(`inc:${p}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
      }
    }
  }
  return parts.join(",");
}

// otherAttrsKeyOf 收拢"既非内容范围、也非定位"的收录附加属性：
// 排除 inclusion_attributes 内部已声明为 content 和 locating 的字段，其余若有差异则提示 attributeDiffer。
function otherAttrsKeyOf(
  attrs: Record<string, any> | undefined,
  semantics: CompareSemantics,
): string {
  if (!attrs) return "";
  const known = new Set([
    ...(semantics.inclusion_attributes?.content || []),
    ...(semantics.inclusion_attributes?.locating || []),
  ]);
  const leaves = flattenLeafPaths(attrs).filter((x) => !known.has(x.path));
  leaves.sort((a, b) => a.path.localeCompare(b.path));
  const parts: string[] = [];
  for (const leaf of leaves) {
    parts.push(`${leaf.path}=${typeof leaf.value === "object" ? JSON.stringify(leaf.value) : String(leaf.value)}`);
  }
  return parts.join(",");
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

// 按载体→轨道→收录顺序展开三类有序指纹（都保留顺序与重复次数）：
//   content[].shape  内容身份 + 表达 + 内容选择范围（含重复与顺序）
//   content[].locating 本版定位（仅在内容指纹一致时才有比较意义）
//   content[].other  无法归类的附加属性
function sequenceOf(
  item: CompareItemLike,
  exprEntities: Record<string, CompareExprEntityLike | undefined>,
  semantics: CompareSemantics,
): { content: string[]; exprs: string[]; locating: string[]; other: string[]; unknown: boolean } {
  const content: string[] = [];
  const exprs: string[] = [];
  const locating: string[] = [];
  const other: string[] = [];
  let unknown = false;
  for (const m of item.children || []) {
    for (const tr of orderedTracks(m.tracks || [])) {
      for (const c of tr.contents || []) {
        const id = c.expression_id;
        if (!id) continue;
        exprs.push(id);
        const ck = contentKeyOf(id, exprEntities);
        if (!ck) unknown = true;
        content.push(`${ck}|${id}|${contentRangeKeyOf(c.locator, c.attributes, semantics)}`);
        locating.push(`${locatingKeyOf(c.locator, c.attributes, semantics)}|${c.position ?? ""}`);
        other.push(otherAttrsKeyOf(c.attributes, semantics));
      }
    }
  }
  return { content, exprs, locating, other, unknown };
}

function structureOf(item: CompareItemLike): string {
  const formats: string[] = [];
  let tracks = 0;
  for (const m of item.children || []) {
    formats.push(String(m.medium?.attributes?.format || "").trim());
    tracks += (m.tracks || []).length;
  }
  return `${formats.sort().join("+")}/${(item.children || []).length}M/${tracks}T`;
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
  const media = item.children || [];
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
  semantics: CompareSemantics = {
    locator: { content: [], locating: [] },
    inclusion_attributes: { content: [], locating: [] },
  },
): AlignmentResult {
  const perExpr = new Map<string, { releaseIndex: number }[]>();
  const n = items.length;
  let pendingConfirm = false;

  const facts = items.map((item) => sequenceOf(item, exprEntities, semantics));
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
  const attributeDiffer: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = facts[i];
      const b = facts[j];
      // 身份无法解析、或任一侧目录不完整时不给结论，交由 pendingConfirm/incomplete 提示。
      if (a.unknown || b.unknown) continue;
      if (!complete[i] || !complete[j]) continue;
      // ③ 内容身份 + 表达 + 内容选择范围（含顺序与重复）：完全一致才是同一份内容。
      if (!arraysEqual(a.content, b.content)) {
        rangeDiffer.push([i, j]);
        continue;
      }
      // ④ 差异无法归类时不下"仅载体不同"的结论。
      if (!arraysEqual(a.other, b.other)) {
        attributeDiffer.push([i, j]);
        continue;
      }
      // ⑤ 定位不同：内容与范围一致，只是本版页码/时间码/路径不同。
      if (!arraysEqual(a.locating, b.locating)) {
        locatingDiffer.push([i, j]);
        continue;
      }
      if (structureOf(items[i]) !== structureOf(items[j])) carrierOnly.push([i, j]);
    }
  }

  return {
    perExpr,
    shared,
    partial,
    workVariants,
    carrierOnly,
    rangeDiffer,
    locatingDiffer,
    attributeDiffer,
    pendingConfirm,
    incomplete,
  };
}
