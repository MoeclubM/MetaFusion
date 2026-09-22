package catalog

import (
	"testing"
)

// A07 读侧：署名聚合严格按每条关系的 CountsAsCredit 布尔值执行，不再看分组。
// 全关即全关（旧回退会把 credits 组全算进来，本用例在旧口径下非空）。
func TestCreditAllOffYieldsEmpty(t *testing.T) {
	d := Defaults()
	if !d.CreditDeclared {
		t.Fatal("种子文档应自带 credit_declared 标记")
	}
	for code, rt := range d.Relations {
		rt.CountsAsCredit = false
		d.Relations[code] = rt
	}
	if got := creditRelationTypes(d); len(got) != 0 {
		t.Fatalf("全关后署名聚合应为空，实际 %v", got)
	}
}

// 只开一个：聚合恰为该码（分组归属不影响）。
func TestCreditSingleDeclaration(t *testing.T) {
	d := Defaults()
	for code, rt := range d.Relations {
		rt.CountsAsCredit = code == "voiced_by"
		d.Relations[code] = rt
	}
	got := creditRelationTypes(d)
	if len(got) != 1 || got[0] != "voiced_by" {
		t.Fatalf("只开 voiced_by 时聚合应恰为它，实际 %v", got)
	}
}

// 自定义独立开关：非 credits 组打开即进，credits 组关闭即出——分组只是展示归类。
func TestCreditCustomSwitchIndependentOfGroup(t *testing.T) {
	d := Defaults()
	for code, rt := range d.Relations {
		rt.CountsAsCredit = false
		d.Relations[code] = rt
	}
	extra := d.Relations["store_bonus_for"]
	extra.CountsAsCredit = true
	d.Relations["store_bonus_for"] = extra
	got := creditRelationTypes(d)
	if len(got) != 1 || got[0] != "store_bonus_for" {
		t.Fatalf("membership 组显式打开应独立进聚合，实际 %v", got)
	}
}

// 合并侧：无标记老文档按旧口径一次性回填并置标记；有标记后后台的关闭不再被碰。
func TestMergeBackfillsCreditDeclarationOnce(t *testing.T) {
	seed := Defaults()
	if !seed.CreditDeclared {
		t.Fatal("测试前提漂移：种子应自带 credit_declared 标记")
	}
	// 模拟无标记老文档：标记缺失、开关全假（JSON 缺键解码即零值，无法区分未声明与 false）。
	old := Defaults()
	old.CreditDeclared = false
	for code, rt := range old.Relations {
		rt.CountsAsCredit = false
		old.Relations[code] = rt
	}
	merged, added := mergeSeedDefinitions(old, seed)
	if !merged.CreditDeclared {
		t.Fatal("合并后应置 credit_declared 标记")
	}
	if !contains(added, "credit_declared") {
		t.Fatalf("added 应记录 credit_declared，实际 %v", added)
	}
	for code, rt := range seed.Relations {
		if rt.Group != "credits" || !rt.Enabled {
			continue
		}
		if !merged.Relations[code].CountsAsCredit {
			t.Fatalf("无标记老文档的 credits 组关系 %q 应按旧口径回填为 true", code)
		}
	}
	if !contains(added, "relations.voiced_by.counts_as_credit") {
		t.Fatalf("added 应记录回填的开关，实际 %v", added)
	}
	// 标记之后：后台关闭 performed_by，再合并也不得重新打开。
	closed := merged
	rt := closed.Relations["performed_by"]
	rt.CountsAsCredit = false
	closed.Relations["performed_by"] = rt
	remerged, _ := mergeSeedDefinitions(closed, seed)
	if remerged.Relations["performed_by"].CountsAsCredit {
		t.Fatal("有标记后后台关闭的开关不得被合并重新打开")
	}
	if !remerged.CreditDeclared {
		t.Fatal("标记一旦置上就应保持")
	}
}
