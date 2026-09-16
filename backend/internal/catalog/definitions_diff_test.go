package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// changeAt 取指定路径的差异条目；路径必须唯一，否则夹具或比较器写错了。
func changeAt(t *testing.T, diff DefinitionDiff, path string) DefinitionChange {
	t.Helper()
	out := DefinitionChange{}
	found := 0
	for _, c := range diff.Changes {
		if c.Path == path {
			out = c
			found++
		}
	}
	if found != 1 {
		t.Fatalf("路径 %s 的差异条目 %d 条, want 1：%+v", path, found, diff.Changes)
	}
	return out
}

// 逻辑用例（不依赖真库）：比较器只看语义，不看序列化形态。
//   - 值相同不改；仅顺序不同不算变更（数组按多重集比）；
//   - 新增键 / 删除键 / 值变更 / 开关翻转四类的路径与新旧值；
//   - 数组下标路径、长值截断并标明、按分区与按类型的计数汇总。
func TestDefinitionDiffLogic(t *testing.T) {
	doc := func() Definitions {
		return Definitions{
			Types: map[string]TypeDefinition{
				"work_type": {Names: Names{"zh": "作品类型", "en": "Work type"}, Kinds: []string{"work"}, Fields: []string{"language", "title"}, Template: "photography", Enabled: true},
			},
			Fields: map[string]Field{
				"language": {Names: Names{"zh-CN": "语言", "en-US": "Language", "zh-TW": "語言"}, Type: "text", Enabled: true, Searchable: true},
			},
			Vocabularies: map[string]Vocabulary{
				"format": {Names: Names{"en": "Format"}, Terms: map[string]Term{"cd": {Names: Names{"en": "CD"}, Enabled: true}}},
			},
			Relations: map[string]RelationDefinition{
				"part_of": {Names: Names{"en": "Part of"}, ReverseNames: Names{"en": "Has part"}, SourceKinds: []string{"work"}, TargetKinds: []string{"work"}, MaxOutgoing: 1, Enabled: true},
			},
			Templates: map[string]Template{
				"photography": {Names: Names{"en": "Photography"}, Columns: []string{"title", "date"}, Directory: "works", Modules: []string{"cover"}},
			},
			Schemes: map[string]Scheme{
				"paper": {Names: Names{"en": "Paper"}, Slot: "locator", Fields: []string{"page"}, Enabled: true},
			},
			Structure: map[string]StructureRule{
				"expression": {Fields: []StructureField{{Code: "work_id", Required: true}, {Code: "content_unit_id"}}},
			},
		}
	}

	// 1) 值相同不改；零差异时汇总键也必须齐全（面板不必判断键是否存在）。
	same := definitionDiff(2, 1, 1, doc(), doc())
	if len(same.Changes) != 0 || same.Summary.Total != 0 {
		t.Fatalf("文档相同不得报差异: %+v", same.Changes)
	}
	if len(same.Summary.ByChange) != 4 || len(same.Summary.BySection) != 7 {
		t.Fatalf("零差异的汇总键必须齐全: %+v", same.Summary)
	}

	// 2) 仅顺序不同不算变更：标量数组与对象数组重排后逐字相同。
	reordered := doc()
	workType := reordered.Types["work_type"]
	workType.Fields = []string{"title", "language"}
	reordered.Types["work_type"] = workType
	tpl := reordered.Templates["photography"]
	tpl.Columns = []string{"date", "title"}
	reordered.Templates["photography"] = tpl
	rule := reordered.Structure["expression"]
	rule.Fields = []StructureField{{Code: "content_unit_id"}, {Code: "work_id", Required: true}}
	reordered.Structure["expression"] = rule
	if got := definitionDiff(2, 1, 1, doc(), reordered); len(got.Changes) != 0 {
		t.Fatalf("仅顺序不同不得报变更: %+v", got.Changes)
	}

	// 3) 四类变更 + 数组下标路径 + 长值截断。
	after := doc()
	after.Fields["new_field"] = Field{Names: Names{"zh": "新增字段", "en": "New field"}, Type: "text", Enabled: true}
	delete(after.Vocabularies["format"].Terms, "cd")
	lang := after.Fields["language"]
	lang.Names["zh-TW"] = "語言（繁）"
	lang.Enabled = false
	long := strings.Repeat("x", definitionDiffMaxValue+40)
	lang.Names["en-US"] = long
	after.Fields["language"] = lang
	after.Types["work_type"] = TypeDefinition{Names: Names{"zh": "作品类型", "en": "Work type"}, Kinds: []string{"work"}, Fields: []string{"language", "title", "subtitle"}, Template: "photography", Enabled: true}
	rel := after.Relations["part_of"]
	rel.Aggregate = true
	after.Relations["part_of"] = rel

	got := definitionDiff(7, 6, 6, doc(), after)

	added := changeAt(t, got, "fields.new_field")
	if added.Change != definitionChangeAdded || added.From != nil || added.Section != "fields" {
		t.Fatalf("新增键条目异常: %+v", added)
	}
	value, ok := added.To.(map[string]any)
	if !ok || value["type"] != "text" {
		t.Fatalf("新增键必须带整棵子树作为新值: %#v", added.To)
	}
	removed := changeAt(t, got, "vocabularies.format.terms.cd")
	if removed.Change != definitionChangeRemoved || removed.To != nil || removed.Section != "vocabularies" {
		t.Fatalf("删除键条目异常: %+v", removed)
	}
	term, ok := removed.From.(map[string]any)
	if !ok || term["enabled"] != true {
		t.Fatalf("删除键必须带整棵子树作为旧值: %#v", removed.From)
	}
	changed := changeAt(t, got, "fields.language.names.zh-TW")
	if changed.Change != definitionChangeChanged || changed.From != "語言" || changed.To != "語言（繁）" {
		t.Fatalf("值变更条目异常: %+v", changed)
	}
	toggled := changeAt(t, got, "relations.part_of.aggregate")
	if toggled.Change != definitionChangeToggled || toggled.From != false || toggled.To != true {
		t.Fatalf("开关翻转（omitempty 布尔键出现）异常: %+v", toggled)
	}
	off := changeAt(t, got, "fields.language.enabled")
	if off.Change != definitionChangeToggled || off.From != true || off.To != false {
		t.Fatalf("开关翻转（两侧都在的布尔）异常: %+v", off)
	}
	element := changeAt(t, got, "types.work_type.fields[2]")
	if element.Change != definitionChangeAdded || element.To != "subtitle" {
		t.Fatalf("数组下标条目异常: %+v", element)
	}
	truncated := changeAt(t, got, "fields.language.names.en-US")
	if truncated.Change != definitionChangeChanged || !truncated.Truncated || truncated.From != "Language" {
		t.Fatalf("长值变更必须截断并标明: %+v", truncated)
	}
	if text, ok := truncated.To.(string); !ok || len(text) != definitionDiffMaxValue || strings.Contains(text, long) {
		t.Fatalf("截断值应为 %d 字节的字符串前缀: %d", definitionDiffMaxValue, len(fmt.Sprint(truncated.To)))
	}
	if got.Summary.Total != len(got.Changes) || got.Summary.ByChange[definitionChangeAdded] != 2 || got.Summary.ByChange[definitionChangeRemoved] != 1 || got.Summary.ByChange[definitionChangeChanged] != 2 || got.Summary.ByChange[definitionChangeToggled] != 2 {
		t.Fatalf("按变更类型的汇总异常: %+v", got.Summary)
	}
	if got.Summary.BySection["fields"] != 4 || got.Summary.BySection["types"] != 1 || got.Summary.BySection["relations"] != 1 || got.Summary.BySection["vocabularies"] != 1 || got.Summary.BySection["templates"] != 0 {
		t.Fatalf("按分区的汇总异常: %+v", got.Summary.BySection)
	}
	if got.ID != 7 || got.Against != 6 || got.BaseVersion != 6 {
		t.Fatalf("差异元数据异常: %+v", got)
	}
}

// 真库用例：四类变更各至少一条（断言路径与新旧值）、数组下标路径、汇总计数，
// 响应不含 document 也不含整份文档的体积；against 缺省为 base_version，显式基线生效；
// 两端版本不存在 404、against 非法 400、匿名 401 / 无码 403。
func TestPostgresDefinitionDiffEndpoint(t *testing.T) {
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
	clone := func(d Definitions) Definitions {
		t.Helper()
		var out Definitions
		if err := json.Unmarshal([]byte(encode(d)), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	publishedID := func() int64 {
		t.Helper()
		v, err := f.s.Definitions(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return v.ID
	}
	seed, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// 基线版本 A：放一个稍后要删的类型、一个要改值/翻开关的字段、一个稍后要追加数组元素的类型。
	a := clone(seed.Document)
	a.Types["diff_removed_type"] = TypeDefinition{Names: names("待删类型", "Removed type"), Kinds: []string{"work"}, Fields: []string{"language"}, Template: "photography", Enabled: true}
	a.Types["diff_array_type"] = TypeDefinition{Names: names("数组类型", "Array type"), Kinds: []string{"work"}, Fields: []string{"language"}, Template: "photography", Enabled: true}
	a.Fields["diff_probe"] = Field{Names: names("旧名", "Old name"), Type: "text", Enabled: true, Searchable: true}
	f.publish(a, seed.ID)
	baseID := publishedID()
	if baseID == seed.ID {
		t.Fatal("夹具未产出基线版本 A")
	}
	// 当前版本 B：新增键 / 删除键 / 值变更 / 开关翻转 / 数组追加。
	b := clone(a)
	b.Fields["diff_added"] = Field{Names: names("新增字段", "Added field"), Type: "text", Enabled: true}
	delete(b.Types, "diff_removed_type")
	probe := b.Fields["diff_probe"]
	probe.Names["zh-CN"] = "新名"
	probe.Enabled = false
	b.Fields["diff_probe"] = probe
	arrayType := b.Types["diff_array_type"]
	arrayType.Fields = []string{"language", "diff_probe"}
	b.Types["diff_array_type"] = arrayType
	f.publish(b, baseID)
	curID := publishedID()
	if curID == baseID {
		t.Fatal("夹具未产出当前版本 B")
	}
	baseDoc, err := f.s.definitionVersion(ctx, baseID)
	if err != nil {
		t.Fatal(err)
	}
	curDoc, err := f.s.definitionVersion(ctx, curID)
	if err != nil {
		t.Fatal(err)
	}

	w := do(defsUser, fmt.Sprintf("/api/admin/catalog-definitions/%d/diff", curID))
	if w.Code != http.StatusOK {
		t.Fatalf("差异=%d body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), `"document":`) {
		t.Fatalf("差异响应不得返回整份 document: %s", w.Body.String())
	}
	var diff DefinitionDiff
	if err := json.Unmarshal(w.Body.Bytes(), &diff); err != nil {
		t.Fatal(err)
	}
	if diff.ID != curID || diff.Against != baseID || diff.BaseVersion != baseID {
		t.Fatalf("against 缺省应取 base_version: %+v", diff)
	}
	added := changeAt(t, diff, "fields.diff_added")
	if added.Change != definitionChangeAdded || added.From != nil || added.To == nil {
		t.Fatalf("真库新增键条目异常: %+v", added)
	}
	if to, ok := added.To.(map[string]any); !ok || to["type"] != "text" {
		t.Fatalf("真库新增键必须带新值: %#v", added.To)
	}
	removed := changeAt(t, diff, "types.diff_removed_type")
	if removed.Change != definitionChangeRemoved || removed.To != nil || removed.From == nil {
		t.Fatalf("真库删除键条目异常: %+v", removed)
	}
	if from, ok := removed.From.(map[string]any); !ok || from["template"] != "photography" {
		t.Fatalf("真库删除键必须带旧值: %#v", removed.From)
	}
	changed := changeAt(t, diff, "fields.diff_probe.names.zh-CN")
	if changed.Change != definitionChangeChanged || changed.From != "旧名" || changed.To != "新名" {
		t.Fatalf("真库值变更条目异常: %+v", changed)
	}
	toggled := changeAt(t, diff, "fields.diff_probe.enabled")
	if toggled.Change != definitionChangeToggled || toggled.From != true || toggled.To != false {
		t.Fatalf("真库开关翻转条目异常: %+v", toggled)
	}
	element := changeAt(t, diff, "types.diff_array_type.fields[1]")
	if element.Change != definitionChangeAdded || element.To != "diff_probe" {
		t.Fatalf("真库数组下标条目异常: %+v", element)
	}
	if diff.Summary.Total != len(diff.Changes) || diff.Summary.ByChange[definitionChangeAdded] < 2 || diff.Summary.ByChange[definitionChangeRemoved] < 1 || diff.Summary.ByChange[definitionChangeChanged] < 1 || diff.Summary.ByChange[definitionChangeToggled] < 1 {
		t.Fatalf("真库按变更类型的汇总异常: %+v", diff.Summary)
	}
	if diff.Summary.BySection["fields"] < 3 || diff.Summary.BySection["types"] < 2 {
		t.Fatalf("真库按分区的汇总异常: %+v", diff.Summary.BySection)
	}
	// 差异响应只是条目：远小于两侧文档之和（这正是这条端点存在的意义）。
	fullSize := len(encode(baseDoc.Document)) + len(encode(curDoc.Document))
	t.Logf("差异响应 %d 字节，两侧文档合计 %d 字节（%.2f%%）", w.Body.Len(), fullSize, float64(w.Body.Len())*100/float64(fullSize))
	if w.Body.Len()*4 > fullSize {
		t.Fatalf("差异响应 %d 字节，占两侧文档 %d 字节的比例过高", w.Body.Len(), fullSize)
	}

	// 显式基线：与更早的版本比，diff_probe 是新增而不是改值。
	w2 := do(defsUser, fmt.Sprintf("/api/admin/catalog-definitions/%d/diff?against=%d", curID, seed.ID))
	if w2.Code != http.StatusOK {
		t.Fatalf("指定基线差异=%d body=%s", w2.Code, w2.Body.String())
	}
	var older DefinitionDiff
	if err := json.Unmarshal(w2.Body.Bytes(), &older); err != nil {
		t.Fatal(err)
	}
	if older.Against != seed.ID || older.BaseVersion != baseID {
		t.Fatalf("显式基线未生效: %+v", older)
	}
	if c := changeAt(t, older, "fields.diff_probe"); c.Change != definitionChangeAdded {
		t.Fatalf("与更早版本比时 diff_probe 应为新增: %+v", c)
	}

	// 两端版本不存在（含非数字 id）一律 404；against 非法是请求形状错误 400。
	for _, missing := range []string{
		"/api/admin/catalog-definitions/99999999/diff",
		fmt.Sprintf("/api/admin/catalog-definitions/%d/diff?against=99999999", curID),
		fmt.Sprintf("/api/admin/catalog-definitions/abc/diff?against=%d", curID),
	} {
		if w := do(defsUser, missing); w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "not_found") {
			t.Fatalf("%s = %d body=%s, want 404 not_found", missing, w.Code, w.Body.String())
		}
	}
	if w := do(defsUser, fmt.Sprintf("/api/admin/catalog-definitions/%d/diff?against=abc", curID)); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_payload") {
		t.Fatalf("非法 against = %d body=%s, want 400 invalid_payload", w.Code, w.Body.String())
	}
	if w := do(nil, fmt.Sprintf("/api/admin/catalog-definitions/%d/diff", curID)); w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "authentication_required") {
		t.Fatalf("匿名差异=%d body=%s, want 401", w.Code, w.Body.String())
	}
	if w := do(otherUser, fmt.Sprintf("/api/admin/catalog-definitions/%d/diff", curID)); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "forbidden") {
		t.Fatalf("无 catalog.definitions.manage 差异=%d body=%s, want 403", w.Code, w.Body.String())
	}
}

// OpenAPI 同步：差异端点的 against 查询参数、{id} 路径参数、登录声明与 200 响应 schema。
func TestOpenAPIDefinitionDiffPath(t *testing.T) {
	doc := OpenAPI()
	paths := doc["paths"].(map[string]any)
	op, ok := paths["/admin/catalog-definitions/{id}/diff"].(map[string]any)
	if !ok {
		t.Fatal("差异端点未进 OpenAPI 文档")
	}
	get, ok := op["get"].(map[string]any)
	if !ok {
		t.Fatal("差异端点必须是 GET")
	}
	if _, ok := get["security"]; !ok {
		t.Fatal("差异端点必须声明 security（需要登录与 catalog.definitions.manage）")
	}
	pathParams, queryParams := map[string]bool{}, map[string]bool{}
	for _, p := range get["parameters"].([]any) {
		pm := p.(map[string]any)
		if pm["in"] == "path" {
			pathParams[pm["name"].(string)] = true
		}
		if pm["in"] == "query" {
			queryParams[pm["name"].(string)] = true
		}
	}
	if !queryParams["against"] || !pathParams["id"] {
		t.Fatalf("差异端点缺 against 查询参数或 {id} 路径参数: %v", get["parameters"])
	}
	resp := get["responses"].(map[string]any)["200"].(map[string]any)["content"].(map[string]any)["application/json"].(map[string]any)["schema"].(map[string]any)
	if resp["$ref"] != "#/components/schemas/DefinitionDiff" {
		t.Fatalf("差异 200 响应 schema=%v, want DefinitionDiff", resp["$ref"])
	}
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	props, ok := schemas["DefinitionDiff"].(map[string]any)["properties"].(map[string]any)
	if !ok || props["id"] == nil || props["against"] == nil || props["base_version"] == nil || props["changes"] == nil || props["summary"] == nil {
		t.Fatalf("DefinitionDiff schema 字段不全: %v", schemas["DefinitionDiff"])
	}
	changeProps, ok := schemas["DefinitionChange"].(map[string]any)["properties"].(map[string]any)
	if !ok {
		t.Fatal("DefinitionChange schema 缺失")
	}
	for _, k := range []string{"path", "section", "change", "from", "to", "truncated"} {
		if changeProps[k] == nil {
			t.Fatalf("DefinitionChange schema 缺 %s 字段", k)
		}
	}
	summaryProps, ok := schemas["DefinitionDiffSummary"].(map[string]any)["properties"].(map[string]any)
	if !ok || summaryProps["total"] == nil || summaryProps["by_section"] == nil || summaryProps["by_change"] == nil {
		t.Fatalf("DefinitionDiffSummary schema 字段不全: %v", schemas["DefinitionDiffSummary"])
	}
}
