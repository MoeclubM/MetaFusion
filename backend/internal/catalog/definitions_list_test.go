package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// 摘要文本只有一处格式来源：带文档与不带文档两条列表路径必须给出逐字相同的 summary。
func TestDefinitionSummaryCountsMatchDocument(t *testing.T) {
	d := Definitions{
		Types:     map[string]TypeDefinition{"a": {}, "b": {}},
		Fields:    map[string]Field{"a": {}, "b": {}, "c": {}},
		Relations: map[string]RelationDefinition{"a": {}},
		Templates: map[string]Template{},
	}
	if got, want := definitionSummaryCounts(len(d.Fields), len(d.Types), len(d.Relations), len(d.Templates)), definitionSummary(d); got != want {
		t.Fatalf("计数摘要=%q, 文档摘要=%q", got, want)
	}
}

// 列表瘦身（真库）：include_document=false 时响应里没有 document 键、响应体明显更小，
// 而 state/base_version/created_at/created_by/summary 与默认逐字一致；默认行为不变（仍带文档）。
func TestPostgresDefinitionListWithoutDocument(t *testing.T) {
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
	defsUser := &User{ID: uuid.NewString(), Username: "catalog-admin", Permissions: []string{PermissionDefinitionsManage}}
	otherUser := &User{ID: uuid.NewString(), Username: "catalog-editor", Permissions: []string{PermissionEntityEdit}}
	get := func(u *User, path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		engine(u).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		return w
	}
	// 造第二个版本：列表至少两行，字节对比才有代表性。
	seed, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	next := seed.Document
	next.Fields["list_slimming_marker"] = Field{Names: names("列表瘦身标记", "List slimming marker"), Type: "text", Enabled: true, Searchable: true}
	f.publish(next, seed.ID)

	type listItem struct {
		ID          int64        `json:"id"`
		State       string       `json:"state"`
		BaseVersion int64        `json:"base_version"`
		CreatedAt   *time.Time   `json:"created_at"`
		CreatedBy   string       `json:"created_by"`
		Summary     string       `json:"summary"`
		Document    *Definitions `json:"document"`
	}
	type definitionList struct {
		IncludeDocument bool       `json:"include_document"`
		Items           []listItem `json:"items"`
	}
	decode := func(w *httptest.ResponseRecorder) definitionList {
		t.Helper()
		var got definitionList
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("解码列表失败: %v body=%s", err, w.Body.String())
		}
		return got
	}

	full := get(defsUser, "/api/admin/catalog-definitions")
	if full.Code != http.StatusOK {
		t.Fatalf("默认列表=%d body=%s", full.Code, full.Body.String())
	}
	fullList, fullBytes := decode(full), full.Body.Len()
	if !fullList.IncludeDocument {
		t.Fatal("默认（未传参数）必须在响应里回报 include_document=true")
	}
	if len(fullList.Items) < 2 {
		t.Fatalf("夹具应产出至少两个版本，得到 %d", len(fullList.Items))
	}
	fullByID := map[int64]listItem{}
	for _, it := range fullList.Items {
		if it.Document == nil || len(it.Document.Fields) == 0 {
			t.Fatalf("默认列表项必须保留既有 document 字段: %+v", it)
		}
		if it.CreatedAt == nil || it.Summary == "" {
			t.Fatalf("默认列表项缺元数据: %+v", it)
		}
		if it.Summary != definitionSummary(*it.Document) {
			t.Fatalf("版本 %d 的 summary=%q 与文档计数不符", it.ID, it.Summary)
		}
		fullByID[it.ID] = it
	}

	slim := get(defsUser, "/api/admin/catalog-definitions?include_document=false")
	if slim.Code != http.StatusOK {
		t.Fatalf("瘦身列表=%d body=%s", slim.Code, slim.Body.String())
	}
	slimList, slimBytes := decode(slim), slim.Body.Len()
	if slimList.IncludeDocument {
		t.Fatal("include_document=false 时响应必须如实回报 false")
	}
	// 键名精确匹配：顶层 include_document 里也含 "document" 字样，不能用子串粗判。
	if strings.Contains(slim.Body.String(), `"document":`) {
		t.Fatalf("瘦身列表不得出现 document 键: %s", slim.Body.String())
	}
	if len(slimList.Items) != len(fullList.Items) {
		t.Fatalf("两次列表项数不同: %d vs %d", len(slimList.Items), len(fullList.Items))
	}
	for _, it := range slimList.Items {
		base, ok := fullByID[it.ID]
		if !ok {
			t.Fatalf("瘦身列表多出默认列表没有的版本 %d", it.ID)
		}
		if it.Document != nil {
			t.Fatalf("瘦身列表项仍带 document: %+v", it)
		}
		if it.State != base.State || it.BaseVersion != base.BaseVersion || it.CreatedBy != base.CreatedBy || it.Summary != base.Summary {
			t.Fatalf("瘦身后的元数据与默认不一致: %+v vs %+v", it, base)
		}
		if it.CreatedAt == nil || !it.CreatedAt.Equal(*base.CreatedAt) {
			t.Fatalf("瘦身后的 created_at 与默认不一致: %v vs %v", it.CreatedAt, base.CreatedAt)
		}
		if it.Summary == "" {
			t.Fatalf("版本 %d 的 summary 不能为空", it.ID)
		}
	}
	t.Logf("列表响应字节数：默认 %d 字节，include_document=false %d 字节（%.2f%%）", fullBytes, slimBytes, float64(slimBytes)*100/float64(fullBytes))
	// 瘦身必须是真的：文档是响应体的绝对大头，去掉后应远小于默认响应。
	if slimBytes*4 > fullBytes {
		t.Fatalf("瘦身列表应明显更小：%d 字节 vs 默认 %d 字节", slimBytes, fullBytes)
	}

	// 显式 true 与缺省同口径。
	if w := get(defsUser, "/api/admin/catalog-definitions?include_document=true"); w.Code != http.StatusOK || !decode(w).IncludeDocument {
		t.Fatalf("显式 include_document=true = %d body=%s", w.Code, w.Body.String())
	}
	// 非法取值不许静默按 true 处理（否则调用方以为瘦身了、实际仍在拉整份文档）。
	if w := get(defsUser, "/api/admin/catalog-definitions?include_document=maybe"); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_payload") {
		t.Fatalf("非法 include_document = %d body=%s, want 400 invalid_payload", w.Code, w.Body.String())
	}
	// 权限闸门与既有端点同口径。
	if w := get(nil, "/api/admin/catalog-definitions?include_document=false"); w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "authentication_required") {
		t.Fatalf("匿名列表=%d body=%s, want 401", w.Code, w.Body.String())
	}
	if w := get(otherUser, "/api/admin/catalog-definitions?include_document=false"); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "forbidden") {
		t.Fatalf("无 catalog.definitions.manage 列表=%d body=%s, want 403", w.Code, w.Body.String())
	}
}

// OpenAPI 同步：列表的参数与响应形状必须写进文档——include_document 查询参数，
// DefinitionList 响应（items 元素类型单列，document 在 include_document=false 时可缺省）。
func TestOpenAPIDefinitionListDocumentFlag(t *testing.T) {
	doc := OpenAPI()
	list := doc["paths"].(map[string]any)["/admin/catalog-definitions"].(map[string]any)["get"].(map[string]any)
	found := false
	for _, p := range list["parameters"].([]any) {
		pm := p.(map[string]any)
		if pm["name"] == "include_document" && pm["in"] == "query" {
			found = true
		}
	}
	if !found {
		t.Fatal("列表端点缺少 include_document 查询参数声明")
	}
	resp := list["responses"].(map[string]any)["200"].(map[string]any)["content"].(map[string]any)["application/json"].(map[string]any)["schema"].(map[string]any)
	if resp["$ref"] != "#/components/schemas/DefinitionList" {
		t.Fatalf("列表 200 响应 schema=%v, want DefinitionList", resp["$ref"])
	}
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	props, ok := schemas["DefinitionList"].(map[string]any)["properties"].(map[string]any)
	if !ok || props["items"] == nil || props["include_document"] == nil {
		t.Fatalf("DefinitionList schema 缺 items/include_document: %v", schemas["DefinitionList"])
	}
	if items := props["items"].(map[string]any); items["type"] != "array" {
		t.Fatalf("DefinitionList.items 应为数组: %v", items)
	}
	itemProps, ok := schemas["DefinitionVersionItem"].(map[string]any)["properties"].(map[string]any)
	if !ok {
		t.Fatal("DefinitionVersionItem schema 缺失")
	}
	for _, k := range []string{"id", "state", "base_version", "document", "created_at", "created_by", "summary"} {
		if itemProps[k] == nil {
			t.Fatalf("DefinitionVersionItem schema 缺 %s 字段", k)
		}
	}
}
