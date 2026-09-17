package capabilities

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// allowAll 是"已通过闸门"的替身：闸门语义（未登录 401 / 非管理员 403）由组合根注入的那一侧实现
// （目录服务的 catalog.HTTP.AdminGate），本包钉住的是"闸门排在处理器之前"与 409 的形状不变。
func allowAll(c *gin.Context) { c.Next() }

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
	r.Register(engine, allowAll)

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

	// 过了闸门的调用方仍拿到原来的墓碑契约：409 + module_toggle_retired + hint。
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/admin/modules/community", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("已退役的模块开关应返回 409，实际 %d", w.Code)
	}
	if !json.Valid(w.Body.Bytes()) {
		t.Fatalf("响应体不是 JSON: %s", w.Body.String())
	}
	var retired struct {
		Error string `json:"error"`
		Hint  string `json:"hint"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &retired); err != nil || retired.Error != "module_toggle_retired" || retired.Hint == "" {
		t.Fatalf("墓碑响应契约不符: %v / %s", err, w.Body.String())
	}
}

// 闸门必须真的排在处理器前面：被拒的请求拿不到 409 与 hint，同时不影响匿名可读的清单端点。
func TestModuleToggleRunsBehindGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	deny := func(c *gin.Context) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	}
	engine := gin.New()
	New(nil).Register(engine, deny)

	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/admin/modules/community", nil))
	if w.Code != http.StatusForbidden || strings.Contains(w.Body.String(), "module_toggle_retired") || strings.Contains(w.Body.String(), "hint") {
		t.Fatalf("闸门应拦在 409 之前: status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/capabilities", nil))
	if w.Code != 200 {
		t.Fatalf("闸门不该波及清单端点: status=%d body=%s", w.Code, w.Body.String())
	}
}

// 组合根漏接闸门时 fail closed：返回 401，而不是让墓碑端点裸奔成匿名可访问。
func TestModuleToggleFailsClosedWithoutGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	New(nil).Register(engine, nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/admin/modules/community", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("缺闸门应 fail closed（401）: status=%d body=%s", w.Code, w.Body.String())
	}
}
