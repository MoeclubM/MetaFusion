package catalog

import "testing"

func TestPictureFromRemote(t *testing.T) {
	// 正常远端封面：Kind=url、citation 非空、Source.URL 用条目页
	p, ok := pictureFromRemote("https://lain.bgm.tv/pic/cover/l/ab.jpg", "Bangumi 条目封面", "bangumi:subject:428735", true)
	if !ok {
		t.Fatal("valid remote picture rejected")
	}
	if p.URL != "https://lain.bgm.tv/pic/cover/l/ab.jpg" || p.Source.Kind != "url" ||
		p.Source.URL != "https://bgm.tv/subject/428735" || p.Source.Citation == "" {
		t.Errorf("picture = %+v", p)
	}
	if err := validateSources("picture", []Source{p.Source}); err != nil {
		t.Errorf("picture source must satisfy evidence rules: %v", err)
	}
	if cn, ok := pictureFromRemote("https://lain.bgm.tv/pic/c.jpg", "Bangumi 头像", "bangumi:character:200841", true); !ok ||
		cn.Source.URL != "https://bgm.tv/character/200841" {
		t.Errorf("character picture = %+v ok=%v", cn, ok)
	}
	// 空/非法 URL 不写图，不伪造占位
	if _, ok := pictureFromRemote("   ", "x", "", false); ok {
		t.Error("empty image url accepted")
	}
	if _, ok := pictureFromRemote("javascript:alert(1)", "x", "", false); ok {
		t.Error("unsafe image url accepted")
	}
}

func TestDefaultsCreditRelations(t *testing.T) {
	d := Defaults()
	if err := d.Validate(); err != nil {
		t.Fatalf("defaults invalid: %v", err)
	}
	for _, code := range []string{"composed_by", "lyricist_of", "arranged_by", "directed_by", "written_by", "illustrated_by", "narrated_by"} {
		r, ok := d.Relations[code]
		if !ok {
			t.Errorf("missing credit relation %s", code)
			continue
		}
		if r.Group != "credits" || len(r.TargetKinds) != 1 || r.TargetKinds[0] != "agent" || !r.Enabled {
			t.Errorf("%s: group=%q targets=%v enabled=%v", code, r.Group, r.TargetKinds, r.Enabled)
		}
		if len(r.SourceKinds) == 0 {
			t.Errorf("%s has no source kinds", code)
		}
	}
}

// TestStringScalarMapKeepsIntIDs 回归：预览 DTO 用 Go int 装 ID，
// stringScalarMap 若只认 float64 会静默丢弃外部 ID。
func TestStringScalarMapKeepsIntIDs(t *testing.T) {
	got := stringScalarMap(map[string]any{
		"bangumi_person":    45638,
		"bangumi_character": int64(200841),
		"bangumi":           float64(428735),
		"text":              "keep",
		"flag":              true,
	})
	want := map[string]string{
		"bangumi_person":    "45638",
		"bangumi_character": "200841",
		"bangumi":           "428735",
		"text":              "keep",
		"flag":              "true",
	}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s: got %q want %q", k, got[k], v)
		}
	}
}

// catalog_metadata 声明为 any：HTTP JSON 往返后是 float64，同进程直传保留 int。
// 两种形态都必须还原类型，否则类型丢失会让该类型允许的字段被判成未知字段。
func TestWorkTypeFromMetadataAcceptsIntAndFloat(t *testing.T) {
	cases := []struct {
		name string
		meta any
		want string
	}{
		{"float64(HTTP JSON)", map[string]any{"bangumi_type": float64(2)}, "animation"},
		{"int(同进程直传)", map[string]any{"bangumi_type": 2}, "animation"},
		{"int64", map[string]any{"bangumi_type": int64(3)}, "music"},
		{"未识别类型码", map[string]any{"bangumi_type": 5}, ""},
		{"缺字段", map[string]any{}, ""},
		{"非对象", "animation", ""},
	}
	for _, c := range cases {
		if got := workTypeFromMetadata(c.meta); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

// 类型未识别时不能写入任何属性：edition_date 只在 workType 非空时落库，
// 否则校验会以 unknown_field 拒绝整条导入。
func TestBuildWorkEntityOmitsAttributesWithoutType(t *testing.T) {
	w := &ImporterWorkPreview{Title: "无类型作品", ReleaseDate: "2002-09-27"}
	e, err := buildWorkEntity(w, "", "bangumi", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Types) != 0 {
		t.Fatalf("unexpected types: %v", e.Types)
	}
	if len(e.Attributes) != 0 {
		t.Fatalf("attributes written without a type: %v", e.Attributes)
	}

	typed, err := buildWorkEntity(w, "animation", "bangumi", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if typed.Attributes["edition_date"] != "2002-09-27" {
		t.Fatalf("edition_date not kept for typed work: %v", typed.Attributes)
	}
}
