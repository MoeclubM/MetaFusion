package capabilities

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// 前端依赖这两个端点的形状：清单仍是 {modules:[…]}，开关端点给出明确原因而不是 404。
// 清单字段名（id/version/dependencies/enabled/healthy）也在这条测试里钉住。
func TestRegisterServesManifestsAndRetiresToggle(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := New(func(k string) string {
		if k == "COMMUNITY_URL" {
			return "http://community:8083"
		}
		return ""
	})
	engine := gin.New()
	r.Register(engine)

	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/capabilities", nil))
	if w.Code != 200 {
		t.Fatalf("能力清单 HTTP %d", w.Code)
	}
	var body struct {
		Modules []struct {
			ID           string            `json:"id"`
			Version      string            `json:"version"`
			Dependencies map[string]string `json:"dependencies"`
			Enabled      bool              `json:"enabled"`
			Healthy      bool              `json:"healthy"`
		} `json:"modules"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || len(body.Modules) == 0 {
		t.Fatalf("能力清单形状不符: %v / %s", err, w.Body.String())
	}
	for _, m := range body.Modules {
		if m.ID == "" || m.Version == "" || m.Dependencies == nil {
			t.Fatalf("清单项缺字段: %+v", m)
		}
	}

	w = httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/admin/modules/community", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("已退役的模块开关应返回 409，实际 %d", w.Code)
	}
	if !json.Valid(w.Body.Bytes()) {
		t.Fatalf("响应体不是 JSON: %s", w.Body.String())
	}
}
