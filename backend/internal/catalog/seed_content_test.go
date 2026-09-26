package catalog

import (
	"context"
	"testing"

	"github.com/metafusion/metafusion-app/internal/migrator"
	"github.com/metafusion/metafusion-app/internal/testutil"
	"github.com/metafusion/metafusion-app/migrations"
)

// A05：空库 up 之后直接 seed 可用，重复 seed 不写新版本、不覆盖人工配置。
// 无 MF_V2_TEST_DSN 时 testutil.Database 自动跳过。
func TestSeedContentEmptyAndIdempotentOnPostgres(t *testing.T) {
	ctx := context.Background()
	db := testutil.Database(t)
	// 只跑结构迁移（模拟刚 mf-migrate up 的空库）：表在、无内容行。
	if err := migrator.New(db, migrations.FS).Up(ctx); err != nil {
		t.Fatalf("migrate up: %v", err)
	}
	s := &Store{DB: db}
	admin := fixtureUser("admin")

	// 空库首次 seed：发布内置定义 + 外部库 + 货架。
	if err := s.SeedContent(ctx); err != nil {
		t.Fatalf("空库 SeedContent: %v", err)
	}
	v1, err := s.Definitions(ctx)
	if err != nil {
		t.Fatalf("seed 后应有已发布定义: %v", err)
	}
	var shelves, extdb, defs int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM catalog.shelves").Scan(&shelves); err != nil || shelves == 0 {
		t.Fatalf("货架应已播种: %v count=%d", err, shelves)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM catalog.external_databases").Scan(&extdb); err != nil || extdb == 0 {
		t.Fatalf("外部库应已播种: %v count=%d", err, extdb)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM catalog.definition_config").Scan(&defs); err != nil {
		t.Fatal(err)
	}

	// 重复 seed：不写新版本。
	if err := s.SeedContent(ctx); err != nil {
		t.Fatalf("重复 SeedContent: %v", err)
	}
	v2, err := s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if v2.ETag != v1.ETag {
		t.Fatalf("重复 seed 不应换 etag：%s → %s", v1.ETag, v2.ETag)
	}
	var defs2 int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM catalog.definition_config").Scan(&defs2); err != nil || defs2 != defs {
		t.Fatalf("重复 seed 不应增版本行：%d → %d (%v)", defs, defs2, err)
	}

	// 人工配置（停用某关系码）之后再 seed：不得被种子重新打开，也不得写新版本。
	d := v2.Document
	rt := d.Relations["performed_by"]
	rt.Enabled = false
	d.Relations["performed_by"] = rt
	if _, err := s.SaveDefinitions(ctx, d, v2.ETag, admin, "关停 performed_by", fixtureSources()); err != nil {
		t.Fatal(err)
	}
	v3, err := s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SeedContent(ctx); err != nil {
		t.Fatalf("定制后 SeedContent: %v", err)
	}
	v4, err := s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if v4.ETag != v3.ETag {
		t.Fatalf("无新增种子时不应换 etag：%s → %s", v3.ETag, v4.ETag)
	}
	if v4.Document.Relations["performed_by"].Enabled {
		t.Fatal("后台停用的关系码不得被种子重新打开")
	}
}
