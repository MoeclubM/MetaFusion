package catalogv2

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

func (s *Store) DefinitionVersions(ctx context.Context) ([]DefinitionVersion, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT id,state,base_version,document,created_at FROM catalog_v2.definitions ORDER BY id DESC LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DefinitionVersion{}
	for rows.Next() {
		var v DefinitionVersion
		var b []byte
		if err = rows.Scan(&v.ID, &v.State, &v.BaseVersion, &b, &v.CreatedAt); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(b, &v.Document); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) Draft(ctx context.Context, d Definitions, base int64, u User, note string, sources []Source) (int64, error) {
	var id int64
	err := s.write(ctx, func(tx *sql.Tx) error {
		if u.Role != "admin" {
			return fmt.Errorf("forbidden")
		}
		if err := validateSources(note, sources); err != nil {
			return err
		}
		if err := d.Validate(); err != nil {
			return err
		}
		v, err := definitions(ctx, tx)
		if err != nil {
			return err
		}
		if base != v.ID {
			return fmt.Errorf("version_conflict")
		}
		if err = tx.QueryRowContext(ctx, "INSERT INTO catalog_v2.definitions(state,base_version,document) VALUES('draft',$1,$2) RETURNING id", base, encode(d)).Scan(&id); err != nil {
			return err
		}
		return audit(ctx, tx, fmt.Sprintf("definitions:%d", id), id, u, note, sources, d, "definitions.drafted")
	})
	return id, err
}
func impact(ctx context.Context, q queryer, d Definitions) ([]string, error) {
	if err := d.Validate(); err != nil {
		return []string{err.Error()}, nil
	}
	rows, err := q.QueryContext(ctx, "SELECT id FROM catalog_v2.entities WHERE status NOT IN ('deleted','merged')")
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
	issues := []string{}
	admin := &User{Role: "admin"}
	ref := reference(ctx, q, admin)
	entities := map[string]Entity{}
	for _, id := range ids {
		e, err := get(ctx, q, id)
		if err != nil {
			return nil, err
		}
		entities[id] = e
		if err = d.validateEntity(e, ref, true); err != nil {
			issues = append(issues, id+": "+err.Error())
		}
	}
	all, err := relations(ctx, q)
	if err != nil {
		return nil, err
	}
	for _, r := range all {
		src, sok := entities[r.SourceID]
		tgt, tok := entities[r.TargetID]
		if !sok || !tok {
			continue
		}
		if err = validateRelation(d, r, src, tgt, all, ref, true); err != nil {
			issues = append(issues, r.ID+": "+err.Error())
		}
	}
	return issues, nil
}
func (s *Store) Impact(ctx context.Context, id int64) ([]string, error) {
	var b []byte
	var d Definitions
	if err := s.DB.QueryRowContext(ctx, "SELECT document FROM catalog_v2.definitions WHERE id=$1", id).Scan(&b); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, err
	}
	return impact(ctx, s.DB, d)
}
func (s *Store) Publish(ctx context.Context, id int64, u User, note string, sources []Source) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if u.Role != "admin" {
			return fmt.Errorf("forbidden")
		}
		if err := validateSources(note, sources); err != nil {
			return err
		}
		var b []byte
		var base int64
		var state string
		if err := tx.QueryRowContext(ctx, "SELECT state,base_version,document FROM catalog_v2.definitions WHERE id=$1", id).Scan(&state, &base, &b); err != nil {
			return err
		}
		current, err := definitions(ctx, tx)
		if err != nil {
			return err
		}
		if state != "draft" || current.ID != base {
			return fmt.Errorf("version_conflict")
		}
		var d Definitions
		if err = json.Unmarshal(b, &d); err != nil {
			return err
		}
		issues, err := impact(ctx, tx, d)
		if err != nil {
			return err
		}
		if len(issues) > 0 {
			return fmt.Errorf("definition_impact: %s", encode(issues))
		}
		if _, err = tx.ExecContext(ctx, "UPDATE catalog_v2.definitions SET state='superseded' WHERE state='published'"); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE catalog_v2.definitions SET state='published' WHERE id=$1", id); err != nil {
			return err
		}
		return audit(ctx, tx, fmt.Sprintf("definitions:%d", id), id, u, note, sources, d, "definitions.published")
	})
}
