package catalog

import (
	"context"
	"testing"
)

func allowAllRef(string, []string) error { return nil }

// 服务端契约（与前端恒等 effectiveTypesOf 对齐）：声明的 types 原样使用，
// 服务端不替调用方展开 kind 并集；空 types 回退仅限历史口径
// （存量无类型实体/导入未识别类型，historical=true），新写（historical=false）
// 携带类型外属性即 types_required，方案匹配按前端同口径直接匹配空数组。
func TestDeclaredTypesAreUsedVerbatim(t *testing.T) {
	d := Defaults()
	if got := d.effectiveOwnerTypes("work", []string{"song"}, false); len(got) != 1 || got[0] != "song" {
		t.Fatalf("声明的类型应原样返回，实际 %v", got)
	}
	if got := d.effectiveOwnerTypes("work", []string{"song"}, true); len(got) != 1 || got[0] != "song" {
		t.Fatalf("声明的类型在历史口径下也应原样返回，实际 %v", got)
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

// 历史口径下空 types 按 kind 回退（存量无类型实体/导入未识别类型）：
// Work/Release/Medium/Track/Agent/Expression/ContentUnit
// 填写本 kind 适用字段 + 标签 + 嵌套组，编辑/预检/保存共用的 validateEntityContent 放行。
// 不把有效类型写回 Types（自动加全部 types 会把一部小说同时标为音乐、动画、游戏）。
// 新写口径见 TestEmptyTypesNewWriteRequiresTypes。
func TestHistoricalEmptyTypesAcceptKindFieldsTagsAndGroups(t *testing.T) {
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

// 方案匹配与字段适用看同一套有效类型：历史口径下空 types 展开为该 kind 启用类型，
// 与显式声明全部类型匹配结果一致；新写口径下空 types 按前端同口径直接匹配
// （只命中不限类型的方案）；无关 kind 不命中。
func TestSchemeMatchingParityForEmptyTypes(t *testing.T) {
	d := Defaults()
	d.Schemes["test_track_path"] = Scheme{
		Names: names("测试定位", "Test locator"), Slot: "locator",
		Kinds: []string{"track"}, Types: []string{"track"},
		Fields: []string{"relative_to", "path"}, Enabled: true,
	}
	// 历史口径：空展开，与声明一致。
	if got := d.effectiveOwnerTypes("track", nil, true); len(got) != 1 || got[0] != "track" {
		t.Fatalf("历史口径空 types 应展开为该 kind 启用类型，实际 %v", got)
	}
	a := d.matchSchemes("locator", "track", nil, true)
	b := d.matchSchemes("locator", "track", []string{"track"}, true)
	if encode(a) != encode(b) || len(a) != 1 {
		t.Fatalf("历史口径空 types 与声明类型方案匹配必须一致：%v vs %v", a, b)
	}
	// 新写口径：空不展开，只命中不限类型的方案（与前端 matchSchemes 直接匹配空数组同口径）。
	if got := d.effectiveOwnerTypes("track", nil, false); len(got) != 0 {
		t.Fatalf("新写口径空 types 不得展开，实际 %v", got)
	}
	if c := d.matchSchemes("locator", "track", nil, false); len(c) != 0 {
		t.Fatalf("新写口径空 types 不应命中限类型方案：%v", c)
	}
	if c := d.matchSchemes("locator", "track", []string{"track"}, false); len(c) != 1 {
		t.Fatalf("新写口径声明类型应命中限类型方案：%v", c)
	}
	if c := d.matchSchemes("locator", "work", nil, true); len(c) != 0 {
		t.Fatalf("无关 kind 不应命中 track 方案：%v", c)
	}
}

// 新写口径下空 types 携带类型外属性即 types_required（裸骨架/仅 tags 仍放行）；
// 历史口径（存量/导入）仍按 kind 回退。
func TestEmptyTypesNewWriteRequiresTypes(t *testing.T) {
	d := Defaults()
	content := []Entity{
		{Kind: "work", Title: "W", Status: "draft", Attributes: map[string]any{"language": "ja"}},
		{Kind: "release", Title: "R", Status: "draft", Attributes: map[string]any{"catalog_number": "X-001"}},
		{Kind: "track", Title: "T", Status: "draft", Attributes: map[string]any{"duration": float64(180)}},
	}
	for _, e := range content {
		if err := d.validateEntityContent(e, allowAllRef, false); err == nil || err.Error() != "types_required" {
			t.Errorf("kind %s 新写无类型有属性应报 types_required，实际 %v", e.Kind, err)
		}
		if err := d.validateEntityContent(e, allowAllRef, true); err != nil {
			t.Errorf("kind %s 历史口径应按 kind 回退放行：%v", e.Kind, err)
		}
	}
	bare := []Entity{
		{Kind: "work", Title: "W", Status: "draft"},
		{Kind: "work", Title: "W", Status: "draft", Attributes: map[string]any{"tags": []any{"rock"}}},
	}
	for _, e := range bare {
		if err := d.validateEntityContent(e, allowAllRef, false); err != nil {
			t.Errorf("裸骨架新写应放行：%v", err)
		}
	}
}

// 新定义发布后不改代码可走通（校验层）：后台给 song 加字段，声明类型新写即过；
// 空 types 新写报 types_required（历史口径仍回退同过）；非 work kind 仍拒绝。
func TestNewDefinitionFieldFlowsWithoutCodeChange(t *testing.T) {
	d := Defaults()
	d.Fields["custom_mood"] = Field{Names: names("自定义心情", "Custom mood"), Type: "text", Enabled: true, Searchable: true}
	song := d.Types["song"]
	song.Fields = append(append([]string{}, song.Fields...), "custom_mood")
	d.Types["song"] = song
	if err := d.validateEntityContent(Entity{Kind: "work", Title: "W", Status: "draft",
		Types: []string{"song"}, Attributes: map[string]any{"custom_mood": "blue"}}, allowAllRef, false); err != nil {
		t.Fatalf("新字段应随定义自动可写：%v", err)
	}
	if err := d.validateEntityContent(Entity{Kind: "work", Title: "W", Status: "draft",
		Attributes: map[string]any{"custom_mood": "blue"}}, allowAllRef, false); err == nil || err.Error() != "types_required" {
		t.Fatalf("空 types 新写应报 types_required，实际 %v", err)
	}
	if err := d.validateEntityContent(Entity{Kind: "work", Title: "W", Status: "draft",
		Attributes: map[string]any{"custom_mood": "blue"}}, allowAllRef, true); err != nil {
		t.Fatalf("空 types 历史口径应回退同过：%v", err)
	}
	if err := d.validateEntityContent(Entity{Kind: "release", Title: "R", Status: "draft",
		Attributes: map[string]any{"custom_mood": "blue"}}, allowAllRef, true); err == nil {
		t.Fatal("新字段在非适用 kind 上必须仍拒绝")
	}
}

// GUI 验收的服务端部分（前后端共同样例）：Work/Release/Medium/Track 显式声明 types
// （与 EntityEditor 显式类型提交同形状，新写必须声明 types），填动态字段 +
// 标签 + 嵌套组 + 收录定位，保存回读一致，且 Types 不被改写（不自动加全部 types）。
func TestPostgresExplicitTypesRoundTrip(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	w := f.save(Entity{Kind: "work", Title: "有类型作品", Types: []string{"song"}, Attributes: map[string]any{
		"language": "ja", "edition_date": "2024-01-02", "tags": []any{"rock"}}})
	if len(w.Types) != 1 || w.Types[0] != "song" {
		t.Fatalf("保存不应改写 Types，实际 %v", w.Types)
	}
	r := f.save(Entity{Kind: "release", Title: "有类型发行", Types: []string{"release"},
		Subjects: []Subject{{WorkID: w.ID, Role: "primary"}},
		Attributes: map[string]any{
			"catalog_number": "XYZ-001", "edition_type": "limited", "tags": []any{"first-press"},
			"attachments": []any{map[string]any{
				"label":    map[string]any{"en-US": "Booklet", "zh-CN": "小册子"},
				"quantity": float64(2)}}}})
	m := f.save(Entity{Kind: "medium", Title: "CD", ReleaseID: r.ID, Types: []string{"medium"}, Attributes: map[string]any{
		"format": "cd", "tags": []any{"disc1"}}})
	x := f.save(Entity{Kind: "expression", Title: "录音", WorkID: w.ID, Types: []string{"expression"}, Attributes: map[string]any{
		"duration": float64(200)}})
	tr := f.save(Entity{Kind: "track", Title: "第一轨", MediumID: m.ID, Number: "A1", Types: []string{"track"},
		Contents: []Inclusion{{ExpressionID: x.ID, Position: 0,
			Locator: Locator{"relative_to": "track", "time_start_ms": float64(0), "time_end_ms": float64(30000)}}},
		Attributes: map[string]any{"duration": float64(200), "tags": []any{"title"}}})
	gw, err := f.s.Get(ctx, w.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(gw.Types) != 1 || gw.Types[0] != "song" || gw.Attributes["language"] != "ja" || gw.Attributes["edition_date"] != "2024-01-02" {
		t.Fatalf("作品回读不一致：types=%v attrs=%v", gw.Types, gw.Attributes)
	}
	if tags, _ := gw.Attributes["tags"].([]any); len(tags) != 1 || tags[0] != "rock" {
		t.Fatalf("作品标签回读不一致：%v", gw.Attributes["tags"])
	}
	gr, err := f.s.Get(ctx, r.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(gr.Types) != 1 || gr.Types[0] != "release" || gr.Attributes["catalog_number"] != "XYZ-001" || len(gr.Subjects) != 1 || gr.Subjects[0].WorkID != w.ID {
		t.Fatalf("发行回读不一致：types=%v attrs=%v subjects=%v", gr.Types, gr.Attributes, gr.Subjects)
	}
	gm, err := f.s.Get(ctx, m.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(gm.Types) != 1 || gm.Types[0] != "medium" || gm.Attributes["format"] != "cd" {
		t.Fatalf("载体回读不一致：types=%v attrs=%v", gm.Types, gm.Attributes)
	}
	gt, err := f.s.Get(ctx, tr.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(gt.Types) != 1 || gt.Types[0] != "track" || len(gt.Contents) != 1 || gt.Contents[0].ExpressionID != x.ID {
		t.Fatalf("收录回读不一致：types=%v contents=%v", gt.Types, gt.Contents)
	}
	if gt.Contents[0].Locator["relative_to"] != "track" {
		t.Fatalf("定位回读不一致：%v", gt.Contents[0].Locator)
	}
}

// M05 Save 层门槛：手工新建携带类型外属性却无 types 即 types_required；
// 裸骨架新建仍放行；历史存量（已存在的无类型实体）更新仍回退；抹空已有 types 拦截。
func TestPostgresEmptyTypesSaveRequiresTypes(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	save := func(e Entity) (Entity, error) {
		if e.Status == "" {
			e.Status = "draft"
		}
		return f.s.Save(ctx, Edit{Entity: e, ExpectedVersion: e.Version, EditNote: "m05", Sources: fixtureSources()}, f.u)
	}
	// 有属性新建无 types：拒绝。
	if _, err := save(Entity{Kind: "work", Title: "无类型有属性",
		Attributes: map[string]any{"language": "ja"}}); err == nil || err.Error() != "types_required" {
		t.Fatalf("有属性新建无 types 应报 types_required，实际 %v", err)
	}
	// 裸骨架新建：放行（身份先行、字段后补）。
	bare := f.save(Entity{Kind: "work", Title: "裸骨架"})
	if len(bare.Types) != 0 {
		t.Fatalf("裸骨架不应被改写 types：%v", bare.Types)
	}
	// 历史存量更新：已存在的无类型实体补属性仍回退放行。
	bare.Attributes = map[string]any{"language": "ja", "tags": []any{"rock"}}
	if _, err := save(bare); err != nil {
		t.Fatalf("存量无类型实体更新应回退放行：%v", err)
	}
	// 抹空：已有 types 的实体更新时清空 types 且带属性，拦截。
	typed := f.save(Entity{Kind: "work", Title: "有类型", Types: []string{"song"},
		Attributes: map[string]any{"language": "ja"}})
	typed.Types = nil
	if _, err := save(typed); err == nil || err.Error() != "types_required" {
		t.Fatalf("抹空已有 types 应报 types_required，实际 %v", err)
	}
}
