package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func shelfFixtures() []Shelf {
	return []Shelf{
		{Slug: "music", SortOrder: 10},
		{Slug: "anime", SortOrder: 20},
		{Slug: "films", SortOrder: 30},
		{Slug: "novels", SortOrder: 40},
	}
}

func slugsOf(in []Shelf) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		out = append(out, s.Slug)
	}
	return out
}

// 默认（未设置偏好）时保持 sort_order 次序，不做任何裁剪。
func TestApplyHomePreferencesDefault(t *testing.T) {
	got := slugsOf(applyHomePreferences(shelfFixtures(), HomePreferences{}))
	want := []string{"music", "anime", "films", "novels"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

// 用户排定的分区置前，未列出的按默认序追加在后。
func TestApplyHomePreferencesOrder(t *testing.T) {
	got := slugsOf(applyHomePreferences(shelfFixtures(), HomePreferences{Order: []string{"novels", "films"}}))
	want := []string{"novels", "films", "music", "anime"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

// 隐藏项被移除，其余保持默认序。
func TestApplyHomePreferencesHidden(t *testing.T) {
	got := slugsOf(applyHomePreferences(shelfFixtures(), HomePreferences{Hidden: []string{"films"}}))
	want := []string{"music", "anime", "novels"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

// 管理台删除分区后，偏好里残留的旧 slug 必须被忽略而不是造成首页缺内容。
func TestApplyHomePreferencesUnknownSlugIgnored(t *testing.T) {
	got := slugsOf(applyHomePreferences(shelfFixtures(), HomePreferences{
		Order:  []string{"removed-shelf", "anime"},
		Hidden: []string{"also-removed"},
	}))
	want := []string{"anime", "music", "films", "novels"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

// dedupeSlugs 去空去重并保持首次出现顺序。
func TestDedupeSlugs(t *testing.T) {
	got := dedupeSlugs([]string{"a", "", "b", "a", "b", "c"})
	want := []string{"a", "b", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if len(dedupeSlugs(nil)) != 0 {
		t.Fatal("nil input should produce empty result")
	}
}

// 空 query 的货架按规则文档应收录全部作品，而不是无结果。
func TestShelfFilterEmptyQueryFallsBackToWorkKind(t *testing.T) {
	args := []any{}
	parts := shelfFilter(Shelf{}, &args, "e")
	if len(parts) != 1 || parts[0] != "e.kind='work'" {
		t.Fatalf("got %v want [e.kind='work']", parts)
	}
	if len(args) != 0 {
		t.Fatalf("empty query should bind no args, got %v", args)
	}
}

// types 走 JSONB 存在性判断；fields / vocab_terms 走 attributes 取值比较；
// relations 走 EXISTS 子查询。子条件之间 AND，同数组内 OR。
func TestShelfFilterCompilesAllConditionKinds(t *testing.T) {
	sh := Shelf{Query: ShelfQuery{
		Types:      []string{"music", "album"},
		Fields:     map[string][]string{"edition_date": {"2024"}},
		VocabTerms: map[string][]string{"edition_type": {"deluxe"}},
		Relations:  []string{"performed_by"},
	}}
	args := []any{}
	parts := shelfFilter(sh, &args, "e")
	if len(parts) != 4 {
		t.Fatalf("expected 4 predicates, got %d: %v", len(parts), parts)
	}
	// 空白项应被剔除，且空数组条件不入 SQL。
	sh2 := Shelf{Query: ShelfQuery{Types: []string{"  ", ""}, Fields: map[string][]string{"x": {""}}}}
	args2 := []any{}
	parts2 := shelfFilter(sh2, &args2, "e")
	if len(parts2) != 1 || parts2[0] != "e.kind='work'" {
		t.Fatalf("blank conditions should collapse to work kind, got %v", parts2)
	}
}

func TestTrimAll(t *testing.T) {
	if got := trimAll([]string{" a ", "", "b"}); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("got %v", got)
	}
	if got := trimAll([]string{"", "  "}); got != nil {
		t.Fatalf("all-blank should return nil, got %v", got)
	}
}

// infobox 原文摊平：保序、去空键、同名多值展开为多行。
func TestBangumiInfoboxEntries(t *testing.T) {
	s := bangumiSubject{Infobox: []bangumiInfoItem{
		{Key: "话数", Value: json.RawMessage(`"12"`)},
		{Key: "别名", Value: json.RawMessage(`[{"v":"A"},{"v":"B"}]`)},
		{Key: "", Value: json.RawMessage(`"ignored"`)},
		{Key: "Copyright", Value: json.RawMessage(`"© test"`)},
	}}
	got := s.infoboxEntries()
	want := []string{"话数=12", "别名=A", "别名=B", "Copyright=© test"}
	flat := make([]string, 0, len(got))
	for _, e := range got {
		flat = append(flat, fmt.Sprint(e["key"])+"="+fmt.Sprint(e["value"]))
	}
	if !reflect.DeepEqual(flat, want) {
		t.Fatalf("got %v want %v", flat, want)
	}
}

// infobox 键映射只产出有值的已声明字段码。
func TestBangumiInfoboxValues(t *testing.T) {
	s := bangumiSubject{Infobox: []bangumiInfoItem{
		{Key: "话数", Value: json.RawMessage(`"24"`)},
		{Key: "ISBN", Value: json.RawMessage(`"978-4-00-000000-0"`)},
		{Key: "放送星期", Value: json.RawMessage(`"星期六"`)},
	}}
	got := s.infoboxValues()
	if got["episodes"] != 24 || got["isbn"] != "978-4-00-000000-0" || got["broadcast_weekday"] != "星期六" {
		t.Fatalf("got %v", got)
	}
	if _, ok := got["volume_count"]; ok {
		t.Fatalf("absent key must not be produced: %v", got)
	}
}

// 上游数字/日期是自由文本，必须归一化为字段类型可接受的值，
// 否则会被规格校验以 invalid_number / invalid_date 拒绝整次导入。
func TestNormalizeInfoboxValue(t *testing.T) {
	cases := []struct {
		raw, kind string
		want      any
	}{
		{"13", "number", 13},
		{"24(22+2)卷完结", "number", 24},
		{"全12话", "number", 12},
		{"暂无", "number", nil},
		{"2023年6月29日", "date", "2023-06-29"},
		{"2023/6/9", "date", "2023-06-09"},
		{"2023-06", "date", "2023-06"},
		{"2023年", "date", "2023"},
		{"待定", "date", nil},
		{"TOKYO MX", "text", "TOKYO MX"},
	}
	for _, c := range cases {
		if got := normalizeInfoboxValue(c.raw, c.kind); got != c.want {
			t.Errorf("normalize(%q,%s) = %v (%T), want %v", c.raw, c.kind, got, got, c.want)
		}
	}
}

// 动态字段值必须保类型：整数不能被 stringify 成 "13"，否则 number 字段校验必失败。
func TestDynamicFieldValueKeepsType(t *testing.T) {
	if v, ok := dynamicFieldValue(13); !ok || v != 13 {
		t.Fatalf("int must stay int, got %#v ok=%v", v, ok)
	}
	if v, ok := dynamicFieldValue("  2023-06-29  "); !ok || v != "2023-06-29" {
		t.Fatalf("string must be trimmed, got %#v", v)
	}
	if _, ok := dynamicFieldValue("   "); ok {
		t.Fatal("blank string must be dropped")
	}
}

// 映射表里的字段码必须在 defaults 中已声明，否则写入会被校验拒绝（unknown_field）。
func TestInfoboxFieldKeysAreDeclared(t *testing.T) {
	d := Defaults()
	for _, m := range infoboxFieldKeys {
		if _, ok := d.Fields[m.field]; !ok {
			t.Fatalf("infobox field %q is not declared in defaults", m.field)
		}
	}
}

// 标签过滤必须编译成 jsonb 容器包含（@>），才能命中 entities_attribute_tags
// 函数索引；若退化为展开比较就等于全表扫描。
func TestListFilterTagContainerMatch(t *testing.T) {
	s := &Store{}
	args := []any{}
	parts, err := listFilter(context.Background(), s, ListOptions{Tags: []string{"动画", "音乐"}}, nil, &args)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(parts, " AND ")
	if !strings.Contains(joined, "@>") {
		t.Fatalf("tag filter must use container match (@>), got: %s", joined)
	}
	if !strings.Contains(joined, " OR ") {
		t.Fatalf("multiple tags must be OR-ed, got: %s", joined)
	}
	if len(args) != 2 {
		t.Fatalf("expected 2 bound args, got %v", args)
	}
	// 空白标签被剔除后不应产生任何谓词。
	args2 := []any{}
	parts2, err := listFilter(context.Background(), s, ListOptions{Tags: []string{"", "  "}}, nil, &args2)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range parts2 {
		if strings.Contains(p, "@>") {
			t.Fatalf("blank tags must add no tag predicate, got %v", parts2)
		}
	}
}
