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

	// 账号与收藏前缀已随子系统拆分离开本服务：文档里不得再出现它们，
	// 否则前端/Agent 会以为目录服务仍然接受这些请求。
	for _, p := range []string{"/setup", "/auth/login", "/auth/me", "/auth/settings", "/admin/users", "/oauth/clients", "/oauth/authorize", "/oauth/token", "/oidc/jwks", "/.well-known/openid-configuration", "/favorites/toggle", "/favorites/mine", "/users/{id}/favorites"} {
		if _, ok := paths[p]; ok {
			t.Fatalf("%s 已归子系统，不应再出现在目录服务的 OpenAPI 文档里", p)
		}
	}

	// 登录口径：目录侧只剩自己的写接口需要身份（token 由账号服务签发）。
	for _, p := range []struct {
		path, method string
		wantAuth     bool
	}{
		{"/catalog/entities", "post", true},
		{"/catalog/entities", "get", false},
		{"/catalog/me/home-preferences", "get", true},
		{"/catalog/me/home-preferences", "put", true},
		{"/exchange/proposals", "post", true},
	} {
		op := paths[p.path].(map[string]any)[p.method].(map[string]any)
		_, hasSec := op["security"]
		if hasSec != p.wantAuth {
			t.Fatalf("%s %s security=%v, want auth=%v", p.method, p.path, hasSec, p.wantAuth)
		}
	}

	// 查询参数回归：标签聚合与货架 feed 的参数不得缺失。
	for _, p := range []struct{ path, method, param string }{
		{"/catalog/tags", "get", "limit"},
		{"/catalog/shelves/feed", "get", "per_shelf"},
		{"/catalog/entities", "get", "field"},
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

// 路径模板变量与参数声明必须一一对应：{code} 这类变量漏声明会让文档成为无效 OpenAPI，
// 客户端（Scalar / Swagger / 生成器）解析路径参数时拿不到名字，只能猜。
func TestOpenAPIPathParametersMatchTemplates(t *testing.T) {
	doc := OpenAPI()
	for path, ops := range doc["paths"].(map[string]any) {
		want := pathTemplateParams(path)
		for method, op := range ops.(map[string]any) {
			declared := map[string]bool{}
			if params, ok := op.(map[string]any)["parameters"].([]any); ok {
				for _, p := range params {
					pm, _ := p.(map[string]any)
					if pm["in"] != "path" {
						continue
					}
					if name, ok := pm["name"].(string); ok {
						declared[name] = true
					}
				}
			}
			for _, name := range want {
				if !declared[name] {
					t.Fatalf("%s %s: 路径变量 {%s} 没有对应的 in=path 参数声明", method, path, name)
				}
			}
			for name := range declared {
				if !contains(want, name) {
					t.Fatalf("%s %s: 参数 %q 不在路径模板里", method, path, name)
				}
			}
		}
	}
}

// GET /catalog/definitions 的响应比 DefinitionVersion 多一个 kinds（handler 拼的骨架名，
// 见 http.go：288）。文档必须表达出来：该 schema 声明 additionalProperties:false，
// 漏写会让按文档做严格校验的客户端判失败。
func TestOpenAPIDefinitionsResponseIncludesKinds(t *testing.T) {
	doc := OpenAPI()
	op := doc["paths"].(map[string]any)["/catalog/definitions"].(map[string]any)["get"].(map[string]any)
	resp := op["responses"].(map[string]any)["200"].(map[string]any)["content"].(map[string]any)["application/json"].(map[string]any)["schema"].(map[string]any)
	ref, _ := resp["$ref"].(string)
	name := strings.TrimPrefix(ref, "#/components/schemas/")
	if name == "" || name == "DefinitionVersion" {
		t.Fatalf("响应 schema 仍是 %q，漏掉 kinds", name)
	}
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	props, ok := schemas[name].(map[string]any)["properties"].(map[string]any)
	if !ok {
		t.Fatalf("%s 不是对象 schema", name)
	}
	for _, k := range []string{"id", "state", "base_version", "document", "created_at", "kinds"} {
		if props[k] == nil {
			t.Fatalf("%s schema 缺 %s 字段", name, k)
		}
	}
}
