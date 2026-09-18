package upstream

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// 测试不用真等时间：时钟与 sleep 都可注入。退避与熔断窗口的真实验证靠断言"传进去的时长"。
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (f *fakeClock) now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.t
}

func (f *fakeClock) advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.t = f.t.Add(d)
}

func newTestClient(t *testing.T, p Policy) (*Client, *fakeClock, *[]time.Duration) {
	t.Helper()
	c := New(p)
	clock := &fakeClock{t: time.Unix(1700000000, 0)}
	delays := &[]time.Duration{}
	var mu sync.Mutex
	c.SetClock(clock.now)
	c.SetSleeper(func(ctx context.Context, d time.Duration) error {
		mu.Lock()
		*delays = append(*delays, d)
		mu.Unlock()
		return ctx.Err()
	})
	c.SetLogger(func(string, ...any) {})
	return c, clock, delays
}

func TestRetriesThenSucceedsAndReplaysBody(t *testing.T) {
	var hits, bodies int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		buf := make([]byte, 64)
		read, _ := r.Body.Read(buf)
		if read > 0 {
			atomic.AddInt32(&bodies, 1)
		}
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	p := DefaultPolicy("auth")
	c, _, delays := newTestClient(t, p)
	resp, err := c.Do(context.Background(), Request{
		Method: http.MethodPost, URL: srv.URL, Body: []byte(`{"token":"x"}`),
		Header: http.Header{"Content-Type": []string{"application/json"}},
	})
	if err != nil {
		t.Fatalf("第 3 次应成功，实际报错: %v", err)
	}
	defer resp.Body.Close()
	if got := atomic.LoadInt32(&hits); got != 3 {
		t.Fatalf("上游被打了 %d 次，期望 3 次（2 次 5xx + 1 次成功）", got)
	}
	if got := atomic.LoadInt32(&bodies); got != 3 {
		t.Fatalf("重试必须重放同一个请求体：带体请求只有 %d 次", got)
	}
	if len(*delays) != 2 {
		t.Fatalf("两次重试之间应有两次退避，实际 %v", *delays)
	}
	for i, d := range *delays {
		if d <= 0 || d > p.MaxBackoff {
			t.Fatalf("第 %d 次退避 %v 不在 (0, %v] 内（退避必须有界）", i+1, d, p.MaxBackoff)
		}
	}
	if st := c.Stats(); st.Failures != 0 || st.State != "closed" {
		t.Fatalf("成功后熔断器应保持闭合，实际 %+v", st)
	}
}

func TestBoundedRetriesThenUnavailable(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	p := DefaultPolicy("catalog")
	p.BreakerThreshold = 100 // 本用例只看"重试有界"，不让熔断提前介入
	c, _, _ := newTestClient(t, p)
	started := time.Now()
	_, err := c.Do(context.Background(), Request{Method: http.MethodGet, URL: srv.URL})
	if err == nil {
		t.Fatal("上游一直 503 时必须失败")
	}
	if !IsUnavailable(err) {
		t.Fatalf("失败必须是 *upstream.Error，实际 %T", err)
	}
	var ue *Error
	if !errors.As(err, &ue) {
		t.Fatalf("errors.As 拿不到 *Error: %v", err)
	}
	if ue.Code() != CodeUpstreamUnavailable {
		t.Fatalf("机器码 = %q，期望 %q", ue.Code(), CodeUpstreamUnavailable)
	}
	if ue.Reason != "status_503" || ue.Status != 503 {
		t.Fatalf("失败原因 = %q/%d，期望 status_503/503", ue.Reason, ue.Status)
	}
	if ue.Attempts != p.Attempts {
		t.Fatalf("尝试次数 = %d，期望 %d（有界重试）", ue.Attempts, p.Attempts)
	}
	if got := atomic.LoadInt32(&hits); got != int32(p.Attempts) {
		t.Fatalf("上游被打了 %d 次，期望恰好 %d 次", got, p.Attempts)
	}
	if elapsed := time.Since(started); elapsed > p.Budget+time.Second {
		t.Fatalf("整次调用耗时 %v 超出预算 %v（重试与退避必须有界）", elapsed, p.Budget)
	}
}

func TestTimeoutIsRetriedThenUnavailable(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	defer func() { close(release); srv.Close() }()

	p := DefaultPolicy("auth")
	p.Attempts = 2
	p.AttemptTimeout = 150 * time.Millisecond
	p.ProbeTimeout = 100 * time.Millisecond
	p.BreakerThreshold = 100
	c, _, _ := newTestClient(t, p)
	_, err := c.Do(context.Background(), Request{Method: http.MethodGet, URL: srv.URL})
	if err == nil {
		t.Fatal("上游超时必须失败")
	}
	var ue *Error
	if !errors.As(err, &ue) || ue.Reason != ReasonTimeout {
		t.Fatalf("失败原因应是 %s，实际 %v", ReasonTimeout, err)
	}
	if ue.Attempts != 2 {
		t.Fatalf("超时也要走到重试上限：尝试 %d 次，期望 2 次", ue.Attempts)
	}
}

func TestBreakerOpensThenFastFailsAndRecovers(t *testing.T) {
	var healthy atomic.Bool
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if healthy.Load() {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	p := DefaultPolicy("catalog")
	p.Attempts = 1 // 本用例隔离"重试"变量，只看熔断
	p.BreakerThreshold = 2
	p.BreakerOpenFor = 10 * time.Second
	p.Budget = time.Second
	c, clock, _ := newTestClient(t, p)

	// 前两次：真实打上游、失败，第二次把熔断器打开。
	for i := 1; i <= 2; i++ {
		if _, err := c.Do(context.Background(), Request{Method: http.MethodGet, URL: srv.URL}); err == nil {
			t.Fatalf("第 %d 次调用应失败", i)
		}
	}
	if st := c.Stats(); st.State != "open" {
		t.Fatalf("连续 2 次失败后熔断器应为 open，实际 %s", st.State)
	}
	before := atomic.LoadInt32(&hits)

	// 第三次：熔断打开期间必须**快速失败且不打上游**。
	_, err := c.Do(context.Background(), Request{Method: http.MethodGet, URL: srv.URL})
	var ue *Error
	if !errors.As(err, &ue) || ue.Reason != ReasonCircuitOpen {
		t.Fatalf("熔断期间应回 %s，实际 %v", ReasonCircuitOpen, err)
	}
	if got := atomic.LoadInt32(&hits); got != before {
		t.Fatalf("熔断期间不该再打上游：命中数 %d → %d", before, got)
	}
	if st := c.Stats(); st.Rejected != 1 {
		t.Fatalf("熔断拒绝数 = %d，期望 1", st.Rejected)
	}

	// 冷却期内仍快速失败；越过冷却期后放一个半开探测。
	healthy.Store(true)
	clock.advance(p.BreakerOpenFor / 2)
	if _, err := c.Do(context.Background(), Request{Method: http.MethodGet, URL: srv.URL}); !errors.As(err, &ue) || ue.Reason != ReasonCircuitOpen {
		t.Fatalf("冷却期内应继续快速失败，实际 %v", err)
	}
	clock.advance(p.BreakerOpenFor)
	resp, err := c.Do(context.Background(), Request{Method: http.MethodGet, URL: srv.URL})
	if err != nil {
		t.Fatalf("半开探测成功应恢复：%v", err)
	}
	resp.Body.Close()
	if st := c.Stats(); st.State != "closed" {
		t.Fatalf("探测成功后熔断器应闭合，实际 %s", st.State)
	}
	if _, err := c.Do(context.Background(), Request{Method: http.MethodGet, URL: srv.URL}); err != nil {
		t.Fatalf("恢复后的正常调用不该再失败: %v", err)
	}
}

func TestClientErrorsPassThroughWithoutRetry(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c, _, _ := newTestClient(t, DefaultPolicy("catalog"))
	resp, err := c.Do(context.Background(), Request{Method: http.MethodGet, URL: srv.URL})
	if err != nil {
		t.Fatalf("404 是上游的明确回答，不该变成上游不可用: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("状态码 = %d，期望 404", resp.StatusCode)
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("4xx 不该重试：命中 %d 次", got)
	}
	if st := c.Stats(); st.Failures != 0 {
		t.Fatalf("4xx 不该计入熔断失败：%+v", st)
	}
}

func TestParentCancellationIsNotUpstreamFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	p := DefaultPolicy("auth")
	p.Attempts = 3
	p.AttemptTimeout = 5 * time.Second
	p.Budget = 6 * time.Second
	c, _, _ := newTestClient(t, p)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	_, err := c.Do(ctx, Request{Method: http.MethodGet, URL: srv.URL})
	if err == nil {
		t.Fatal("父 ctx 取消后必须返回错误")
	}
	if IsUnavailable(err) {
		t.Fatalf("调用方取消不是上游故障，不该包装成 upstream_unavailable: %v", err)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("应原样返回 ctx 取消错误，实际 %v", err)
	}
	if st := c.Stats(); st.Failures != 0 || st.State != "closed" {
		t.Fatalf("调用方取消不该打开熔断器：%+v", st)
	}
}

func TestRetryAfterIsHonoredWithinCap(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&hits, 1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	p := DefaultPolicy("auth")
	p.Attempts = 2
	p.BaseBackoff = 100 * time.Millisecond
	p.MaxBackoff = 2 * time.Second
	c, _, delays := newTestClient(t, p)
	resp, err := c.Do(context.Background(), Request{Method: http.MethodGet, URL: srv.URL})
	if err != nil {
		t.Fatalf("429 之后重试应成功: %v", err)
	}
	resp.Body.Close()
	if len(*delays) != 1 || (*delays)[0] != time.Second {
		t.Fatalf("应按 Retry-After 退避 1s，实际 %v", *delays)
	}
}

func TestBudgetIsRaisedToFitPolicy(t *testing.T) {
	p := Policy{Name: "x", Attempts: 3, AttemptTimeout: 2 * time.Second, Budget: time.Second, DialTimeout: time.Second}
	n := p.normalized()
	if n.Budget < n.necessaryBudget() {
		t.Fatalf("预算 %v 小于最坏耗时 %v（会出现'配了重试、实际被预算砍掉'）", n.Budget, n.necessaryBudget())
	}
	if got := New(p).Policy().Budget; got != n.Budget {
		t.Fatalf("生效预算 = %v，期望 %v", got, n.Budget)
	}
}

func TestProbeAllReportsEachUpstream(t *testing.T) {
	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer healthy.Close()
	sick := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer sick.Close()

	p := DefaultPolicy("probe")
	p.ProbeTimeout = time.Second
	ok := New(p)
	ok.SetLogger(func(string, ...any) {})
	bad := New(p)
	bad.SetLogger(func(string, ...any) {})
	results := ProbeAll(context.Background(), 3*time.Second, []ProbeTarget{
		{Client: ok, URL: healthy.URL},
		{Client: bad, URL: sick.URL},
		{Client: nil, URL: ""},
	})
	if len(results) != 3 {
		t.Fatalf("探测结果数 = %d，期望 3", len(results))
	}
	if results[0].Status != ProbeReady {
		t.Fatalf("健康上游应 ready，实际 %+v", results[0])
	}
	if results[1].Status != ProbeUnavailable || results[1].Reason != "status_503" {
		t.Fatalf("503 上游应 unavailable/status_503，实际 %+v", results[1])
	}
	if results[2].Reason != ReasonNotConfigured {
		t.Fatalf("未配置地址应记 not_configured（部署态不是故障），实际 %+v", results[2])
	}
	if !strings.Contains(results[1].Breaker, "closed") && results[1].Breaker == "" {
		t.Fatalf("探针结果必须带熔断状态，实际 %+v", results[1])
	}
}
