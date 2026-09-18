package catalog

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metafusion/metafusion-app/internal/nettrust"
)

// routeLimiter 的桶键是 c.ClientIP() + 路由。此前四个服务都是 SetTrustedProxies(nil)，ClientIP() 恒等于
// 网关容器 IP，于是所有人共用一个桶（线上实测第 11 次 /api/catalog/compare 即 429）。
// 本用例把修好之后的语义钉住：
//  1. 两个不同的真实客户端 IP 各自独立配额；
//  2. 不可信对端伪造的 X-Forwarded-For 不会凭空换来一个新桶。
func TestRouteLimiterCountsPerRealClientIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// 桶键含路由：用一次性路径，避免与其它用例（或 -count=2 的重复运行）共用 package 级桶。
	path := fmt.Sprintf("/__clientip_probe__/%d", time.Now().UnixNano())
	engine := gin.New()
	if _, err := nettrust.Apply(engine, ""); err != nil {
		t.Fatalf("nettrust.Apply: %v", err)
	}
	engine.GET(path, routeLimiter(2), func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	call := func(remoteAddr, forwardedFor string) int {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = remoteAddr
		if forwardedFor != "" {
			req.Header.Set("X-Forwarded-For", forwardedFor)
		}
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		return w.Code
	}

	// 两个不同客户端（网关转发的私网对端 + 各自真实 IP），配额相互独立。
	for i := 1; i <= 2; i++ {
		if got := call("172.18.0.9:51000", "203.0.113.9, 203.0.113.9"); got != http.StatusOK {
			t.Fatalf("客户端 A 第 %d 次请求 = %d，期望 200", i, got)
		}
		if got := call("172.18.0.9:51000", "198.51.100.4, 198.51.100.4"); got != http.StatusOK {
			t.Fatalf("客户端 B 第 %d 次请求 = %d，期望 200（B 的配额不该被 A 用掉）", i, got)
		}
	}
	// 各自的第 3 次都超限：说明计数确实按真实 IP 分开，且两边都真的在被限流。
	if got := call("172.18.0.9:51000", "203.0.113.9, 203.0.113.9"); got != http.StatusTooManyRequests {
		t.Fatalf("客户端 A 第 3 次请求 = %d，期望 429", got)
	}
	if got := call("172.18.0.9:51000", "198.51.100.4, 198.51.100.4"); got != http.StatusTooManyRequests {
		t.Fatalf("客户端 B 第 3 次请求 = %d，期望 429", got)
	}

	// 不可信对端（公网地址直连服务）伪造 XFF：头被忽略，桶是它自己的地址，
	// 换个伪造值也换不到新桶——伪造 XFF 不能绕过限流。
	for i, forged := range []string{"203.0.113.1", "203.0.113.2", "203.0.113.3"} {
		want := http.StatusOK
		if i == 2 {
			want = http.StatusTooManyRequests
		}
		if got := call("198.51.100.7:52000", forged); got != want {
			t.Fatalf("不可信对端第 %d 次（伪造 XFF %s）= %d，期望 %d（伪造头不得生效）", i+1, forged, got, want)
		}
	}

	// 限流响应仍带既有契约里的三个数值头与 Retry-After。
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.RemoteAddr = "198.51.100.7:52000"
	req.Header.Set("X-Forwarded-For", "203.0.113.4")
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("状态码 = %d，期望 429", w.Code)
	}
	for _, h := range []string{"X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"} {
		if w.Header().Get(h) == "" {
			t.Fatalf("限流响应缺少 %s", h)
		}
	}
}
