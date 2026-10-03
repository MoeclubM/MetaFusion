package migrations

import "embed"

// FS 嵌入安装基线、后续增量与历史摘要清单；历史 SQL 仅作测试夹具。
//
//go:embed *.sql baseline.json
var FS embed.FS
