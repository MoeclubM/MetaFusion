package catalogv2

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/testutil"
)

type fixture struct {
	t *testing.T
	s *Store
	u User
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	s := &Store{DB: testutil.Database(t)}
	if err := s.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	u, err := s.CreateUser(context.Background(), "fixture-admin", "fixture-admin@example.com", "fixture-password-123", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	return fixture{t, s, u}
}
func (f fixture) save(e Entity) Entity {
	f.t.Helper()
	if e.Status == "" {
		e.Status = "published"
	}
	// Match HTTP decoding for dynamic JSON values.
	var copy Entity
	if err := json.Unmarshal([]byte(encode(e)), &copy); err != nil {
		f.t.Fatal(err)
	}
	out, err := f.s.Save(context.Background(), Edit{Entity: copy, ExpectedVersion: e.Version, EditNote: "acceptance fixture", Sources: fixtureSources()}, f.u)
	if err != nil {
		f.t.Fatalf("save %s: %v", e.Title, err)
	}
	return out
}
func fixtureSources() []Source {
	return []Source{{Kind: "self", Citation: "isolated acceptance fixture"}}
}
func (f fixture) publish(d Definitions, base int64) {
	f.t.Helper()
	id, err := f.s.Draft(context.Background(), d, base, f.u, "configure fixture", fixtureSources())
	if err != nil {
		f.t.Fatal(err)
	}
	if err := f.s.Publish(context.Background(), id, f.u, "publish fixture", fixtureSources()); err != nil {
		f.t.Fatal(err)
	}
}

func TestPostgresDynamicDefinitions(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	v, _ := f.s.Definitions(ctx)
	d := v.Document
	d.Vocabularies["custom_format"] = Vocabulary{Names: names("新增介质", "New formats"), Terms: map[string]Term{"cassette": {Names: names("磁带", "Cassette"), Enabled: true}}}
	d.Fields["custom_format"] = Field{Names: names("新增格式", "Custom format"), Type: "enum", Vocabulary: "custom_format", Enabled: true, Searchable: true, Comparable: true}
	d.Types["custom"] = TypeDefinition{Names: names("自定义类型", "Custom type"), Kinds: []string{"work"}, Fields: []string{"custom_format", "language"}, Template: "photography", Enabled: true}
	d.Relations["edited_by"] = RelationDefinition{Names: names("编辑", "Edited by"), ReverseNames: names("编辑了", "Editor of"), SourceKinds: []string{"work"}, TargetKinds: []string{"agent"}, Fields: []string{"context", "character", "language"}, Enabled: true}
	f.publish(d, v.ID)
	w := f.save(Entity{Kind: "work", Title: "个人影像集", Types: []string{"custom", "personal"}, Attributes: map[string]any{"custom_format": "cassette", "language": "ja"}})
	if items, err := f.s.List(ctx, ListOptions{Field: "custom_format", Value: "cassette"}, nil); err != nil || len(items) != 1 {
		t.Fatalf("dynamic filter: %v %d", err, len(items))
	}
	actor := f.save(Entity{Kind: "agent", Title: "演职人员", Types: []string{"person"}})
	for _, character := range []string{"角色一", "角色二"} {
		c := f.save(Entity{Kind: "agent", Title: character, Types: []string{"character"}})
		_, err := f.s.SaveRelation(ctx, RelationEdit{Relation: Relation{Type: "edited_by", SourceID: w.ID, TargetID: actor.ID, Attributes: map[string]any{"character": c.ID, "language": "zh-CN", "context": w.ID}}, EditNote: "role fixture", Sources: fixtureSources()}, f.u)
		if err != nil {
			t.Fatal(err)
		}
	}
	if relations, err := f.s.Relations(ctx, w.ID, nil); err != nil || len(relations) != 2 {
		t.Fatalf("multiple roles: %v %d", err, len(relations))
	}
	v, _ = f.s.Definitions(ctx)
	d = v.Document
	term := d.Vocabularies["custom_format"].Terms["cassette"]
	term.Enabled = false
	d.Vocabularies["custom_format"].Terms["cassette"] = term
	typ := d.Types["custom"]
	typ.Enabled = false
	d.Types["custom"] = typ
	f.publish(d, v.ID)
	w.Attributes["language"] = "en-US"
	w = f.save(w)
	if w.Attributes["custom_format"] != "cassette" {
		t.Fatal("retired term lost during unrelated edit")
	}
	if _, err := f.s.Save(ctx, Edit{Entity: Entity{Kind: "work", Title: "invalid reuse", Status: "draft", Types: []string{"custom"}}, Sources: fixtureSources(), EditNote: "invalid"}, f.u); err == nil {
		t.Fatal("retired type reused")
	}
	v, _ = f.s.Definitions(ctx)
	delete(v.Document.Types, "custom")
	id, err := f.s.Draft(ctx, v.Document, v.ID, f.u, "remove used type", fixtureSources())
	if err != nil {
		t.Fatal(err)
	}
	if err = f.s.Publish(ctx, id, f.u, "invalid publish", fixtureSources()); err == nil {
		t.Fatal("referenced type deleted")
	}
}

func TestPostgresEditReviewAndVersions(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	editor, err := f.s.CreateUser(ctx, "fixture-editor", "fixture-editor@example.com", "fixture-editor-pass", false, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	for _, typ := range []string{"photobook", "indie_game", "song"} {
		e, err := f.s.Save(ctx, Edit{Entity: Entity{Kind: "work", Title: typ, Status: "draft", Types: []string{typ, "personal"}}, EditNote: "author draft", Sources: fixtureSources()}, editor)
		if err != nil {
			t.Fatal(err)
		}
		e.Title += " revised"
		e.Status = "pending_review"
		e, err = f.s.Save(ctx, Edit{Entity: e, ExpectedVersion: e.Version, EditNote: "submit author draft", Sources: fixtureSources()}, editor)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.s.Get(ctx, e.ID, nil); err == nil {
			t.Fatal("pending draft publicly visible")
		}
		e.Status = "published"
		e = f.save(e)
		if _, err = f.s.Get(ctx, e.ID, nil); err != nil {
			t.Fatal(err)
		}
		revisions, err := f.s.Revisions(ctx, e.ID, &f.u)
		if err != nil || len(revisions) != 3 {
			t.Fatalf("revision history: %v %d", err, len(revisions))
		}
		publicHistory, err := f.s.Revisions(ctx, e.ID, nil)
		if err != nil || len(publicHistory) != 1 {
			t.Fatal("unpublished revisions leaked to the public")
		}
	}
	items, err := f.s.List(ctx, ListOptions{Status: "pending_review"}, &f.u)
	if err != nil || len(items) != 0 {
		t.Fatalf("review queue: %v", err)
	}
}

func TestPostgresReleaseComparisonAndReuse(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	song := f.save(Entity{Kind: "work", Title: "Song", Types: []string{"song"}})
	album := f.save(Entity{Kind: "work", Title: "Album", Types: []string{"album"}})
	mv := f.save(Entity{Kind: "work", Title: "Music video", Types: []string{"film"}})
	x := f.save(Entity{Kind: "expression", Title: "Recording", WorkID: song.ID, Types: []string{"expression"}})
	mvx := f.save(Entity{Kind: "expression", Title: "Video", WorkID: mv.ID})
	ids := []string{}
	for i, name := range []string{"Standard", "Limited", "Regional"} {
		r := f.save(Entity{Kind: "release", Title: name, Types: []string{"release"}, Subjects: []Subject{{WorkID: album.ID, Role: "primary"}, {WorkID: song.ID, Role: "compilation", Position: 1}, {WorkID: mv.ID, Role: "supplement", Position: 2}}, Attributes: map[string]any{"packaging": "box", "attachments": []any{map[string]any{"label": map[string]any{"en-US": "Booklet", "zh-CN": "小册子"}}}, "store_bonuses": []any{map[string]any{"label": map[string]any{"en-US": "Shop card", "zh-CN": "店铺卡片"}}}}})
		ids = append(ids, r.ID)
		m := f.save(Entity{Kind: "medium", Title: "CD", ReleaseID: r.ID, Types: []string{"medium"}, Attributes: map[string]any{"format": "cd"}})
		f.save(Entity{Kind: "track", Title: "Song", MediumID: m.ID, Number: "A1", Contents: []Inclusion{{ExpressionID: x.ID}}})
		if i == 1 {
			bd := f.save(Entity{Kind: "medium", Title: "Bonus BD", ReleaseID: r.ID, Types: []string{"medium"}, Attributes: map[string]any{"format": "bd", "role": "supplement"}})
			f.save(Entity{Kind: "track", Title: "MV", MediumID: bd.ID, Contents: []Inclusion{{ExpressionID: mvx.ID}}})
		}
		if i == 2 {
			for j := 1; j <= 100; j++ {
				f.save(Entity{Kind: "track", Title: fmt.Sprintf("Chapter %d", j), MediumID: m.ID, Position: j})
			}
		}
	}
	occ, err := f.s.Occurrences(ctx, x.ID, nil)
	if err != nil || len(occ) != 3 {
		t.Fatalf("reuse: %v %d", err, len(occ))
	}
	comparison, err := f.s.Compare(ctx, ids, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(comparison[1]["media"].([]map[string]any)) != 2 {
		t.Fatal("CD and BD not preserved")
	}
	last := comparison[2]["media"].([]map[string]any)[0]["tracks"].([]Entity)
	if len(last) != 101 {
		t.Fatalf("directory truncated: %d", len(last))
	}
}

func TestPostgresHTTPSession(t *testing.T) {
	f := newFixture(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	HTTP{Store: f.s}.Register(r)
	request := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		return res
	}
	login := request("POST", "/api/v2/auth/login", `{"username":"fixture-admin","password":"fixture-password-123"}`, nil)
	if login.Code != 200 {
		t.Fatal(login.Body.String())
	}
	cookies := login.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("session cookie protection missing")
	}
	if res := request("GET", "/api/v2/auth/me", "", cookies[0]); res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	if res := request("POST", "/api/v2/auth/logout", `{}`, cookies[0]); res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	if res := request("GET", "/api/v2/auth/me", "", cookies[0]); res.Code != 401 {
		t.Fatal("logged-out session accepted")
	}
	if res := request("POST", "/api/v2/auth/login", `{"username":"fixture-admin","password":"fixture-password-123"} {}`, nil); res.Code != 400 {
		t.Fatal("trailing JSON accepted")
	}
}
