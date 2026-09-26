package catalog

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// 交互式文档页（/api/docs、/api/swagger）属管理面：它们在浏览器里执行脚本且与本域同源，
// 匿名可达等于公开整份 API 面（审计 S-4）。口径固定为"未登录 401 / 无管理码 403 / 管理员 200"。
// 反向验证：把这两条路由挪回 api.Use(attachUser) 之前、或去掉 required 闸门，本用例立即失败。
func TestDocsPagesRequireAdminPermission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// editor 持另一个目录码：证明被拒的原因是"缺管理码"，而不是"没有权限声明"。
	editor := &User{ID: "u-editor", Permissions: []string{PermissionEntityEdit}}
	admin := &User{ID: "u-admin", Permissions: []string{PermissionLifecycleManage}}

	for _, path := range []string{"/api/docs", "/api/swagger"} {
		w := httptest.NewRecorder()
		gateEngine(nil).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "authentication_required") {
			t.Errorf("%s 匿名: status=%d body=%s, want 401 authentication_required", path, w.Code, w.Body.String())
		}
		w = httptest.NewRecorder()
		gateEngine(editor).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "forbidden") {
			t.Errorf("%s 无管理码: status=%d body=%s, want 403 forbidden", path, w.Code, w.Body.String())
		}
		w = httptest.NewRecorder()
		gateEngine(admin).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK || !strings.Contains(w.Header().Get("Content-Type"), "text/html") {
			t.Errorf("%s 管理员: status=%d content-type=%q, want 200 text/html", path, w.Code, w.Header().Get("Content-Type"))
		}
	}
}

// 反向对照：OpenAPI 规范是接入方的公开契约（Agent 与 SDK 靠它发现端点），匿名必须读得到。
// 若将来把它一起收进管理面，本用例失败——那时要连带改文档站与技能仓库的接入流程，而不是静默加闸。
func TestOpenAPIJSONStaysPublic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	gateEngine(nil).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/openapi.json", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "openapi") {
		t.Fatalf("匿名读 /api/openapi.json: status=%d body=%.160s, want 200 规范 JSON", w.Code, w.Body.String())
	}
}
