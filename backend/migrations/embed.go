package migrations

import "embed"

// FS 嵌入所有 SQL 迁移文件，确保二进制可独立在任何环境执行完整数据库版本迁移
//
//go:embed *.sql
var FS embed.FS
