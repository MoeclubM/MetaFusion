package catalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// 调用日志真库契约：行只归本人（user_id 隔离）、credential 精确过滤、
// 中间件端到端（注入身份走一次真实路由即落行；匿名不落行；读日志端点自身不落行）。
// 未设置 MF_V2_TEST_DSN 时跳过。
func TestPostgresRequestLogsContract(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	uid1 := "11111111-1111-1111-1111-111111111111"
	uid2 := "22222222-2222-2222-2222-222222222222"

	LogRequest(ctx, f.s.DB, uid1, "pat", "CI-key", "GET", "/api/catalog/entities", 200, 3)
	LogRequest(ctx, f.s.DB, uid1, "session", "", "GET", "/api/catalog/entities", 200, 5)
	LogRequest(ctx, f.s.DB, uid2, "pat", "other-key", "GET", "/api/catalog/entities", 200, 7)

	got, err := ListRequestLogs(ctx, f.s.DB, uid1, "", 50)
	if err != nil || len(got) != 2 {
		t.Fatalf("本人应读到 2 行（err=%v）：%v", err, got)
	}
	// 倒序：后写的 session 行在前。
	if got[0].CredentialType != "session" || got[1].CredentialName != "CI-key" {
		t.Fatalf("应按时间倒序：%+v", got)
	}
	filtered, err := ListRequestLogs(ctx, f.s.DB, uid1, "CI-key", 50)
	if err != nil || len(filtered) != 1 || filtered[0].CredentialType != "pat" {
		t.Fatalf("credential 应精确过滤：%v err=%v", filtered, err)
	}
	other, err := ListRequestLogs(ctx, f.s.DB, uid2, "", 50)
	if err != nil || len(other) != 1 {
		t.Fatalf("别人的行不得串户：%v err=%v", other, err)
	}

	// 中间件端到端：注入身份走真实路由即落行。
	gin.SetMode(gin.TestMode)
	r := gin.New()
	me := &User{ID: uid1, Username: "log-user", Role: "member", Permissions: []string{PermissionEntityEdit}}
	r.Use(func(c *gin.Context) { c.Set("catalog_user", me); c.Next() })
	HTTP{Store: f.s}.Register(r)
	before, _ := ListRequestLogs(ctx, f.s.DB, uid1, "", 50)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/catalog/definitions", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("definitions 应 200，实际 %d", w.Code)
	}
	after, _ := ListRequestLogs(ctx, f.s.DB, uid1, "", 50)
	if len(after) != len(before)+1 || after[0].Route != "/api/catalog/definitions" || after[0].Status != 200 {
		t.Fatalf("中间件应落行（route 模板）：before=%d after=%+v", len(before), after)
	}
	// 读日志端点自身不落行：查看不污染列表。
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/catalog/developer/request-logs?limit=10", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("request-logs 应 200，实际 %d", w.Code)
	}
	final, _ := ListRequestLogs(ctx, f.s.DB, uid1, "", 50)
	for _, e := range final {
		if e.Route == "/api/catalog/developer/request-logs" {
			t.Fatalf("读日志端点自身不得落行")
		}
	}
	if len(final) != len(after) {
		t.Fatalf("读日志不应新增行：%d vs %d", len(final), len(after))
	}

	// 匿名请求不落行。
	r2 := gin.New()
	r2.Use(func(c *gin.Context) { c.Next() })
	HTTP{Store: f.s}.Register(r2)
	w = httptest.NewRecorder()
	r2.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/catalog/definitions", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("匿名 definitions 应 200，实际 %d", w.Code)
	}
	if again, _ := ListRequestLogs(ctx, f.s.DB, uid1, "", 50); len(again) != len(final) {
		t.Fatalf("匿名请求不得落行：%d vs %d", len(again), len(final))
	}
}
