package catalog

import (
	"context"
	"testing"
)

// 收藏目标类型 → 实体 kind 映射必须覆盖前端词表，且不把类型错配到别的 kind。
func TestFavoriteTargetKinds(t *testing.T) {
	// 已知类型：kind 必须命中
	for _, tt := range []struct{ targetType, kind string }{
		{"work", "work"},
		{"release", "release"},
		{"artist", "agent"},
		{"franchise", "collection"},
		{"canonical_entry", "expression"},
		{"canonical_entry", "content_unit"},
	} {
		kinds, known := favoriteTargetKinds[tt.targetType]
		if !known {
			t.Errorf("%s: target type not registered", tt.targetType)
			continue
		}
		if !contains(kinds, tt.kind) {
			t.Errorf("%s: kind %s not accepted (%v)", tt.targetType, tt.kind, kinds)
		}
	}
	// 类型存在但 kind 不匹配，必须不在允许集合内
	for _, tt := range []struct{ targetType, kind string }{
		{"work", "agent"},
		{"artist", "work"},
		{"release", "expression"},
		{"franchise", "work"},
	} {
		kinds := favoriteTargetKinds[tt.targetType]
		if contains(kinds, tt.kind) {
			t.Errorf("%s: kind %s must not be accepted", tt.targetType, tt.kind)
		}
	}
	// 未注册类型
	if _, known := favoriteTargetKinds["unknown"]; known {
		t.Error("unknown target type must not be registered")
	}
}

// 收藏读写落库路径（需 Postgres；本机无 DSN 时整测跳过，CI 会执行）。
// 覆盖：toggle 开/关、status 批量、mine 列表（含解析目标实体）。
func TestFavoritesStoreRoundtrip(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	work := f.save(Entity{Kind: "work", Title: "收藏测试作品", Types: []string{"music"}})

	on, err := f.s.ToggleFavorite(ctx, f.u, "work", work.ID)
	if err != nil {
		t.Fatalf("toggle on: %v", err)
	}
	if !on {
		t.Fatal("expected favorited=true")
	}
	ids, err := f.s.FavoriteStatus(ctx, f.u, "work", []string{work.ID})
	if err != nil || len(ids) != 1 || ids[0] != work.ID {
		t.Fatalf("status: %v %v", ids, err)
	}
	// mine 列表：返回合成 ID 并解析出目标实体
	items, total, err := f.s.ListFavorites(ctx, f.u.ID, &f.u, "", 20, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total != 1 || len(items) != 1 {
		t.Fatalf("list total=%d items=%d", total, len(items))
	}
	if items[0].ID == "" || items[0].Work == nil || items[0].Work.ID != work.ID {
		t.Fatalf("bad item: %+v", items[0])
	}
	// 关闭
	off, err := f.s.ToggleFavorite(ctx, f.u, "work", work.ID)
	if err != nil || off {
		t.Fatalf("toggle off: %v %v", off, err)
	}
	if ids, _ := f.s.FavoriteStatus(ctx, f.u, "work", []string{work.ID}); len(ids) != 0 {
		t.Fatalf("status after off: %v", ids)
	}
	// 类型与目标 kind 不匹配必须拒绝
	if _, err := f.s.ToggleFavorite(ctx, f.u, "artist", work.ID); err == nil {
		t.Fatal("mismatched target kind accepted")
	}
}
