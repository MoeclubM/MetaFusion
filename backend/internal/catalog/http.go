package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type HTTP struct{ Store *Store }

func respond(c *gin.Context, v any, err error) {
	if err == nil {
		c.JSON(200, v)
		return
	}
	status := 400
	code := err.Error()
	var pg *pq.Error
	if errors.Is(err, sql.ErrNoRows) {
		status = 404
		code = "not_found"
	} else if errors.As(err, &pg) {
		switch pg.Code {
		case "23503", "23514", "23505":
			code = "constraint_violation"
		case "22P02":
			code = "invalid_id"
		default:
			status = 500
			code = "database_error"
		}
	} else if code == "forbidden" {
		status = 403
	} else if code == "invalid_credentials" {
		status = 401
	} else if code == "version_conflict" {
		status = 409
	}
	// 错误响应统一为单一 error 字段（值为稳定机器码）；database_error 只透出固定码，
	// 不附带 SQL 原文。
	c.JSON(status, gin.H{"error": code})
}
func body(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		c.JSON(400, gin.H{"error": "invalid_payload"})
		return false
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		c.JSON(400, gin.H{"error": "invalid_payload"})
		return false
	}
	return true
}
func user(c *gin.Context) *User {
	v, ok := c.Get("catalog_user")
	if !ok {
		return nil
	}
	return v.(*User)
}
func required(admin bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		u := user(c)
		if u == nil {
			c.AbortWithStatusJSON(401, gin.H{"error": "authentication_required"})
			return
		}
		if admin && u.Role != "admin" {
			c.AbortWithStatusJSON(403, gin.H{"error": "forbidden"})
			return
		}
		c.Next()
	}
}

// routeBucket 复用 setup/login 限流风格的内存固定窗口计数, key 为 IP+路由。
type routeBucket struct {
	mu       sync.Mutex
	start    time.Time
	n        int
	lastSeen time.Time
}

var (
	routeAttempts      sync.Map // string -> *routeBucket
	routeJanitor       sync.Once
	loginAttempts      sync.Map // string(IP) -> *routeBucket, setup/login 限流
	loginAttemptsJanit sync.Once
)

// sweepStaleBuckets 每小时清理超 2 小时未见的限流桶，防止 sync.Map 无限增长。
// 进程内存限流本就只防单机突发，多实例一致性放三期（Redis）。
func sweepStaleBuckets(m *sync.Map, janitor *sync.Once) {
	janitor.Do(func() {
		go func() {
			for range time.Tick(time.Hour) {
				cutoff := time.Now().Add(-2 * time.Hour)
				m.Range(func(k, v any) bool {
					if b, ok := v.(*routeBucket); ok {
						b.mu.Lock()
						stale := !b.lastSeen.IsZero() && b.lastSeen.Before(cutoff)
						b.mu.Unlock()
						if stale {
							m.Delete(k)
						}
					}
					return true
				})
			}
		}()
	})
}

// routeLimiter 按 IP+路由限流重型 GET 接口, 超限返回 429 + Retry-After(秒)。
func routeLimiter(perMinute int) gin.HandlerFunc {
	sweepStaleBuckets(&routeAttempts, &routeJanitor)
	return func(c *gin.Context) {
		key := c.ClientIP() + "|" + c.FullPath()
		now := time.Now()
		v, _ := routeAttempts.LoadOrStore(key, &routeBucket{start: now, lastSeen: now})
		b := v.(*routeBucket)
		b.mu.Lock()
		if now.Sub(b.start) > time.Minute {
			b.start = now
			b.n = 0
		}
		b.n++
		b.lastSeen = now
		over := b.n > perMinute
		retrySecs := int(time.Until(b.start.Add(time.Minute)).Seconds()) + 1
		b.mu.Unlock()
		if retrySecs < 1 {
			retrySecs = 1
		}
		if over {
			c.Header("Retry-After", strconv.Itoa(retrySecs))
			c.AbortWithStatusJSON(429, gin.H{"error": "rate_limited"})
			return
		}
		c.Next()
	}
}

// idemEntry 写接口幂等缓存: Idempotency-Key -> 首创返回体, TTL 24h, 进程内存。
// 命中直接返回原结果, 不建重复实体; 分布式/持久化幂等放三期。
type idemEntry struct {
	value any
	exp   time.Time
}

var (
	idemCache   sync.Map // string -> idemEntry
	idemJanitor sync.Once
)

func idemSweep() {
	idemJanitor.Do(func() {
		go func() {
			for range time.Tick(time.Hour) {
				now := time.Now()
				idemCache.Range(func(k, v any) bool {
					if e, ok := v.(idemEntry); ok && now.After(e.exp) {
						idemCache.Delete(k)
					}
					return true
				})
			}
		}()
	})
}

func idemCacheKey(c *gin.Context) (string, bool) {
	key := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if key == "" {
		return "", false
	}
	uid := ""
	if u := user(c); u != nil {
		uid = u.ID
	}
	return c.FullPath() + "|" + uid + "|" + key, true
}

func idemLookup(c *gin.Context) (any, bool) {
	ck, ok := idemCacheKey(c)
	if !ok {
		return nil, false
	}
	if v, ok := idemCache.Load(ck); ok {
		if e, ok := v.(idemEntry); ok && time.Now().Before(e.exp) {
			return e.value, true
		}
		idemCache.Delete(ck)
	}
	return nil, false
}

func idemStore(c *gin.Context, value any) {
	ck, ok := idemCacheKey(c)
	if !ok {
		return
	}
	idemSweep()
	idemCache.Store(ck, idemEntry{value: value, exp: time.Now().Add(24 * time.Hour)})
}
func (h HTTP) Register(r *gin.Engine) {
	h.registerGroup(r.Group("/api"))
}

func (h HTTP) registerGroup(api *gin.RouterGroup) {
	s := h.Store
	api.GET("/openapi.json", func(c *gin.Context) { c.JSON(200, OpenAPI()) })
	api.GET("/docs", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(200, docsHTML)
	})
	api.GET("/swagger", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(200, swaggerHTML)
	})
	api.Use(func(c *gin.Context) {
		// 无状态 RS256 验签优先，失败回退查库：双模式并存。
		// Bearer 与 Cookie 各试一次：前端可能带着刚过期的 Bearer 令牌，
		// 而 HttpOnly Cookie 里是刷新后的新令牌（或反之），不能互相顶掉。
		bearer := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		cookie, _ := c.Cookie("mf_session")
		for _, token := range []string{bearer, cookie} {
			if token == "" {
				continue
			}
			if u, err := s.Authenticate(c.Request.Context(), token); err == nil {
				c.Set("catalog_user", u)
				break
			}
		}
		c.Next()
	})
	setupGetHandler := func(c *gin.Context) {
		needed, err := s.SetupNeeded(c.Request.Context())
		respond(c, gin.H{"needed": needed, "is_initialized": !needed, "has_admin": !needed}, err)
	}
	api.GET("/setup", setupGetHandler)
	type credentials struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	sweepStaleBuckets(&loginAttempts, &loginAttemptsJanit)
	limiter := func(c *gin.Context) {
		key := c.ClientIP()
		now := time.Now()
		v, _ := loginAttempts.LoadOrStore(key, &routeBucket{start: now, lastSeen: now})
		b := v.(*routeBucket)
		b.mu.Lock()
		defer b.mu.Unlock()
		if now.Sub(b.start) > time.Minute {
			b.start = now
			b.n = 0
		}
		b.n++
		b.lastSeen = now
		if b.n > 15 {
			c.AbortWithStatusJSON(429, gin.H{"error": "rate_limited"})
			return
		}
		c.Next()
	}
	api.POST("/setup", limiter, func(c *gin.Context) {
		var in credentials
		if !body(c, &in) {
			return
		}
		u, err := s.CreateUser(c.Request.Context(), in.Username, in.Email, in.Password, true, nil)
		respond(c, u, err)
	})
	api.POST("/auth/login", limiter, func(c *gin.Context) {
		var in credentials
		if !body(c, &in) {
			return
		}
		token, u, err := s.Login(c.Request.Context(), in.Username, in.Password)
		if err == nil {
			c.SetSameSite(http.SameSiteStrictMode)
			c.SetCookie("mf_session", token, 86400, "/", "", c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https", true)
		}
		respond(c, gin.H{"token": token, "access_token": token, "token_type": "Bearer", "expires_in": int(AccessTokenTTL.Seconds()), "user": u}, err)
	})
	// POST /auth/refresh 用当前 Bearer/Cookie 令牌换发新令牌（服务端轮转会话行）。
	// 前端据此在访问令牌临近过期时续期，无需单独的 refresh_token 字段。
	// 与 login 共用 15/min/IP 限流，防止被盗令牌无限续命喷洒。
	api.POST("/auth/refresh", limiter, func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if token == "" {
			token, _ = c.Cookie("mf_session")
		}
		next, u, err := s.Refresh(c.Request.Context(), token)
		if err == nil && next != "" {
			c.SetSameSite(http.SameSiteStrictMode)
			c.SetCookie("mf_session", next, 86400, "/", "", c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https", true)
		}
		respond(c, gin.H{"token": next, "access_token": next, "token_type": "Bearer", "expires_in": int(AccessTokenTTL.Seconds()), "user": u}, err)
	})
	api.GET("/auth/me", required(false), func(c *gin.Context) { respond(c, user(c), nil) })
	api.POST("/auth/logout", required(false), func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if token == "" {
			token, _ = c.Cookie("mf_session")
		}
		// 清 Cookie 的 Secure 必须与登录时一致，否则 HTTPS 下清不掉。
		c.SetCookie("mf_session", "", -1, "/", "", c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https", true)
		respond(c, gin.H{"ok": true}, s.Logout(c.Request.Context(), token))
	})
	// GET /auth/settings 供未登录页面读取实例准入能力。后端目前没有注册、
	// 邀请或邮件验证实现，因此如实返回关闭；这些值是真实能力而非可配置开关，
	// 待实现对应流程后再按实际状态返回。
	api.GET("/auth/settings", func(c *gin.Context) {
		respond(c, gin.H{
			"registration_enabled":       false,
			"invite_required":            false,
			"require_email_verification": false,
			"email_verification_enabled": false,
		}, nil)
	})
	// changePassword 是 PUT /auth/password 与 POST /auth/change-password 的共用
	// 实现：两者语义相同（当前登录用户改自己密码），参数形状均为
	// old_password/new_password，仅复用 Store.ChangePassword，不新增密码逻辑。
	changePassword := func(c *gin.Context) {
		u := user(c)
		if u == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		var in struct {
			OldPassword string `json:"old_password"`
			NewPassword string `json:"new_password"`
		}
		if !body(c, &in) {
			return
		}
		respond(c, gin.H{"ok": true}, s.ChangePassword(c.Request.Context(), u.ID, in.OldPassword, in.NewPassword))
	}
	api.PUT("/auth/password", required(false), changePassword)
	api.POST("/auth/change-password", required(false), changePassword)
	api.POST("/auth/logout-all", required(false), func(c *gin.Context) {
		u := user(c)
		if u == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.SetCookie("mf_session", "", -1, "/", "", c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https", true)
		respond(c, gin.H{"ok": true}, s.LogoutAll(c.Request.Context(), u.ID))
	})
	api.GET("/admin/users", required(true), func(c *gin.Context) {
		users, err := s.ListUsers(c.Request.Context())
		respond(c, gin.H{"items": users}, err)
	})
	api.POST("/admin/users", required(true), func(c *gin.Context) {
		var in credentials
		if !body(c, &in) {
			return
		}
		u, err := s.CreateUser(c.Request.Context(), in.Username, in.Email, in.Password, false, user(c))
		respond(c, u, err)
	})
	api.PUT("/admin/users/:id/role", required(true), func(c *gin.Context) {
		var in struct {
			Role string `json:"role"`
		}
		if !body(c, &in) {
			return
		}
		respond(c, gin.H{"ok": true}, s.UpdateUserRole(c.Request.Context(), c.Param("id"), in.Role, user(c)))
	})
	api.PUT("/admin/users/:id/password", required(true), func(c *gin.Context) {
		var in struct {
			Password string `json:"password"`
		}
		if !body(c, &in) {
			return
		}
		respond(c, gin.H{"ok": true}, s.ResetUserPassword(c.Request.Context(), c.Param("id"), in.Password, user(c)))
	})
	oauth := api.Group("/oauth")
	oauth.GET("/clients", func(c *gin.Context) {
		clients, err := s.ListOAuthClients(c.Request.Context())
		respond(c, gin.H{"clients": clients}, err)
	})
	oauth.GET("/authorize", limiter, func(c *gin.Context) {
		clientID := c.Query("client_id")
		redirectURI := c.Query("redirect_uri")
		responseType := c.Query("response_type")
		state := c.Query("state")
		scope := c.DefaultQuery("scope", "profile")
		if responseType != "code" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported_response_type"})
			return
		}
		client, err := s.GetOAuthClient(c.Request.Context(), clientID)
		if err != nil || client == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_client"})
			return
		}
		validURI := false
		for _, uri := range client.RedirectURIs {
			if uri == redirectURI {
				validURI = true
				break
			}
		}
		if !validURI {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_redirect_uri"})
			return
		}
		u := user(c)
		if u == nil {
			c.Redirect(http.StatusFound, "/account?return_to="+url.QueryEscape(c.Request.RequestURI))
			return
		}
		code, err := s.CreateOAuthCode(c.Request.Context(), clientID, u.ID, redirectURI, scope, c.Query("code_challenge"), c.Query("code_challenge_method"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		sep := "?"
		if strings.Contains(redirectURI, "?") {
			sep = "&"
		}
		target := fmt.Sprintf("%s%scode=%s", redirectURI, sep, url.QueryEscape(code))
		if state != "" {
			target += "&state=" + url.QueryEscape(state)
		}
		c.Redirect(http.StatusFound, target)
	})
	oauth.POST("/token", limiter, func(c *gin.Context) {
		grantType := c.PostForm("grant_type")
		code := c.PostForm("code")
		clientID := c.PostForm("client_id")
		clientSecret := c.PostForm("client_secret")
		redirectURI := c.PostForm("redirect_uri")
		verifier := c.PostForm("code_verifier")
		if grantType == "" {
			var body struct {
				GrantType    string `json:"grant_type"`
				Code         string `json:"code"`
				ClientID     string `json:"client_id"`
				ClientSecret string `json:"client_secret"`
				RedirectURI  string `json:"redirect_uri"`
				Verifier     string `json:"code_verifier"`
			}
			if c.BindJSON(&body) == nil {
				grantType = body.GrantType
				code = body.Code
				clientID = body.ClientID
				clientSecret = body.ClientSecret
				redirectURI = body.RedirectURI
				verifier = body.Verifier
			}
		}
		if grantType != "authorization_code" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported_grant_type"})
			return
		}
		token, u, err := s.ExchangeOAuthCode(c.Request.Context(), clientID, clientSecret, code, redirectURI, verifier)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		ttl := int((30 * 24 * time.Hour).Seconds())
		resp := gin.H{
			"access_token": token,
			"token_type":   "Bearer",
			"expires_in":   ttl,
			"scope":        "profile",
			"user":         u,
		}
		// OIDC：同密钥签发 id_token（aud 指向该客户端），客户端可用 JWKS 本地验签。
		if idToken, exp, ierr := s.IDToken(*u, clientID); ierr == nil && idToken != "" {
			resp["id_token"] = idToken
			resp["id_token_expires_at"] = exp
		}
		c.JSON(http.StatusOK, resp)
	})
	oauth.GET("/userinfo", func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing_token"})
			return
		}
		// 无状态验签优先（RS256 访问令牌），失败回退查库（不透明令牌）。
		u, err := s.Authenticate(c.Request.Context(), token)
		if err != nil || u == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"sub":      u.ID,
			"id":       u.ID,
			"username": u.Username,
			"role":     u.Role,
			"email":    u.Email,
		})
	})
	// OIDC 发现与 JWKS：外部服务可用公钥在本地验签访问令牌/id_token，无需回调本服务。
	// issuer 与 discovery 地址同源（默认 https://findverse.cc/api）。
	api.GET("/.well-known/openid-configuration", func(c *gin.Context) {
		base := strings.TrimSuffix(s.TokenIssuerURL(), "/")
		if base == "" {
			base = strings.TrimSuffix(c.Request.URL.Scheme+c.Request.Host, "/")
		}
		c.JSON(http.StatusOK, gin.H{
			"issuer":                                base,
			"authorization_endpoint":                base + "/oauth/authorize",
			"token_endpoint":                        base + "/oauth/token",
			"userinfo_endpoint":                     base + "/oauth/userinfo",
			"jwks_uri":                              base + "/oidc/jwks",
			"response_types_supported":              []string{"code"},
			"grant_types_supported":                 []string{"authorization_code"},
			"subject_types_supported":               []string{"public"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
			"scopes_supported":                      []string{"profile", "email"},
			"claims_supported":                      []string{"sub", "preferred_username", "email", "role"},
		})
	})
	api.GET("/oidc/jwks", func(c *gin.Context) {
		if s.Tokens == nil {
			c.JSON(http.StatusOK, gin.H{"keys": []any{}})
			return
		}
		c.JSON(http.StatusOK, gin.H{"keys": []any{s.Tokens.PublicJWK()}})
	})
	// 用户收藏：详情页按钮与"我的收藏 / 用户收藏"列表。
	favPage := func(c *gin.Context) (int, int) {
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
		if page < 1 {
			page = 1
		}
		if size < 1 || size > 100 {
			size = 20
		}
		return page, size
	}
	api.POST("/favorites/toggle", required(true), func(c *gin.Context) {
		var in struct {
			TargetType string `json:"target_type"`
			TargetID   string `json:"target_id"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			respond(c, nil, fmt.Errorf("invalid_payload"))
			return
		}
		favorited, err := s.ToggleFavorite(c.Request.Context(), *user(c), in.TargetType, in.TargetID)
		respond(c, gin.H{"favorited": favorited}, err)
	})
	api.GET("/favorites/status", func(c *gin.Context) {
		u := user(c)
		if u == nil {
			respond(c, gin.H{"favorited": []string{}}, nil)
			return
		}
		ids := []string{}
		for _, id := range strings.Split(c.Query("target_ids"), ",") {
			if id = strings.TrimSpace(id); id != "" {
				ids = append(ids, id)
			}
		}
		v, err := s.FavoriteStatus(c.Request.Context(), *u, c.Query("target_type"), ids)
		respond(c, gin.H{"favorited": v}, err)
	})
	api.GET("/favorites/mine", required(true), func(c *gin.Context) {
		u := user(c)
		page, size := favPage(c)
		items, total, err := s.ListFavorites(c.Request.Context(), u.ID, u, c.Query("target_type"), size, (page-1)*size)
		respond(c, gin.H{"items": items, "total": total, "visible": true}, err)
	})
	api.GET("/users/:id/favorites", func(c *gin.Context) {
		page, size := favPage(c)
		items, total, err := s.ListFavorites(c.Request.Context(), c.Param("id"), user(c), c.Query("target_type"), size, (page-1)*size)
		respond(c, gin.H{"items": items, "total": total, "visible": true}, err)
	})
	cat := api.Group("/catalog")
	cat.GET("/definitions", func(c *gin.Context) { v, err := s.Definitions(c.Request.Context()); respond(c, v, err) })
	// 标签聚合：标签不是独立字典表，而是散落在各实体的 attributes.tags 中。
	// jsonb_array_elements_text 展开数组就地统计频次，供前端标签云与筛选建议；
	// 只统计已发布实体（与列表接口的匿名可见性口径一致）。
	cat.GET("/tags", routeLimiter(120), func(c *gin.Context) {
		args := []any{}
		where := []string{"e.status='published'", "jsonb_typeof(e.document->'attributes'->'tags')='array'"}
		if q := strings.TrimSpace(c.Query("q")); q != "" {
			args = append(args, "%"+q+"%")
			where = append(where, fmt.Sprintf("t.name ILIKE $%d", len(args)))
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		if limit <= 0 || limit > 500 {
			limit = 200
		}
		args = append(args, limit)
		rows, err := s.DB.QueryContext(c.Request.Context(), `
		SELECT t.name, count(*) AS n
		FROM catalog.entities e,
		     jsonb_array_elements_text(e.document->'attributes'->'tags') AS t(name)
		WHERE `+strings.Join(where, " AND ")+`
		GROUP BY t.name
		ORDER BY n DESC, t.name
		LIMIT $`+strconv.Itoa(len(args)), args...)
		if err != nil {
			respond(c, gin.H{"items": []any{}, "total": 0}, nil)
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var name string
			var n int
			if err := rows.Scan(&name, &n); err != nil {
				continue
			}
			items = append(items, map[string]any{"name": name, "count": n})
		}
		respond(c, gin.H{"items": items, "total": len(items)}, nil)
	})
	cat.GET("/entities", routeLimiter(120), func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.Query("limit"))
		offset, _ := strconv.Atoi(c.Query("offset"))
		o := ListOptions{Kind: c.Query("kind"), Query: c.Query("q"), Type: c.Query("type"), Status: c.Query("status"), WorkID: c.Query("work_id"), ContentUnitID: c.Query("content_unit_id"), ReleaseID: c.Query("release_id"), MediumID: c.Query("medium_id"), ParentID: c.Query("parent_id"), Field: c.Query("field"), Value: c.Query("value"), Limit: limit, Offset: offset}
		// tags 支持多次出现或逗号分隔，任一命中即返回。
		for _, raw := range c.QueryArray("tags") {
			for _, tag := range strings.Split(raw, ",") {
				if t := strings.TrimSpace(tag); t != "" {
					o.Tags = append(o.Tags, t)
				}
			}
		}
		items, err := s.List(c.Request.Context(), o, user(c))
		if err != nil {
			respond(c, nil, err)
			return
		}
		total, err := s.Count(c.Request.Context(), o, user(c))
		respond(c, gin.H{"items": items, "total": total}, err)
	})
	cat.GET("/entities/:id", func(c *gin.Context) { e, err := s.Get(c.Request.Context(), c.Param("id"), user(c)); respond(c, e, err) })
	cat.GET("/entities/:id/resolve", func(c *gin.Context) {
		e, err := s.Resolve(c.Request.Context(), c.Param("id"), user(c))
		respond(c, e, err)
	})
	cat.POST("/entities", required(false), func(c *gin.Context) {
		// 幂等命中直接返回首创结果, 不建重复实体。
		if cached, ok := idemLookup(c); ok {
			c.JSON(200, cached)
			return
		}
		var in Edit
		if !body(c, &in) {
			return
		}
		if in.Entity.ID != "" {
			c.JSON(400, gin.H{"error": "id_must_be_empty"})
			return
		}
		e, err := s.Save(c.Request.Context(), in, *user(c))
		if err == nil {
			idemStore(c, e)
		}
		respond(c, e, err)
	})
	cat.PUT("/entities/:id", required(false), func(c *gin.Context) {
		var in Edit
		if !body(c, &in) {
			return
		}
		in.Entity.ID = c.Param("id")
		e, err := s.Save(c.Request.Context(), in, *user(c))
		respond(c, e, err)
	})
	cat.POST("/entities/:id/lifecycle", required(true), func(c *gin.Context) {
		var in LifecycleEdit
		if !body(c, &in) {
			return
		}
		e, err := s.Lifecycle(c.Request.Context(), c.Param("id"), in, *user(c))
		respond(c, e, err)
	})
	cat.GET("/entities/:id/revisions", func(c *gin.Context) {
		v, err := s.Revisions(c.Request.Context(), c.Param("id"), user(c))
		respond(c, gin.H{"items": v}, err)
	})
	cat.GET("/entities/:id/relations", func(c *gin.Context) {
		v, err := s.Relations(c.Request.Context(), c.Param("id"), user(c))
		if err != nil {
			respond(c, nil, err)
			return
		}
		// 同一响应内返回关系对端实体（单次批量查询）：真实条目署名可达数百条，
		// 前端逐条 Get 会因截断与限流丢失对端，详情页只能显示原始 UUID。
		respond(c, gin.H{
			"items":    v,
			"entities": h.resolveRelated(c.Request.Context(), c.Param("id"), v, user(c)),
		}, nil)
	})
	cat.GET("/entities/:id/occurrences", func(c *gin.Context) {
		v, err := s.Occurrences(c.Request.Context(), c.Param("id"), user(c))
		respond(c, gin.H{"items": v}, err)
	})
	// 发行详情页批量上屏：一次取多条表达实体 + 自身收录 + 同篇目兄弟收录 + 署名，
	// 替代逐条四类 N+1 请求。用 POST + JSON body 传 ids：300 个 UUID 拼进 GET
	// query 约 11KB，会超过 Nginx 默认 8KB 请求行限制。
	cat.POST("/expressions/details", routeLimiter(120), func(c *gin.Context) {
		var in struct {
			IDs []string `json:"ids"`
		}
		if !body(c, &in) {
			return
		}
		ids := []string{}
		for _, id := range in.IDs {
			if id = strings.TrimSpace(id); id != "" {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			c.JSON(400, gin.H{"error": "invalid_payload"})
			return
		}
		if len(ids) > 500 {
			c.JSON(400, gin.H{"error": "too_many_ids"})
			return
		}
		v, err := s.ExpressionDetailsBatch(c.Request.Context(), ids, user(c))
		// 响应含 items（按表达聚合，收录以引用 id 呈现）与共享 entities 表。
		respond(c, v, err)
	})
	cat.GET("/external-databases", func(c *gin.Context) {
		v, err := s.ListExternalDatabases(c.Request.Context(), c.Query("category"), true)
		respond(c, gin.H{"items": v}, err)
	})
	cat.GET("/shelves", func(c *gin.Context) {
		v, err := s.ListShelves(c.Request.Context(), true)
		respond(c, gin.H{"items": v}, err)
	})
	// /shelves/feed 一次返回每个货架及其求值后的条目，供首页直接渲染。
	// 规则里的 fields/vocab_terms/relations 只有服务端能判定，放在这里避免前端近似匹配。
	// 登录用户按个人偏好重排/隐藏；匿名与未设置偏好者按 sort_order 默认序。
	cat.GET("/shelves/feed", routeLimiter(60), func(c *gin.Context) {
		perShelf, _ := strconv.Atoi(c.Query("per_shelf"))
		shelves, err := s.ListShelves(c.Request.Context(), true)
		if err != nil {
			respond(c, nil, err)
			return
		}
		prefs := HomePreferences{}
		if u := user(c); u != nil {
			prefs, err = s.GetHomePreferences(c.Request.Context(), u.ID)
			if err != nil {
				respond(c, nil, err)
				return
			}
		}
		shelves = applyHomePreferences(shelves, prefs)
		out := make([]gin.H, 0, len(shelves))
		for _, sh := range shelves {
			items, ierr := s.ListShelfItems(c.Request.Context(), sh, perShelf, user(c))
			if ierr != nil {
				respond(c, nil, ierr)
				return
			}
			out = append(out, gin.H{"shelf": sh, "items": items})
		}
		c.JSON(200, gin.H{"items": out})
	})
	cat.GET("/me/home-preferences", func(c *gin.Context) {
		u := user(c)
		if u == nil {
			respond(c, nil, sql.ErrNoRows)
			return
		}
		v, err := s.GetHomePreferences(c.Request.Context(), u.ID)
		respond(c, v, err)
	})
	cat.PUT("/me/home-preferences", required(true), func(c *gin.Context) {
		var in HomePreferences
		if !body(c, &in) {
			return
		}
		v, err := s.SaveHomePreferences(c.Request.Context(), user(c).ID, in)
		respond(c, v, err)
	})
	cat.GET("/compare", routeLimiter(10), func(c *gin.Context) {
		v, err := s.Compare(c.Request.Context(), strings.Split(c.Query("ids"), ","), user(c))
		respond(c, gin.H{"items": v}, err)
	})
	imp := api.Group("/importer")
	imp.POST("/preview", func(c *gin.Context) {
		var in ImporterPreviewRequest
		if !body(c, &in) {
			return
		}
		if strings.TrimSpace(in.URLOrID) == "" {
			c.JSON(400, gin.H{"error": "invalid_payload"})
			return
		}
		v, err := s.Preview(c.Request.Context(), in.Source, in.URLOrID, in.EntityType)
		if err == nil {
			c.JSON(200, v)
			return
		}
		respond(c, nil, err)
	})
	imp.POST("/import", required(false), func(c *gin.Context) {
		var in ImporterImportRequest
		if !body(c, &in) {
			return
		}
		v, err := s.Import(c.Request.Context(), in, *user(c))
		respond(c, v, err)
	})
	cat.POST("/relations", required(false), func(c *gin.Context) {
		// 幂等命中直接返回首创结果, 不建重复关系。
		if cached, ok := idemLookup(c); ok {
			c.JSON(200, cached)
			return
		}
		var in RelationEdit
		if !body(c, &in) {
			return
		}
		if in.Relation.ID != "" {
			c.JSON(400, gin.H{"error": "id_must_be_empty"})
			return
		}
		v, err := s.SaveRelation(c.Request.Context(), in, *user(c))
		if err == nil {
			idemStore(c, v)
		}
		respond(c, v, err)
	})
	cat.PUT("/relations/:id", required(false), func(c *gin.Context) {
		var in RelationEdit
		if !body(c, &in) {
			return
		}
		in.Relation.ID = c.Param("id")
		v, err := s.SaveRelation(c.Request.Context(), in, *user(c))
		respond(c, v, err)
	})
	cat.DELETE("/relations/:id", required(false), func(c *gin.Context) {
		var in LifecycleEdit
		if !body(c, &in) {
			return
		}
		respond(c, gin.H{"ok": true}, s.DeleteRelation(c.Request.Context(), c.Param("id"), in.ExpectedVersion, in.EditNote, in.Sources, *user(c)))
	})
	defs := api.Group("/admin/catalog-definitions", required(true))
	defs.GET("", func(c *gin.Context) {
		v, err := s.DefinitionVersions(c.Request.Context())
		respond(c, gin.H{"items": v}, err)
	})
	defs.POST("", func(c *gin.Context) {
		var in struct {
			Document    Definitions `json:"document"`
			BaseVersion int64       `json:"base_version"`
			EditNote    string      `json:"edit_note"`
			Sources     []Source    `json:"sources"`
		}
		if !body(c, &in) {
			return
		}
		id, err := s.Draft(c.Request.Context(), in.Document, in.BaseVersion, *user(c), in.EditNote, in.Sources)
		respond(c, gin.H{"id": id}, err)
	})
	defs.GET("/:id/impact", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		v, err := s.Impact(c.Request.Context(), id)
		respond(c, gin.H{"issues": v}, err)
	})
	defs.POST("/:id/publish", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		var in LifecycleEdit
		if !body(c, &in) {
			return
		}
		respond(c, gin.H{"ok": true}, s.Publish(c.Request.Context(), id, *user(c), in.EditNote, in.Sources))
	})
	ext := api.Group("/admin/external-databases", required(true))
	ext.GET("", func(c *gin.Context) {
		v, err := s.ListExternalDatabases(c.Request.Context(), c.Query("category"), false)
		respond(c, gin.H{"items": v}, err)
	})
	ext.POST("", func(c *gin.Context) {
		var in ExternalDatabase
		if !body(c, &in) {
			return
		}
		v, err := s.CreateExternalDatabase(c.Request.Context(), in)
		respond(c, gin.H{"message": "created", "data": v}, err)
	})
	ext.PUT("/:code", func(c *gin.Context) {
		var in ExternalDatabase
		if !body(c, &in) {
			return
		}
		v, err := s.UpdateExternalDatabase(c.Request.Context(), c.Param("code"), in)
		respond(c, gin.H{"message": "updated", "data": v}, err)
	})
	ext.DELETE("/:code", func(c *gin.Context) {
		respond(c, gin.H{"message": "deleted"}, s.DeleteExternalDatabase(c.Request.Context(), c.Param("code")))
	})
	shelves := api.Group("/admin/shelves", required(true))
	shelves.GET("", func(c *gin.Context) {
		v, err := s.ListShelves(c.Request.Context(), false)
		respond(c, gin.H{"items": v}, err)
	})
	shelves.POST("", func(c *gin.Context) {
		var in Shelf
		if !body(c, &in) {
			return
		}
		v, err := s.CreateShelf(c.Request.Context(), in)
		respond(c, gin.H{"message": "created", "data": v}, err)
	})
	shelves.GET("/:id", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		v, err := s.GetShelf(c.Request.Context(), id)
		respond(c, gin.H{"data": v}, err)
	})
	shelves.PUT("/:id", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		var in Shelf
		if !body(c, &in) {
			return
		}
		v, err := s.UpdateShelf(c.Request.Context(), id, in)
		respond(c, gin.H{"message": "updated", "data": v}, err)
	})
	shelves.DELETE("/:id", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		respond(c, gin.H{"message": "deleted"}, s.DeleteShelf(c.Request.Context(), id))
	})
}

const docsHTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <title>MetaFusion API 交互式文档 (Scalar)</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
      body { margin: 0; padding: 0; background: #0b0f19; }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/api/openapi.json"
      data-configuration='{"theme": "purple", "hideModels": false, "showSidebar": true}'>
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`

const swaggerHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>MetaFusion API 文档 (Swagger UI)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`

// resolveRelated 批量解析关系对端实体（单次查询），失败的对端跳过。
// u 用请求方身份，保证草稿实体的创建者/管理员能看到自己的关系对端。
// 不设固定条数上限：真实条目（如动画）署名可达数百条，截断会让详情页缺数据。
func (h HTTP) resolveRelated(ctx context.Context, selfID string, rels []Relation, u *User) map[string]Entity {
	ids := make([]string, 0, len(rels))
	seen := map[string]bool{selfID: true}
	for _, r := range rels {
		other := r.TargetID
		if r.SourceID != selfID {
			other = r.SourceID
		}
		if other == "" || seen[other] {
			continue
		}
		seen[other] = true
		ids = append(ids, other)
	}
	got, err := h.Store.GetManyVisible(ctx, ids, u)
	if err != nil {
		return map[string]Entity{}
	}
	return got
}
