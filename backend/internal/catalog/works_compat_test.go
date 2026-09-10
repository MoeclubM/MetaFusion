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
