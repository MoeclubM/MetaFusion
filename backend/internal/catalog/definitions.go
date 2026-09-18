package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/lib/pq"
)

// DefinitionVersions 返回最近一批定义版本（后台列表用）。
// 列表项在既有字段之外补 created_by 与 summary：起草身份只在修订表里（见 revisionActors），
// 摘要只给各分区的条目数，客户端不必为了显示"这一版有几条定义"而展开整份 document。
//
// includeDocument=false 时连同文档一起瘦身：SQL 不取 document 列（只取四个分区的键数），
// 列表项也不带 document 键——单版本数十 KB、LIMIT 100 下这是 MB 级响应的来源。
// 摘要文本与带文档时逐字相同（definitionSummaryCounts）。
func (s *Store) DefinitionVersions(ctx context.Context, includeDocument bool) ([]DefinitionVersionItem, error) {
	// 分区计数在库里算：数对象键的个数，与 len(map) 同口径（服务器没有 jsonb_object_length，
	// 用 jsonb_object_keys 的 count 子查询；分区缺失时 -> 为 NULL，jsonb_object_keys 返回 0 行即 0）。
	columns := "id,state,base_version,created_at," +
		"(select count(*) from jsonb_object_keys(document->'fields'))," +
		"(select count(*) from jsonb_object_keys(document->'types'))," +
		"(select count(*) from jsonb_object_keys(document->'relations'))," +
		"(select count(*) from jsonb_object_keys(document->'templates'))"
	if includeDocument {
		columns = "id,state,base_version,created_at,document"
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT "+columns+" FROM catalog.definitions ORDER BY id DESC LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DefinitionVersionItem{}
	targets := []string{}
	for rows.Next() {
		var v DefinitionVersionItem
		if includeDocument {
			var b []byte
			if err = rows.Scan(&v.ID, &v.State, &v.BaseVersion, &v.CreatedAt, &b); err != nil {
				return nil, err
			}
			var d Definitions
			if err = json.Unmarshal(b, &d); err != nil {
				return nil, err
			}
			v.Document, v.Summary = &d, definitionSummary(d)
		} else {
			var fields, types, relations, templates int
			if err = rows.Scan(&v.ID, &v.State, &v.BaseVersion, &v.CreatedAt, &fields, &types, &relations, &templates); err != nil {
				return nil, err
			}
			v.Summary = definitionSummaryCounts(fields, types, relations, templates)
		}
		targets = append(targets, definitionRevisionTarget(v.ID))
		out = append(out, v)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	actors, err := revisionActors(ctx, s.DB, targets)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].CreatedBy = actors[definitionRevisionTarget(out[i].ID)]
	}
	return out, nil
}

// definitionSummary 生成列表用的短摘要：只报各分区条目数，顺序固定便于前端直接展示与断言。
func definitionSummary(d Definitions) string {
	return definitionSummaryCounts(len(d.Fields), len(d.Types), len(d.Relations), len(d.Templates))
}

// definitionSummaryCounts 是摘要的唯一格式来源：不走文档的列表查询在库里数出计数，
// 两条路径的摘要文本必须逐字一致，否则同一版本会随 include_document 给出两种摘要。
func definitionSummaryCounts(fields, types, relations, templates int) string {
	return fmt.Sprintf("字段 %d / 类型 %d / 关系 %d / 模板 %d", fields, types, relations, templates)
}

// definitionRevisionTarget 是定义版本在修订/发件箱里使用的 target_id（见 audit 调用点）。
func definitionRevisionTarget(id int64) string { return fmt.Sprintf("definitions:%d", id) }

// revisionActors 取每个 target 最早的修订行演员名：最早一条就是起草那次，
// 与创建者语义一致（后续发布/回滚不改变创建者）。没有修订记录的 target 不出现在结果里。
func revisionActors(ctx context.Context, q queryer, targets []string) (map[string]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT target_id,actor_name FROM catalog.revisions WHERE target_id = ANY($1) ORDER BY id", pq.Array(targets))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var target, actor string
		if err = rows.Scan(&target, &actor); err != nil {
			return nil, err
		}
		if _, seen := out[target]; !seen {
			out[target] = actor
		}
	}
	return out, rows.Err()
}

// definitionVersion 读任意一条定义版本行（含 superseded/draft），不存在时返回 sql.ErrNoRows（HTTP 404）。
func (s *Store) definitionVersion(ctx context.Context, id int64) (DefinitionVersion, error) {
	var v DefinitionVersion
	var b []byte
	err := s.DB.QueryRowContext(ctx, "SELECT id,state,base_version,document,created_at FROM catalog.definitions WHERE id=$1", id).Scan(&v.ID, &v.State, &v.BaseVersion, &b, &v.CreatedAt)
	if err == nil {
		err = json.Unmarshal(b, &v.Document)
	}
	return v, err
}

// DefinitionDetail 读单个定义版本（任意 state，含 superseded/draft）的完整文档与元数据：
// 列表用 include_document=false 瘦身之后，前端点某一版就按 id 调这里取该版本文档。
// summary/created_by 与列表项同一口径（摘要同一格式来源，身份同取最早一条修订）。
// 不存在的 id 由 definitionVersion 返回 sql.ErrNoRows，HTTP 侧就是 404。
func (s *Store) DefinitionDetail(ctx context.Context, id int64) (DefinitionVersion, error) {
	v, err := s.definitionVersion(ctx, id)
	if err != nil {
		return v, err
	}
	v.Summary = definitionSummary(v.Document)
	actors, err := revisionActors(ctx, s.DB, []string{definitionRevisionTarget(id)})
	if err != nil {
		return v, err
	}
	v.CreatedBy = actors[definitionRevisionTarget(id)]
	return v, nil
}

// rollbackEvidence 取目标版本自己的编辑说明与来源，作为回滚版本的证据链：
// 说明里带上原说明，来源原样保留（validateSources 要求至少一条来源）。
// 目标行若是种子播种或直接写库（没有修订记录），说明退化为只记版本号、来源退化为一条自述来源——
// 空手回滚会被 Draft 以 evidence_required 拒绝。
func rollbackEvidence(ctx context.Context, q queryer, target int64) (string, []Source) {
	var note string
	var raw []byte
	var sources []Source
	if err := q.QueryRowContext(ctx, "SELECT edit_note,sources FROM catalog.revisions WHERE target_id=$1 ORDER BY id LIMIT 1", definitionRevisionTarget(target)).Scan(&note, &raw); err == nil {
		if e := json.Unmarshal(raw, &sources); e != nil {
			sources = nil
		}
	}
	if strings.TrimSpace(note) == "" {
		note = fmt.Sprintf("版本 %d 无编辑说明记录", target)
	}
	out := fmt.Sprintf("回滚定义到版本 %d（原编辑说明：%s）", target, note)
	if len(sources) == 0 {
		sources = []Source{{Kind: "self", Citation: fmt.Sprintf("回滚定义到版本 %d：该版本没有来源记录（catalog.definitions id=%d）", target, target)}}
	}
	return out, sources
}

// RollbackDefinitions 把指定历史版本（任意 state，含 superseded）的文档以当前已发布版本为 base
// 重新起草并发布：不原地改历史行，回滚本身就是一个新版本。链路完全复用 Draft + Publish，
// 生效与否由 Publish 事务内的 impact 全量校验决定（见 definitions.go 顶部的并发说明）。
//
// 起草前先只读跑一次 impact：草稿行不可删除，若跳过预检，回滚一份非法文档会在版本表里
// 留下一颗永远发不出去的草稿。预检失败零写入；Publish 事务内再校验一次，不会因预检放宽。
//
// 目标文档与当前已发布文档完全一致时不写库：返回既有已发布版本并置 no_op。
func (s *Store) RollbackDefinitions(ctx context.Context, target int64, u User) (DefinitionRollback, error) {
	out := DefinitionRollback{TargetID: target}
	if !u.Can(PermissionDefinitionsManage) {
		return out, errForbidden
	}
	tv, err := s.definitionVersion(ctx, target)
	if err != nil {
		return out, err
	}
	cur, err := s.Definitions(ctx)
	if err != nil {
		return out, err
	}
	// 整份文档比较走 encode（json.Marshal 对 map 键排序），与 jsonb 等值同口径：不受键顺序影响。
	if encode(tv.Document) == encode(cur.Document) {
		out.ID, out.State, out.BaseVersion, out.CreatedAt = cur.ID, cur.State, cur.BaseVersion, cur.CreatedAt
		out.NoOp = true
		return out, nil
	}
	note, sources := rollbackEvidence(ctx, s.DB, target)
	pre, err := impact(ctx, s.DB, tv.Document)
	if err != nil {
		return out, err
	}
	if len(pre.Issues) > 0 {
		return out, fmt.Errorf("definition_impact: %s", encode(pre.Issues))
	}
	logDangling("rollback impact", pre.Dangling)
	id, err := s.Draft(ctx, tv.Document, cur.ID, u, note, sources)
	if err != nil {
		return out, err
	}
	if err = s.Publish(ctx, id, u, note, sources); err != nil {
		return out, err
	}
	nv, err := s.definitionVersion(ctx, id)
	if err != nil {
		return out, err
	}
	out.ID, out.State, out.BaseVersion, out.CreatedAt, out.EditNote = nv.ID, nv.State, nv.BaseVersion, nv.CreatedAt, note
	return out, nil
}
func (s *Store) Draft(ctx context.Context, d Definitions, base int64, u User, note string, sources []Source) (int64, error) {
	var id int64
	err := s.write(ctx, func(tx *sql.Tx) error {
		if !u.Can(PermissionDefinitionsManage) {
			return errForbidden
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
			return errVersionConflict
		}
		if err = tx.QueryRowContext(ctx, "INSERT INTO catalog.definitions(state,base_version,document) VALUES('draft',$1,$2) RETURNING id", base, encode(d)).Scan(&id); err != nil {
			return err
		}
		return audit(ctx, tx, definitionRevisionTarget(id), id, u, note, sources, d, "definitions.drafted")
	})
	return id, err
}

// impact 的全量回放与两类问题的处置口径见 impact.go（定义问题阻断、悬挂引用只警告）。
// EnsureSeedDefinitions 把种子里新增的定义补进当前已发布定义（只增不改，见 mergeSeedDefinitions）。
// 没有任何新增时不写库：幂等，避免每次启动都多出一个定义版本。
// 以系统身份起草并发布，说明里列出新增键，便于在修订历史里追溯这次模板更新的来源。
func (s *Store) EnsureSeedDefinitions(ctx context.Context) error {
	v, err := s.Definitions(ctx)
	if err != nil {
		return err
	}
	merged, added := mergeSeedDefinitions(v.Document, Defaults())
	if len(added) == 0 {
		log.Printf("definition seed merge: 无新增（当前已发布版本 id=%d）", v.ID)
		return nil
	}
	log.Printf("definition seed merge: 将补入 %d 项：%v", len(added), added)
	// 审计的 created_by 是 uuid 列：系统身份用全零 UUID（约定俗成），
	// 不能写字面量 "system"——那会以 invalid input syntax for type uuid 失败。
	sys := User{ID: "00000000-0000-0000-0000-000000000000", Username: "system", Role: "admin", Permissions: []string{PermissionDefinitionsManage}}
	note := "启动时合并新增的种子定义（只增不改）：" + strings.Join(added, "、")
	sources := []Source{{Kind: "url", URL: "https://github.com/MoeclubM/MetaFusion", Citation: "种子定义合并：backend/internal/catalog/defaults.go"}}
	id, err := s.Draft(ctx, merged, v.ID, sys, note, sources)
	if err != nil {
		return err
	}
	return s.Publish(ctx, id, sys, note, sources)
}

// 并发口径：发布走 s.write（**不取** advisory 锁，见 store.go 的 write/writeStructural），
// 与其它写事务并行。两个并发发布不会同时生效：让位语句把 base（= 当前已发布版本 id）
// 写进 WHERE 做条件更新，后到者在行锁释放后重算条件、版本已换 → 0 行 → version_conflict，
// 而不是反向依赖 one_published_definition 唯一索引报 constraint_violation。impact 全量校验
// 在本事务快照内执行，"校验看到的快照"与"发布生效"仍是原子的。
func (s *Store) Publish(ctx context.Context, id int64, u User, note string, sources []Source) error {
	// 事务内一律用 definitions(ctx, tx) 直读，不走进程内 Definitions 缓存。
	err := s.write(ctx, func(tx *sql.Tx) error {
		if !u.Can(PermissionDefinitionsManage) {
			return errForbidden
		}
		if err := validateSources(note, sources); err != nil {
			return err
		}
		var b []byte
		var base int64
		var state string
		if err := tx.QueryRowContext(ctx, "SELECT state,base_version,document FROM catalog.definitions WHERE id=$1", id).Scan(&state, &base, &b); err != nil {
			return err
		}
		current, err := definitions(ctx, tx)
		if err != nil {
			return err
		}
		if state != "draft" || current.ID != base {
			return errVersionConflict
		}
		var d Definitions
		if err = json.Unmarshal(b, &d); err != nil {
			return err
		}
		probe, err := impact(ctx, tx, d)
		if err != nil {
			return err
		}
		if len(probe.Issues) > 0 {
			return fmt.Errorf("definition_impact: %s", encode(probe.Issues))
		}
		// 悬挂引用只警告：定义本身合法就照发（口径与理由见 impact.go 顶部）。
		logDangling("publish impact", probe.Dangling)
		// "当前已发布版本让位"同样是一次原子条件更新：无条件 supersede 会让两个
		// base 相同的并发发布都通过上面的版本检查，后到者静默顶掉刚发布的版本（丢更新）。
		var res sql.Result
		if res, err = tx.ExecContext(ctx, "UPDATE catalog.definitions SET state='superseded' WHERE state='published' AND id=$1", base); err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errVersionConflict
		}
		if _, err = tx.ExecContext(ctx, "UPDATE catalog.definitions SET state='published' WHERE id=$1", id); err != nil {
			return err
		}
		return audit(ctx, tx, definitionRevisionTarget(id), id, u, note, sources, d, "definitions.published")
	})
	if err == nil {
		InvalidateDefinitionsCache()
	}
	return err
}
