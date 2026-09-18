package catalog

import (
	"errors"
	"net/url"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

// 查询字符串是唯一没有解码器的外部输入：gin 把 %00、%FF 这类字节原样交给 SQL，
// Postgres 在 ILIKE 上直接拒绝（SQLSTATE 22021），respond 只能把它归到 500
// database_error——用户输错参数被报成服务故障，前端又把它渲染成"没有结果"
// （2026-09-19 审计第 5、6 条）。本文件把"能不能下传"的判定前置到参数层：
// 非法 UTF-8、控制字符、超长值、解析不了的原始查询串一律 400 + 稳定机器码。

// listTextParamLimit 是文本过滤参数的长度上限（字节）。它只负责挡"拿超长串压库"，
// 取值远大于任何合法输入：题名子串、kind/type/status 码、标签名、UUID 都在几十字节内。
const listTextParamLimit = 256

// 参数类错误的稳定机器码（响应体统一是 {"error": <code>}，见 respond）。
const (
	codeInvalidQueryParam = "invalid_query_param"
	codeQueryTooLong      = "query_too_long"
)

// listTextParams 是列表端点会下传给 SQL 的文本查询参数。整数分页参数
// （limit/offset/page）不在此列，由分页解析单独判定。
var listTextParams = []string{
	"q", "kind", "kinds", "type", "types", "status", "sort", "order", "locale",
	"work_id", "content_unit_id", "release_id", "medium_id", "parent_id", "field", "value", "tags",
}

// errParam 只携带机器码：respond 用 err.Error() 作为响应体里的 error 值，
// 参数名与原因不进响应（对匿名调用方没有额外信息价值）。
func errParam(code string) error { return errors.New(code) }

// checkQueryText 判定单个取值能否安全下传。
// 允许制表符：它可能是粘贴里的合法分隔符，且不破坏 SQL 文本；换行/回车则拒绝。
func checkQueryText(v string) error {
	if len(v) > listTextParamLimit {
		return errParam(codeQueryTooLong)
	}
	if !utf8.ValidString(v) {
		return errParam(codeInvalidQueryParam)
	}
	for _, r := range v {
		if r == '	' {
			continue
		}
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) {
			return errParam(codeInvalidQueryParam)
		}
	}
	return nil
}

// validateRawQuery 先看原始查询串本身能否解析：裸 % 这类写法会让 net/url 静默丢掉
// 该参数（?q=100% 取到的 q 是空串），于是"输入非法"被吞成"参数不存在"。
// 解析失败即 400，而不是让调用方以为筛选生效了。
func validateRawQuery(c *gin.Context) error {
	if _, err := url.ParseQuery(c.Request.URL.RawQuery); err != nil {
		return errParam(codeInvalidQueryParam)
	}
	return nil
}

// validateTextQuery 校验一组文本查询参数（可重复出现，逐个取值校验）。
func validateTextQuery(c *gin.Context, names ...string) error {
	if err := validateRawQuery(c); err != nil {
		return err
	}
	for _, name := range names {
		for _, v := range c.QueryArray(name) {
			if err := checkQueryText(v); err != nil {
				return err
			}
		}
	}
	return nil
}
