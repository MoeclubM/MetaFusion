package catalogv2

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type LifecycleEdit struct {
	ExpectedVersion int64    `json:"expected_version"`
	TargetID        string   `json:"target_id"`
	EditNote        string   `json:"edit_note"`
	Sources         []Source `json:"sources"`
}

func (s *Store) Lifecycle(ctx context.Context, id string, input LifecycleEdit, u User) (Entity, error) {
	var e Entity
	err := s.write(ctx, func(tx *sql.Tx) error {
		if u.Role != "admin" {
			return fmt.Errorf("forbidden")
		}
		if err := validateSources(input.EditNote, input.Sources); err != nil {
			return err
		}
		var err error
		e, err = get(ctx, tx, id)
		if err != nil {
			return err
		}
		if e.Version != input.ExpectedVersion {
			return fmt.Errorf("version_conflict")
		}
		if e.Status == "merged" || e.Status == "deleted" {
			return fmt.Errorf("invalid_status")
		}
		e.Version++
		e.Status = "deleted"
		e.UpdatedAt = time.Now().UTC()
		if input.TargetID != "" {
			target, err := get(ctx, tx, input.TargetID)
			if err != nil {
				return err
			}
			if target.Kind != e.Kind || target.ID == e.ID || target.Status == "deleted" || target.Status == "merged" || target.WorkID != e.WorkID || target.ReleaseID != e.ReleaseID || target.MediumID != e.MediumID {
				return fmt.Errorf("invalid_merge_target")
			}
			e.RedirectID = target.ID
			e.Status = "merged"
			if target.ContentUnitID != e.ContentUnitID || target.Status != "published" {
				return fmt.Errorf("invalid_merge_target")
			}
			if err = mergeReferences(ctx, tx, e, target, u, input); err != nil {
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
		if _, err = tx.ExecContext(ctx, "UPDATE catalog_v2.entities SET version=$2,status=$3,redirect_id=$4,document=$5,updated_at=$6 WHERE id=$1", e.ID, e.Version, e.Status, nullable(e.RedirectID), encode(stored), e.UpdatedAt); err != nil {
			return err
		}
		return audit(ctx, tx, e.ID, e.Version, u, input.EditNote, input.Sources, e, "entity."+e.Status)
	})
	return e, err
}

// Deliver acknowledges only successful callbacks. Callbacks must be idempotent by Event.ID.
func (s *Store) Deliver(ctx context.Context, consumer string, handle func(context.Context, Event) error) error {
	rows, err := s.DB.QueryContext(ctx, `SELECT id,type,entity_id,version,payload,created_at FROM catalog_v2.outbox o WHERE NOT EXISTS(SELECT 1 FROM catalog_v2.deliveries d WHERE d.consumer=$1 AND d.event_id=o.id) ORDER BY created_at,id LIMIT 100`, consumer)
	if err != nil {
		return err
	}
	var events []Event
	for rows.Next() {
		var e Event
		if err = rows.Scan(&e.ID, &e.Type, &e.EntityID, &e.Version, &e.Payload, &e.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		events = append(events, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, e := range events {
		if err = handle(ctx, e); err != nil {
			return err
		}
		if _, err = s.DB.ExecContext(ctx, "INSERT INTO catalog_v2.deliveries(consumer,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING", consumer, e.ID); err != nil {
			return err
		}
	}
	return nil
}

// Resolve preserves old identifiers without rewriting the evidence of a merge.
func (s *Store) Resolve(ctx context.Context, id string, u *User) (Entity, error) {
	seen := map[string]bool{}
	for !seen[id] {
		seen[id] = true
		e, err := get(ctx, s.DB, id)
		if err != nil {
			return e, err
		}
		if e.Status == "merged" {
			id = e.RedirectID
			continue
		}
		if !visible(e, u) {
			return Entity{}, sql.ErrNoRows
		}
		return e, nil
	}
	return Entity{}, fmt.Errorf("redirect_cycle")
}
