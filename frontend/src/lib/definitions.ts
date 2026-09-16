"use client";

import { useState, useEffect, useMemo } from "react";

export interface TypeDef {
  names: Record<string, string>;
  kinds: string[];
  fields: string[];
  template: string;
  enabled: boolean;
}

export interface FieldDef {
  names: Record<string, string>;
  type: string;
  unit?: Record<string, string>;
  vocabulary?: string;
  enabled: boolean;
  required?: boolean;
  kinds?: string[];
  fields?: Record<string, FieldDef>;
  items?: FieldDef;
  min?: number;
  max?: number;
  anchor_key?: string;
  /** 仅 group 内的 number 子字段：声明本字段是同组该子字段的区间终点。 */
  range_start?: string;
  /** 可写、可检索，但不进详情信息面板（存档/机器用途，如资料表原始条目）。 */
  hidden?: boolean;
  /** 对比语义（闭集）："content" 为内容选择范围，"locating" 为本版定位。 */
  semantics?: string;
}

export interface SectionDef {
  names: Record<string, string>;
  fields: string[];
}

export interface TemplateDef {
  names: Record<string, string>;
  sections: SectionDef[];
  columns?: string[];
  relation_groups?: string[];
  directory?: string;
  modules?: string[];
  /** 该模板下代表"作品首发/发行日期"的字段码；为空则不展示日期。 */
  primary_date_field?: string;
  /** 详情页标题旁以徽章突出的字段码（如载体格式、平台）；顺序即展示顺序。 */
  badge_fields?: string[];
  /** 列表页可用于筛选的字段码（通常是枚举字段）；顺序即展示顺序。 */
  facet_fields?: string[];
}

export interface VocabularyDef {
  names: Record<string, string>;
  terms: Record<string, { names: Record<string, string>; enabled: boolean }>;
}

export interface RelationDef {
  names: Record<string, string>;
  reverse_names: Record<string, string>;
  source_kinds: string[];
  target_kinds: string[];
  /** 端点动态类型约束（type code）：为空表示不限。 */
  source_types?: string[];
  target_types?: string[];
  /** 关系可携带的属性字段码（definitions.fields 引用）：后台声明后编辑表单即可填写。 */
  fields?: string[];
  symmetric?: boolean;
  acyclic?: boolean;
  max_outgoing?: number;
  max_incoming?: number;
  /** 声明这条关系表达"组成/聚合"（集合→作品、专辑→曲目等）：页面据此算组成列表，不写死关系码。 */
  aggregate?: boolean;
  group: string;
  group_names?: Record<string, string>;
  enabled: boolean;
}

export interface SchemeDef {
  names: Record<string, string>;
  /** 闭集三选一：locator / inclusion_attributes / subject_attributes。 */
  slot: string;
  /** 拥有者 kind 白名单，空=不限。 */
  kinds?: string[];
  /** 拥有者动态业务类型白名单，空=不限。 */
  types?: string[];
  /** 该上下文可用子字段码，顺序即展示编辑顺序。 */
  fields: string[];
  /** 必填子集（⊆fields）。 */
  required?: string[];
  /** 仅 locator 有意义：要求至少一个 semantics=content 的子字段有值。 */
  require_range?: boolean;
  enabled: boolean;
}

/** 固定八实体骨架的多语言名称（服务端 /api/catalog/definitions 的 kinds 字段）。
 *  kind 是领域模型的一部分，名称由服务端提供；前端字典只做兜底，不再自带一份名称表。 */
export interface KindDef {
  names: Record<string, string>;
}

export type KindMap = Record<string, KindDef>;

export interface DynamicDefinitions {
  types: Record<string, TypeDef>;
  fields: Record<string, FieldDef>;
  vocabularies: Record<string, VocabularyDef>;
  relations: Record<string, RelationDef>;
  templates: Record<string, TemplateDef>;
  /** 按使用场景配置的结构属性方案；缺省（旧文档无该键）时回退全局组。 */
  schemes?: Record<string, SchemeDef>;
  /** 各层级的"所属与收录结构"规则；缺省（旧文档无该键）时回退服务端内建规则。 */
  structure?: Record<string, StructureRule>;
}

/**
 * matchSchemes：与后端 matchSchemes 同一口径——slot 相同、kinds 命中拥有者
 * kind（空=命中）、types 与拥有者 types 有交集（空=命中）且 enabled。
 */
export function matchSchemes(
  defs: DynamicDefinitions | null | undefined,
  slot: string,
  ownerKind: string,
  ownerTypes: string[]
): SchemeDef[] {
  const schemes = defs?.schemes || {};
  return Object.values(schemes).filter((s) => {
    if (!s || s.enabled === false || s.slot !== slot) return false;
    if ((s.kinds || []).length > 0 && !s.kinds!.includes(ownerKind)) return false;
    if ((s.types || []).length > 0) {
      if (!(ownerTypes || []).some((t) => s.types!.includes(t))) return false;
    }
    return true;
  });
}

/**
 * effectiveSchemeFields：匹配 scheme 的并集 fields（保序去重），顺序即展示
 * 编辑顺序；无匹配时返回空数组，调用方回退显示全部全局子字段。
 */
export function effectiveSchemeFields(matched: SchemeDef[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of matched) {
    for (const k of s.fields || []) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

let cachedDefinitions: DynamicDefinitions | null = null;
// 骨架名称与定义文档同批缓存：两者一起随版本刷新，避免出现"文档换了名字没换"。
let cachedKinds: KindMap = {};
// 已发布定义的版本行 id：后台发布新版本后 id 变化，据此失效缓存。
let cachedVersion = "";
let definitionsPromise: Promise<DynamicDefinitions | null> | null = null;
let revalidating = false;
// 请求序号：只接受不早于已应用序号的响应，防止较早的请求晚到覆盖较新版本。
let requestSeq = 0;
let appliedSeq = 0;
// 订阅者：缓存按版本刷新后逐个通知，已挂载的组件立即拿到新定义，无需整页刷新。
const listeners = new Set<(defs: DynamicDefinitions | null) => void>();

async function loadDefinitions(): Promise<DynamicDefinitions | null> {
  const seq = ++requestSeq;
  const data = await fetch("/api/catalog/definitions", { credentials: "same-origin" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (!data?.document) return null;
  if (data.kinds && typeof data.kinds === "object") cachedKinds = data.kinds as KindMap;
  // 乱序响应防护：更早发出的请求（seq 更小）晚到且已被更新响应应用时丢弃。
  if (seq < appliedSeq) return cachedDefinitions;
  appliedSeq = seq;
  const version = String(data.id ?? "");
  if (!cachedDefinitions || version !== cachedVersion) {
    cachedVersion = version;
    cachedDefinitions = data.document;
    listeners.forEach((notify) => notify(cachedDefinitions));
  }
  return cachedDefinitions;
}

export async function fetchDefinitions(): Promise<DynamicDefinitions | null> {
  if (cachedDefinitions) {
    // stale-while-revalidate：先返回缓存，后台按版本校验；发布新版本后
    // 下一次进入页面即刷新并通知订阅组件，不阻塞渲染。
    if (!revalidating) {
      revalidating = true;
      loadDefinitions().finally(() => {
        revalidating = false;
      });
    }
    return cachedDefinitions;
  }
  if (!definitionsPromise) {
    definitionsPromise = loadDefinitions().finally(() => {
      definitionsPromise = null;
    });
  }
  return definitionsPromise;
}

// 重新获得焦点时的节流校验：避免短暂切走再切回就连发请求。
let lastFocusCheck = 0;
function revalidateOnFocus() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastFocusCheck < 30_000) return;
  lastFocusCheck = now;
  void fetchDefinitions();
}

// refreshDefinitions 强制按版本重新拉取并等待结果（不走 stale-while-revalidate）。
// 供后台发布成功后调用：必须立刻拿到新版本并通知，不能停在旧缓存上。
export async function refreshDefinitions(): Promise<DynamicDefinitions | null> {
  return loadDefinitions();
}

export function useDefinitions() {
  const [defs, setDefs] = useState<DynamicDefinitions | null>(cachedDefinitions);
  const [kinds, setKinds] = useState<KindMap>(cachedKinds);
  const [loading, setLoading] = useState<boolean>(!cachedDefinitions);

  useEffect(() => {
    let mounted = true;
    const listener = (d: DynamicDefinitions | null) => {
      if (mounted) {
        setDefs(d);
        setKinds(cachedKinds);
        setLoading(false);
      }
    };
    listeners.add(listener);
    // 挂载即校验：无论是否已有缓存都调用 fetchDefinitions()。已有缓存时它走
    // stale-while-revalidate（后台按版本校验并通知），从而"重新进入页面即更新"；
    // 旧实现只在无缓存时请求，发布新定义后已挂载页面永远看不到新版本。
    fetchDefinitions().then((d) => {
      if (mounted) {
        setDefs(d);
        setKinds(cachedKinds);
        setLoading(false);
      }
    });
    window.addEventListener("focus", revalidateOnFocus);
    document.addEventListener("visibilitychange", revalidateOnFocus);
    return () => {
      mounted = false;
      listeners.delete(listener);
      window.removeEventListener("focus", revalidateOnFocus);
      document.removeEventListener("visibilitychange", revalidateOnFocus);
    };
  }, []);

  return { definitions: defs, kinds, loading };
}

/**
 * 服务端 definitions 多语言名回退链：精确 → 短码/等价写法 → zh-CN → zh-TW → ja/ja-JP
 * → en-US → 行内剩余首个非空值 → fallback。
 */
export function resolveLocalizedName(
  names: Record<string, string> | undefined | null,
  locale: string,
  fallback = ""
): string {
  if (!names) return fallback;
  const get = (code: string): string => {
    const v = names[code];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };
  if (get(locale)) return get(locale);
  const low = locale.trim().toLowerCase();
  const short = low.split("-")[0];
  // 短码与等价写法：ja-JP↔ja、zh↔zh-CN、en↔en-US、zh-TW↔zh-Hant
  for (const [k, v] of Object.entries(names)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const kl = k.trim().toLowerCase();
    if (kl === short || kl.split("-")[0] === short) return v.trim();
  }
  if (get("zh-CN")) return get("zh-CN");
  if (get("zh-TW") || get("zh-Hant")) return get("zh-TW") || get("zh-Hant");
  if (get("ja") || get("ja-JP")) return get("ja") || get("ja-JP");
  if (get("en-US") || get("en")) return get("en-US") || get("en");
  const values = Object.values(names).filter((v) => typeof v === "string" && (v as string).trim());
  return values.length > 0 ? (values[0] as string).trim() : fallback;
}

/**
 * getKindName：实体类型（八骨架 kind）的显示名。
 *
 * 取服务端 kinds 的多语言名，缺失时回退调用方给的兜底文案（通常是前端字典的同名键）。
 * 卡片角标、筛选器、详情页类型徽标都应走这里——不允许各处自己维护一份 kind 名称表，
 * 更不允许把"业务分类"当成类型展示（分类由货架/类型承担，不是 kind）。
 */
export function getKindName(
  kinds: KindMap | null | undefined,
  kind: string,
  locale: string,
  fallback = ""
): string {
  const names = kinds?.[kind]?.names;
  const resolved = resolveLocalizedName(names, locale, "");
  return resolved || fallback || kind;
}

// 结构归属规则：由服务端 definitions.structure 下发，前端据此渲染结构字段与资源区块，
// 不再自己维护"哪个层级挂哪个上级"的清单。
export interface StructureField {
  code: string;
  target_kinds?: string[];
  scoped_by?: string;
  required?: boolean;
}
export interface StructureRule {
  fields?: StructureField[];
  resources?: boolean;
}

export function getTypeName(
  defs: DynamicDefinitions | null | undefined,
  typeCode: string,
  locale: string
): string {
  if (!defs?.types?.[typeCode]) return typeCode;
  return resolveLocalizedName(defs.types[typeCode].names, locale, typeCode);
}

export function getRelationName(
  defs: DynamicDefinitions | null | undefined,
  relType: string,
  isForward: boolean,
  locale: string
): string {
  const rel = defs?.relations?.[relType];
  if (!rel) return relType.replace(/_/g, " ");
  const names = isForward ? rel.names : rel.reverse_names;
  return resolveLocalizedName(names, locale, relType.replace(/_/g, " "));
}

export function getFieldName(
  defs: DynamicDefinitions | null | undefined,
  fieldCode: string,
  locale: string
): string {
  if (!defs?.fields?.[fieldCode]) return fieldCode;
  return resolveLocalizedName(defs.fields[fieldCode].names, locale, fieldCode);
}

export function getTermName(
  defs: DynamicDefinitions | null | undefined,
  vocabCode: string,
  termCode: string,
  locale: string
): string {
  const term = defs?.vocabularies?.[vocabCode]?.terms?.[termCode];
  if (!term) return termCode;
  return resolveLocalizedName(term.names, locale, termCode);
}
