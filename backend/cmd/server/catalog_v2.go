package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/catalogv2"
	"github.com/metafusion/metafusion-app/internal/moduleapi"
	"github.com/metafusion/metafusion-app/internal/modulesv2"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

type catalogAdapter struct{ s *catalogv2.Store }

func (a catalogAdapter) Lookup(ctx context.Context, id string, p *moduleapi.Principal) (moduleapi.Entity, error) {
	var u *catalogv2.User
	if p != nil {
		u = &catalogv2.User{ID: p.ID, Role: p.Role}
	}
	e, err := a.s.Resolve(ctx, id, u)
	return moduleapi.Entity{ID: e.ID, Kind: e.Kind, Title: e.Title, Status: e.Status, RedirectID: e.RedirectID}, err
}
func (a catalogAdapter) Authenticate(ctx context.Context, token string) (moduleapi.Principal, error) {
	u, err := a.s.User(ctx, token)
	if err != nil {
		return moduleapi.Principal{}, err
	}
	return moduleapi.Principal{ID: u.ID, Role: u.Role}, nil
}
func (a catalogAdapter) Export(ctx context.Context, id string, p *moduleapi.Principal) (json.RawMessage, error) {
	var u *catalogv2.User
	if p != nil {
		u = &catalogv2.User{ID: p.ID, Role: p.Role}
	}
	e, err := a.s.Get(ctx, id, u)
	if err != nil {
		return nil, err
	}
	return json.Marshal(e)
}
func (a catalogAdapter) Submit(ctx context.Context, b json.RawMessage, p moduleapi.Principal) (json.RawMessage, error) {
	var input catalogv2.Edit
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		return nil, err
	}
	input.Entity.Status = "pending_review"
	e, err := a.s.Save(ctx, input, catalogv2.User{ID: p.ID, Role: p.Role})
	if err != nil {
		return nil, err
	}
	return json.Marshal(e)
}
func runCatalogV2() error {
	env := func(k, v string) string {
		if x := os.Getenv(k); x != "" {
			return x
		}
		return v
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		u := url.URL{Scheme: "postgres", Host: env("DB_HOST", "localhost") + ":" + env("DB_PORT", "5432"), Path: env("DB_NAME", "metafusion_db"), User: url.UserPassword(env("DB_USER", "metafusion"), os.Getenv("DB_PASSWORD"))}
		q := u.Query()
		q.Set("sslmode", env("DB_SSLMODE", "disable"))
		u.RawQuery = q.Encode()
		dsn = u.String()
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	s, err := catalogv2.Open(ctx, dsn)
	if err != nil {
		return fmt.Errorf("catalog database connection failed")
	}
	defer s.DB.Close()
	if err = s.Initialize(ctx); err != nil {
		return fmt.Errorf("catalog schema initialization failed: %w", err)
	}
	// Separate pools prevent slow optional operations from consuming core connections.
	moduleDB, err := sql.Open("postgres", dsn)
	var modules *modulesv2.Manager
	if err == nil {
		defer moduleDB.Close()
		moduleDB.SetMaxOpenConns(5)
		initCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		modules, err = modulesv2.New(initCtx, moduleDB, catalogAdapter{s}, env("ARCHIVE_PATH", "./module-data/archive"))
		cancel()
	}
	if err != nil {
		log.Print("Optional modules unavailable; metadata remains online")
	}
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.SetTrustedProxies(nil)
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-Frame-Options", "SAMEORIGIN")
		c.Next()
	})
	if origins := os.Getenv("CORS_ALLOWED_ORIGINS"); origins != "" {
		r.Use(cors.New(cors.Config{AllowOrigins: strings.Split(origins, ","), AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}, AllowHeaders: []string{"Authorization", "Content-Type", "Accept-Language"}, AllowCredentials: true}))
	}
	catalogv2.HTTP{Store: s}.Register(r)
	if modules != nil {
		modules.Register(r)
		modules.Start(ctx)
	} else {
		r.GET("/api/v2/capabilities", func(c *gin.Context) { c.JSON(200, gin.H{"modules": []moduleapi.Manifest{}, "status": "unavailable"}) })
	}
	r.GET("/healthz", func(c *gin.Context) { c.JSON(200, gin.H{"status": "live"}) })
	r.GET("/ready", func(c *gin.Context) {
		check, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if s.DB.PingContext(check) != nil {
			c.JSON(503, gin.H{"status": "unavailable"})
			return
		}
		c.JSON(200, gin.H{"status": "ready", "dependencies": []string{"postgres"}})
	})
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if modules == nil {
					continue
				}
				delivery, cancel := context.WithTimeout(ctx, 5*time.Second)
				err := s.Deliver(delivery, "optional-modules", func(ctx context.Context, e catalogv2.Event) error {
					if e.Type != "entity.merged" {
						return nil
					}
					var entity catalogv2.Entity
					if err := json.Unmarshal(e.Payload, &entity); err != nil {
						return err
					}
					return modules.ConsumeMerge(ctx, e.ID, entity.ID, entity.RedirectID)
				})
				cancel()
				if err != nil && !errors.Is(err, context.Canceled) {
					log.Print("Optional module event delivery will retry")
				}
			}
		}
	}()
	server := &http.Server{Addr: ":" + env("PORT", "8080"), Handler: r, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	done := make(chan error, 1)
	go func() { log.Print("MetaFusion catalog v2 ready (PostgreSQL core)"); done <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
