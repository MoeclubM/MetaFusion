package catalog

import "testing"

func TestDictTermLocalization(t *testing.T) {
	n := Names{"zh-CN": "音乐作品", "en-US": "Music work"}
	zh := dictTerm("music", n, "zh-CN")
	if zh["name"] != "音乐作品" || zh["name_zh"] != "音乐作品" || zh["name_en"] != "Music work" {
		t.Fatalf("zh term = %v", zh)
	}
	en := dictTerm("music", n, "en-US")
	if en["name"] != "Music work" {
		t.Fatalf("en name = %v", en["name"])
	}
	// 未知 locale 回退 zh-CN，再回退 en-US
	if got := dictTerm("music", n, "fr-FR")["name"]; got != "音乐作品" {
		t.Fatalf("fallback name = %v", got)
	}
}

func TestArtistCompatEntityTypeMapping(t *testing.T) {
	cases := []struct {
		types []string
		want  string
	}{
		{[]string{"character"}, "virtual_character"},
		{[]string{"group"}, "group"},
		{[]string{"organization"}, "organization"},
		{[]string{"person"}, "person"},
		{nil, "person"},
		{[]string{"anonymous", "group"}, "group"},
	}
	for _, c := range cases {
		if got := artistCompatEntityType(Entity{Types: c.types}); got != c.want {
			t.Errorf("types %v: got %q want %q", c.types, got, c.want)
		}
	}
}

func TestCanonicalEntryCompatPayload(t *testing.T) {
	e := Entity{
		ID: "e1", Kind: "expression", Title: "曲目 A", OriginalLanguage: "ja",
		WorkID: "w1", Position: 2, Number: "02",
		Translations: map[string]Translation{"ja": {Title: "曲目 A"}, "zh-CN": {Title: "曲目 甲"}},
		Attributes:   map[string]any{"role": "primary", "duration": 215, "isrc": "JPXXX"},
	}
	p := canonicalEntryCompatPayload(e)
	if p["kind"] != "expression" || p["work_id"] != "w1" || p["entry_role"] != "primary" {
		t.Fatalf("payload = %v", p)
	}
	if p["duration_seconds"] != 215 || p["isrc"] != "JPXXX" {
		t.Fatalf("duration/isrc = %v / %v", p["duration_seconds"], p["isrc"])
	}
	tr := p["translations"].(map[string]any)
	if tr["zh-CN"].(map[string]any)["title"] != "曲目 甲" {
		t.Fatalf("translations = %v", tr)
	}
	if p["contents"].([]any) == nil {
		t.Fatal("contents must be a non-nil empty slice")
	}
}

func TestEntityTranslationNames(t *testing.T) {
	e := Entity{Translations: map[string]Translation{"ja": {Title: "初回盤"}, "en-US": {Title: "First press"}}}
	n := entityTranslationNames(e)
	if n["ja"].(map[string]any)["name"] != "初回盤" {
		t.Fatalf("names = %v", n)
	}
	if entityTranslationTitles(e)["en-US"].(map[string]any)["title"] != "First press" {
		t.Fatalf("titles mismatch")
	}
}
