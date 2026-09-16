package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

func (s *Store) DefinitionVersions(ctx context.Context) ([]DefinitionVersion, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT id,state,base_version,document,created_at FROM catalog.definitions ORDER BY id DESC LIMIT 100")
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
		if !u.Can(PermissionDefinitionsManage) {
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
		if err = tx.QueryRowContext(ctx, "INSERT INTO catalog.definitions(state,base_version,document) VALUES('draft',$1,$2) RETURNING id", base, encode(d)).Scan(&id); err != nil {
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
	rows, err := q.QueryContext(ctx, "SELECT id FROM catalog.entities WHERE status NOT IN ('deleted','merged')")
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
	// impact 以系统上下文回放存量数据：显式持通配权限，不依赖角色兜底。
	system := &User{Role: "admin", Permissions: []string{permissionWildcard}}
	ref := reference(ctx, q, system)
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
		// 删除与停用宽容度对齐：impact 用 historical=true 回放存量，关系码删除
		// （!ok）与停用（Enabled=false）都不报 invalid_relation_type——与 Relations
		// 读路径"删除码不断读"同口径。删除码后新建由 SaveRelation 的
		// disabled_relation_type 拦截；停用码的新增使用由 retiredAttributes 拦截。
		if _, ok := d.Relations[r.Type]; !ok {
			continue
		}
		if err = validateRelation(d, r, src, tgt, all, ref, true); err != nil {
			issues = append(issues, r.ID+": "+err.Error())
		}
	}
	return issues, nil
}
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
		return nil
	}
	sys := User{ID: "system", Username: "system", Role: "admin", Permissions: []string{PermissionDefinitionsManage}}
	note := "启动时合并新增的种子定义（只增不改）：" + strings.Join(added, "、")
	sources := []Source{{Kind: "url", URL: "https://github.com/MoeclubM/MetaFusion", Citation: "种子定义合并：backend/internal/catalog/defaults.go"}}
	id, err := s.Draft(ctx, merged, v.ID, sys, note, sources)
	if err != nil {
		return err
	}
	return s.Publish(ctx, id, sys, note, sources)
}

func (s *Store) Impact(ctx context.Context, id int64) ([]string, error) {
	var b []byte
	var d Definitions
	if err := s.DB.QueryRowContext(ctx, "SELECT document FROM catalog.definitions WHERE id=$1", id).Scan(&b); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, err
	}
	return impact(ctx, s.DB, d)
}
func (s *Store) Publish(ctx context.Context, id int64, u User, note string, sources []Source) error {
	// 长事务说明：impact 全量校验（逐实体+逐关系）在本事务内执行，发布期间持有
	// advisory 锁（见 write），大库上发布会阻塞其它写事务。这是刻意trade-off：
	// 定义发布是低频管理操作，正确性（校验看到的快照与发布原子）优先于并发。
	// 事务内一律用 definitions(ctx, tx) 直读，不走进程内 Definitions 缓存。
	err := s.write(ctx, func(tx *sql.Tx) error {
		if !u.Can(PermissionDefinitionsManage) {
			return fmt.Errorf("forbidden")
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
		if _, err = tx.ExecContext(ctx, "UPDATE catalog.definitions SET state='superseded' WHERE state='published'"); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE catalog.definitions SET state='published' WHERE id=$1", id); err != nil {
			return err
		}
		return audit(ctx, tx, fmt.Sprintf("definitions:%d", id), id, u, note, sources, d, "definitions.published")
	})
	if err == nil {
		InvalidateDefinitionsCache()
	}
	return err
}
