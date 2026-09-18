package catalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/metafusion/metafusion-app/internal/upstream"
)

// 静音重试：真等服务端的退避会让用例变慢，而"退避多少"已经由 upstream 包的用例断言。
func quietIntrospector(t *testing.T, baseURL string, now func() time.Time) *PATIntrospector {
	t.Helper()
	p := newPATIntrospector(baseURL, now)
	p.client.SetLogger(func(string, ...any) {})
	p.client.SetSleeper(func(ctx context.Context, _ time.Duration) error { return ctx.Err() })
	return p
}

// 账号服务的秒级抖动（这里是一次 503）不该直接把有效 PAT 判成"依赖不可用"：有界重试要兜住它。
func TestPATIntrospectRetriesTransientFailure(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&hits, 1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"valid":true,"user_id":"11111111-1111-1111-1111-111111111111","username":"probe","role":"user","permissions":[]}`))
	}))
	defer srv.Close()

	p := quietIntrospector(t, srv.URL, nil)
	ident, err := p.Introspect(context.Background(), patToken('a'))
	if err != nil {
		t.Fatalf("一次 503 之后重试应成功，实际报错: %v", err)
	}
	if ident == nil || ident.UserID == "" {
		t.Fatalf("应拿到身份，实际 %+v", ident)
	}
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("重试次数不符：账号服务被打了 %d 次，期望 2 次（1 次 503 + 1 次成功）", got)
	}
}

// 账号服务持续不可用：有界重试之后熔断打开，之后**快速失败**（不再打上游），冷却期满恢复。
func TestPATIntrospectBreakerOpensThenRecovers(t *testing.T) {
	var healthy atomic.Bool
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if healthy.Load() {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"valid":true,"user_id":"11111111-1111-1111-1111-111111111111","username":"probe","role":"user","permissions":[]}`))
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	now := time.Unix(1700000000, 0)
	policy := PATIntrospectPolicy()
	p := quietIntrospector(t, srv.URL, func() time.Time { return now })
	p.client.SetClock(func() time.Time { return now })

	// 策略说"连续 5 次调用失败就打开"，每次失败内部最多 2 次尝试。
	for i := 1; i <= policy.BreakerThreshold; i++ {
		if _, err := p.Introspect(context.Background(), patToken(byte('a'+i))); err == nil {
			t.Fatalf("第 %d 次调用应失败", i)
		}
	}
	if state := p.BreakerState(); state != "open" {
		t.Fatalf("连续 %d 次失败后熔断器应为 open，实际 %s", policy.BreakerThreshold, state)
	}
	before := atomic.LoadInt32(&hits)

	// 熔断打开期间：快速失败，且不打上游。
	start := time.Now()
	if _, err := p.Introspect(context.Background(), patToken('z')); err == nil {
		t.Fatal("熔断打开期间应失败")
	}
	if got := atomic.LoadInt32(&hits); got != before {
		t.Fatalf("熔断打开期间不该再打账号服务：命中数 %d → %d", before, got)
	}
	if elapsed := time.Since(start); elapsed > 200*time.Millisecond {
		t.Fatalf("熔断打开时应快速失败，实际耗时 %v", elapsed)
	}

	// 冷却期内仍快速失败；越过冷却期 + 上游恢复后，半开探测成功并闭合熔断。
	now = now.Add(policy.BreakerOpenFor / 2)
	if _, err := p.Introspect(context.Background(), patToken('y')); err == nil {
		t.Fatal("冷却期内应继续失败")
	}
	healthy.Store(true)
	now = now.Add(policy.BreakerOpenFor)
	ident, err := p.Introspect(context.Background(), patToken('w'))
	if err != nil {
		t.Fatalf("冷却期满且上游恢复后应成功: %v", err)
	}
	if ident == nil {
		t.Fatal("恢复后应拿到身份")
	}
	if state := p.BreakerState(); state != "closed" {
		t.Fatalf("半开探测成功后熔断器应闭合，实际 %s", state)
	}
}

// 上游超时必须被单次尝试超时切断（不能挂住请求路径），且退避重试之后按依赖不可用返回。
func TestPATIntrospectTimesOutFast(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		time.Sleep(2 * time.Second)
	}))
	defer srv.Close()

	policy := PATIntrospectPolicy()
	policy.AttemptTimeout = 120 * time.Millisecond
	policy.Budget = 600 * time.Millisecond
	p := newPATIntrospector(srv.URL, nil)
	p.client.SetLogger(func(string, ...any) {})
	p.client = upstream.New(policy)

	start := time.Now()
	_, err := p.Introspect(context.Background(), patToken('a'))
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("上游超时应返回错误")
	}
	// 失败原因必须是上游不可用（调用方按 err != nil 回 503 auth_unavailable + 机器码），
	// 而不是伪装成"令牌无效"。
	if !upstream.IsUnavailable(err) {
		t.Fatalf("超时应包装成 upstream 不可用，实际 %v", err)
	}
	if elapsed > time.Second {
		t.Fatalf("超时必须被单次尝试超时切断，实际耗时 %v", elapsed)
	}
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("超时也要走完有界重试：账号服务被打了 %d 次，期望 2 次", got)
	}
}

// 深探目标打在账号服务的 /ready 上（它自己会 ping 库）；未配置 AUTH_URL 时是"部署态"而不是故障。
func TestProbeTargetPointsAtAuthReady(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	p := NewPATIntrospector(srv.URL)
	target := p.ProbeTarget()
	if target.URL != srv.URL+"/ready" {
		t.Fatalf("探测地址 = %q，期望 %q", target.URL, srv.URL+"/ready")
	}
	results := upstream.ProbeAll(context.Background(), 2*time.Second, []upstream.ProbeTarget{target})
	if len(results) != 1 || results[0].Status != upstream.ProbeReady {
		t.Fatalf("深探应报 ready，实际 %+v", results)
	}
	if gotPath != "/ready" {
		t.Fatalf("探测路径 = %q，期望 /ready", gotPath)
	}

	// 未配置 AUTH_URL：探针报 not_configured（部署态），而不是"账号服务挂了"。
	empty := upstream.ProbeAll(context.Background(), time.Second, []upstream.ProbeTarget{NewPATIntrospector("").ProbeTarget()})
	if len(empty) != 1 || empty[0].Reason != upstream.ReasonNotConfigured {
		t.Fatalf("未配置 AUTH_URL 应记 not_configured，实际 %+v", empty)
	}
}
