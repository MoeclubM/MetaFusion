package modules

import (
	"reflect"
	"testing"
)

// 标签 slug 只保留 [a-z0-9-]，中文/符号不会被塞进 slug 造成唯一键冲突。
func TestTagSlug(t *testing.T) {
	cases := map[string]string{
		"Music":        "music",
		"考据 评注":       "",
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
