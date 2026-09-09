package catalog

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"strings"
	"time"
)

//go:embed schema.sql
var schema string

type Store struct{ DB *sql.DB }
type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func Open(ctx context.Context, dsn string) (*Store, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetConnMaxLifetime(time.Hour)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db}, nil
}

// Initialize touches only the new schema. Existing catalog and module data are untouched.
func (s *Store) Initialize(ctx context.Context) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, schema); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM catalog.definitions").Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			d := Defaults()
			if err := d.Validate(); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO catalog.definitions(state,base_version,document) VALUES('published',0,$1)", encode(d)); err != nil {
				return err
			}
		}
		const seedOAuth = `
INSERT INTO catalog.oauth_clients(id, secret_hash, name, redirect_uris, trusted)
VALUES
 ('metafusion-resources', '', 'MetaFusion 资源存储与下载管理中心', ARRAY['https://resources.findverse.cc/callback', 'http://localhost:3001/callback'], true),
 ('metafusion-forum', '', 'MetaFusion 社区论坛', ARRAY['https://forum.findverse.cc/auth/oauth2_basic/callback', 'http://localhost:4200/auth/callback'], true),
 ('metafusion-catalog', '', 'MetaFusion 元数据知识库', ARRAY['https://findverse.cc/auth/callback', 'http://localhost:3000/auth/callback'], true)
ON CONFLICT (id) DO NOTHING;`
		if _, err := tx.ExecContext(ctx, seedOAuth); err != nil {
			return err
		}
		if err := seedExternalDatabases(ctx, tx); err != nil {
			return err
		}
		if err := seedShelves(ctx, tx); err != nil {
			return err
		}
		return nil
	})
}
func (s *Store) write(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(740202)"); err != nil {
		return err
	}
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}
func encode(v any) string { b, _ := json.Marshal(v); return string(b) }
func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}
func definitions(ctx context.Context, q queryer) (DefinitionVersion, error) {
	var v DefinitionVersion
	var b []byte
	err := q.QueryRowContext(ctx, "SELECT id,state,base_version,document,created_at FROM catalog.definitions WHERE state='published'").Scan(&v.ID, &v.State, &v.BaseVersion, &b, &v.CreatedAt)
	if err == nil {
		err = json.Unmarshal(b, &v.Document)
	}
	return v, err
}
func (s *Store) Definitions(ctx context.Context) (DefinitionVersion, error) {
	return definitions(ctx, s.DB)
}
func get(ctx context.Context, q queryer, id string) (Entity, error) {
	var e Entity
	var b []byte
	err := q.QueryRowContext(ctx, "SELECT document FROM catalog.entities WHERE id=$1", id).Scan(&b)
	if err != nil {
		return e, err
	}
	if err = json.Unmarshal(b, &e); err != nil {
		return e, err
	}
	switch e.Kind {
	case "content_unit":
		err = q.QueryRowContext(ctx, "SELECT work_id,coalesce(parent_id::text,'') FROM catalog.content_units WHERE id=$1", id).Scan(&e.WorkID, &e.ParentID)
	case "expression":
		err = q.QueryRowContext(ctx, "SELECT work_id,coalesce(content_unit_id::text,'') FROM catalog.expressions WHERE id=$1", id).Scan(&e.WorkID, &e.ContentUnitID)
	case "medium":
		err = q.QueryRowContext(ctx, "SELECT release_id,coalesce(parent_id::text,'') FROM catalog.mediums WHERE id=$1", id).Scan(&e.ReleaseID, &e.ParentID)
	case "track":
		err = q.QueryRowContext(ctx, "SELECT medium_id,coalesce(parent_id::text,'') FROM catalog.tracks WHERE id=$1", id).Scan(&e.MediumID, &e.ParentID)
		if err != nil {
			return e, err
		}
		var rows *sql.Rows
		rows, err = q.QueryContext(ctx, "SELECT expression_id,position,locator FROM catalog.track_contents WHERE track_id=$1 ORDER BY position", id)
		if err != nil {
			return e, err
		}
		defer rows.Close()
		e.Contents = []Inclusion{}
		for rows.Next() {
			var c Inclusion
			var loc []byte
			if err = rows.Scan(&c.ExpressionID, &c.Position, &loc); err != nil {
				return e, err
			}
			if err = json.Unmarshal(loc, &c.Locator); err != nil {
				return e, err
			}
			e.Contents = append(e.Contents, c)
		}
		err = rows.Err()
	case "release":
		var rows *sql.Rows
		rows, err = q.QueryContext(ctx, "SELECT work_id,role,position FROM catalog.release_subjects WHERE release_id=$1 ORDER BY position,work_id", id)
		if err != nil {
			return e, err
		}
		defer rows.Close()
		e.Subjects = []Subject{}
		for rows.Next() {
			var x Subject
			if err = rows.Scan(&x.WorkID, &x.Role, &x.Position); err != nil {
				return e, err
			}
			e.Subjects = append(e.Subjects, x)
		}
		err = rows.Err()
	}
	return e, err
}
func visible(e Entity, u *User) bool {
	return e.Status == "published" || u != nil && (u.Role == "admin" || e.CreatedBy == u.ID)
}
func (s *Store) Get(ctx context.Context, id string, u *User) (Entity, error) {
	if _, err := uuid.Parse(id); err != nil {
		return Entity{}, fmt.Errorf("invalid_id")
	}
	e, err := get(ctx, s.DB, id)
	if err == nil && !visible(e, u) {
		return Entity{}, sql.ErrNoRows
	}
	return e, err
}
func reference(ctx context.Context, q queryer, u *User) func(string, []string) error {
	return func(id string, kinds []string) error {
		if _, err := uuid.Parse(id); err != nil {
			return fmt.Errorf("invalid_reference")
		}
		e, err := get(ctx, q, id)
		if err != nil || !contains(kinds, e.Kind) || !visible(e, u) || e.Status == "deleted" || e.Status == "merged" {
			return fmt.Errorf("invalid_reference")
		}
		return nil
	}
}
func audit(ctx context.Context, tx *sql.Tx, id string, version int64, u User, note string, sources []Source, snapshot any, eventType string) error {
	if _, err := tx.ExecContext(ctx, "INSERT INTO catalog.revisions(target_id,version,actor_id,edit_note,sources,snapshot) VALUES($1,$2,$3,$4,$5,$6)", id, version, u.ID, note, encode(sources), encode(snapshot)); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO catalog.outbox(id,type,entity_id,version,payload) VALUES($1,$2,$3,$4,$5)", uuid.NewString(), eventType, id, version, encode(snapshot))
	return err
}
func (s *Store) Save(ctx context.Context, input Edit, u User) (Entity, error) {
	e := input.Entity
	err := s.write(ctx, func(tx *sql.Tx) error {
		if err := validateSources(input.EditNote, input.Sources); err != nil {
			return err
		}
		v, err := definitions(ctx, tx)
		if err != nil {
			return err
		}
		var old Entity
		if e.ID == "" {
			if input.ExpectedVersion != 0 {
				return fmt.Errorf("version_conflict")
			}
			e.ID = uuid.NewString()
			e.Version = 1
			e.CreatedBy = u.ID
		} else {
			old, err = get(ctx, tx, e.ID)
			if err != nil {
				return err
			}
			if !visible(old, &u) || old.Status == "deleted" || old.Status == "merged" {
				return fmt.Errorf("forbidden")
			}
			if old.Version != input.ExpectedVersion {
				return fmt.Errorf("version_conflict")
			}
			if old.Kind != e.Kind || old.WorkID != e.WorkID || old.ReleaseID != e.ReleaseID || old.MediumID != e.MediumID {
				return fmt.Errorf("immutable_scope")
			}
			e.CreatedBy = old.CreatedBy
			e.Version = old.Version + 1
		}
		if u.Role != "admin" {
			if old.ID != "" && old.CreatedBy != u.ID || old.Status == "published" {
				return fmt.Errorf("forbidden")
			}
			if e.Status != "draft" && e.Status != "pending_review" {
				return fmt.Errorf("forbidden")
			}
		}
		if e.Status == "" {
			e.Status = "draft"
		}
		if e.Status == "deleted" || e.Status == "merged" || e.RedirectID != "" {
			return fmt.Errorf("use_lifecycle_endpoint")
		}
		if old.Status == "published" && e.Status != "published" {
			return fmt.Errorf("use_lifecycle_endpoint")
		}
		e.Title = strings.TrimSpace(e.Title)
		e.UpdatedAt = time.Now().UTC()
		ref := reference(ctx, tx, &u)
		if e.Status == "published" {
			ref = reference(ctx, tx, nil)
		}
		if err = v.Document.validateEntity(e, ref, true); err != nil {
			return err
		}
		if err = v.Document.retiredEntity(e, old); err != nil {
			return err
		}
		if e.WorkID != "" {
			if err = ref(e.WorkID, []string{"work"}); err != nil {
				return err
			}
		}
		if e.ReleaseID != "" {
			if err = ref(e.ReleaseID, []string{"release"}); err != nil {
				return err
			}
		}
		if e.MediumID != "" {
			if err = ref(e.MediumID, []string{"medium"}); err != nil {
				return err
			}
		}
		if e.ParentID != "" {
			if err = ref(e.ParentID, []string{e.Kind}); err != nil {
				return err
			}
		}
		if e.ContentUnitID != "" {
			if err = ref(e.ContentUnitID, []string{"content_unit"}); err != nil {
				return err
			}
		}
		stored := e
		stored.WorkID = ""
		stored.ContentUnitID = ""
		stored.ReleaseID = ""
		stored.MediumID = ""
		stored.ParentID = ""
		stored.Contents = nil
		stored.Subjects = nil
		_, err = tx.ExecContext(ctx, `INSERT INTO catalog.entities(id,kind,version,title,status,created_by,document,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,title=EXCLUDED.title,status=EXCLUDED.status,document=EXCLUDED.document,updated_at=EXCLUDED.updated_at`, e.ID, e.Kind, e.Version, e.Title, e.Status, e.CreatedBy, encode(stored), e.UpdatedAt)
		if err != nil {
			return err
		}
		switch e.Kind {
		case "content_unit":
			_, err = tx.ExecContext(ctx, "INSERT INTO catalog.content_units(id,work_id,parent_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id", e.ID, e.WorkID, nullable(e.ParentID))
		case "expression":
			_, err = tx.ExecContext(ctx, "INSERT INTO catalog.expressions(id,work_id,content_unit_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET content_unit_id=EXCLUDED.content_unit_id", e.ID, e.WorkID, nullable(e.ContentUnitID))
		case "medium":
			_, err = tx.ExecContext(ctx, "INSERT INTO catalog.mediums(id,release_id,parent_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id", e.ID, e.ReleaseID, nullable(e.ParentID))
		case "track":
			_, err = tx.ExecContext(ctx, "INSERT INTO catalog.tracks(id,medium_id,parent_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id", e.ID, e.MediumID, nullable(e.ParentID))
			if err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, "DELETE FROM catalog.track_contents WHERE track_id=$1", e.ID); err != nil {
				return err
			}
			for _, c := range e.Contents {
				if _, err = tx.ExecContext(ctx, "INSERT INTO catalog.track_contents(track_id,expression_id,position,locator) VALUES($1,$2,$3,$4)", e.ID, c.ExpressionID, c.Position, encode(c.Locator)); err != nil {
					return err
				}
			}
		case "release":
			if _, err = tx.ExecContext(ctx, "DELETE FROM catalog.release_subjects WHERE release_id=$1", e.ID); err != nil {
				return err
			}
			for _, x := range e.Subjects {
				if _, err = tx.ExecContext(ctx, "INSERT INTO catalog.release_subjects(release_id,work_id,role,position) VALUES($1,$2,$3,$4)", e.ID, x.WorkID, x.Role, x.Position); err != nil {
					return err
				}
			}
		}
		if err != nil {
			return err
		}
		var missing bool
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.track_contents c JOIN catalog.tracks t ON t.id=c.track_id JOIN catalog.mediums m ON m.id=t.medium_id JOIN catalog.expressions x ON x.id=c.expression_id WHERE NOT EXISTS(SELECT 1 FROM catalog.release_subjects s WHERE s.release_id=m.release_id AND s.work_id=x.work_id))`).Scan(&missing)
		if err != nil {
			return err
		}
		if missing {
			return fmt.Errorf("undeclared_release_subject")
		}
		return audit(ctx, tx, e.ID, e.Version, u, input.EditNote, input.Sources, e, "entity.saved")
	})
	return e, err
}

type ListOptions struct {
	Kind, Query, Type, Status, WorkID, ContentUnitID, ReleaseID, MediumID, ParentID, Field, Value string
	Offset, Limit                                                                                 int
}

// listFilter builds the shared WHERE clause for List and Count so the list
// total is a real COUNT(*) over the same predicate set, not len(items).
func listFilter(ctx context.Context, s *Store, o ListOptions, u *User, args *[]any) ([]string, error) {
	parts := []string{"status NOT IN ('deleted','merged')"}
	add := func(clause string, value any) {
		*args = append(*args, value)
		parts = append(parts, fmt.Sprintf(clause, len(*args)))
	}
	if u == nil {
		parts = append(parts, "status='published'")
	} else if u.Role != "admin" {
		add("(status='published' OR created_by=$%d)", u.ID)
	}
	if o.Kind != "" {
		add("kind=$%d", o.Kind)
	}
	if o.Status != "" {
		add("status=$%d", o.Status)
	}
	if o.Query != "" {
		add("(title ILIKE $%[1]d OR (document->'translations')::text ILIKE $%[1]d)", "%"+o.Query+"%")
	}
	if o.Type != "" {
		add("document->'types' ? $%d", o.Type)
	}
	if o.WorkID != "" {
		add("(id IN(SELECT id FROM catalog.content_units WHERE work_id=$%[1]d) OR id IN(SELECT id FROM catalog.expressions WHERE work_id=$%[1]d) OR id IN(SELECT release_id FROM catalog.release_subjects WHERE work_id=$%[1]d))", o.WorkID)
	}
	if o.ReleaseID != "" {
		add("id IN(SELECT id FROM catalog.mediums WHERE release_id=$%d)", o.ReleaseID)
	}
	if o.ContentUnitID != "" {
		add("id IN(SELECT id FROM catalog.expressions WHERE content_unit_id=$%d)", o.ContentUnitID)
	}
	if o.MediumID != "" {
		add("id IN(SELECT id FROM catalog.tracks WHERE medium_id=$%d)", o.MediumID)
	}
	if o.ParentID != "" {
		add("id IN(SELECT id FROM catalog.content_units WHERE parent_id=$%[1]d UNION ALL SELECT id FROM catalog.mediums WHERE parent_id=$%[1]d UNION ALL SELECT id FROM catalog.tracks WHERE parent_id=$%[1]d)", o.ParentID)
	}
	if o.Field != "" {
		v, err := s.Definitions(ctx)
		if err != nil {
			return nil, err
		}
		f, ok := v.Document.Fields[o.Field]
		if !ok || !f.Searchable {
			return nil, fmt.Errorf("field_not_searchable")
		}
		*args = append(*args, o.Field, o.Value)
		parts = append(parts, fmt.Sprintf("document->'attributes'->>$%d=$%d", len(*args)-1, len(*args)))
	}
	return parts, nil
}

// Count returns the real total for ListOptions over the same predicates List
// uses. List endpoints use it instead of len(items) so pagination totals stay
// exact as the dataset grows.
func (s *Store) Count(ctx context.Context, o ListOptions, u *User) (int64, error) {
	args := []any{}
	parts, err := listFilter(ctx, s, o, u, &args)
	if err != nil {
		return 0, err
	}
	var n int64
	err = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog.entities WHERE "+strings.Join(parts, " AND "), args...).Scan(&n)
	return n, err
}

func (s *Store) List(ctx context.Context, o ListOptions, u *User) ([]Entity, error) {
	args := []any{}
	parts, err := listFilter(ctx, s, o, u, &args)
	if err != nil {
		return nil, err
	}
	if o.Limit <= 0 || o.Limit > 100 {
		o.Limit = 50
	}
	if o.Offset < 0 {
		o.Offset = 0
	}
	args = append(args, o.Limit, o.Offset)
	orderClause := "updated_at DESC, id"
	if o.ReleaseID != "" || o.MediumID != "" || o.ParentID != "" || o.ContentUnitID != "" {
		orderClause = "(document->>'position')::int, updated_at DESC, id"
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT id FROM catalog.entities WHERE "+strings.Join(parts, " AND ")+fmt.Sprintf(" ORDER BY "+orderClause+" LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	items := []Entity{}
	for _, id := range ids {
		e, err := s.Get(ctx, id, u)
		if err != nil {
			return nil, err
		}
		items = append(items, e)
	}
	return items, nil
}
func (s *Store) Revisions(ctx context.Context, id string, u *User) ([]map[string]any, error) {
	if _, err := s.Get(ctx, id, u); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `
		SELECT r.id, r.version, COALESCE(r.actor_id::text, ''), COALESCE(u.username, 'system'), COALESCE(u.role, 'editor'), r.edit_note, r.sources, r.snapshot, r.created_at
		FROM catalog.revisions r
		LEFT JOIN catalog.users u ON u.id = r.actor_id
		WHERE r.target_id = $1
		ORDER BY r.version DESC, r.id DESC
		LIMIT 100`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var revID, version int64
		var actorID, actorName, actorRole, note string
		var sources, snapshot json.RawMessage
		var at time.Time
		if err = rows.Scan(&revID, &version, &actorID, &actorName, &actorRole, &note, &sources, &snapshot, &at); err != nil {
			return nil, err
		}
		var historical Entity
		if err = json.Unmarshal(snapshot, &historical); err != nil {
			return nil, err
		}
		if !visible(historical, u) {
			continue
		}
		out = append(out, map[string]any{
			"id":         revID,
			"version":    version,
			"actor_id":   actorID,
			"actor_name": actorName,
			"actor_role": actorRole,
			"edit_note":  note,
			"sources":    sources,
			"snapshot":   snapshot,
			"created_at": at,
		})
	}
	return out, rows.Err()
}

// ListAll is used for bounded entity directories, which must not silently truncate at 100.
func (s *Store) ListAll(ctx context.Context, o ListOptions, u *User) ([]Entity, error) {
	out := []Entity{}
	o.Limit = 100
	for {
		items, err := s.List(ctx, o, u)
		if err != nil {
			return nil, err
		}
		out = append(out, items...)
		if len(items) < o.Limit {
			return out, nil
		}
		o.Offset += o.Limit
	}
}
