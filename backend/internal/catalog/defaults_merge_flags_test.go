package catalog

import "testing"

// D2：后台显式关闭的开关（false）不得被种子夺回。bool 零值无法区分"老文档缺声明"与
// "有意关闭"，因此已存在关系的 Aggregate / CountsAsCredit 一律不动；缺失的关系整体
// 新增时才带上种子开关。启动合并（EnsureSeedDefinitions）于是不会重开 GUI 已关闭的开关。
func TestMergeSeedDefinitionsKeepsExplicitFalse(t *testing.T) {
	seed := Defaults()
	mkCur := func() Definitions {
		return Definitions{
			Types:        map[string]TypeDefinition{},
			Fields:       map[string]Field{},
			Vocabularies: map[string]Vocabulary{},
			Relations: map[string]RelationDefinition{
				// 种子里 includes.Aggregate=true、credits 组 CountsAsCredit=true；
			// 这里模拟后台有意关闭。
				"includes":    withFlags(seed.Relations["includes"], false, false),
				"performed_by": withFlags(seed.Relations["performed_by"], false, false),
			},
			Templates: map[string]Template{},
			Schemes:   map[string]Scheme{},
		}
	}
	merged, added := mergeSeedDefinitions(mkCur(), seed)
	if merged.Relations["includes"].Aggregate {
		t.Fatal("后台关闭的 Aggregate 不得被种子重新打开")
	}
	if merged.Relations["performed_by"].CountsAsCredit {
		t.Fatal("后台关闭的 CountsAsCredit 不得被种子重新打开")
	}
	for _, a := range added {
		if a == "relations.includes.aggregate" || a == "relations.performed_by.counts_as_credit" {
			t.Fatalf("显式 false 不应出现在新增项里：%v", added)
		}
	}
	// 缺失的关系仍整体补入（含种子开关）："只初始化缺失"不断新增能力。
	// voiced_by 在当前文档里缺失、种子里是 credits 组（含 CountsAsCredit=true）。
	if _, ok := merged.Relations["voiced_by"]; !ok {
		t.Fatal("缺失的关系码仍应被补入")
	}
	if !seed.Relations["voiced_by"].CountsAsCredit {
		t.Fatal("测试前提漂移：种子 voiced_by 应为 CountsAsCredit=true")
	}
	if !merged.Relations["voiced_by"].CountsAsCredit {
		t.Fatal("新增补入的关系应携带种子开关")
	}
	// 幂等：再合一次无新增，重启不会反复写版本。
	_, again := mergeSeedDefinitions(merged, seed)
	if len(again) != 0 {
		t.Fatalf("第二次合并不应有新增，实际 %v", again)
	}
	// 反向：种子为假、当前为真同样不动（合并从不关掉任何东西）。
	reopen := mkCur()
	rt := reopen.Relations["includes"]
	rt.Aggregate = true
	reopen.Relations["includes"] = rt
	if merged, _ := mergeSeedDefinitions(reopen, seed); !merged.Relations["includes"].Aggregate {
		t.Fatal("已打开的 Aggregate 不得被合并关掉")
	}
}

func withFlags(r RelationDefinition, aggregate, credit bool) RelationDefinition {
	r.Aggregate = aggregate
	r.CountsAsCredit = credit
	return r
}
