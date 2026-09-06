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
  group: string;
  group_names?: Record<string, string>;
  enabled: boolean;
}

export interface DynamicDefinitions {
  types: Record<string, TypeDef>;
  fields: Record<string, FieldDef>;
  vocabularies: Record<string, VocabularyDef>;
  relations: Record<string, RelationDef>;
  templates: Record<string, any>;
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

export function resolveLocalizedName(
  names: Record<string, string> | undefined | null,
  locale: string,
  fallback = ""
): string {
  if (!names) return fallback;
  if (names[locale]) return names[locale];
  if (locale === "zh-CN" && names["zh"]) return names["zh"];
  if (locale === "en-US" && names["en"]) return names["en"];
  if (names["zh-CN"]) return names["zh-CN"];
  if (names["en-US"]) return names["en-US"];
  const values = Object.values(names);
  return values.length > 0 ? values[0] : fallback;
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
