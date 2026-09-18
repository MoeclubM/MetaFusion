package catalog

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
)

// 限流路由必须把窗口额度随响应下发：四语字典 settings.patRateLimitHint 承诺过
// X-RateLimit-*，此前服务端一个都没发（全仓 grep = 0），承诺与实现相反。
func TestRouteLimiterAdvertisesRemainingBudget(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/limited", routeLimiter(2), func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	call := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/limited", nil))
		return w
	}
	headerInt := func(w *httptest.ResponseRecorder, name string) int {
		t.Helper()
		v := w.Header().Get(name)
		n, err := strconv.Atoi(v)
		if err != nil {
			t.Fatalf("%s = %q, 不是整数", name, v)
		}
		return n
	}

	for i, want := range []int{1, 0} {
		w := call()
		if w.Code != http.StatusOK {
			t.Fatalf("第 %d 次 = %d, want 200", i+1, w.Code)
		}
		if got := headerInt(w, "X-RateLimit-Limit"); got != 2 {
			t.Errorf("X-RateLimit-Limit = %d, want 2", got)
		}
		if got := headerInt(w, "X-RateLimit-Remaining"); got != want {
			t.Errorf("第 %d 次 X-RateLimit-Remaining = %d, want %d", i+1, got, want)
		}
		if got := headerInt(w, "X-RateLimit-Reset"); got < 1 || got > 61 {
			t.Errorf("X-RateLimit-Reset = %d, 应在窗口剩余秒数范围内", got)
		}
	}
	// 超额：429 仍带同样的三件套，外加 Retry-After。
	w := call()
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("超额请求 = %d, want 429", w.Code)
	}
	if got := headerInt(w, "X-RateLimit-Remaining"); got != 0 {
		t.Errorf("超额时 X-RateLimit-Remaining = %d, want 0", got)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("429 应带 Retry-After")
	}
}
