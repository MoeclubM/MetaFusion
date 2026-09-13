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
			e.Subjects = append(e.Subjects, source.Subjects...)
		}
		if id == target.ID && source.Kind == "track" {
			for _, c := range source.Contents {
				found := false
				for _, other := range e.Contents {
					if c.Position == other.Position {
						if encode(c) != encode(other) {
							return fmt.Errorf("merge_content_conflict")
						}
						found = true
					}
				}
				if !found {
					e.Contents = append(e.Contents, c)
				}
			}
		}
		unique := []Subject{}
		seen := map[string]bool{}
		for _, subject := range e.Subjects {
			key := subject.WorkID + ":" + subject.Role
			if !seen[key] {
				unique = append(unique, subject)
				seen[key] = true
			}
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
	all, err := relations(ctx, tx)
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
	for _, r := range all {
		src, err := get(ctx, tx, r.SourceID)
		if err != nil {
			return err
		}
		tgt, err := get(ctx, tx, r.TargetID)
		if err != nil {
			return err
		}
		if err = validateRelation(v.Document, r, src, tgt, all, reference(ctx, tx, &u), true); err != nil {
			return fmt.Errorf("merge_relation_conflict: %w", err)
		}
	}
	return nil
}
