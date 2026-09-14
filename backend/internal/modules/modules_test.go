package modules

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/moduleapi"
	"github.com/metafusion/metafusion-app/internal/testutil"
)

type catalogStub struct {
	calls         int
	owner, entity string
}

func (s *catalogStub) Lookup(_ context.Context, id string, _ *moduleapi.Principal) (moduleapi.Entity, error) {
	s.calls++
	return moduleapi.Entity{ID: id, Kind: "work", Title: "Stub " + id, Status: "published"}, nil
}
func (s *catalogStub) LookupMany(_ context.Context, ids []string, _ *moduleapi.Principal) (map[string]moduleapi.Entity, error) {
	s.calls++
	out := make(map[string]moduleapi.Entity, len(ids))
	for _, id := range ids {
		out[id] = moduleapi.Entity{ID: id, Kind: "work", Title: "Stub " + id, Status: "published"}
	}
	return out, nil
}
func (s *catalogStub) RelatedEntities(context.Context, string, []string, *moduleapi.Principal) ([]moduleapi.Entity, error) {
	return nil, nil
}
func (s *catalogStub) Authenticate(_ context.Context, token string) (moduleapi.Principal, error) {
	if token == "test-token" {
		return moduleapi.Principal{ID: s.owner, Role: "admin"}, nil
	}
	return moduleapi.Principal{}, fmt.Errorf("not_authenticated")
}
func (s *catalogStub) Export(context.Context, string, *moduleapi.Principal) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}
func (s *catalogStub) Submit(context.Context, json.RawMessage, moduleapi.Principal) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func TestPostgresOptionalModuleIsolation(t *testing.T) {
	ctx := context.Background()
	db := testutil.Database(t)
	catalog := &catalogStub{owner: uuid.NewString(), entity: uuid.NewString()}
	m, err := New(ctx, db, catalog, filepath.Join(t.TempDir(), "archive"))
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	m.Register(r)
	request := func(path, token string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("GET", path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	path := "/api/archive/entities/" + catalog.entity + "/resources"
	if w := request(path, ""); w.Code != 404 || catalog.calls != 0 {
		t.Fatal("disabled module invoked catalog")
	}
	if err = m.Set(ctx, "playback", true, false); err == nil {
		t.Fatal("inactive dependency accepted")
	}
	if err = m.Set(ctx, "playback", true, true); err != nil {
		t.Fatal(err)
	}
	if err = m.Set(ctx, "archive", false, false); err == nil {
		t.Fatal("active dependent ignored")
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, _ := form.CreateFormFile("file", "private-track.txt")
	file.Write([]byte("private recording"))
	form.Close()
	req := httptest.NewRequest("POST", path, &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Authorization", "Bearer test-token")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	var uploaded map[string]any
	json.Unmarshal(w.Body.Bytes(), &uploaded)
	rid := uploaded["id"].(string)
	if w = request(path, ""); w.Code != 200 || strings.Contains(w.Body.String(), rid) || strings.Contains(w.Body.String(), "private-track") {
		t.Fatal("private resource metadata leaked")
	}
	if w = request("/api/archive/resources/"+rid+"/content", ""); w.Code != 404 {
		t.Fatal("private download leaked")
	}
	if w = request("/api/archive/resources/"+rid+"/content", "test-token"); w.Code != 200 || w.Body.String() != "private recording" {
		t.Fatal("owner download failed")
	}
	target, event := uuid.NewString(), uuid.NewString()
	if _, err = db.Exec("INSERT INTO modules.records(owner_id,entity_id,document) VALUES($1,$2,'{\"rating\":8}')", catalog.owner, catalog.entity); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err = m.ConsumeMerge(ctx, event, catalog.entity, target); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	db.QueryRow("SELECT count(*) FROM modules.consumed WHERE event_id=$1", event).Scan(&count)
	if count != 1 {
		t.Fatal("event not idempotent")
	}
	if w = request("/api/archive/entities/"+target+"/resources", "test-token"); !strings.Contains(w.Body.String(), rid) {
		t.Fatal("merged resource missing")
	}
	db.QueryRow("SELECT count(*) FROM modules.records WHERE entity_id=$1", target).Scan(&count)
	if count != 1 {
		t.Fatal("personal record did not follow merge")
	}
	if err = m.Set(ctx, "archive", false, true); err != nil {
		t.Fatal(err)
	}
	if m.Enabled("playback") {
		t.Fatal("cascade did not disable playback")
	}
	if w = request("/api/playback/resources/"+rid+"/content", "test-token"); w.Code != 404 {
		t.Fatal("disabled playback still routed")
	}
	// A failed module operation changes neither enabled state nor catalog data.
	if err = m.ConsumeMerge(ctx, uuid.NewString(), "invalid", target); err == nil {
		t.Fatal("invalid merge event accepted")
	}
	var coreTables int
	db.QueryRow("SELECT count(*) FROM information_schema.tables WHERE table_schema='catalog'").Scan(&coreTables)
	if coreTables != 0 {
		t.Fatal("module created core tables")
	}
}

// TestBindingPermissionPredicates 覆盖绑定鉴权的纯函数部分，无需数据库，本地必须跑过。
func TestBindingPermissionPredicates(t *testing.T) {
	owner := &moduleapi.Principal{ID: "owner-1", Role: "user"}
	admin := &moduleapi.Principal{ID: "admin-1", Role: "admin"}
	other := &moduleapi.Principal{ID: "other-1", Role: "user"}
	if !canManageResource(owner, "owner-1") {
		t.Fatal("owner should manage own resource")
	}
	if !canManageResource(admin, "owner-1") {
		t.Fatal("admin should manage any resource")
	}
	if canManageResource(other, "owner-1") {
		t.Fatal("non-owner must not manage resource")
	}
	if canManageResource(nil, "owner-1") {
		t.Fatal("nil principal must not manage resource")
	}
	if !isPrimaryBinding("entity-a", "entity-a") {
		t.Fatal("same entity must be primary binding")
	}
	if isPrimaryBinding("entity-a", "entity-b") {
		t.Fatal("different entity must not be primary binding")
	}
}

// bindingStub 支持多身份与实体可见性控制，供绑定集成测试使用。
type bindingStub struct {
	principals map[string]moduleapi.Principal
	hidden     map[string]bool
}

func (s *bindingStub) Lookup(_ context.Context, id string, _ *moduleapi.Principal) (moduleapi.Entity, error) {
	if s.hidden[id] {
		return moduleapi.Entity{}, fmt.Errorf("not_found")
	}
	return moduleapi.Entity{ID: id, Kind: "work", Title: "Stub " + id, Status: "published"}, nil
}
func (s *bindingStub) LookupMany(_ context.Context, ids []string, _ *moduleapi.Principal) (map[string]moduleapi.Entity, error) {
	out := make(map[string]moduleapi.Entity, len(ids))
	for _, id := range ids {
		if s.hidden[id] {
			continue
		}
		out[id] = moduleapi.Entity{ID: id, Kind: "work", Title: "Stub " + id, Status: "published"}
	}
	return out, nil
}
func (s *bindingStub) RelatedEntities(context.Context, string, []string, *moduleapi.Principal) ([]moduleapi.Entity, error) {
	return nil, nil
}
func (s *bindingStub) Authenticate(_ context.Context, token string) (moduleapi.Principal, error) {
	if p, ok := s.principals[token]; ok {
		return p, nil
	}
	return moduleapi.Principal{}, fmt.Errorf("not_authenticated")
}
func (s *bindingStub) Export(context.Context, string, *moduleapi.Principal) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}
func (s *bindingStub) Submit(context.Context, json.RawMessage, moduleapi.Principal) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

// TestArchiveResourceBindings 覆盖绑定 CRUD 鉴权、列表并集、ConsumeMerge 改写与
// 主归属保护。需真实数据库（testutil.Database，无 MF_V2_TEST_DSN 时跳过）。
func TestArchiveResourceBindings(t *testing.T) {
	ctx := context.Background()
	db := testutil.Database(t)
	ownerID, otherID := uuid.NewString(), uuid.NewString()
	stub := &bindingStub{
		principals: map[string]moduleapi.Principal{
			"owner-token": {ID: ownerID, Role: "user"},
			"other-token": {ID: otherID, Role: "user"},
			"admin-token": {ID: uuid.NewString(), Role: "admin"},
		},
		hidden: map[string]bool{},
	}
	m, err := New(ctx, db, stub, filepath.Join(t.TempDir(), "archive"))
	if err != nil {
		t.Fatal(err)
	}
	if err = m.Set(ctx, "archive", true, false); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	m.Register(r)
	do := func(method, path, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	entityA, entityB, entityC := uuid.NewString(), uuid.NewString(), uuid.NewString()
	// owner 在主归属 entityA 上传私有资源（单文件多集场景的被绑资源）。
	var buf bytes.Buffer
	form := multipart.NewWriter(&buf)
	fw, _ := form.CreateFormFile("file", "multi-episode.bin")
	fw.Write([]byte("episode bundle"))
	form.Close()
	req := httptest.NewRequest("POST", "/api/archive/entities/"+entityA+"/resources", &buf)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Authorization", "Bearer owner-token")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	var uploaded map[string]any
	json.Unmarshal(w.Body.Bytes(), &uploaded)
	rid := uploaded["id"].(string)
	bindPath := "/api/archive/resources/" + rid + "/bindings"
	bindBody := `{"entity_id":"` + entityB + `"}`
	// 未认证拒绝。
	if w = do("POST", bindPath, "", bindBody); w.Code != 401 {
		t.Fatalf("unauthenticated bind: %d %s", w.Code, w.Body.String())
	}
	// 非 owner 拒绝。
	if w = do("POST", bindPath, "other-token", bindBody); w.Code != 403 {
		t.Fatalf("non-owner bind: %d %s", w.Code, w.Body.String())
	}
	// 非法 entity 拒绝：非 UUID 进 400。
	if w = do("POST", bindPath, "owner-token", `{"entity_id":"nope"}`); w.Code != 400 {
		t.Fatalf("malformed entity bind: %d %s", w.Code, w.Body.String())
	}
	// 不可见 entity 拒绝：可见性检查不通过进 404。
	stub.hidden[entityB] = true
	if w = do("POST", bindPath, "owner-token", bindBody); w.Code != 404 {
		t.Fatalf("invisible entity bind: %d %s", w.Code, w.Body.String())
	}
	delete(stub.hidden, entityB)
	// owner 绑定成功；admin 复绑同实体同样放行（幂等）。
	if w = do("POST", bindPath, "owner-token", bindBody); w.Code != 200 {
		t.Fatalf("owner bind: %d %s", w.Code, w.Body.String())
	}
	if w = do("POST", bindPath, "admin-token", bindBody); w.Code != 200 {
		t.Fatalf("admin bind: %d %s", w.Code, w.Body.String())
	}
	// 列表并集：绑定实体与主归属均能列出该资源，条目形状保持 resource 兼容。
	if w = do("GET", "/api/archive/entities/"+entityB+"/resources", "owner-token", ""); w.Code != 200 || !strings.Contains(w.Body.String(), rid) {
		t.Fatalf("union list missing bound resource: %d %s", w.Code, w.Body.String())
	}
	if w = do("GET", "/api/archive/entities/"+entityA+"/resources", "owner-token", ""); w.Code != 200 || !strings.Contains(w.Body.String(), rid) {
		t.Fatalf("primary list missing resource: %d %s", w.Code, w.Body.String())
	}
	// 解绑鉴权：非 owner 拒绝。
	if w = do("DELETE", bindPath+"/"+entityB, "other-token", ""); w.Code != 403 {
		t.Fatalf("non-owner unbind: %d %s", w.Code, w.Body.String())
	}
	// 主归属不可经解绑接口删除（仓库无资源删除流程，明确拒绝）。
	if w = do("DELETE", bindPath+"/"+entityA, "owner-token", ""); w.Code != 409 {
		t.Fatalf("primary unbind: %d %s", w.Code, w.Body.String())
	}
	// 下载鉴权：主归属不可见时，任一绑定实体可见仍可下载。
	stub.hidden[entityA] = true
	if w = do("GET", "/api/archive/resources/"+rid+"/content", "owner-token", ""); w.Code != 200 || w.Body.String() != "episode bundle" {
		t.Fatalf("bound download: %d %s", w.Code, w.Body.String())
	}
	delete(stub.hidden, entityA)
	// ConsumeMerge 改写绑定 entityB→entityC。
	if err = m.ConsumeMerge(ctx, uuid.NewString(), entityB, entityC); err != nil {
		t.Fatal(err)
	}
	var n int
	db.QueryRow("SELECT count(*) FROM modules.resource_bindings WHERE resource_id=$1 AND entity_id=$2", rid, entityC).Scan(&n)
	if n != 1 {
		t.Fatal("merge did not rewrite binding to target")
	}
	db.QueryRow("SELECT count(*) FROM modules.resource_bindings WHERE resource_id=$1 AND entity_id=$2", rid, entityB).Scan(&n)
	if n != 0 {
		t.Fatal("merge left stale source binding")
	}
	if w = do("GET", "/api/archive/entities/"+entityC+"/resources", "owner-token", ""); w.Code != 200 || !strings.Contains(w.Body.String(), rid) {
		t.Fatalf("merged union list missing: %d %s", w.Code, w.Body.String())
	}
	// 解绑成功后，目标实体列表不再含该资源。
	if w = do("DELETE", bindPath+"/"+entityC, "owner-token", ""); w.Code != 200 {
		t.Fatalf("unbind: %d %s", w.Code, w.Body.String())
	}
	if w = do("GET", "/api/archive/entities/"+entityC+"/resources", "owner-token", ""); w.Code != 200 || strings.Contains(w.Body.String(), rid) {
		t.Fatalf("unbound resource still listed: %d %s", w.Code, w.Body.String())
	}
}
