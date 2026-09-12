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
  /** 可写、可检索，但不进详情信息面板（存档/机器用途，如资料表原始条目）。 */
  hidden?: boolean;
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
  group: string;
  group_names?: Record<string, string>;
  enabled: boolean;
}

export interface DynamicDefinitions {
  types: Record<string, TypeDef>;
  fields: Record<string, FieldDef>;
  vocabularies: Record<string, VocabularyDef>;
  relations: Record<string, RelationDef>;
  templates: Record<string, TemplateDef>;
}

let cachedDefinitions: DynamicDefinitions | null = null;
let definitionsPromise: Promise<DynamicDefinitions | null> | null = null;

export async function fetchDefinitions(): Promise<DynamicDefinitions | null> {
  if (cachedDefinitions) return cachedDefinitions;
  if (definitionsPromise) return definitionsPromise;

  definitionsPromise = fetch("/api/catalog/definitions", { credentials: "same-origin" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data?.document) {
        cachedDefinitions = data.document;
        return cachedDefinitions;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      definitionsPromise = null;
    });

  return definitionsPromise;
}

export function useDefinitions() {
  const [defs, setDefs] = useState<DynamicDefinitions | null>(cachedDefinitions);
  const [loading, setLoading] = useState<boolean>(!cachedDefinitions);

  useEffect(() => {
    if (!cachedDefinitions) {
      fetchDefinitions().then((d) => {
        setDefs(d);
        setLoading(false);
      });
    }
  }, []);

  return { definitions: defs, loading };
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
