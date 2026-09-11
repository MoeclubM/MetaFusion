package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"sort"
	"strconv"
	"strings"
)

// entityPlaceholders 为 IN 批量查询生成 ($k,$k+1,...) 占位符, 复用字符串
// UUID 绑定风格(PG 侧 uuid 列与文本参数可比), 不新增驱动依赖。
func entityPlaceholders(ids []string, start int) string {
	ph := make([]string, len(ids))
	for i := range ids {
		ph[i] = "$" + strconv.Itoa(start+i)
	}
	return strings.Join(ph, ",")
}

func entityArgs(ids []string) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

// getMany 一次 IN 批量拉取实体并按 kind 批量补齐侧表, 替代逐行 Get 的 N+1。
// 仅返回 visible 的实体; 不可见/缺失直接从 map 中省略, 调用方按“缺失即跳过”处理。
func (s *Store) getMany(ctx context.Context, ids []string, u *User) (map[string]Entity, error) {
	out := map[string]Entity{}
	uniq := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		uniq = append(uniq, id)
	}
	if len(uniq) == 0 {
		return out, nil
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT id::text, document FROM catalog.entities WHERE id IN ("+entityPlaceholders(uniq, 1)+")", entityArgs(uniq)...)
	if err != nil {
		return nil, err
	}
	byKind := map[string][]string{}
	for rows.Next() {
		var id string
		var b []byte
		var e Entity
		if err = rows.Scan(&id, &b); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal(b, &e); err != nil {
			rows.Close()
			return nil, err
		}
		if !visible(e, u) {
			continue
		}
		out[id] = e
		byKind[e.Kind] = append(byKind[e.Kind], id)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	link2 := func(kind, query string, scan func(*sql.Rows) error) error {
		sub := byKind[kind]
		if len(sub) == 0 {
			return nil
		}
		r, err := s.DB.QueryContext(ctx, query+" IN ("+entityPlaceholders(sub, 1)+")", entityArgs(sub)...)
		if err != nil {
			return err
		}
		defer r.Close()
		for r.Next() {
			if err = scan(r); err != nil {
				return err
			}
		}
		return r.Err()
	}
	put := func(id string, e Entity) {
		if _, ok := out[id]; ok {
			out[id] = e
		}
	}
	if err = link2("content_unit", "SELECT id::text, work_id::text, coalesce(parent_id::text,'') FROM catalog.content_units WHERE id", func(r *sql.Rows) error {
		var id, work, parent string
		if err := r.Scan(&id, &work, &parent); err != nil {
			return err
		}
		cur := out[id]
		cur.WorkID, cur.ParentID = work, parent
		put(id, cur)
		return nil
	}); err != nil {
		return nil, err
	}
	if err = link2("expression", "SELECT id::text, work_id::text, coalesce(content_unit_id::text,'') FROM catalog.expressions WHERE id", func(r *sql.Rows) error {
		var id, work, unit string
		if err := r.Scan(&id, &work, &unit); err != nil {
			return err
		}
		cur := out[id]
		cur.WorkID, cur.ContentUnitID = work, unit
		put(id, cur)
		return nil
	}); err != nil {
		return nil, err
	}
	if err = link2("medium", "SELECT id::text, release_id::text, coalesce(parent_id::text,'') FROM catalog.mediums WHERE id", func(r *sql.Rows) error {
		var id, rel, parent string
		if err := r.Scan(&id, &rel, &parent); err != nil {
			return err
		}
		cur := out[id]
		cur.ReleaseID, cur.ParentID = rel, parent
		put(id, cur)
		return nil
	}); err != nil {
		return nil, err
	}
	if err = link2("track", "SELECT id::text, medium_id::text, coalesce(parent_id::text,'') FROM catalog.tracks WHERE id", func(r *sql.Rows) error {
		var id, med, parent string
		if err := r.Scan(&id, &med, &parent); err != nil {
			return err
		}
		cur := out[id]
		cur.MediumID, cur.ParentID = med, parent
		cur.Contents = []Inclusion{}
		put(id, cur)
		return nil
	}); err != nil {
		return nil, err
	}
	if len(byKind["track"]) > 0 {
		r, err := s.DB.QueryContext(ctx, "SELECT track_id::text, expression_id::text, position, locator, attributes FROM catalog.track_contents WHERE track_id IN ("+entityPlaceholders(byKind["track"], 1)+") ORDER BY track_id, position", entityArgs(byKind["track"])...)
		if err != nil {
			return nil, err
		}
		for r.Next() {
			var tid string
			var c Inclusion
			var loc, attrs []byte
			if err = r.Scan(&tid, &c.ExpressionID, &c.Position, &loc, &attrs); err != nil {
				r.Close()
				return nil, err
			}
			if len(loc) > 0 {
				if err = json.Unmarshal(loc, &c.Locator); err != nil {
					r.Close()
					return nil, err
				}
			}
			if len(attrs) > 0 {
				if err = json.Unmarshal(attrs, &c.Attributes); err != nil {
					r.Close()
					return nil, err
				}
			}
			if cur, ok := out[tid]; ok && cur.Kind == "track" {
				cur.Contents = append(cur.Contents, c)
				out[tid] = cur
			}
		}
		if err = r.Err(); err != nil {
			r.Close()
			return nil, err
		}
		r.Close()
	}
	if err = link2("release", "SELECT release_id::text, work_id::text, role, position FROM catalog.release_subjects WHERE release_id", func(r *sql.Rows) error {
		var rid string
		var x Subject
		if err := r.Scan(&rid, &x.WorkID, &x.Role, &x.Position); err != nil {
			return err
		}
		if cur, ok := out[rid]; ok && cur.Kind == "release" {
			if cur.Subjects == nil {
				cur.Subjects = []Subject{}
			}
			cur.Subjects = append(cur.Subjects, x)
			out[rid] = cur
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

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

// relationByID 按关系 ID 取单条关系；不存在时返回 sql.ErrNoRows。
func relationByID(ctx context.Context, q queryer, id string) (Relation, error) {
	var b []byte
	var r Relation
	if err := q.QueryRowContext(ctx, "SELECT document FROM catalog.relations WHERE id=$1", id).Scan(&b); err != nil {
		return r, err
	}
	err := json.Unmarshal(b, &r)
	return r, err
}

func (s *Store) Relations(ctx context.Context, id string, u *User) ([]Relation, error) {
	if _, err := s.Get(ctx, id, u); err != nil {
		return nil, err
	}
	// 只取该实体为端点的边，避免全表加载；对端可见性用一次批量查询判定。
	rows, err := s.DB.QueryContext(ctx, "SELECT document FROM catalog.relations WHERE source_id=$1 OR target_id=$1 ORDER BY id", id)
	if err != nil {
		return nil, err
	}
	var all []Relation
	for rows.Next() {
		var b []byte
		var r Relation
		if err = rows.Scan(&b); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal(b, &r); err != nil {
			rows.Close()
			return nil, err
		}
		all = append(all, r)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	d, err := s.Definitions(ctx)
	if err != nil {
		return nil, err
	}
	peerIDs := make([]string, 0, len(all))
	for _, r := range all {
		other := r.TargetID
		if r.SourceID != id {
			other = r.SourceID
		}
		peerIDs = append(peerIDs, other)
	}
	peers, err := s.GetManyVisible(ctx, peerIDs, u)
	if err != nil {
		return nil, err
	}
	out := []Relation{}
	for _, r := range all {
		other := r.TargetID
		if r.SourceID != id {
			other = r.SourceID
		}
		if _, ok := peers[other]; !ok {
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

// canWriteRelation 判定调用方能否写入以 src 为源实体的关系：
//   - admin：全部可写；
//   - editor：可写自己创建的条目（含已发布——与编辑器"editor 可直接发布/编辑
//     自己条目"的权限对齐）；
//   - user（审核制）：只能写自己创建且未发布的条目。
func canWriteRelation(u User, src Entity) bool {
	switch u.Role {
	case "admin":
		return true
	case "editor":
		return src.CreatedBy == u.ID
	default:
		return src.CreatedBy == u.ID && src.Status != "published"
	}
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
		if !canWriteRelation(u, src) {
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
		if !canWriteRelation(u, src) {
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
	rows, err := s.DB.QueryContext(ctx, `SELECT c.track_id,m.id,m.release_id,c.expression_id,c.position,c.locator,c.attributes FROM catalog.track_contents c JOIN catalog.tracks t ON t.id=c.track_id JOIN catalog.mediums m ON m.id=t.medium_id JOIN catalog.expressions x ON x.id=c.expression_id WHERE x.id=$1 OR x.work_id=$1 OR x.content_unit_id=$1 ORDER BY m.release_id,c.position`, e.ID)
	if err != nil {
		return nil, err
	}
	type row struct {
		track, medium, release, expr string
		pos                          int
		loc, attrs                   json.RawMessage
	}
	var records []row
	for rows.Next() {
		var r row
		if err = rows.Scan(&r.track, &r.medium, &r.release, &r.expr, &r.pos, &r.loc, &r.attrs); err != nil {
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
	// 去 N+1: 收集全部 release/medium/track ID, 一次 IN 批量拉取(含侧表),
	// 不可见/缺失的按原语义跳过该行。
	need := []string{}
	for _, r := range records {
		need = append(need, r.release, r.medium, r.track)
	}
	got, err := s.getMany(ctx, need, u)
	if err != nil {
		return nil, err
	}
	for _, r := range records {
		rel, ok := got[r.release]
		if !ok {
			continue
		}
		med, ok := got[r.medium]
		if !ok {
			continue
		}
		track, ok := got[r.track]
		if !ok {
			continue
		}
		out = append(out, map[string]any{"release": rel, "medium": med, "track": track, "expression_id": r.expr, "position": r.pos, "locator": r.loc, "attributes": r.attrs})
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

// RelatedEntities 返回该实体的关系邻居中属于指定 kind 的实体（去重、仅可见者）。
// 供外围系统（如论坛的"关联合集"）经接口获取，避免它们直接 JOIN catalog 表。
// kinds 为空表示不限类型。
func (s *Store) RelatedEntities(ctx context.Context, id string, kinds []string, u *User) ([]Entity, error) {
	rels, err := s.Relations(ctx, id, u)
	if err != nil {
		return nil, err
	}
	want := map[string]bool{}
	for _, k := range kinds {
		want[k] = true
	}
	ids := []string{}
	seen := map[string]bool{id: true}
	for _, r := range rels {
		other := r.TargetID
		if r.SourceID != id {
			other = r.SourceID
		}
		if other == "" || seen[other] {
			continue
		}
		seen[other] = true
		ids = append(ids, other)
	}
	got, err := s.GetManyVisible(ctx, ids, u)
	if err != nil {
		return nil, err
	}
	out := []Entity{}
	for _, oid := range ids {
		e, ok := got[oid]
		if !ok {
			continue
		}
		if len(want) > 0 && !want[e.Kind] {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}
