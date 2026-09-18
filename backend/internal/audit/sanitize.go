package audit

// 脱敏与长度截断（契约 §4）。写入路径只有 insert 一处，脱敏因此没有旁路：
// SanitizeChanges 处理 changes，truncate 处理 UA 与单个字符串值。

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

// secretKeys 是键名精确黑名单（大小写不敏感，契约 §4 逐条抄录）。
var secretKeys = map[string]bool{
	"password":      true,
	"old_password":  true,
	"new_password":  true,
	"password_hash": true,
	"token":         true,
	"access_token":  true,
	"refresh_token": true,
	"token_hash":    true,
	"secret":        true,
	"client_secret": true,
	"secret_hash":   true,
	"authorization": true,
	"cookie":        true,
	"api_key":       true,
	"code_verifier": true,
}

// secretSubstrings 是键名子串黑名单：含 password / secret / token / hash 的键一律整值替换。
// 子串规则防的是"换个名字绕行"（api_token / session_hash / user_password …）。
var secretSubstrings = []string{"password", "secret", "token", "hash"}

// emailPattern 是值的邮箱遮罩范围：只遮罩形似邮箱的片段，不动其余文本。
var emailPattern = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}`)

// SanitizeChanges 递归脱敏并截断，返回新 map（不改动入参：调用方的载荷还要继续用于响应）。
func SanitizeChanges(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = sanitizeField(k, v)
	}
	return out
}

// sanitizeField 按"键名 → 值"两级规则处理一个字段。键名规则对数组元素同样生效
// （数组里往往是一组同名字段，例如 [{"email": …}]）。
func sanitizeField(key string, v any) any {
	lower := strings.ToLower(key)
	if secretKey(lower) {
		return redacted
	}
	if v == nil {
		return nil
	}
	switch vv := v.(type) {
	case string:
		if strings.Contains(lower, "email") {
			// 键名含 email 的字段一律遮罩，不寄希望于值恰好"看起来像邮箱"。
			return truncate(MaskEmail(vv), valueMax)
		}
		return truncate(MaskEmails(vv), valueMax)
	case bool, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64, json.Number:
		return v
	case map[string]any:
		return SanitizeChanges(vv)
	case map[string]string:
		nested := make(map[string]any, len(vv))
		for nk, nv := range vv {
			nested[nk] = sanitizeField(nk, nv)
		}
		return nested
	case []any:
		out := make([]any, len(vv))
		for i, item := range vv {
			out[i] = sanitizeField(key, item)
		}
		return out
	case []string:
		out := make([]any, len(vv))
		for i, item := range vv {
			out[i] = sanitizeField(key, item)
		}
		return out
	default:
		// 其余类型（结构体、时间等）原样交给 json.Marshal：它们不是调用方塞进来的自由文本，
		// 也不在"键名 / 邮箱"两条规则的覆盖范围内。
		return v
	}
}

// secretKey 判定键名是否必须整值替换成 [redacted]。
func secretKey(lower string) bool {
	if secretKeys[lower] {
		return true
	}
	for _, s := range secretSubstrings {
		if strings.Contains(lower, s) {
			return true
		}
	}
	return false
}

// MaskEmails 把字符串里所有形似邮箱的片段遮罩成 a***@domain（契约 §4：审计行里不出现完整邮箱）。
func MaskEmails(s string) string {
	if !strings.Contains(s, "@") {
		return s
	}
	return emailPattern.ReplaceAllStringFunc(s, MaskEmail)
}

// MaskEmail 遮罩单个邮箱，保留首字母与域名（j***@example.com）。
// 不形似邮箱的字符串原样返回：它不是邮箱，遮罩只会让摘要更难读。
func MaskEmail(s string) string {
	if s = strings.TrimSpace(s); s == "" {
		return ""
	}
	if masked := emailPattern.ReplaceAllStringFunc(s, maskOne); masked != s {
		return masked
	}
	// 正则没命中但确实有 @（例如域名单段 a@localhost）：仍按"首字母 + *** + 域名"遮罩。
	if i := strings.LastIndex(s, "@"); i > 0 && i < len(s)-1 {
		return string([]rune(s)[:1]) + "***" + s[i:]
	}
	return s
}

// maskOne 遮罩一个命中的邮箱：本地部分只留首字母。
func maskOne(m string) string {
	at := strings.LastIndex(m, "@")
	if at <= 0 {
		return "***"
	}
	return string([]rune(m[:at])[:1]) + "***" + m[at:]
}

// MaskSecret 处理准凭据（邀请码这类"拿到即可用"的值，契约 §4）：保留前 4 位 + "…"。
// 长度不足 5 时整段遮罩——保留前 4 位会把 4 位以内的凭据整个露出来。
func MaskSecret(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return ""
	}
	if len(r) <= 4 {
		return "…"
	}
	return string(r[:4]) + "…"
}

// truncate 按 rune 截断（按字节切会切出半个 UTF-8 字符），超限时以 "…" 结尾标记被截断。
func truncate(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}

// encodeChanges 序列化 changes；超过 8 KB 时按 key 稳定顺序逐条丢弃并置 "_truncated": true（契约 §4）。
// 丢弃而不是硬切：切出来的 JSON 不是合法 jsonb。
func encodeChanges(m map[string]any) ([]byte, error) {
	b, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	if len(b) <= changesMax {
		return b, nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	kept := make(map[string]any, len(m)+1)
	for _, k := range keys {
		kept[k] = m[k]
		kept[truncatedKey] = true
		if b, err = json.Marshal(kept); err != nil {
			return nil, err
		}
		if len(b) > changesMax {
			delete(kept, k)
		}
	}
	kept[truncatedKey] = true
	return json.Marshal(kept)
}
