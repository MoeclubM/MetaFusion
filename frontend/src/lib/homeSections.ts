// 首页推荐分区的共享形状与纯逻辑：首页展示与"自定义推荐"弹窗共用一份定义，
// 避免出现"面板能改的字段首页认不出"的两套模型。
//
// 语义（与后端 /catalog/me/home-preferences 契约一致）：
//   * sections 是"覆盖 + 自建"混合列表——slug 命中系统货架 = 覆盖它（改名/换规则/换图标），
//     不命中 = 该用户独有的分区；
//   * 系统预设只是模板，用户改的是自己的副本，不动系统货架，也不影响别人。
import type { ElementType } from "react";
import {
  BookOpen,
  Camera,
  Disc,
  Film,
  Gamepad2,
  Layers,
  Music,
  Sparkles,
  Tv,
} from "lucide-react";
import {
  getFieldName,
  getRelationName,
  getTermName,
  getTypeName,
  resolveLocalizedName,
  type DynamicDefinitions,
} from "@/lib/definitions";

export type SectionSort = "updated" | "created" | "title";

/** 分区来源：system 只能隐藏（可覆盖规则），custom 是该用户独有分区，可删除。 */
export type SectionSource = "system" | "custom";

/** 货架收录规则。子条件之间为 AND，同一数组内为 OR；空表示收录全部已发布作品。 */
export type ShelfQuery = {
  types?: string[] | null;
  fields?: Record<string, string[]> | null;
  vocab_terms?: Record<string, string[]> | null;
  relations?: string[] | null;
};

/** 货架定义：系统模板（GET /catalog/shelves）与首页 feed 的 shelf 共用这一个形状。 */
export type ShelfLike = {
  slug: string;
  names?: Record<string, string> | null;
  query?: ShelfQuery | null;
  sort?: string | null;
  icon?: string | null;
  source?: SectionSource | null;
};

/** 用户偏好里的分区条目。names 只带用户填过的语种，缺失语种由展示端回退。 */
export type CustomSection = {
  slug: string;
  names: Record<string, string>;
  query?: ShelfQuery;
  sort?: SectionSort;
  icon?: string;
};

export type HomePreferences = {
  order: string[];
  hidden: string[];
  sections: CustomSection[];
};

export const EMPTY_PREFERENCES: HomePreferences = { order: [], hidden: [], sections: [] };

/** 后端 slug 约束（与货架同口径）：以字母数字开头，2–64 位小写字母/数字/-/_。 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function normalizeSort(sort?: string | null): SectionSort {
  return sort === "created" || sort === "title" ? sort : "updated";
}

function normalizeQuery(query?: ShelfQuery | null): ShelfQuery {
  const fields: Record<string, string[]> = {};
  for (const [k, vs] of Object.entries(query?.fields || {})) {
    const values = (vs || []).filter((v) => !!v);
    if (k && values.length > 0) fields[k] = values;
  }
  const vocab: Record<string, string[]> = {};
  for (const [k, vs] of Object.entries(query?.vocab_terms || {})) {
    const values = (vs || []).filter((v) => !!v);
    if (k && values.length > 0) vocab[k] = values;
  }
  return {
    types: (query?.types || []).filter((v) => !!v),
    fields,
    vocab_terms: vocab,
    relations: (query?.relations || []).filter((v) => !!v),
  };
}

/** 读取到的偏好做一次归一：后端缺字段、旧文档无 sections 时也不该让弹窗崩掉。 */
export function normalizePreferences(raw?: Partial<HomePreferences> | null): HomePreferences {
  const p = raw || {};
  const sections: CustomSection[] = (Array.isArray(p.sections) ? p.sections : [])
    .filter((s): s is CustomSection => !!s && typeof s.slug === "string" && s.slug !== "")
    .map((s) => ({
      slug: s.slug,
      names: { ...(s.names || {}) },
      query: normalizeQuery(s.query),
      sort: normalizeSort(s.sort),
      icon: s.icon || "",
    }));
  return {
    order: (Array.isArray(p.order) ? p.order : []).filter((x): x is string => typeof x === "string" && x !== ""),
    hidden: (Array.isArray(p.hidden) ? p.hidden : []).filter((x): x is string => typeof x === "string" && x !== ""),
    sections,
  };
}

// 分区图标集：货架的 icon 字段按名映射到这里；未声明时按 slug 兜底，最后回落通用图标。
export const ICONS: Record<string, ElementType> = {
  Disc,
  Tv,
  Film,
  Gamepad2,
  Camera,
  BookOpen,
  Layers,
  Music,
  Sparkles,
};

export const ICON_NAMES: string[] = Object.keys(ICONS);

export function iconFor(shelf: { slug?: string | null; icon?: string | null }): ElementType {
  if (shelf.icon && ICONS[shelf.icon]) return ICONS[shelf.icon];
  return (shelf.slug && ICONS[shelf.slug]) || Sparkles;
}

export function shelfTitle(shelf: ShelfLike, locale: string): string {
  return resolveLocalizedName(shelf.names || undefined, locale, shelf.slug);
}

/** 规则摘要用的标签：类型/字段/词表项/关系都按服务端 definitions 显示本地化名。 */
export function describeRule(
  query: ShelfQuery,
  defs: DynamicDefinitions | null | undefined,
  locale: string,
): string[] {
  const parts: string[] = [];
  for (const code of query.types || []) parts.push(getTypeName(defs, code, locale));
  for (const [key, values] of Object.entries(query.fields || {})) {
    for (const value of values || []) parts.push(`${getFieldName(defs, key, locale)}=${value}`);
  }
  for (const [vocab, values] of Object.entries(query.vocab_terms || {})) {
    const vocabName = resolveLocalizedName(defs?.vocabularies?.[vocab]?.names, locale, vocab);
    for (const value of values || []) parts.push(`${vocabName}:${getTermName(defs, vocab, value, locale)}`);
  }
  for (const code of query.relations || []) parts.push(getRelationName(defs, code, true, locale));
  return parts;
}

/** 弹窗里的一行分区：既可能是系统预设行，也可能是自建行。 */
export type SectionRow = {
  slug: string;
  /** 自建分区：可删除、可改标识；系统行只能隐藏或覆盖规则。 */
  custom: boolean;
  names: Record<string, string>;
  query: ShelfQuery;
  sort: SectionSort;
  icon: string;
  hidden: boolean;
  /** 已在偏好里写入覆盖（系统行）或作为自建分区存在。 */
  overridden: boolean;
  /** 系统模板快照：供"还原预设"与保存时比对。 */
  template?: ShelfLike;
};

/**
 * buildRows：把「用户偏好 + 系统模板 + feed 里的分区」合成面板行。
 * 顺序 = 偏好里的 order → 系统默认序 → 其余分区；被隐藏的也一定在列表里，
 * 否则用户隐藏后就再也开不回来（feed 已按偏好过滤掉隐藏项）。
 */
export function buildRows(
  prefs: HomePreferences | null | undefined,
  templates: ShelfLike[],
  feedShelves: ShelfLike[],
): SectionRow[] {
  const p = normalizePreferences(prefs);
  const templateBySlug = new Map(templates.map((t) => [t.slug, t]));
  const feedBySlug = new Map(feedShelves.map((s) => [s.slug, s]));
  const sectionBySlug = new Map(p.sections.map((s) => [s.slug, s]));
  const hidden = new Set(p.hidden);

  const seq: string[] = [];
  const push = (slug?: string | null) => {
    if (slug && !seq.includes(slug)) seq.push(slug);
  };
  p.order.forEach(push);
  templates.forEach((tpl) => push(tpl.slug));
  feedShelves.forEach((sh) => push(sh.slug));
  p.sections.forEach((sec) => push(sec.slug));

  return seq.map((slug) => {
    const template = templateBySlug.get(slug);
    const section = sectionBySlug.get(slug);
    const feed = feedBySlug.get(slug);
    // 已有偏好条目时以偏好为准（用户自己改过），否则用系统模板，再退回 feed。
    const def: ShelfLike = section
      ? { slug, names: section.names, query: section.query, sort: section.sort, icon: section.icon }
      : template || feed || { slug };
    // feed 的 source 是"能否删除"的权威口径：模板里没有但 feed 说是系统货架的，
    // 仍然只给隐藏（例如模板接口暂时取不到）。
    const custom = !template && feed?.source !== "system";
    return {
      slug,
      custom,
      names: { ...(def.names || {}) },
      query: normalizeQuery(def.query),
      sort: normalizeSort(def.sort),
      icon: def.icon || "",
      hidden: hidden.has(slug),
      overridden: !!section,
      template,
    };
  });
}

function compactQuery(query: ShelfQuery): ShelfQuery {
  const out: ShelfQuery = {};
  const types = (query.types || []).filter((v) => !!v);
  if (types.length > 0) out.types = types;
  const fields: Record<string, string[]> = {};
  for (const [k, vs] of Object.entries(query.fields || {})) {
    const values = (vs || []).filter((v) => !!v);
    if (k && values.length > 0) fields[k] = values;
  }
  if (Object.keys(fields).length > 0) out.fields = fields;
  const vocab: Record<string, string[]> = {};
  for (const [k, vs] of Object.entries(query.vocab_terms || {})) {
    const values = (vs || []).filter((v) => !!v);
    if (k && values.length > 0) vocab[k] = values;
  }
  if (Object.keys(vocab).length > 0) out.vocab_terms = vocab;
  const relations = (query.relations || []).filter((v) => !!v);
  if (relations.length > 0) out.relations = relations;
  return out;
}

function toSection(row: SectionRow): CustomSection {
  const names: Record<string, string> = {};
  for (const [code, value] of Object.entries(row.names)) {
    const text = (value || "").trim();
    if (text) names[code] = text;
  }
  return {
    slug: row.slug,
    names,
    query: compactQuery(row.query),
    sort: row.sort,
    icon: row.icon,
  };
}

/**
 * toPreferences：把面板行落成 PUT 载荷。
 * 只有「自建分区」与「被改过的系统分区」才写进 sections——没动过的系统行继续跟随
 * 系统预设，管理员日后调整规则时用户仍然自动受益。
 */
export function toPreferences(rows: SectionRow[]): HomePreferences {
  return {
    order: rows.map((r) => r.slug),
    hidden: rows.filter((r) => r.hidden).map((r) => r.slug),
    sections: rows.filter((r) => r.custom || r.overridden).map(toSection),
  };
}

/** 生成不与现有分区冲突的 slug（新建空白分区、从模板复制都用它）。 */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = (base || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 56);
  if (root && isValidSlug(root) && !taken.has(root)) return root;
  const seed = root && isValidSlug(root) ? root : "section";
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${seed}-${i}`;
    if (!taken.has(candidate) && isValidSlug(candidate)) return candidate;
  }
  return `section-${Date.now().toString(36)}`;
}

/** 从系统模板复制成一条可编辑的自建行。 */
export function rowFromTemplate(template: ShelfLike, taken: Set<string>, fallbackName: string): SectionRow {
  const names = { ...(template.names || {}) };
  if (Object.values(names).every((v) => !(v || "").trim())) {
    names["zh-CN"] = fallbackName;
  }
  return {
    slug: uniqueSlug(template.slug, taken),
    custom: true,
    names,
    query: normalizeQuery(template.query),
    sort: normalizeSort(template.sort),
    icon: template.icon || "",
    hidden: false,
    overridden: true,
    template,
  };
}

/** 分区名只强制 zh-CN（与后端 invalid_name 同口径），其余语种留空由展示端回退。 */
export function hasRequiredName(names: Record<string, string> | undefined): boolean {
  return !!(names && (names["zh-CN"] || "").trim());
}

/** 空白新建：zh-CN 必填（后端硬校验），再带上当前界面语言的标题。 */
export function rowFromScratch(locale: string, taken: Set<string>, name: string): SectionRow {
  return {
    slug: uniqueSlug("section", taken),
    custom: true,
    names: locale === "zh-CN" ? { "zh-CN": name } : { "zh-CN": name, [locale]: name },
    query: { types: [], fields: {}, vocab_terms: {}, relations: [] },
    sort: "updated",
    icon: "Sparkles",
    hidden: false,
    overridden: true,
  };
}

/** 还原成系统模板（系统行专用）：改名/换规则都撤掉，重新跟随预设。 */
export function revertToTemplate(row: SectionRow): SectionRow {
  if (!row.template) return row;
  return {
    ...row,
    names: { ...(row.template.names || {}) },
    query: normalizeQuery(row.template.query),
    sort: normalizeSort(row.template.sort),
    icon: row.template.icon || "",
    overridden: false,
  };
}
