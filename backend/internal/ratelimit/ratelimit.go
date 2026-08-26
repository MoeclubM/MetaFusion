package ratelimit

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type bucket struct {
	count     int
	resetAt   time.Time
}

type Limiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	anonymousLimit int
	authLimit      int
	window         time.Duration
}

func New(anonPerMin, authPerMin int) *Limiter {
	return &Limiter{
		buckets:        make(map[string]*bucket),
		anonymousLimit: anonPerMin,
		authLimit:      authPerMin,
		window:         time.Minute,
	}
}

func (l *Limiter) key(c *gin.Context) (string, bool) {
	if uid, exists := c.Get("userID"); exists {
		if id, ok := uid.(uuid.UUID); ok {
			return "user:" + id.String(), true
		}
	}
	// also check PAT token prefix as key safely
	if v := c.GetHeader("X-API-Key"); v != "" {
		keyPrefix := v
		if len(keyPrefix) > 8 {
			keyPrefix = keyPrefix[:8]
		}
		return "ip:" + c.ClientIP() + ":key:" + keyPrefix, false
	}
	return "ip:" + c.ClientIP(), false
}

// NewEndpointLimiter 创建针对特定高敏端点的专用限流器（如登录/注册防撞库）
func NewEndpointLimiter(maxRequests int, window time.Duration) gin.HandlerFunc {
	type epBucket struct {
		count   int
		resetAt time.Time
	}
	var mu sync.Mutex
	buckets := make(map[string]*epBucket)

	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()

		mu.Lock()
		b, ok := buckets[ip]
		if !ok || now.After(b.resetAt) {
			b = &epBucket{count: 0, resetAt: now.Add(window)}
			buckets[ip] = b
		}
		b.count++
		count := b.count
		reset := b.resetAt

		// 惰性垃圾回收
		if len(buckets) > 1000 {
			for k, v := range buckets {
				if now.After(v.resetAt) {
					delete(buckets, k)
				}
			}
		}
		mu.Unlock()

		if count > maxRequests {
			c.Header("Retry-After", itoa(int(time.Until(reset).Seconds())))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "too many attempts, please try again later",
				"code":  "TOO_MANY_REQUESTS",
			})
			return
		}
		c.Next()
	}
}

func (l *Limiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		k, isAuth := l.key(c)
		limit := l.anonymousLimit
		if isAuth {
			limit = l.authLimit
		}
		// allow larger burst for authenticated edit routes
		if c.Request.Method != "GET" && isAuth {
			// keep same limit but could differentiate
		}

		l.mu.Lock()
		b, ok := l.buckets[k]
		now := time.Now()
		if !ok || now.After(b.resetAt) {
			b = &bucket{count: 0, resetAt: now.Add(l.window)}
			l.buckets[k] = b
		}
		b.count++
		count := b.count
		reset := b.resetAt
		l.mu.Unlock()

		remaining := limit - count
		if remaining < 0 {
			remaining = 0
		}
		c.Header("X-RateLimit-Limit", itoa(limit))
		c.Header("X-RateLimit-Remaining", itoa(remaining))
		c.Header("X-RateLimit-Reset", itoa(int(time.Until(reset).Seconds())))
		c.Header("Retry-After", itoa(int(time.Until(reset).Seconds())))

		if count > limit {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "rate limit exceeded, retry after " + itoa(int(time.Until(reset).Seconds())) + "s",
				"code":  "RATE_LIMITED",
			})
			return
		}
		c.Next()

		// lazy cleanup every 100 requests - simple scan of expired buckets
		if count%100 == 0 {
			go l.cleanup()
		}
	}
}

func (l *Limiter) cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for k, b := range l.buckets {
		if now.After(b.resetAt.Add(5 * time.Minute)) {
			delete(l.buckets, k)
		}
	}
}

func itoa(n int) string {
	// fast small int to string without fmt
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	buf := [20]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

// UserAgentMiddleware enforces MusicBrainz-style identification: require User-Agent or X-API-Key
// Anonymous requests without meaningful User-Agent are rejected with 400.
// Authenticated (JWT/PAT) requests are exempt from strict UA check but still recommended.
func UserAgentMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Allow health and openapi without UA
		if c.Request.URL.Path == "/health" || c.Request.URL.Path == "/healthz" || c.Request.URL.Path == "/ready" || c.Request.URL.Path == "/live" || c.Request.URL.Path == "/livez" || c.Request.URL.Path == "/api/v1/health" || c.Request.URL.Path == "/api/health" || c.Request.URL.Path == "/api/v1/openapi.json" {
			c.Next()
			return
		}
		// If authenticated, skip strict check
		if _, exists := c.Get("userID"); exists {
			c.Next()
			return
		}
		// Check for PAT via header presence -> considered authenticated, skip
		auth := c.GetHeader("Authorization")
		if len(auth) > 4 && (contains(auth, "mfp_")) {
			c.Next()
			return
		}
		if v := c.GetHeader("X-API-Key"); v != "" {
			c.Next()
			return
		}
		ua := c.GetHeader("User-Agent")
		if ua == "" || ua == "-" || len(ua) < 8 {
			// For GET anonymous, we still allow but set warning header; for write, block.
			if c.Request.Method != "GET" && c.Request.Method != "HEAD" && c.Request.Method != "OPTIONS" {
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
					"error": "User-Agent required. Please set a meaningful User-Agent identifying your application, e.g. 'MyApp/1.0 ( contact@example.com )'. See /developers for details.",
					"code":  "USER_AGENT_REQUIRED",
				})
				return
			}
			c.Header("X-Warning", "Missing User-Agent; please set a meaningful User-Agent for API identification")
		}
		c.Next()
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i <= len(s)-len(sub); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}
