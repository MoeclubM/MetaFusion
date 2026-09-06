package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"sort"
)

func relations(ctx context.Context, q queryer) ([]Relation, error) {
	rows, err := q.QueryContext(ctx, "SELECT document FROM catalog.relations ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Relation{}
	for rows.Next() {
		var b []byte
		var r Relation
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(b, &r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Store) Relations(ctx context.Context, id string, u *User) ([]Relation, error) {
	if _, err := s.Get(ctx, id, u); err != nil {
		return nil, err
	}
	all, err := relations(ctx, s.DB)
	if err != nil {
		return nil, err
	}
	out := []Relation{}
	d, err := s.Definitions(ctx)
	if err != nil {
		return nil, err
	}
	for _, r := range all {
		if r.SourceID != id && r.TargetID != id {
			continue
		}
		if _, err := s.Get(ctx, r.SourceID, u); err != nil {
			continue
		}
		if _, err := s.Get(ctx, r.TargetID, u); err != nil {
			continue
		}
		if err := d.Document.attributes(d.Document.Relations[r.Type].Fields, r.Attributes, reference(ctx, s.DB, u), true); err != nil {
			continue
		}
		out = append(out, r)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}
func validateRelation(d Definitions, r Relation, src, tgt Entity, existing []Relation, ref func(string, []string) error, historical bool) error {
	rt, ok := d.Relations[r.Type]
	if !ok || !historical && !rt.Enabled {
		return fmt.Errorf("invalid_relation_type")
	}
	if r.SourceID == r.TargetID || !contains(rt.SourceKinds, src.Kind) || !contains(rt.TargetKinds, tgt.Kind) {
		return fmt.Errorf("invalid_endpoints")
	}
	if r.Position < 0 {
		return fmt.Errorf("invalid_position")
	}
	matches := func(allowed, actual []string) bool {
		if len(allowed) == 0 {
			return true
		}
		for _, x := range actual {
			if contains(allowed, x) {
				return true
			}
		}
		return false
	}
	if !matches(rt.SourceTypes, src.Types) || !matches(rt.TargetTypes, tgt.Types) {
		return fmt.Errorf("invalid_endpoint_types")
	}
	if err := d.attributes(rt.Fields, r.Attributes, ref, historical); err != nil {
		return err
	}
	incoming, outgoing := 0, 0
	graph := map[string][]string{}
	for _, x := range existing {
		if x.ID == r.ID || x.Type != r.Type {
			continue
		}
		graph[x.SourceID] = append(graph[x.SourceID], x.TargetID)
		if x.SourceID == r.SourceID {
			outgoing++
		}
		if x.TargetID == r.TargetID {
			incoming++
		}
		if (x.SourceID == r.SourceID && x.TargetID == r.TargetID || rt.Symmetric && x.SourceID == r.TargetID && x.TargetID == r.SourceID) && encode(x.Attributes) == encode(r.Attributes) {
			return fmt.Errorf("duplicate_relation")
		}
	}
	if rt.MaxOutgoing > 0 && outgoing >= rt.MaxOutgoing || rt.MaxIncoming > 0 && incoming >= rt.MaxIncoming {
		return fmt.Errorf("cardinality_exceeded")
	}
	if rt.Acyclic {
		stack := []string{r.TargetID}
		seen := map[string]bool{}
		for len(stack) > 0 {
			id := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if id == r.SourceID {
				return fmt.Errorf("relation_cycle")
			}
			if !seen[id] {
				seen[id] = true
				stack = append(stack, graph[id]...)
			}
		}
	}
	return nil
}
func (s *Store) SaveRelation(ctx context.Context, input RelationEdit, u User) (Relation, error) {
	r := input.Relation
	err := s.write(ctx, func(tx *sql.Tx) error {
		if err := validateSources(input.EditNote, input.Sources); err != nil {
			return err
		}
		v, err := definitions(ctx, tx)
		if err != nil {
			return err
		}
		all, err := relations(ctx, tx)
		if err != nil {
			return err
		}
		var old *Relation
		if r.ID == "" {
			if input.ExpectedVersion != 0 {
				return fmt.Errorf("version_conflict")
			}
			r.ID = uuid.NewString()
			r.Version = 1
		} else {
			for i := range all {
				if all[i].ID == r.ID {
					old = &all[i]
				}
			}
			if old == nil {
				return sql.ErrNoRows
			}
			if old.Version != input.ExpectedVersion {
				return fmt.Errorf("version_conflict")
			}
			if old.SourceID != r.SourceID || old.TargetID != r.TargetID || old.Type != r.Type {
				return fmt.Errorf("immutable_scope")
			}
			r.Version = old.Version + 1
		}
		src, err := get(ctx, tx, r.SourceID)
		if err != nil {
			return err
		}
		tgt, err := get(ctx, tx, r.TargetID)
		if err != nil {
			return err
		}
		if !visible(src, &u) || !visible(tgt, &u) || src.Status == "deleted" || src.Status == "merged" || tgt.Status == "deleted" || tgt.Status == "merged" {
			return fmt.Errorf("forbidden")
		}
		if u.Role != "admin" && (src.CreatedBy != u.ID || src.Status == "published") {
			return fmt.Errorf("forbidden")
		}
		if err = validateRelation(v.Document, r, src, tgt, all, reference(ctx, tx, &u), true); err != nil {
			return err
		}
		if !v.Document.Relations[r.Type].Enabled && old == nil {
			return fmt.Errorf("disabled_relation_type")
		}
		var previous map[string]any
		if old != nil {
			previous = old.Attributes
		}
		if err = v.Document.retiredAttributes(r.Attributes, previous); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO catalog.relations(id,version,type,source_id,target_id,document) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,document=EXCLUDED.document", r.ID, r.Version, r.Type, r.SourceID, r.TargetID, encode(r)); err != nil {
			return err
		}
		return audit(ctx, tx, r.ID, r.Version, u, input.EditNote, input.Sources, r, "relation.saved")
	})
	return r, err
}
func (s *Store) DeleteRelation(ctx context.Context, id string, expected int64, note string, sources []Source, u User) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if err := validateSources(note, sources); err != nil {
			return err
		}
		var b []byte
		var r Relation
		if err := tx.QueryRowContext(ctx, "SELECT document FROM catalog.relations WHERE id=$1", id).Scan(&b); err != nil {
			return err
		}
		if err := json.Unmarshal(b, &r); err != nil {
			return err
		}
		if expected != r.Version {
			return fmt.Errorf("version_conflict")
		}
		src, err := get(ctx, tx, r.SourceID)
		if err != nil {
			return err
		}
		if u.Role != "admin" && (src.CreatedBy != u.ID || src.Status == "published") {
			return fmt.Errorf("forbidden")
		}
		if _, err = tx.ExecContext(ctx, "DELETE FROM catalog.relations WHERE id=$1", id); err != nil {
			return err
		}
		return audit(ctx, tx, id, r.Version+1, u, note, sources, r, "relation.deleted")
	})
}
func (s *Store) Occurrences(ctx context.Context, id string, u *User) ([]map[string]any, error) {
	e, err := s.Get(ctx, id, u)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT c.track_id,m.id,m.release_id,c.expression_id,c.position,c.locator FROM catalog.track_contents c JOIN catalog.tracks t ON t.id=c.track_id JOIN catalog.mediums m ON m.id=t.medium_id JOIN catalog.expressions x ON x.id=c.expression_id WHERE x.id=$1 OR x.work_id=$1 OR x.content_unit_id=$1 ORDER BY m.release_id,c.position`, e.ID)
	if err != nil {
		return nil, err
	}
	type row struct {
		track, medium, release, expr string
		pos                          int
		loc                          json.RawMessage
	}
	var records []row
	for rows.Next() {
		var r row
		if err = rows.Scan(&r.track, &r.medium, &r.release, &r.expr, &r.pos, &r.loc); err != nil {
			rows.Close()
			return nil, err
		}
		records = append(records, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, r := range records {
		rel, err := s.Get(ctx, r.release, u)
		if err != nil {
			continue
		}
		med, err := s.Get(ctx, r.medium, u)
		if err != nil {
			continue
		}
		track, err := s.Get(ctx, r.track, u)
		if err != nil {
			continue
		}
		out = append(out, map[string]any{"release": rel, "medium": med, "track": track, "expression_id": r.expr, "position": r.pos, "locator": r.loc})
	}
	return out, nil
}

// Compare returns exact release structure and only comparable metadata fields.
func (s *Store) Compare(ctx context.Context, ids []string, u *User) ([]map[string]any, error) {
	if len(ids) < 2 || len(ids) > 6 {
		return nil, fmt.Errorf("compare_requires_two_to_six")
	}
	d, err := s.Definitions(ctx)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, id := range ids {
		e, err := s.Get(ctx, id, u)
		if err != nil {
			return nil, err
		}
		if e.Kind != "release" {
			return nil, fmt.Errorf("invalid_kind")
		}
		attrs := map[string]any{}
		for k, v := range e.Attributes {
			if d.Document.Fields[k].Comparable {
				attrs[k] = v
			}
		}
		e.Attributes = attrs
		media, err := s.ListAll(ctx, ListOptions{ReleaseID: id}, u)
		if err != nil {
			return nil, err
		}
		rows := []map[string]any{}
		for _, m := range media {
			tracks, err := s.ListAll(ctx, ListOptions{MediumID: m.ID}, u)
			if err != nil {
				return nil, err
			}
			rows = append(rows, map[string]any{"medium": m, "tracks": tracks})
		}
		out = append(out, map[string]any{"release": e, "media": rows})
	}
	return out, nil
}
