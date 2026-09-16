package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// 列表摘要只报分区条目数、顺序固定：前端不必展开整份 document 就能显示"这一版有几条定义"。
func TestDefinitionSummary(t *testing.T) {
	d := Definitions{
		Types:     map[string]TypeDefinition{"a": {}, "b": {}},
		Fields:    map[string]Field{"a": {}, "b": {}, "c": {}},
		Relations: map[string]RelationDefinition{"a": {}},
		Templates: map[string]Template{},
	}
	if got, want := definitionSummary(d), "字段 3 / 类型 2 / 关系 1 / 模板 0"; got != want {
		t.Fatalf("definitionSummary = %q, want %q", got, want)
	}
	// 分区为 nil（缺省文档）不得 panic，计数按 0 报出。
	if got, want := definitionSummary(Definitions{}), "字段 0 / 类型 0 / 关系 0 / 模板 0"; got != want {
		t.Fatalf("empty definitionSummary = %q, want %q", got, want)
	}
}

// 没有修订记录的版本行（Initialize 播种、直接写库）也必须能回滚：
// 说明与来源退化为自述，且必须满足 Draft/Publish 的证据要求（note 非空 + 至少一条来源）。
func TestRollbackEvidenceFallsBackWithoutRevision(t *testing.T) {
	// sql.Open 是惰性的：这里不建连接，查询必然失败，正好覆盖"修订表里查不到"的回退分支。
	db, err := sql.Open("postgres", "postgres://127.0.0.1:1/mf_v2_test?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	note, sources := rollbackEvidence(context.Background(), db, 7)
	if !strings.Contains(note, "回滚定义到版本 7") {
		t.Fatalf("回退说明缺少目标版本号: %q", note)
	}
	if len(sources) != 1 || sources[0].Kind != "self" || !strings.Contains(sources[0].Citation, "7") {
		t.Fatalf("回退来源应为一条自述来源: %+v", sources)
	}
	if err = validateSources(note, sources); err != nil {
		t.Fatalf("回滚说明与来源必须满足 evidence 契约: %v", err)
	}
}

// 真库用例：回滚 = 以当前已发布版本为 base，把历史版本的 document 重新起草并发布
//（复用 Draft + Publish，不原地改历史行）。
func TestPostgresDefinitionRollback(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	clone := func(d Definitions) Definitions {
		t.Helper()
		var out Definitions
		if err := json.Unmarshal([]byte(encode(d)), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	defsCount := func() int {
		t.Helper()
		var n int
		if err := f.s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog.definitions").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
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
	// 版本 A：走正常 Draft/Publish 的历史目标版本（带编辑说明与来源，供回滚继承）。
	a := clone(seed.Document)
	a.Fields["rollback_marker"] = Field{Names: names("回滚标记", "Rollback marker"), Type: "text", Enabled: true, Searchable: true}
	f.publish(a, seed.ID)
	targetID := publishedID()
	if targetID == seed.ID {
		t.Fatal("夹具未产出历史版本 A")
	}
	// 版本 B：当前已发布版本，与 A 的文档不同（多了被实体引用的自定义类型）。
	b := clone(a)
	b.Types["rollback_custom"] = TypeDefinition{Names: names("回滚自定义类型", "Rollback custom type"), Kinds: []string{"work"}, Fields: []string{"language"}, Template: "photography", Enabled: true}
	f.publish(b, targetID)
	currentID := publishedID()
	if currentID == targetID {
		t.Fatal("夹具未产出当前发布版本 B")
	}
	rolled := DefinitionRollback{}

	t.Run("正常回滚发布新版本", func(t *testing.T) {
		before := defsCount()
		res, err := f.s.RollbackDefinitions(ctx, targetID, f.u)
		if err != nil {
			t.Fatal(err)
		}
		rolled = res
		if res.NoOp {
			t.Fatal("文档不同必须新建版本")
		}
		if res.ID == targetID || res.ID == currentID {
			t.Fatalf("回滚必须新建版本，id=%d", res.ID)
		}
		if res.State != "published" {
			t.Fatalf("state=%q, want published", res.State)
		}
		// base 指向"回滚前"的已发布版本，而不是目标版本：历史行不被原地改写。
		if res.BaseVersion != currentID {
			t.Fatalf("base_version=%d, want %d（回滚前的已发布版本）", res.BaseVersion, currentID)
		}
		wantNote := fmt.Sprintf("回滚定义到版本 %d（原编辑说明：configure fixture）", targetID)
		if res.EditNote != wantNote {
			t.Fatalf("edit_note=%q, want %q", res.EditNote, wantNote)
		}
		if got := defsCount(); got != before+1 {
			t.Fatalf("回滚只应新增一行版本：count=%d want %d", got, before+1)
		}
		live, err := f.s.Definitions(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if live.ID != res.ID {
			t.Fatalf("已发布版本=%d, want %d", live.ID, res.ID)
		}
		tv, err := f.s.definitionVersion(ctx, targetID)
		if err != nil {
			t.Fatal(err)
		}
		if encode(live.Document) != encode(tv.Document) {
			t.Fatal("回滚后的已发布文档与目标版本文档不一致")
		}
		if _, ok := live.Document.Types["rollback_custom"]; ok {
			t.Fatal("回滚必须真的回到目标版本文档（自定义类型应随之消失）")
		}
		// 审计：回滚走 Draft + Publish，修订与发件箱都要留下带目标版本号的记录。
		notes, citations := []string{}, []string{}
		rows, err := f.s.DB.QueryContext(ctx, "SELECT edit_note,sources FROM catalog.revisions WHERE target_id=$1 ORDER BY id", definitionRevisionTarget(res.ID))
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var note string
			var raw []byte
			if err = rows.Scan(&note, &raw); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			notes = append(notes, note)
			var sources []Source
			if err = json.Unmarshal(raw, &sources); err == nil {
				for _, s := range sources {
					citations = append(citations, s.Citation)
				}
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			t.Fatal(err)
		}
		if len(notes) != 2 {
			t.Fatalf("回滚应留下起草与发布两条修订，得到 %d：%v", len(notes), notes)
		}
		for _, note := range notes {
			if !strings.Contains(note, wantNote) {
				t.Fatalf("修订说明 %q 缺少回滚说明 %q", note, wantNote)
			}
		}
		if len(citations) == 0 || citations[0] != "isolated acceptance fixture" {
			t.Fatalf("回滚必须保留目标版本的来源，得到 %v", citations)
		}
		var events int
		if err = f.s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog.outbox WHERE entity_id=$1 AND type IN ('definitions.drafted','definitions.published')", definitionRevisionTarget(res.ID)).Scan(&events); err != nil {
			t.Fatal(err)
		}
		if events != 2 {
			t.Fatalf("回滚的发件箱事件=%d, want 2（起草 + 发布）", events)
		}
	})

	t.Run("相同文档回滚为 no_op", func(t *testing.T) {
		if rolled.ID == 0 {
			t.Skip("正常回滚用例未通过，跳过 no_op 断言")
		}
		before := defsCount()
		// 目标版本的文档此刻正是已发布文档：不新建版本，返回既有已发布版本。
		res, err := f.s.RollbackDefinitions(ctx, targetID, f.u)
		if err != nil {
			t.Fatal(err)
		}
		if !res.NoOp {
			t.Fatal("文档一致必须 no_op")
		}
		if res.ID != publishedID() || res.ID != rolled.ID {
			t.Fatalf("no_op 应返回既有已发布版本 %d, 得到 %d", rolled.ID, res.ID)
		}
		if res.EditNote != "" {
			t.Fatalf("no_op 不写库，edit_note 应为空，得到 %q", res.EditNote)
		}
		// 目标就是当前发布版本本身：同样 no_op。
		res, err = f.s.RollbackDefinitions(ctx, rolled.ID, f.u)
		if err != nil {
			t.Fatal(err)
		}
		if !res.NoOp || res.ID != rolled.ID {
			t.Fatalf("回滚到已发布版本自身应 no_op 并返回该版本，得到 %+v", res)
		}
		if got := defsCount(); got != before {
			t.Fatalf("no_op 不得新建版本：count=%d want %d", got, before)
		}
	})

	t.Run("不存在的版本与无权限", func(t *testing.T) {
		if _, err := f.s.RollbackDefinitions(ctx, 99999999, f.u); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("不存在的定义版本应返回 sql.ErrNoRows（HTTP 404），得到 %v", err)
		}
		other := User{ID: uuid.NewString(), Username: "catalog-editor", Role: "member", Permissions: []string{PermissionEntityEdit}}
		if _, err := f.s.RollbackDefinitions(ctx, targetID, other); !errors.Is(err, errForbidden) {
			t.Fatalf("无 catalog.definitions.manage 应返回 errForbidden（HTTP 403），得到 %v", err)
		}
	})

	t.Run("公开读返回被回滚的文档", func(t *testing.T) {
		if rolled.ID == 0 {
			t.Skip("正常回滚用例未通过，跳过公开读断言")
		}
		gin.SetMode(gin.TestMode)
		engine := gin.New()
		HTTP{Store: f.s}.Register(engine)
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/catalog/definitions", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("公开读状态=%d body=%s", w.Code, w.Body.String())
		}
		var got struct {
			ID       int64       `json:"id"`
			Document Definitions `json:"document"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		tv, err := f.s.definitionVersion(ctx, targetID)
		if err != nil {
			t.Fatal(err)
		}
		if got.ID != rolled.ID {
			t.Fatalf("公开读版本=%d, want %d", got.ID, rolled.ID)
		}
		if encode(got.Document) != encode(tv.Document) {
			t.Fatal("公开读文档与目标版本文档不一致")
		}
	})

	// 非法文档：手工插入"删掉了仍被实体引用的类型"的草稿行（绕过 Draft 正是脏文档进入版本表的方式），
	// 回滚必须被 impact 全量校验拦下，且不发布、不留孤儿草稿。
	t.Run("非法文档被 impact 拦下且零写入", func(t *testing.T) {
		cur, err := f.s.Definitions(ctx)
		if err != nil {
			t.Fatal(err)
		}
		withType := clone(cur.Document)
		withType.Types["rollback_custom"] = TypeDefinition{Names: names("回滚自定义类型", "Rollback custom type"), Kinds: []string{"work"}, Fields: []string{"language"}, Template: "photography", Enabled: true}
		f.publish(withType, cur.ID)
		if _, err = f.s.Save(ctx, Edit{Entity: Entity{Kind: "work", Title: "回滚引用夹具", Types: []string{"rollback_custom"}, Status: "published", Translations: map[string]Translation{"en": {Title: "rollback fixture"}}}, EditNote: "rollback fixture", Sources: fixtureSources()}, f.u); err != nil {
			t.Fatal(err)
		}
		bad := clone(withType)
		delete(bad.Types, "rollback_custom")
		var badID int64
		live, err := f.s.Definitions(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err = f.s.DB.QueryRowContext(ctx, "INSERT INTO catalog.definitions(state,base_version,document) VALUES('draft',$1,$2) RETURNING id", live.ID, encode(bad)).Scan(&badID); err != nil {
			t.Fatal(err)
		}
		before, published := defsCount(), publishedID()
		if _, err = f.s.RollbackDefinitions(ctx, badID, f.u); err == nil {
			t.Fatal("引用中的类型被删，回滚必须被 impact 拦下")
		} else if !strings.Contains(err.Error(), "definition_impact") {
			t.Fatalf("错误码应为 definition_impact，得到 %v", err)
		}
		if got := publishedID(); got != published {
			t.Fatalf("校验失败不得发布：published=%d want %d", got, published)
		}
		if got := defsCount(); got != before {
			t.Fatalf("impact 预检失败必须零写入：count=%d want %d", got, before)
		}
	})
}

// 端点闸门与状态码走真路由 + 真库：未登录 401、持别的目录码 403、不存在的 id 404、真实回滚 200，
// 列表项在既有字段之外带 state/created_at/created_by/summary。
func TestRollbackEndpointHTTP(t *testing.T) {
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
	do := func(u *User, method, path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		engine(u).ServeHTTP(w, httptest.NewRequest(method, path, nil))
		return w
	}
	defsUser := &User{ID: uuid.NewString(), Username: "catalog-admin", Role: "member", Permissions: []string{PermissionDefinitionsManage}}
	otherUser := &User{ID: uuid.NewString(), Username: "catalog-editor", Role: "member", Permissions: []string{PermissionEntityEdit}}

	seed, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	next := seed.Document
	next.Fields["rollback_endpoint_marker"] = Field{Names: names("端点回滚标记", "Endpoint rollback marker"), Type: "text", Enabled: true}
	f.publish(next, seed.ID)
	targetID := seed.ID
	path := fmt.Sprintf("/api/admin/catalog-definitions/%d/rollback", targetID)

	// 匿名：401（未登录）与 403（无权限）分成两个状态，前端据此决定跳登录还是提示无权限。
	if w := do(nil, http.MethodPost, path); w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "authentication_required") {
		t.Fatalf("匿名回滚=%d body=%s, want 401 authentication_required", w.Code, w.Body.String())
	}
	// 持别的目录码：403。
	if w := do(otherUser, http.MethodPost, path); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "forbidden") {
		t.Fatalf("无 catalog.definitions.manage 回滚=%d body=%s, want 403 forbidden", w.Code, w.Body.String())
	}
	// 不存在的版本（含非数字 id）：404。
	for _, missing := range []string{"/api/admin/catalog-definitions/99999999/rollback", "/api/admin/catalog-definitions/abc/rollback"} {
		if w := do(defsUser, http.MethodPost, missing); w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "not_found") {
			t.Fatalf("%s = %d body=%s, want 404 not_found", missing, w.Code, w.Body.String())
		}
	}
	// 持码 + 真实历史版本：200，返回新发布版本信息。
	w := do(defsUser, http.MethodPost, path)
	if w.Code != http.StatusOK {
		t.Fatalf("回滚=%d body=%s", w.Code, w.Body.String())
	}
	var rolled DefinitionRollback
	if err := json.Unmarshal(w.Body.Bytes(), &rolled); err != nil {
		t.Fatal(err)
	}
	if rolled.NoOp || rolled.ID == targetID || rolled.TargetID != targetID || rolled.State != "published" {
		t.Fatalf("回滚响应异常: %+v", rolled)
	}
	if rolled.BaseVersion == 0 || rolled.ID == 0 {
		t.Fatalf("回滚响应缺版本信息: %+v", rolled)
	}

	// 列表字段：在既有 document 之外追加 state / created_at / created_by / summary。
	lw := do(defsUser, http.MethodGet, "/api/admin/catalog-definitions")
	if lw.Code != http.StatusOK {
		t.Fatalf("列表=%d body=%s", lw.Code, lw.Body.String())
	}
	// 局部具名类型：列表项的字段即接口契约（既有字段 + 本次追加的四项）。
	type listItem struct {
		ID        int64        `json:"id"`
		State     string       `json:"state"`
		CreatedAt *time.Time   `json:"created_at"`
		CreatedBy string       `json:"created_by"`
		Summary   string       `json:"summary"`
		Document  *Definitions `json:"document"`
	}
	var list struct {
		Items []listItem `json:"items"`
	}
	if err := json.Unmarshal(lw.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	var rolledItem, seedItem *listItem
	for i := range list.Items {
		switch list.Items[i].ID {
		case rolled.ID:
			rolledItem = &list.Items[i]
		case seed.ID:
			seedItem = &list.Items[i]
		}
	}
	if rolledItem == nil || seedItem == nil {
		t.Fatalf("列表缺少版本 %d 或 %d: %s", rolled.ID, seed.ID, lw.Body.String())
	}
	if rolledItem.State != "published" || rolledItem.CreatedAt == nil {
		t.Fatalf("列表项缺 state/created_at: %+v", rolledItem)
	}
	if rolledItem.CreatedBy != defsUser.Username {
		t.Fatalf("列表项 created_by=%q, want %q（起草者）", rolledItem.CreatedBy, defsUser.Username)
	}
	if rolledItem.Summary != definitionSummary(*rolledItem.Document) || rolledItem.Summary == "" {
		t.Fatalf("列表项 summary=%q 与文档计数不符", rolledItem.Summary)
	}
	// 既有字段与形状不变：document 仍在列表项里。
	if rolledItem.Document == nil || len(rolledItem.Document.Fields) == 0 {
		t.Fatal("列表项必须保留既有 document 字段")
	}
	// 种子播种的版本行没有修订记录：created_by 省略（"若有"），摘要照常给出。
	if seedItem.CreatedBy != "" {
		t.Fatalf("无修订记录的版本不应有 created_by，得到 %q", seedItem.CreatedBy)
	}
	if seedItem.Summary == "" {
		t.Fatal("无修订记录的版本也要有 summary")
	}
}
