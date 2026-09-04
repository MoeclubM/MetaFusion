package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/metafusion/metafusion-app/internal/admin"
	"github.com/metafusion/metafusion-app/internal/apikey"
	"github.com/metafusion/metafusion-app/internal/auth"
	"github.com/metafusion/metafusion-app/internal/catalog"
	"github.com/metafusion/metafusion-app/internal/community"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/database"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/importer"
	"github.com/metafusion/metafusion-app/internal/mailer"
	"github.com/metafusion/metafusion-app/internal/openapi"
	"github.com/metafusion/metafusion-app/internal/plugin"
	"github.com/metafusion/metafusion-app/internal/ratelimit"
	"github.com/metafusion/metafusion-app/internal/search"
	"github.com/metafusion/metafusion-app/internal/storage"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg := config.Load()

	// 1. 初始化数据库
	db, err := database.InitDB(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// 2. 初始化 Redis Asynq 任务客户端与通用 Redis Client
	asynqClient := asynq.NewClient(asynq.RedisClientOpt{Addr: cfg.RedisAddr})
	defer asynqClient.Close()

	redisClient := redis.NewClient(&redis.Options{
		Addr: cfg.RedisAddr,
	})
	defer redisClient.Close()

	searchSvc, err := search.NewSearchService(cfg, db)
	if err != nil {
		log.Printf("Search service warning: %v", err)
	}

	mailerSvc := mailer.NewMailer(db)

	// 3. 初始化各模块服务
	authSvc := auth.NewAuthService(db, cfg, redisClient, mailerSvc)
	catalogSvc := catalog.NewCatalogService(db, searchSvc)
	communitySvc := community.NewCommunityService(db)
	messageSvc := community.NewMessageService(db)
	adminSvc := admin.NewAdminService(db, searchSvc, asynqClient, mailerSvc)
	systemHealthSvc := admin.NewSystemHealthService(db, cfg, searchSvc, redisClient)
	apiKeySvc := apikey.NewService(db)

	storageSvc, err := storage.NewStorageService(cfg, db, asynqClient)
	if err != nil {
		log.Printf("Storage service warning: %v", err)
	}

	importerSvc := importer.NewImporterService(db, cfg, storageSvc, searchSvc, catalogSvc)

	// 初始化可扩展插件内核系统 (Plugin Kernel & Registry)
	pluginMgr := plugin.NewManager(db, cfg)
	if err := pluginMgr.Initialize(context.Background()); err != nil {
		log.Printf("Plugin manager warning: %v", err)
	}
	pluginHandler := plugin.NewHandler(pluginMgr)
	importerSvc.SetPluginResolver(pluginMgr)

	// 4. 配置 Gin HTTP 路由器
	r := gin.Default()

	// i18n: ?locale/?language > x-locale > Accept-Language > zh-CN
	r.Use(backendi18n.Middleware())

	// 安全响应头中间件 (Security Headers)
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "SAMEORIGIN")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Header("Cross-Origin-Opener-Policy", "same-origin")
		c.Header("Cross-Origin-Resource-Policy", "cross-origin")
		if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
		}
		c.Next()
	})

	// 配置 CORS — 扩展支持 PAT 头与 User-Agent，支持环境变量配置域名白名单
	corsConfig := cors.DefaultConfig()
	if cfg.AllowedOrigins != "" {
		origins := strings.Split(cfg.AllowedOrigins, ",")
		for i := range origins {
			origins[i] = strings.TrimSpace(origins[i])
		}
		corsConfig.AllowOrigins = origins
		corsConfig.AllowCredentials = true
	} else {
		corsConfig.AllowAllOrigins = true
	}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization", "Range", "Accept-Language", "x-locale", "X-API-Key", "X-Token", "User-Agent"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
	corsConfig.ExposeHeaders = []string{"X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After", "X-Warning"}
	r.Use(cors.New(corsConfig))

	// 限流必须在可选鉴权之后：否则 JWT/PAT 从未写入 userID，认证写入也会按匿名 60/分钟计。
	r.Use(auth.OptionalUnifiedAuthMiddleware(cfg, db))
	limiter := ratelimit.New(60, 600, db)
	r.Use(limiter.Middleware())

	// 敏感认证接口高防限流（防止撞库/爆破/恶意批量注册，15次/分钟）
	authBruteLimiter := ratelimit.NewEndpointLimiter(15, time.Minute, db)

	// 生产健康检查探针体系 (Liveness & Readiness Probes)
	healthHandler := func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "metafusion-backend"})
	}
	r.GET("/healthz", healthHandler)
	r.HEAD("/healthz", healthHandler)
	r.GET("/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "live", "service": "metafusion-backend"})
	})
	r.HEAD("/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "live", "service": "metafusion-backend"})
	})
	r.GET("/livez", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "live", "service": "metafusion-backend"})
	})
	r.HEAD("/livez", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "live", "service": "metafusion-backend"})
	})
	readyHandler := func(c *gin.Context) {
		checks := gin.H{}
		allHealthy := true

		// 1. PostgreSQL 检查
		if sqlDB, err := db.DB(); err != nil || sqlDB.Ping() != nil {
			checks["postgres"] = "unhealthy"
			allHealthy = false
		} else {
			checks["postgres"] = "healthy"
		}

		// 2. Redis 检查
		if conn, err := net.DialTimeout("tcp", cfg.RedisAddr, 2*time.Second); err != nil {
			checks["redis"] = "unhealthy"
			allHealthy = false
		} else {
			_ = conn.Close()
			checks["redis"] = "healthy"
		}

		if allHealthy {
			c.JSON(http.StatusOK, gin.H{"status": "ready", "checks": checks})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy", "checks": checks})
		}
	}
	r.GET("/ready", readyHandler)
	r.HEAD("/ready", readyHandler)
	r.GET("/health", healthHandler)
	r.HEAD("/health", healthHandler)
	r.GET("/api/v1/health", healthHandler)
	r.HEAD("/api/v1/health", healthHandler)
	r.GET("/api/health", healthHandler)
	r.HEAD("/api/health", healthHandler)

	// 静态本地上传目录路由（支持离线开发与回退）
	_ = os.MkdirAll("./uploads/avatars", 0755)
	r.Static("/uploads", "./uploads")

	// OpenAPI 3.1 规范 — 类似 MusicBrainz 的文档化可发现性
	r.GET("/api/v1/openapi.json", openapi.Handler())
	r.GET("/api/openapi.json", openapi.Handler())

	api := r.Group("/api/v1")
	{
		registerAuthRoutes(api, cfg, db, authSvc, apiKeySvc, storageSvc, authBruteLimiter)

		registerCatalogRoutes(api, cfg, db, catalogSvc, communitySvc, importerSvc, pluginHandler, searchSvc)

		registerStorageRoutes(api, cfg, db, storageSvc)

		registerSocialRoutes(api, cfg, db, communitySvc, messageSvc)

		registerAdminRoutes(api, cfg, db, adminSvc, systemHealthSvc, catalogSvc, pluginHandler)
		}

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	// 启动 HTTP 服务（Goroutine 运行以配合优雅停机）
	go func() {
		log.Printf("MetaFusion Backend API Server starting on port %s...", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server failed to run: %v", err)
		}
	}()

	// 监听系统中断信号（SIGINT, SIGTERM）
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Received signal %v. Initiating graceful shutdown...", sig)

	// 设置 10 秒超时以等待正在处理的请求完成
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown with error: %v", err)
	} else {
		log.Println("MetaFusion Backend API Server exited cleanly.")
	}
}
