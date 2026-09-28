package catalog

import "testing"

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
