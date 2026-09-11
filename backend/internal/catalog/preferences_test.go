package catalog

import (
	"reflect"
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
