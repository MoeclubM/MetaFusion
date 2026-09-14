package catalog

import "testing"

// 区间顺序只认显式声明（Field.RangeStart）：
// 名字像 start/end 但没有声明的数字字段不得触发隐含规则；显式声明后必须生效；
// 声明本身必须自洽（起点存在、双方都是 number、无自环与链式）。
func TestGroupRangeOrderIsExplicit(t *testing.T) {
	d := Defaults()
	ref := func(string, []string) error { return nil }
	num := func(zh, en string) Field {
		return Field{Names: names(zh, en), Type: "number", Enabled: true}
	}

	// 无声明：即使字段名符合旧的 start/end 约定，也不校验大小关系。
	implicit := Field{Names: names("定位", "Locator"), Type: "group", Enabled: true, Fields: map[string]Field{
		"page_start": num("起始页", "Start page"),
		"page_end":   num("结束页", "End page"),
		"time_max":   num("上限", "Max"),
	}}
	if err := d.value(implicit, map[string]any{"page_start": float64(9), "page_end": float64(1)}, ref, false); err != nil {
		t.Fatalf("undeclared range must not be enforced: %v", err)
	}

	// 声明后生效：起点不得大于终点，正常顺序放行。
	explicit := implicit
	explicit.Fields["page_end"] = Field{Names: names("结束页", "End page"), Type: "number", Enabled: true, RangeStart: "page_start"}
	if err := d.value(explicit, map[string]any{"page_start": float64(9), "page_end": float64(1)}, ref, false); err == nil {
		t.Fatal("declared range not enforced")
	}
	if err := d.value(explicit, map[string]any{"page_start": float64(1), "page_end": float64(9)}, ref, false); err != nil {
		t.Fatalf("valid range rejected: %v", err)
	}

	// 种子 definitions 的定位组保留显式声明，行为与修复前一致。
	if err := d.value(d.Fields["locator"], map[string]any{"relative_to": "track", "time_start_ms": float64(500), "time_end_ms": float64(100)}, ref, false); err == nil {
		t.Fatal("seed locator range not enforced")
	}

	// 声明自洽性：未知起点、自环、链式、非数值端点一律拒绝。
	bad := []struct {
		name  string
		group Field
	}{
		{"unknown", Field{Fields: map[string]Field{"end": {Type: "number", RangeStart: "no_such_field"}}}},
		{"self", Field{Fields: map[string]Field{"end": {Type: "number", RangeStart: "end"}}}},
		{"chain", Field{Fields: map[string]Field{
			"start":  num("起", "Start"),
			"middle": {Type: "number", RangeStart: "start"},
			"end":    {Type: "number", RangeStart: "middle"},
		}}},
		{"non-number end", Field{Fields: map[string]Field{
			"start": num("起", "Start"),
			"end":   {Type: "text", RangeStart: "start"},
		}}},
		{"non-number start", Field{Fields: map[string]Field{
			"start": {Type: "text"},
			"end":   {Type: "number", RangeStart: "start"},
		}}},
	}
	for _, tc := range bad {
		if err := validateGroupRanges(tc.group); err == nil {
			t.Fatalf("invalid range declaration accepted: %s", tc.name)
		}
	}
}
