package catalog

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

const (
	openSearchAlias    = "metafusion-entities"
	openSearchIndex    = "metafusion-entities-v1"
	openSearchConsumer = "opensearch"
	// Bump the state generation when the document/search contract changes. The
	// indexer will rebuild the optional candidate index once on the next start.
	openSearchIndexGeneration = "v2"
	openSearchLockID          = int64(740219)
	openSearchMaxCandidates   = 10000
)

// OpenSearchClient is optional. PostgreSQL remains the source of truth and the
// directory list handler falls back to its existing query whenever this client
// is unavailable or the result set exceeds OpenSearch's bounded result window.
type OpenSearchClient struct {
	baseURL  string
	username string
	password string
	http     *http.Client
	ready    atomic.Bool
	logMu    sync.Mutex
	lastLog  time.Time
}

func NewOpenSearchClient(rawURL, username, password string) (*OpenSearchClient, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("OPENSEARCH_URL must be an http(s) URL without embedded credentials, query, or fragment")
	}
	if (username == "") != (password == "") {
		return nil, fmt.Errorf("OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD must be set together")
	}
	return &OpenSearchClient{
		baseURL:  strings.TrimRight(u.String(), "/"),
		username: username,
		password: password,
		http:     &http.Client{Timeout: 15 * time.Second},
	}, nil
}

func (c *OpenSearchClient) request(ctx context.Context, method, path string, body []byte, contentType string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	return resp.StatusCode, b, err
}

func (c *OpenSearchClient) logIssue(message string, err error) {
	c.logMu.Lock()
	defer c.logMu.Unlock()
	if time.Since(c.lastLog) < time.Minute {
		return
	}
	c.lastLog = time.Now()
	log.Printf("%s: %v", message, err)
}

// SearchIDs returns the relevance-ordered candidate IDs and the exact hit count
// reported by OpenSearch. The caller still applies PostgreSQL visibility and
// list filters before returning any entity data.
func (c *OpenSearchClient) searchIDs(ctx context.Context, o ListOptions, u *User) ([]string, int, error) {
	if !c.ready.Load() {
		return nil, 0, fmt.Errorf("OpenSearch index is not ready")
	}
	if o.Field != "" || o.WorkID != "" || o.ContentUnitID != "" || o.ReleaseID != "" || o.MediumID != "" || o.ParentID != "" {
		return nil, 0, fmt.Errorf("query uses a PostgreSQL-only filter")
	}
	query := strings.TrimSpace(o.Query)
	if query == "" {
		return nil, 0, fmt.Errorf("empty OpenSearch query")
	}

	filters := []any{map[string]any{"term": map[string]any{"record_type": "entity"}}}
	mustNot := []any{
		map[string]any{"terms": map[string]any{"status": []string{"deleted", "merged"}}},
	}
	match := map[string]any{"multi_match": map[string]any{
		"query": query, "type": "bool_prefix", "operator": "and",
		"fields": []string{"title_text^5", "title_text._2gram^3", "title_text._3gram^2", "search_text", "search_text._2gram", "search_text._3gram"},
	}}
	substring := map[string]any{"wildcard": map[string]any{"search_text_exact": map[string]any{
		"value": "*" + escapeOpenSearchWildcard(query) + "*", "case_insensitive": true,
	}}}
	must := []any{map[string]any{"bool": map[string]any{
		"should": []any{match, substring}, "minimum_should_match": 1,
	}}}
	term := func(field, value string) {
		if value != "" {
			filters = append(filters, map[string]any{"term": map[string]any{field: value}})
		}
	}
	terms := func(field string, values []string) {
		if len(values) > 0 {
			filters = append(filters, map[string]any{"terms": map[string]any{field: values}})
		}
	}
	term("kind", o.Kind)
	terms("kind", o.Kinds)
	term("status", o.Status)
	term("original_language", o.OriginalLanguage)
	term("types", o.Type)
	terms("types", o.Types)
	if o.HasPictures {
		filters = append(filters, map[string]any{"term": map[string]any{"has_pictures": true}})
	}
	terms("tags", o.Tags)
	if u == nil {
		term("status", "published")
	} else if !u.Can(PermissionLifecycleManage) {
		filters = append(filters, map[string]any{"bool": map[string]any{
			"should": []any{
				map[string]any{"term": map[string]any{"status": "published"}},
				map[string]any{"term": map[string]any{"created_by": u.ID}},
			}, "minimum_should_match": 1,
		}})
	}

	sort := []any{map[string]any{"_score": "desc"}, map[string]any{"entity_id": "asc"}}
	if o.Sort != "" {
		sort = []any{map[string]any{"entity_id": "asc"}}
	}
	body, err := json.Marshal(map[string]any{
		"size":             openSearchMaxCandidates,
		"track_total_hits": true,
		"_source":          false,
		"query":            map[string]any{"bool": map[string]any{"must": must, "filter": filters, "must_not": mustNot}},
		"sort":             sort,
	})
	if err != nil {
		return nil, 0, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	status, raw, err := c.request(reqCtx, http.MethodPost, "/"+openSearchAlias+"/_search", body, "application/json")
	if err != nil {
		return nil, 0, err
	}
	if status < 200 || status >= 300 {
		return nil, 0, fmt.Errorf("OpenSearch search returned HTTP %d", status)
	}
	var result struct {
		Hits struct {
			Total struct {
				Value    int    `json:"value"`
				Relation string `json:"relation"`
			} `json:"total"`
			Hits []struct {
				ID string `json:"_id"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, 0, fmt.Errorf("decode OpenSearch response: %w", err)
	}
	if result.Hits.Total.Relation != "eq" || result.Hits.Total.Value > openSearchMaxCandidates || len(result.Hits.Hits) != result.Hits.Total.Value {
		return nil, result.Hits.Total.Value, fmt.Errorf("OpenSearch result exceeds the bounded candidate window")
	}
	ids := make([]string, 0, len(result.Hits.Hits))
	for _, hit := range result.Hits.Hits {
		if _, err := uuid.Parse(hit.ID); err != nil {
			return nil, 0, fmt.Errorf("OpenSearch returned an invalid entity ID")
		}
		ids = append(ids, hit.ID)
	}
	return ids, result.Hits.Total.Value, nil
}

func (s *Store) openSearchOptions(ctx context.Context, o ListOptions, u *User) (ListOptions, bool) {
	if s.OpenSearch == nil || o.Query == "" || o.Field != "" || o.WorkID != "" || o.ContentUnitID != "" || o.ReleaseID != "" || o.MediumID != "" || o.ParentID != "" {
		return o, false
	}
	ids, total, err := s.OpenSearch.searchIDs(ctx, o, u)
	if err != nil {
		s.OpenSearch.logIssue("OpenSearch search unavailable; using PostgreSQL search", err)
		return o, false
	}
	if total == 0 || len(ids) == 0 {
		// Keep PostgreSQL's substring behavior for queries that the search analyzer
		// does not tokenize to a hit (for example a mid-token fragment).
		return o, false
	}
	o.SearchIDs = ids
	return o, true
}

func escapeOpenSearchWildcard(value string) string {
	var out strings.Builder
	for _, r := range value {
		if r == '\\' || r == '*' || r == '?' {
			out.WriteRune('\\')
		}
		out.WriteRune(r)
	}
	return out.String()
}
