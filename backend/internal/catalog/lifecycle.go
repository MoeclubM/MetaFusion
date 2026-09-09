package catalog

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"
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
		if _, err = tx.ExecContext(ctx, "UPDATE catalog.entities SET version=$2,status=$3,redirect_id=$4,document=$5,updated_at=$6 WHERE id=$1", e.ID, e.Version, e.Status, nullable(e.RedirectID), encode(stored), e.UpdatedAt); err != nil {
			return err
		}
		return audit(ctx, tx, e.ID, e.Version, u, input.EditNote, input.Sources, e, "entity."+e.Status)
	})
	return e, err
}

// deliverAttempts 是内存重试计数: consumer+"\x00"+eventID -> 连续失败次数。
// 指数退避仅内存提示(日志中的下次建议延迟), 不改 deliveries 表结构。
// TODO(三期): deliveries 表加 attempts/next_retry_at 持久列, 实现跨进程与
// 重启可恢复的退避调度与死信队列; 当前进程重启后计数清零, 靠 outbox 全量
// 未 ack 事件天然重试, 不丢事件。
var (
	deliverMu       sync.Mutex
	deliverAttempts = map[string]int{}
)

// deliverBackoff 按连续失败次数给指数退避建议延迟, 上限 5 分钟。
func deliverBackoff(n int) time.Duration {
	if n <= 0 {
		return 0
	}
	d := 5 * time.Second
	for i := 1; i < n && d < 5*time.Minute; i++ {
		d *= 2
	}
	if d > 5*time.Minute {
		return 5 * time.Minute
	}
	return d
}

// Deliver acknowledges only successful callbacks. Callbacks must be idempotent by Event.ID.
// 同批投递失败跳过继续: 记日志(含事件 ID+错误), 不中断整批; 失败事件不写
// deliveries, 下次继续投递。批内有部分失败时返回汇总错误, 便于调用方重试整批。
func (s *Store) Deliver(ctx context.Context, consumer string, handle func(context.Context, Event) error) error {
	rows, err := s.DB.QueryContext(ctx, `SELECT id,type,entity_id,version,payload,created_at FROM catalog.outbox o WHERE NOT EXISTS(SELECT 1 FROM catalog.deliveries d WHERE d.consumer=$1 AND d.event_id=o.id) ORDER BY created_at,id LIMIT 100`, consumer)
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
	var failed []string
	var firstErr error
	for _, e := range events {
		if err = handle(ctx, e); err != nil {
			key := consumer + "\x00" + e.ID
			deliverMu.Lock()
			deliverAttempts[key]++
			n := deliverAttempts[key]
			deliverMu.Unlock()
			log.Printf("catalog deliver skip consumer=%s event=%s attempt=%d next_backoff=%s err=%v", consumer, e.ID, n, deliverBackoff(n), err)
			failed = append(failed, e.ID)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		key := consumer + "\x00" + e.ID
		deliverMu.Lock()
		delete(deliverAttempts, key)
		deliverMu.Unlock()
		if _, err = s.DB.ExecContext(ctx, "INSERT INTO catalog.deliveries(consumer,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING", consumer, e.ID); err != nil {
			return err
		}
	}
	if firstErr != nil {
		return fmt.Errorf("delivery_partial: %d/%d failed: %w", len(failed), len(events), firstErr)
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
