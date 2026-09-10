package catalog

import "testing"

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
