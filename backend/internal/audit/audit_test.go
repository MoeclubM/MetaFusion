package audit

// 单元测试的口径（契约 §4）：脱敏、截断、非阻塞，全部不依赖数据库——
// 真库部分在 audit_postgres_test.go（MF_V2_TEST_DSN 未设时跳过）。

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// 键名两级黑名单 + 邮箱规则 + 递归：一次覆盖精确名单、子串名单、嵌套 map、数组元素。
func TestSanitizeChangesRedactsSecrets(t *testing.T) {
	in := map[string]any{
		"password":      "hunter2",
		"old_password":  "hunter1",
		"client_secret": "s3cr3t",
		"Authorization": "Bearer abc",
		"cookie":        "mf_session=xyz",
		"api_key":       "k-123",
		"code_verifier": "v-123",
		"token_hash":    "deadbeef",
		"api_token":     "renamed-but-still-secret", // 子串规则：改名绕不过
		"session_hash":  "cafebabe",
		"owner_email":   "jane.doe@example.com",                        // 键名含 email：一律遮罩
		"note":          "联系 jane.doe@example.com 或 admin@example.org", // 值里的邮箱
		"count":         3,
		"enabled":       true,
		"nested": map[string]any{
			"refresh_token": "rt-1",
			"title":         "正常题名",
		},
		"sources": []any{
			map[string]any{"email": "a.b@example.com", "label": "官方"},
		},
	}
	out := SanitizeChanges(in)

	for _, k := range []string{"password", "old_password", "client_secret", "Authorization", "cookie", "api_key", "code_verifier", "token_hash", "api_token", "session_hash"} {
		if got := out[k]; got != redacted {
			t.Errorf("键 %s 未整值替换: %#v", k, got)
		}
	}
	if out["owner_email"] != "j***@example.com" {
		t.Errorf("email 键未遮罩: %#v", out["owner_email"])
	}
	note, _ := out["note"].(string)
	if strings.Contains(note, "jane.doe@example.com") || strings.Contains(note, "admin@example.org") {
		t.Errorf("值里的完整邮箱未遮罩: %#v", note)
	} else if note != "联系 j***@example.com 或 a***@example.org" {
		t.Errorf("值里的邮箱遮罩形状不对: %#v", note)
	}
	if out["count"] != 3 || out["enabled"] != true {
		t.Errorf("非字符串值不该被动: %#v %#v", out["count"], out["enabled"])
	}
	nested, _ := out["nested"].(map[string]any)
	if nested["refresh_token"] != redacted || nested["title"] != "正常题名" {
		t.Errorf("嵌套 map 未递归处理: %#v", nested)
	}
	items, _ := out["sources"].([]any)
	first, _ := items[0].(map[string]any)
	if first["email"] != "a***@example.com" || first["label"] != "官方" {
		t.Errorf("数组元素未按键名递归处理: %#v", first)
	}
	// 入参不能被改：调用方还要拿它渲染响应。
	if in["password"] != "hunter2" || in["owner_email"] != "jane.doe@example.com" {
		t.Errorf("SanitizeChanges 修改了入参: %#v", in)
	}
}

// 单值 512 rune 截断：按 rune 切，不能切出半个字符。
func TestSanitizeChangesTruncatesLongValues(t *testing.T) {
	long := strings.Repeat("题", 600)
	out := SanitizeChanges(map[string]any{"title": long})
	got, _ := out["title"].(string)
	if r := []rune(got); len(r) != valueMax || r[len(r)-1] != '…' {
		t.Fatalf("单值应截断到 %d rune 且以省略号结尾，实得 %d: %q", valueMax, len(r), got)
	}
	short := SanitizeChanges(map[string]any{"title": "短题名"})
	if short["title"] != "短题名" {
		t.Fatalf("未超限的值原样保留，实得 %#v", short["title"])
	}
}

// changes 序列化后 8 KB 上限：超限时丢条目 + "_truncated": true，且结果仍是合法 JSON。
func TestEncodeChangesCapsAt8KB(t *testing.T) {
	big := map[string]any{}
	for i := 0; i < 40; i++ {
		big["k"+string(rune('a'+i%26))+strings.Repeat("x", i)] = strings.Repeat("值", 200)
	}
	b, err := encodeChanges(big)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) > changesMax {
		t.Fatalf("encodeChanges 超出 %d 字节: %d", changesMax, len(b))
	}
	var decoded map[string]any
	if err = json.Unmarshal(b, &decoded); err != nil {
		t.Fatalf("截断后的 changes 必须是合法 JSON: %v (%s)", err, b)
	}
	if decoded[truncatedKey] != true {
		t.Fatalf("超限时必须置 %s: %s", truncatedKey, b)
	}
	// 未超限时不该出现 _truncated。
	small, err := encodeChanges(map[string]any{"kind": map[string]any{"after": "work"}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(small), truncatedKey) {
		t.Fatalf("未超限的 changes 不该带 %s: %s", truncatedKey, small)
	}
}

func TestMaskEmailAndSecret(t *testing.T) {
	cases := map[string]string{
		"jane@example.com":         "j***@example.com",
		"J.Doe+tag@sub.example.jp": "J***@sub.example.jp",
		"":                         "",
		"not-an-email":             "not-an-email",
		"a@localhost":              "a***@localhost",
	}
	for in, want := range cases {
		if got := MaskEmail(in); got != want {
			t.Errorf("MaskEmail(%q) = %q, want %q", in, got, want)
		}
	}
	if got := MaskSecret("abcd1234efgh"); got != "abcd…" {
		t.Errorf("MaskSecret 保留前 4 位: %q", got)
	}
	if got := MaskSecret("ab1"); got != "…" {
		t.Errorf("不足 5 位的凭据整段遮罩: %q", got)
	}
	if got := MaskSecret(""); got != "" {
		t.Errorf("空值原样返回: %q", got)
	}
}

// 队列满时必须丢弃而不是阻塞业务（契约 §3）。这里用"只造队列、不起消费 goroutine"的
// recorder 把满队列钉成确定行为，不依赖数据库快慢。
func TestRecorderDropsWithoutBlockingWhenQueueFull(t *testing.T) {
	rec := &Recorder{service: ServiceName, queue: make(chan Entry, 4)}
	done := make(chan struct{})
	go func() {
		for i := 0; i < 50; i++ {
			rec.Record(Entry{Action: "entity.created"})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Record 在队列满时阻塞了调用方")
	}
	if got := rec.Dropped(); got != 46 {
		t.Fatalf("满队列丢弃计数: got %d want 46", got)
	}
	// Close 之后再入队不能 panic（业务进程收尾时仍可能有在途请求）。
	rec.Close()
	rec.Close() // 幂等
	rec.Record(Entry{Action: "entity.created"})
	if got := rec.Dropped(); got != 46 {
		t.Fatalf("Close 之后的行既不入队也不计数: %d", got)
	}
}

// 中间件：登记的路由写一行、未登记的不写、失败路径带 error_code、X-Request-Id 透传与回写。
// 用 in-package 直接读队列，不需要数据库。
func TestMiddlewareBuildsDraftAndResult(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := &Recorder{service: ServiceName, queue: make(chan Entry, 8)}
	engine := gin.New()
	engine.Use(Middleware(Options{
		Recorder: rec,
		Actions: map[string]string{
			"PUT /api/things/:id": "thing.updated",
			"POST /api/boom":      "thing.exploded",
		},
		Actor: func(c *gin.Context) Actor {
			return Actor{UserID: "00000000-0000-0000-0000-0000000000aa", Username: "alice", CredentialType: "pat"}
		},
	}))
	engine.PUT("/api/things/:id", func(c *gin.Context) {
		Describe(c, Detail{TargetType: "thing", TargetID: c.Param("id"), Changes: map[string]any{"name": map[string]any{"before": "a", "after": "b"}}})
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	engine.POST("/api/boom", func(c *gin.Context) {
		Fail(c, "thing_conflict")
		c.JSON(http.StatusConflict, gin.H{"error": "thing_conflict"})
	})
	engine.PUT("/api/unregistered/:id", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodPut, "/api/things/42", nil)
	req.Header.Set(RequestIDHeader, "rid-passthrough")
	req.Header.Set("User-Agent", strings.Repeat("u", 700))
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	e := mustEntry(t, rec)
	if e.Action != "thing.updated" || e.Route != "/api/things/:id" || e.RequestMethod != http.MethodPut {
		t.Fatalf("草稿字段不对: %#v", e)
	}
	if e.Result != "success" || e.HTTPStatus != http.StatusOK || e.ErrorCode != "" {
		t.Fatalf("成功路径的 result/status: %#v", e)
	}
	if e.RequestID != "rid-passthrough" {
		t.Fatalf("X-Request-Id 未透传: %q", e.RequestID)
	}
	if e.TargetType != "thing" || e.TargetID != "42" {
		t.Fatalf("Describe 的 target 未进审计行: %#v", e)
	}
	if got := e.Changes["name"].(map[string]any)["after"]; got != "b" {
		t.Fatalf("Describe 的 changes 未进审计行: %#v", e.Changes)
	}
	if e.ActorUsername != "alice" || e.ActorUserID != "00000000-0000-0000-0000-0000000000aa" || e.CredentialType != "pat" {
		t.Fatalf("actor 未进审计行: %#v", e)
	}
	if e.Service != "" {
		t.Fatalf("service 由 Recorder 补齐，不进草稿: %q", e.Service)
	}

	// 失败路径：result=failure + error_code 取 Fail 登记的值。
	engine.POST("/api/boom_no_code", func(c *gin.Context) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database_error"})
	})
	select {
	case extra := <-rec.queue:
		t.Fatalf("未登记动作码的路由不该写审计: %#v", extra)
	default:
	}
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/boom", nil))
	e = mustEntry(t, rec)
	if e.Result != "failure" || e.ErrorCode != "thing_conflict" || e.HTTPStatus != http.StatusConflict {
		t.Fatalf("失败路径: %#v", e)
	}

	// 未登记的路由（含 GET）一行都不写。
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/unregistered/1", nil))
	select {
	case extra := <-rec.queue:
		t.Fatalf("未登记路由不该写审计: %#v", extra)
	default:
	}

	// 缺省 request id：生成 uuid 并回写同名响应头。
	req = httptest.NewRequest(http.MethodPut, "/api/things/7", nil)
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	e = mustEntry(t, rec)
	header := w.Header().Get(RequestIDHeader)
	if header == "" || header != e.RequestID {
		t.Fatalf("缺省 request id 必须生成并回写响应头: header=%q entry=%q", header, e.RequestID)
	}
	rec.Close()
}

// 未注入 recorder（未接库的进程/单测）时中间件只透传，不改变请求语义。
func TestMiddlewareWithoutRecorderPassesThrough(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(Middleware(Options{Actions: map[string]string{"POST /api/x": "x.done"}}))
	engine.POST("/api/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/x", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("未注入 recorder 时请求照旧: %d", w.Code)
	}
}

func mustEntry(t *testing.T, rec *Recorder) Entry {
	t.Helper()
	select {
	case e := <-rec.queue:
		return e
	case <-time.After(time.Second):
		t.Fatal("中间件没有写审计行")
		return Entry{}
	}
}

// 敏感值出现在审计行文本里就违规（契约 §6.2）：把脱敏后的 changes 与凭据正则对一遍，
// 顺带钉住"准凭据必须走 MaskSecret"这条调用方约定。
func TestSanitizedChangesHaveNoSensitiveText(t *testing.T) {
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(?i)password`),
		regexp.MustCompile(`(?i)secret`),
		regexp.MustCompile(`mfp_|mf_pat_`),
		regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}`),
	}
	// 键名本身会出现在 JSON 文本里，所以载荷用的是不含敏感键名的字段：调用方不该把
	// password 这类键名塞进 changes（塞了也只会得到 [redacted]，那种情况下"整行零命中"
	// 由"键名不进 changes"这条约定保证，见 internal/catalog 的真库用例）。
	in := map[string]any{
		"title":   map[string]any{"before": "旧题名", "after": "新题名"},
		"contact": "maintainer@example.com",
		"code":    MaskSecret("abcd1234efgh"),
	}
	b, err := encodeChanges(SanitizeChanges(in))
	if err != nil {
		t.Fatal(err)
	}
	text := string(b)
	for _, p := range patterns {
		if loc := p.FindString(text); loc != "" {
			t.Fatalf("审计行文本命中敏感正则 %s: %q (%s)", p, loc, text)
		}
	}
}
