package catalog

import (
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
	// 结构化错误：保留 error 字段兼容旧前端，新增 code+message；database_error
	// 只透出固定 code，不附带 SQL 原文。
	c.JSON(status, gin.H{"error": code, "code": code, "message": code})
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
	mu    sync.Mutex
	start time.Time
	n     int
}

var routeAttempts sync.Map // string -> *routeBucket

// routeLimiter 按 IP+路由限流重型 GET 接口, 超限返回 429 + Retry-After(秒)。
func routeLimiter(perMinute int) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP() + "|" + c.FullPath()
		now := time.Now()
		v, _ := routeAttempts.LoadOrStore(key, &routeBucket{start: now})
		b := v.(*routeBucket)
		b.mu.Lock()
		if now.Sub(b.start) > time.Minute {
			b.start = now
			b.n = 0
		}
		b.n++
		over := b.n > perMinute
		retrySecs := int(time.Until(b.start.Add(time.Minute)).Seconds()) + 1
		b.mu.Unlock()
		if retrySecs < 1 {
			retrySecs = 1
		}
		if over {
			c.Header("Retry-After", strconv.Itoa(retrySecs))
			c.AbortWithStatusJSON(429, gin.H{"error": "rate_limited", "code": "rate_limited", "message": "rate_limited"})
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
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if token == "" {
			token, _ = c.Cookie("mf_session")
		}
		if token != "" {
			if u, err := s.User(c.Request.Context(), token); err == nil {
				c.Set("catalog_user", u)
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
	var attempts sync.Map
	limiter := func(c *gin.Context) {
		key := c.ClientIP()
		now := time.Now()
		type bucket struct {
			mu    sync.Mutex
			start time.Time
			n     int
		}
		v, _ := attempts.LoadOrStore(key, &bucket{start: now})
		b := v.(*bucket)
		b.mu.Lock()
		defer b.mu.Unlock()
		if now.Sub(b.start) > time.Minute {
			b.start = now
			b.n = 0
		}
		b.n++
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
		respond(c, gin.H{"token": token, "user": u}, err)
	})
	api.GET("/auth/me", required(false), func(c *gin.Context) { respond(c, user(c), nil) })
	api.POST("/auth/logout", required(false), func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if token == "" {
			token, _ = c.Cookie("mf_session")
		}
		c.SetCookie("mf_session", "", -1, "/", "", false, true)
		respond(c, gin.H{"ok": true}, s.Logout(c.Request.Context(), token))
	})
	api.PUT("/auth/password", required(false), func(c *gin.Context) {
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
	})
	api.POST("/auth/logout-all", required(false), func(c *gin.Context) {
		u := user(c)
		if u == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.SetCookie("mf_session", "", -1, "/", "", false, true)
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
	oauth.GET("/authorize", func(c *gin.Context) {
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
		code, err := s.CreateOAuthCode(c.Request.Context(), clientID, u.ID, redirectURI, scope)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
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
	oauth.POST("/token", func(c *gin.Context) {
		grantType := c.PostForm("grant_type")
		code := c.PostForm("code")
		clientID := c.PostForm("client_id")
		clientSecret := c.PostForm("client_secret")
		redirectURI := c.PostForm("redirect_uri")
		if grantType == "" {
			var body struct {
				GrantType    string `json:"grant_type"`
				Code         string `json:"code"`
				ClientID     string `json:"client_id"`
				ClientSecret string `json:"client_secret"`
				RedirectURI  string `json:"redirect_uri"`
			}
			if c.BindJSON(&body) == nil {
				grantType = body.GrantType
				code = body.Code
				clientID = body.ClientID
				clientSecret = body.ClientSecret
				redirectURI = body.RedirectURI
			}
		}
		if grantType != "authorization_code" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported_grant_type"})
			return
		}
		token, u, err := s.ExchangeOAuthCode(c.Request.Context(), clientID, clientSecret, code, redirectURI)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"access_token": token,
			"token_type":   "Bearer",
			"expires_in":   86400 * 30,
			"scope":        "profile",
			"user":         u,
		})
	})
	oauth.GET("/userinfo", func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing_token"})
			return
		}
		u, err := s.User(c.Request.Context(), token)
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
	cat := api.Group("/catalog")
	cat.GET("/definitions", func(c *gin.Context) { v, err := s.Definitions(c.Request.Context()); respond(c, v, err) })
	cat.GET("/works", func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", c.DefaultQuery("page_size", "20")))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		o := ListOptions{Kind: "work", Query: c.Query("q"), Limit: limit, Offset: offset}
		items, err := s.List(c.Request.Context(), o, user(c))
		if err != nil {
			respond(c, nil, err)
			return
		}
		// 真实 COUNT total, 与 List 共用同一谓词(见 listFilter/Count)。
		total, err := s.Count(c.Request.Context(), o, user(c))
		respond(c, gin.H{"items": items, "total": total}, err)
	})
	// 旧前端 /works/[id] 页兼容路由：新轨 Work 实体映射为旧 JSON 形状（只读），见 works_compat.go。
	cat.GET("/works/:id", h.worksDetail)
	cat.GET("/works/:id/contents", h.worksContents)
	cat.GET("/works/:id/graph", h.worksGraph)
	// 旧前端其余详情页只读兼容路由（taxonomy/artists/franchises/mediums/canonical-entries），见 legacy_compat.go。
	cat.GET("/taxonomy", h.taxonomyCompat)
	cat.GET("/artists/:id", h.artistsCompat)
	cat.GET("/franchises/:id", h.franchisesCompat)
	cat.GET("/mediums/:id", h.mediumsCompat)
	cat.GET("/canonical-entries/:id", h.canonicalEntriesCompat)
	cat.GET("/tags", h.tagsCompat)
	cat.GET("/relation-types", h.relationTypesCompat)
	cat.GET("/works/:id/comments", h.worksCommentsCompat)
	cat.GET("/entities", routeLimiter(120), func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.Query("limit"))
		offset, _ := strconv.Atoi(c.Query("offset"))
		o := ListOptions{Kind: c.Query("kind"), Query: c.Query("q"), Type: c.Query("type"), Status: c.Query("status"), WorkID: c.Query("work_id"), ContentUnitID: c.Query("content_unit_id"), ReleaseID: c.Query("release_id"), MediumID: c.Query("medium_id"), ParentID: c.Query("parent_id"), Field: c.Query("field"), Value: c.Query("value"), Limit: limit, Offset: offset}
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
		respond(c, gin.H{"items": v}, err)
	})
	cat.GET("/entities/:id/occurrences", func(c *gin.Context) {
		v, err := s.Occurrences(c.Request.Context(), c.Param("id"), user(c))
		respond(c, gin.H{"items": v}, err)
	})
	cat.GET("/external-databases", func(c *gin.Context) {
		v, err := s.ListExternalDatabases(c.Request.Context(), c.Query("category"), true)
		respond(c, gin.H{"items": v}, err)
	})
	cat.GET("/shelves", func(c *gin.Context) {
		v, err := s.ListShelves(c.Request.Context(), true)
		respond(c, gin.H{"items": v}, err)
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
