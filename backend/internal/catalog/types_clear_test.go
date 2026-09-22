package catalog

import (
	"context"
	"strings"
	"testing"
)

// 已有非空 types 的记录：普通保存不得清空最后一个类型，即使属性同时被清空。
// 旧口径只在 needsExplicitTypes 为 true 时拦截，strip types + 清属性即可绕开字段约束。
func TestPostgresTypesCannotBeClearedByOrdinarySave(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	w := f.save(Entity{Kind: "work", Title: "有类型作品", Types: []string{"animation"}})
	if len(w.Types) != 1 {
		t.Fatalf("测试前提漂移：作品应带一个类型，实际 %v", w.Types)
	}
	cleared := w
	cleared.Types = nil
	cleared.Attributes = map[string]any{}
	if _, err := f.s.Save(ctx, Edit{Entity: cleared, ExpectedVersion: w.Version, EditNote: "strip types", Sources: fixtureSources()}, f.u); err == nil || !strings.Contains(err.Error(), "types_required") {
		t.Fatalf("清空已有 types 应报 types_required，实际 %v", err)
	}
	back, err := f.s.Get(ctx, w.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.Types) != 1 || back.Types[0] != "animation" {
		t.Fatalf("被拒的清空不得落库，实际 %v", back.Types)
	}
	// 正常改名仍放行：拦截只针对抹空 types，不扩大到普通更新。
	renamed := back
	renamed.Title = "有类型作品改名"
	if _, err := f.s.Save(ctx, Edit{Entity: renamed, ExpectedVersion: back.Version, EditNote: "rename", Sources: fixtureSources()}, f.u); err != nil {
		t.Fatalf("普通更新不应被误拦：%v", err)
	}
}

// 历史兼容的边界只认真正无类型存量：非 v7 主键（历史异形）按旧数据宽容，
// 当前 v7 主键的无类型实体不是历史数据，补属性必须先声明 types。
func TestLegacyUntypedBoundary(t *testing.T) {
	if !isLegacyUntyped(Entity{ID: "11111111-1111-4111-8111-111111111111"}) {
		t.Fatal("非 v7 主键的无类型实体应视为历史存量")
	}
	if isLegacyUntyped(Entity{ID: newID()}) {
		t.Fatal("当前创建的无类型实体不是历史存量")
	}
	if isLegacyUntyped(Entity{ID: newID(), Types: []string{"animation"}}) {
		t.Fatal("有 types 的实体不走历史回退")
	}
}
