package catalog

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"testing"
)

// This test server must be disposable: each fixture replaces the test index.
func useTestSearch(t *testing.T, s *Store) {
	t.Helper()
	raw := os.Getenv("MF_OPENSEARCH_TEST_URL")
	if raw == "" {
		t.Skip("MF_OPENSEARCH_TEST_URL must identify an isolated OpenSearch test server")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		t.Fatal("OpenSearch integration tests require a disposable loopback server")
	}
	c, err := NewOpenSearchClient(raw, "", "")
	if err != nil {
		t.Fatal(err)
	}
	status, _, err := c.request(context.Background(), http.MethodDelete, "/"+openSearchIndex, nil, "")
	if err != nil || (status != http.StatusOK && status != http.StatusNotFound) {
		t.Fatalf("reset isolated test index: status=%d err=%v", status, err)
	}
	s.OpenSearch = c
	if err := s.syncOpenSearch(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestOpenSearchIntegrationPaginationAndVisibility(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	a := f.save(Entity{Kind: "work", Title: "検索 Alpha", Attributes: map[string]any{"tags": []string{"search-tag"}}, OriginalLanguage: "ja", Translations: map[string]Translation{"ja": {Title: "検索 Alpha"}, "en-US": {Title: "Alpha"}}})
	f.save(Entity{Kind: "work", Title: "検索 Beta"})
	hidden := f.save(Entity{Kind: "work", Title: "検索 Hidden", Status: "draft"})
	useTestSearch(t, f.s)
	o := ListOptions{Query: "検索", Limit: 1, Sort: "created_at", Order: "asc"}
	page, err := f.s.Search(ctx, o, nil, "")
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].ID != a.ID || !page.HasMore || page.NextCursor == "" {
		t.Fatalf("first page: %+v err=%v", page, err)
	}
	second, err := f.s.Search(ctx, o, nil, page.NextCursor)
	if err != nil || len(second.Items) != 1 || second.Items[0].ID == a.ID || second.Items[0].ID == hidden.ID || second.HasMore {
		t.Fatalf("second page: %+v err=%v", second, err)
	}
	changed := o
	changed.Query = "Beta"
	if _, err := f.s.Search(ctx, changed, nil, page.NextCursor); err == nil || err.Error() != "invalid_search_cursor" {
		t.Fatalf("cursor changed query: %v", err)
	}
	filtered, err := f.s.Search(ctx, ListOptions{Query: "検索", Limit: 50, Tags: []string{"search-tag"}, OriginalLanguage: "ja", Field: "tags", Value: `["search-tag"]`}, nil, "")
	if err != nil || len(filtered.Items) != 1 || filtered.Items[0].ID != a.ID {
		t.Fatalf("combined filters: %+v err=%v", filtered, err)
	}
	// A published result in the PIT is now private in PostgreSQL. No stale
	// status in the index may disclose its content.
	if _, err := f.s.DB.ExecContext(ctx, "UPDATE catalog.entities SET status='draft' WHERE id=$1", a.ID); err != nil {
		t.Fatal(err)
	}
	stale, err := f.s.Search(ctx, o, nil, "")
	if err != nil || len(stale.Items) != 0 || stale.TotalRelation != "index_snapshot" {
		t.Fatalf("stale authorization: %+v err=%v", stale, err)
	}
}

func TestOpenSearchIntegrationStructuralRebuild(t *testing.T) {
	f := newFixture(t)
	work := f.save(Entity{Kind: "work", Title: "検索 Work"})
	cu := f.save(Entity{Kind: "content_unit", Title: "検索 Chapter", WorkID: work.ID})
	expr := f.save(Entity{Kind: "expression", Title: "検索 Text", WorkID: work.ID, ContentUnitID: cu.ID})
	release := f.save(Entity{Kind: "release", Title: "検索 Edition", Subjects: []Subject{{WorkID: work.ID, Role: "primary"}}})
	medium := f.save(Entity{Kind: "medium", Title: "検索 Medium", ReleaseID: release.ID})
	track := f.save(Entity{Kind: "track", Title: "検索 Track", MediumID: medium.ID, Contents: []Inclusion{{ExpressionID: expr.ID, Position: 0}}})
	useTestSearch(t, f.s)
	for _, tc := range []struct {
		o    ListOptions
		want string
	}{
		{ListOptions{Query: "検索", Limit: 50, WorkID: work.ID, Kind: "release"}, release.ID},
		{ListOptions{Query: "検索", Limit: 50, ContentUnitID: cu.ID}, expr.ID},
		{ListOptions{Query: "検索", Limit: 50, ReleaseID: release.ID}, medium.ID},
		{ListOptions{Query: "検索", Limit: 50, MediumID: medium.ID}, track.ID},
	} {
		p, err := f.s.Search(context.Background(), tc.o, nil, "")
		if err != nil || len(p.Items) != 1 || p.Items[0].ID != tc.want {
			t.Fatalf("structural filter %+v: %+v err=%v", tc.o, p, err)
		}
	}
}

func TestOpenSearchIntegrationDeepCursor(t *testing.T) {
	f := newFixture(t)
	// Populate real PostgreSQL rows and run the production rebuild. This proves
	// the result count can exceed OpenSearch's from/size window without a fallback.
	_, err := f.s.DB.ExecContext(context.Background(), `INSERT INTO catalog.entities(id,kind,version,title,status,created_by,document)
	SELECT gen_random_uuid(),'work',1,'Deep pagination','published',$1,
	jsonb_build_object('kind','work','title','Deep pagination','translations',jsonb_build_object('en',jsonb_build_object('title','Deep pagination')),'attributes','{}'::jsonb)
	FROM generate_series(1,10010)`, f.u.ID)
	if err != nil {
		t.Fatal(err)
	}
	useTestSearch(t, f.s)
	p, err := f.s.Search(context.Background(), ListOptions{Query: "Deep pagination", Sort: "created_at", Limit: 10, Offset: 9990}, nil, "")
	if err != nil || p.Total != 10010 || len(p.Items) != 10 || !p.HasMore {
		t.Fatalf("window boundary: %+v err=%v", p, err)
	}
	next, err := f.s.Search(context.Background(), ListOptions{Query: "Deep pagination", Sort: "created_at", Limit: 10}, nil, p.NextCursor)
	if err != nil || len(next.Items) != 10 || next.HasMore {
		t.Fatalf("past 10k: %+v err=%v", next, err)
	}
	seen := map[string]bool{}
	for _, e := range p.Items {
		seen[e.ID] = true
	}
	for _, e := range next.Items {
		if seen[e.ID] {
			t.Fatal(fmt.Sprintf("duplicate entity across pages: %s", e.ID))
		}
	}
}
