package catalogv2

import (
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	"io"
	"fmt"
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
func (h HTTP) Register(r *gin.Engine) {
	for _, prefix := range []string{"/api", "/api/v2"} {
		h.registerGroup(r.Group(prefix))
	}
}

func (h HTTP) registerGroup(api *gin.RouterGroup) {
	s := h.Store
	api.GET("/openapi.json", func(c *gin.Context) { c.JSON(200, OpenAPI()) })
	api.Use(func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if token == "" {
			token, _ = c.Cookie("mf_v2_session")
		}
		if token != "" {
			if u, err := s.User(c.Request.Context(), token); err == nil {
				c.Set("catalog_user", u)
			}
		}
		c.Next()
	})
	api.GET("/setup", func(c *gin.Context) {
		needed, err := s.SetupNeeded(c.Request.Context())
		respond(c, gin.H{"needed": needed}, err)
	})
	type credentials struct {
		Username string `json:"username"`
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
		u, err := s.CreateUser(c.Request.Context(), in.Username, in.Password, true, nil)
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
			c.SetCookie("mf_v2_session", token, 86400, "/", "", c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https", true)
		}
		respond(c, gin.H{"token": token, "user": u}, err)
	})
	api.GET("/auth/me", required(false), func(c *gin.Context) { respond(c, user(c), nil) })
	api.POST("/auth/logout", required(false), func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if token == "" {
			token, _ = c.Cookie("mf_v2_session")
		}
		c.SetCookie("mf_session", "", -1, "/", "", false, true)
		c.SetCookie("mf_v2_session", "", -1, "/", "", false, true)
		respond(c, gin.H{"ok": true}, s.Logout(c.Request.Context(), token))
	})
	api.POST("/admin/users", required(true), func(c *gin.Context) {
		var in credentials
		if !body(c, &in) {
			return
		}
		u, err := s.CreateUser(c.Request.Context(), in.Username, in.Password, false, user(c))
		respond(c, u, err)
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
			c.Redirect(http.StatusFound, "/catalog/account?return_to="+url.QueryEscape(c.Request.RequestURI))
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
			"email":    fmt.Sprintf("%s@findverse.cc", u.Username),
		})
	})
	cat := api.Group("/catalog")
	cat.GET("/definitions", func(c *gin.Context) { v, err := s.Definitions(c.Request.Context()); respond(c, v, err) })
	cat.GET("/entities", func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.Query("limit"))
		offset, _ := strconv.Atoi(c.Query("offset"))
		items, err := s.List(c.Request.Context(), ListOptions{Kind: c.Query("kind"), Query: c.Query("q"), Type: c.Query("type"), Status: c.Query("status"), WorkID: c.Query("work_id"), ContentUnitID: c.Query("content_unit_id"), ReleaseID: c.Query("release_id"), MediumID: c.Query("medium_id"), ParentID: c.Query("parent_id"), Field: c.Query("field"), Value: c.Query("value"), Limit: limit, Offset: offset}, user(c))
		respond(c, gin.H{"items": items}, err)
	})
	cat.GET("/entities/:id", func(c *gin.Context) { e, err := s.Get(c.Request.Context(), c.Param("id"), user(c)); respond(c, e, err) })
	cat.GET("/entities/:id/resolve", func(c *gin.Context) {
		e, err := s.Resolve(c.Request.Context(), c.Param("id"), user(c))
		respond(c, e, err)
	})
	cat.POST("/entities", required(false), func(c *gin.Context) {
		var in Edit
		if !body(c, &in) {
			return
		}
		if in.Entity.ID != "" {
			c.JSON(400, gin.H{"error": "id_must_be_empty"})
			return
		}
		e, err := s.Save(c.Request.Context(), in, *user(c))
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
	cat.GET("/compare", func(c *gin.Context) {
		v, err := s.Compare(c.Request.Context(), strings.Split(c.Query("ids"), ","), user(c))
		respond(c, gin.H{"items": v}, err)
	})
	cat.POST("/relations", required(false), func(c *gin.Context) {
		var in RelationEdit
		if !body(c, &in) {
			return
		}
		if in.Relation.ID != "" {
			c.JSON(400, gin.H{"error": "id_must_be_empty"})
			return
		}
		v, err := s.SaveRelation(c.Request.Context(), in, *user(c))
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
}
