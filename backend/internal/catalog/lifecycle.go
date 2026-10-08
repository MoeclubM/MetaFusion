package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/lib/pq"
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
// 本文件负责终态与发布后的降级。Save 与 Track 的专用状态写入共用状态门禁，
// 不能代替 Lifecycle（删除/合并）或 Unpublish（下架）。
// 归档（保留展示但冻结编辑）尚未设计，不属于当前状态机。

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
		// 纯删除（非合并）级联清理关系边：实体作为 source 或 target 的边都不再有意义。
		// 合并分支由 mergeReferences 把端点改写到 target，不能在这里重复删。
		// 不逐条记 relation.deleted 审计——entity.deleted 的修订已留痕，边是其级联后果。
		if input.TargetID == "" {
			if _, err = tx.ExecContext(ctx, "DELETE FROM catalog.relations WHERE source_id=$1 OR target_id=$1", e.ID); err != nil {
				return err
			}
		}
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

// IdentityResolution 是目录侧统一身份解析契约（X01）：canonical_id 为存活身份，
// aliases 为历史别名集合（merged 链上依次经过的旧 ID，含请求 ID 自身若已合并）。
// 新写入归一：reference() 拒绝 merged/deleted 行的引用，调用方先经本契约
// （GET /api/catalog/entities/{id}/identity，批量走 POST /api/catalog/entities/identity）
// 拿到 canonical 再写；读取汇别名：Occurrences 等读路径先 Resolve 到存活身份再聚合。
// 跨服务（文件/评论/收藏）按别名集合聚合，不直接写别人的库；outbox 的
// entity.merged 仍是唯一的跨服务事实来源（见 merge.go），批量端点只是它的只读投影。
type IdentityResolution struct {
	CanonicalID string   `json:"canonical_id"`
	Aliases     []string `json:"aliases"`
	Entity      Entity   `json:"entity"`
	// Complete 为真表示别名集合是全集（反向遍历全部成功）。跨服务聚合只能在
	// complete=true 时按全集收敛；失败路径返回 error 且 complete=false，调用方不得
	// 把部分结果当全集用（R2：此前 Query/Scan 失败会伪装成成功的部分结果）。
	Complete bool `json:"complete"`
}

// errRedirectCycle 是循环重定向的稳定码：哨兵化以便调用方 errors.Is 区分
// "不存在"与"查询失败"（见 isIdentityNotFound），文本与此前一致。
var errRedirectCycle = errors.New("redirect_cycle")

// isIdentityNotFound 报告身份解析错误是否属于"不存在"（未知 ID、不可见终点、循环链）：
// 批量端点按此进 missing；其它错误（超时、中断、连接失败）是查询失败，必须整批 500。
func isIdentityNotFound(err error) bool {
	return errors.Is(err, sql.ErrNoRows) || errors.Is(err, errRedirectCycle)
}

// ResolveIdentity 跟随 merged 链并收集别名：循环重定向报 redirect_cycle；
// 终点不可见按不存在处理，与 Resolve 同口径（同为 404 not_found）。
// 别名集合含两部分（去重）：向前链上依次经过的旧 ID，以及存活身份的全部历史别名
// （反向遍历 redirect 边，见 reverseAliases）：A→C、B→C、C→D 后从 D 可枚举 A/B/C，
// 分支合并与多跳链一次收齐。跨服务（文件/评论/收藏）按此集合聚合。
func (s *Store) ResolveIdentity(ctx context.Context, id string, u *User) (IdentityResolution, error) {
	var out IdentityResolution
	seen := map[string]bool{}
	cur := id
	for {
		if seen[cur] {
			return out, errRedirectCycle
		}
		seen[cur] = true
		e, err := get(ctx, s.DB, cur)
		if err != nil {
			return out, err
		}
		if e.Status == "merged" {
			out.Aliases = append(out.Aliases, cur)
			cur = e.RedirectID
			continue
		}
		if !visible(e, u) {
			return out, sql.ErrNoRows
		}
		e, err = visibleEntityContents(ctx, s.DB, e, u)
		if err != nil {
			return out, err
		}
		out.CanonicalID, out.Entity = e.ID, e
		extra, err := s.reverseAliases(ctx, e.ID, seen)
		if err != nil {
			return out, err
		}
		out.Aliases = append(out.Aliases, extra...)
		out.Complete = true
		return out, nil
	}
}

// reverseAliases 从存活身份反向枚举全部历史别名：逐层查直接指向本层节点的 merged 行
// （document->>'redirect_id'，按 ANY($1) 批量查一层，见 000008 的表达式索引；
// redirect_id 列已随 000004 删除）。向前链已收集的只去重不丢弃：已见节点仍要展开
// （其上游可能不在向前链上，如 X→A→C 时从 A 查必须带回 X），增补部分排序后返回
// （确定性顺序）；环数据由 visited 截断（向前链的 redirect_cycle 仍由主循环报）。
//
// R2：Query/Scan/rows.Err 的任何失败都返回 error，不再伪装成成功的部分结果。
// 调用方用 isIdentityNotFound 区分"不存在"与"查询失败"。
func (s *Store) reverseAliases(ctx context.Context, canonical string, seen map[string]bool) ([]string, error) {
	visited := map[string]bool{canonical: true}
	extra := []string{}
	frontier := []string{canonical}
	for len(frontier) > 0 {
		rows, err := s.DB.QueryContext(ctx, `SELECT id::text FROM catalog.entities WHERE status='merged' AND document->>'redirect_id' = ANY($1::text[])`, pq.Array(frontier))
		if err != nil {
			return nil, err
		}
		var next []string
		scanErr := func() error {
			defer rows.Close()
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					return err
				}
				if visited[id] {
					continue
				}
				visited[id] = true
				next = append(next, id)
				if !seen[id] {
					extra = append(extra, id)
				}
			}
			return rows.Err()
		}()
		if scanErr != nil {
			return nil, scanErr
		}
		frontier = next
	}
	sort.Strings(extra)
	return extra, nil
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
		return visibleEntityContents(ctx, s.DB, e, u)
	}
	return Entity{}, errRedirectCycle
}
