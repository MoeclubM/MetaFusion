package catalogv2

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
	for _, v := range []any{Entity{}, Edit{}, Relation{}, RelationEdit{}, LifecycleEdit{}, DefinitionVersion{}, Definitions{}, User{}} {
		schema(reflect.TypeOf(v))
	}
	schemas["Credentials"] = map[string]any{"type": "object", "required": []string{"username", "password"}, "properties": map[string]any{"username": map[string]any{"type": "string"}, "password": map[string]any{"type": "string", "minLength": 12, "writeOnly": true}}}
	schemas["DefinitionDraft"] = map[string]any{"type": "object", "required": []string{"document", "base_version", "edit_note", "sources"}, "properties": map[string]any{"document": schema(reflect.TypeOf(Definitions{})), "base_version": map[string]any{"type": "integer"}, "edit_note": map[string]any{"type": "string"}, "sources": schema(reflect.TypeOf([]Source{}))}}
	paths := map[string]any{}
	add := func(path, method, summary, request, response string, auth bool) {
		op := map[string]any{"summary": summary, "responses": map[string]any{"200": map[string]any{"description": "Success", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/" + response}}}}, "400": map[string]any{"description": "Invalid payload, source, definition or structural constraint"}, "401": map[string]any{"description": "Authentication required"}, "403": map[string]any{"description": "Insufficient edit or review permission"}, "404": map[string]any{"description": "Not found or not visible"}, "409": map[string]any{"description": "Version conflict; read current data before retrying"}}}
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
		{"/auth/login", "post", "Sign in; return token and HttpOnly cookie", "Credentials", "Result", ""}, {"/auth/me", "get", "Current account", "", "User", "auth"}, {"/auth/logout", "post", "Revoke current session", "", "Result", "auth"}, {"/auth/password", "put", "Update account password", "Credentials", "Result", "auth"}, {"/auth/logout-all", "post", "Revoke all user sessions", "", "Result", "auth"}, {"/admin/users", "get", "List users (administrator only)", "", "Result", "auth"}, {"/admin/users", "post", "Create editor (administrator only)", "Credentials", "User", "auth"}, {"/admin/users/{id}/role", "put", "Update user role (administrator only)", "Result", "Result", "auth"}, {"/admin/users/{id}/password", "put", "Reset user password (administrator only)", "Credentials", "Result", "auth"}, {"/oauth/clients", "get", "List registered OAuth 2.0 clients", "", "Result", ""}, {"/oauth/authorize", "get", "OAuth 2.0 authorization endpoint", "", "Result", ""}, {"/oauth/token", "post", "OAuth 2.0 token endpoint", "", "Result", ""}, {"/oauth/userinfo", "get", "OAuth 2.0 / OIDC user info endpoint", "", "Result", "auth"},
		{"/catalog/definitions", "get", "Published dynamic definitions", "", "DefinitionVersion", ""}, {"/catalog/shelves", "get", "Virtual shelves and channels", "", "Result", ""}, {"/catalog/works", "get", "Query works collection", "", "Result", ""}, {"/catalog/entities", "get", "Basic PostgreSQL search", "", "Result", ""}, {"/catalog/entities", "post", "Create entity with evidence", "Edit", "Entity", "auth"},
		{"/catalog/entities/{id}", "get", "Read visible entity", "", "Entity", ""}, {"/catalog/entities/{id}", "put", "Replace entity with optimistic version check", "Edit", "Entity", "auth"}, {"/catalog/entities/{id}/resolve", "get", "Resolve merged identity", "", "Entity", ""}, {"/catalog/entities/{id}/lifecycle", "post", "Merge or retire (administrator only)", "LifecycleEdit", "Entity", "auth"},
		{"/catalog/entities/{id}/revisions", "get", "Read visible revision history", "", "Result", ""}, {"/catalog/entities/{id}/relations", "get", "Read contextual forward and reverse relations", "", "Result", ""}, {"/catalog/entities/{id}/occurrences", "get", "Read complete reverse inclusions", "", "Result", ""}, {"/catalog/compare", "get", "Compare two to six releases", "", "Result", ""},
		{"/catalog/relations", "post", "Create contextual relation", "RelationEdit", "Relation", "auth"}, {"/catalog/relations/{id}", "put", "Replace relation context", "RelationEdit", "Relation", "auth"}, {"/catalog/relations/{id}", "delete", "Remove relation with evidence", "LifecycleEdit", "Result", "auth"},
		{"/admin/catalog-definitions", "get", "List definition versions (administrator only)", "", "Result", "auth"}, {"/admin/catalog-definitions", "post", "Save immutable draft (administrator only)", "DefinitionDraft", "Result", "auth"}, {"/admin/catalog-definitions/{id}/impact", "get", "Validate draft against all current data", "", "Result", "auth"}, {"/admin/catalog-definitions/{id}/publish", "post", "Publish compatible draft (administrator only)", "LifecycleEdit", "Result", "auth"},
	} {
		add(r[0], r[1], r[2], r[3], r[4], r[5] != "")
	}
	params := []any{}
	for _, name := range []string{"kind", "type", "status", "q", "field", "value", "work_id", "content_unit_id", "release_id", "medium_id", "parent_id", "limit", "offset"} {
		params = append(params, map[string]any{"name": name, "in": "query", "schema": map[string]any{"type": "string"}})
	}
	paths["/catalog/entities"].(map[string]any)["get"].(map[string]any)["parameters"] = params
	paths["/catalog/compare"].(map[string]any)["get"].(map[string]any)["parameters"] = []any{map[string]any{"name": "ids", "in": "query", "required": true, "description": "Two to six comma-separated release UUIDs", "schema": map[string]any{"type": "string"}}}
	return map[string]any{"openapi": "3.0.3", "info": map[string]any{"title": "MetaFusion catalog", "version": "2.0.0"}, "servers": []any{map[string]any{"url": "/api"}}, "paths": paths, "components": map[string]any{"schemas": schemas, "securitySchemes": map[string]any{"session": map[string]any{"type": "apiKey", "in": "cookie", "name": "mf_v2_session"}, "bearer": map[string]any{"type": "http", "scheme": "bearer"}}}}
}
