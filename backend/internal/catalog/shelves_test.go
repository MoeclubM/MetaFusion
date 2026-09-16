package catalog

import (
	"context"
	"testing"
	"time"
)

// 白名单与求值必须一一对应：validateShelf 放行、求值却没人消费的取值就是空承诺
// （历史上 `created` 正是如此——写进库等于静默按 updated_at 排序）。
func TestShelfSortWhitelistMatchesEvaluation(t *testing.T) {
	for _, key := range shelfSortKeys {
		if err := validateShelf(Shelf{Slug: "sort-check", Names: names4("排序检查", "排序檢查", "並び順", "Sort check"), Sort: key}); err != nil {
			t.Fatalf("sort=%q 应被接受，实际被拒：%v", key, err)
		}
		if got := shelfOrderClause(key); got == "" {
			t.Fatalf("sort=%q 被白名单接受，却没有求值实现（空承诺）", key)
		}
	}
	// 非法取值仍要拒，且只暴露稳定码（错误串就是机器码本身）。
	err := validateShelf(Shelf{Slug: "sort-check", Names: names4("排序检查", "排序檢查", "並び順", "Sort check"), Sort: "newest"})
	if err == nil || err.Error() != "invalid_sort" {
		t.Fatalf("非法 sort 必须以 invalid_sort 拒绝，实际：%v", err)
	}
}

// created 必须真的按创建时间倒序。实体表没有 created_at 列，实现取的是 UUIDv7 id 的字节序，
// 所以这条用例同时钉住「实体 id 仍由 NewV7 生成」这一前提：改回随机 id 它会红。
func TestShelfSortCreatedOrdersByCreationTime(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	older := f.save(Entity{Kind: "work", Title: "货架排序甲", Types: []string{"novel"}})
	// UUIDv7 的时间戳是毫秒级：同一毫秒内两条的顺序由随机位决定，跨毫秒才稳定可比。
	time.Sleep(5 * time.Millisecond)
	newer := f.save(Entity{Kind: "work", Title: "货架排序乙", Types: []string{"novel"}})

	// 让先建的那条变成「后更新」的：updated 与 created 的顺序因此相反。
	renamed := older
	renamed.Title = "货架排序甲（改名）"
	if _, err := f.s.Save(ctx, Edit{Entity: renamed, ExpectedVersion: older.Version,
		EditNote: "夹具：制造 updated 与 created 相反的顺序", Sources: fixtureSources()}, f.u); err != nil {
		t.Fatalf("更新首条实体：%v", err)
	}

	sh, err := f.s.CreateShelf(ctx, Shelf{
		Slug:  "sort-created-check",
		Names: names4("排序检查", "排序檢查", "並び順", "Sort check"),
		Query: ShelfQuery{Types: []string{"novel"}},
		Sort:  "created",
	})
	if err != nil {
		t.Fatalf("建货架：%v", err)
	}

	created := shelfItemIDs(t, f, ctx, sh)
	if len(created) != 2 || created[0] != newer.ID || created[1] != older.ID {
		t.Fatalf("sort=created 应按创建时间倒序 [新, 旧]，实际 %v（新=%s 旧=%s）", created, newer.ID, older.ID)
	}
	// 同一规则重复求值必须同序（id 唯一，序是确定的）。
	if again := shelfItemIDs(t, f, ctx, sh); len(again) != 2 || again[0] != created[0] || again[1] != created[1] {
		t.Fatalf("sort=created 重复求值结果不稳定：%v vs %v", created, again)
	}

	// 同一批数据换成 updated：顺序必须反过来，证明两者不是同一条路径。
	sh.Sort = "updated"
	if _, err := f.s.UpdateShelf(ctx, sh.ID, sh); err != nil {
		t.Fatalf("改货架排序方式：%v", err)
	}
	updated := shelfItemIDs(t, f, ctx, sh)
	if len(updated) != 2 || updated[0] != older.ID || updated[1] != newer.ID {
		t.Fatalf("sort=updated 应按最后更新时间倒序 [后改, 后建]，实际 %v", updated)
	}
}

// shelfItemIDs 取货架求值结果的 id 序列（匿名视角：只见 published）。
func shelfItemIDs(t *testing.T, f fixture, ctx context.Context, sh Shelf) []string {
	t.Helper()
	items, err := f.s.ListShelfItems(ctx, sh, 10, nil)
	if err != nil {
		t.Fatalf("货架求值：%v", err)
	}
	out := make([]string, 0, len(items))
	for _, e := range items {
		out = append(out, e.ID)
	}
	return out
}
