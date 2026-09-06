export const kinds = [
  "agent",
  "collection",
  "work",
  "content_unit",
  "expression",
  "release",
  "medium",
  "track",
];
export type Names = Record<string, string>;
export type Field = {
  names: Names;
  type: string;
  enabled: boolean;
  required?: boolean;
  searchable?: boolean;
  comparable?: boolean;
  unit?: Names;
  vocabulary?: string;
  kinds?: string[];
  fields?: Record<string, Field>;
  items?: Field;
  min?: number;
  max?: number;
};
export type Definition = {
  id: number;
  state: string;
  base_version: number;
  document: Definitions;
};
export type Definitions = {
  types: Record<
    string,
    {
      names: Names;
      kinds: string[];
      fields: string[];
      template: string;
      enabled: boolean;
    }
  >;
  fields: Record<string, Field>;
  vocabularies: Record<
    string,
    { names: Names; terms: Record<string, { names: Names; enabled: boolean }> }
  >;
  relations: Record<
    string,
    {
      names: Names;
      reverse_names: Names;
      source_kinds: string[];
      target_kinds: string[];
      source_types: string[];
      target_types: string[];
      fields: string[];
      symmetric: boolean;
      acyclic: boolean;
      max_outgoing: number;
      max_incoming: number;
      group: string;
      group_names?: Names;
      enabled: boolean;
    }
  >;
  templates: Record<
    string,
    {
      names: Names;
      sections: { names: Names; fields: string[] }[];
      columns: string[];
      relation_groups: string[];
      directory: string;
      modules: string[];
    }
  >;
};
export type Entity = {
  id?: string;
  kind: string;
  title: string;
  version: number;
  status: string;
  created_by?: string;
  redirect_id?: string;
  original_language: string;
  translations: Record<
    string,
    { title: string; summary?: string; aliases?: string[] }
  >;
  types: string[];
  attributes: Record<string, any>;
  external_ids: Record<string, string>;
  pictures: { url: string; caption: Names; source: Source }[];
  work_id?: string;
  content_unit_id?: string;
  release_id?: string;
  medium_id?: string;
  parent_id?: string;
  position: number;
  number: string;
  contents: {
    expression_id: string;
    position: number;
    locator: Record<string, any>;
  }[];
  subjects: { work_id: string; role: string; position: number }[];
  updated_at?: string;
};
export type Source = { kind: string; citation: string; url?: string };
export type Relation = {
  id?: string;
  version: number;
  type: string;
  source_id: string;
  target_id: string;
  position: number;
  attributes: Record<string, any>;
};
export type User = { id: string; username: string; role: string };
export type Capability = {
  id: string;
  enabled: boolean;
  healthy: boolean;
  dependencies: Record<string, string>;
};
export async function api<T = any>(
  path: string,
  method = "GET",
  data?: any,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers:
      data instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
export function local(
  names: Names | undefined,
  locale: string,
  original = "",
  fallback = "",
) {
  return names?.[locale] || names?.["en-US"] || names?.[original] || fallback;
}
export function title(e: Entity, locale: string) {
  return (
    e.translations?.[locale]?.title ||
    e.translations?.["en-US"]?.title ||
    e.translations?.[e.original_language]?.title ||
    e.title
  );
}
export function emptyEntity(kind = "work"): Entity {
  return {
    kind,
    title: "",
    version: 0,
    status: "draft",
    original_language: "",
    translations: {},
    types: [],
    attributes: {},
    external_ids: {},
    pictures: [],
    position: 0,
    number: "",
    contents: [],
    subjects: [],
  };
}
