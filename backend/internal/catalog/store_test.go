package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/testutil"
	"sync"
	"testing"
)

func TestDefaultsAndDynamicFields(t *testing.T) {
	d := Defaults()
	if err := d.Validate(); err != nil {
		t.Fatal(err)
	}
	d.Types["personal_photo"] = TypeDefinition{Names: names("个人写真", "Personal photography"), Kinds: []string{"work"}, Enabled: true, Fields: []string{"language"}, Template: "photography"}
	if err := d.Validate(); err != nil {
		t.Fatal(err)
	}
	d.Fields["id"] = Field{Names: names("非法", "Invalid"), Type: "text"}
	if err := d.Validate(); err == nil {
		t.Fatal("reserved identity field accepted")
	}
}
func TestLocatorAndEvidence(t *testing.T) {
	a, b := int64(0), int64(0)
	if validateLocator(Locator{RelativeTo: "track", TimeStart: &a, TimeEnd: &b}) == nil {
		t.Fatal("empty half-open range accepted")
	}
	if validateLocator(Locator{TimeStart: &a}) == nil {
		t.Fatal("unscoped locator accepted")
	}
	if validateSources("本人首次发布", []Source{{Kind: "self", Citation: "作者自述"}}) != nil {
		t.Fatal("personal source rejected")
	}
	if validateSources("x", []Source{{Kind: "url", Citation: "x", URL: "javascript:alert(1)"}}) == nil {
		t.Fatal("unsafe URL accepted")
	}
}
func TestRelationCyclesAndContexts(t *testing.T) {
	d := Defaults()
	a, b, c := Entity{ID: "a", Kind: "work"}, Entity{ID: "b", Kind: "work"}, Entity{ID: "c", Kind: "work"}
	ref := func(string, []string) error { return nil }
	r := Relation{ID: "3", Type: "sequel_of", SourceID: "c", TargetID: "a"}
	prior := []Relation{{ID: "1", Type: "sequel_of", SourceID: "a", TargetID: "b"}, {ID: "2", Type: "sequel_of", SourceID: "b", TargetID: "c"}}
	if validateRelation(d, r, c, a, prior, ref, false) == nil {
		t.Fatal("long cycle accepted")
	}
	_ = b
	r = Relation{ID: "2", Type: "voiced_by", SourceID: "a", TargetID: "actor", Attributes: map[string]any{"character": "character2"}}
	prior = []Relation{{ID: "1", Type: "voiced_by", SourceID: "a", TargetID: "actor", Attributes: map[string]any{"character": "character1"}}}
	if err := validateRelation(d, r, a, Entity{Kind: "agent"}, prior, ref, false); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresCatalog(t *testing.T) {
	ctx := context.Background()
	s := &Store{DB: testutil.Database(t)}
	var err error
	if err = s.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	username := "admin_" + uuid.NewString()
	needed, _ := s.SetupNeeded(ctx)
	var admin User
	if needed {
		admin, err = s.CreateUser(ctx, username, username + "@example.com", "test-password-12345", true, nil)
	} else {
		err = s.DB.QueryRow("SELECT id,username,COALESCE(email,''),role FROM catalog.users WHERE role='admin' LIMIT 1").Scan(&admin.ID, &admin.Username, &admin.Email, &admin.Role)
	}
	if err != nil {
		t.Fatal(err)
	}
	sources := []Source{{Kind: "self", Citation: "isolated test fixture"}}
	save := func(e Entity) Entity {
		t.Helper()
		if e.Status == "" {
			e.Status = "published"
		}
		v, err := s.Save(ctx, Edit{Entity: e, ExpectedVersion: e.Version, EditNote: "integration fixture", Sources: sources}, admin)
		if err != nil {
			t.Fatalf("%s %s: %v", e.Kind, e.Title, err)
		}
		return v
	}
	entity := func(kind, title string) Entity {
		return Entity{Kind: kind, Title: title, Types: []string{}, Attributes: map[string]any{}, Translations: map[string]Translation{}}
	}
	song := save(entity("work", "原创歌曲"))
	album := save(entity("work", "个人专辑"))
	recording := entity("expression", "录音室版")
	recording.WorkID = song.ID
	recording = save(recording)
	release := entity("release", "普通版")
	release.Subjects = []Subject{{WorkID: album.ID, Role: "primary"}, {WorkID: song.ID, Role: "compilation", Position: 1}}
	release = save(release)
	medium := entity("medium", "CD 1")
	medium.ReleaseID = release.ID
	medium = save(medium)
	track := entity("track", "01 原创歌曲")
	track.MediumID = medium.ID
	track.Number = "A1"
	track.Contents = []Inclusion{{ExpressionID: recording.ID}}
	track = save(track)
	occurrences, err := s.Occurrences(ctx, song.ID, nil)
	if err != nil || len(occurrences) != 1 {
		t.Fatalf("reverse inclusion %v %d", err, len(occurrences))
	}
	t.Run("undeclared cross-work reference", func(t *testing.T) {
		r := entity("release", "未声明歌曲的盒装")
		r.Subjects = []Subject{{WorkID: album.ID, Role: "primary"}}
		r = save(r)
		m := entity("medium", "附盘")
		m.ReleaseID = r.ID
		m = save(m)
		tr := track
		tr.ID = ""
		tr.Version = 0
		tr.MediumID = m.ID
		if _, err := s.Save(ctx, Edit{Entity: tr, Sources: sources, EditNote: "invalid"}, admin); err == nil {
			t.Fatal("undeclared reference accepted")
		}
	})
	t.Run("same scope and hierarchy cycles", func(t *testing.T) {
		u := entity("content_unit", "第三章")
		u.WorkID = song.ID
		u = save(u)
		v := entity("content_unit", "章节组")
		v.WorkID = album.ID
		v = save(v)
		u.ParentID = v.ID
		if _, err := s.Save(ctx, Edit{Entity: u, ExpectedVersion: u.Version, Sources: sources, EditNote: "invalid"}, admin); err == nil {
			t.Fatal("cross-work parent accepted")
		}
		u.ParentID = u.ID
		if _, err := s.Save(ctx, Edit{Entity: u, ExpectedVersion: u.Version, Sources: sources, EditNote: "invalid"}, admin); err == nil {
			t.Fatal("self parent accepted")
		}
	})
	t.Run("optimistic concurrency", func(t *testing.T) {
		var wg sync.WaitGroup
		var mu sync.Mutex
		success := 0
		for i := 0; i < 2; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, err := s.Save(ctx, Edit{Entity: song, ExpectedVersion: song.Version, Sources: sources, EditNote: "race"}, admin)
				mu.Lock()
				defer mu.Unlock()
				if err == nil {
					success++
				} else if err.Error() != "version_conflict" {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		if success != 1 {
			t.Fatalf("success count=%d", success)
		}
	})
	t.Run("private catalog remains private", func(t *testing.T) {
		e := entity("work", "未公开个人作品")
		e.Status = "draft"
		e = save(e)
		if _, err := s.Get(ctx, e.ID, nil); !errors.Is(err, sql.ErrNoRows) {
			t.Fatal("draft leaked")
		}
	})
	t.Run("definition impacts and retired terms", func(t *testing.T) {
		v, err := s.Definitions(ctx)
		if err != nil {
			t.Fatal(err)
		}
		d := v.Document
		delete(d.Vocabularies["release_role"].Terms, "compilation")
		id, err := s.Draft(ctx, d, v.ID, admin, "remove used term", sources)
		if err != nil {
			t.Fatal(err)
		}
		issues, err := s.Impact(ctx, id)
		if err != nil || len(issues) == 0 {
			t.Fatal("missing impact")
		}
		if s.Publish(ctx, id, admin, "publish invalid", sources) == nil {
			t.Fatal("invalid definition published")
		}
	})
	t.Run("atomic outbox and retry", func(t *testing.T) {
		consumer := "test_" + uuid.NewString()
		first := ""
		err := s.Deliver(ctx, consumer, func(_ context.Context, e Event) error { first = e.ID; return fmt.Errorf("offline") })
		if err == nil || first == "" {
			t.Fatal("missing callback")
		}
		found := false
		if err = s.Deliver(ctx, consumer, func(_ context.Context, e Event) error {
			if e.ID == first {
				found = true
			}
			return nil
		}); err != nil || !found {
			t.Fatal("event lost after failure")
		}
		count := 0
		s.Deliver(ctx, consumer, func(context.Context, Event) error { count++; return nil })
		if count != 0 {
			t.Fatal("acknowledged event redelivered")
		}
	})
	if _, err = s.List(ctx, ListOptions{Query: "原创"}, nil); err != nil {
		t.Fatal(err)
	}
}
