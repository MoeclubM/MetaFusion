package migrator

import (
	"context"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/metafusion/metafusion-app/internal/testutil"
)

// 摘要稳定性（纯逻辑）：同一内容摘要稳定且为 64 位十六进制，内容一变摘要即变。
func TestChecksumOfStable(t *testing.T) {
	a := checksumOf("CREATE TABLE t(id int);")
	if len(a) != 64 {
		t.Fatalf("摘要应为 64 位十六进制，实际 %q", a)
	}
	if checksumOf("CREATE TABLE t(id int);") != a {
		t.Fatal("同一内容摘要应稳定")
	}
	if checksumOf("CREATE TABLE t(id int); -- 改过") == a {
		t.Fatal("内容变化摘要必须变化")
	}
}

// 漂移判定（纯逻辑）：一致/无记录/改过三态。
func TestDriftStatus(t *testing.T) {
	cur := checksumOf("v1")
	if driftStatus(cur, cur) != "match" {
		t.Fatal("一致应判 match")
	}
	if driftStatus("", cur) != "legacy-empty" {
		t.Fatal("无记录应判 legacy-empty")
	}
	if driftStatus(cur, checksumOf("v2")) != "modified" {
		t.Fatal("改过应判 modified")
	}
}

func testFS(files map[string]string) fstest.MapFS {
	m := fstest.MapFS{}
	for name, content := range files {
		m[name] = &fstest.MapFile{Data: []byte(content)}
	}
	return m
}

// S2 真库：已执行迁移的文件被改过，Up 必须失败告警而不是静默跳过；
// 无记录的老行回填后通过；内容不变重复 Up 静默通过。无 MF_V2_TEST_DSN 时跳过。
func TestMigratorUpVerifiesChecksum(t *testing.T) {
	ctx := context.Background()
	db := testutil.Database(t)
	v1 := "CREATE TABLE IF NOT EXISTS mig_smoke(id int);"
	if err := New(db, testFS(map[string]string{"000001_smoke.up.sql": v1})).Up(ctx); err != nil {
		t.Fatalf("首次 Up 应成功：%v", err)
	}
	// 内容不变：重复 Up 静默通过。
	if err := New(db, testFS(map[string]string{"000001_smoke.up.sql": v1})).Up(ctx); err != nil {
		t.Fatalf("内容不变的重复 Up 应通过：%v", err)
	}
	// 文件改过：Up 失败告警。
	err := New(db, testFS(map[string]string{"000001_smoke.up.sql": v1 + " -- 执行后被改过"})).Up(ctx)
	if err == nil || !strings.Contains(err.Error(), "immutable") {
		t.Fatalf("改过已执行迁移的 Up 应报 immutable，实际 %v", err)
	}
	// 无记录的老行：警告回填后通过，且回填的是当前文件摘要。
	if _, err := db.ExecContext(ctx, `UPDATE schema_migrations SET checksum='' WHERE version=1`); err != nil {
		t.Fatal(err)
	}
	if err := New(db, testFS(map[string]string{"000001_smoke.up.sql": v1})).Up(ctx); err != nil {
		t.Fatalf("无记录老行回填后应通过：%v", err)
	}
	var stored string
	if err := db.QueryRowContext(ctx, `SELECT checksum FROM schema_migrations WHERE version=1`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != checksumOf(v1) {
		t.Fatalf("回填的应是当前文件摘要，实际 %q", stored)
	}
}
