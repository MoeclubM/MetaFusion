package catalog

import (
	"testing"
)

// A07 读侧：署名聚合严格按每条关系的 CountsAsCredit 布尔值执行，不再看分组。
// 全关即全关（旧回退会把 credits 组全算进来，本用例在旧口径下非空）。
func TestCreditAllOffYieldsEmpty(t *testing.T) {
	d := Defaults()
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
