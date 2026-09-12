package catalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// stubBangumi 替换 Bangumi 公开 API，覆盖 subject/person/character 三端点。
func stubBangumi(t *testing.T) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/v0/subjects/7", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":7,"type":2,"name":"テスト作品","name_cn":"测试作品","summary":"简介","date":"2024-01-05","platform":"TV","images":{"large":"https://example.com/cover.jpg"},"tags":[{"name":"日常","count":10}]}`))
	})
	mux.HandleFunc("/v0/persons/9", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":9,"name":"John Doe","name_cn":"约翰","type":1,"career":["原作"],"summary":"作家","images":{"large":"https://example.com/avatar.jpg"}}`))
	})
	mux.HandleFunc("/v0/characters/11", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":11,"name":"小鸟游","name_cn":"","summary":"角色","images":{"large":""}}`))
	})
	// 分集端点：subject 7 有两话本篇 + 一首 OP（type=2）。其它 subject 返回空列表。
	// 按 type 分别返回，覆盖"遍历多类型并按 episode id 去重"的行为。
	mux.HandleFunc("/v0/episodes", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("subject_id") != "7" {
			_, _ = w.Write([]byte(`{"data":[],"total":0}`))
			return
		}
		switch r.URL.Query().Get("type") {
		case "0":
			_, _ = w.Write([]byte(`{"data":[{"id":101,"type":0,"name":"第一话","name_cn":"第一话","sort":1,"ep":1,"duration":"24m"},{"id":102,"type":0,"name":"第二話","name_cn":"第二话","sort":2,"ep":2,"duration":"24m"}],"total":2}`))
		case "2":
			_, _ = w.Write([]byte(`{"data":[{"id":201,"type":2,"name":"オープニング","name_cn":"片头曲","sort":1,"ep":0,"duration":"1m30s"}],"total":1}`))
		default:
			_, _ = w.Write([]byte(`{"data":[],"total":0}`))
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(func() {
		srv.Close()
		bangumiAPIBase = "https://api.bgm.tv"
	})
	bangumiAPIBase = srv.URL
}

func TestImporterPreviewValidation(t *testing.T) {
	// 纯参数校验不触库：Store 为空即可。
	s := &Store{}
	ctx := context.Background()

	if _, err := s.Preview(ctx, "musicbrainz", "123", "work"); err == nil || err.Error() != "not_supported" {
		t.Fatalf("unsupported source accepted: %v", err)
	}
	if _, err := s.Preview(ctx, "tmdb", "1", "work"); err == nil || err.Error() != "not_supported" {
		t.Fatalf("unsupported source accepted: %v", err)
	}
	if _, err := s.Preview(ctx, "bangumi", "not-an-id", "work"); err == nil {
		t.Fatal("invalid bangumi id accepted")
	}
	if _, err := s.Preview(ctx, "bangumi", "7", "nope"); err == nil || err.Error() != "invalid_entity_type" {
		t.Fatalf("invalid entity type accepted: %v", err)
	}
	// 非 Bangumi 站点 URL 明确拒绝，不伪造。
	if _, err := s.Preview(ctx, "bangumi", "https://example.com/item/1", "work"); err == nil || err.Error() != "not_supported" {
		t.Fatalf("foreign url accepted: %v", err)
	}
}

func TestImporterRefParsing(t *testing.T) {
	cases := []struct {
		raw, entityType, kind string
		id                    int
	}{
		{"7", "work", "subject", 7},
		{"9", "artist", "person", 9},
		{"11", "character", "character", 11},
		{"https://bgm.tv/subject/7", "work", "subject", 7},
		{"bgm.tv/person/9", "artist", "person", 9},
		{"https://bangumi.tv/character/11", "character", "character", 11},
		{"https://bgm.tv/subject/7/ep/3", "work", "subject", 7},
	}
	for _, c := range cases {
		ref, err := resolveBangumiRef(c.raw, c.entityType)
		if err != nil || ref.Kind != c.kind || ref.ID != c.id {
			t.Fatalf("parse %q: got %+v %v", c.raw, ref, err)
		}
	}
	if _, err := parseBangumiRef(""); err == nil {
		t.Fatal("empty id accepted")
	}
	if _, err := parseBangumiRef("https://bgm.tv/subject/abc"); err == nil {
		t.Fatal("non-numeric id accepted")
	}

	// source / entity_type / link_mode 归一化。
	if src, err := normalizeImporterSource(""); err != nil || src != "bangumi" {
		t.Fatalf("default source: %q %v", src, err)
	}
	if src, err := normalizeImporterSource("AUTO"); err != nil || src != "bangumi" {
		t.Fatalf("auto source: %q %v", src, err)
	}
	if _, err := normalizeImporterSource("douban"); err == nil {
		t.Fatal("douban should be not_supported")
	}
	if et, err := normalizeImporterEntityType(""); err != nil || et != "work" {
		t.Fatalf("default entity type: %q %v", et, err)
	}
	if _, err := normalizeImporterEntityType("album"); err == nil {
		t.Fatal("album should be invalid_entity_type")
	}
	if m, err := normalizeImporterLinkMode(""); err != nil || m != "new_work" {
		t.Fatalf("default link mode: %q %v", m, err)
	}
	if _, err := normalizeImporterLinkMode("merge_everything"); err == nil {
		t.Fatal("unknown link mode accepted")
	}

	// subject type → work type 映射（Bangumi 文档：1 书籍 2 动画 3 音乐 4 游戏 6 三次元）。
	for in, want := range map[int]string{1: "novel", 2: "animation", 3: "music", 4: "indie_game", 6: "personal", 0: "", 9: ""} {
		if got := bangumiWorkType(in); got != want {
			t.Fatalf("work type %d: got %q want %q", in, got, want)
		}
	}
	for in, want := range map[int]string{1: "person", 2: "organization", 3: "group", 0: "person"} {
		if got := bangumiAgentType(in); got != want {
			t.Fatalf("agent type %d: got %q want %q", in, got, want)
		}
	}

	// 幂等键由 url_or_id 本地解析，不发网络。
	key, ok := importDedupKey("bangumi", ImporterImportRequest{URLOrID: "https://bgm.tv/subject/7"}, "work")
	if !ok || key != "bangumi:subject:7" {
		t.Fatalf("bad dedup key: %q %v", key, ok)
	}
	if kind, id := splitDedupKey(key); kind != "subject" || id != "7" {
		t.Fatalf("bad dedup split: %q %q", kind, id)
	}
	if _, ok := importDedupKey("tmdb", ImporterImportRequest{URLOrID: "1"}, "work"); ok {
		t.Fatal("non-bangumi dedup key generated")
	}

	// Import 参数校验（触库前失败，无需 DB）。
	ctx := context.Background()
	s := &Store{}
	me := User{ID: "00000000-0000-0000-0000-000000000000", Role: "admin"}
	if _, err := s.Import(ctx, ImporterImportRequest{EntityType: "work", Source: "vndb", URLOrID: "1", Work: &ImporterWorkPreview{Title: "x"}}, me); err == nil || !strings.Contains(err.Error(), "not_supported") {
		t.Fatalf("unsupported import accepted: %v", err)
	}
	if _, err := s.Import(ctx, ImporterImportRequest{EntityType: "work", Source: "bangumi", LinkMode: "bogus", Work: &ImporterWorkPreview{Title: "x"}}, me); err == nil {
		t.Fatal("invalid link mode import accepted")
	}
	if _, err := s.Import(ctx, ImporterImportRequest{EntityType: "work", Source: "bangumi", LinkMode: "append_release_to_work"}, me); err == nil {
		t.Fatal("append without target accepted")
	}
	if _, err := buildWorkEntity(&ImporterWorkPreview{}, "", "bangumi", "", "", false, ""); err == nil {
		t.Fatal("empty work title accepted")
	}
}

func TestImporterPreviewBangumi(t *testing.T) {
	stubBangumi(t)
	f := newFixture(t)
	ctx := context.Background()

	work, err := f.s.Preview(ctx, "bangumi", "https://bgm.tv/subject/7", "work")
	if err != nil {
		t.Fatal(err)
	}
	if work.Source != "bangumi" || work.EntityType != "work" || work.ExternalID != "7" || work.Work == nil {
		t.Fatalf("bad subject preview: %+v", work)
	}
	if work.Work.Title != "测试作品" || work.Work.OriginalTitle != "テスト作品" || work.MediaType != "animation" {
		t.Fatalf("bad subject mapping: %+v", work.Work)
	}
	if len(work.Work.Translations) != 2 || work.ExternalURL != "https://bgm.tv/subject/7" {
		t.Fatalf("bad subject translations/url: %+v", work.Work.Translations)
	}
	if len(work.Tags) != 1 || work.Tags[0] != "日常" {
		t.Fatalf("bad subject tags: %v", work.Tags)
	}

	person, err := f.s.Preview(ctx, "auto", "https://bgm.tv/person/9", "artist")
	if err != nil {
		t.Fatal(err)
	}
	if person.Source != "bangumi" || person.EntityType != "artist" || person.Artist == nil {
		t.Fatalf("bad person preview: %+v", person)
	}
	if person.Artist.Name != "约翰" || person.Artist.OriginalName != "John Doe" || person.Artist.EntityType != "person" {
		t.Fatalf("bad person mapping: %+v", person.Artist)
	}
	// 预览 DTO 直接装箱 Go 的 int ID；经 JSON 往返后为 float64。两种形态都应保留 ID。
	if v := person.Artist.ExternalIDs["bangumi_person"]; replayNumEqual(v, 9) == false && v != "9" {
		t.Fatalf("bad person external_ids: %v", person.Artist.ExternalIDs)
	}

	character, err := f.s.Preview(ctx, "bangumi", "https://bgm.tv/character/11", "character")
	if err != nil {
		t.Fatal(err)
	}
	if character.EntityType != "character" || character.Artist == nil || character.Artist.Name != "小鸟游" {
		t.Fatalf("bad character preview: %+v", character)
	}

	digit, err := f.s.Preview(ctx, "bangumi", "9", "artist")
	if err != nil || digit.Artist == nil || digit.EntityType != "artist" {
		t.Fatalf("numeric person id unresolved: %+v %v", digit, err)
	}
}

func TestImporterImportIdempotent(t *testing.T) {
	stubBangumi(t)
	f := newFixture(t)
	ctx := context.Background()

	req := ImporterImportRequest{
		EntityType: "work",
		Source:     "bangumi",
		URLOrID:    "https://bgm.tv/subject/7",
		Work: &ImporterWorkPreview{
			Title: "测试作品", OriginalTitle: "テスト作品",
			OriginalLanguage: "zh-CN",
			Translations:     []ImporterTranslationItem{{Locale: "zh-CN", Title: "测试作品", Summary: "简介"}},
			CatalogMetadata:  map[string]any{"bangumi_type": float64(2)},
		},
		CanonicalEntries: []ImporterCanonicalEntryPreview{
			{Title: "第一话", Position: 1},
			{Title: "第二话", Position: 2},
		},
		Release:  &ImporterReleasePreview{EditionName: "初回版", EditionDate: "2024-01-05", Country: "JP"},
		Mediums:  []ImporterMediumPreview{{Position: 0, Name: "Disc 1", Format: "bd", Role: "primary", Tracks: []ImporterTrackPreview{{Position: 1, Title: "第一话"}, {Position: 2, Title: "第二话"}}}},
		EditNote: "导入测试",
		SourceURLs: []string{
			"https://bgm.tv/subject/7",
		},
	}
	first, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Success || first.WorkID == "" || first.ReleaseID == "" {
		t.Fatalf("bad import result: %+v", first)
	}
	if first.ImportedCounts.Mediums != 1 || first.ImportedCounts.Tracks != 2 {
		t.Fatalf("bad imported counts: %+v", first.ImportedCounts)
	}
	if first.RedirectURL != "/releases/"+first.ReleaseID {
		t.Fatalf("bad redirect url: %s", first.RedirectURL)
	}

	before := len(mustList(t, f, ListOptions{Kind: "work"}))
	second, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatal(err)
	}
	if second.WorkID != first.WorkID {
		t.Fatalf("idempotency broken: %s != %s", second.WorkID, first.WorkID)
	}
	if after := len(mustList(t, f, ListOptions{Kind: "work"})); after != before {
		t.Fatalf("duplicate work created: %d -> %d", before, after)
	}

	// append_release_to_work 挂靠已有 work，只建发行链。
	req2 := req
	req2.LinkMode = "append_release_to_work"
	req2.TargetWorkID = first.WorkID
	req2.Mediums = []ImporterMediumPreview{{Position: 0, Name: "Disc 2", Format: "dvd", Tracks: []ImporterTrackPreview{{Position: 1, Title: "第一话"}}}}
	appended, err := f.s.Import(ctx, req2, f.u)
	if err != nil {
		t.Fatal(err)
	}
	if appended.WorkID != first.WorkID || appended.ReleaseID == first.ReleaseID {
		t.Fatalf("bad append result: %+v", appended)
	}
	if appended.RedirectURL != "/releases/"+appended.ReleaseID {
		t.Fatalf("bad append redirect: %s", appended.RedirectURL)
	}

	// agent 幂等。
	agentReq := ImporterImportRequest{
		EntityType: "artist", Source: "bangumi", URLOrID: "https://bgm.tv/person/9",
		Artist:   &ImporterArtistPreview{Name: "约翰", OriginalName: "John Doe", EntityType: "person"},
		EditNote: "导入测试", SourceURLs: []string{"https://bgm.tv/person/9"},
	}
	a1, err := f.s.Import(ctx, agentReq, f.u)
	if err != nil {
		t.Fatal(err)
	}
	a2, err := f.s.Import(ctx, agentReq, f.u)
	if err != nil {
		t.Fatal(err)
	}
	if a1.ArtistID == "" || a2.ArtistID != a1.ArtistID || a1.RedirectURL != "/artists/"+a1.ArtistID {
		t.Fatalf("agent idempotency broken: %+v %+v", a1, a2)
	}

	// 不支持的来源明确报错。
	if _, err := f.s.Import(ctx, ImporterImportRequest{EntityType: "work", Source: "tmdb", URLOrID: "1", Work: &ImporterWorkPreview{Title: "x"}}, f.u); err == nil || !strings.Contains(err.Error(), "not_supported") {
		t.Fatalf("unsupported import accepted: %v", err)
	}
}

func mustList(t *testing.T, f fixture, o ListOptions) []Entity {
	t.Helper()
	items, err := f.s.List(context.Background(), o, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

// TestImporterImportMultiDiscExpressionMatching：多盘发行的表达对齐。
// 跨盘同轨号不再误判为同一内容；同一份载荷内声明的 canonical 表达按唯一同名绑定；
// 曲目携带的 ISRC 落录音本体（expression.external_ids），不写 track.attributes。
func TestImporterImportMultiDiscExpressionMatching(t *testing.T) {
	stubBangumi(t)
	f := newFixture(t)
	ctx := context.Background()

	req := ImporterImportRequest{
		EntityType: "work",
		Source:     "bangumi",
		URLOrID:    "https://bgm.tv/subject/7",
		Work: &ImporterWorkPreview{
			Title:           "多盘作品",
			OriginalTitle:   "テスト作品",
			OriginalLanguage: "zh-CN",
			CatalogMetadata: map[string]any{"bangumi_type": float64(2)},
		},
		CanonicalEntries: []ImporterCanonicalEntryPreview{
			{Title: "夜航", Position: 1},
			{Title: "星海", Position: 2},
		},
		Release: &ImporterReleasePreview{EditionName: "双盘限定"},
		Mediums: []ImporterMediumPreview{
			{Position: 0, Name: "Disc 1", Format: "cd", Tracks: []ImporterTrackPreview{
				{Position: 1, Title: "夜航"},
				{Position: 2, Title: "星海"},
			}},
			{Position: 1, Name: "Disc 2", Format: "bd", Tracks: []ImporterTrackPreview{
				// 轨号与 Disc 1 Track 1 相同，但内容不同：不得复用"夜航"的表达。
				{Position: 1, Title: "幕间映像", ISRC: "JPB992600010"},
				// 同名曲跨盘收录：应复用"夜航"的既有表达。
				{Position: 2, Title: "夜航", RecordingMBID: "rec-1"},
			}},
		},
		EditNote:   "多盘对齐测试",
		SourceURLs: []string{"https://bgm.tv/subject/7"},
	}
	out, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatal(err)
	}
	if !out.Success || out.ReleaseID == "" {
		t.Fatalf("bad import result: %+v", out)
	}
	if out.ImportedCounts.Mediums != 2 || out.ImportedCounts.Tracks != 4 {
		t.Fatalf("bad imported counts: %+v", out.ImportedCounts)
	}

	exprs := mustList(t, f, ListOptions{Kind: "expression", WorkID: out.WorkID})
	if len(exprs) != 3 {
		t.Fatalf("expected 3 expressions, got %d", len(exprs))
	}
	exprIDByTitle := map[string]string{}
	for _, e := range exprs {
		exprIDByTitle[e.Title] = e.ID
	}

	// track 属于 medium（release→medium→track 两级）：List 的 ReleaseID 过滤只命中
	// mediums 表，须先列载体再按 MediumID 查曲目。
	meds := mustList(t, f, ListOptions{Kind: "medium", ReleaseID: out.ReleaseID})
	if len(meds) != 2 {
		t.Fatalf("expected 2 mediums, got %d", len(meds))
	}
	var tracks []Entity
	for _, m := range meds {
		trs := mustList(t, f, ListOptions{Kind: "track", MediumID: m.ID})
		tracks = append(tracks, trs...)
	}
	if len(tracks) != 4 {
		t.Fatalf("expected 4 tracks, got %d", len(tracks))
	}
	exprOf := map[string]string{}
	for _, tr := range tracks {
		full, err := f.s.Get(ctx, tr.ID, &f.u)
		if err != nil {
			t.Fatal(err)
		}
		if len(full.Contents) != 1 {
			t.Fatalf("track %q has %d contents, want 1", full.Title, len(full.Contents))
		}
		exprOf[full.Title] = full.Contents[0].ExpressionID
		// ISRC 属于录音本体，不再写进 track.attributes（track 定义只有 duration/role）。
		if _, ok := full.Attributes["isrc"]; ok {
			t.Fatalf("ISRC must not be stored on track.attributes: %v", full.Attributes)
		}
	}
	// 跨盘同名曲复用同一表达。
	if exprOf["夜航"] == "" || exprOf["夜航"] != exprIDByTitle["夜航"] {
		t.Fatalf("Disc2 夜航 did not reuse canonical expression: %q vs %q", exprOf["夜航"], exprIDByTitle["夜航"])
	}
	if exprOf["幕间映像"] == exprIDByTitle["夜航"] {
		t.Fatal("Disc2 Track 1 wrongly reused Disc1 Track 1 expression by position")
	}
	if exprOf["幕间映像"] != exprIDByTitle["幕间映像"] {
		t.Fatalf("幕间映像 linked to unexpected expression: %q", exprOf["幕间映像"])
	}
	// ISRC 应落在新建表达的 external_ids 上，供后续权威匹配复用。
	for _, e := range exprs {
		if e.Title != "幕间映像" {
			continue
		}
		if e.ExternalIDs["isrc"] != "JPB992600010" {
			t.Fatalf("ISRC not stored on expression external_ids: %v", e.ExternalIDs)
		}
	}
}

// TestImporterPreviewEpisodes：动画条目预览应带分集 canonical entries
// （entry_kind=content_unit、带官方集号与来源时长），无分集的条目为空。
// Preview 只走上游 HTTP、不触库，因此无需数据库夹具。
func TestImporterPreviewEpisodes(t *testing.T) {
	stubBangumi(t)
	s := &Store{}
	ctx := context.Background()

	work, err := s.Preview(ctx, "bangumi", "7", "work")
	if err != nil {
		t.Fatal(err)
	}
	if len(work.CanonicalEntries) != 3 {
		t.Fatalf("expected 3 episode entries (2 main + 1 OP), got %d", len(work.CanonicalEntries))
	}
	first := work.CanonicalEntries[0]
	if first.EntryKind != "content_unit" || first.Number != "1" || first.Title != "第一话" {
		t.Fatalf("bad episode entry: %+v", first)
	}
	if first.DurationSeconds != 24*60 {
		t.Fatalf("episode duration not parsed: %v", first.DurationSeconds)
	}
	if work.CanonicalEntries[1].Number != "2" {
		t.Fatalf("second episode number wrong: %+v", work.CanonicalEntries[1])
	}
	// OP（type=2）不应被 type=0 的固定查询漏掉，role 应映射为非本篇。
	var op *ImporterCanonicalEntryPreview
	for i := range work.CanonicalEntries {
		if work.CanonicalEntries[i].ExternalIDs["bangumi_episode"] == 201 {
			op = &work.CanonicalEntries[i]
		}
	}
	if op == nil {
		t.Fatal("OP episode (type=2) missing from preview")
	}
	if op.EntryRole == "main" {
		t.Fatalf("OP episode role should not be main: %+v", op)
	}
}

// TestImporterImportEpisodeTree：分集导入应落 ContentUnit 树并通过 work_id 归属，
// 且曲目命中篇目标题时表达挂到该单元下；重复导入不重复建篇目。
func TestImporterImportEpisodeTree(t *testing.T) {
	stubBangumi(t)
	f := newFixture(t)
	ctx := context.Background()

	work, err := f.s.Preview(ctx, "bangumi", "7", "work")
	if err != nil {
		t.Fatal(err)
	}
	req := ImporterImportRequest{
		EntityType: "work",
		Source:     "bangumi",
		URLOrID:    "https://bgm.tv/subject/7",
		Work: &ImporterWorkPreview{
			Title: "测试作品", OriginalTitle: "テスト作品", OriginalLanguage: "ja",
			CatalogMetadata: map[string]any{"bangumi_type": float64(2)},
		},
		// 无 Mediums：只建章节树，验证 content_unit 归属。
		CanonicalEntries: work.CanonicalEntries,
		EditNote:         "分集导入测试",
		SourceURLs:       []string{"https://bgm.tv/subject/7"},
	}
	out, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatal(err)
	}
	if out.ImportedCounts.ContentUnits != 3 {
		t.Fatalf("expected 3 content units (2 main + 1 OP), got %d", out.ImportedCounts.ContentUnits)
	}
	units := mustList(t, f, ListOptions{Kind: "content_unit", WorkID: out.WorkID})
	if len(units) != 3 {
		t.Fatalf("expected 3 content units in store, got %d", len(units))
	}
	for _, u := range units {
		if u.WorkID != out.WorkID {
			t.Fatalf("content unit not scoped to work: %+v", u)
		}
	}
	// 重复导入：篇目按来源 ID 复用，不重复建。
	again, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatal(err)
	}
	if again.WorkID != out.WorkID {
		t.Fatalf("idempotency broken: %s != %s", again.WorkID, out.WorkID)
	}
	if n := len(mustList(t, f, ListOptions{Kind: "content_unit", WorkID: out.WorkID})); n != 3 {
		t.Fatalf("duplicate content units created: %d", n)
	}
}
