package catalog

import (
	"strings"
	"testing"
)

func TestBangumiCharacterAgentType(t *testing.T) {
	female := "Female"
	cases := []struct {
		name    string
		gender  *string
		summary string
		want    string
	}{
		{"band without gender", nil, "MyGO!!!!!是《BanG Dream!》及其衍生作品的登场乐队，以及企划下第五支真实女子乐队。", "group"},
		{"band traditional chinese", nil, "登場樂隊，成員五人。", "group"},
		{"band japanese", nil, "『バンド「Ave Mujica」の物語。', ", "group"},
		{"english band word", nil, "A virtual band formed in the series.", "group"},
		{"husband must not match", nil, "She lives with her husband in the suburbs.", "character"},
		{"gendered character mentioning band", &female, "她是乐队的主唱。", "character"},
		{"plain character", nil, "羽丘女子学园的学生，性格内向。", "character"},
		{"empty summary", nil, "", "character"},
	}
	for _, c := range cases {
		if got := bangumiCharacterAgentType(c.gender, c.summary); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

func TestAgentCompatType(t *testing.T) {
	if got := agentCompatType(Entity{Types: []string{"character"}}); got != "virtual_character" {
		t.Errorf("character mapping: got %q", got)
	}
	if got := agentCompatType(Entity{Types: []string{"group"}}); got != "group" {
		t.Errorf("group mapping: got %q", got)
	}
	if got := agentCompatType(Entity{}); got != "person" {
		t.Errorf("empty types: got %q", got)
	}
}

func TestWorkCompatPayload(t *testing.T) {
	work := Entity{
		ID: "w1", Kind: "work", Title: "BanG Dream! It's MyGO!!!!!", Status: "published",
		OriginalLanguage: "ja",
		Translations: map[string]Translation{
			"ja":    {Title: "BanG Dream! It's MyGO!!!!!", Summary: "バンドアニメ"},
			"zh-CN": {Title: "BanG Dream! It's MyGO!!!!!", Summary: "乐队动画"},
		},
		Pictures:   []Picture{{URL: "https://example.com/cover.jpg"}},
		Attributes: map[string]any{"edition_date": "2023-06-29"},
	}
	band := Entity{ID: "a1", Kind: "agent", Title: "MyGO!!!!!", Types: []string{"group"}}
	chara := Entity{ID: "a2", Kind: "agent", Title: "高松灯", Types: []string{"character"}}
	rels := []Relation{
		{ID: "r1", Type: "performed_by", SourceID: "w1", TargetID: "a1"},
		{ID: "r2", Type: "voiced_by", SourceID: "w1", TargetID: "a2", Attributes: map[string]any{"character": "高松灯"}},
	}
	others := map[string]Entity{"a1": band, "a2": chara}
	p := workCompatPayload(work, rels, others, map[string]string{"performed_by": "表演者", "voiced_by": "配音者"})

	artistRels := p["artist_relations"].([]map[string]any)
	if len(artistRels) != 2 {
		t.Fatalf("artist_relations len = %d", len(artistRels))
	}
	if artistRels[0]["role"] != "表演者" {
		t.Errorf("band role = %v, want 表演者 (localized)", artistRels[0]["role"])
	}
	if artistRels[0]["artist"].(map[string]any)["entity_type"] != "group" {
		t.Errorf("band entity_type = %v, want group", artistRels[0]["artist"])
	}
	// 声优角色名走旧前端可解析的 "配演: <角色>" 格式
	if !strings.Contains(artistRels[1]["role"].(string), "配演: 高松灯") {
		t.Errorf("voice role = %v", artistRels[1]["role"])
	}
	if artistRels[1]["artist"].(map[string]any)["entity_type"] != "virtual_character" {
		t.Errorf("character entity_type = %v", artistRels[1]["artist"])
	}

	connected := p["connected_entities"].([]map[string]any)
	if len(connected) != 2 {
		t.Fatalf("connected len = %d", len(connected))
	}
	if connected[0]["direction"] != "forward" || connected[0]["entity_type"] != "agent" {
		t.Errorf("connected[0] = %v", connected[0])
	}

	trans := p["translations"].([]map[string]any)
	if len(trans) != 2 || trans[0]["locale"] != "ja" {
		t.Errorf("translations = %v", trans)
	}
	if p["summary"] != "バンドアニメ" {
		t.Errorf("summary = %v", p["summary"])
	}
	if p["cover_image_url"] != "https://example.com/cover.jpg" {
		t.Errorf("cover = %v", p["cover_image_url"])
	}
}

// character_in 方向是 agent → work，且 character 属性在新数据里存角色实体 ID，
// 两者都必须正确解析，否则详情页角色卡与声优无法配对。
func TestWorkCompatPayloadCharacterIn(t *testing.T) {
	work := Entity{ID: "w1", Kind: "work", Title: "作品", Status: "published"}
	chara := Entity{ID: "a2", Kind: "agent", Title: "高松灯", Types: []string{"character"}}
	voice := Entity{ID: "a3", Kind: "agent", Title: "声优甲", Types: []string{"person"}}
	rels := []Relation{
		{ID: "r1", Type: "character_in", SourceID: "a2", TargetID: "w1", Attributes: map[string]any{"role": "primary"}},
		{ID: "r2", Type: "voiced_by", SourceID: "w1", TargetID: "a3", Attributes: map[string]any{"character": "a2"}},
	}
	others := map[string]Entity{"a2": chara, "a3": voice}
	p := workCompatPayload(work, rels, others, map[string]string{"character_in": "角色登场", "voiced_by": "配音者"})
	artistRels := p["artist_relations"].([]map[string]any)
	if len(artistRels) != 2 {
		t.Fatalf("artist_relations len = %d: %v", len(artistRels), artistRels)
	}
	byArtist := map[string]map[string]any{}
	for _, r := range artistRels {
		byArtist[r["artist_id"].(string)] = r
	}
	if got := byArtist["a2"]["role"]; got != "主角" {
		t.Errorf("character_in role = %v, want 主角", got)
	}
	// voiced_by 的 character=实体ID 必须解析成角色名再拼进 "配演: <名>"
	if !strings.Contains(byArtist["a3"]["role"].(string), "配演: 高松灯") {
		t.Errorf("voice role = %v, want 配演: 高松灯", byArtist["a3"]["role"])
	}
}

// credit_role 覆盖必须让位于声优的 "配演: <角色>" 配对格式，
// 否则前端 StaffCharacterSection 无法把角色与声优配对；其余署名仍保留原始职位文本。
func TestWorkCompatPayloadCreditRolePrecedence(t *testing.T) {
	work := Entity{ID: "w1", Kind: "work", Title: "作品", Status: "published"}
	chara := Entity{ID: "a2", Kind: "agent", Title: "高松灯", Types: []string{"character"}}
	voice := Entity{ID: "a3", Kind: "agent", Title: "声优甲", Types: []string{"person"}}
	staff := Entity{ID: "a4", Kind: "agent", Title: "作监", Types: []string{"person"}}
	rels := []Relation{
		{ID: "r1", Type: "voiced_by", SourceID: "w1", TargetID: "a3",
			Attributes: map[string]any{"character": "a2", "credit_role": "配音"}},
		{ID: "r2", Type: "illustrated_by", SourceID: "w1", TargetID: "a4",
			Attributes: map[string]any{"credit_role": "作画监督"}},
	}
	others := map[string]Entity{"a2": chara, "a3": voice, "a4": staff}
	p := workCompatPayload(work, rels, others, map[string]string{"voiced_by": "配音者", "illustrated_by": "插画者"})
	byArtist := map[string]map[string]any{}
	for _, r := range p["artist_relations"].([]map[string]any) {
		byArtist[r["artist_id"].(string)] = r
	}
	if got := byArtist["a3"]["role"]; !strings.Contains(got.(string), "配演: 高松灯") {
		t.Errorf("voice actor role = %v, want 配演 pairing (credit_role must not override)", got)
	}
	if got := byArtist["a4"]["role"]; got != "作画监督" {
		t.Errorf("staff role = %v, want original credit_role text", got)
	}
}
