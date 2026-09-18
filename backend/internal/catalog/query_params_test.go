package catalog

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// 审计 2026-09-19 第 5 条：GET /api/catalog/entities?q=%00（及 %FF/%C3）线上返回
// 500 {"error":"database_error"}——非法输入被报成服务故障，前端又把它渲染成"没有结果"。
// 这些用例钉住"参数层就拒绝"，且不需要数据库：Store 在参数闸门之后才会用到。
func TestListRejectsUnsendableQueryParams(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name string
		path string
		code string
	}{
		{"NUL", "/api/catalog/entities?q=%00", codeInvalidQueryParam},
		{"NUL in middle", "/api/catalog/entities?q=a%00b", codeInvalidQueryParam},
		{"invalid utf-8", "/api/catalog/entities?q=%FF", codeInvalidQueryParam},
		{"truncated utf-8", "/api/catalog/entities?q=%C3", codeInvalidQueryParam},
		{"newline", "/api/catalog/entities?q=a%0Ab", codeInvalidQueryParam},
		{"bare percent drops the value", "/api/catalog/entities?q=100%", codeInvalidQueryParam},
		{"overlong", "/api/catalog/entities?q=" + strings.Repeat("a", listTextParamLimit+1), codeQueryTooLong},
		{"attribute value", "/api/catalog/entities?kind=work&value=%00", codeInvalidQueryParam},
		{"tag", "/api/catalog/entities?tags=%FF", codeInvalidQueryParam},
		{"tags endpoint", "/api/catalog/tags?q=%00", codeInvalidQueryParam},
	} {
		w := httptest.NewRecorder()
		gateEngine(nil).ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status=%d body=%s want 400 %s", tc.name, w.Code, w.Body.String(), tc.code)
			continue
		}
		// 响应体必须是稳定机器码本身：不是 500 database_error、不是裸 SQL、也不是空体。
		if !strings.Contains(w.Body.String(), tc.code) {
			t.Errorf("%s: body=%s want code %s", tc.name, w.Body.String(), tc.code)
		}
	}
}

// 对照：合法取值不能被这道闸门误伤（制表符是允许的，见 checkQueryText）。
func TestCheckQueryTextAllowsLegitimateValues(t *testing.T) {
	for _, ok := range []string{"", "デルタルーン", "Deltarune: Chapter 1", "a\tb", strings.Repeat("a", listTextParamLimit), "\u00a0"} {
		if err := checkQueryText(ok); err != nil {
			t.Errorf("合法取值被拒: %q -> %v", ok, err)
		}
	}
}
