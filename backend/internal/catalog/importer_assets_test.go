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
