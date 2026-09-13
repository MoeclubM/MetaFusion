package catalog

import (
	"regexp"
	"sort"
	"testing"
)

// 启动 SQL 只应"按需建表建索引 + 种子"：删列、删表、旧数据搬迁属一次性迁移，
// 必须放到版本化迁移里执行。这里守住这条边界，避免有人再把破坏性语句塞回启动路径。
func TestStartupSchemaHasNoDestructiveStatements(t *testing.T) {
	destructive := []*regexp.Regexp{
		regexp.MustCompile(`(?i)\bDROP\s+COLUMN\b`),
		regexp.MustCompile(`(?i)\bDROP\s+TABLE\b`),
		regexp.MustCompile(`(?i)\bDELETE\s+FROM\b`),
		regexp.MustCompile(`(?i)\bTRUNCATE\b`),
	}
	for _, re := range destructive {
		if loc := re.FindString(schema); loc != "" {
			t.Errorf("启动 SQL 含破坏性语句 %q；一次性数据迁移应移入 backend/migrations/", loc)
		}
	}
}

// 默认定义必须自洽：类型的模板与字段、模板引用的字段、词表归属都要能通过校验，
// 否则空库首次 Initialize 就会失败。
func TestDefaultsValidate(t *testing.T) {
	if err := Defaults().Validate(); err != nil {
		t.Fatalf("Defaults().Validate() = %v", err)
	}
}

// 版本维度必须各自独立：类别/批次/地区/渠道是能同时成立的维度，
// 把限定/初回/地区/再版塞进同一个互斥枚举就无法表达"日本初回限定再版"。
func TestDefaultsEditionDimensionsAreSeparate(t *testing.T) {
	d := Defaults()
	cases := map[string][]string{
		"edition_type":         {"standard", "limited", "deluxe", "boxset"},
		"edition_batch":        {"regular", "first_press", "reissue", "reprint"},
		"distribution_channel": {"mixed", "physical", "digital", "web"},
	}
	for vocab, want := range cases {
		v, ok := d.Vocabularies[vocab]
		if !ok {
			t.Fatalf("vocabulary %q missing", vocab)
		}
		got := make([]string, 0, len(v.Terms))
		for code := range v.Terms {
			got = append(got, code)
		}
		sort.Strings(got)
		sort.Strings(want)
		if len(got) != len(want) {
			t.Fatalf("vocabulary %q terms = %v, want %v", vocab, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("vocabulary %q terms = %v, want %v", vocab, got, want)
			}
		}
		if f := d.Fields[vocab]; f.Vocabulary != vocab {
			t.Fatalf("field %q not bound to its vocabulary: %+v", vocab, f)
		}
	}
	// "地区版" 与 "数字版" 不再作为类别词条存在：前者归 country，后者归 distribution_channel。
	for _, gone := range []string{"regional"} {
		if _, ok := d.Vocabularies["edition_type"].Terms[gone]; ok {
			t.Fatalf("edition_type should not carry %q any more", gone)
		}
	}
	if _, ok := d.Vocabularies["edition_type"].Terms["digital"]; ok {
		t.Fatalf("edition_type should not carry digital any more")
	}
}

// 作品字段集按媒体场景分开：歌曲不该出现 ISBN/出版社，动画才需要放送字段。
// 一致的是"具体产品标识"（品番/条码/ISBN/出版社）不再出现在任何 Work 类型上——
// 它们属于 Release/Medium。
func TestDefaultsWorkFieldsArePerMediaType(t *testing.T) {
	d := Defaults()
	has := func(typeCode, field string) bool {
		for _, f := range d.Types[typeCode].Fields {
			if f == field {
				return true
			}
		}
		return false
	}
	if has("song", "isbn") || has("album", "publisher_name") || has("music", "air_network") {
		t.Fatalf("song/album/music type still carries publishing or broadcast fields")
	}
	if !has("animation", "air_network") || !has("animation", "episodes") {
		t.Fatalf("animation type missing broadcast fields: %v", d.Types["animation"].Fields)
	}
	if !has("novel", "magazine") || !has("novel", "volume_count") {
		t.Fatalf("novel type missing serialization fields: %v", d.Types["novel"].Fields)
	}
	for _, typeCode := range []string{"music", "song", "album", "novel", "animation", "film", "photobook", "indie_game", "visual_novel", "personal"} {
		for _, product := range []string{"catalog_number", "barcode", "isbn", "publisher_name"} {
			if has(typeCode, product) {
				t.Fatalf("work type %q should not carry product identifier %q", typeCode, product)
			}
		}
	}
}

// Scheme 非法必须被 Validate 拒绝：slot 非法、字段未在全局组声明、
// required 越界；类型错一律拒绝。
func TestSchemesRejectedWhenInvalid(t *testing.T) {
	mk := func() Definitions {
		d := Defaults()
		d.Schemes = map[string]Scheme{
			"paper_pages": {
				Names: names("纸书页码", "Paper pages"), Slot: "locator",
				Kinds:    []string{"track"},
				Fields:   []string{"relative_to", "page_start", "page_end"},
				Required: []string{"page_start"},
			},
		}
		return d
	}
	if err := mk().Validate(); err != nil {
		t.Fatalf("valid scheme rejected: %v", err)
	}
	badSlot := mk()
	s := badSlot.Schemes["paper_pages"]
	s.Slot = "no_such_slot"
	badSlot.Schemes["paper_pages"] = s
	if err := badSlot.Validate(); err == nil {
		t.Fatal("scheme with invalid slot accepted")
	}
	unDeclared := mk()
	s = unDeclared.Schemes["paper_pages"]
	s.Fields = []string{"relative_to", "no_such_subfield"}
	unDeclared.Schemes["paper_pages"] = s
	if err := unDeclared.Validate(); err == nil {
		t.Fatal("scheme with undeclared field accepted")
	}
	outside := mk()
	s = outside.Schemes["paper_pages"]
	s.Required = []string{"chapter"}
	outside.Schemes["paper_pages"] = s
	if err := outside.Validate(); err == nil {
		t.Fatal("scheme with required outside fields accepted")
	}
	badKind := mk()
	s = badKind.Schemes["paper_pages"]
	s.Kinds = []string{"no_such_kind"}
	badKind.Schemes["paper_pages"] = s
	if err := badKind.Validate(); err == nil {
		t.Fatal("scheme with invalid kind accepted")
	}
}

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
