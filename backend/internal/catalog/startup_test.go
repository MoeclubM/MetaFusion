package catalog

import (
	"context"
	"strings"
	"testing"
)

// S1：安装后的库必须通过只读兼容检查；缺表/缺列/无已发布定义时如实报不兼容，
// 而不是降级启动。无 MF_V2_TEST_DSN 时跳过（隔离库按用例建删，破坏性断言安全）。
func TestPostgresCheckCompatibleVersion(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	if err := f.s.CheckCompatibleVersion(ctx); err != nil {
		t.Fatalf("安装后的库应通过兼容检查：%v", err)
	}
	// 请求日志表只由显式迁移创建，普通请求不得在表缺失时补建。
	if _, err := f.s.DB.ExecContext(ctx, `DROP TABLE catalog.api_request_logs`); err != nil {
		t.Fatal(err)
	}
	LogRequest(ctx, f.s.DB, f.u.ID, "session", "", "GET", "/api/catalog/entities", 200, 1)
	var logTableExists bool
	if err := f.s.DB.QueryRowContext(ctx, `SELECT to_regclass('catalog.api_request_logs') IS NOT NULL`).Scan(&logTableExists); err != nil {
		t.Fatal(err)
	}
	if logTableExists {
		t.Fatal("普通请求不应补建请求日志表")
	}
	if err := f.s.CheckCompatibleVersion(ctx); err == nil || !strings.Contains(err.Error(), "catalog.api_request_logs") {
		t.Fatalf("缺少请求日志表应报不兼容，实际 %v", err)
	}
	if err := applyCatalogIncrementals(ctx, f.s.DB); err != nil {
		t.Fatal(err)
	}
	if err := f.s.CheckCompatibleVersion(ctx); err != nil {
		t.Fatalf("迁移恢复请求日志表后应通过兼容检查：%v", err)
	}
	// 缺表：删幂等表即不兼容。
	if _, err := f.s.DB.ExecContext(ctx, `DROP TABLE catalog.idempotency_keys`); err != nil {
		t.Fatal(err)
	}
	err := f.s.CheckCompatibleVersion(ctx)
	if err == nil || !strings.Contains(err.Error(), "incompatible_schema") {
		t.Fatalf("缺表应报 incompatible_schema，实际 %v", err)
	}
	// 恢复表结构后应重新通过（安装增量幂等，可重复执行）。
	if err := applyCatalogIncrementals(ctx, f.s.DB); err != nil {
		t.Fatal(err)
	}
	if err := f.s.CheckCompatibleVersion(ctx); err != nil {
		t.Fatalf("恢复后应重新通过：%v", err)
	}
	// 无已发布定义：删定义行即 definitions_missing（空库路径）。
	if _, err := f.s.DB.ExecContext(ctx, `DELETE FROM catalog.definition_config`); err != nil {
		t.Fatal(err)
	}
	err = f.s.CheckCompatibleVersion(ctx)
	if err == nil || !strings.Contains(err.Error(), "definitions_missing") {
		t.Fatalf("无已发布定义应报 definitions_missing，实际 %v", err)
	}
}
