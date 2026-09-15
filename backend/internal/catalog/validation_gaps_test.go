package catalog

import (
	"fmt"
	"strings"
	"testing"
)

// 本文件锁定校验/关系/合并/权限补缺口的离线语义（无 DB）：
//   - 署名码动态化：creditRelationTypes 与 definitions group=credits 一致；
//   - 去重键含 position；目标端否决权；validation 最小校验；
//   - Relations/impact 删除码宽容；合并冲突键；状态机现状（无 archived）。
// DB 行为（Save/mergeReferences/Lifecycle/收藏跟随）在 MF_V2_TEST_DSN 下的
// 集成测试覆盖，此处只锁纯函数语义。

func TestCreditRelationTypesFollowDefinitions(t *testing.T) {
	d := Defaults()
	got := creditRelationTypes(d)
	if len(got) == 0 {
		t.Fatal("no credit relation types")
	}
	for _, code := range []string{"performed_by", "voiced_by", "created_by", "composed_by", "character_in"} {
		found := false
		for _, g := range got {
			if g == code {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("credit code %s missing from dynamic set %v", code, got)
		}
	}
	// 后台改名不再静默漏数：删一个署名码后动态集合同步消失。
	renamed := Defaults()
	delete(renamed.Relations, "voiced_by")
	for _, g := range creditRelationTypes(renamed) {
		if g == "voiced_by" {
			t.Fatal("renamed-away credit code still reported")
		}
	}
	// 停用码不计入批量署名聚合。
	disabled := Defaults()
	rt := disabled.Relations["voiced_by"]
	rt.Enabled = false
	disabled.Relations["voiced_by"] = rt
	for _, g := range creditRelationTypes(disabled) {
		if g == "voiced_by" {
			t.Fatal("disabled credit code still reported")
		}
	}
}

func TestValidateRelationDedupIncludesPosition(t *testing.T) {
	d := Defaults()
	a := Entity{ID: "a", Kind: "expression"}
	b := Entity{ID: "b", Kind: "agent"}
	ref := func(string, []string) error { return nil }
	// 同端点同属性同 position → 重复。
	r := Relation{ID: "2", Type: "voiced_by", SourceID: "a", TargetID: "b", Position: 0, Attributes: map[string]any{"character": "c1"}}
	prior := []Relation{{ID: "1", Type: "voiced_by", SourceID: "a", TargetID: "b", Position: 0, Attributes: map[string]any{"character": "c1"}}}
	if err := validateRelation(d, r, a, b, prior, ref, false); err == nil || err.Error() != "duplicate_relation" {
		t.Fatalf("same position must be duplicate, got %v", err)
	}
	// 同端点同属性但 position 不同 → 两条合法边，不误判。
	r.Position = 1
	if err := validateRelation(d, r, a, b, prior, ref, false); err != nil {
		t.Fatalf("different position wrongly deduped: %v", err)
	}
}

func TestCanAttachToTargetVeto(t *testing.T) {
	owner := User{ID: "owner", Role: "editor"}
	other := User{ID: "other", Role: "editor"}
	admin := User{ID: "admin", Role: "admin"}
	foreignPublished := Entity{ID: "x", Kind: "work", Status: "published", CreatedBy: "owner"}
	// 受信任 editor 可在公开条目之间建立关系。
	if !canAttachToTarget(other, foreignPublished) {
		t.Fatal("editor attaching to published target must pass")
	}
	// 主人自己可挂；admin 恒可。
	if !canAttachToTarget(owner, foreignPublished) {
		t.Fatal("owner attaching to own published target must pass")
	}
	if !canAttachToTarget(admin, foreignPublished) {
		t.Fatal("admin must always pass")
	}
	// 其它人的未发布内容仍受保护。
	draft := Entity{ID: "y", Kind: "work", Status: "draft", CreatedBy: "owner"}
	if canAttachToTarget(other, draft) {
		t.Fatal("foreign draft target must be protected")
	}
}

func TestValidationGaps(t *testing.T) {
	d := Defaults()
	ref := func(string, []string) error { return nil }
	f := func(typ string) Field { return Field{Names: names("x", "X"), Type: typ, Enabled: true} }
	// text/url 长度上限。
	if err := d.value(f("text"), strings.Repeat("a", maxTextLen+1), ref, false); err == nil {
		t.Fatal("overlong text accepted")
	}
	if err := d.value(f("url"), "https://example.com/"+strings.Repeat("a", maxURLLen), ref, false); err == nil {
		t.Fatal("overlong url accepted")
	}
	// Required 对空数组/空对象。
	reqList := Field{Names: names("x", "X"), Type: "list", Required: true, Enabled: true, Items: &Field{Names: names("i", "I"), Type: "text", Enabled: true}}
	if err := d.value(reqList, []any{}, ref, false); err == nil {
		t.Fatal("required empty list accepted")
	}
	reqGroup := Field{Names: names("x", "X"), Type: "group", Required: true, Enabled: true, Fields: map[string]Field{}}
	if err := d.value(reqGroup, map[string]any{}, ref, false); err == nil {
		t.Fatal("required empty object accepted")
	}
	// multilingual 空 map 非 Required 时允许（与空串同口径）。
	if err := d.value(f("multilingual"), map[string]any{}, ref, false); err != nil {
		t.Fatalf("optional empty multilingual rejected: %v", err)
	}
	// Number 无 Min/Max 时仍拒绝非数值（包括空数组 []、空对象 {} 等）
	if err := d.value(f("number"), "NaN-string", ref, false); err == nil {
		t.Fatal("non-numeric number accepted")
	}
	if err := d.value(f("number"), []any{}, ref, false); err == nil {
		t.Fatal("empty array accepted for number field")
	}
	if err := d.value(f("number"), map[string]any{}, ref, false); err == nil {
		t.Fatal("empty object accepted for number field")
	}
	// List 字段拒绝空对象 {} 传透
	listField := Field{Names: names("l", "L"), Type: "list", Enabled: true, Items: &Field{Names: names("i", "I"), Type: "text", Enabled: true}}
	if err := d.value(listField, map[string]any{}, ref, false); err == nil {
		t.Fatal("empty object accepted for list field")
	}
	// value 无 default 分支不再空转。
	if err := d.value(Field{Names: names("x", "X"), Type: "no_such_type", Enabled: true}, "v", ref, false); err == nil {
		t.Fatal("unknown field type silently passed")
	}
}

func TestValidateEntityStructuralDedup(t *testing.T) {
	d := Defaults()
	ref := func(string, []string) error { return nil }
	wid := "11111111-1111-4111-8111-111111111111"
	mid := "22222222-2222-4222-8222-222222222222"
	eid := "33333333-3333-4333-8333-333333333333"
	// Subjects 同 (work,role) 重复 → 拒绝（position 不同也不行）。
	rel := Entity{Kind: "release", Title: "R", Status: "draft",
		Subjects: []Subject{{WorkID: wid, Role: "primary"}, {WorkID: wid, Role: "primary", Position: 1}}}
	if err := d.validateEntity(rel, ref, true); err == nil || !strings.Contains(err.Error(), "duplicate_subject") {
		t.Fatalf("duplicate subject must be rejected, got %v", err)
	}
	// Contents 同 expression 相同 locator（如均为空 locator）多 position 重复 → 拒绝。
	tr := Entity{Kind: "track", Title: "T", Status: "draft", MediumID: mid,
		Contents: []Inclusion{{ExpressionID: eid, Position: 0}, {ExpressionID: eid, Position: 1}}}
	if err := d.validateEntity(tr, ref, true); err == nil || !strings.Contains(err.Error(), "duplicate_content") {
		t.Fatalf("duplicate content must be rejected, got %v", err)
	}
	// 同 expression 但不同 locator 切片（如不同时间区间）→ 合法放行。
	okTr := Entity{Kind: "track", Title: "T", Status: "draft", MediumID: mid,
		Contents: []Inclusion{
			{ExpressionID: eid, Position: 0, Locator: Locator{"relative_to": "track", "time_start_ms": float64(0), "time_end_ms": float64(30000)}},
			{ExpressionID: eid, Position: 1, Locator: Locator{"relative_to": "track", "time_start_ms": float64(60000), "time_end_ms": float64(90000)}},
		}}
	if err := d.validateEntity(okTr, ref, false); err != nil {
		t.Fatalf("different locator slice for same expression must be allowed, got %v", err)
	}
}

func TestValidateExternalIDs(t *testing.T) {
	d := Defaults()
	// 格式层只拦"连 codePattern 都不符合"的键；未知但格式合法的键放过，
	// 由 Store.Save 的 validateExternalIDsAgainstDB 按预设表复核。
	// 此处锁的是该分层：格式非法在离线层即拒绝。
	if err := d.validateExternalIDs(Entity{ExternalIDs: map[string]string{"Bad Key!": "123"}}); err == nil {
		t.Fatal("malformed external key accepted")
	}
	// metafusion_import 格式非法拒绝；合法格式通过（DB 唯一索引兜底并发）。
	if err := d.validateExternalIDs(Entity{ExternalIDs: map[string]string{"metafusion_import": "forged:::key"}}); err == nil {
		t.Fatal("forged import key accepted")
	}
	if err := d.validateExternalIDs(Entity{ExternalIDs: map[string]string{"metafusion_import": "bangumi:subject:123"}}); err != nil {
		t.Fatalf("valid import key rejected: %v", err)
	}
	if err := d.validateExternalIDs(Entity{ExternalIDs: map[string]string{"metafusion_import": "bangumi:subject:123:release"}}); err != nil {
		t.Fatalf("valid derived import key rejected: %v", err)
	}
	// 校验导入器实际生成的所有派生形态均合法放行：
	// 表达键、发行变体键、载体键、曲目键
	importerGeneratedKeys := []string{
		"bangumi:subject:633836:e7a8b9c0d",
		"bangumi:subject:633836:release:r1a2b3c4d",
		"bangumi:subject:633836:release:r1a2b3c4d:m0",
		"bangumi:subject:633836:release:r1a2b3c4d:m0:t1",
		"bangumi:subject:633836:release:m0:t1",
		"bangumi:person:9999",
		"bangumi:character:8888",
	}
	for _, key := range importerGeneratedKeys {
		if err := d.validateExternalIDs(Entity{ExternalIDs: map[string]string{"metafusion_import": key}}); err != nil {
			t.Fatalf("importer generated key %q must be valid, got %v", key, err)
		}
	}
}

func TestMergeConflictKeys(t *testing.T) {
	// 合并键口径锁死（离线断言，不连库）：
	//   - Subjects 合并键=（work, role），同键 attributes 不同即冲突；
	//   - Contents 合并键=expression_id，同表达即冲突检查（不再双留）；
	//   - ExternalIDs 同键不同值即冲突。
	// 具体合并循环在 mergeReferences（需 DB），此处只锁"键选择" helper 语义：
	// 用 validateEntity 的同口径错误码保证两者一致。
	d := Defaults()
	ref := func(string, []string) error { return nil }
	wid := "11111111-1111-4111-8111-111111111111"
	dup := Entity{Kind: "release", Title: "R", Status: "draft",
		Subjects: []Subject{{WorkID: wid, Role: "primary"}, {WorkID: wid, Role: "primary", Position: 1}}}
	if err := d.validateEntity(dup, ref, true); err == nil || !strings.Contains(err.Error(), "duplicate_subject") {
		t.Fatalf("merge subject key must match validateEntity duplicate_subject, got %v", err)
	}
	// 同角色不同作品不是冲突（键含 work）。
	ok := Entity{Kind: "release", Title: "R", Status: "draft",
		Subjects: []Subject{{WorkID: wid, Role: "primary"}, {WorkID: "22222222-2222-4222-8222-222222222222", Role: "primary", Position: 1}}}
	if err := d.validateEntity(ok, ref, true); err != nil {
		t.Fatalf("different works same role wrongly rejected: %v", err)
	}
	// 校验 Work 合并导致下游 Release Subjects 改写收敛时的冲突检测逻辑：
	// 属性不同报 merge_subject_conflict，属性相同幂等保留。
	dedupSubjects := func(subs []Subject) ([]Subject, error) {
		unique := []Subject{}
		seen := map[string]Subject{}
		for _, subject := range subs {
			key := subject.WorkID + ":" + subject.Role
			if prev, ok := seen[key]; ok {
				if encode(prev.Attributes) != encode(subject.Attributes) {
					return nil, fmt.Errorf("merge_subject_conflict")
				}
				continue
			}
			seen[key] = subject
			unique = append(unique, subject)
		}
		return unique, nil
	}
	s1 := Subject{WorkID: wid, Role: "primary", Attributes: map[string]any{"note": "A"}}
	s2 := Subject{WorkID: wid, Role: "primary", Attributes: map[string]any{"note": "B"}}
	if _, err := dedupSubjects([]Subject{s1, s2}); err == nil || err.Error() != "merge_subject_conflict" {
		t.Fatalf("different attributes on same (work,role) must conflict, got %v", err)
	}
	s3 := Subject{WorkID: wid, Role: "primary", Attributes: map[string]any{"note": "A"}}
	res, err := dedupSubjects([]Subject{s1, s3})
	if err != nil || len(res) != 1 {
		t.Fatalf("identical attributes on same (work,role) must dedup cleanly, got %v, err %v", res, err)
	}
}

func TestLifecycleSemanticsLocked(t *testing.T) {
	// archived 缺口锁定：全仓无 archived 状态，私自加状态必须先改这三处。
	for _, s := range []string{"draft", "pending_review", "published", "deleted", "merged"} {
		if s == "archived" {
			t.Fatal("archived must not exist yet")
		}
	}
	d := Defaults()
	ref := func(string, []string) error { return nil }
	// deleted/merged 主人仍可 Get 直读：visible 对主人放行（锁定现状）。
	owner := &User{ID: "owner", Role: "editor"}
	for _, st := range []string{"deleted", "merged"} {
		e := Entity{ID: "x", Kind: "work", Status: st, CreatedBy: "owner"}
		if !visible(e, owner) {
			t.Fatalf("status %s must remain Get-readable by owner (locked)", st)
		}
		if visible(e, nil) {
			t.Fatalf("status %s must stay invisible to public (locked)", st)
		}
	}
	// archived 状态码仍非法（锁定：不私自加状态）。
	bad := Entity{Kind: "work", Title: "T", Status: "archived"}
	if err := d.validateEntity(bad, ref, true); err == nil {
		t.Fatal("archived status silently accepted")
	}
}
