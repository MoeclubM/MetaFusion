package catalog

// PAT（个人访问令牌）的**消费侧**：把 `Authorization: Bearer mfp_...` 交给账号服务的内省端点
// （POST /api/auth/tokens/introspect）判定，目录侧不读 auth 库、不签发、不落盘任何凭据。
//
// 三处必须同改（同一份契约、同一套降级语义；只改一处会让同一个 PAT 在三个服务上有三种行为）：
//   - backend/internal/catalog/pat.go（本文件，目录）
//   - metafusion-community/internal/auth/pat.go（互动）
//   - metafusion-storage/internal/auth/pat.go（存储）
// 前缀、缓存时长、机器码、单飞与逐出策略、401/503 的分工都在这三处保持一致。
//
// 口径（与账号服务、前端文案逐字对齐）：
//   - 有效权限 = 用户自身权限 ∩ PAT 的 scopes，**由账号服务在内省响应里算好**（permissions 字段）；
//     本侧像读 JWT claims 一样只读它，授权判定仍走 User.Can，不写第二套权限逻辑。
//   - 内省结果按明文 sha256 进程内缓存 60 秒，因此**吊销/过期最长 60 秒后才在下游生效**——
//     UI 提示与文档都按这个口径写，不要宣称"立即失效"。
//   - 无效 / 已吊销 / 已过期统一 401 invalid_token（不细分原因，细分会变成枚举探测口）；
//     账号服务不可达（含未配置 AUTH_URL）一律 503 auth_unavailable——回 401 会让 bot/CI
//     以为凭据有问题去换令牌，而实际是下游依赖故障，重试才是对的。
//   - 状态码映射的边界（别按字面"非 200 一律不认"改回去）：只有 401 / 403 是账号服务对**令牌本身**
//     的判定，映射为 401 invalid_token；503（账号服务读不动库）、404（内省端点还没上线，滚动部署期）、
//     429（内省限流）与 5xx / 网络超时都**不是**"令牌无效"的证据，一律映射为 503 auth_unavailable——
//     照字面把它们也回 401，会让 bot/CI 把有效令牌当废令牌丢掉（换令牌解决不了这些故障，重试才行）。
//     两种映射都满足 fail-closed（都不放行），这里刻意选更诚实的那个。
//   - 明文与哈希都不进日志、不进错误信息；缓存键是哈希，值里不含明文。

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// PATPrefix 是个人访问令牌的明文前缀（四语字典与文档早已按 mfp_ 承诺，沿用它）。
	PATPrefix = "mfp_"
	// PATCacheTTL 是内省结果的进程内缓存时长：它同时就是**吊销窗口**（最长 60 秒）。
	PATCacheTTL = 60 * time.Second
	// PATCacheMax 是缓存条目上限：任何人都能构造带 mfp_ 前缀的字符串来喂缓存，
	// 没有上限就是一个内存放大器；满了先清过期、再按插入序逐出最旧的一条。
	PATCacheMax = 4096
	// PATIntrospectTimeout 是单次内省调用的超时（含建连）：内省在请求路径上，不能拖长。
	PATIntrospectTimeout = 3 * time.Second
	// patIntrospectPath 是账号服务的内省端点：请求体 {"token": "<明文>"}，不需要其它凭据。
	patIntrospectPath = "/api/auth/tokens/introspect"
	// patBodyLen 是前缀之后主体的长度：账号服务侧最终形状是 `^mfp_[0-9A-Za-z]{43}$`
	// （mfp_ + 43 位 base62 = 47 字符，token_prefix 取明文前 12 字符）。
	// 形态不符的直接在本地拒，不打账号服务；"这个令牌是否有效"仍由账号服务判定。
	patBodyLen = 43
	// patResponseLimit 是内省响应体的读取上限：响应是固定小对象，读不完即视为异常。
	patResponseLimit = 64 << 10
)

// 机器码：PAT 路径上的错误体只回这两个（stable machine code），前端与 bot 都按它们分支。
const (
	// CodeInvalidToken 401：无效、已吊销或已过期（三者共用一个码，不区分原因）。
	CodeInvalidToken = "invalid_token"
	// CodeAuthUnavailable 503：账号服务不可达，或本服务没有配置 AUTH_URL。
	CodeAuthUnavailable = "auth_unavailable"
)

// errPATUnavailable 是内省不可用的哨兵错误（网络故障、超时、非预期状态码、未配置）。
var errPATUnavailable = errors.New(CodeAuthUnavailable)

// IsPAT 报告 Authorization 里的令牌是不是 PAT：只看前缀，形态校验在 validPATShape。
func IsPAT(token string) bool { return strings.HasPrefix(token, PATPrefix) }

// validPATShape 是本地预检：前缀 + base62 字符集 + 长度窗口。明显非法的直接拒，
// 不打账号服务（伪造前缀刷内省是免费的打点方式，本地拦掉最省事）。
func validPATShape(token string) bool {
	body, ok := strings.CutPrefix(token, PATPrefix)
	if !ok || len(body) != patBodyLen {
		return false
	}
	for i := 0; i < len(body); i++ {
		b := body[i]
		if (b >= '0' && b <= '9') || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') {
			continue
		}
		return false
	}
	return true
}

// patHash 是缓存键：与账号服务 token_hash 用同一种算法（sha256 hex），
// 但本侧只用它做进程内键，不落盘、不进日志。
func patHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// patIdentity 是内省拿到的身份。Permissions 已经是"用户权限 ∩ scopes"的结果。
type patIdentity struct {
	UserID      string
	Username    string
	Role        string
	Permissions []string
	// ExpiresAt 是令牌自身的过期时刻；零值表示永不过期。
	ExpiresAt time.Time
}

// catalogUser 按与 JWT 相同的形状产出身份：下游一律走 User.Can，不需要为 PAT 另写权限逻辑。
// FromPAT 是给 Can 的护栏：PAT 的权限就是内省返回的那一列（可能为空），永不回落到角色兜底。
func (p patIdentity) catalogUser() *User {
	return &User{
		ID: p.UserID, Username: p.Username, Role: p.Role,
		Permissions: p.Permissions, FromPAT: true,
	}
}

// PATIntrospector 是内省端点的客户端：60 秒进程内缓存 + 同键单飞 + 上限逐出。
type PATIntrospector struct {
	baseURL string
	client  *http.Client
	now     func() time.Time
	cache   *patCache
}

// NewPATIntrospector 用账号服务基址建内省器；baseURL 为空时内省器存在但一律判为不可用
// （调用方据此回 503，而不是把没配置当成"凭据错"）。
func NewPATIntrospector(baseURL string) *PATIntrospector {
	return newPATIntrospector(baseURL, nil)
}

// newPATIntrospector 允许注入时钟：测试要验证 60 秒窗口与缓存过期，等真时间不可行。
func newPATIntrospector(baseURL string, now func() time.Time) *PATIntrospector {
	if now == nil {
		now = time.Now
	}
	return &PATIntrospector{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		client:  &http.Client{Timeout: PATIntrospectTimeout},
		now:     now,
		cache:   newPATCache(now),
	}
}

// Enabled 报告内省端点是否可用（AUTH_URL 是否配置）。
func (p *PATIntrospector) Enabled() bool { return p != nil && p.baseURL != "" }

// Introspect 判定一个 PAT 明文。
//
// 返回 (identity, nil) 表示有效；(nil, nil) 表示**明确无效**（形态非法，或账号服务说 valid=false）；
// (nil, err) 表示判不了（网络故障/超时/非预期状态码/未配置）——调用方按 503 auth_unavailable 回。
func (p *PATIntrospector) Introspect(ctx context.Context, token string) (*patIdentity, error) {
	if !validPATShape(token) {
		// 本地预检失败：这不是"问不到"，是"明显不是 PAT"，直接判否，不打账号服务。
		return nil, nil
	}
	if !p.Enabled() {
		return nil, errPATUnavailable
	}
	entry, err := p.cache.resolve(patHash(token), func() (patCacheEntry, error) {
		return p.fetch(ctx, token)
	})
	if err != nil {
		return nil, err
	}
	return entry.identity, nil
}

// patIntrospectResponse 是账号服务的响应体。expires_at 允许 null（永不过期）。
type patIntrospectResponse struct {
	Valid       bool          `json:"valid"`
	UserID      string        `json:"user_id"`
	Username    string        `json:"username"`
	Role        string        `json:"role"`
	Permissions []string      `json:"permissions"`
	ExpiresAt   *patTimestamp `json:"expires_at"`
}

// patTimestamp 容忍三种写法：null / RFC3339（Go 与 JS 的默认）/ Unix 秒。
// 跨服务契约里只有 expires_at 是时间，格式分歧最容易在这里静默炸掉整条链路。
type patTimestamp struct{ time.Time }

func (t *patTimestamp) UnmarshalJSON(raw []byte) error {
	s := strings.TrimSpace(string(raw))
	if s == "null" || s == `""` || s == "0" {
		return nil
	}
	if unquoted, err := strconv.Unquote(s); err == nil {
		s = unquoted
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05Z07:00"} {
		if ts, err := time.Parse(layout, s); err == nil {
			t.Time = ts
			return nil
		}
	}
	if secs, err := strconv.ParseInt(s, 10, 64); err == nil {
		t.Time = time.Unix(secs, 0).UTC()
		return nil
	}
	return fmt.Errorf("unsupported expires_at %q", s)
}

// fetch 真正调用内省端点。只有"确定结论"（有效 / 明确无效）会落到缓存；
// 网络故障与 5xx 一律返回错误而不缓存，账号服务恢复后下一个请求立刻能成功。
func (p *PATIntrospector) fetch(ctx context.Context, token string) (patCacheEntry, error) {
	payload, err := json.Marshal(struct {
		Token string `json:"token"`
	}{Token: token})
	if err != nil {
		return patCacheEntry{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+patIntrospectPath, bytes.NewReader(payload))
	if err != nil {
		return patCacheEntry{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		// 错误文本只带端点与网络原因：明文与哈希都不进来（这条错误可能被上层记录）。
		return patCacheEntry{}, fmt.Errorf("pat introspect request failed: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusUnauthorized, http.StatusForbidden:
		// 账号服务的判定结论：无效 / 已吊销 / 已过期 / 封禁统一 401 invalid_token，
		// 这是可缓存的确定结论（同一个令牌 60 秒内不必再问一次）。
		return patCacheEntry{cachedUntil: p.now().Add(PATCacheTTL)}, nil
	case http.StatusServiceUnavailable:
		// 账号服务"读不动库"的专用码：按依赖不可用回 503，绝不当成"令牌无效"。
		return patCacheEntry{}, fmt.Errorf("pat introspect unavailable (%d)", resp.StatusCode)
	default:
		// 其余非 200（404 = 账号服务还没上这个端点/部署顺序不对，429 = 内省限流，5xx = 服务异常）
		// 统统按依赖不可用回 503：它们都不是"令牌无效"的证据，回 401 会让 bot/CI
		// 把有效令牌当废令牌丢掉（换令牌解决不了这些故障，重试才行）。
		return patCacheEntry{}, fmt.Errorf("pat introspect status %d", resp.StatusCode)
	}
	var doc patIntrospectResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, patResponseLimit)).Decode(&doc); err != nil {
		return patCacheEntry{}, fmt.Errorf("pat introspect malformed response: %w", err)
	}
	if !doc.Valid {
		return patCacheEntry{cachedUntil: p.now().Add(PATCacheTTL)}, nil
	}
	if strings.TrimSpace(doc.UserID) == "" {
		// valid=true 却没有 user_id 是契约违约：身份无法成形，按依赖异常处理而不是放行。
		return patCacheEntry{}, errors.New("pat introspect returned valid without user_id")
	}
	ident := &patIdentity{
		UserID:      doc.UserID,
		Username:    doc.Username,
		Role:        doc.Role,
		Permissions: doc.Permissions,
	}
	if doc.ExpiresAt != nil {
		ident.ExpiresAt = doc.ExpiresAt.Time
	}
	until := p.now().Add(PATCacheTTL)
	// 令牌自身过期更早时以它为准：缓存是"已经验过的结论"，不该把有效期往后拖。
	if !ident.ExpiresAt.IsZero() && ident.ExpiresAt.Before(until) {
		until = ident.ExpiresAt
	}
	return patCacheEntry{identity: ident, cachedUntil: until}, nil
}

// patCacheEntry 是缓存值：identity 为 nil 表示账号服务**明确判定无效**（同样是确定结论）。
type patCacheEntry struct {
	identity    *patIdentity
	cachedUntil time.Time
}

// patCall 是一次在飞的内省：跟随者等它关闭后回缓存取结果，因此同键并发只打账号服务一次。
type patCall struct{ done chan struct{} }

// patCache 是进程内缓存：有界（PATCacheMax）+ 先清过期再按插入序逐出。
// 不做 LRU：PAT 请求量小，谁热谁冷不重要，重要的是内存有上限、结论有期限。
type patCache struct {
	mu       sync.Mutex
	entries  map[string]patCacheEntry
	order    []string
	inflight map[string]*patCall
	now      func() time.Time

	hits      int
	misses    int
	evictions int
}

func newPATCache(now func() time.Time) *patCache {
	if now == nil {
		now = time.Now
	}
	return &patCache{
		entries:  map[string]patCacheEntry{},
		inflight: map[string]*patCall{},
		now:      now,
	}
}

// resolve 走完整的"缓存 → 单飞 → 真调用"流程：fn 只在缓存未命中且没有同键在飞时被调用。
//
// 等待上限是 PATIntrospectTimeout + 1s：账号服务抖动时不能让请求无限排队等着别人的调用，
// 超时即按不可用返回（调用方回 503），而不是挂住连接。
func (c *patCache) resolve(key string, fn func() (patCacheEntry, error)) (patCacheEntry, error) {
	deadline := c.now().Add(PATIntrospectTimeout + time.Second)
	for {
		c.mu.Lock()
		if entry, ok := c.entries[key]; ok {
			if c.now().Before(entry.cachedUntil) {
				c.hits++
				c.mu.Unlock()
				return entry, nil
			}
			c.deleteLocked(key)
		}
		if call, ok := c.inflight[key]; ok {
			c.mu.Unlock()
			if !c.now().Before(deadline) {
				return patCacheEntry{}, errPATUnavailable
			}
			<-call.done
			// 被唤醒后回到循环顶部重取缓存：领飞者要么写了结论，要么返回了错误。
			continue
		}
		call := &patCall{done: make(chan struct{})}
		c.inflight[key] = call
		c.misses++
		c.mu.Unlock()
		return c.lead(key, call, fn)
	}
}

// lead 是本进程内该键的唯一调用者：返回后（含 panic 路径）必须唤醒跟随者。
func (c *patCache) lead(key string, call *patCall, fn func() (patCacheEntry, error)) (entry patCacheEntry, err error) {
	finished := false
	defer func() {
		c.mu.Lock()
		delete(c.inflight, key)
		if finished && err == nil {
			// 确定性结论才落缓存；错误不落，账号服务恢复后立刻恢复。
			c.storeLocked(key, entry)
		}
		c.mu.Unlock()
		close(call.done)
	}()
	entry, err = fn()
	finished = true
	return entry, err
}

func (c *patCache) storeLocked(key string, entry patCacheEntry) {
	if _, exists := c.entries[key]; !exists {
		if len(c.entries) >= PATCacheMax {
			c.evictLocked()
		}
		c.order = append(c.order, key)
	}
	c.entries[key] = entry
}

// evictLocked 先清过期项，仍满则按插入序逐出最旧的一条（调用方已持锁）。
func (c *patCache) evictLocked() {
	kept := c.order[:0]
	for _, k := range c.order {
		entry, ok := c.entries[k]
		if !ok {
			continue
		}
		if !c.now().Before(entry.cachedUntil) {
			delete(c.entries, k)
			c.evictions++
			continue
		}
		kept = append(kept, k)
	}
	c.order = kept
	for len(c.entries) >= PATCacheMax && len(c.order) > 0 {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.entries, oldest)
		c.evictions++
	}
}

func (c *patCache) deleteLocked(key string) {
	delete(c.entries, key)
}

// stats 只给本包测试与排障用：命中/未命中/逐出条数。
func (c *patCache) stats() (hits, misses, evictions, size int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.hits, c.misses, c.evictions, len(c.entries)
}
