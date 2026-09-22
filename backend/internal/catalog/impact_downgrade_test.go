package catalog

import (
	"context"
	"strings"
	"testing"
)

// A06：已登记的悬挂引用只做局部降级——同一实体/关系的其它字段继续校验，
// 其它问题仍进阻断项。旧口径（首个悬挂 continue 整实体/关系）会把下面的
// packaging 与 scope 问题一起吞掉，本用例在旧口径下 Issues 为空。
func TestPostgresImpactStillBlocksNonDanglingIssuesBesideDangling(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := f.s.DB.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}

	gone := f.save(Entity{Kind: "agent", Title: "将被删除的发行主体", Types: []string{"organization"}})
	damaged := f.save(Entity{Kind: "release", Title: "悬挂旁另有问题的发行版", Types: []string{"release"},
		Attributes: map[string]any{"publisher": gone.ID, "packaging": "standard"}})
	// packaging 在 release 类型字段序里排在 publisher 之后：旧口径先撞悬挂即整实体跳过。
	exec("DELETE FROM catalog.entities WHERE id=$1", gone.ID)
	exec("UPDATE catalog.entities SET document = jsonb_set(document, '{attributes,packaging}', to_jsonb('nope'::text)) WHERE id=$1", damaged.ID)

	work := f.save(Entity{Kind: "work", Title: "配音作品", Types: []string{"animation"}})
	voice := f.save(Entity{Kind: "agent", Title: "配音演员", Types: []string{"person"}})
	role := f.save(Entity{Kind: "agent", Title: "所饰角色", Types: []string{"character"}})
	rel, err := f.s.SaveRelation(ctx, RelationEdit{
		Relation: Relation{Type: "voiced_by", SourceID: work.ID, TargetID: voice.ID, Attributes: map[string]any{"character": role.ID, "scope": "test"}},
		EditNote: "downgrade fixture",
		Sources:  fixtureSources(),
	}, f.u)
	if err != nil {
		t.Fatal(err)
	}
	// character 在 voiced_by 字段序里排在 scope 之前：旧口径先撞悬挂即整关系跳过。
	exec("DELETE FROM catalog.entities WHERE id=$1", role.ID)
	exec("UPDATE catalog.relations SET document = jsonb_set(document, '{attributes,scope}', to_jsonb(42)) WHERE id=$1", rel.ID)

	v, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	probe, err := f.s.Impact(ctx, v.ID)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(probe.Issues, " ")
	if !strings.Contains(joined, damaged.ID) || !strings.Contains(joined, "packaging") {
		t.Fatalf("悬挂旁的 packaging 非法词表项必须进阻断项：%v", probe.Issues)
	}
	if !strings.Contains(joined, rel.ID) || !strings.Contains(joined, "scope") {
		t.Fatalf("悬挂旁的关系 scope 类型错误必须进阻断项：%v", probe.Issues)
	}
	if len(probe.Dangling) < 2 {
		t.Fatalf("两处悬挂引用仍应在警告报告里：%+v", probe.Dangling)
	}
}
