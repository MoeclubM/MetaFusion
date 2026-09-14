package catalog

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Only fields declared as references are rewritten; arbitrary text is evidence.
func replaceReference(f Field, value any, source, target string) any {
	switch f.Type {
	case "entity":
		if value == source {
			return target
		}
	case "list":
		if items, ok := value.([]any); ok && f.Items != nil {
			for i, v := range items {
				items[i] = replaceReference(*f.Items, v, source, target)
			}
		}
	case "group":
		if fields, ok := value.(map[string]any); ok {
			for k, v := range fields {
				fields[k] = replaceReference(f.Fields[k], v, source, target)
			}
		}
	}
	return value
}
func rewriteAttributes(d Definitions, attrs map[string]any, source, target string) {
	for k, v := range attrs {
		attrs[k] = replaceReference(d.Fields[k], v, source, target)
	}
}

// rewriteGroupRefs 改写一个"记录级结构属性"（值形如 {子字段码: 值}）里的实体引用。
// 子字段不在顶层 fields 里，而是声明在 group 字段自己的 Fields 下，因此必须先取
// group 定义再逐子字段递归——用顶层 rewriteAttributes 会全部漏掉。
func rewriteGroupRefs(group Field, attrs map[string]any, source, target string) {
	for k, v := range attrs {
		attrs[k] = replaceReference(group.Fields[k], v, source, target)
	}
}

// rewriteEntityRefs 覆盖实体的**全部**动态属性落点：普通属性、发行对象附加属性、
// 收录附加属性与定位组。这些落点由同一套 definitions 声明，合并时若只改普通属性，
// 结构属性里引用的实体就会留下指向已合并身份的悬空引用。
func rewriteEntityRefs(d Definitions, e *Entity, source, target string) {
	rewriteAttributes(d, e.Attributes, source, target)
	for i := range e.Subjects {
		rewriteGroupRefs(d.Fields["subject_attributes"], e.Subjects[i].Attributes, source, target)
	}
	for i := range e.Contents {
		rewriteGroupRefs(d.Fields["locator"], map[string]any(e.Contents[i].Locator), source, target)
		rewriteGroupRefs(d.Fields["inclusion_attributes"], e.Contents[i].Attributes, source, target)
	}
}

// mergeReferences moves identity references atomically and audits every affected record.
// Conflicting relationship cardinality and containment are rejected, never discarded.
func mergeReferences(ctx context.Context, tx *sql.Tx, source, target Entity, u User, in LifecycleEdit) error {
	v, err := definitions(ctx, tx)
	if err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, "SELECT id FROM catalog.entities WHERE status NOT IN ('deleted','merged') ORDER BY id")
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	changed := []Entity{}
	for _, id := range ids {
		if id == source.ID {
			continue
		}
		e, err := get(ctx, tx, id)
		if err != nil {
			return err
		}
		before := encode(e)
		for _, p := range []*string{&e.WorkID, &e.ContentUnitID, &e.ReleaseID, &e.MediumID, &e.ParentID} {
			if *p == source.ID {
				*p = target.ID
			}
		}
		rewriteEntityRefs(v.Document, &e, source.ID, target.ID)
		for i := range e.Contents {
			if e.Contents[i].ExpressionID == source.ID {
				e.Contents[i].ExpressionID = target.ID
			}
		}
		for i := range e.Subjects {
			if e.Subjects[i].WorkID == source.ID {
				e.Subjects[i].WorkID = target.ID
			}
		}
		if id == target.ID && source.Kind == "release" {
			// Subjects 按（work, role）合并键保留：目标已有同键时若 attributes
			// 不同即冲突报错（merge_subject_conflict），不再静默丢弃一方；
			// 同键同值视为重复，直接跳过。position 保留目标值。
			for _, s := range source.Subjects {
				hit := -1
				for i, t := range e.Subjects {
					if t.WorkID == s.WorkID && t.Role == s.Role {
						hit = i
						break
					}
				}
				if hit < 0 {
					e.Subjects = append(e.Subjects, s)
					continue
				}
				if encode(e.Subjects[hit].Attributes) != encode(s.Attributes) {
					return fmt.Errorf("merge_subject_conflict")
				}
			}
		}
		if id == target.ID && source.Kind == "track" {
			// 同表达不同位置不得双留：合并键为 expression_id（与 validateEntity 的
			// duplicate_content 同口径），源表达在目标已存在即冲突检查——
			// locator/attributes 不同报 merge_content_conflict，同值视为重复跳过；
			// 同 position 不同表达同样冲突。position 保留目标值。
			for _, c := range source.Contents {
				hit := -1
				for i, other := range e.Contents {
					if c.ExpressionID == other.ExpressionID || c.Position == other.Position {
						hit = i
						break
					}
				}
				if hit < 0 {
					e.Contents = append(e.Contents, c)
					continue
				}
				hitRow, srcRow := e.Contents[hit], c
				if hitRow.ExpressionID != srcRow.ExpressionID || hitRow.Position != srcRow.Position || encode(hitRow.Locator) != encode(srcRow.Locator) || encode(hitRow.Attributes) != encode(srcRow.Attributes) {
					return fmt.Errorf("merge_content_conflict")
				}
			}
		}
		// ExternalIDs 合并：目标缺的键从源补齐（幂等——重复合并结果一致）；
		// 同键不同值即冲突报错，不静默覆盖。metafusion_import 键冲突同样报错，
		// 由调用方先手工去重（与 000013 唯一索引"存量重复即失败"同策略）。
		if id == target.ID && len(source.ExternalIDs) > 0 {
			if e.ExternalIDs == nil {
				e.ExternalIDs = map[string]string{}
			}
			for k, v := range source.ExternalIDs {
				if cur, ok := e.ExternalIDs[k]; ok && cur != v {
					return fmt.Errorf("merge_external_conflict: %s", k)
				}
				if _, ok := e.ExternalIDs[k]; !ok {
					e.ExternalIDs[k] = v
				}
			}
		}
			// Subjects 去重键与 validateEntity 同口径（work, role），position 不计入；
			// 凡属性不同直接报 merge_subject_conflict（涵盖 Work 合并导致下游 Release
			// 内两条记录 WorkID 改写收敛碰撞，以及 Release 实体合并碰撞），
			// 属性完全相同视为重复幂等跳过，绝不静默丢弃任何附加属性。
			unique := []Subject{}
			seen := map[string]Subject{}
			for _, subject := range e.Subjects {
				key := subject.WorkID + ":" + subject.Role
				if prev, ok := seen[key]; ok {
					if encode(prev.Attributes) != encode(subject.Attributes) {
						return fmt.Errorf("merge_subject_conflict")
					}
					continue
				}
				seen[key] = subject
				unique = append(unique, subject)
			}
			if len(e.Subjects) > 0 {
				e.Subjects = unique
			}
		if before == encode(e) {
			continue
		}
		e.Version++
		e.UpdatedAt = time.Now().UTC()
		changed = append(changed, e)
	}
	// Deferred composite foreign keys permit moving a complete logical subtree.
	for _, e := range changed {
		switch e.Kind {
		case "content_unit":
			_, err = tx.ExecContext(ctx, "UPDATE catalog.content_units SET work_id=$2,parent_id=$3 WHERE id=$1", e.ID, e.WorkID, nullable(e.ParentID))
		case "expression":
			_, err = tx.ExecContext(ctx, "UPDATE catalog.expressions SET work_id=$2,content_unit_id=$3 WHERE id=$1", e.ID, e.WorkID, nullable(e.ContentUnitID))
		case "medium":
			_, err = tx.ExecContext(ctx, "UPDATE catalog.mediums SET release_id=$2,parent_id=$3 WHERE id=$1", e.ID, e.ReleaseID, nullable(e.ParentID))
		case "track":
			_, err = tx.ExecContext(ctx, "UPDATE catalog.tracks SET medium_id=$2,parent_id=$3 WHERE id=$1", e.ID, e.MediumID, nullable(e.ParentID))
			if err != nil {
				return err
			}
			_, err = tx.ExecContext(ctx, "DELETE FROM catalog.track_contents WHERE track_id=$1", e.ID)
			if err != nil {
				return err
			}
			for _, c := range e.Contents {
				_, err = tx.ExecContext(ctx, "INSERT INTO catalog.track_contents(track_id,expression_id,position,locator,attributes) VALUES($1,$2,$3,$4,$5)", e.ID, c.ExpressionID, c.Position, encode(c.Locator), encode(c.Attributes))
				if err != nil {
					return err
				}
			}
		case "release":
			_, err = tx.ExecContext(ctx, "DELETE FROM catalog.release_subjects WHERE release_id=$1", e.ID)
			if err != nil {
				return err
			}
			for _, s := range e.Subjects {
				_, err = tx.ExecContext(ctx, "INSERT INTO catalog.release_subjects(release_id,work_id,role,position,attributes) VALUES($1,$2,$3,$4,$5)", e.ID, s.WorkID, s.Role, s.Position, encode(s.Attributes))
				if err != nil {
					return err
				}
			}
		}
		if err != nil {
			return err
		}
		stored := e
		stored.WorkID = ""
		stored.ContentUnitID = ""
		stored.ReleaseID = ""
		stored.MediumID = ""
		stored.ParentID = ""
		stored.Contents = nil
		stored.Subjects = nil
		_, err = tx.ExecContext(ctx, "UPDATE catalog.entities SET version=$2,document=$3,updated_at=$4 WHERE id=$1", e.ID, e.Version, encode(stored), e.UpdatedAt)
		if err != nil {
			return err
		}
		if err = audit(ctx, tx, e.ID, e.Version, u, in.EditNote, in.Sources, e, "entity.saved"); err != nil {
			return err
		}
	}
	// 收藏跟随：favorites 指向已合并身份的行改写到目标身份（幂等——目标已收藏则
	// 删旧行，避免 (user_id,target_type,target_id) 主键冲突）。
	// 不删数据：只是把"指向旧身份"的收藏重定向到存活身份，与 Resolve 语义一致。
	if _, err = tx.ExecContext(ctx, `DELETE FROM catalog.favorites WHERE target_id=$1 AND EXISTS(SELECT 1 FROM catalog.favorites f2 WHERE f2.user_id=catalog.favorites.user_id AND f2.target_type=catalog.favorites.target_type AND f2.target_id=$2)`, source.ID, target.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE catalog.favorites SET target_id=$2 WHERE target_id=$1`, source.ID, target.ID); err != nil {
		return err
	}
	// 合并只改写以旧身份为端点的边：按端点取候选而非全表加载
	//（relations_endpoints 索引命中，避免关系量大时退化）。
	all, err := relationsWithEndpoint(ctx, tx, source.ID)
	if err != nil {
		return err
	}
	for i := range all {
		r := &all[i]
		before := encode(r)
		if r.SourceID == source.ID {
			r.SourceID = target.ID
		}
		if r.TargetID == source.ID {
			r.TargetID = target.ID
		}
		rewriteAttributes(v.Document, r.Attributes, source.ID, target.ID)
		if encode(r) == before {
			continue
		}
		r.Version++
		if r.SourceID == r.TargetID {
			return fmt.Errorf("merge_relation_conflict")
		}
		_, err = tx.ExecContext(ctx, "UPDATE catalog.relations SET source_id=$2,target_id=$3,version=$4,document=$5 WHERE id=$1", r.ID, r.SourceID, r.TargetID, r.Version, encode(r))
		if err != nil {
			return err
		}
		if err = audit(ctx, tx, r.ID, r.Version, u, in.EditNote, in.Sources, r, "relation.saved"); err != nil {
			return err
		}
	}
	// 校验只复核被改写的边所在类型：validateRelation 的构图/计数/判重
	// 只看同 type（异类跳过），同类全集按类型取，不再全表加载。
	seenType := map[string]bool{}
	for _, r := range all {
		if seenType[r.Type] {
			continue
		}
		seenType[r.Type] = true
		same, err := relationsByType(ctx, tx, r.Type)
		if err != nil {
			return err
		}
		for _, x := range same {
			src, err := get(ctx, tx, x.SourceID)
			if err != nil {
				return err
			}
			tgt, err := get(ctx, tx, x.TargetID)
			if err != nil {
				return err
			}
			if err = validateRelation(v.Document, x, src, tgt, same, reference(ctx, tx, &u), true); err != nil {
				return fmt.Errorf("merge_relation_conflict: %w", err)
			}
		}
	}
	return nil
}
