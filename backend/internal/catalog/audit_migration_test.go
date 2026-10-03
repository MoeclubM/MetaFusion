package catalog

// 审计结构来自当前安装基线；mf-migrate up 与显式本地安装共用它。
// HTTP 服务启动只读校验。真库用例，无 MF_V2_TEST_DSN 时自动跳过。
//
// 本包已有同名的私有函数 audit()（修订留痕，store.go），所以审计包在本包内一律以 auditlog 别名引入。

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"io/fs"
	"strings"
	"testing"

	auditlog "github.com/metafusion/metafusion-app/internal/audit"
	"github.com/metafusion/metafusion-app/internal/migrator"
	"github.com/metafusion/metafusion-app/internal/testutil"
	"github.com/metafusion/metafusion-app/migrations"
)

// 迁移文件与审计包里的 Schema 常量必须是同一段 DDL：改一处必须改另一处，
// 否则四个服务各自建的 audit.audit_log 会漂移（契约 §1 只允许一份 DDL 文本）。
func TestAuditMigrationMatchesPackageSchema(t *testing.T) {
	b, err := fs.ReadFile(migrations.FS, baselineFile)
	if err != nil {
		t.Fatalf("安装基线文件缺失: %v", err)
	}
	start := strings.Index(string(b), "-- >>> audit-ddl begin\n")
	end := strings.Index(string(b), "-- <<< audit-ddl end")
	if start < 0 || end < start || strings.TrimSpace(string(b)[start+len("-- >>> audit-ddl begin\n"):end]) != strings.TrimSpace(auditlog.Schema) {
		t.Fatal("baseline audit DDL differs from audit.Schema")
	}

}

// 两条路径都建出契约 §1 的表与索引，且都幂等；迁移路径还要在 schema_migrations 里留下
// 带校验和的基线记账。
func TestPostgresAuditSchemaAppliedByMigratorAndStartup(t *testing.T) {
	ctx := context.Background()

	// 路径 1：mf-migrate up（与 cmd/migrate 同一装配）。
	db := testutil.Database(t)
	m := migrator.New(db, migrations.FS)
	if err := m.Up(ctx); err != nil {
		t.Fatalf("mf-migrate up: %v", err)
	}
	assertAuditSchema(t, db)
	applied, err := m.GetAppliedMigrations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	am, ok := applied[21]
	if !ok {
		t.Fatalf("000021 未记账: %#v", applied)
	}
	if am.Name != "catalog_baseline" || am.Dirty {
		t.Fatalf("000021 记账不正确: %#v", am)
	}
	content, err := fs.ReadFile(migrations.FS, baselineFile)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	if am.Checksum != hex.EncodeToString(sum[:]) {
		t.Fatalf("迁移校验和与文件内容不一致: %q", am.Checksum)
	}
	// 重复 up（部署重跑）与"迁移后再启动服务"（真实顺序）都不得报错。
	if err = m.Up(ctx); err != nil {
		t.Fatalf("重复 up: %v", err)
	}
	if err = (&Store{DB: db}).Initialize(ctx); err != nil {
		t.Fatalf("迁移后启动: %v", err)
	}
	assertAuditSchema(t, db)

	// 路径 2：显式本地安装组合入口（不是 HTTP 启动路径）。
	db2 := testutil.Database(t)
	s2 := &Store{DB: db2}
	if err := s2.Initialize(ctx); err != nil {
		t.Fatalf("新库启动: %v", err)
	}
	assertAuditSchema(t, db2)
	// 进程重启（再次 Initialize）同样安全。
	if err := s2.Initialize(ctx); err != nil {
		t.Fatalf("重复启动: %v", err)
	}
}

// assertAuditSchema 冻结列形状与索引：契约 §1 的 DDL 是跨服务唯一来源，
// 列名/列序/约束在这里逐条钉住，改了 DDL 就会红。
func assertAuditSchema(t *testing.T, db *sql.DB) {
	t.Helper()
	ctx := context.Background()
	var regclass sql.NullString
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('audit.audit_log')").Scan(&regclass); err != nil {
		t.Fatal(err)
	}
	if !regclass.Valid {
		t.Fatal("audit.audit_log 不存在")
	}
	rows, err := db.QueryContext(ctx, "SELECT column_name FROM information_schema.columns WHERE table_schema='audit' AND table_name='audit_log' ORDER BY ordinal_position")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		got = append(got, name)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []string{"id", "occurred_at", "service", "action", "actor_user_id", "actor_username",
		"credential_type", "actor_ip", "actor_user_agent", "target_type", "target_id", "changes",
		"result", "error_code", "request_method", "route", "http_status", "request_id"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("列形状与契约 §1 不一致:\n got %v\nwant %v", got, want)
	}
	var constraints string
	if err = db.QueryRowContext(ctx, "SELECT coalesce(string_agg(pg_get_constraintdef(oid), ' '), '') FROM pg_constraint WHERE conrelid='audit.audit_log'::regclass AND contype='c'").Scan(&constraints); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(constraints, "result") || !strings.Contains(constraints, "failure") {
		t.Fatalf("result 的 CHECK 约束缺失: %q", constraints)
	}
	var indexes int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM pg_indexes WHERE schemaname='audit' AND tablename='audit_log'").Scan(&indexes); err != nil {
		t.Fatal(err)
	}
	// 主键 + 四条契约索引（occurred_at / service+action / actor / target）。
	if indexes != 5 {
		t.Fatalf("审计表索引数应为 5（主键 + 四条契约索引），实得 %d", indexes)
	}
}
