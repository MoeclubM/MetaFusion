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

func TestSearchIDsBuildsBoundedQuery(t *testing.T) {
	firstID := uuid.NewString()
	secondID := uuid.NewString()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/"+openSearchAlias+"/_search" {
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
		if !strings.Contains(string(body), "search_text_exact") {
			t.Error("search query does not include exact substring fallback")
		}
		if !strings.Contains(string(body), "published") {
			t.Error("anonymous search query does not restrict to published entities")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"hits":{"total":{"value":2,"relation":"eq"},"hits":[{"_id":"` + firstID + `"},{"_id":"` + secondID + `"}]}}`))
	}))
	defer server.Close()

	client, err := NewOpenSearchClient(server.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	client.ready.Store(true)
	ids, total, err := client.searchIDs(context.Background(), ListOptions{Query: "外部 ID", Kind: "work"}, nil)
	if err != nil {
		t.Fatalf("searchIDs returned error: %v", err)
	}
	if total != 2 || len(ids) != 2 || ids[0] != firstID || ids[1] != secondID {
		t.Fatalf("searchIDs = %#v, total = %d", ids, total)
	}
}

func TestOpenSearchOptionsFallsBackWhenUnavailable(t *testing.T) {
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
	got, used := store.openSearchOptions(context.Background(), ListOptions{Query: "missing"}, nil)
	if used || len(got.SearchIDs) != 0 {
		t.Fatalf("unavailable OpenSearch used candidates: %#v", got)
	}
}

func TestEnsureIndexRepairsExistingIndexWithoutAlias(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/_alias/"+openSearchAlias:
			http.NotFound(w, r)
		case r.Method == http.MethodPut && r.URL.Path == "/"+openSearchIndex:
			http.Error(w, "index already exists", http.StatusBadRequest)
		case r.Method == http.MethodHead && r.URL.Path == "/"+openSearchIndex:
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPut && r.URL.Path == "/_aliases":
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Errorf("read alias body: %v", err)
			}
			if !strings.Contains(string(body), openSearchIndex) || !strings.Contains(string(body), openSearchAlias) {
				t.Errorf("alias body does not attach expected index: %s", body)
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
	if calls != 5 {
		t.Fatalf("recovery made %d requests, want 5", calls)
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
		if metadata["_index"] != openSearchAlias || metadata["version_type"] != "external_gte" {
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

func TestListFilterRechecksExternalIDs(t *testing.T) {
	args := []any{}
	parts, err := listFilter(context.Background(), &Store{}, ListOptions{Query: "bangumi:42"}, nil, &args)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(parts, " ")
	if !strings.Contains(joined, "external_ids") || !strings.Contains(joined, "jsonb_each_text") {
		t.Fatalf("list filter does not recheck external IDs: %s", joined)
	}
	if len(args) != 1 || args[0] != "%bangumi:42%" {
		t.Fatalf("list filter args = %#v", args)
	}
}
