package catalog

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
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

// D3 Save 层正式口径：手工新建携带类型外属性却无 types 即 types_required；
// 单适用类型的 kind（medium/track）新建自动采用，不让用户重勾；裸骨架新建仍放行；
// 历史回退仅限真实旧数据（主键 UUIDv7 创建时间早于口径生效点），口径生效后"先裸建、
// 再补属性"的两步绕行同样拦截；抹空已有 types 拦截。
func TestPostgresEmptyTypesSaveRequiresTypes(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	save := func(e Entity) (Entity, error) {
		if e.Status == "" {
			e.Status = "draft"
		}
		return f.s.Save(ctx, Edit{Entity: e, ExpectedVersion: e.Version, EditNote: "d3", Sources: fixtureSources()}, f.u)
	}
	// 有属性新建无 types（多类型 kind）：拒绝。
	if _, err := save(Entity{Kind: "work", Title: "无类型有属性",
		Attributes: map[string]any{"language": "ja"}}); err == nil || err.Error() != "types_required" {
		t.Fatalf("有属性新建无 types 应报 types_required，实际 %v", err)
	}
	// 单类型 kind 自动采用：medium 只有一个启用类型，新建即采用，不拦截。
	rel := f.save(Entity{Kind: "release", Title: "自动采用发行"})
	med, err := save(Entity{Kind: "medium", Title: "自动采用载体", ReleaseID: rel.ID,
		Attributes: map[string]any{"format": "cd"}})
	if err != nil {
		t.Fatalf("单类型 kind 新建应自动采用：%v", err)
	}
	if len(med.Types) != 1 || med.Types[0] != "medium" {
		t.Fatalf("medium 新建应自动采用 [medium]，实际 %v", med.Types)
	}
	// 裸骨架新建：放行（身份先行、字段后补），多类型 kind 不改写。
	bare := f.save(Entity{Kind: "work", Title: "裸骨架"})
	if len(bare.Types) != 0 {
		t.Fatalf("裸骨架不应被改写 types：%v", bare.Types)
	}
	// 两步绕行关闭：口径生效后建的裸骨架再补属性，同样要先声明 types。
	bare.Attributes = map[string]any{"language": "ja", "tags": []any{"rock"}}
	if _, err := save(bare); err == nil || err.Error() != "types_required" {
		t.Fatalf("新裸建实体补属性应报 types_required，实际 %v", err)
	}
	// 真实旧数据回退：口径生效点之前创建的无类型实体补属性仍放行，且不写回 types。
	legacy := insertLegacyUntypedWork(t, f)
	legacy.Attributes = map[string]any{"language": "ja", "tags": []any{"rock"}}
	updated, err := save(legacy)
	if err != nil {
		t.Fatalf("真实旧数据更新应回退放行：%v", err)
	}
	if len(updated.Types) != 0 {
		t.Fatalf("回退不得写回 types：%v", updated.Types)
	}
	// 抹空：已有 types 的实体更新时清空 types 且带属性，拦截。
	typed := f.save(Entity{Kind: "work", Title: "有类型", Types: []string{"song"},
		Attributes: map[string]any{"language": "ja"}})
	typed.Types = nil
	if _, err := save(typed); err == nil || err.Error() != "types_required" {
		t.Fatalf("抹空已有 types 应报 types_required，实际 %v", err)
	}
}

// 主键时间戳判定（纯逻辑，无需真库）：v7 取毫秒时间戳、非 v7 按旧数据宽容；
// soleEnabledType 只在唯一启用类型时命中（medium 单一、work 多个）。
func TestUUIDv7MillisAndSoleType(t *testing.T) {
	fresh, err := uuid.NewV7()
	if err != nil {
		t.Skip("本机 uuid v7 生成不可用")
	}
	ms, ok := uuidV7Millis(fresh.String())
	if !ok {
		t.Fatal("刚生成的 v7 ID 应能提取时间戳")
	}
	now := time.Now().UnixMilli()
	if ms < explicitTypesCutoffMillis || ms > now+60000 {
		t.Fatalf("v7 时间戳应在口径生效点之后、现在之前：%d", ms)
	}
	if _, ok := uuidV7Millis(uuid.NewString()); ok {
		t.Fatal("v4 ID 不得被解读出时间戳")
	}
	if _, ok := uuidV7Millis("not-a-uuid"); ok {
		t.Fatal("非法 ID 不得被解读出时间戳")
	}
	d := Defaults()
	if code, ok := d.soleEnabledType("medium"); !ok || code != "medium" {
		t.Fatalf("medium 应唯一命中 medium，实际 %q %v", code, ok)
	}
	if _, ok := d.soleEnabledType("work"); ok {
		t.Fatal("work 有多个启用类型，不得自动采用")
	}
	if _, ok := d.soleEnabledType("no_such_kind"); ok {
		t.Fatal("未知 kind 不得命中")
	}
}

// insertLegacyUntypedWork 直插一条口径生效点之前创建的无类型 work（draft）：
// 主键是手工回拨时间戳的 UUIDv7（毫秒位拨到 2026-01-15），Save 建不出这种 ID
// （新建一律 newID 取当前时间），因此只能直插——这正是"真实旧数据"的含义。
func insertLegacyUntypedWork(t *testing.T, f fixture) Entity {
	t.Helper()
	ctx := context.Background()
	base := uuid.NewString()
	s := strings.ReplaceAll(base, "-", "")
	oldMillis := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC).UnixMilli()
	hex12 := fmt.Sprintf("%012x", oldMillis)
	id := hex12[0:8] + "-" + hex12[8:12] + "-7" + s[13:16] + "-" + s[16:20] + "-" + s[20:32]
	if _, err := uuid.Parse(id); err != nil {
		t.Fatalf("构造旧 UUIDv7 失败：%v", err)
	}
	if ms, ok := uuidV7Millis(id); !ok || ms != oldMillis {
		t.Fatalf("旧 ID 时间戳回读不一致：%d %v", ms, ok)
	}
	stored := Entity{ID: id, Kind: "work", Version: 1, Title: "旧无类型作品", Status: "draft", CreatedBy: f.u.ID, Attributes: map[string]any{}}
	if _, err := f.s.DB.ExecContext(ctx, `INSERT INTO catalog.entities(id,kind,version,title,status,created_by,document,updated_at) VALUES($1,'work',1,$2,'draft',$3,$4,now())`, id, stored.Title, f.u.ID, encode(stored)); err != nil {
		t.Fatal(err)
	}
	e, err := f.s.Get(ctx, id, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if !isLegacyUntyped(e) {
		t.Fatal("直插的旧实体应被判为真实旧数据")
	}
	return e
}
