package catalog

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"strings"
	"testing"
)

func TestOpenAPIRouteCoverage(t *testing.T) {
	doc := OpenAPI()
	if _, err := json.Marshal(doc); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	HTTP{Store: &Store{}}.Register(r)
	paths := doc["paths"].(map[string]any)
	for _, route := range r.Routes() {
		if route.Path == "/api/openapi.json" || route.Path == "/api/docs" || route.Path == "/api/swagger" {
			continue
		}
		clean := strings.TrimPrefix(route.Path, "/api")
		clean = strings.TrimPrefix(clean, "/api")
		path := strings.ReplaceAll(clean, ":id", "{id}")
		path = strings.ReplaceAll(path, ":code", "{code}")
		p, ok := paths[path].(map[string]any)
		if !ok || p[strings.ToLower(route.Method)] == nil {
			t.Fatalf("undocumented endpoint: %s %s", route.Method, path)
		}
	}
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	entity := schemas["Entity"].(map[string]any)["properties"].(map[string]any)
	if entity["contents"] == nil || entity["subjects"] == nil || entity["canonical_entry_id"] != nil {
		t.Fatal("v2 DTO schema drift")
	}
}

func TestOpenAPIReverseCoverage(t *testing.T) {
	// 反向检查：文档中的每条 path+method 必须在 gin 路由中真实注册，
	// 防止文档残留已删除端点（如重复的 /catalog/shelves）。
	doc := OpenAPI()
	r := gin.New()
	HTTP{Store: &Store{}}.Register(r)
	registered := map[string]bool{}
	for _, route := range r.Routes() {
		clean := strings.TrimPrefix(route.Path, "/api")
		clean = strings.TrimPrefix(clean, "/api")
		path := strings.ReplaceAll(clean, ":id", "{id}")
		path = strings.ReplaceAll(path, ":code", "{code}")
		registered[strings.ToLower(route.Method)+" "+path] = true
	}
	paths := doc["paths"].(map[string]any)
	for path, v := range paths {
		for method := range v.(map[string]any) {
			if !registered[strings.ToLower(method)+" "+path] {
				t.Fatalf("documented but not registered: %s %s", method, path)
			}
		}
	}
	// 关键 schema 回归：role 更新请求体不得再写成 Result。
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	roleOp := paths["/admin/users/{id}/role"].(map[string]any)["put"].(map[string]any)
	rb := roleOp["requestBody"].(map[string]any)["content"].(map[string]any)["application/json"].(map[string]any)["schema"].(map[string]any)["$ref"]
	if rb != "#/components/schemas/UserRoleUpdate" {
		t.Fatalf("role requestBody ref = %v, want UserRoleUpdate", rb)
	}
	if _, ok := schemas["UserRoleUpdate"]; !ok {
		t.Fatal("UserRoleUpdate schema missing")
	}
	toggleOp := paths["/favorites/toggle"].(map[string]any)["post"].(map[string]any)
	trb := toggleOp["requestBody"].(map[string]any)["content"].(map[string]any)["application/json"].(map[string]any)["schema"].(map[string]any)["$ref"]
	if trb != "#/components/schemas/FavoriteToggle" {
		t.Fatalf("toggle requestBody ref = %v, want FavoriteToggle", trb)
	}
	// 收藏/偏好/OAuth 的登录口径：文档 security 必须与 http.go 中间件一致。
	for _, p := range []struct {
		path, method string
		wantAuth     bool
	}{
		{"/favorites/toggle", "post", true},
		{"/favorites/mine", "get", true},
		{"/oauth/clients", "get", true},
		{"/users/{id}/favorites", "get", false},
		{"/catalog/me/home-preferences", "get", true},
		{"/catalog/me/home-preferences", "put", true},
	} {
		op := paths[p.path].(map[string]any)[p.method].(map[string]any)
		_, hasSec := op["security"]
		if hasSec != p.wantAuth {
			t.Fatalf("%s %s security=%v, want auth=%v", p.method, p.path, hasSec, p.wantAuth)
		}
	}
	// 查询参数回归：收藏分页、status、tags、feed、authorize 不得缺失。
	for _, p := range []struct{ path, method, param string }{
		{"/favorites/mine", "get", "page_size"},
		{"/users/{id}/favorites", "get", "page"},
		{"/favorites/status", "get", "target_ids"},
		{"/catalog/tags", "get", "limit"},
		{"/catalog/shelves/feed", "get", "per_shelf"},
		{"/oauth/authorize", "get", "redirect_uri"},
	} {
		op := paths[p.path].(map[string]any)[p.method].(map[string]any)
		params, _ := op["parameters"].([]any)
		found := false
		for _, v := range params {
			if v.(map[string]any)["name"] == p.param {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("%s %s missing query param %q", p.method, p.path, p.param)
		}
	}
}
