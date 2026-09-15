package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/capabilities"
	"github.com/metafusion/metafusion-app/internal/catalog"
)

func main() {
	env := func(k, v string) string {
		if x := os.Getenv(k); x != "" {
			return x
		}
		return v
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		u := url.URL{
			Scheme: "postgres",
			Host:   env("DB_HOST", "localhost") + ":" + env("DB_PORT", "5432"),
			Path:   env("DB_NAME", "metafusion_db"),
			User:   url.UserPassword(env("DB_USER", "metafusion"), os.Getenv("DB_PASSWORD")),
		}
		q := u.Query()
		q.Set("sslmode", env("DB_SSLMODE", "disable"))
		u.RawQuery = q.Encode()
		dsn = u.String()
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	s, err := catalog.Open(ctx, dsn)
	if err != nil {
		log.Fatalf("catalog database connection failed: %v", err)
	}
	defer s.DB.Close()

	if err = s.Initialize(ctx); err != nil {
		log.Fatalf("catalog schema initialization failed: %v", err)
	}

	// 目录侧只验签，不签发：用与账号服务同一把 RSA 私钥派生出公钥（签发路径在账号服务）。
	// 未配置时验签器不可用，需要身份的写接口会按未登录处理——这是有意的 fail closed，
	// 只影响写与个性化，公开读不受影响。
	verifier, terr := catalog.NewTokenVerifierFromEnv(env("AUTH_JWT_ISSUER", "https://findverse.cc/api"), env("AUTH_JWT_AUDIENCE", "metafusion"))
	if terr != nil {
		log.Fatalf("token verifier initialization failed: %v", terr)
	}
	s.Verifier = verifier
	if verifier.Ephemeral() {
		log.Print("AUTH_JWT_PRIVATE_KEY is unset: catalog cannot verify tokens, authenticated writes will be rejected as anonymous")
	}

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.SetTrustedProxies(nil)
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-Frame-Options", "SAMEORIGIN")
		// 切流自检用：标明本次响应来自哪个上游，便于确认网关前缀是否已切到目标服务
		// （metafusion-auth / -community / -storage 返回同名头，拆分后能逐前缀核对）。
		c.Header("X-MetaFusion-Service", "metafusion-catalog")
		c.Next()
	})
	// requestID 透传 X-Request-ID：请求无则生成 crypto/rand hex，写入响应头与 gin 上下文。
	r.Use(func(c *gin.Context) {
		rid := c.GetHeader("X-Request-ID")
		if rid == "" {
			var b [16]byte
			if _, err := rand.Read(b[:]); err != nil {
				rid = fmt.Sprintf("%d", time.Now().UnixNano())
			} else {
				rid = hex.EncodeToString(b[:])
			}
		}
		c.Set("request_id", rid)
		c.Header("X-Request-ID", rid)
		c.Next()
	})

	if origins := os.Getenv("CORS_ALLOWED_ORIGINS"); origins != "" {
		r.Use(cors.New(cors.Config{
			AllowOrigins:     strings.Split(origins, ","),
			AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			AllowHeaders:     []string{"Authorization", "Content-Type", "Accept-Language", "X-Request-ID", "Idempotency-Key"},
			AllowCredentials: true,
		}))
	}

	catalog.HTTP{Store: s}.Register(r)

	// 能力清单改为"部署态"视图：子系统拆出去之后，能力由服务是否部署/健康决定，
	// 运行时开关退役（PUT /api/admin/modules/:id 返回 409，见 capabilities 包）。
	caps := capabilities.New(os.Getenv)
	caps.Start(ctx)
	caps.Register(r)

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

	server := &http.Server{
		Addr:              ":" + env("PORT", "8080"),
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	done := make(chan error, 1)
	go func() {
		log.Print("MetaFusion catalog core ready (PostgreSQL baseline)")
		done <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			log.Fatalf("server shutdown error: %v", err)
		}
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return
		}
		log.Fatalf("server error: %v", err)
	}
}
