package catalog

import (
	"reflect"
	"strings"
	"time"
)

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
	for _, v := range []any{Entity{}, Edit{}, Relation{}, RelationEdit{}, LifecycleEdit{}, DefinitionVersion{}, Definitions{}, User{}, ExternalDatabase{}, Shelf{}, HomePreferences{}, ImporterPreviewRequest{}, ImporterPreviewResponse{}, ImporterImportRequest{}, ImporterImportResponse{}} {
		schema(reflect.TypeOf(v))
	}
	schemas["Credentials"] = map[string]any{"type": "object", "required": []string{"username", "password"}, "properties": map[string]any{"username": map[string]any{"type": "string"}, "password": map[string]any{"type": "string", "minLength": 12, "writeOnly": true}}}
	schemas["DefinitionDraft"] = map[string]any{"type": "object", "required": []string{"document", "base_version", "edit_note", "sources"}, "properties": map[string]any{"document": schema(reflect.TypeOf(Definitions{})), "base_version": map[string]any{"type": "integer"}, "edit_note": map[string]any{"type": "string"}, "sources": schema(reflect.TypeOf([]Source{}))}}
	paths := map[string]any{}
	add := func(path, method, summary, request, response string, auth bool) {
		tag := "Catalog"
		if strings.HasPrefix(path, "/auth") || strings.HasPrefix(path, "/setup") {
			tag = "Auth"
		} else if strings.HasPrefix(path, "/oauth") {
			tag = "OAuth"
		} else if strings.HasPrefix(path, "/admin/users") {
			tag = "Users"
		} else if strings.HasPrefix(path, "/admin/catalog-definitions") || path == "/catalog/definitions" {
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
		if strings.Contains(path, "{id}") {
			op["parameters"] = []any{map[string]any{"name": "id", "in": "path", "required": true, "schema": map[string]any{"type": "string"}}}
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
	for _, r := range [][6]string{
		{"/setup", "get", "Check first administrator setup", "", "Result", ""}, {"/setup", "post", "Create the first administrator", "Credentials", "User", ""},
		{"/auth/login", "post", "Sign in; return RS256 access token and HttpOnly cookie", "Credentials", "Result", ""}, {"/auth/refresh", "post", "Rotate the current access token and server session", "", "Result", "auth"}, {"/auth/me", "get", "Current account", "", "User", "auth"}, {"/auth/logout", "post", "Revoke current session", "", "Result", "auth"}, {"/auth/password", "put", "Update account password", "Credentials", "Result", "auth"}, {"/auth/settings", "get", "Public instance auth capabilities", "", "Result", ""}, {"/auth/change-password", "post", "Change current account password", "Credentials", "Result", "auth"}, {"/auth/logout-all", "post", "Revoke all user sessions", "", "Result", "auth"}, {"/admin/users", "get", "List users (administrator only)", "", "Result", "auth"}, {"/admin/users", "post", "Create editor (administrator only)", "Credentials", "User", "auth"}, {"/admin/users/{id}/role", "put", "Update user role (administrator only)", "Result", "Result", "auth"}, {"/admin/users/{id}/password", "put", "Reset user password (administrator only)", "Credentials", "Result", "auth"}, {"/oauth/clients", "get", "List registered OAuth 2.0 clients", "", "Result", ""}, {"/oauth/authorize", "get", "OAuth 2.0 authorization endpoint", "", "Result", ""}, {"/oauth/token", "post", "OAuth 2.0 token endpoint", "", "Result", ""}, {"/oauth/userinfo", "get", "OAuth 2.0 / OIDC user info endpoint", "", "Result", "auth"}, {"/.well-known/openid-configuration", "get", "OIDC discovery document", "", "Result", ""}, {"/oidc/jwks", "get", "JSON Web Key Set for local RS256 token verification", "", "Result", ""},
		{"/catalog/definitions", "get", "Published dynamic definitions", "", "DefinitionVersion", ""}, {"/catalog/works", "get", "Query works collection (items + real COUNT total)", "", "Result", ""}, {"/catalog/entities", "get", "Basic PostgreSQL search (items + real COUNT total; 120/min per IP)", "", "Result", ""}, {"/catalog/entities", "post", "Create entity with evidence (supports Idempotency-Key, 24h)", "Edit", "Entity", "auth"},
		{"/catalog/works/{id}", "get", "Work detail in legacy frontend shape (read-only compat, prefer /catalog/entities/{id}/resolve)", "", "Result", ""}, {"/catalog/works/{id}/contents", "get", "Work content directory in legacy shape (read-only compat)", "", "Result", ""}, {"/catalog/works/{id}/graph", "get", "Work relation graph in legacy shape (read-only compat)", "", "Result", ""},
		{"/catalog/taxonomy", "get", "Taxonomy dictionary derived from definitions (read-only legacy compat)", "", "Result", ""}, {"/catalog/tags", "get", "Empty tag dictionary placeholder (read-only legacy compat)", "", "Result", ""}, {"/catalog/relation-types", "get", "Relation types derived from definitions (read-only legacy compat)", "", "Result", ""}, {"/catalog/works/{id}/comments", "get", "Empty works comments placeholder (read-only legacy compat)", "", "Result", ""},
		{"/catalog/artists/{id}", "get", "Agent artist detail in legacy frontend shape (read-only compat, prefer /catalog/entities/{id}/resolve)", "", "Result", ""}, {"/catalog/franchises/{id}", "get", "Collection franchise detail in legacy frontend shape (read-only compat)", "", "Result", ""}, {"/catalog/mediums/{id}", "get", "Medium detail with release context in legacy frontend shape (read-only compat)", "", "Result", ""}, {"/catalog/canonical-entries/{id}", "get", "ContentUnit/Expression canonical entry in legacy frontend shape (read-only compat)", "", "Result", ""},
		{"/catalog/entities/{id}", "get", "Read visible entity", "", "Entity", ""}, {"/catalog/entities/{id}", "put", "Replace entity with optimistic version check", "Edit", "Entity", "auth"}, {"/catalog/entities/{id}/resolve", "get", "Resolve merged identity", "", "Entity", ""}, {"/catalog/entities/{id}/lifecycle", "post", "Merge or retire (administrator only)", "LifecycleEdit", "Entity", "auth"},
		{"/catalog/entities/{id}/revisions", "get", "Read visible revision history", "", "Result", ""}, {"/catalog/entities/{id}/relations", "get", "Read contextual forward and reverse relations", "", "Result", ""}, {"/catalog/entities/{id}/occurrences", "get", "Read own reverse inclusions, scoped by entity kind (expression=itself, content_unit=its expressions, work=its expressions)", "", "Result", ""}, {"/catalog/expressions/details", "get", "Batch expression details (entity + own inclusions + same-content-unit siblings + credit) for release pages", "", "Result", ""}, {"/catalog/external-databases", "get", "List active external authority database definitions", "", "Result", ""}, {"/catalog/shelves", "get", "List enabled shelf rules (shared by homepage and admin)", "", "Result", ""},
		{"/catalog/compare", "get", "Compare two to six releases (10/min per IP)", "", "Result", ""},
		{"/favorites/toggle", "post", "Toggle favorite for a target entity", "Result", "Result", "auth"}, {"/favorites/status", "get", "Batch favorite status for the current user", "", "Result", ""}, {"/favorites/mine", "get", "List current user's favorites", "", "Result", "auth"}, {"/users/{id}/favorites", "get", "List a user's favorites", "", "Result", ""},
		{"/importer/preview", "post", "Preview external catalog entry (Bangumi public API)", "ImporterPreviewRequest", "ImporterPreviewResponse", ""},
		{"/importer/import", "post", "Import previewed entry with evidence", "ImporterImportRequest", "ImporterImportResponse", "auth"},
		{"/catalog/relations", "post", "Create contextual relation (supports Idempotency-Key, 24h)", "RelationEdit", "Relation", "auth"}, {"/catalog/relations/{id}", "put", "Replace relation context", "RelationEdit", "Relation", "auth"}, {"/catalog/relations/{id}", "delete", "Remove relation with evidence", "LifecycleEdit", "Result", "auth"},
		{"/admin/catalog-definitions", "get", "List definition versions (administrator only)", "", "Result", "auth"}, {"/admin/catalog-definitions", "post", "Save immutable draft (administrator only)", "DefinitionDraft", "Result", "auth"}, {"/admin/catalog-definitions/{id}/impact", "get", "Validate draft against all current data", "", "Result", "auth"}, {"/admin/catalog-definitions/{id}/publish", "post", "Publish compatible draft (administrator only)", "LifecycleEdit", "Result", "auth"},
		{"/admin/external-databases", "get", "List external authority databases (administrator only)", "", "Result", "auth"},
		{"/admin/external-databases", "post", "Create external authority database (administrator only)", "ExternalDatabase", "Result", "auth"},
		{"/admin/external-databases/{code}", "put", "Update external authority database (administrator only)", "ExternalDatabase", "Result", "auth"},
		{"/admin/external-databases/{code}", "delete", "Delete external authority database (administrator only)", "", "Result", "auth"},
		{"/catalog/shelves", "get", "List enabled shelf rules (shared by homepage and admin)", "", "Result", ""},
		{"/catalog/shelves/feed", "get", "Evaluate shelf rules with their items, ordered by caller preferences", "", "Result", ""},
		{"/catalog/me/home-preferences", "get", "Read caller homepage section preferences", "", "Result", "auth"},
		{"/catalog/me/home-preferences", "put", "Replace caller homepage section preferences", "HomePreferences", "Result", "auth"},
		{"/admin/shelves", "get", "List shelf rules (administrator only)", "", "Result", "auth"},
		{"/admin/shelves", "post", "Create shelf rule (administrator only)", "Shelf", "Result", "auth"},
		{"/admin/shelves/{id}", "get", "Read shelf rule (administrator only)", "", "Result", "auth"},
		{"/admin/shelves/{id}", "put", "Update shelf rule (administrator only)", "Shelf", "Result", "auth"},
		{"/admin/shelves/{id}", "delete", "Delete shelf rule (administrator only)", "", "Result", "auth"},
	} {
		add(r[0], r[1], r[2], r[3], r[4], r[5] != "")
	}
	params := []any{}
	for _, name := range []string{"kind", "type", "status", "q", "field", "value", "work_id", "content_unit_id", "release_id", "medium_id", "parent_id", "limit", "offset"} {
		params = append(params, map[string]any{"name": name, "in": "query", "schema": map[string]any{"type": "string"}})
	}
	paths["/catalog/entities"].(map[string]any)["get"].(map[string]any)["parameters"] = params
	paths["/catalog/compare"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{map[string]any{"name": "ids", "in": "query", "required": true, "description": "Two to six comma-separated release UUIDs", "schema": map[string]any{"type": "string"}}}
	return map[string]any{
		"openapi": "3.0.3",
		"info": map[string]any{
			"title":       "MetaFusion API",
			"description": "MetaFusion 开放媒体元数据与资源共建平台标准 API。提供固定实体骨架（Work / Expression / Release / Medium / Track / ContentUnit / Agent / Collection）、动态类型与属性扩展、多版本发行对比、OAuth 2.0 / OIDC 统一认证与外围解耦模块接入能力。",
			"version":     "1.0.0",
		},
		"servers": []any{
			map[string]any{"url": "/api", "description": "标准统一主干 API"},
		},
		"tags": []any{
			map[string]any{"name": "Catalog", "description": "核心实体编目与查询 (Work, Release, Medium, Track, ContentUnit, Agent, Collection)"},
			map[string]any{"name": "Definitions", "description": "无代码动态元数据类型、属性与关系定义管理"},
			map[string]any{"name": "ExternalDatabases", "description": "外部权威数据库与官方渠道配置"},
			map[string]any{"name": "OAuth", "description": "OAuth 2.0 / OIDC 开放认证与单点登录服务"},
			map[string]any{"name": "Auth", "description": "用户身份认证与账号管理"},
			map[string]any{"name": "Users", "description": "管理员用户权限与账号管理"},
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
