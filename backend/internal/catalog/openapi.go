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
	for _, v := range []any{Entity{}, Edit{}, Relation{}, RelationEdit{}, LifecycleEdit{}, UnpublishEdit{}, DefinitionVersion{}, DefinitionVersionItem{}, DefinitionRollback{}, DefinitionDiff{}, Definitions{}, ExternalDatabase{}, Shelf{}, HomePreferences{}, HomeSection{}, UserContributions{}, ContributionItem{}, UserContributionStats{}, ImporterPreviewRequest{}, ImporterPreviewResponse{}, ImporterImportRequest{}, ImporterImportResponse{}, ImporterSource{}, VersionInfo{}} {
		schema(reflect.TypeOf(v))
	}
	schemas["DefinitionDraft"] = map[string]any{"type": "object", "description": "Draft or published definition document. Every name (types, fields, vocabularies and terms, relations incl. reverse_names and group_names, templates and their sections, schemes, field unit) of an enabled entry must carry all four locales zh-CN / zh-TW / en-US and ja or ja-JP; missing locales are rejected with four_locale_names_required (the error lists the missing locale codes). Names are returned as-is: the server never resolves a single locale.", "required": []string{"document", "base_version", "edit_note", "sources"}, "properties": map[string]any{"document": schema(reflect.TypeOf(Definitions{})), "base_version": map[string]any{"type": "integer"}, "edit_note": map[string]any{"type": "string"}, "sources": schema(reflect.TypeOf([]Source{}))}}
	paths := map[string]any{}
	add := func(path, method, summary, request, response string, auth bool) {
		// 账号/收藏前缀已归子系统，本服务只剩目录自己的三类路径。
		tag := "Catalog"
		if strings.HasPrefix(path, "/admin/catalog-definitions") || path == "/catalog/definitions" {
			tag = "Definitions"
		}
		// 外部权威库的读写（/catalog/external-databases 与 /admin/external-databases）
		// 归第三个 tag：tags 清单里声明了它，这些操作就不该留在 Catalog 组里。
		if strings.Contains(path, "external-databases") {
			tag = "ExternalDatabases"
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
	// 状态计数的响应形状：五个状态键逐个显式声明（entityStatuses 与迁移 000001 的 CHECK 同集），
	// 客户端因此知道列表端点永远不给的 deleted / merged 一定会出现，而不是"看运气有没有键"。
	statusProps := map[string]any{}
	for _, code := range entityStatuses {
		statusProps[code] = map[string]any{"type": "integer", "minimum": 0}
	}
	schemas["EntityStatusCounts"] = map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
		"statuses": map[string]any{"type": "object", "additionalProperties": false, "description": "Every status of the catalog.entities.status constraint, zero-filled: a missing key is not the same statement as a real zero", "properties": statusProps},
		"total":    map[string]any{"type": "integer", "minimum": 0},
	}}
	// 定义版本列表的响应形状：items 的元素类型单列（include_document=false 时每项没有 document 键），
	// 顶层的 include_document 是本次响应是否带文档的提示。
	schemas["DefinitionList"] = map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
		"items":            schema(reflect.TypeOf([]DefinitionVersionItem{})),
		"include_document": schema(reflect.TypeOf(false)),
	}}
	// GET /catalog/definitions 的实际响应是 DefinitionVersion + kinds（骨架多语言名，
	// 见 http.go 的 handler）。直接复用 DefinitionVersion 会漏掉 kinds，而该 schema
	// 声明了 additionalProperties:false，客户端按文档做严格校验就会失败。
	// 可用导入源清单：items 的元素类型单列，客户端不必猜 names 的语种键与 category 取值。
	schemas["ImporterSourceList"] = map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
		"items": schema(reflect.TypeOf([]ImporterSource{})),
	}}
	schemas["PublishedDefinitions"] = map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
		"id":           schema(reflect.TypeOf(int64(0))),
		"state":        schema(reflect.TypeOf("")),
		"base_version": schema(reflect.TypeOf(int64(0))),
		"document":     schema(reflect.TypeOf(Definitions{})),
		"created_at":   schema(reflect.TypeOf(time.Time{})),
		"kinds":        schema(reflect.TypeOf(map[string]KindRecord{})),
	}}
	for _, r := range [][6]string{
		{"/version", "get", "Build identity of the running catalog process: the version and git SHA injected at build time, the build timestamp, and when this process started (all UTC, RFC 3339). Anonymous and read-only — it exists so that a deploy, a cutover or a rollback can be answered with 'which commit is actually running' instead of guessing from behaviour. Deliberately free of configuration, credentials, host names and database or object-storage details; anything the build did not inject comes back as the literal string unknown (an empty field would be indistinguishable from a broken build)", "", "VersionInfo", ""},
		{"/catalog/definitions", "get", "Published dynamic definitions plus the fixed entity-skeleton names (multilingual kinds)", "", "PublishedDefinitions", ""}, {"/catalog/entities", "get", "Entity search (kind/kinds/q/type/types/status/work_id/content_unit_id/release_id/medium_id/parent_id/field/value/tags; field takes a published field code; a dotted path works only when every level is searchable and enabled, so the seed definitions expose top-level codes such as tags, duration, edition_date and barcode; items + real COUNT total, plus 400 invalid_sort / invalid_order for a sort key or direction outside the whitelist. Rate limited to 120 requests per minute per IP: every response from a limited route carries X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset (seconds until the window resets), and an exhausted budget answers 429 rate_limited with Retry-After)", "", "Result", ""}, {"/catalog/entities", "post", "Create entity with evidence (supports Idempotency-Key, 24h)", "Edit", "Entity", "auth"},
		{"/catalog/entities/stats", "get", "Entity counts grouped by status over the whole catalog.entities table, plus the real table total (requires catalog.lifecycle.manage; 120/min per IP). The list endpoint's shared filter always excludes deleted and merged rows — that visibility rule is deliberate and unchanged — so this aggregate is the only source for the tombstone count. statuses always carries all five codes (draft, pending_review, published, deleted, merged), zero-filled when a status has no rows, and total equals count(*) of the table, so a key that is present with 0 is a fact while an absent key means the count was not obtained", "", "EntityStatusCounts", "auth"},
		{"/catalog/tags", "get", "Tag frequency aggregation over published entities' attributes.tags (q filter, limit<=500)", "", "Result", ""},
		{"/catalog/entities/{id}", "get", "Read visible entity", "", "Entity", ""}, {"/catalog/entities/{id}", "put", "Replace entity with optimistic version check", "Edit", "Entity", "auth"}, {"/catalog/entities/{id}/resolve", "get", "Resolve merged identity", "", "Entity", ""}, {"/catalog/entities/{id}/lifecycle", "post", "Merge or retire (requires catalog.lifecycle.manage)", "LifecycleEdit", "Entity", "auth"}, {"/catalog/entities/{id}/unpublish", "post", "Demote a published entity back to draft, the only way back from published (requires catalog.lifecycle.manage; Save refuses demotion with use_lifecycle_endpoint). Request body is UnpublishEdit: expected_version, edit_note and at least one source, validated like every other write. Only published -> draft is accepted: draft/pending_review have nothing to unpublish and deleted/merged are terminal, so all four answer 400 invalid_status (never 500); a stale expected_version is 409 version_conflict. The transition is recorded in the existing revision trail as a revision row plus an entity.unpublished outbox event, so GET /catalog/entities/{id}/revisions lists it while the contribution stats keep their calibration (audit_actions still counts only entity.deleted / entity.merged)", "UnpublishEdit", "Entity", "auth"},
		{"/catalog/entities/{id}/revisions", "get", "Read visible revision history", "", "Result", ""}, {"/catalog/entities/{id}/relations", "get", "Read contextual forward and reverse relations; the response carries subject_id (the queried entity) and entities covering both ends of every returned relation — including the subject itself, so callers can render either side without an extra lookup", "", "Result", ""}, {"/catalog/entities/{id}/occurrences", "get", "Read own reverse inclusions, scoped by entity kind (expression=itself, content_unit=its expressions, work=its expressions)", "", "Result", ""}, {"/catalog/expressions/details", "post", "Batch expression details (entity + own inclusions + same-content-unit siblings + credit) for release pages; JSON body {ids:[...]}", "Result", "Result", ""}, {"/catalog/external-databases", "get", "List active external authority database definitions", "", "Result", ""},
		{"/catalog/compare", "get", "Compare two to six releases (10/min per IP)", "", "Result", ""},
		{"/exchange/entities/{id}", "get", "Export an entity snapshot for another instance", "", "Entity", ""},
		{"/exchange/proposals", "post", "Submit an external edit proposal (always lands in pending_review)", "Edit", "Entity", "auth"},
		{"/importer/preview", "post", "Preview external catalog entry via an outbound fetch (requires catalog.import.submit, 10/min per IP; only Bangumi URLs/IDs; media_type_hint is rejected as not_supported; entity_type accepts work/artist/organization/character and an invalid value is rejected with invalid_entity_type (the same code /importer/import returns). A bare numeric ID resolves along the requested entity_type (artist/organization to the person resource, character to the character resource, otherwise the subject resource); an explicit URL decides the kind itself, and the response entity_type reports the kind actually resolved)", "ImporterPreviewRequest", "ImporterPreviewResponse", "auth"},
		{"/importer/import", "post", "Import previewed entry with evidence (requires catalog.import.submit; validated with zero writes before the first save: attribute values, unknown field codes, original_language, translation rows and date fields are checked against the published definitions with the same rules as entity saves; media/release original_language and translation rows are written to the medium/release entity; payload objects with no write path for the requested entity_type (canonical_entries/mediums/release on entity_type != work) are rejected with unsupported_field_for_entity_type instead of being ignored; download_cover=false skips remote cover refs; is_master_verified and media_type_hint are rejected; has_release=true without mediums, and a release object that declares data while mediums is empty (null or {} counts as absent, like an omitted field), are rejected with invalid_payload (mediums is the write instruction for the release chain in new_work/create_relation; a carrier-less release is only reachable through link_mode=append_release_to_work); link_mode merge_translations is rejected; an invalid entity_type is rejected with invalid_entity_type, the same code /importer/preview returns (no silent fallback to work); release.cover_image_url is honoured as a Picture on the release entity (remote URL reference only, first picture wins when an existing release is reused); payload fields with no model slot are rejected with unsupported_field_for_entity_type instead of being silently dropped: mediums[*].media_category (no such field in the model, and the preview response always reports it empty), release.cover_aspect (Picture has no aspect; ratios are a display hint), release.notes and release.catalog_metadata (no such field on the release entity) and release.language (the release type declares no language field; use original_language/translations); source accepts only the implemented adapter id (bangumi) plus the auto alias, normalized by the very function /importer/preview uses before it feeds anything: the normalized value is what the dedup key, the external_ids key name and the evidence note use, so source=auto no longer drops the metafusion_import idempotency key nor writes a bogus external_ids.auto key (auto is not a registry preset, so such a payload used to be rejected with invalid_external_key: auto); any other source is 400 not_supported)", "ImporterImportRequest", "ImporterImportResponse", "auth"},
		{"/importer/sources", "get", "List the import sources that really have an adapter (requires catalog.import.submit, the same code /importer/preview and /importer/import use). Each item is {id, names, category, icon, description, url_pattern}: id is the adapter's source id as accepted by the two import endpoints, while names/category/icon/description/url_pattern come from the external authority database registry (the same rows GET /catalog/external-databases serves), so renaming or re-scoping a registry row changes this list without any frontend copy. Only concrete sources with an implemented adapter appear, and auto is deliberately absent: it is a resolution alias rather than a source, and Preview normalizes it to the adapter it can actually fetch (the import dialog keeps it as an explicit option). A registry row added by an administrator never appears here on its own — the adapter set is code, and the admin list's importer marker reports exactly that difference", "", "ImporterSourceList", "auth"},
		{"/catalog/relations", "post", "Create contextual relation (requires catalog.relation.edit; supports Idempotency-Key, 24h)", "RelationEdit", "Relation", "auth"}, {"/catalog/relations/{id}", "put", "Replace relation context (requires catalog.relation.edit)", "RelationEdit", "Relation", "auth"}, {"/catalog/relations/{id}", "delete", "Remove relation with evidence (requires catalog.relation.edit)", "LifecycleEdit", "Result", "auth"},
		{"/admin/catalog-definitions", "get", "List definition versions (requires catalog.definitions.manage); each item carries state, created_at, created_by (when a revision row exists) and a short counts summary. include_document defaults to true and keeps the full document on every item; include_document=false omits the document key entirely (and reads no document from the database) while keeping every other metadata field, and the response-level include_document tells the client whether documents came along — read one version with GET /admin/catalog-definitions/{id}; an unparsable value is rejected with invalid_payload instead of silently returning documents", "", "DefinitionList", "auth"}, {"/admin/catalog-definitions", "post", "Save immutable draft (requires catalog.definitions.manage)", "DefinitionDraft", "Result", "auth"}, {"/admin/catalog-definitions/{id}/impact", "get", "Validate draft against all current data", "", "Result", "auth"}, {"/admin/catalog-definitions/{id}/publish", "post", "Publish compatible draft (requires catalog.definitions.manage)", "LifecycleEdit", "Result", "auth"},
		{"/admin/catalog-definitions/{id}", "get", "Read one definition version with its full document plus state, base_version, created_at, created_by (when a revision row exists) and the same counts summary as the list (requires catalog.definitions.manage); any state is readable, including superseded and draft; a non-numeric or unknown id is 404 not_found", "", "DefinitionVersion", "auth"},
		{"/admin/catalog-definitions/{id}/diff", "get", "Field-level diff between a definition version and a baseline (requires catalog.definitions.manage); against defaults to this version's base_version (compare with the previous version) and must be an existing version id — an unparsable against is invalid_payload, a missing id on either side is 404 not_found. Each entry carries a key path that locates exactly one place in the document (fields.<code>.enabled, relations.<code>.aggregate, types.<code>.fields[2], vocabularies.<code>.terms.<term>.names.zh-TW) and one of added / removed / changed / toggled, with from/to values for value changes and toggles (values over 512 bytes are truncated to a string prefix and flagged by truncated). summary counts changes by section (types/fields/vocabularies/relations/templates/schemes/structure) and by change type. Neither side's document is returned", "", "DefinitionDiff", "auth"},
		{"/admin/catalog-definitions/{id}/rollback", "post", "Re-draft a historical definition version on top of the current published version and publish it through the same impact validation (requires catalog.definitions.manage); no_op=true returns the existing published version without writing when the document already matches; 404 when the id is not a definition version", "", "DefinitionRollback", "auth"},
		{"/admin/external-databases", "get", "List external authority databases (requires catalog.definitions.manage)", "", "Result", "auth"},
		{"/admin/external-databases", "post", "Create external authority database (requires catalog.definitions.manage); names must carry zh-CN, zh-TW, en-US and ja or ja-JP (four_locale_names_required)", "ExternalDatabase", "Result", "auth"},
		{"/admin/external-databases/{code}", "put", "Update external authority database (requires catalog.definitions.manage); names must carry zh-CN, zh-TW, en-US and ja or ja-JP (four_locale_names_required)", "ExternalDatabase", "Result", "auth"},
		{"/admin/external-databases/{code}", "delete", "Delete external authority database (requires catalog.definitions.manage)", "", "Result", "auth"},
		{"/catalog/shelves", "get", "List enabled shelf rules (shared by homepage and admin)", "", "Result", ""},
		{"/catalog/shelves/feed", "get", "Evaluate shelf rules with their items, ordered by caller preferences; each shelf's items follow its own sort key: updated (default) | created | title. For a signed-in caller the shelf list is merged before ordering: a preferences section whose slug matches a system shelf overrides that shelf for this caller only (names merged per locale, query/sort replaced, blank icon keeps the system icon), other sections are appended as caller-private shelves, order interleaves system and custom slugs, and hidden removes both kinds; every entry's shelf carries source: system (possibly overridden) or custom, so the client knows whether the row can be deleted; anonymous callers always see source: system and no sections", "", "Result", ""},
		{"/catalog/me/home-preferences", "get", "Read caller homepage section preferences (order, hidden and sections); sections is always an array — a legacy payload carrying only order and hidden reads back with sections: []", "", "Result", "auth"},
		{"/catalog/me/home-preferences", "put", "Replace caller homepage section preferences; sections is the caller's full 'override + private' list of at most 20 entries, each entry having slug (lowercase code [a-z0-9][a-z0-9_-]{1,63}; a slug equal to a system shelf slug overrides that shelf for this caller only, it is not a conflict), names (zh-CN required and non-empty, other locales optional), query (same shape rules as shelf rules), sort (updated | created | title, empty means updated) and icon; a duplicate slug keeps the first declaration. Errors: invalid_slug, invalid_name, invalid_sort, invalid_types, invalid_fields, invalid_vocab_terms, invalid_relations, too_many_sections. Unknown slugs in order/hidden are accepted and ignored instead of rejected (an administrator deleting a shelf must not block saving), and order/hidden are deduplicated", "HomePreferences", "Result", "auth"},
		{"/admin/shelves", "get", "List shelf rules (requires catalog.shelves.manage)", "", "Result", "auth"},
		{"/admin/shelves", "post", "Create shelf rule (requires catalog.shelves.manage); names must carry zh-CN, zh-TW, en-US and ja or ja-JP (four_locale_names_required); sort accepts updated (default) | created | title, other values are rejected with invalid_sort; query rejects blank codes with invalid_types / invalid_relations and malformed field codes or blank values with invalid_fields / invalid_vocab_terms (the same shape check user homepage sections use); source is output-only and only set by /catalog/shelves/feed", "Shelf", "Result", "auth"},
		{"/admin/shelves/{id}", "get", "Read shelf rule (requires catalog.shelves.manage)", "", "Result", "auth"},
		{"/admin/shelves/{id}", "put", "Update shelf rule (requires catalog.shelves.manage); names must carry zh-CN, zh-TW, en-US and ja or ja-JP (four_locale_names_required); sort accepts updated (default) | created | title, other values are rejected with invalid_sort; query rejects blank codes with invalid_types / invalid_relations and malformed field codes or blank values with invalid_fields / invalid_vocab_terms", "Shelf", "Result", "auth"},
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
		{"field", "Attribute filter: a published field code (dotted path allowed only when every level is searchable and enabled); the seed definitions make top-level codes such as tags, duration, edition_date and barcode usable"},
		{"value", "Exact value compared with field (text equality via ->>)"},
		{"work_id", "Expressions/content_units of the work + releases declaring it"},
		{"content_unit_id", "Expressions under the content unit"},
		{"release_id", "Mediums under the release"},
		{"medium_id", "Tracks under the medium"},
		{"parent_id", "Child content_units/mediums/tracks"},
		{"tags", "Multi-value tag filter (repeat or comma-separated, OR, container match @>)"},
		{"sort", "Sort key, whitelisted: updated_at (column, default), created_at (entity ids are time-ordered UUIDv7, so id order is creation order), title (the displayed title: requested locale -> original_language -> en-US -> base title). An unknown key is 400 invalid_sort rather than being silently ignored"},
		{"order", "Sort direction, asc or desc; defaults to desc for the time keys and asc for title. Anything else is 400 invalid_order"},
		{"locale", "Locale used only by sort=title to pick which translation is compared (BCP-47-like, ignored when malformed)"},
		{"limit", "Page size, default 50, max 100"},
		{"offset", "Page offset, default 0"},
	} {
		params = append(params, map[string]any{"name": p.name, "in": "query", "description": p.desc, "schema": map[string]any{"type": "string"}})
	}
	paths["/catalog/entities"].(map[string]any)["get"].(map[string]any)["parameters"] = params
	paths["/catalog/compare"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{map[string]any{"name": "ids", "in": "query", "required": true, "description": "Two to six comma-separated release UUIDs", "schema": map[string]any{"type": "string"}}}
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
	// 用户贡献视图：items 的形状随 tab 变化（创建项 vs 修订项），响应 schema 见 UserContributions。
	// tab 之外的取值（topics/comments/audits 属互动服务）返回 400 invalid_tab，不静默给空列表。
	add("/users/{id}/contributions", "get", "User contribution feed for the profile page: tab=all (default) mixes the entities the user created (works/releases/artists, judged by the version=1 revision actor snapshot) with their later edits (revision rows above version 1), revisions lists their entity revision rows with a field-level diff (diff keys follow the entity fields, attributes/translations drilled one level; ignored: id/version/created_by/created_at/updated_at), works/releases/artists list the entities the user created (artists maps to the agent kind); anonymous readable and filtered by the same visibility rules as entity lists (deleted/merged targets are invisible to everyone; unpublished targets only to their creator and catalog.lifecycle.manage holders), so items and stats never expose drafts; page defaults to 1 and page_size to 20 (both clamped, never rejected); an unknown tab is 400 invalid_tab, while an id that is not a UUID is 404 not_found — the same status and code the account profile (GET /users/{id}) and the community stats (GET /users/{id}/stats) answer with, so the profile page degrades all three sources alike instead of showing a parameter error; the directory never reads the account tables, so an unknown user and a user without contributions are both a 200 with zero counts; stats carry five counts derived from the revision actor snapshot columns without joining the account tables: works_created/releases_created/artists_created count first revisions (version 1) on visible targets, revisions_count counts revision rows on visible targets, while audit_actions counts lifecycle management actions (entity.deleted / entity.merged events) the user performed regardless of the target's current state, because deleting or merging removes the target from the visible set", "", "UserContributions", false)
	paths["/users/{id}/contributions"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{
		map[string]any{"name": "id", "in": "path", "required": true, "schema": map[string]any{"type": "string"}},
		qp("tab", "all (default) | revisions | works | releases | artists", false),
		qp("page", "Page number, default 1; values below 1 are clamped", false),
		qp("page_size", "Items per page, default 20, max 100; out-of-range values fall back to 20", false),
	}
	paths["/admin/catalog-definitions"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{
		qp("include_document", "Whether each item carries its full document; default true, false omits the document key (read one version with GET /admin/catalog-definitions/{id})", false),
	}
	// 路径模板变量必须与查询参数一起声明：整体覆盖 parameters 会把 {id} 的 in=path 声明抹掉。
	paths["/admin/catalog-definitions/{id}/diff"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{
		map[string]any{"name": "id", "in": "path", "required": true, "schema": map[string]any{"type": "string"}},
		qp("against", "Baseline definition version id to compare with; defaults to this version's base_version", false),
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
