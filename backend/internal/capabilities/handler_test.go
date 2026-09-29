package capabilities

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// 前端依赖这个端点的形状：GET /api/capabilities -> {modules:[{id,enabled}]}。
// 清单是部署态声明（服务在不在场），不是健康探测结果，因此没有 healthy/version/dependencies
// 这类拆分前模块清单的字段。
func TestRegisterServesManifests(t *testing.T) {
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
			ID      string `json:"id"`
			Enabled bool   `json:"enabled"`
		} `json:"modules"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || len(body.Modules) == 0 {
		t.Fatalf("能力清单形状不符: %v / %s", err, w.Body.String())
	}
	enabled := map[string]bool{}
	for _, m := range body.Modules {
		if m.ID == "" {
			t.Fatalf("清单项缺 id: %+v", m)
		}
		enabled[m.ID] = m.Enabled
	}
	// 只声明了 COMMUNITY_URL：community 在场，storage 不在场，exchange 由目录自身提供。
	if !enabled["exchange"] || !enabled["community"] || enabled["storage"] {
		t.Fatalf("enabled 与部署声明不符: %+v", enabled)
	}
}
