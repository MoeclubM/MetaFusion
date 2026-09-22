import { fetchApi } from "./client";
import type { User } from "./client";
import { canonicalDetailPath } from "../entityRoutes";
import { resolveLocalizedName } from "../localizedNames";

export interface Tag {
  id: number;
  name: string;
}



export function pickLocalizedName(
  locale: string,
  names?: Record<string, string> | null,
  defaultSlug?: string
): string {
  return resolveLocalizedName(names, locale, defaultSlug || "");
}

export interface ConnectedEntityItem {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  original_name?: string;
  cover_url?: string;
  country?: string;
  relationship_type: string;
  relationship_name: string;
  /** 关系行 id：同一类型同一对端存在多条边（多次署名）时用它区分身份。 */
  relation_id?: string;
  qualifier?: string;
  direction: 'forward' | 'reverse';
  label: string;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  is_current?: boolean;
  date_span?: string;
  attributes: Record<string, any>;
}

export interface EntityRevision {
  id: string;
  target_type: string;
  target_id: string;
  editor_id?: string;
  edit_type: string;
  summary: string;
  edit_note: string;
  source_urls?: string[];
  before_state: Record<string, any>;
  after_state: Record<string, any>;
  diff: Record<string, { old: any; new: any }>;
  status: string;
  created_at: string;
  editor?: User;
}

export interface EntityRelationship {
  id?: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relationship_type: string;
  qualifier?: string;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  attributes: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface RelationType {
  code: string;
  domain: string;
  names?: Record<string, string>;
  description?: string;
  allowed_source_types?: string[];
  allowed_target_types?: string[];
  is_symmetric: boolean;
  is_hierarchical: boolean;
  // 是否具有时间语义（任期/隶属/合约期）：为 true 时编辑器展示 begin/end/ended 输入。
  is_temporal?: boolean;
  attribute_schema?: { fields?: any[] } | any[];
  color: string;
  icon: string;
  sort_order: number;
  is_system: boolean;
  is_enabled: boolean;
  created_at?: string;
  display_name?: string;
  forward_label?: string;
  reverse_label?: string;
}









export function catalogEntityHref(type: string, id: string): string {
  return canonicalDetailPath(type, id) || `/catalog/${id}`;
}

export interface GraphNode {
  id: string;
  name: string;
  original_name?: string;
  type: string;
  category: string;
  role?: string;
  level: number;
  cover_image_url?: string;
  disambiguation?: string;
  country?: string;
  status?: string;
}

export interface GraphLink {
  id?: string;
  source: string;
  target: string;
  source_type?: string;
  target_type?: string;
  type: string;
  label: string;
  qualifier?: string;
  color?: string;
  attributes?: Record<string, any>;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  is_hierarchical?: boolean;
}

/**
 * 下架：把已发布条目退回草稿（POST /catalog/entities/:id/unpublish）。
 *
 * 这是状态机里**唯一**的降级入口：保存端点拒绝 published→draft（回 400 use_lifecycle_endpoint），
 * 生命周期端点 POST …/lifecycle 只写终态 deleted/merged。服务端只接受 published→draft：
 * draft/pending_review 没有可下架的内容、deleted/merged 是终态，四种情况一律 400 invalid_status。
 *
 * 请求体字段与 LifecycleEdit 同口径，但**没有 target_id**——带上它会被严格解码拒成
 * invalid_payload（不是被忽略）。证据（edit_note + 至少一条 sources）照常校验，
 * 下架会留一条修订行与 entity.unpublished 事件。
 */
export async function unpublishEntity(payload: {
  entity_id: string;
  /** 乐观并发的版本号；语义是"我下架的是我看到的那一版"。 */
  expected_version: number;
  edit_note: string;
  /** 考据来源（可选）：填了就作为 url 来源，citation 仍用下架说明。 */
  source_urls?: string[];
  /** 没有链接时的 self 来源文案（调用方传四语键）。 */
  citation: string;
}): Promise<Record<string, any>> {
  const note = (payload.edit_note || "").trim();
  const citation = (note || payload.citation || "").trim();
  const urls = (payload.source_urls || []).map((u) => u.trim()).filter(Boolean);
  // 与合并同一套口径：服务端要求 edit_note 与至少一条 sources 都非空，
  // 缺链接时补一条 kind=self 的站内自述来源，不用站点地址冒充外部证据。
  const sources =
    urls.length > 0
      ? urls.map((url) => ({ kind: "url", citation, url }))
      : [{ kind: "self", citation }];
  return fetchApi<Record<string, any>>(`/catalog/entities/${payload.entity_id}/unpublish`, {
    method: "POST",
    body: JSON.stringify({
      expected_version: payload.expected_version,
      edit_note: note || citation,
      sources,
    }),
  });
}

// 合并走实体生命周期端点：POST /catalog/entities/:id/lifecycle（action=merge 语义由
// target_id 表达，服务端把 source 并入 target 并改写引用）。
export async function mergeEntities(payload: {
  source_id: string;
  target_id: string;
  merge_note: string;
  /** 考据链接（可选）：填了就作为 url 来源，citation 仍用合并说明。 */
  source_urls?: string[];
  /** 没有链接时的 self 来源文案（调用方传四语键）；缺省回落到合并说明。 */
  citation?: string;
}): Promise<{ message: string; target_id: string }> {
  const note = (payload.merge_note || "").trim();
  const citation = (note || payload.citation || "").trim();
  const urls = (payload.source_urls || []).map((u) => u.trim()).filter(Boolean);
  // 服务端 validateSources 要求 edit_note 与 sources **都**非空，sources 里每项的 citation 也要非空。
  // 用户不填可选的考据链接时若照旧传空数组，这次合并必然 400 evidence_required——
  // 因此缺链接时补一条 kind=self 的站内来源，而不是伪造外部 URL。
  const sources =
    urls.length > 0
      ? urls.map((url) => ({ kind: "url", citation, url }))
      : [{ kind: "self", citation }];
  const source = await fetchApi<{ version: number }>(`/catalog/entities/${payload.source_id}`);
  await fetchApi(`/catalog/entities/${payload.source_id}/lifecycle`, {
    method: "POST",
    body: JSON.stringify({
      expected_version: source.version,
      target_id: payload.target_id,
      edit_note: note || citation,
      sources,
    }),
  });
  return { message: "merged", target_id: payload.target_id };
}
