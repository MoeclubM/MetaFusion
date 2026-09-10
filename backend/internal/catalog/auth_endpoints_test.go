package catalog

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestAuthEndpointAliases 覆盖本次补齐的 auth 端点，校验真实能力返回与别名路由
// 注册，不依赖数据库（未认证请求在 required 中间件即被拒绝）。
func TestAuthEndpointAliases(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	HTTP{Store: &Store{}}.Register(r)

	// GET /auth/settings：四项必填布尔均应为真实能力 false，字段名与前端
	// PublicAuthSettings 对齐（registration_enabled/invite_required/
	// require_email_verification/email_verification_enabled）。
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/settings", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /auth/settings status = %d, want 200", w.Code)
	}
	var settings map[string]bool
	if err := json.Unmarshal(w.Body.Bytes(), &settings); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	for _, k := range []string{"registration_enabled", "invite_required", "require_email_verification", "email_verification_enabled"} {
		v, ok := settings[k]
		if !ok {
			t.Fatalf("settings missing field %q", k)
		}
		if v {
			t.Fatalf("settings %q = true, want false (no backing implementation)", k)
		}
	}

	// PUT /auth/password 与 POST /auth/change-password 语义相同：未认证时都应在
	// 触及 Store 前返回 401，证明别名已注册且鉴权行为一致。
	for _, tc := range []struct{ method, path string }{
		{http.MethodPut, "/api/auth/password"},
		{http.MethodPost, "/api/auth/change-password"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{"old_password":"old-pass-1234","new_password":"new-pass-1234"}`))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s = %d, want 401", tc.method, tc.path, w.Code)
		}
	}
}
