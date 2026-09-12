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
	d := Defaults()
	ref := func(string, []string) error { return nil }
	// 动态组校验：有定位键却缺锚点（relative_to）必须拒绝
	if err := d.value(d.Fields["locator"], map[string]any{"page_start": float64(1)}, ref, false); err == nil {
		t.Fatal("locator without anchor accepted")
	}
	// 起止顺序颠倒必须拒绝
	if err := d.value(d.Fields["locator"], map[string]any{"relative_to": "track", "time_start_ms": float64(500), "time_end_ms": float64(100)}, ref, false); err == nil {
		t.Fatal("reversed range accepted")
	}
	// 正常定位应通过
	if err := d.value(d.Fields["locator"], map[string]any{"relative_to": "track", "time_start_ms": float64(0), "time_end_ms": float64(500)}, ref, false); err != nil {
		t.Fatalf("valid locator rejected: %v", err)
	}
	// 空定位合法（整轨收录）
	if err := d.value(d.Fields["locator"], map[string]any{}, ref, false); err != nil {
		t.Fatalf("empty locator rejected: %v", err)
	}
	// 未声明的定位键必须拒绝（说明键集合由 definitions 决定，不是硬编码）
	if err := d.value(d.Fields["locator"], map[string]any{"relative_to": "track", "no_such_key": float64(1)}, ref, false); err == nil {
		t.Fatal("undeclared locator key accepted")
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
		admin, err = s.CreateUser(ctx, username, username+"@example.com", "test-password-12345", true, nil)
	} else {
		err = s.DB.QueryRow("SELECT id,username,COALESCE(email,''),role FROM auth.users WHERE role='admin' LIMIT 1").Scan(&admin.ID, &admin.Username, &admin.Email, &admin.Role)
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

// 定位方案与记录级属性全部由 definitions 决定，键集合不硬编码：
// 后台给 locator 组加一个子字段后，无需改代码/迁移即可通过校验。
func TestLocatorKeysAreDefinitionsDriven(t *testing.T) {
	d := Defaults()
	ref := func(string, []string) error { return nil }
	// 默认不含 spindel 键 → 拒绝
	if err := d.value(d.Fields["locator"], map[string]any{"relative_to": "track", "spindle": "A"}, ref, false); err == nil {
		t.Fatal("undeclared locator key accepted before extending definitions")
	}
	// 在 definitions 里加子字段后即可通过（模拟后台扩展）
	loc := d.Fields["locator"]
	loc.Fields["spindle"] = Field{Names: names("盘面", "Spindle"), Type: "text", Enabled: true}
	d.Fields["locator"] = loc
	if err := d.value(d.Fields["locator"], map[string]any{"relative_to": "track", "spindle": "A"}, ref, false); err != nil {
		t.Fatalf("extended locator key rejected: %v", err)
	}
}

// 记录级附加属性：默认不允许未知字段，后台加子字段后放行。
func TestStructuralAttributesAreDefinitionsDriven(t *testing.T) {
	d := Defaults()
	ref := func(string, []string) error { return nil }
	if err := d.value(d.Fields["inclusion_attributes"], map[string]any{"note": "x"}, ref, false); err == nil {
		t.Fatal("undeclared inclusion attribute accepted")
	}
	f := d.Fields["inclusion_attributes"]
	f.Fields["note"] = Field{Names: names("备注", "Note"), Type: "text", Enabled: true}
	d.Fields["inclusion_attributes"] = f
	if err := d.value(d.Fields["inclusion_attributes"], map[string]any{"note": "x"}, ref, false); err != nil {
		t.Fatalf("extended inclusion attribute rejected: %v", err)
	}
	// 发行对象附加属性同理
	if err := d.value(d.Fields["subject_attributes"], map[string]any{"seq": float64(1)}, ref, false); err == nil {
		t.Fatal("undeclared subject attribute accepted")
	}
}

// number 校验必须同时接受 JSON 的 float64 与代码内部构造的 int/int64。
func TestNumberAcceptsGoInts(t *testing.T) {
	d := Defaults()
	ref := func(string, []string) error { return nil }
	f := Field{Names: names("数量", "Qty"), Type: "number", Enabled: true}
	for _, v := range []any{float64(3), int(3), int64(3)} {
		if err := d.value(f, v, ref, false); err != nil {
			t.Errorf("%T value rejected: %v", v, err)
		}
	}
}

// 模板用 primary_date_field 声明主日期字段，取代代码里硬编码 edition_date。
func TestTemplateDeclaresPrimaryDateField(t *testing.T) {
	d := Defaults()
	if got := d.Templates["music"].PrimaryDateField; got != "edition_date" {
		t.Errorf("music primary date field = %q", got)
	}
	// 声明必须指向真实存在的字段，否则展示层会取到空值
	for code, tpl := range d.Templates {
		if tpl.PrimaryDateField == "" {
			continue
		}
		if _, ok := d.Fields[tpl.PrimaryDateField]; !ok {
			t.Errorf("template %s declares unknown field %q", code, tpl.PrimaryDateField)
		}
	}
}

// 模板声明的 badge_fields / primary_date_field 必须指向真实字段，
// 否则展示层静默取空；后台写错声明应在保存 draft 时就被拒绝。
func TestTemplateFieldReferencesValidated(t *testing.T) {
	d := Defaults()
	if err := d.Validate(); err != nil {
		t.Fatalf("defaults invalid: %v", err)
	}
	bad := Defaults()
	bad.Templates["music"] = Template{
		Names: names("音乐", "Music"), Directory: "tree",
		BadgeFields: []string{"no_such_field"},
	}
	if err := bad.Validate(); err == nil {
		t.Fatal("template with unknown badge field accepted")
	}
	bad2 := Defaults()
	bad2.Templates["music"] = Template{
		Names: names("音乐", "Music"), Directory: "tree",
		PrimaryDateField: "no_such_field",
	}
	if err := bad2.Validate(); err == nil {
		t.Fatal("template with unknown primary date field accepted")
	}
}

// 三层角色发布权限矩阵：user（审核制）/ editor（可发布自己条目）/ admin。
func TestRolePublishMatrix(t *testing.T) {
	ctx := context.Background()
	s := &Store{DB: testutil.Database(t)}
	if err := s.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	sources := []Source{{Kind: "self", Citation: "role matrix fixture"}}
	admin, err := s.CreateUserWithRole(ctx, "matrix-admin", "", "test-password-12345", true, "admin", nil)
	if err != nil {
		t.Fatal(err)
	}
	editor, err := s.CreateUserWithRole(ctx, "matrix-editor", "", "test-password-12345", false, "editor", &admin)
	if err != nil {
		t.Fatal(err)
	}
	member, err := s.CreateUserWithRole(ctx, "matrix-user", "", "test-password-12345", false, "user", &admin)
	if err != nil {
		t.Fatal(err)
	}

	mk := func(title string) Entity {
		return Entity{Kind: "work", Types: []string{"novel"}, Title: title,
			OriginalLanguage: "ja", Translations: map[string]Translation{"ja": {Title: title}}}
	}

	// user 新建只能 draft/pending_review，不能直接 published。
	for _, st := range []string{"draft", "pending_review"} {
		e := mk("user-" + st)
		e.Status = st
		if _, err := s.Save(ctx, Edit{Entity: e, EditNote: "n", Sources: sources}, member); err != nil {
			t.Fatalf("user create %s: %v", st, err)
		}
	}
	if _, err := s.Save(ctx, Edit{Entity: func() Entity { e := mk("user-published"); e.Status = "published"; return e }(), EditNote: "n", Sources: sources}, member); err == nil {
		t.Fatal("user direct publish must be forbidden")
	}

	// editor 新建可直接 published。
	pub := mk("editor-published")
	pub.Status = "published"
	saved, err := s.Save(ctx, Edit{Entity: pub, EditNote: "n", Sources: sources}, editor)
	if err != nil {
		t.Fatalf("editor direct publish: %v", err)
	}

	// editor 可继续编辑自己的已发布条目（version 递增），但不可降级状态。
	saved.Title = "editor-published-v2"
	if _, err := s.Save(ctx, Edit{Entity: saved, ExpectedVersion: saved.Version, EditNote: "n", Sources: sources}, editor); err != nil {
		t.Fatalf("editor edit own published: %v", err)
	}
	demoted := saved
	demoted.Status = "draft"
	if _, err := s.Save(ctx, Edit{Entity: demoted, ExpectedVersion: saved.Version + 1, EditNote: "n", Sources: sources}, editor); err == nil {
		t.Fatal("published demotion must hit use_lifecycle_endpoint")
	}

	// 他人条目：user/editor 均不可改（admin 除外）。
	foreign := mk("foreign-entity")
	foreign.Status = "draft"
	foreignSaved, err := s.Save(ctx, Edit{Entity: foreign, EditNote: "n", Sources: sources}, editor)
	if err != nil {
		t.Fatal(err)
	}
	foreignSaved.Title = "hijacked"
	if _, err := s.Save(ctx, Edit{Entity: foreignSaved, ExpectedVersion: foreignSaved.Version, EditNote: "n", Sources: sources}, member); err == nil {
		t.Fatal("user editing foreign entity must be forbidden")
	}

	// user 提交审核后，admin 可发布。
	review := mk("user-submitted")
	review.Status = "pending_review"
	submitted, err := s.Save(ctx, Edit{Entity: review, EditNote: "n", Sources: sources}, member)
	if err != nil {
		t.Fatal(err)
	}
	submitted.Status = "published"
	if _, err := s.Save(ctx, Edit{Entity: submitted, ExpectedVersion: submitted.Version, EditNote: "n", Sources: sources}, admin); err != nil {
		t.Fatalf("admin publish pending_review: %v", err)
	}
}

// TestExpressionDetailsBatch：批量上屏端点与单条端点语义一致——
// 表达实体、同 Work 收录、首个署名标题都应命中；不存在/不可见 ID 不返回。
func TestExpressionDetailsBatch(t *testing.T) {
	ctx := context.Background()
	s := &Store{DB: testutil.Database(t)}
	if err := s.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	username := "batch_" + uuid.NewString()
	if _, err := s.CreateUser(ctx, username, username+"@example.com", "test-password-12345", true, nil); err != nil {
		t.Fatal(err)
	}
	var admin User
	if err := s.DB.QueryRow("SELECT id,username,COALESCE(email,''),role FROM auth.users WHERE username=$1", username).Scan(&admin.ID, &admin.Username, &admin.Email, &admin.Role); err != nil {
		t.Fatal(err)
	}
	sources := []Source{{Kind: "self", Citation: "batch fixture"}}
	save := func(e Entity) Entity {
		t.Helper()
		if e.Status == "" {
			e.Status = "published"
		}
		v, err := s.Save(ctx, Edit{Entity: e, ExpectedVersion: e.Version, EditNote: "batch fixture", Sources: sources}, admin)
		if err != nil {
			t.Fatalf("%s %s: %v", e.Kind, e.Title, err)
		}
		return v
	}
	entity := func(kind, title string) Entity {
		return Entity{Kind: kind, Title: title, Types: []string{}, Attributes: map[string]any{}, Translations: map[string]Translation{}}
	}
	song := save(entity("work", "批量歌曲"))
	album := save(entity("work", "批量专辑"))
	rec := entity("expression", "批量录音")
	rec.WorkID = song.ID
	rec = save(rec)
	rel := entity("release", "批量发行")
	rel.Subjects = []Subject{{WorkID: album.ID, Role: "primary"}, {WorkID: song.ID, Role: "compilation", Position: 1}}
	rel = save(rel)
	med := entity("medium", "CD 1")
	med.ReleaseID = rel.ID
	med = save(med)
	tr := entity("track", "01 批量歌曲")
	tr.MediumID = med.ID
	tr.Contents = []Inclusion{{ExpressionID: rec.ID}}
	tr = save(tr)
	// 署名：表达 → 人员。
	actor := save(entity("agent", "批量演唱者"))
	if _, err := s.SaveRelation(ctx, RelationEdit{
		Relation: Relation{Type: "performed_by", SourceID: rec.ID, TargetID: actor.ID, Attributes: map[string]any{}},
		EditNote: "batch fixture", Sources: sources,
	}, admin); err != nil {
		t.Fatal(err)
	}

	out, err := s.ExpressionDetailsBatch(ctx, []string{rec.ID, "00000000-0000-0000-0000-000000000000"}, &admin)
	if err != nil {
		t.Fatal(err)
	}
	d, ok := out[rec.ID]
	if !ok {
		t.Fatalf("batch missing requested expression: %+v", out)
	}
	if d.Entity.Title != "批量录音" {
		t.Fatalf("bad entity: %+v", d.Entity)
	}
	if len(d.Occurrences) != 1 {
		t.Fatalf("expected 1 occurrence, got %d", len(d.Occurrences))
	}
	if d.Occurrences[0]["release"].(Entity).ID != rel.ID {
		t.Fatalf("occurrence release mismatch: %+v", d.Occurrences[0])
	}
	if d.CreditTitle != "批量演唱者" {
		t.Fatalf("credit not aggregated: %q", d.CreditTitle)
	}
	if _, present := out["00000000-0000-0000-0000-000000000000"]; present {
		t.Fatal("nonexistent id returned in batch")
	}
}
