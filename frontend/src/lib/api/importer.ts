// 由 frontend/src/lib/api.ts 按域拆分而来（机械搬运：导出名、签名、行为与拆分前一致）。
// 域：外部来源导入 /api/importer/*
import { fetchApi } from "./client";
import type { Entity } from "@/components/catalog/api";

// ── OmniSource Importer 多源权威数字馆藏一键导入套件 ──
export interface ImporterPreviewRequest {
  source?: string;
  url_or_id: string;
  entity_type?: string;
}

export interface ImporterTranslationItem {
  locale: string;
  title: string;
  summary: string;
  /** 同语种并列标题（后端 translate-preview 的 TranslationItem.aliases） */
  aliases?: string[];
}

export interface ImporterWorkPreview {
  title: string;
  original_title: string;
  aliases: string[];
  release_date: string;
  begin_date?: string;
  country: string;
  language: string;
  original_language?: string;
  summary: string;
  cover_image_url: string;
  cover_aspect: string;
  content_rating: string;
  tags: string[];
  translations: ImporterTranslationItem[];
  catalog_metadata?: Record<string, any>;
}

export interface ImporterArtistPreview {
  id?: string;
  name: string;
  original_name?: string;
  role: string;
  entity_type: string;
  country?: string;
  biography?: string;
  disambiguation?: string;
  language?: string;
  avatar_url?: string;
  character_name?: string;
  aliases?: string[];
  external_ids?: Record<string, any>;
  translations?: ImporterTranslationItem[];
  matched_artist?: Entity;
  /** 该关联应落到的 definitions 关系码（directed_by / voiced_by / character_in 等） */
  relation_type?: string;
  /** 角色番位词表项（primary / supplement / extra） */
  relation_role?: string;
}

export interface StaffAssociation {
  parsed_name: string;
  parsed_original?: string;
  parsed_role: string;
  entity_type: string;
  action: "create" | "link" | "skip";
  target_artist_id?: string;
  character_name?: string;
  country?: string;
  biography?: string;
  language?: string;
  avatar_url?: string;
  external_ids?: Record<string, any>;
  translations?: ImporterTranslationItem[];
  relation_type?: string;
  relation_role?: string;
}

export interface ImporterTrackPreview {
  position: number;
  title: string;
  duration_seconds: number;
  artist_credit?: string;
  isrc?: string;
  recording_mbid?: string;
  /** 手工匹配的既有表达（同 Work），优先于后端自动对齐。 */
  expression_id?: string;
  /** 该曲目对应的 canonical_entries 下标：结构绑定到本次清单的稳定节点，不靠标题传递。 */
  entry_index?: number;
}

export interface ImporterMediumPreview {
  position: number;
  number?: string;
  name: string;
  format: string;
  media_category: string;
  role?: "primary" | "supplement" | string;
  original_language?: string;
  translations?: Record<string, { name?: string }>;
  tracks: ImporterTrackPreview[];
}

export interface ImporterReleasePreview {
  cover_image_url?: string;
  cover_aspect?: string;
  original_language?: string;
  translations?: Record<string, { edition_name?: string; notes?: string }>;
  edition_name: string;
  catalog_number?: string;
  barcode?: string;
  publisher?: string;
  packaging?: string;
  country?: string;
  language?: string;
  distribution_channel?: string;
  edition_date?: string;
  notes?: string;
  catalog_metadata?: Record<string, any>;
}

export interface ImporterCanonicalEntryPreview {
  title: string;
  translations?: Record<string, { title?: string; summary?: string }>;
  position: number;
  number?: string;
  entry_role?: string;
  original_language?: string;
  duration_seconds?: number;
  attributes?: Record<string, any>;
  external_ids?: Record<string, any>;
  /** 落库层级：content_unit（篇目/分集）或 expression（默认，录音/正文）。 */
  entry_kind?: string;
  /** 同一 canonical_entries 数组内父级下标（章节树），顶层省略或为 -1。 */
  parent_index?: number;
  /** 手工匹配的既有表达（可跨 Work），优先于自动对齐。 */
  expression_id?: string;
}

export interface ImporterPreviewResponse {
  source: string;
  entity_type?: string;
  external_id: string;
  external_url: string;
  media_type: string;
  work?: ImporterWorkPreview;
  artist?: ImporterArtistPreview;
  artists?: ImporterArtistPreview[];
  has_release?: boolean;
  canonical_entries?: ImporterCanonicalEntryPreview[];
  release?: ImporterReleasePreview | null;
  mediums?: ImporterMediumPreview[];
  tags: string[];
  /** 来源抓取不完整等告警（如分集 total 与实取不符），前端需提示而非当作完整。 */
  warnings?: string[];
}

export interface ImporterImportRequest {
  entity_type?: string;
  source?: string;
  url_or_id?: string;
  external_id?: string;
  work?: ImporterWorkPreview;
  artist?: ImporterArtistPreview;
  artists?: ImporterArtistPreview[];
  staff_associations?: StaffAssociation[];
  has_release?: boolean;
  canonical_entries?: ImporterCanonicalEntryPreview[];
  release?: ImporterReleasePreview | null;
  mediums?: ImporterMediumPreview[];
  download_cover?: boolean;
  edit_note?: string;
  source_urls?: string[];
  is_master_verified?: boolean;
  target_work_id?: string;
  link_mode?: "new_work" | "append_release_to_work" | "create_relation";
  relation_type?: string;
}

export interface ImporterImportResponse {
  success: boolean;
  entity_type?: string;
  work_id?: string;
  release_id?: string;
  artist_id?: string;
  /** 落库后返回的目标实体（work / release / agent 统一 DTO）。 */
  work?: Entity;
  release?: Entity;
  artist?: Entity;
  imported_counts: {
    artists: number;
    mediums: number;
    tracks: number;
    /** 落库的篇目/分集数（ContentUnit）。 */
    content_units?: number;
  };
  redirect_url: string;
}

// ── 可用导入源清单（GET /importer/sources）──
// id 是**真正实现了适配器**的来源；names / category / icon / description 来自
// external databases 注册表（后台改名即时生效）。前端不维护第二份来源列表：
// 此前写死在导入弹窗 tab 上的 musicbrainz / tmdb / imdb / vndb / douban
// 在后端只回 not_supported。
export interface ImporterSource {
  id: string;
  /** 四语名称映射（zh-CN / zh-TW / ja-JP / en-US），展示按 pickLocalizedName 的回退链解析。 */
  names: Record<string, string>;
  /** 适用实体 kind：all 或固定八实体 kind 之一（artist/organization/character 在骨架里都属 agent）。 */
  category: string;
  icon: string;
  description: string;
  url_pattern?: string;
}

export function fetchImporterSources(): Promise<{ items: ImporterSource[] }> {
  return fetchApi<{ items: ImporterSource[] }>("/importer/sources");
}

export function previewExternalCatalog(payload: ImporterPreviewRequest): Promise<ImporterPreviewResponse> {
  return fetchApi<ImporterPreviewResponse>("/importer/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function importExternalCatalog(payload: ImporterImportRequest): Promise<ImporterImportResponse> {
  return fetchApi<ImporterImportResponse>("/importer/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── 插件系统 (Plugin System) ──
