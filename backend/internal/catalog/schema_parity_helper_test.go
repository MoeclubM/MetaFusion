package catalog

import (
	"io/fs"
	"sort"
	"testing"

	"github.com/metafusion/metafusion-app/migrations"
)

// testMigrationUpFiles 读全量迁移 up 内容供一致性断言：直接读嵌入 FS，
// 不触库；排序保证版本序。
func testMigrationUpFiles(t *testing.T) ([]string, error) {
	t.Helper()
	var names []string
	err := fs.WalkDir(migrations.FS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || len(path) < len(".up.sql") || path[len(path)-len(".up.sql"):] != ".up.sql" {
			return nil
		}
		names = append(names, path)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	out := make([]string, 0, len(names))
	for _, n := range names {
		b, err := fs.ReadFile(migrations.FS, n)
		if err != nil {
			return nil, err
		}
		out = append(out, string(b))
	}
	return out, nil
}
