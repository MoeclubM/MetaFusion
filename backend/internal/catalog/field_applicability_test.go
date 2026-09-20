package catalog

import (
	"context"
	"testing"
)

func allowAllRef(string, []string) error { return nil }

// 服务端契约（与前端恒等 effectiveTypesOf 对齐）：声明的 types 原样使用，
// 服务端不替调用方展开 kind 并集；空 types 回退仅兼容历史
// （存量无类型实体/导入未识别类型），新写必须显式声明 types。
func TestDeclaredTypesAreUsedVerbatim(t *testing.T) {
	d := Defaults()
	if got := d.effectiveOwnerTypes("work", []string{"song"}); len(got) != 1 || got[0] != "song" {
		t.Fatalf("声明的类型应原样返回，实际 %v", got)
	}
	// song-typed work：本类型字段可写，novel 专属字段仍拒绝，tags 自由。
	if err := d.validateEntityContent(Entity{Kind: "work", Title: "W", Status: "draft",
		Types: []string{"song"}, Attributes: map[string]any{"duration": float64(200)}}, allowAllRef, true); err != nil {
		t.Fatalf("本类型字段应放行：%v", err)
	}
	if err := d.validateEntityContent(Entity{Kind: "work", Title: "W", Status: "draft",
		Types: []string{"song"}, Attributes: map[string]any{"volume_count": float64(3)}}, allowAllRef, true); err == nil {
		t.Fatal("声明 [song] 的 work 写 novel 专属字段必须仍是 unknown_field")
	} else if err.Error() != "unknown_field: volume_count" {
		t.Fatalf("应报 unknown_field，实际 %v", err)
	}
}

// 空 types 按 kind 回退：Work/Release/Medium/Track/Agent/Expression/ContentUnit
// 填写本 kind 适用字段 + 标签 + 嵌套组，编辑/预检/保存共用的 validateEntityContent 放行。
// 不把有效类型写回 Types（自动加全部 types 会把一部小说同时标为音乐、动画、游戏）。
func TestEmptyTypesAcceptKindFieldsTagsAndGroups(t *testing.T) {
	d := Defaults()
	cases := []Entity{
		{Kind: "work", Title: "W", Status: "draft", Attributes: map[string]any{
			"language": "ja", "edition_date": "2024-01-02", "tags": []any{"rock", "live"}}},
		{Kind: "release", Title: "R", Status: "draft", Attributes: map[string]any{
			"catalog_number": "ABC-001", "edition_type": "limited", "tags": []any{"first-press"},
			"attachments": []any{map[string]any{
				"label":    map[string]any{"zh-CN": "小册子", "en-US": "Booklet"},
				"quantity": float64(1)}}}},
		{Kind: "medium", Title: "M", Status: "draft", Attributes: map[string]any{
			"format": "cd", "tags": []any{"remaster"}}},
		{Kind: "track", Title: "T", Status: "draft", Attributes: map[string]any{
			"duration": float64(180), "role": "primary", "tags": []any{"title-track"}}},
		{Kind: "agent", Title: "A", Status: "draft", Attributes: map[string]any{
			"tags": []any{"solo"}}},
		{Kind: "expression", Title: "E", Status: "draft", Attributes: map[string]any{
			"duration": float64(90)}},
		{Kind: "content_unit", Title: "C", Status: "draft", Attributes: map[string]any{
			"entry_role": "main", "air_date": "2024-04-05"}},
	}
	for _, e := range cases {
		if err := d.validateEntityContent(e, allowAllRef, true); err != nil {
			t.Errorf("kind %s 空 types 应按 kind 适用字段放行：%v", e.Kind, err)
		}
	}
}

// 空 types 不是免检：非本 kind 字段仍是 unknown_field。
func TestEmptyTypesRejectForeignFields(t *testing.T) {
	d := Defaults()
	cases := []Entity{
		{Kind: "work", Title: "W", Status: "draft", Attributes: map[string]any{"catalog_number": "X-001"}},
		{Kind: "expression", Title: "E", Status: "draft", Attributes: map[string]any{"catalog_number": "X-001"}},
		{Kind: "release", Title: "R", Status: "draft", Attributes: map[string]any{"entry_role": "main"}},
		{Kind: "track", Title: "T", Status: "draft", Attributes: map[string]any{"isbn": "978-0-00-000000-0"}},
		{Kind: "medium", Title: "M", Status: "draft", Attributes: map[string]any{"broadcast_start": "2024-01-01"}},
	}
	for _, e := range cases {
		if err := d.validateEntityContent(e, allowAllRef, true); err == nil {
			t.Errorf("kind %s 空 types 写非适用字段必须拒绝", e.Kind)
		} else if err.Error() != "unknown_field: "+foreignKey(e) {
			t.Errorf("kind %s 应报 unknown_field，实际 %v", e.Kind, err)
		}
	}
}

func foreignKey(e Entity) string {
	for k := range e.Attributes {
		return k
	}
	return ""
}

// 声明了 types 沿用严格口径：错 kind/未知码即错；tags 自由输入，类型未声明也可写。
func TestDeclaredTypesStayStrictWithFreeTags(t *testing.T) {
	d := Defaults()
	if err := d.validateEntityContent(Entity{Kind: "work", Title: "W", Status: "draft",
		Types: []string{"song"}, Attributes: map[string]any{"catalog_number": "X"}}, allowAllRef, true); err == nil {
		t.Fatal("声明类型未含字段必须仍是 unknown_field")
	}
	if err := d.validateEntityContent(Entity{Kind: "work", Title: "W", Status: "draft",
		Types: []string{"nope"}, Attributes: map[string]any{}}, allowAllRef, true); err == nil {
		t.Fatal("未知类型必须仍是 invalid_type")
	}
	if err := d.validateEntityContent(Entity{Kind: "work", Title: "W", Status: "draft",
		Types: []string{"release"}, Attributes: map[string]any{}}, allowAllRef, true); err == nil {
		t.Fatal("错 kind 类型必须仍是 invalid_type")
	}
	for _, e := range []Entity{
		{Kind: "agent", Title: "A", Status: "draft",
			Types: []string{"person"}, Attributes: map[string]any{"tags": []any{"solo"}}},
		{Kind: "work", Title: "W", Status: "draft",
			Types: []string{"song"}, Attributes: map[string]any{"tags": []any{"ballad"}, "duration": float64(200)}},
	} {
		if err := d.validateEntityContent(e, allowAllRef, true); err != nil {
			t.Errorf("kind %s 声明类型写 tags 应放行：%v", e.Kind, err)
		}
	}
}

// 方案匹配与字段适用看同一套有效类型：空 types 展开为该 kind 启用类型，
// 与显式声明全部类型匹配结果一致；无关 kind 不命中。
func TestSchemeMatchingParityForEmptyTypes(t *testing.T) {
	d := Defaults()
	d.Schemes["test_track_path"] = Scheme{
		Names: names("测试定位", "Test locator"), Slot: "locator",
		Kinds: []string{"track"}, Types: []string{"track"},
		Fields: []string{"relative_to", "path"}, Enabled: true,
	}
	if got := d.effectiveOwnerTypes("track", nil); len(got) != 1 || got[0] != "track" {
		t.Fatalf("空 types 应展开为该 kind 启用类型，实际 %v", got)
	}
	if got := d.effectiveOwnerTypes("track", []string{"track"}); len(got) != 1 || got[0] != "track" {
		t.Fatalf("声明类型应原样返回，实际 %v", got)
	}
	a := d.matchSchemes("locator", "track", nil)
	b := d.matchSchemes("locator", "track", []string{"track"})
	if encode(a) != encode(b) || len(a) != 1 {
		t.Fatalf("空 types 与声明类型方案匹配必须一致：%v vs %v", a, b)
	}
	if c := d.matchSchemes("locator", "work", nil); len(c) != 0 {
		t.Fatalf("无关 kind 不应命中 track 方案：%v", c)
	}
}

// 新定义发布后不改代码可走通（校验层）：后台给 song 加字段，空 types 与声明类型同过；
// 非 work kind 仍拒绝。
func TestNewDefinitionFieldFlowsWithoutCodeChange(t *testing.T) {
	d := Defaults()
	d.Fields["custom_mood"] = Field{Names: names("自定义心情", "Custom mood"), Type: "text", Enabled: true, Searchable: true}
	song := d.Types["song"]
	song.Fields = append(append([]string{}, song.Fields...), "custom_mood")
	d.Types["song"] = song
	for _, e := range []Entity{
		{Kind: "work", Title: "W", Status: "draft", Attributes: map[string]any{"custom_mood": "blue"}},
		{Kind: "work", Title: "W", Status: "draft", Types: []string{"song"}, Attributes: map[string]any{"custom_mood": "blue"}},
	} {
		if err := d.validateEntityContent(e, allowAllRef, true); err != nil {
			t.Fatalf("新字段应随定义自动可写（types=%v）：%v", e.Types, err)
		}
	}
	if err := d.validateEntityContent(Entity{Kind: "release", Title: "R", Status: "draft",
		Attributes: map[string]any{"custom_mood": "blue"}}, allowAllRef, true); err == nil {
		t.Fatal("新字段在非适用 kind 上必须仍拒绝")
	}
}

// GUI 验收的服务端部分：无历史 types 的 Work/Release/Medium/Track 填动态字段 +
// 标签 + 嵌套组 + 收录定位，保存回读一致，且 Types 不被改写（不自动加全部 types）。
func TestPostgresEmptyTypesKindFallbackRoundTrip(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	w := f.save(Entity{Kind: "work", Title: "无类型作品", Attributes: map[string]any{
		"language": "ja", "edition_date": "2024-01-02", "tags": []any{"rock"}}})
	if len(w.Types) != 0 {
		t.Fatalf("保存不应改写 Types，实际 %v", w.Types)
	}
	r := f.save(Entity{Kind: "release", Title: "无类型发行",
		Subjects: []Subject{{WorkID: w.ID, Role: "primary"}},
		Attributes: map[string]any{
			"catalog_number": "XYZ-001", "edition_type": "limited", "tags": []any{"first-press"},
			"attachments": []any{map[string]any{
				"label":    map[string]any{"en-US": "Booklet", "zh-CN": "小册子"},
				"quantity": float64(2)}}}})
	m := f.save(Entity{Kind: "medium", Title: "CD", ReleaseID: r.ID, Attributes: map[string]any{
		"format": "cd", "tags": []any{"disc1"}}})
	x := f.save(Entity{Kind: "expression", Title: "录音", WorkID: w.ID, Attributes: map[string]any{
		"duration": float64(200)}})
	tr := f.save(Entity{Kind: "track", Title: "第一轨", MediumID: m.ID, Number: "A1",
		Contents: []Inclusion{{ExpressionID: x.ID, Position: 0,
			Locator: Locator{"relative_to": "track", "time_start_ms": float64(0), "time_end_ms": float64(30000)}}},
		Attributes: map[string]any{"duration": float64(200), "tags": []any{"title"}}})
	gw, err := f.s.Get(ctx, w.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(gw.Types) != 0 || gw.Attributes["language"] != "ja" || gw.Attributes["edition_date"] != "2024-01-02" {
		t.Fatalf("作品回读不一致：types=%v attrs=%v", gw.Types, gw.Attributes)
	}
	if tags, _ := gw.Attributes["tags"].([]any); len(tags) != 1 || tags[0] != "rock" {
		t.Fatalf("作品标签回读不一致：%v", gw.Attributes["tags"])
	}
	gr, err := f.s.Get(ctx, r.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(gr.Types) != 0 || gr.Attributes["catalog_number"] != "XYZ-001" || len(gr.Subjects) != 1 || gr.Subjects[0].WorkID != w.ID {
		t.Fatalf("发行回读不一致：types=%v attrs=%v subjects=%v", gr.Types, gr.Attributes, gr.Subjects)
	}
	gm, err := f.s.Get(ctx, m.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(gm.Types) != 0 || gm.Attributes["format"] != "cd" {
		t.Fatalf("载体回读不一致：types=%v attrs=%v", gm.Types, gm.Attributes)
	}
	gt, err := f.s.Get(ctx, tr.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(gt.Types) != 0 || len(gt.Contents) != 1 || gt.Contents[0].ExpressionID != x.ID {
		t.Fatalf("收录回读不一致：types=%v contents=%v", gt.Types, gt.Contents)
	}
	if gt.Contents[0].Locator["relative_to"] != "track" {
		t.Fatalf("定位回读不一致：%v", gt.Contents[0].Locator)
	}
}
