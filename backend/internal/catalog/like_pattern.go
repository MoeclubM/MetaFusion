package catalog

import "strings"

// likeContains 把用户搜索词编译成"包含匹配"的 LIKE/ILIKE 模式，并把输入里的 LIKE
// 元字符按字面处理：不转义时 q="_" 命中任意单字符、q="%" 命中全库（线上实测 total 与
// 全库相同）。
// PostgreSQL 的 LIKE/ILIKE 默认逃逸字符就是反斜杠（不加 ESCAPE 子句等价于
// ESCAPE '\\'）；standard_conforming_strings 只影响字符串字面量的词法解析，这里的
// 模式经参数占位符传值、不经过词法解析，所以既不能改成字符串拼接，也不需要额外
// ESCAPE 子句——照旧参数化，只把值转义。
// 顺序要求：先转义反斜杠，再 % 和 _，否则会把刚写入的转义符再转义一遍。
func likeContains(q string) string {
	q = strings.ReplaceAll(q, `\`, `\\`)
	q = strings.ReplaceAll(q, "%", `\%`)
	q = strings.ReplaceAll(q, "_", `\_`)
	return "%" + q + "%"
}
