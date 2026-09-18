// Package upstream 是跨服务出站调用的统一执行器：超时分层 + 有界重试（指数退避 + 抖动）+ 熔断。
//
// 为什么必须有它：catalog→auth（PAT 内省）、community→catalog（可见性/标题/关系）、
// storage→auth（会话兜底）这三类调用此前都是"固定 5s 超时、无重试、无熔断"。上游一抖就整块功能
// 不可用；更糟的是失败在调用方被折成"空结果"（Lookup 返回 ok=false → 列表少字段、详情 404、
// 收藏对象消失），故障对用户和运维都不可观测。本包把这件事收口成一处：
//
//   - 超时分层：拨号 / TLS 握手 / 首字节（Transport 层）+ 单次尝试（含读完响应体）+ 一次调用的总预算；
//   - 有界重试：只重试**可重放且幂等**的请求（Body 以 []byte 传入，每次尝试重建 reader），
//     指数退避 + 抖动，次数与预算都封顶，绝不无限重试；
//   - 熔断：连续失败到阈值就打开，之后**立即**回错（不打上游），冷却期后只放一个半开探测，
//     探测成功即闭合；
//   - 失败可观测：统一包装成 *Error，Code() 恒为 CodeUpstreamUnavailable（稳定机器码），
//     调用方据此回 503 + 机器码，而不是把"取不到"伪装成"没有"。
//
// 口径（改这里之前先读）：
//   - 只有 Timeout / Connection / 5xx / 429 会重试。404 这类 4xx 是上游的明确回答，原样交还调用方。
//   - 调用方自己取消（父 ctx 取消）不是上游故障：原样返回 ctx.Err()，且不进熔断计数——
//     否则用户关页面会把上游"熔断"掉。
//   - 429 尊重 Retry-After（封顶在 MaxBackoff）：更大的提示说明上游要的是分钟级退避，不是"再试一次"。
//   - 熔断的失败口径是"整次调用最终失败"，不是"单次尝试失败"：一次调用内部的退避重试算一次。
package upstream

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CodeUpstreamUnavailable 是跨服务依赖不可用时的稳定机器码：调用方把它原样写进响应体
// （HTTP 503），前端与 bot 按码分支，而不是按状态码猜。
const CodeUpstreamUnavailable = "upstream_unavailable"

// 深探针（/ready?deep=1）的单行状态。
const (
	ProbeReady       = "ready"
	ProbeUnavailable = "unavailable"
	// ReasonNotConfigured 表示没有配置上游地址（探针不该把它算成"上游挂了"）。
	ReasonNotConfigured = "not_configured"
)

// 失败原因（机器可读，进响应体/日志/深探针输出）。status_* 由状态码拼出。
const (
	ReasonCircuitOpen = "circuit_open"
	ReasonTimeout     = "timeout"
	ReasonConnection  = "connection"
	ReasonBadResponse = "bad_response"
	ReasonBudget      = "budget_exhausted"
	ReasonCancelled   = "cancelled"
)

// Policy 是一个调用点的策略。零值不可用，用 DefaultPolicy 起底再覆盖：
// normalized() 会把缺省/不合理的值收敛成有界值，因此调用点只需要写自己关心的字段。
type Policy struct {
	// Name 是上游名（进日志与深探针输出，例如 "auth" / "catalog"）。
	Name string
	// Attempts 是总尝试次数，含首次。<= 1 表示不重试。
	Attempts int
	// AttemptTimeout 是单次尝试的超时，覆盖"建连 → 写完请求 → 读到响应头 → 读完响应体"。
	AttemptTimeout time.Duration
	// Budget 是一次调用（含所有重试与退避）的总预算上限。小于 normalized() 算出的必要值时会被抬高，
	// 否则会出现"配了重试、实际被预算砍掉"的假重试。
	Budget              time.Duration
	DialTimeout         time.Duration
	TLSHandshakeTimeout time.Duration
	HeaderTimeout       time.Duration
	BaseBackoff         time.Duration
	MaxBackoff          time.Duration
	// Jitter 是退避抖动比例（0~1）：退避 = 指数值 × (1±Jitter)，避免所有调用方同时重试。
	Jitter float64
	// Idempotent 声明该请求可以安全重放（本项目里跨服务调用全是读语义）。
	Idempotent bool

	BreakerThreshold      int
	BreakerOpenFor        time.Duration
	BreakerHalfOpenProbes int
	// ProbeTimeout 是深探针单次探测的超时：必须远小于请求路径上的超时。
	ProbeTimeout time.Duration
}

// DefaultPolicy 返回一份保守可用的策略；调用点只覆盖自己关心的字段。
func DefaultPolicy(name string) Policy {
	return Policy{
		Name:                  name,
		Attempts:              3,
		AttemptTimeout:        2 * time.Second,
		Budget:                6 * time.Second,
		DialTimeout:           time.Second,
		TLSHandshakeTimeout:   2 * time.Second,
		HeaderTimeout:         2 * time.Second,
		BaseBackoff:           100 * time.Millisecond,
		MaxBackoff:            500 * time.Millisecond,
		Jitter:                0.5,
		Idempotent:            true,
		BreakerThreshold:      5,
		BreakerOpenFor:        10 * time.Second,
		BreakerHalfOpenProbes: 1,
		ProbeTimeout:          1500 * time.Millisecond,
	}
}

// maxBackoffFor 是第 attempt 次尝试之前的退避上限（attempt>=2）。
func (p Policy) maxBackoffFor(attempt int) time.Duration {
	if attempt < 2 {
		return 0
	}
	d := float64(p.BaseBackoff) * math.Pow(2, float64(attempt-2))
	if math.IsInf(d, 0) || d > float64(p.MaxBackoff) {
		return p.MaxBackoff
	}
	return time.Duration(d)
}

// necessaryBudget 是一次调用的最坏耗时（所有尝试都打满单次超时 + 全额退避）。
func (p Policy) necessaryBudget() time.Duration {
	total := time.Duration(p.Attempts) * p.AttemptTimeout
	for i := 2; i <= p.Attempts; i++ {
		total += p.maxBackoffFor(i)
	}
	return total
}

func (p Policy) normalized() Policy {
	if p.Name == "" {
		p.Name = "upstream"
	}
	if p.Attempts <= 0 {
		p.Attempts = 1
	}
	if p.AttemptTimeout <= 0 {
		p.AttemptTimeout = 2 * time.Second
	}
	if p.DialTimeout <= 0 {
		p.DialTimeout = time.Second
	}
	if p.TLSHandshakeTimeout <= 0 {
		p.TLSHandshakeTimeout = 2 * time.Second
	}
	if p.HeaderTimeout <= 0 || p.HeaderTimeout > p.AttemptTimeout {
		p.HeaderTimeout = p.AttemptTimeout
	}
	if p.BaseBackoff <= 0 {
		p.BaseBackoff = 100 * time.Millisecond
	}
	if p.MaxBackoff < p.BaseBackoff {
		p.MaxBackoff = p.BaseBackoff
	}
	if p.Jitter < 0 {
		p.Jitter = 0
	}
	if p.Jitter > 1 {
		p.Jitter = 1
	}
	// 预算抬到"所有尝试都打满"的水平：宁可让一次调用慢到 6s，也不要出现
	// "配置说重试 3 次、实际第 2 次就被总预算砍掉"这种说谎的配置。
	if need := p.necessaryBudget(); p.Budget < need {
		p.Budget = need
	}
	if p.BreakerThreshold <= 0 {
		p.BreakerThreshold = 5
	}
	if p.BreakerOpenFor <= 0 {
		p.BreakerOpenFor = 10 * time.Second
	}
	if p.BreakerHalfOpenProbes <= 0 {
		p.BreakerHalfOpenProbes = 1
	}
	if p.ProbeTimeout <= 0 {
		p.ProbeTimeout = 1500 * time.Millisecond
	}
	return p
}

// Error 是上游调用失败的统一形状。Code() 是稳定机器码，Reason/Status/Attempts 供日志与排障。
type Error struct {
	Upstream string
	Reason   string
	Status   int
	Attempts int
	Cause    error
}

func (e *Error) Error() string {
	var b strings.Builder
	fmt.Fprintf(&b, "upstream %s unavailable (%s", e.Upstream, e.Reason)
	if e.Status != 0 {
		fmt.Fprintf(&b, " status=%d", e.Status)
	}
	fmt.Fprintf(&b, " attempts=%d)", e.Attempts)
	if e.Cause != nil {
		fmt.Fprintf(&b, ": %v", e.Cause)
	}
	return b.String()
}

// Code 是稳定的机器码：调用方直接把它写进响应体。
func (e *Error) Code() string { return CodeUpstreamUnavailable }

func (e *Error) Unwrap() error { return e.Cause }

// IsUnavailable 报告错误是否来自上游不可用（调用方据此回 503 + CodeUpstreamUnavailable）。
func IsUnavailable(err error) bool {
	var ue *Error
	return errors.As(err, &ue)
}

// State 是熔断器状态。
type State int

const (
	StateClosed State = iota
	StateOpen
	StateHalfOpen
)

func (s State) String() string {
	switch s {
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half_open"
	default:
		return "closed"
	}
}

type breaker struct {
	mu           sync.Mutex
	state        State
	failures     int
	openedAt     time.Time
	halfOpenLeft int
}

// allow 报告这一次调用能不能打到上游。冷却期满后由 open 转 half_open，只放限定名额的探测。
func (b *breaker) allow(now time.Time, p Policy) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case StateOpen:
		if now.Sub(b.openedAt) < p.BreakerOpenFor {
			return false
		}
		b.state = StateHalfOpen
		b.halfOpenLeft = p.BreakerHalfOpenProbes
		fallthrough
	case StateHalfOpen:
		if b.halfOpenLeft <= 0 {
			return false
		}
		b.halfOpenLeft--
		return true
	default:
		return true
	}
}

func (b *breaker) success() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.state = StateClosed
	b.failures = 0
	b.halfOpenLeft = 0
}

// failure 记一次最终失败；返回 true 表示这次失败把熔断器打开了（供日志用）。
func (b *breaker) failure(now time.Time, p Policy) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.failures++
	if b.state == StateHalfOpen || b.failures >= p.BreakerThreshold {
		justOpened := b.state != StateOpen
		b.state = StateOpen
		b.openedAt = now
		b.halfOpenLeft = 0
		return justOpened
	}
	return false
}

func (b *breaker) current() State {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.state
}

// Request 是一次可重放的出站请求。Body 用 []byte 而不是 io.Reader：重试必须能重建请求体，
// 传 reader 的重试会静默发出空体（这是"重试看起来生效、其实第二次没有 body"的常见来源）。
type Request struct {
	Method string
	URL    string
	Header http.Header
	Body   []byte
}

// Client 是一个调用点的执行器：同一个上游地址复用同一个 Client（连接池与熔断器都在这里）。
type Client struct {
	p     Policy
	hc    *http.Client
	br    breaker
	now   func() time.Time
	sleep func(context.Context, time.Duration) error
	logf  func(string, ...any)

	attempts   int64
	failures   int64
	rejected   int64
	opened     int64
	lastReason string
}

// New 建一个执行器。
func New(p Policy) *Client {
	np := p.normalized()
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.DialContext = (&net.Dialer{Timeout: np.DialTimeout, KeepAlive: 30 * time.Second}).DialContext
	tr.TLSHandshakeTimeout = np.TLSHandshakeTimeout
	tr.ResponseHeaderTimeout = np.HeaderTimeout
	tr.MaxIdleConnsPerHost = 8
	tr.IdleConnTimeout = 60 * time.Second
	return &Client{
		p:     np,
		hc:    &http.Client{Transport: tr},
		now:   time.Now,
		sleep: sleepCtx,
		logf:  log.Printf,
	}
}

// Name 是上游名。
func (c *Client) Name() string { return c.p.Name }

// Policy 返回收敛之后的策略（启动日志用：让"实际生效的阈值"可被运维看见）。
func (c *Client) Policy() Policy { return c.p }

// SetLogger 换日志出口（测试用）。
func (c *Client) SetLogger(f func(string, ...any)) {
	if f != nil {
		c.logf = f
	}
}

// SetClock / SetSleeper 只给测试用：验证退避与熔断窗口不该靠真等时间。
func (c *Client) SetClock(now func() time.Time) {
	if now != nil {
		c.now = now
	}
}

func (c *Client) SetSleeper(sleep func(context.Context, time.Duration) error) {
	if sleep != nil {
		c.sleep = sleep
	}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Do 执行请求并返回**尚未读取**的响应；成功时调用方必须关闭 Body（关闭同时释放超时上下文）。
// 失败返回 *Error（Code() == CodeUpstreamUnavailable）；父 ctx 被取消时原样返回 ctx.Err()。
func (c *Client) Do(ctx context.Context, r Request) (*http.Response, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	maxAttempts := c.p.Attempts
	if !c.p.Idempotent {
		// 防御性收敛：非幂等请求不重试（宁可慢一次，也不要重复副作用）。
		maxAttempts = 1
	}
	if !c.br.allow(c.now(), c.p) {
		c.rejected++
		c.note(ReasonCircuitOpen)
		return nil, &Error{Upstream: c.p.Name, Reason: ReasonCircuitOpen}
	}

	overall, cancelOverall := context.WithTimeout(ctx, c.p.Budget)
	var (
		lastErr    error
		attempted  int
		retryDelay time.Duration
	)
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if attempt > 1 {
			delay := retryDelay
			if delay <= 0 {
				delay = c.backoff(attempt)
			}
			retryDelay = 0
			if err := c.sleep(overall, delay); err != nil {
				lastErr = &Error{Upstream: c.p.Name, Reason: ReasonBudget, Attempts: attempted, Cause: err}
				break
			}
		}
		attempted++
		c.attempts++
		resp, err, retryAfter := c.attempt(overall, r)
		if err == nil {
			c.br.success()
			// 总预算的上下文与响应体同生命周期：Do 里不能 cancel（调用方还要读体），
			// 也不能不 cancel（会漏定时器并让预算形同虚设）。单次尝试的上下文在 attempt 内已绑好。
			resp.Body = &bodyCloser{ReadCloser: resp.Body, cancel: cancelOverall}
			return resp, nil
		}
		// 父 ctx 取消：不是上游故障——既不进熔断计数（否则用户关页面会把上游"熔断"掉），
		// 也不包装成 upstream_unavailable（那会把"客户端走了"记成"上游挂了"）。
		if ctx.Err() != nil {
			cancelOverall()
			return nil, ctx.Err()
		}
		lastErr = err
		if !retryable(err) || attempt == maxAttempts {
			break
		}
		retryDelay = retryAfter
	}

	cancelOverall()
	c.failures++
	reason := reasonOf(lastErr)
	c.note(reason)
	if c.br.failure(c.now(), c.p) {
		c.opened++
		c.logf("upstream %s: 熔断打开（连续 %d 次调用失败，最后原因 %s）；%s 内直接快速失败，之后放一个半开探测",
			c.p.Name, c.p.BreakerThreshold, reason, c.p.BreakerOpenFor)
	}
	if ue, ok := lastErr.(*Error); ok {
		ue.Attempts = attempted
		return nil, ue
	}
	return nil, &Error{Upstream: c.p.Name, Reason: reason, Attempts: attempted, Cause: lastErr}
}

// attempt 打一次上游。成功返回响应（尚未读体）；失败返回错误，以及"这次 429 给出的退避提示"。
func (c *Client) attempt(overall context.Context, r Request) (*http.Response, error, time.Duration) {
	actx, cancelAttempt := context.WithTimeout(overall, c.p.AttemptTimeout)
	var body io.Reader
	if len(r.Body) > 0 {
		// 每次尝试都重建 reader：重试必须重放同一个请求体。
		body = bytes.NewReader(r.Body)
	}
	req, err := http.NewRequestWithContext(actx, r.Method, r.URL, body)
	if err != nil {
		cancelAttempt()
		return nil, &Error{Upstream: c.p.Name, Reason: ReasonBadResponse, Cause: err}, 0
	}
	for k, vs := range r.Header {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		cancelAttempt()
		return nil, &Error{Upstream: c.p.Name, Reason: classify(err), Cause: err}, 0
	}
	if !retryableStatus(resp.StatusCode) {
		// 2xx/3xx/4xx 是上游的明确回答：连单次尝试的上下文一起交给调用方（读到 Close 为止）。
		resp.Body = &bodyCloser{ReadCloser: resp.Body, cancel: cancelAttempt}
		return resp, nil, 0
	}
	reason := statusReason(resp.StatusCode)
	after := retryAfterDelay(resp, c.p)
	drainAndClose(resp)
	cancelAttempt()
	return nil, &Error{Upstream: c.p.Name, Reason: reason, Status: resp.StatusCode}, after
}

// Probe 深探一次上游（/ready?deep=1 用）：单次尝试、不重试，结果同时喂给熔断器。
// 熔断打开时探测仍然真实发出——否则永远等不到恢复，探针只会复述熔断状态。
func (c *Client) Probe(ctx context.Context, url string) (res ProbeResult) {
	res = ProbeResult{Name: c.p.Name, Breaker: c.br.current().String()}
	defer func() { res.Breaker = c.br.current().String() }()

	ctx, cancel := context.WithTimeout(ctx, c.p.ProbeTimeout)
	defer cancel()
	started := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		res.Status = ProbeUnavailable
		res.Reason = ReasonBadResponse
		return res
	}
	resp, err := c.hc.Do(req)
	res.LatencyMS = time.Since(started).Milliseconds()
	if err != nil {
		res.Status = ProbeUnavailable
		res.Reason = classify(err)
		c.rejectFromProbe(res.Reason)
		return res
	}
	defer resp.Body.Close()
	_, _ = io.CopyN(io.Discard, resp.Body, 4<<10)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		res.Status = ProbeReady
		c.br.success()
		return res
	}
	res.Status = ProbeUnavailable
	res.Reason = statusReason(resp.StatusCode)
	c.rejectFromProbe(res.Reason)
	return res
}

// rejectFromProbe 把探针失败计入熔断统计：探针不是旁路，它也要能把熔断器打开（或证实恢复）。
func (c *Client) rejectFromProbe(reason string) {
	c.failures++
	c.note(reason)
	if c.br.failure(c.now(), c.p) {
		c.opened++
		c.logf("upstream %s: 深探针失败（%s），熔断打开", c.p.Name, reason)
	}
}

// Stats 是执行器的运行计数快照。
type Stats struct {
	Upstream   string `json:"upstream"`
	State      string `json:"breaker"`
	Attempts   int64  `json:"attempts"`
	Failures   int64  `json:"failures"`
	Rejected   int64  `json:"rejected"`
	Opened     int64  `json:"opened"`
	LastReason string `json:"last_reason,omitempty"`
}

// Stats 返回运行计数（深探针与日志用：让"重试了几次、熔断开了几次"可见）。
func (c *Client) Stats() Stats {
	return Stats{
		Upstream:   c.p.Name,
		State:      c.br.current().String(),
		Attempts:   c.attempts,
		Failures:   c.failures,
		Rejected:   c.rejected,
		Opened:     c.opened,
		LastReason: c.lastReason,
	}
}

// ProbeResult 是深探针的一行结果（/ready?deep=1 的响应体元素）。
type ProbeResult struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	Breaker   string `json:"breaker"`
	Reason    string `json:"reason,omitempty"`
	LatencyMS int64  `json:"latency_ms"`
}

// ProbeTarget 是一个深探目标：客户端 + 探测地址（通常是上游的 /ready）。
type ProbeTarget struct {
	Client *Client
	URL    string
}

// ProbeAll 并发探测多个上游，总时长受 budget 约束：深探针不能被单个上游拖成慢探针。
// 未配置地址的目标记为 not_configured（那是部署态，不是故障）。
func ProbeAll(ctx context.Context, budget time.Duration, targets []ProbeTarget) []ProbeResult {
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	out := make([]ProbeResult, len(targets))
	var wg sync.WaitGroup
	for i, t := range targets {
		if t.Client == nil || t.URL == "" {
			name := "unconfigured"
			if t.Client != nil {
				name = t.Client.Name()
			}
			out[i] = ProbeResult{Name: name, Status: ProbeUnavailable, Breaker: "closed", Reason: ReasonNotConfigured}
			continue
		}
		wg.Add(1)
		go func(i int, t ProbeTarget) {
			defer wg.Done()
			out[i] = t.Client.Probe(ctx, t.URL)
		}(i, t)
	}
	wg.Wait()
	return out
}

func (c *Client) note(reason string) { c.lastReason = reason }

func (c *Client) backoff(attempt int) time.Duration {
	d := c.p.maxBackoffFor(attempt)
	if d <= 0 || c.p.Jitter <= 0 {
		return d
	}
	j := c.p.Jitter
	return time.Duration(float64(d) * (1 - j + rand.Float64()*2*j))
}

func retryable(err error) bool {
	var ue *Error
	if !errors.As(err, &ue) {
		return false
	}
	switch ue.Reason {
	case ReasonCircuitOpen, ReasonCancelled, ReasonBadResponse:
		return false
	default:
		return true
	}
}

func retryableStatus(code int) bool {
	return code == http.StatusTooManyRequests || code >= 500
}

func statusReason(code int) string { return "status_" + strconv.Itoa(code) }

// retryAfterDelay 只在提示值不超过 MaxBackoff 时采纳：更大的提示说明上游要的是分钟级退避，
// 那不是"再试一次"能解决的，直接失败让熔断快速打开更诚实。
func retryAfterDelay(resp *http.Response, p Policy) time.Duration {
	raw := strings.TrimSpace(resp.Header.Get("Retry-After"))
	if raw == "" {
		return 0
	}
	secs, err := strconv.Atoi(raw)
	if err != nil || secs <= 0 {
		return 0
	}
	d := time.Duration(secs) * time.Second
	if d > p.MaxBackoff {
		return 0
	}
	return d
}

func classify(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return ReasonCancelled
	case errors.Is(err, context.DeadlineExceeded):
		return ReasonTimeout
	}
	var nerr net.Error
	if errors.As(err, &nerr) && nerr.Timeout() {
		return ReasonTimeout
	}
	var oe *net.OpError
	if errors.As(err, &oe) {
		return ReasonConnection
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return ReasonBadResponse
	}
	return ReasonConnection
}

func reasonOf(err error) string {
	var ue *Error
	if errors.As(err, &ue) {
		return ue.Reason
	}
	return classify(err)
}

func drainAndClose(resp *http.Response) {
	if resp == nil || resp.Body == nil {
		return
	}
	_, _ = io.CopyN(io.Discard, resp.Body, 4<<10)
	_ = resp.Body.Close()
}

// bodyCloser 让"这次调用的超时上下文"跟随响应体的生命周期。
type bodyCloser struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b *bodyCloser) Close() error {
	err := b.ReadCloser.Close()
	b.cancel()
	return err
}
