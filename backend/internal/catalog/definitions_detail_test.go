package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// 单版本文档端点（真库 + 真路由）：列表 include_document=false 瘦身后，前端点某一版就按 id 取
// 该版本的完整文档 + 元数据；summary/created_by 与列表项同口径，401/403/404 与既有端点同口径。
func TestPostgresDefinitionDetailEndpoint(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	gin.SetMode(gin.TestMode)
	engine := func(u *User) *gin.Engine {
		r := gin.New()
		r.Use(func(c *gin.Context) {
			if u != nil {
				c.Set("catalog_user", u)
			}
			c.Next()
		})
		HTTP{Store: f.s}.Register(r)
		return r
	}
	defsUser := &User{ID: uuid.NewString(), Username: "catalog-admin", Role: "member", Permissions: []string{PermissionDefinitionsManage}}
	otherUser := &User{ID: uuid.NewString(), Username: "catalog-editor", Role: "member", Permissions: []string{PermissionEntityEdit}}
	do := func(u *User, path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		engine(u).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		return w
	}
	publishedID := func() int64 {
		t.Helper()
		v, err := f.s.Definitions(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return v.ID
	}
	// 三个版本行：种子里那一行（发布 B 后成为 superseded）→ 中间版本（B 的 base）→ 当前 published。
	seed, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	supersededID := seed.ID
	marker := seed.Document
	marker.Fields["detail_marker"] = Field{Names: names("详情标记", "Detail marker"), Type: "text", Enabled: true}
	f.publish(marker, seed.ID)
	baseID := publishedID()
	if baseID == supersededID {
		t.Fatal("夹具未产出中间版本")
	}
	next := marker
	next.Types["detail_type"] = TypeDefinition{Names: names("详情类型", "Detail type"), Kinds: []string{"work"}, Fields: []string{"language"}, Template: "photography", Enabled: true}
	f.publish(next, baseID)
	currentID := publishedID()
	if currentID == baseID {
		t.Fatal("夹具未产出当前发布版本")
	}

	type detail struct {
		ID          int64        `json:"id"`
		State       string       `json:"state"`
		BaseVersion int64        `json:"base_version"`
		CreatedAt   *time.Time   `json:"created_at"`
		CreatedBy   string       `json:"created_by"`
		Summary     string       `json:"summary"`
		Document    *Definitions `json:"document"`
	}
	read := func(u *User, id int64) (*detail, *httptest.ResponseRecorder) {
		t.Helper()
		w := do(u, fmt.Sprintf("/api/admin/catalog-definitions/%d", id))
		if w.Code != http.StatusOK {
			return nil, w
		}
		var got detail
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("解码详情失败: %v body=%s", err, w.Body.String())
		}
		return &got, w
	}

	got, w := read(defsUser, currentID)
	if got == nil {
		t.Fatalf("详情=%d body=%s", w.Code, w.Body.String())
	}
	want, err := f.s.definitionVersion(ctx, currentID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Document == nil || encode(*got.Document) != encode(want.Document) {
		t.Fatal("详情必须返回该版本的完整文档（与库里逐键相等）")
	}
	if got.State != "published" || got.BaseVersion != baseID || got.CreatedAt == nil {
		t.Fatalf("详情元数据异常: %+v", got)
	}
	if got.Summary == "" || got.Summary != definitionSummary(*got.Document) {
		t.Fatalf("详情 summary=%q 与文档计数不符", got.Summary)
	}
	// created_by 是起草身份（修订表最早一条），不是读取者：夹具发布用的就是 f.u。
	if got.CreatedBy != f.u.Username {
		t.Fatalf("详情 created_by=%q, want %q（起草者）", got.CreatedBy, f.u.Username)
	}
	// superseded 与 draft 的历史版本同样可读（列表瘦身之后点历史版本走的就是这里）。
	for _, tc := range []struct {
		name  string
		id    int64
		state string
	}{
		{"superseded", supersededID, "superseded"},
		{"中间版本", baseID, "superseded"},
	} {
		old, w := read(defsUser, tc.id)
		if old == nil {
			t.Fatalf("%s 详情=%d body=%s", tc.name, w.Code, w.Body.String())
		}
		if old.State != tc.state {
			t.Fatalf("%s 详情 state=%q, want %q", tc.name, old.State, tc.state)
		}
		wantOld, err := f.s.definitionVersion(ctx, tc.id)
		if err != nil {
			t.Fatal(err)
		}
		if old.Document == nil || encode(*old.Document) != encode(wantOld.Document) {
			t.Fatalf("%s 详情的文档与库里不一致", tc.name)
		}
		if old.Summary != definitionSummary(*old.Document) {
			t.Fatalf("%s 详情 summary=%q 与文档计数不符", tc.name, old.Summary)
		}
	}
	if got, _ := read(defsUser, supersededID); got.BaseVersion != 0 {
		t.Fatalf("种子版本的 base_version 应为 0，得到 %d", got.BaseVersion)
	}
	// 瘦身列表 + 详情组合：列表给的每个 id 都能单独取到该版本文档，且摘要一致。
	lw := do(defsUser, "/api/admin/catalog-definitions?include_document=false")
	if lw.Code != http.StatusOK {
		t.Fatalf("瘦身列表=%d body=%s", lw.Code, lw.Body.String())
	}
	var list struct {
		Items []struct {
			ID      int64  `json:"id"`
			Summary string `json:"summary"`
		} `json:"items"`
	}
	if err := json.Unmarshal(lw.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Items) < 3 {
		t.Fatalf("瘦身列表项数=%d, want >=3", len(list.Items))
	}
	for _, it := range list.Items {
		d, w := read(defsUser, it.ID)
		if d == nil {
			t.Fatalf("列表项 %d 取详情失败: %d %s", it.ID, w.Code, w.Body.String())
		}
		if d.Document == nil || len(d.Document.Fields) == 0 {
			t.Fatalf("版本 %d 的详情缺文档", it.ID)
		}
		if d.Summary != it.Summary {
			t.Fatalf("版本 %d 的详情 summary=%q 与列表 %q 不一致", it.ID, d.Summary, it.Summary)
		}
	}
	// 不存在与非法 id：一律 404 not_found（与 /impact、/rollback 同风格）。
	for _, missing := range []string{"/api/admin/catalog-definitions/99999999", "/api/admin/catalog-definitions/abc", "/api/admin/catalog-definitions/-1"} {
		if w := do(defsUser, missing); w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "not_found") {
			t.Fatalf("%s = %d body=%s, want 404 not_found", missing, w.Code, w.Body.String())
		}
	}
	// 闸门：匿名 401（未登录）与无码 403 分开报，前端据此决定跳登录还是提示无权限。
	if w := do(nil, fmt.Sprintf("/api/admin/catalog-definitions/%d", currentID)); w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "authentication_required") {
		t.Fatalf("匿名详情=%d body=%s, want 401", w.Code, w.Body.String())
	}
	if w := do(otherUser, fmt.Sprintf("/api/admin/catalog-definitions/%d", currentID)); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "forbidden") {
		t.Fatalf("无 catalog.definitions.manage 详情=%d body=%s, want 403", w.Code, w.Body.String())
	}
}

// OpenAPI 同步：单版本文档端点的 {id} 路径参数、登录声明与 200 响应 schema 都要写进文档。
func TestOpenAPIDefinitionDetailPath(t *testing.T) {
	doc := OpenAPI()
	paths := doc["paths"].(map[string]any)
	op, ok := paths["/admin/catalog-definitions/{id}"].(map[string]any)
	if !ok {
		t.Fatal("单版本文档端点未进 OpenAPI 文档")
	}
	get, ok := op["get"].(map[string]any)
	if !ok {
		t.Fatal("单版本文档端点必须是 GET")
	}
	if _, ok := get["security"]; !ok {
		t.Fatal("单版本文档端点必须声明 security（需要登录与 catalog.definitions.manage）")
	}
	declared := map[string]bool{}
	for _, p := range get["parameters"].([]any) {
		pm := p.(map[string]any)
		if pm["in"] == "path" {
			declared[pm["name"].(string)] = true
		}
	}
	for _, name := range pathTemplateParams("/admin/catalog-definitions/{id}") {
		if !declared[name] {
			t.Fatalf("单版本文档端点缺 in=path 参数 %q", name)
		}
	}
	resp := get["responses"].(map[string]any)["200"].(map[string]any)["content"].(map[string]any)["application/json"].(map[string]any)["schema"].(map[string]any)
	if resp["$ref"] != "#/components/schemas/DefinitionVersion" {
		t.Fatalf("单版本文档 200 响应 schema=%v, want DefinitionVersion", resp["$ref"])
	}
	if summary, _ := get["summary"].(string); !strings.Contains(summary, "document") || !strings.Contains(summary, "summary") || !strings.Contains(summary, "catalog.definitions.manage") {
		t.Fatalf("单版本文档端点说明未覆盖文档/摘要/权限码: %q", summary)
	}
}
