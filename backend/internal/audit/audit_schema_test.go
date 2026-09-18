package audit

// 审计 DDL 的两件事：形状冻结，以及**存在性守卫**的回归（契约 §1 + §6.1 的库侧授权）。
//
// 守卫不是风格偏好：实测（PostgreSQL 17，本机真库）非表所有者执行
// "CREATE INDEX IF NOT EXISTS <已存在的索引>" 会拿到 42501 must be owner of table，
// 而无条件重跑整段 DDL 就会在服务启动路径上炸掉——最小权限部署里审计表由 mf_audit_owner 预建，
// 四个运行角色都不是它的所有者（见 deploy/sql/roles-least-privilege.sql 的第 4b 节）。
// 这里用"非所有者身份重跑"的真库用例把守卫钉住，任何人都不能再把它退回顶层写法。

import (
	"context"
	"database/sql"
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/metafusion/metafusion-app/internal/testutil"
)

// auditTableRe 从守卫块里取建表段：顶层的 "CREATE TABLE IF NOT EXISTS" 正则已经取不到了
// （表在 IF to_regclass(...) IS NULL THEN 里面），解析必须换这一条。
var auditTableRe = regexp.MustCompile("(?is)CREATE TABLE audit\\.audit_log\\s*\\((.*?)\\n\\s*\\);")

var auditIndexRe = regexp.MustCompile("(?s)CREATE INDEX ([a-z_]+) ON audit\\.audit_log")

var auditWantColumns = []string{"id", "occurred_at", "service", "action", "actor_user_id", "actor_username",
	"credential_type", "actor_ip", "actor_user_agent", "target_type", "target_id", "changes",
	"result", "error_code", "request_method", "route", "http_status", "request_id"}

var auditWantIndexes = []string{"audit_log_occurred_at_idx", "audit_log_service_action_idx",
	"audit_log_actor_idx", "audit_log_target_idx"}

func TestAuditSchemaUsesExistenceGuard(t *testing.T) {
	for _, banned := range []string{"CREATE INDEX IF NOT EXISTS", "CREATE TABLE IF NOT EXISTS audit.audit_log"} {
		if strings.Contains(Schema, banned) {
			t.Fatalf("DDL 里不该再出现 %q：非表所有者重跑会被权限检查拦住（42501），必须放进存在性守卫", banned)
		}
	}
	guard := strings.Index(Schema, "IF to_regclass('audit.audit_log') IS NULL THEN")
	lock := strings.Index(Schema, "PERFORM pg_advisory_xact_lock(740205);")
	create := strings.Index(Schema, "CREATE TABLE audit.audit_log (")
	if guard < 0 || lock < 0 || create < 0 {
		t.Fatalf("守卫/锁/建表三件套缺一：guard=%d lock=%d create=%d", guard, lock, create)
	}
	if !(lock < guard && guard < create) {
		t.Fatalf("锁必须在守卫块内、且在建表之前：lock=%d guard=%d create=%d", lock, guard, create)
	}
	if !strings.Contains(Schema, "END IF;") || !strings.Contains(Schema, "$audit_ddl$") {
		t.Fatal("守卫必须是一个 DO $audit_ddl$ 块")
	}
}

func TestAuditSchemaTextShape(t *testing.T) {
	m := auditTableRe.FindStringSubmatch(Schema)
	if m == nil {
		t.Fatal("从守卫里取不到 audit.audit_log 的建表段：正则或 DDL 形状变了")
	}
	body := m[1]
	columns := []string{}
	for _, line := range strings.Split(body, "\n") {
		if line = strings.TrimSpace(line); line == "" {
			continue
		}
		columns = append(columns, strings.Fields(line)[0])
	}
	if !reflect.DeepEqual(columns, auditWantColumns) {
		t.Fatalf("列形状与契约 §1 不一致:\n got %v\nwant %v", columns, auditWantColumns)
	}
	if !strings.Contains(body, "CHECK (result IN ('success','failure'))") {
		t.Fatal("result 的 CHECK 约束不能丢")
	}
	indexes := []string{}
	for _, x := range auditIndexRe.FindAllStringSubmatch(Schema, -1) {
		indexes = append(indexes, x[1])
	}
	if !reflect.DeepEqual(indexes, auditWantIndexes) {
		t.Fatalf("四条索引名不能改:\n got %v\nwant %v", indexes, auditWantIndexes)
	}
}

// auditShape 是"形状快照"：列序 + 索引名集合 + CHECK 约束。重复执行/重建后必须逐字相同。
type auditShape struct {
	Columns     []string
	Indexes     []string
	Constraints string
}

func readAuditShape(t *testing.T, db *sql.DB) auditShape {
	t.Helper()
	ctx := context.Background()
	var s auditShape
	rows, err := db.QueryContext(ctx, "SELECT column_name FROM information_schema.columns WHERE table_schema='audit' AND table_name='audit_log' ORDER BY ordinal_position")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		s.Columns = append(s.Columns, name)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		t.Fatal(err)
	}
	rows, err = db.QueryContext(ctx, "SELECT indexname FROM pg_indexes WHERE schemaname='audit' AND tablename='audit_log' ORDER BY indexname")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		s.Indexes = append(s.Indexes, name)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, "SELECT coalesce(string_agg(pg_get_constraintdef(oid), ' ' ORDER BY oid), '') FROM pg_constraint WHERE conrelid='audit.audit_log'::regclass AND contype='c'").Scan(&s.Constraints); err != nil {
		t.Fatal(err)
	}
	return s
}

// 表已存在时重复执行 = 纯空转（rc=0 且形状一字不变）；删表后重跑 = 表与四条索引重建。
func TestPostgresAuditSchemaRerunsSafely(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, Schema); err != nil {
		t.Fatalf("首次执行（建表）: %v", err)
	}
	first := readAuditShape(t, db)
	if !reflect.DeepEqual(first.Columns, auditWantColumns) {
		t.Fatalf("首次建表的列形状: %v", first.Columns)
	}
	// 主键 + 四条契约索引 = 5 个 pg_indexes 条目。
	if len(first.Indexes) != 5 {
		t.Fatalf("首次建表的索引数应为 5（主键 + 四条契约索引）: %v", first.Indexes)
	}
	for i := 0; i < 3; i++ {
		if _, err := db.ExecContext(ctx, Schema); err != nil {
			t.Fatalf("表已存在时第 %d 次重复执行必须成功（守卫空转）: %v", i+2, err)
		}
	}
	if again := readAuditShape(t, db); !reflect.DeepEqual(first, again) {
		t.Fatalf("表已存在时重复执行改变了形状:\n before %+v\n after  %+v", first, again)
	}
	if _, err := db.ExecContext(ctx, "DROP TABLE audit.audit_log"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, Schema); err != nil {
		t.Fatalf("删表后重跑: %v", err)
	}
	if rebuilt := readAuditShape(t, db); !reflect.DeepEqual(first, rebuilt) {
		t.Fatalf("重建后的形状与首次不同:\n before %+v\n after  %+v", first, rebuilt)
	}
}

// 以**非表所有者**身份重跑整段 DDL：必须成功（这就是守卫要保证的事）。
// 探针角色是集群级的，测试收尾会删掉；非超级用户 DSN 建不了角色，按 skip 处理。
func TestPostgresAuditSchemaRerunsAsNonOwner(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	var super bool
	if err := db.QueryRowContext(ctx, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user").Scan(&super); err != nil {
		t.Fatal(err)
	}
	if !super {
		t.Skip("MF_V2_TEST_DSN 的连接用户不是超级用户，建不了探针角色：跳过非所有者用例")
	}
	const (
		ownerRole = "mf_audit_probe_owner"
		appRole   = "mf_audit_probe_app"
	)
	var dbName string
	if err := db.QueryRowContext(ctx, "SELECT current_database()").Scan(&dbName); err != nil {
		t.Fatal(err)
	}
	drop := func() {
		_, _ = db.ExecContext(ctx, "DROP TABLE IF EXISTS audit.audit_log")
		_, _ = db.ExecContext(ctx, "DROP SCHEMA IF EXISTS audit CASCADE")
		_, _ = db.ExecContext(ctx, "DROP ROLE IF EXISTS "+appRole)
		_, _ = db.ExecContext(ctx, "DROP ROLE IF EXISTS "+ownerRole)
	}
	drop() // 清掉上次残留（角色是集群级的：上一轮的库已删，但角色会留）
	defer drop()

	// 模拟部署：审计表由 mf_audit_owner 预建并持有，运行角色只有 USAGE+CREATE（schema）与 SELECT+INSERT（表）。
	if _, err := db.ExecContext(ctx, Schema); err != nil {
		t.Fatalf("预建审计表: %v", err)
	}
	for _, sql := range []string{
		"CREATE ROLE " + ownerRole + " NOLOGIN",
		"CREATE ROLE " + appRole + " LOGIN",
		"GRANT USAGE, CREATE ON SCHEMA audit TO " + appRole,
		"GRANT SELECT, INSERT ON audit.audit_log TO " + appRole,
		// 库级 CREATE：CREATE SCHEMA IF NOT EXISTS 即使 schema 已存在也会检查它（见契约 §6.1 的授权清单）。
		fmt.Sprintf("GRANT CREATE ON DATABASE %s TO %s", dbName, appRole),
		"ALTER TABLE audit.audit_log OWNER TO " + ownerRole,
	} {
		if _, err := db.ExecContext(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	runAs := func(sqlText string) error {
		conn, err := db.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		if _, err = conn.ExecContext(ctx, "SET ROLE "+appRole); err != nil {
			t.Fatal(err)
		}
		_, err = conn.ExecContext(ctx, sqlText)
		if _, resetErr := conn.ExecContext(ctx, "RESET ROLE"); resetErr != nil {
			t.Fatal(resetErr)
		}
		return err
	}

	// 守卫式 DDL：非所有者执行必须成功（纯空转）。
	if err := runAs(Schema); err != nil {
		t.Fatalf("非表所有者重跑审计 DDL 必须成功，否则最小权限部署下四个服务起不来: %v", err)
	}
	// 反证：旧写法（顶层 CREATE INDEX IF NOT EXISTS）在同一身份下会被拒 —— 这条用例真的在测所有权。
	legacy := "CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON audit.audit_log(occurred_at DESC)"
	legacyErr := runAs(legacy)
	if legacyErr == nil {
		t.Fatal("旧写法在同一身份下不该成功：守卫是必需的，本用例的证伪能力也不许丢")
	}
	if !strings.Contains(legacyErr.Error(), "must be owner") && !strings.Contains(legacyErr.Error(), "42501") {
		t.Fatalf("旧写法应因缺少表所有权被拒（42501 must be owner）: %v", legacyErr)
	}
	t.Logf("旧写法在非所有者身份下的报错: %v", legacyErr)

	// 表被删掉后，非所有者也要能重建（schema 的 CREATE + 库级 CREATE 都在授权清单里）。
	if _, err := db.ExecContext(ctx, "DROP TABLE audit.audit_log"); err != nil {
		t.Fatal(err)
	}
	if err := runAs(Schema); err != nil {
		t.Fatalf("非所有者在表缺失时应能重建（否则运维删表后服务无法自愈）: %v", err)
	}
	rebuilt := readAuditShape(t, db)
	if !reflect.DeepEqual(rebuilt.Columns, auditWantColumns) || len(rebuilt.Indexes) != 5 {
		t.Fatalf("非所有者重建出的形状不对: %+v", rebuilt)
	}
}
