package catalog

import (
	"sort"
	"strings"
	"testing"
)

// 解析 SQL 文本里的 CREATE TABLE / CREATE [UNIQUE] INDEX 目标名：
// 只认行首关键字（注释里的 CREATE TABLE 不计入）；美元符引用的函数体
// 与 DO 块整段跳过，避免把 PL/pgSQL 代码里的关键字误判。
func sqlDefinedObjects(t *testing.T, sql string) (tables map[string]bool, indexes map[string]bool) {
	t.Helper()
	tables = map[string]bool{}
	indexes = map[string]bool{}
	inDollar := false
	for _, raw := range strings.Split(sql, "\n") {
		// 先处理美元符引用边界：含 $$ 的行同时是开闭，全行跳过。
		if strings.Contains(raw, "$$") {
			inDollar = !inDollar
			continue
		}
		if inDollar {
			continue
		}
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		upper := strings.ToUpper(line)
		if strings.HasPrefix(upper, "CREATE TABLE") {
			rest := strings.TrimSpace(line[len("CREATE TABLE"):])
			rest = strings.TrimPrefix(strings.ToUpper(rest), "IF NOT EXISTS")
			rest = strings.TrimSpace(line[len(line)-len(rest):])
			name := strings.FieldsFunc(rest, func(r rune) bool { return r == ' ' || r == '\t' || r == '(' })[0]
			tables[strings.ToLower(name)] = true
		} else if strings.HasPrefix(upper, "CREATE UNIQUE INDEX") || strings.HasPrefix(upper, "CREATE INDEX") {
			rest := line
			if idx := strings.Index(upper, "INDEX"); idx >= 0 {
				rest = strings.TrimSpace(line[idx+len("INDEX"):])
			}
			if strings.HasPrefix(strings.ToUpper(rest), "IF NOT EXISTS") {
				rest = strings.TrimSpace(rest[len("IF NOT EXISTS"):])
			}
			name := strings.FieldsFunc(rest, func(r rune) bool { return r == ' ' || r == '\t' || r == '(' })[0]
			indexes[strings.ToLower(name)] = true
		}
	}
	return tables, indexes
}

// TestSchemaParityWithMigrations 断言 schema.sql 快照与全量迁移终态一致：
// 快照里的每张表与每个索引都必须能在迁移 up 里找到来源（结构退役类迁移的
// 补充索引除外）。任一新增表/索引只改一处时，此测试失败提醒同步另一处。
// 000001 基线故意与 schema.sql 早期终态重复（双轨启动兼容，见 000007 注释），
// 故只做"快照 ⊆ 迁移并集"，不做反向断言。
func TestSchemaParityWithMigrations(t *testing.T) {
	snapTables, snapIndexes := sqlDefinedObjects(t, schema)

	migTables := map[string]bool{}
	migIndexes := map[string]bool{}
	files, err := testMigrationUpFiles(t)
	if err != nil {
		t.Fatal(err)
	}
	for _, content := range files {
		tbs, idxs := sqlDefinedObjects(t, content)
		for k := range tbs {
			migTables[k] = true
		}
		for k := range idxs {
			migIndexes[k] = true
		}
	}

	var missingTables, missingIndexes []string
	for name := range snapTables {
		// auth.* 由 000007 搬迁负责，schema.sql 只做幂等兜底。
		if strings.HasPrefix(name, "auth.") {
			continue
		}
		if !migTables[name] {
			missingTables = append(missingTables, name)
		}
	}
	for name := range snapIndexes {
		// one_published_definition 的历史形态在 000001 保证终态；
		// favorites_* 由 000003 专属迁移负责，这里要求必须存在于迁移并集。
		if !migIndexes[name] {
			missingIndexes = append(missingIndexes, name)
		}
	}
	sort.Strings(missingTables)
	sort.Strings(missingIndexes)
	if len(missingTables) > 0 {
		t.Errorf("schema.sql tables missing from migrations up: %v", missingTables)
	}
	if len(missingIndexes) > 0 {
		t.Errorf("schema.sql indexes missing from migrations up: %v", missingIndexes)
	}
}
