package catalog

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const openSearchStateDocID = "metafusion-index-state-" + openSearchIndexGeneration

func (s *Store) RunOpenSearchIndexer(ctx context.Context) {
	if s.OpenSearch == nil {
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := s.syncOpenSearch(ctx); err != nil && ctx.Err() == nil {
			s.OpenSearch.ready.Store(false)
			s.OpenSearch.logIssue("OpenSearch indexing delayed; PostgreSQL remains authoritative", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Store) syncOpenSearch(ctx context.Context) error {
	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var locked bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", openSearchLockID).Scan(&locked); err != nil || !locked {
		return err
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, _ = conn.ExecContext(unlockCtx, "SELECT pg_advisory_unlock($1)", openSearchLockID)
	}()

	c := s.OpenSearch
	if err := c.ensureIndex(ctx); err != nil {
		return err
	}
	initialized, err := c.isInitialized(ctx)
	if err != nil {
		return err
	}
	if !initialized {
		c.ready.Store(false)
		if err := c.clearEntityDocuments(ctx); err != nil {
			return err
		}
		if err := s.rebuildOpenSearchIndex(ctx, c); err != nil {
			return err
		}
		if err := c.setInitialized(ctx); err != nil {
			return err
		}
	}
	if err := s.deliverOpenSearch(ctx, c); err != nil {
		return err
	}
	c.ready.Store(true)
	return nil
}

func (s *Store) deliverOpenSearch(ctx context.Context, c *OpenSearchClient) error {
	rows, err := s.DB.QueryContext(ctx, `SELECT id,type,entity_id,version,payload,created_at
		FROM catalog.outbox o
		WHERE o.type LIKE 'entity.%'
		  AND NOT EXISTS(SELECT 1 FROM catalog.deliveries d WHERE d.consumer=$1 AND d.event_id=o.id)
		ORDER BY created_at,id LIMIT 100`, openSearchConsumer)
	if err != nil {
		return err
	}
	var events []Event
	for rows.Next() {
		var event Event
		if err := rows.Scan(&event.ID, &event.Type, &event.EntityID, &event.Version, &event.Payload, &event.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(events) == 0 {
		return nil
	}
	docs := make([]searchDocument, 0, len(events))
	for _, event := range events {
		if !strings.HasPrefix(event.Type, "entity.") {
			continue
		}
		var entity Entity
		if err := json.Unmarshal(event.Payload, &entity); err != nil {
			return fmt.Errorf("decode entity outbox event %s: %w", event.ID, err)
		}
		if entity.ID != "" && entity.ID != event.EntityID {
			return fmt.Errorf("entity outbox event %s has a mismatched entity ID", event.ID)
		}
		if entity.Kind == "" {
			return fmt.Errorf("entity outbox event %s has no kind", event.ID)
		}
		entity.ID = event.EntityID
		entity.Version = event.Version
		docs = append(docs, makeSearchDocument(entity))
	}
	// Bulk indexing is idempotent by entity ID and external version. If indexing
	// or acknowledgement fails, the whole batch is safely replayed on the next poll.
	if err := c.indexDocuments(ctx, docs); err != nil {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, event := range events {
		if _, err := tx.ExecContext(ctx, `INSERT INTO catalog.deliveries(consumer,event_id)
			VALUES($1,$2) ON CONFLICT DO NOTHING`, openSearchConsumer, event.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (c *OpenSearchClient) ensureIndex(ctx context.Context) error {
	status, _, err := c.request(ctx, http.MethodGet, "/_alias/"+openSearchAlias, nil, "")
	if err != nil {
		return err
	}
	if status == http.StatusOK {
		return nil
	}
	if status != http.StatusNotFound {
		return fmt.Errorf("OpenSearch alias check returned HTTP %d", status)
	}
	mapping := map[string]any{
		"settings": map[string]any{"number_of_shards": 1, "number_of_replicas": 0},
		"mappings": map[string]any{"dynamic": "strict", "properties": map[string]any{
			"record_type":       map[string]any{"type": "keyword"},
			"initialized":       map[string]any{"type": "boolean"},
			"entity_id":         map[string]any{"type": "keyword"},
			"entity_version":    map[string]any{"type": "long"},
			"kind":              map[string]any{"type": "keyword"},
			"status":            map[string]any{"type": "keyword"},
			"created_by":        map[string]any{"type": "keyword"},
			"types":             map[string]any{"type": "keyword"},
			"tags":              map[string]any{"type": "keyword"},
			"original_language": map[string]any{"type": "keyword"},
			"work_id":           map[string]any{"type": "keyword"},
			"content_unit_id":   map[string]any{"type": "keyword"},
			"release_id":        map[string]any{"type": "keyword"},
			"medium_id":         map[string]any{"type": "keyword"},
			"parent_id":         map[string]any{"type": "keyword"},
			"has_pictures":      map[string]any{"type": "boolean"},
			"updated_at":        map[string]any{"type": "date"},
			"title_text":        map[string]any{"type": "search_as_you_type", "max_shingle_size": 3},
			"search_text":       map[string]any{"type": "search_as_you_type", "max_shingle_size": 3},
			"search_text_exact": map[string]any{"type": "keyword", "ignore_above": 8191},
		}},
		"aliases": map[string]any{openSearchAlias: map[string]any{}},
	}
	body, err := json.Marshal(mapping)
	if err != nil {
		return err
	}
	status, _, err = c.request(ctx, http.MethodPut, "/"+openSearchIndex, body, "application/json")
	if err != nil {
		return err
	}
	if status == http.StatusOK || status == http.StatusCreated {
		return nil
	}
	// Another replica may have created the index between the alias check and PUT.
	status, _, err = c.request(ctx, http.MethodGet, "/_alias/"+openSearchAlias, nil, "")
	if err == nil && status == http.StatusOK {
		return nil
	}
	// A previous process may have created the index but failed before attaching
	// the alias. Recover that partial state instead of retrying the same failing PUT.
	indexStatus, _, indexErr := c.request(ctx, http.MethodHead, "/"+openSearchIndex, nil, "")
	if indexErr == nil && indexStatus == http.StatusOK {
		if err := c.attachAlias(ctx); err == nil {
			return nil
		}
	}
	return fmt.Errorf("OpenSearch index creation returned HTTP %d", status)
}

func (c *OpenSearchClient) attachAlias(ctx context.Context) error {
	body, err := json.Marshal(map[string]any{"actions": []map[string]any{{
		"add": map[string]any{"index": openSearchIndex, "alias": openSearchAlias},
	}}})
	if err != nil {
		return err
	}
	status, _, err := c.request(ctx, http.MethodPut, "/_aliases", body, "application/json")
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("OpenSearch alias attach returned HTTP %d", status)
	}
	return nil
}

func (c *OpenSearchClient) isInitialized(ctx context.Context) (bool, error) {
	status, raw, err := c.request(ctx, http.MethodGet, "/"+openSearchAlias+"/_doc/"+openSearchStateDocID, nil, "")
	if err != nil {
		return false, err
	}
	if status == http.StatusNotFound {
		return false, nil
	}
	if status != http.StatusOK {
		return false, fmt.Errorf("OpenSearch state check returned HTTP %d", status)
	}
	var state struct {
		Source struct {
			Initialized bool `json:"initialized"`
		} `json:"_source"`
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		return false, err
	}
	return state.Source.Initialized, nil
}

func (c *OpenSearchClient) setInitialized(ctx context.Context) error {
	body, _ := json.Marshal(map[string]any{"record_type": "state", "initialized": true})
	status, _, err := c.request(ctx, http.MethodPut, "/"+openSearchAlias+"/_doc/"+openSearchStateDocID+"?refresh=wait_for", body, "application/json")
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("OpenSearch state update returned HTTP %d", status)
	}
	return nil
}

func (c *OpenSearchClient) clearEntityDocuments(ctx context.Context) error {
	body, _ := json.Marshal(map[string]any{"query": map[string]any{"terms": map[string]any{"record_type": []string{"entity", "state"}}}})
	status, _, err := c.request(ctx, http.MethodPost, "/"+openSearchAlias+"/_delete_by_query?conflicts=proceed&refresh=true", body, "application/json")
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("OpenSearch index reset returned HTTP %d", status)
	}
	return nil
}

func (s *Store) rebuildOpenSearchIndex(ctx context.Context, c *OpenSearchClient) error {
	lastID := ""
	for {
		query := "SELECT id::text,kind,version,title,status,created_by,updated_at,document FROM catalog.entities ORDER BY id LIMIT 500"
		var rows *sql.Rows
		var err error
		if lastID == "" {
			rows, err = s.DB.QueryContext(ctx, query)
		} else {
			rows, err = s.DB.QueryContext(ctx, "SELECT id::text,kind,version,title,status,created_by,updated_at,document FROM catalog.entities WHERE id>$1::uuid ORDER BY id LIMIT 500", lastID)
		}
		if err != nil {
			return err
		}
		batch := make([]searchDocument, 0, 500)
		for rows.Next() {
			var e Entity
			var id, kind, title, status, createdBy string
			var version int64
			var updatedAt time.Time
			var doc []byte
			if err := rows.Scan(&id, &kind, &version, &title, &status, &createdBy, &updatedAt, &doc); err != nil {
				rows.Close()
				return err
			}
			if err := json.Unmarshal(doc, &e); err != nil {
				rows.Close()
				return fmt.Errorf("decode entity %s for OpenSearch: %w", id, err)
			}
			// These values live in relational columns as well as in the API DTO.
			e.ID, e.Kind, e.Version, e.Title = id, kind, version, title
			e.Status, e.CreatedBy, e.UpdatedAt = status, createdBy, updatedAt
			batch = append(batch, makeSearchDocument(e))
			lastID = e.ID
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		if len(batch) == 0 {
			return nil
		}
		if err := c.indexDocuments(ctx, batch); err != nil {
			return err
		}
	}
}

func (c *OpenSearchClient) indexDocuments(ctx context.Context, docs []searchDocument) error {
	if len(docs) == 0 {
		return nil
	}
	var body bytes.Buffer
	enc := json.NewEncoder(&body)
	for _, doc := range docs {
		version := doc.EntityVersion
		if version < 1 {
			version = 1
		}
		if err := enc.Encode(map[string]any{"index": map[string]any{
			"_index": openSearchAlias, "_id": doc.EntityID,
			"version": version, "version_type": "external_gte",
		}}); err != nil {
			return err
		}
		if err := enc.Encode(doc); err != nil {
			return err
		}
	}
	status, raw, err := c.request(ctx, http.MethodPost, "/_bulk?refresh=wait_for", body.Bytes(), "application/x-ndjson")
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("OpenSearch bulk request returned HTTP %d", status)
	}
	var result struct {
		Errors bool `json:"errors"`
		Items  []map[string]struct {
			Status int `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode OpenSearch bulk response: %w", err)
	}
	if result.Errors {
		for _, item := range result.Items {
			for _, response := range item {
				if response.Status >= 300 && response.Status != http.StatusConflict {
					return fmt.Errorf("OpenSearch rejected a bulk item with HTTP %d", response.Status)
				}
			}
		}
	}
	return nil
}
