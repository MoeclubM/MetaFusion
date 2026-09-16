package catalog

import "testing"

// 合并必须只增不改：已有键（含被人工改过的）原样保留，只补种子新增的键；重复执行不再产生新增。
func TestMergeSeedDefinitionsIsAdditiveOnly(t *testing.T) {
	seed := Defaults()
	// 现状：只保留一半关系，并把其中一个关系改名（模拟后台的人工调整）
	cur := Definitions{
		Types:        map[string]TypeDefinition{},
		Fields:       map[string]Field{},
		Vocabularies: map[string]Vocabulary{},
		Relations:    map[string]RelationDefinition{},
		Templates:    map[string]Template{},
		Schemes:      map[string]Scheme{},
	}
	kept := seed.Relations["directed_by"]
	kept.Names = names4("被人工改过的导演名", "被人工改過的導演名", "手で直した監督名", "Edited by hand")
	cur.Relations["directed_by"] = kept

	merged, added := mergeSeedDefinitions(cur, seed)
	if len(added) == 0 {
		t.Fatal("应当补入缺失的关系码，实际没有新增")
	}
	if got := merged.Relations["directed_by"].Names["zh-CN"]; got != "被人工改过的导演名" {
		t.Fatalf("已存在的关系被覆盖了：%s", got)
	}
	if _, ok := merged.Relations["member_of"]; !ok {
		t.Fatal("种子里新增的 member_of 没有被补进当前定义")
	}
	// 幂等：把合并结果再合并一次，不应再有任何新增
	_, again := mergeSeedDefinitions(merged, seed)
	if len(again) != 0 {
		t.Fatalf("第二次合并不应有新增，实际 %v", again)
	}
}
