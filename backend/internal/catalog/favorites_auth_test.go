package catalog

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestFavoritesAndPreferencesAuth 覆盖收藏与首页偏好的鉴权口径回归：
// toggle/mine 需登录但不限管理员（普通用户 403 即回归），
// 偏好读写对称（GET 匿名 401、PUT 匿名 401），不依赖数据库
// （未认证请求在 required 中间件即被拒绝）。
func TestFavoritesAndPreferencesAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	HTTP{Store: &Store{}}.Register(r)

	// 未登录：toggle/mine/偏好读写一律 401。
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/favorites/toggle", `{"target_type":"work","target_id":"00000000-0000-0000-0000-000000000000"}`},
		{http.MethodGet, "/api/favorites/mine", ""},
		{http.MethodGet, "/api/catalog/me/home-preferences", ""},
		{http.MethodPut, "/api/catalog/me/home-preferences", `{"order":[],"hidden":[]}`},
		{http.MethodGet, "/api/oauth/clients", ""},
	} {
		var req *http.Request
		if tc.body != "" {
			req = httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
		} else {
			req = httptest.NewRequest(tc.method, tc.path, nil)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s = %d, want 401", tc.method, tc.path, w.Code)
		}
	}

	// toggle 统一 body 解析：未知字段应 400（invalid_payload），而非落库。
	// 无认证时 required 先返回 401，因此这里用一个伪造登录态验证 body 口径：
	// 直接测 body() 对未知字段的拒绝行为。
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/favorites/toggle", strings.NewReader(`{"target_type":"work","target_id":"x","unknown_field":1}`))
	c.Request.Header.Set("Content-Type", "application/json")
	var in struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
	}
	if body(c, &in) {
		t.Fatal("toggle body with unknown field should be rejected")
	}
	if w.Code != http.StatusBadRequest {
		t.Fatalf("toggle unknown field status = %d, want 400", w.Code)
	}
}
