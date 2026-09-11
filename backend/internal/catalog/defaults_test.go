package catalog

import "testing"


// 词表必须包含编目常用的作品间关系；反向名需成对声明。
func TestDefaultsWorkRelations(t *testing.T) {
	d := Defaults()
	for _, code := range []string{"adaptation_of", "sequel_of", "spin_off_of", "soundtrack_of", "character_in", "written_by", "illustrated_by"} {
		rel, ok := d.Relations[code]
		if !ok || !rel.Enabled {
			t.Fatalf("relation %q missing or disabled", code)
		}
		if rel.Names["zh-CN"] == "" || rel.Names["en-US"] == "" || rel.ReverseNames["zh-CN"] == "" {
			t.Fatalf("relation %q names incomplete: %+v", code, rel)
		}
	}
	if rel := d.Relations["spin_off_of"]; !rel.Acyclic || rel.SourceKinds[0] != "work" || rel.TargetKinds[0] != "work" {
		t.Fatalf("spin_off_of misconfigured: %+v", rel)
	}
}
