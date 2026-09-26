import { pickRecordTitle } from "@/lib/titles";
import { fetchApi } from "@/lib/api";
import { ENTITY_KINDS } from "@/lib/kinds.generated";

/** 固定八种骨架：单一来源是目录库基线（见 frontend/scripts/generate-contracts.mjs）。 */
export const kinds: string[] = [...ENTITY_KINDS];
export type Names = Record<string, string>;
export type Field = {
  names: Names;
  type: string;
  enabled: boolean;
  required?: boolean;
  searchable?: boolean;
  comparable?: boolean;
  /** 存档/检索用途：可写可检索但不进详情面板与编辑器分组区。 */
  hidden?: boolean;
  /** 对比语义（闭集）："content" 为内容选择范围，"locating" 为本版定位。 */
  semantics?: string;
  unit?: Names;
  vocabulary?: string;
  kinds?: string[];
  fields?: Record<string, Field>;
  items?: Field;
  min?: number;
  max?: number;
  /** 仅 group 字段：组内任一其它子字段有值时该锚点子字段必填。 */
  anchor_key?: string;
  /** 仅 group 内的 number 子字段：声明本字段是同组该子字段的区间终点（起点不得大于终点）。 */
  range_start?: string;
};
export type Scheme = {
  names: Names;
  slot: string;
  kinds?: string[];
  types?: string[];
  medium_formats?: string[];
  fields: string[];
  required?: string[];
  require_range?: boolean;
  enabled: boolean;
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
  schemes?: Record<string, Scheme>;
  /** 各层级的"所属与收录结构"：由服务端下发，编辑器据此渲染结构字段与资源区块。 */
  structure?: Record<
    string,
    {
      fields?: {
        code: string;
        target_kinds?: string[];
        scoped_by?: string;
        required?: boolean;
      }[];
      resources?: boolean;
      subjects?: boolean;
      contents?: boolean;
    }
  >;
  fields: Record<string, Field>;
  vocabularies: Record<
    string,
    { names: Names; terms: Record<string, { names: Names; enabled: boolean; is_bonus?: boolean }> }
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
      /** 聚合/组成关系：内容目录按它收录组成员（见 lib/definitions.ts RelationDef）。 */
      aggregate?: boolean;
      /** 署名槽位 person/character/peer，空=未声明（老文档）：展示端据此判定署名/角色。 */
      participant_slot?: string;
      /** 参与批量署名聚合：口径只看本声明，不看分组码（见 lib/definitions.ts）。 */
      counts_as_credit?: boolean;
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
      primary_date_field?: string;
      badge_fields?: string[];
      facet_fields?: string[];
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
  // 多图契约（见 backend/internal/catalog/types.go 的 PicturesJSON）：**数组顺序就是展示顺序**，
  // pictures[0] 即封面，服务端保存时不重排；taken_at 只是这张图自身的时间元信息、不参与排序。
  // 取封面一律走 lib/cover.ts 的 coverPicture / coverUrl，不在消费点重新索引 [0]。
  // role 是 picture_role 词表的用途码（空=未声明，存量图全部如此）；asset_id 是自托管封面
  // 在存储服务里的 assets UUID，此时 url 指向 /api/storage/assets/<uuid>/content。
  pictures: {
    url: string;
    caption: Names;
    taken_at?: string;
    role?: string;
    asset_id?: string;
    source: Source;
  }[];
  work_id?: string;
  content_unit_id?: string;
  release_id?: string;
  medium_id?: string;
  parent_id?: string;
  position: number;
  number: string;
  // 收录与发行对象的附加属性：键为 definitions 声明的子字段码
  // （inclusion_attributes / subject_attributes），未声明时为空。
  contents: {
    expression_id: string;
    position: number;
    locator: Record<string, any>;
    attributes?: Record<string, any>;
  }[];
  subjects: {
    work_id: string;
    role: string;
    position: number;
    attributes?: Record<string, any>;
  }[];
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
  /** 该边的主体实体（/relations 响应级 subject_id 的逐条形态）；旧响应没有该字段。 */
  subject_id?: string;
};
// 会话用户类型只有一份：lib/api/client.ts 的 User（原始响应 → User 的唯一映射是
// lib/api/auth.ts 的 normalizeSessionUser）。这里 re-export 只为兼容既有调用点，
// 不再另立一份同名字段更少的类型——两份类型会让"登录路径少带 groups/permissions"
// 这类缺口在类型层面看不出来。
export type { User } from "@/lib/api/client";
// 社区短评（modules.posts）：按实体聚合，不是独立主题模型。
// 它就是 /community/entities/:id/posts 的响应形状，类型只在 lib/api/community.ts 声明一处，
// 这里 re-export 以保住既有调用点（同一份契约不要在前端留两份类型）。
export type { EntityComment as CommunityPost } from "@/lib/api/community";
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
  extraHeaders?: Record<string, string>,
): Promise<T> {
  // 统一走 lib/api.ts 的 fetchApi：它带同域 Cookie、按 locale 设头、
  // 并在 401 时静默续期后重试一次。此前这里自己 fetch，既不带令牌也没有续期——
  // 访问令牌 15 分钟一过，编辑器就再也写不进去（真人在编辑半小时后必然遇到）。
  return fetchApi<T>(path, {
    method,
    headers: extraHeaders,
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
}

// fetchAllPages：对列表端点按 offset 翻页直到取完（端点返回真实 total，长度不足一页即停），
// 详情页的载体/曲目等完整目录依赖它，避免硬 limit 截断大型合集。
export async function fetchAllPages<T = any>(query: string, pageSize = 100): Promise<T[]> {
  const items: T[] = [];
  const sep = query.includes("?") ? "&" : "?";
  for (let offset = 0; ; offset += pageSize) {
    const r = await api<{ items: T[] }>(`${query}${sep}offset=${offset}&limit=${pageSize}`);
    items.push(...(Array.isArray(r.items) ? r.items : []));
    if ((Array.isArray(r.items) ? r.items : []).length < pageSize) return items;
  }
}

// mapLimit：带并发上限的顺序保底映射；详情页按实体逐个补取数据时防止请求风暴。
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
export function local(
  names: Names | undefined,
  locale: string,
  original = "",
  fallback = "",
) {
  if (!names) return fallback;
  const get = (code: string): string => {
    const v = names[code];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };
  if (get(locale)) return get(locale);
  const low = locale.trim().toLowerCase();
  const short = low.split("-")[0];
  for (const [k, v] of Object.entries(names)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const kl = k.trim().toLowerCase();
    if (kl === short || kl.split("-")[0] === short) return v.trim();
  }
  if (get("zh-CN") || get("zh")) return get("zh-CN") || get("zh");
  if (get("zh-TW") || get("zh-Hant")) return get("zh-TW") || get("zh-Hant");
  if (get("ja") || get("ja-JP")) return get("ja") || get("ja-JP");
  if (get("en-US") || get("en")) return get("en-US") || get("en");
  if (original && get(original)) return get(original);
  return fallback;
}
export function title(e: Entity, locale: string, order: string[] = []) {
  return pickRecordTitle(locale, e.translations, e.title, {
    order,
    originalLanguage: e.original_language,
  });
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
