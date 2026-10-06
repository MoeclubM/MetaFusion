package catalog

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestNewOpenSearchClientValidatesURLAndCredentials(t *testing.T) {
	valid := "http://127.0.0.1:9200"
	if _, err := NewOpenSearchClient(valid, "", ""); err != nil {
		t.Fatalf("valid client rejected: %v", err)
	}
	for _, rawURL := range []string{
		"ftp://127.0.0.1:9200",
		"http://user:pass@127.0.0.1:9200",
		"http://127.0.0.1:9200?pretty=true",
		"http://127.0.0.1:9200#fragment",
	} {
		if _, err := NewOpenSearchClient(rawURL, "", ""); err == nil {
			t.Errorf("URL %q should be rejected", rawURL)
		}
	}
	if _, err := NewOpenSearchClient(valid, "admin", ""); err == nil {
		t.Error("username without password should be rejected")
	}
	if _, err := NewOpenSearchClient(valid, "", "secret"); err == nil {
		t.Error("password without username should be rejected")
	}
}

func TestMakeSearchDocumentIncludesExternalIDs(t *testing.T) {
	doc := makeSearchDocument(Entity{
		ID:      uuid.NewString(),
		Kind:    "work",
		Version: 2,
		Title:   "Example",
		ExternalIDs: map[string]string{
			"musicbrainz":  "abc-123",
			"bangumi_work": "42",
		},
	})
	text := strings.Join(doc.SearchText, "\n")
	exact := strings.Join(doc.SearchTextExact, "\n")
	for _, want := range []string{"musicbrainz:abc-123", "abc-123", "bangumi_work:42", "42"} {
		if !strings.Contains(text, want) {
			t.Errorf("search text %q does not contain %q", text, want)
		}
		if !strings.Contains(exact, want) {
			t.Errorf("exact search text %q does not contain %q", exact, want)
		}
	}
}

func TestSearchPageOnlyRequestsOnePage(t *testing.T) {
	firstID := uuid.NewString()
	secondID := uuid.NewString()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/_search" {
			t.Errorf("unexpected search request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read search body: %v", err)
			return
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Errorf("decode search body: %v", err)
			return
		}
		if payload["track_total_hits"] != true {
			t.Errorf("track_total_hits = %#v, want true", payload["track_total_hits"])
		}
		if payload["size"] != float64(2) {
			t.Errorf("expected a two-item page: %s", body)
		}
		if !strings.Contains(string(body), "search_text_exact") {
			t.Error("search query does not include exact substring fallback")
		}
		if !strings.Contains(string(body), "published") {
			t.Error("anonymous search query does not restrict to published entities")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"hits":{"total":{"value":20000,"relation":"eq"},"hits":[{"_id":"` + firstID + `","sort":[1,"` + firstID + `"]},{"_id":"` + secondID + `","sort":[1,"` + secondID + `"]}]}}`))
	}))
	defer server.Close()

	client, err := NewOpenSearchClient(server.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	client.ready.Store(true)
	page, err := client.searchPage(context.Background(), ListOptions{Query: "外部 ID", Kind: "work", Limit: 2}, nil, searchCursor{PIT: "test-pit"})
	if err != nil {
		t.Fatalf("searchIDs returned error: %v", err)
	}
	if page.Total != 20000 || len(page.IDs) != 2 || page.IDs[0] != firstID || page.IDs[1] != secondID {
		t.Fatalf("searchPage = %#v", page)
	}
}

func TestOpenSearchUnavailableIsExplicit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	client, err := NewOpenSearchClient(server.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	client.ready.Store(true)
	store := &Store{OpenSearch: client}
	_, err = store.Search(context.Background(), ListOptions{Query: "missing", Limit: 50}, nil, "")
	if err != errSearchUnavailable {
		t.Fatalf("unavailable OpenSearch error = %v", err)
	}
}

func TestEnsureIndexUsesCurrentGeneration(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch {
		case r.Method == http.MethodHead && r.URL.Path == "/"+openSearchIndex:
			http.NotFound(w, r)
		case r.Method == http.MethodPut && r.URL.Path == "/"+openSearchIndex:
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Errorf("read alias body: %v", err)
			}
			if !strings.Contains(string(body), "substring_grams") || strings.Contains(string(body), "aliases") {
				t.Errorf("index must contain current mappings and remain unaliased until rebuilt: %s", body)
			}
			w.WriteHeader(http.StatusOK)
		default:
			t.Errorf("unexpected recovery request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusBadRequest)
		}
	}))
	defer server.Close()

	client, err := NewOpenSearchClient(server.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := client.ensureIndex(context.Background()); err != nil {
		t.Fatalf("ensureIndex recovery returned error: %v", err)
	}
	if calls != 2 {
		t.Fatalf("creation made %d requests, want 2", calls)
	}
}

func TestIndexDocumentsWaitsForRefreshAndSendsExternalVersions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/_bulk" || r.URL.Query().Get("refresh") != "wait_for" {
			t.Errorf("unexpected bulk request: %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read bulk body: %v", err)
			return
		}
		lines := strings.Split(strings.TrimSpace(string(body)), "\n")
		if len(lines) != 4 {
			t.Errorf("bulk body has %d lines, want 4: %s", len(lines), body)
		}
		var action map[string]map[string]any
		if err := json.Unmarshal([]byte(lines[0]), &action); err != nil {
			t.Errorf("decode bulk action: %v", err)
		}
		metadata := action["index"]
		if metadata["_index"] != openSearchIndex || metadata["version_type"] != "external_gte" {
			t.Errorf("unexpected bulk metadata: %#v", metadata)
		}
		if !strings.Contains(lines[1], "external-id") {
			t.Errorf("bulk document does not contain external ID: %s", lines[1])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"errors":false,"items":[{"index":{"status":201}},{"index":{"status":201}}]}`))
	}))
	defer server.Close()

	client, err := NewOpenSearchClient(server.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	docs := []searchDocument{
		makeSearchDocument(Entity{ID: uuid.NewString(), Kind: "work", Version: 1, Title: "A", ExternalIDs: map[string]string{"source": "external-id"}}),
		makeSearchDocument(Entity{ID: uuid.NewString(), Kind: "work", Version: 1, Title: "B"}),
	}
	if err := client.indexDocuments(context.Background(), docs); err != nil {
		t.Fatalf("indexDocuments returned error: %v", err)
	}
}

func TestPostgresBrowseRejectsTextSearch(t *testing.T) {
	args := []any{}
	_, err := listFilter(context.Background(), &Store{}, ListOptions{Query: "bangumi:42"}, nil, &args)
	if err == nil || err.Error() != "text_query_requires_search" {
		t.Fatalf("text search must use OpenSearch: %v", err)
	}
}

func TestMakeSearchDocumentTruncatesByRunes(t *testing.T) {
	for _, tc := range []struct {
		name, unit string
		count      int
	}{
		{"ascii below limit", "a", 4095},
		{"ascii at limit", "a", 4096},
		{"ascii over limit", "a", 4097},
		{"Japanese bytes above limit", "あ", 2000},
		{"Japanese at limit", "あ", 4096},
		{"Japanese over limit", "あ", 4097},
		{"emoji bytes above limit", "🎵", 1100},
		{"emoji over limit", "🎵", 4097},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value := strings.Repeat(tc.unit, tc.count)
			doc := makeSearchDocument(Entity{Title: "  " + value + "  "})
			count := tc.count
			if count > 4096 {
				count = 4096
			}
			want := strings.Repeat(tc.unit, count)
			if len(doc.TitleText) != 1 || doc.TitleText[0] != want {
				t.Fatalf("unexpected title truncation")
			}
			if len(doc.SearchText) != 1 || doc.SearchText[0] != want {
				t.Fatalf("unexpected analyzed text truncation")
			}
			// Exact-text chunks must still cover the full source, including its tail.
			if len(doc.SearchTextExact) == 0 || !strings.HasSuffix(value, doc.SearchTextExact[len(doc.SearchTextExact)-1]) {
				t.Fatalf("missing exact text tail")
			}
		})
	}
}
