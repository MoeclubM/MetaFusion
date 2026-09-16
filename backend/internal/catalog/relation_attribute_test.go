package catalog

import (
	"context"
	"testing"
)

// 角色不是配音关系的端点，而是关系的 character 属性值。
// 若读路径只查端点，角色详情页就看不到「谁为它配音、在哪些作品里」——
// 数据存得下却读不出来，属于真实缺口。本用例锁住「属性引用也要出现，且标明 via」。
func TestPostgresRelationAttributeReferences(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	work := f.save(Entity{Kind: "work", Title: "配音所属作品", Types: []string{"animation"}})
	character := f.save(Entity{Kind: "agent", Title: "某角色", Types: []string{"character"}})
	actor := f.save(Entity{Kind: "agent", Title: "某声优", Types: []string{"person"}})
	_, err := f.s.SaveRelation(ctx, RelationEdit{
		Relation: Relation{Type: "voiced_by", SourceID: work.ID, TargetID: actor.ID,
			Attributes: map[string]any{"character": character.ID}},
		ExpectedVersion: 0,
		EditNote:        "关系属性引用用例",
		Sources:         fixtureSources(),
	}, f.u)
	if err != nil {
		t.Fatalf("建立配音关系失败：%v", err)
	}
	rels, err := f.s.Relations(ctx, character.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range rels {
		if r.Type == "voiced_by" && r.Via == "character" {
			found = true
		}
	}
	if !found {
		t.Fatalf("角色侧应能读到以它为 character 属性的配音关系，实际 %+v", rels)
	}
	// 反向：声优自己是端点，via 应为空（不假装它是属性引用）。
	actorRels, err := f.s.Relations(ctx, actor.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range actorRels {
		if r.Type == "voiced_by" && r.Via != "" {
			t.Fatalf("端点边不应带 via，实际 %q", r.Via)
		}
	}
}
