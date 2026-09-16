package catalog

import "testing"

// 译文补丁只填"仍是英文占位"的语种：缺该语种或该语种值等于英文时补，已有译文时绝不动。
func TestMergeSeedDefinitionsBackfillsOnlyPlaceholderTranslations(t *testing.T) {
	seed := Defaults()
	// 构造一个旧文档：character 字段只有中英两种，繁中/日文缺失；locale 字段的日文是人工改过的。
	cur := Definitions{
		Types:        map[string]TypeDefinition{},
		Fields:       map[string]Field{},
		Vocabularies: map[string]Vocabulary{},
		Relations:    map[string]RelationDefinition{},
		Templates:    map[string]Template{},
		Schemes:      map[string]Scheme{},
	}
	cur.Fields["character"] = Field{Names: Names{"zh-CN": "所饰角色", "en-US": "Character"}, Type: "entity", Enabled: true}
	cur.Fields["locale"] = Field{Names: Names{"zh-CN": "语种", "en-US": "Locale", "ja-JP": "手で直した語種名"}, Type: "text", Enabled: true}

	merged, added := mergeSeedDefinitions(cur, seed)
	got := merged.Fields["character"].Names
	if got["ja-JP"] == "" || got["ja-JP"] == "Character" {
		t.Fatalf("character 的日文应被补成真实译文，实际 %q", got["ja-JP"])
	}
	if got["zh-TW"] == "" || got["zh-TW"] == "Character" {
		t.Fatalf("character 的繁中应被补成真实译文，实际 %q", got["zh-TW"])
	}
	if kept := merged.Fields["locale"].Names["ja-JP"]; kept != "手で直した語種名" {
		t.Fatalf("人工改过的译文被覆盖了：%q", kept)
	}
	found := false
	for _, a := range added {
		if a == "fields.character.ja-JP" {
			found = true
		}
	}
	if !found {
		t.Fatalf("应在补丁清单里记录 fields.character.ja-JP：%v", added)
	}
	// 幂等：再合一次不应再报同一项
	_, again := mergeSeedDefinitions(merged, seed)
	for _, a := range again {
		if a == "fields.character.ja-JP" {
			t.Fatal("第二次合并不应再报 fields.character.ja-JP")
		}
	}
}
