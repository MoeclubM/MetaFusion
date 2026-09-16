package catalog

import (
	"reflect"
	"strings"
	"time"
)

// pathTemplateParams 提取路径里的模板变量名（/a/{id}/b/{code} → [id code]），
// 保持出现顺序并去重，供 OpenAPI 逐个声明 in=path 参数。
func pathTemplateParams(path string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, seg := range strings.Split(path, "{") {
		i := strings.Index(seg, "}")
		if i <= 0 {
			continue
		}
		if name := seg[:i]; name != "" && !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	return out
}

// OpenAPI derives DTO schemas from the same structs decoded by the handlers.
// Dynamic attributes are further constrained by the published definitions endpoint.
func OpenAPI() map[string]any {
	schemas := map[string]any{}
	var schema func(reflect.Type) map[string]any
	schema = func(t reflect.Type) map[string]any {
		if t.Kind() == reflect.Pointer {
			return schema(t.Elem())
		}
		if t == reflect.TypeOf(time.Time{}) {
			return map[string]any{"type": "string", "format": "date-time"}
		}
		switch t.Kind() {
		case reflect.Struct:
			name := t.Name()
			if _, ok := schemas[name]; !ok {
				schemas[name] = map[string]any{}
				props := map[string]any{}
				for i := 0; i < t.NumField(); i++ {
					f := t.Field(i)
					key := strings.Split(f.Tag.Get("json"), ",")[0]
					if key != "" && key != "-" {
						props[key] = schema(f.Type)
					}
				}
				schemas[name] = map[string]any{"type": "object", "properties": props, "additionalProperties": false}
			}
			return map[string]any{"$ref": "#/components/schemas/" + name}
		case reflect.Map:
			return map[string]any{"type": "object", "additionalProperties": schema(t.Elem())}
		case reflect.Slice:
			return map[string]any{"type": "array", "items": schema(t.Elem())}
		case reflect.Bool:
			return map[string]any{"type": "boolean"}
		case reflect.Int, reflect.Int64:
			return map[string]any{"type": "integer"}
		case reflect.Float64:
			return map[string]any{"type": "number"}
		case reflect.String:
			return map[string]any{"type": "string"}
		default:
			return map[string]any{}
		}
	}
	for _, v := range []any{Entity{}, Edit{}, Relation{}, RelationEdit{}, LifecycleEdit{}, DefinitionVersion{}, DefinitionVersionItem{}, DefinitionRollback{}, Definitions{}, ExternalDatabase{}, Shelf{}, HomePreferences{}, ImporterPreviewRequest{}, ImporterPreviewResponse{}, ImporterImportRequest{}, ImporterImportResponse{}} {
		schema(reflect.TypeOf(v))
	}
	schemas["DefinitionDraft"] = map[string]any{"type": "object", "required": []string{"document", "base_version", "edit_note", "sources"}, "properties": map[string]any{"document": schema(reflect.TypeOf(Definitions{})), "base_version": map[string]any{"type": "integer"}, "edit_note": map[string]any{"type": "string"}, "sources": schema(reflect.TypeOf([]Source{}))}}
	paths := map[string]any{}
	add := func(path, method, summary, request, response string, auth bool) {
		// 账号/收藏前缀已归子系统，本服务只剩目录自己的三类路径。
		tag := "Catalog"
		if strings.HasPrefix(path, "/admin/catalog-definitions") || path == "/catalog/definitions" {
			tag = "Definitions"
		}
		op := map[string]any{
			"tags":    []string{tag},
			"summary": summary,
			"responses": map[string]any{
				"200": map[string]any{"description": "Success", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/" + response}}}},
				"400": map[string]any{"description": "Invalid payload, source, definition or structural constraint"},
				"401": map[string]any{"description": "Authentication required"},
				"403": map[string]any{"description": "Insufficient edit or review permission"},
				"404": map[string]any{"description": "Not found or not visible"},
				"409": map[string]any{"description": "Version conflict; read current data before retrying"},
			},
		}
		if auth {
			op["security"] = []any{map[string]any{"session": []string{}}, map[string]any{"bearer": []string{}}}
		}
		// 路径模板变量必须逐个声明：只声明 {id} 会让 {code} 这类路径留下
		// "路径里有模板变量、参数列表里没有"的空洞（OpenAPI 3.0 里属于无效文档）。
		if names := pathTemplateParams(path); len(names) > 0 {
			list := make([]any, 0, len(names))
			for _, name := range names {
				list = append(list, map[string]any{"name": name, "in": "path", "required": true, "schema": map[string]any{"type": "string"}})
			}
			op["parameters"] = list
		}
		if request != "" {
			op["requestBody"] = map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/" + request}}}}
		}
		if paths[path] == nil {
			paths[path] = map[string]any{}
		}
		paths[path].(map[string]any)[method] = op
	}
	schemas["Result"] = map[string]any{"type": "object", "additionalProperties": true}
	// 定义版本列表的响应形状：items 的元素类型单列（include_document=false 时每项没有 document 键），
	// 顶层的 include_document 是本次响应是否带文档的提示。
	schemas["DefinitionList"] = map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
		"items":            schema(reflect.TypeOf([]DefinitionVersionItem{})),
		"include_document": schema(reflect.TypeOf(false)),
	}}
	// GET /catalog/definitions 的实际响应是 DefinitionVersion + kinds（骨架多语言名，
	// 见 http.go 的 handler）。直接复用 DefinitionVersion 会漏掉 kinds，而该 schema
	// 声明了 additionalProperties:false，客户端按文档做严格校验就会失败。
	schemas["PublishedDefinitions"] = map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
		"id":           schema(reflect.TypeOf(int64(0))),
		"state":        schema(reflect.TypeOf("")),
		"base_version": schema(reflect.TypeOf(int64(0))),
		"document":     schema(reflect.TypeOf(Definitions{})),
		"created_at":   schema(reflect.TypeOf(time.Time{})),
		"kinds":        schema(reflect.TypeOf(map[string]KindRecord{})),
	}}
	for _, r := range [][6]string{
		{"/catalog/definitions", "get", "Published dynamic definitions plus the fixed entity-skeleton names (multilingual kinds)", "", "PublishedDefinitions", ""}, {"/catalog/entities", "get", "Entity search (kind/kinds/q/type/types/status/work_id/content_unit_id/release_id/medium_id/parent_id/field/value/tags; field supports dotted paths like attachments.store or locator.path, structural locator./inclusion_attributes./subject_attributes. compile to track_contents/release_subjects EXISTS; items + real COUNT total; 120/min per IP)", "", "Result", ""}, {"/catalog/entities", "post", "Create entity with evidence (supports Idempotency-Key, 24h)", "Edit", "Entity", "auth"},
		{"/catalog/tags", "get", "Tag frequency aggregation over published entities' attributes.tags (q filter, limit<=500)", "", "Result", ""},
		{"/catalog/entities/{id}", "get", "Read visible entity", "", "Entity", ""}, {"/catalog/entities/{id}", "put", "Replace entity with optimistic version check", "Edit", "Entity", "auth"}, {"/catalog/entities/{id}/resolve", "get", "Resolve merged identity", "", "Entity", ""}, {"/catalog/entities/{id}/lifecycle", "post", "Merge or retire (requires catalog.lifecycle.manage)", "LifecycleEdit", "Entity", "auth"},
		{"/catalog/entities/{id}/revisions", "get", "Read visible revision history", "", "Result", ""}, {"/catalog/entities/{id}/relations", "get", "Read contextual forward and reverse relations; the response carries subject_id (the queried entity) and entities covering both ends of every returned relation — including the subject itself, so callers can render either side without an extra lookup", "", "Result", ""}, {"/catalog/entities/{id}/occurrences", "get", "Read own reverse inclusions, scoped by entity kind (expression=itself, content_unit=its expressions, work=its expressions)", "", "Result", ""}, {"/catalog/expressions/details", "post", "Batch expression details (entity + own inclusions + same-content-unit siblings + credit) for release pages; JSON body {ids:[...]}", "Result", "Result", ""}, {"/catalog/external-databases", "get", "List active external authority database definitions", "", "Result", ""}, {"/catalog/shelves", "get", "List enabled shelf rules (shared by homepage and admin)", "", "Result", ""},
		{"/catalog/compare", "get", "Compare two to six releases (10/min per IP)", "", "Result", ""},
		{"/exchange/entities/{id}", "get", "Export an entity snapshot for another instance", "", "Entity", ""},
		{"/exchange/proposals", "post", "Submit an external edit proposal (always lands in pending_review)", "Edit", "Entity", "auth"},
		{"/importer/preview", "post", "Preview external catalog entry via an outbound fetch (requires catalog.import.submit, 10/min per IP; only Bangumi URLs/IDs; media_type_hint is rejected as not_supported; an invalid entity_type is rejected with invalid_entity_type, the same code /importer/import returns for the same payload)", "ImporterPreviewRequest", "ImporterPreviewResponse", "auth"},
		{"/importer/import", "post", "Import previewed entry with evidence (requires catalog.import.submit; validated with zero writes before the first save: attribute values, unknown field codes, original_language, translation rows and date fields are checked against the published definitions with the same rules as entity saves; media/release original_language and translation rows are written to the medium/release entity; payload objects with no write path for the requested entity_type (canonical_entries/mediums/release on entity_type != work) are rejected with unsupported_field_for_entity_type instead of being ignored; download_cover=false skips remote cover refs; is_master_verified and media_type_hint are rejected; has_release=true without mediums, and a release object that declares data while mediums is empty (null or {} counts as absent, like an omitted field), are rejected with invalid_payload (mediums is the write instruction for the release chain in new_work/create_relation; a carrier-less release is only reachable through link_mode=append_release_to_work); link_mode merge_translations is rejected; an invalid entity_type is rejected with invalid_entity_type, the same code /importer/preview returns (no silent fallback to work); release.cover_image_url is honoured as a Picture on the release entity (remote URL reference only, first picture wins when an existing release is reused); payload fields with no model slot are rejected with unsupported_field_for_entity_type instead of being silently dropped: mediums[*].media_category (no such field in the model, and the preview response always reports it empty), release.cover_aspect (Picture has no aspect; ratios are a display hint), release.notes and release.catalog_metadata (no such field on the release entity) and release.language (the release type declares no language field; use original_language/translations))", "ImporterImportRequest", "ImporterImportResponse", "auth"},
		{"/catalog/relations", "post", "Create contextual relation (requires catalog.relation.edit; supports Idempotency-Key, 24h)", "RelationEdit", "Relation", "auth"}, {"/catalog/relations/{id}", "put", "Replace relation context (requires catalog.relation.edit)", "RelationEdit", "Relation", "auth"}, {"/catalog/relations/{id}", "delete", "Remove relation with evidence (requires catalog.relation.edit)", "LifecycleEdit", "Result", "auth"},
		{"/admin/catalog-definitions", "get", "List definition versions (requires catalog.definitions.manage); each item carries state, created_at, created_by (when a revision row exists) and a short counts summary. include_document defaults to true and keeps the full document on every item; include_document=false omits the document key entirely (and reads no document from the database) while keeping every other metadata field, and the response-level include_document tells the client whether documents came along — read one version with GET /admin/catalog-definitions/{id}; an unparsable value is rejected with invalid_payload instead of silently returning documents", "", "DefinitionList", "auth"}, {"/admin/catalog-definitions", "post", "Save immutable draft (requires catalog.definitions.manage)", "DefinitionDraft", "Result", "auth"}, {"/admin/catalog-definitions/{id}/impact", "get", "Validate draft against all current data", "", "Result", "auth"}, {"/admin/catalog-definitions/{id}/publish", "post", "Publish compatible draft (requires catalog.definitions.manage)", "LifecycleEdit", "Result", "auth"},
		{"/admin/catalog-definitions/{id}", "get", "Read one definition version with its full document plus state, base_version, created_at, created_by (when a revision row exists) and the same counts summary as the list (requires catalog.definitions.manage); any state is readable, including superseded and draft; a non-numeric or unknown id is 404 not_found", "", "DefinitionVersion", "auth"},
		{"/admin/catalog-definitions/{id}/rollback", "post", "Re-draft a historical definition version on top of the current published version and publish it through the same impact validation (requires catalog.definitions.manage); no_op=true returns the existing published version without writing when the document already matches; 404 when the id is not a definition version", "", "DefinitionRollback", "auth"},
		{"/admin/external-databases", "get", "List external authority databases (requires catalog.definitions.manage)", "", "Result", "auth"},
		{"/admin/external-databases", "post", "Create external authority database (requires catalog.definitions.manage)", "ExternalDatabase", "Result", "auth"},
		{"/admin/external-databases/{code}", "put", "Update external authority database (requires catalog.definitions.manage)", "ExternalDatabase", "Result", "auth"},
		{"/admin/external-databases/{code}", "delete", "Delete external authority database (requires catalog.definitions.manage)", "", "Result", "auth"},
		{"/catalog/shelves", "get", "List enabled shelf rules (shared by homepage and admin)", "", "Result", ""},
		{"/catalog/shelves/feed", "get", "Evaluate shelf rules with their items, ordered by caller preferences", "", "Result", ""},
		{"/catalog/me/home-preferences", "get", "Read caller homepage section preferences", "", "Result", "auth"},
		{"/catalog/me/home-preferences", "put", "Replace caller homepage section preferences", "HomePreferences", "Result", "auth"},
		{"/admin/shelves", "get", "List shelf rules (requires catalog.shelves.manage)", "", "Result", "auth"},
		{"/admin/shelves", "post", "Create shelf rule (requires catalog.shelves.manage)", "Shelf", "Result", "auth"},
		{"/admin/shelves/{id}", "get", "Read shelf rule (requires catalog.shelves.manage)", "", "Result", "auth"},
		{"/admin/shelves/{id}", "put", "Update shelf rule (requires catalog.shelves.manage)", "Shelf", "Result", "auth"},
		{"/admin/shelves/{id}", "delete", "Delete shelf rule (requires catalog.shelves.manage)", "", "Result", "auth"},
	} {
		add(r[0], r[1], r[2], r[3], r[4], r[5] != "")
	}
	params := []any{}
	for _, p := range []struct{ name, desc string }{
		{"kind", "Single entity kind filter"},
		{"kinds", "Multi-value kind filter (repeat or comma-separated, OR)"},
		{"type", "Single dynamic business-type filter"},
		{"types", "Multi-value business-type filter (repeat or comma-separated, OR)"},
		{"status", "Entity status filter"},
		{"q", "Substring match on title and translations"},
		{"field", "Attribute filter: single field or dotted path (attachments.store, locator.path, inclusion_attributes.translator, subject_attributes.seq); leaves must be searchable, full chain enabled"},
		{"value", "Exact value compared with field (text equality via ->>)"},
		{"work_id", "Expressions/content_units of the work + releases declaring it"},
		{"content_unit_id", "Expressions under the content unit"},
		{"release_id", "Mediums under the release"},
		{"medium_id", "Tracks under the medium"},
		{"parent_id", "Child content_units/mediums/tracks"},
		{"tags", "Multi-value tag filter (repeat or comma-separated, OR, container match @>)"},
		{"limit", "Page size, default 50, max 100"},
		{"offset", "Page offset, default 0"},
	} {
		params = append(params, map[string]any{"name": p.name, "in": "query", "description": p.desc, "schema": map[string]any{"type": "string"}})
	}
	paths["/catalog/entities"].(map[string]any)["get"].(map[string]any)["parameters"] = params
	paths["/catalog/compare"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{map[string]any{"name": "ids", "in": "query", "required": true, "description": "Two to six comma-separated release UUIDs", "schema": map[string]any{"type": "string"}}}
	// 查询参数补齐（与 http.go 实际读取一致）：收藏分页/过滤、标签聚合、货架 feed、
	// 查询参数补齐（与 http.go 实际读取一致）：标签聚合与货架 feed。
	qp := func(name, desc string, required bool) map[string]any {
		return map[string]any{"name": name, "in": "query", "required": required, "description": desc, "schema": map[string]any{"type": "string"}}
	}

	paths["/catalog/tags"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{
		qp("q", "Substring filter on tag name", false),
		qp("limit", "Max tags, default 200, max 500", false),
	}
	paths["/catalog/shelves/feed"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{
		qp("per_shelf", "Items per shelf, default 12, max 100", false),
	}
	paths["/admin/catalog-definitions"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{
		qp("include_document", "Whether each item carries its full document; default true, false omits the document key (read one version with GET /admin/catalog-definitions/{id})", false),
	}
	// 权限级别说明：OpenAPI security 只区分匿名/登录；管理端点的权限码在 summary 标注
	// （见各 admin/* 与 lifecycle 行），与 http.go required(<code>) 对应，不另加字段。
	// 老令牌（无 permissions 声明）按角色兜底（见 permission.go 的 User.Can）。
	return map[string]any{
		"openapi": "3.0.3",
		"info": map[string]any{
			"title":       "MetaFusion API",
			"description": "MetaFusion 元数据目录服务 API：固定实体骨架（Work / Expression / Release / Medium / Track / ContentUnit / Agent / Collection）、动态类型与属性扩展、多版本发行对比、外部库导入与实例间导入导出。账号（/auth、/oauth、/oidc）与收藏（/favorites）已由独立子系统提供，不在本服务。",
			"version":     "1.0.0",
		},
		// servers 保持相对路径 /api：网关/直连后端均同源，不硬编码域名；
		// OIDC discovery 的 issuer 由运行时 TokenIssuerURL/请求拼出，不在此写死。
		"servers": []any{
			map[string]any{"url": "/api", "description": "标准统一主干 API"},
		},
		"tags": []any{
			map[string]any{"name": "Catalog", "description": "核心实体编目与查询 (Work, Release, Medium, Track, ContentUnit, Agent, Collection)"},
			map[string]any{"name": "Definitions", "description": "无代码动态元数据类型、属性与关系定义管理"},
			map[string]any{"name": "ExternalDatabases", "description": "外部权威数据库与官方渠道配置"},
		},
		"paths": paths,
		"components": map[string]any{
			"schemas": schemas,
			"securitySchemes": map[string]any{
				"session": map[string]any{"type": "apiKey", "in": "cookie", "name": "mf_session"},
				"bearer":  map[string]any{"type": "http", "scheme": "bearer"},
			},
		},
	}
}
