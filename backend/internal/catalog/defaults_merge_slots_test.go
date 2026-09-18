package catalog

import "testing"

// 种子声明的参与者槽位只能被"补空"：老文档缺该声明时补上（老库也能拿到新语义），
// 已有值时不覆盖（后台按需改写槽位后，种子不夺回控制权）；重复合并无副作用。
func TestMergeSeedDefinitionsFillsParticipantSlot(t *testing.T) {
	seed := Defaults()

	// 现状：老文档里 voiced_by 还没有槽位声明
	cur := Definitions{
		Types:        map[string]TypeDefinition{},
		Fields:       map[string]Field{},
		Vocabularies: map[string]Vocabulary{},
		Relations:    map[string]RelationDefinition{"voiced_by": seed.Relations["voiced_by"]},
		Templates:    map[string]Template{},
		Schemes:      map[string]Scheme{},
	}
	legacy := cur.Relations["voiced_by"]
	legacy.ParticipantSlot = ""
	cur.Relations["voiced_by"] = legacy

	merged, added := mergeSeedDefinitions(cur, seed)
	if got := merged.Relations["voiced_by"].ParticipantSlot; got != "person" {
		t.Fatalf("槽位应被补上 person，得到 %q", got)
	}
	if !contains(added, "relations.voiced_by.participant_slot") {
		t.Fatalf("应在新增项里记录槽位补丁：%v", added)
	}
	// 幂等：再合一次不应再报该补丁
	_, again := mergeSeedDefinitions(merged, seed)
	if contains(again, "relations.voiced_by.participant_slot") {
		t.Fatal("第二次合并不应再报槽位补丁")
	}

	// 已有值不覆盖：document 里已经写过的槽位保持原样
	custom := cur
	custom.Relations["voiced_by"] = RelationDefinition{Names: seed.Relations["voiced_by"].Names, ParticipantSlot: "character"}
	kept, _ := mergeSeedDefinitions(custom, seed)
	if got := kept.Relations["voiced_by"].ParticipantSlot; got != "character" {
		t.Fatalf("已有槽位不应被种子覆盖，得到 %q", got)
	}
}

// 棘轮：种子里每条关系的槽位必须是三种合法取值之一。
// 新增关系码若忘了在 relSlot 里声明，缺省空串会被这条测试拦下——空串在前端等于"未声明"，
// 会把这条关系重新推回"按分组猜语义"的老路。
func TestDefaultsDeclareParticipantSlotForEveryRelation(t *testing.T) {
	d := Defaults()
	valid := map[string]bool{
		"person":    true,
		"character": true,
		"peer":      true,
	}
	for code, rel := range d.Relations {
		if !valid[rel.ParticipantSlot] {
			t.Errorf("关系 %q 的 participant_slot=%q 不是合法槽位", code, rel.ParticipantSlot)
		}
	}
	// 关键语义不能漂：署名关系必须是 person，角色登场必须是 character，派生关系必须是 peer。
	for _, code := range []string{"voiced_by", "created_by", "composed_by", "credit_for", "translated_by", "illustrated_by"} {
		if got := d.Relations[code].ParticipantSlot; got != "person" {
			t.Errorf("%q 应是 person 槽位，得到 %q", code, got)
		}
	}
	if got := d.Relations["character_in"].ParticipantSlot; got != "character" {
		t.Errorf("character_in 应是 character 槽位，得到 %q", got)
	}
	for _, code := range []string{"adaptation_of", "sequel_of", "translation_of", "cover_of", "pressing_of", "includes", "member_of"} {
		if got := d.Relations[code].ParticipantSlot; got != "peer" {
			t.Errorf("%q 应是 peer 槽位，得到 %q", code, got)
		}
	}
}
