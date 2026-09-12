package catalog

import (
	"context"
	"testing"
)

// 收藏 target_type 就是实体 kind：覆盖固定八种骨架，不接受旧词表或未知类型。
func TestFavoriteTargetKinds(t *testing.T) {
	for _, kind := range []string{"agent", "collection", "work", "content_unit", "expression", "release", "medium", "track"} {
		kinds, known := favoriteTargetKinds[kind]
		if !known {
			t.Errorf("%s: kind not registered", kind)
			continue
		}
		if len(kinds) != 1 || kinds[0] != kind {
			t.Errorf("%s: must map to itself, got %v", kind, kinds)
		}
	}
	// 分类不匹配必须拒绝
	if contains(favoriteTargetKinds["work"], "agent") {
		t.Error("work must not accept agent")
	}
	// 旧词表与未知类型都不得注册
	for _, legacy := range []string{"artist", "franchise", "canonical_entry", "unknown"} {
		if _, known := favoriteTargetKinds[legacy]; known {
			t.Errorf("%s: legacy/unknown target type must not be registered", legacy)
		}
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
	if items[0].ID == "" || items[0].Entity == nil || items[0].Entity.ID != work.ID {
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
	// 旧词表 target_type 不再被接受
	if _, err := f.s.ToggleFavorite(ctx, f.u, "artist", work.ID); err == nil {
		t.Fatal("legacy target_type accepted")
	}
}
