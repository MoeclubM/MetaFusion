package modulesv2

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
	return moduleapi.Entity{ID: id, Kind: "work", Status: "published"}, nil
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
	path := "/api/v2/archive/entities/" + catalog.entity + "/resources"
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
	if w = request("/api/v2/archive/resources/"+rid+"/content", ""); w.Code != 404 {
		t.Fatal("private download leaked")
	}
	if w = request("/api/v2/archive/resources/"+rid+"/content", "test-token"); w.Code != 200 || w.Body.String() != "private recording" {
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
	if w = request("/api/v2/archive/entities/"+target+"/resources", "test-token"); !strings.Contains(w.Body.String(), rid) {
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
	if w = request("/api/v2/playback/resources/"+rid+"/content", "test-token"); w.Code != 404 {
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
