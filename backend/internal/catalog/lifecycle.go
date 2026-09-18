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

// 状态机语义（当前实现，无 archived）：
//   - draft/pending_review：未发布，他人不可见（visible 仅主人/admin）；
//   - published：公开展示；降级只能走 admin-only Unpublish（published → draft）——
//     已发布条目不可经 Save 改回 draft（use_lifecycle_endpoint）；
//   - deleted/merged：主人仍可经 Get 直读（visible 对主人放行），公开 List
//     与匿名 Get 不可见；merged 经 Resolve 跟随 RedirectID。
// 本文件是**所有**状态跃迁的唯一入口：Save 拒绝 deleted/merged 与 published 降级，
// 因此状态列只会由 Lifecycle（删除/合并）与 Unpublish（下架）改写。
// archived 缺口：结构基线/validation.go/lifecycle.go 均无 archived 状态
// （全仓 grep archived 零命中）。归档语义（保留展示但冻结编辑）尚未设计，
// 不私自加状态；需要时由主代理另立规格。

func (s *Store) Lifecycle(ctx context.Context, id string, input LifecycleEdit, u User) (Entity, error) {
	var e Entity
	// 合并会改写关系端点与结构引用，必须与关系/结构写串行。
	err := s.writeStructural(ctx, func(tx *sql.Tx) error {
		if !u.Can(PermissionLifecycleManage) {
			return errForbidden
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
			return errVersionConflict
		}
		if e.Status == "merged" || e.Status == "deleted" {
			return errInvalidStatus
		}
		e.Version++
		e.Status = "deleted"
		e.UpdatedAt = time.Now().UTC()
		if input.TargetID != "" {
			target, err := get(ctx, tx, input.TargetID)
			if err != nil {
				return err
			}
			// 合并目标必须同 kind、同归属（Work/Release/Medium/ContentUnitID 均相等，
			// 含 ParentID）：跨父合并会撕裂层级，由复合外键在提交时拦截，
			// 此处提前报 invalid_merge_target。目标必须 published。
			if target.Kind != e.Kind || target.ID == e.ID || target.Status == "deleted" || target.Status == "merged" || target.WorkID != e.WorkID || target.ReleaseID != e.ReleaseID || target.MediumID != e.MediumID || target.ParentID != e.ParentID {
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
		// 与 Save 同一原则：版本条件进 WHERE，读版本与写入是同一次原子操作。
		// 本路径虽走结构串行通道，但非结构 kind 的 Save 不取该锁，两边仍会竞争同一行。
		var res sql.Result
		if res, err = tx.ExecContext(ctx, "UPDATE catalog.entities SET version=$3,status=$4,document=$5,updated_at=$6 WHERE id=$1 AND version=$2", e.ID, input.ExpectedVersion, e.Version, e.Status, encode(stored), e.UpdatedAt); err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errVersionConflict
		}
		return audit(ctx, tx, e.ID, e.Version, u, input.EditNote, input.Sources, e, "entity."+e.Status)
	})
	return e, err
}

// UnpublishEdit 是下架（published → draft）的请求体，字段与 LifecycleEdit 同口径，
// 但没有 target_id：下架只改自身状态，不指向别的实体。带上 target_id 会被 body 的
// DisallowUnknownFields 拒成 invalid_payload，而不是被静默忽略。
type UnpublishEdit struct {
	ExpectedVersion int64    `json:"expected_version"`
	EditNote        string   `json:"edit_note"`
	Sources         []Source `json:"sources"`
}

// Unpublish 把已发布条目退回草稿：状态机里**唯一**的降级入口。
//
// 与 Lifecycle 的分工只有状态机方向：Lifecycle 写终态 deleted/merged（公开不可见），
// 本方法只写 draft（未发布，创建者与 catalog.lifecycle.manage 持有者仍可见、可继续编辑）。
// 其余口径逐条对齐 Lifecycle：同一档权限、同一套证据校验（validateSources）、同一套留痕
// （修订行 + outbox 事件，写在同一事务）、同一套乐观并发（版本条件进 WHERE，读版本与写入
// 是一次原子操作），返回的也是与 Save 同形状的完整实体。
//
// 只接受 published → draft：draft/pending_review 没有可下架的内容，deleted/merged 是终态
// （要恢复只能新建），四种情况都返回 errInvalidStatus（400 invalid_status），不是 500。
//
// outbox 事件码固定为 entity.unpublished：它**不**落进 contributions 的 audit_actions
// 口径（那只数 entity.deleted / entity.merged，见 userContributionStats），下架不是清退，
// 不该让统计把它算成一次删除；修订行仍按 actor 快照列归属操作者，贡献流照常能查到。
func (s *Store) Unpublish(ctx context.Context, id string, input UnpublishEdit, u User) (Entity, error) {
	var e Entity
	// 与 Lifecycle 同走结构串行通道：待改的行可能属于结构 kind（篇目/载体/轨道），
	// 与结构写并发改同一行没有意义；乐观并发仍靠 WHERE 的版本条件兜底。
	err := s.writeStructural(ctx, func(tx *sql.Tx) error {
		if !u.Can(PermissionLifecycleManage) {
			return errForbidden
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
			return errVersionConflict
		}
		if e.Status != "published" {
			return errInvalidStatus
		}
		e.Version++
		e.Status = "draft"
		e.UpdatedAt = time.Now().UTC()
		stored := e
		stored.WorkID = ""
		stored.ContentUnitID = ""
		stored.ReleaseID = ""
		stored.MediumID = ""
		stored.ParentID = ""
		stored.Contents = nil
		stored.Subjects = nil
		// redirect_id 不动：Save 拒绝 RedirectID != ""，能走到这里的 published 行本就没有重定向。
		var res sql.Result
		if res, err = tx.ExecContext(ctx, "UPDATE catalog.entities SET version=$3,status=$4,document=$5,updated_at=$6 WHERE id=$1 AND version=$2", e.ID, input.ExpectedVersion, e.Version, e.Status, encode(stored), e.UpdatedAt); err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errVersionConflict
		}
		return audit(ctx, tx, e.ID, e.Version, u, input.EditNote, input.Sources, e, "entity.unpublished")
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
// **当前没有跨服务消费者**: 生产代码里没有调用点(只有 store_test.go), 子系统对
// 合并结果的收敛靠调用方主动查询目录接口(如 GET /api/catalog/entities/{id}/resolve),
// 所以 entity.merged 只是写在 outbox 里, 不是"广播"。
// 本函数、deliveries 去重与"回调按 Event.ID 幂等"是**将来引入投递时的契约**:
// 保留它是为了让那条契约有承载物, 不代表现在有投递在跑。
// 保留策略: outbox/deliveries 暂不清, 因事件是审计与将来消费的唯一事实来源,
// 删事件会断 deliveries 外键且丢审计。TODO(三期): 先给 deliveries 加
// delivered_at 分区/保留期再清已全消费事件; 当前无消费者, 不存在堆积问题。
// 并发说明: 假定单进程单轮询, 无 SKIP LOCKED/FOR UPDATE; 若未来多副本消费,
// 需按 consumer 分片或加领取列, 不在此先加。
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
