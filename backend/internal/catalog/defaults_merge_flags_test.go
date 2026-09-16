package catalog

import "testing"

// 种子声明的开关（Aggregate）只能被"打开"：旧文档缺该声明时补上；种子为假或已为真时不改；重复合并无副作用。
func TestMergeSeedDefinitionsTurnsOnAggregateFlag(t *testing.T) {
	seed := Defaults()
	// 现状：includes 存在但没声明 Aggregate（旧文档）
	cur := Definitions{
		Types:        map[string]TypeDefinition{},
		Fields:       map[string]Field{},
		Vocabularies: map[string]Vocabulary{},
		Relations:    map[string]RelationDefinition{"includes": seed.Relations["includes"]},
		Templates:    map[string]Template{},
		Schemes:      map[string]Scheme{},
	}
	noFlag := cur.Relations["includes"]
	noFlag.Aggregate = false
	cur.Relations["includes"] = noFlag

	merged, added := mergeSeedDefinitions(cur, seed)
	if !merged.Relations["includes"].Aggregate {
		t.Fatal("种子声明了 Aggregate，合并后应被打开")
	}
	found := false
	for _, a := range added {
		if a == "relations.includes.aggregate" {
			found = true
		}
	}
	if !found {
		t.Fatalf("应在新增项里记录该开关：%v", added)
	}
	// 幂等：再合一次不应再报该开关
	_, again := mergeSeedDefinitions(merged, seed)
	for _, a := range again {
		if a == "relations.includes.aggregate" {
			t.Fatal("第二次合并不应再报该开关")
		}
	}
}
