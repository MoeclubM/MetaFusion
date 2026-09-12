package modules

import (
	"context"
	"reflect"
	"testing"
)

// 标签 slug 只把 ASCII 字母数字规整成 kebab-case；非拉丁名称回退为原名，
// 否则纯中文标签会因 slug 为空被静默丢弃（曾因此丢失全部中文标签）。
func TestTagSlug(t *testing.T) {
	cases := map[string]string{
		"Music":        "music",
		"考据 评注":       "考据 评注",
		"考据":           "考据",
		"Hello World!": "hello-world",
		"a--b":         "a-b",
		"  Trim  ":     "trim",
	}
	for in, want := range cases {
		if got := tagSlug(in); got != want {
			t.Errorf("tagSlug(%q)=%q want %q", in, got, want)
		}
	}
}

// 播种板块必须覆盖前端 FALLBACK_BOARDS 的六个 code，且 comment 不进信息流。
func TestDefaultBoardsShape(t *testing.T) {
	codes := []string{}
	inFeed := map[string]bool{}
	for _, b := range defaultBoards {
		codes = append(codes, b.Code)
		inFeed[b.Code] = b.InFeed
		if b.Names["zh-CN"] == "" || b.Names["en-US"] == "" {
			t.Errorf("board %s missing bilingual name", b.Code)
		}
	}
	want := []string{"announcement", "casual", "qa", "reviews", "bug_report", "comment"}
	if !reflect.DeepEqual(codes, want) {
		t.Fatalf("codes=%v want %v", codes, want)
	}
	if inFeed["comment"] {
		t.Fatal("comment board must not appear in feed")
	}
	for _, c := range []string{"announcement", "casual", "qa", "reviews", "bug_report"} {
		if !inFeed[c] {
			t.Fatalf("board %s should be in feed", c)
		}
	}
}

// 主题列表/详情的实体元信息必须经 Catalog 边界补齐，且不覆盖主题自身字段；
// 未锚定实体或不可见的实体不注入 entity_title/entity_kind，供前端据此不渲染横幅。
func TestAttachTopicEntities(t *testing.T) {
	ctx := context.Background()
	stub := &catalogStub{}
	m := &Manager{catalog: stub}
	items := []map[string]any{
		{"id": "t1", "entity_id": "e1", "title": "主题一"},
		{"id": "t2", "entity_id": "e2"},
		{"id": "t3"}, // 未锚定实体
	}
	attachTopicEntities(ctx, m, items, nil)

	if items[0]["entity_title"] != "Stub e1" || items[0]["entity_kind"] != "work" {
		t.Fatalf("anchored topic not enriched: %v", items[0])
	}
	if items[0]["title"] != "主题一" {
		t.Fatalf("topic title must not be overwritten: %v", items[0])
	}
	if _, ok := items[2]["entity_title"]; ok {
		t.Fatalf("unanchored topic must not carry entity_title: %v", items[2])
	}
	// 批量一次取元信息，不按条查询。
	if stub.calls != 1 {
		t.Fatalf("expected one LookupMany call, got %d", stub.calls)
	}
}
