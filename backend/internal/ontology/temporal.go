package ontology

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// 模糊日期规约：YYYY / YYYY-MM / YYYY-MM-DD，空串表示未知。
// begin/end/recording_date 等区间语义字段一律用该字符串规约承载，
// ReleaseDate/EditionDate 等精确排序字段用 *time.Time 承载完整日精度。
var partialDatePattern = regexp.MustCompile(`^\d{4}(-\d{2}(-\d{2})?)?$`)

// IsValidPartialDate 校验模糊日期形状与月份/日期合法性。
func IsValidPartialDate(raw string) bool {
	s := strings.TrimSpace(raw)
	if s == "" {
		return true
	}
	if !partialDatePattern.MatchString(s) {
		return false
	}
	layouts := map[int]string{4: "2006", 7: "2006-01", 10: "2006-01-02"}
	layout, ok := layouts[len(s)]
	if !ok {
		return false
	}
	if _, err := time.Parse(layout, s); err != nil {
		return false
	}
	return true
}

// NormalizePartialDate 去空白并校验，非法返回错误。
func NormalizePartialDate(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if !IsValidPartialDate(s) {
		return "", fmt.Errorf("invalid partial date: %s (want YYYY, YYYY-MM or YYYY-MM-DD)", s)
	}
	return s, nil
}

// ParseExactDate 只接受完整 YYYY-MM-DD，用于 ReleaseDate/EditionDate 精确列。
func ParseExactDate(raw string) (*time.Time, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, fmt.Errorf("invalid exact date: %s (want YYYY-MM-DD)", s)
	}
	return &t, nil
}

// ParseFlexibleDate 接受三种精度：完整日返回 exact 时间，其余返回归一化 partial。
// 月/年精度不伪造 exact（不补 -01 回写 PG），调用方按需决定索引归一。
func ParseFlexibleDate(raw string) (exact *time.Time, partial string, ok bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil, "", false
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return &t, s, true
	}
	if len(s) == 7 {
		if _, err := time.Parse("2006-01", s); err == nil {
			return nil, s, true
		}
		return nil, "", false
	}
	if len(s) == 4 {
		if _, err := time.Parse("2006", s); err == nil {
			return nil, s, true
		}
	}
	return nil, "", false
}

// ValidateDateSpan 校验起止区间：格式合法且 begin 不晚于 end（同精度可比时）。
func ValidateDateSpan(begin, end string) error {
	b, err := NormalizePartialDate(begin)
	if err != nil {
		return err
	}
	e, err := NormalizePartialDate(end)
	if err != nil {
		return err
	}
	if b == "" || e == "" || len(b) != len(e) {
		return nil
	}
	if b > e {
		return fmt.Errorf("begin_date %s is after end_date %s", b, e)
	}
	return nil
}

// EarliestPartial 取较早的模糊日期，空串视为未知（返回另一方）。
func EarliestPartial(a, b string) string {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	if a == "" {
		return b
	}
	if b == "" {
		return a
	}
	if len(a) == len(b) {
		if b < a {
			return b
		}
		return a
	}
	if a[:4] != b[:4] {
		if b[:4] < a[:4] {
			return b
		}
		return a
	}
	return a
}

// LatestPartial 取较晚的模糊日期，空串视为未知（返回另一方）。
func LatestPartial(a, b string) string {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	if a == "" {
		return b
	}
	if b == "" {
		return a
	}
	if len(a) == len(b) {
		if b > a {
			return b
		}
		return a
	}
	if a[:4] != b[:4] {
		if b[:4] > a[:4] {
			return b
		}
		return a
	}
	return a
}

// MergeEdgeSpan 合并冲突关系边的起止时间：begin 取最早，end 取最晚，
// 仅当双方都标记终结时才视为终结（任一边存续即视为存续）。
func MergeEdgeSpan(aBegin, aEnd string, aEnded bool, bBegin, bEnd string, bEnded bool) (string, string, bool) {
	return EarliestPartial(aBegin, bBegin), LatestPartial(aEnd, bEnd), aEnded && bEnded
}
