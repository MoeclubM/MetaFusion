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
	"github.com/metafusion/metafusion-app/internal/audit"
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

	// 结构初始化失败仍是致命错误（服务没有可用的表结构）。
	//
	// 唯一的例外是"种子定义合并没能生效"（*catalog.DefinitionSeedError）：那是**可降级**的
	// 失败——上一个已发布定义照旧生效，库里的存量数据也照旧能读写。2026-09 的事故正是把
	// 它当致命错误：库里 31 条悬挂引用让 impact 回放失败 → log.Fatalf → 容器 CrashLoop →
	// 网关 502。这里改为记 error 日志 + 暴露状态信号（/health 的 definitions）后继续启动，
	// 让"定义没更新"表现为一个可诊断的降级，而不是整站不可用。
	if err = s.Initialize(ctx); err != nil {
		var seedErr *catalog.DefinitionSeedError
		if errors.As(err, &seedErr) {
			log.Printf("ERROR startup degraded: %v; serving with the previously published definitions — check GET /health (definitions) and run mf-migrate check-refs for dangling references", err)
		} else {
			log.Fatalf("catalog schema initialization failed: %v", err)
		}
	}

	// 审计写入器（跨服务契约 §3）：一个后台 goroutine + 有界队列，挂在 Store 上供
	// registerGroup 的中间件使用。关停时排空队列——进程直接退会把队列里最后一批行丢掉。
	s.Audit = audit.NewRecorder(s.DB, audit.ServiceName)
	defer s.Audit.Close()

	// 目录侧只验签，不签发：按 AUTH_JWT_PUBLIC_KEY（静态公钥）→ AUTH_JWKS_URL（账号服务的 JWKS）
	// → AUTH_JWT_PRIVATE_KEY（兼容兜底，启动告警）取公钥；私钥始终留在账号服务。
	// 三者都未配置时验签器不可用，需要身份的写接口会按未登录处理——这是有意的 fail closed，
	// 只影响写与个性化，公开读不受影响。
	verifier, terr := catalog.NewTokenVerifierFromEnv(env("AUTH_JWT_ISSUER", "https://findverse.cc/api"), env("AUTH_JWT_AUDIENCE", "metafusion"))
	if terr != nil {
		log.Fatalf("token verifier initialization failed: %v", terr)
	}
	s.Verifier = verifier
	if verifier.Ephemeral() {
		log.Print("no token signing key material configured (AUTH_JWT_PUBLIC_KEY / AUTH_JWKS_URL): catalog cannot verify tokens, authenticated writes will be rejected as anonymous")
	} else {
		log.Printf("catalog verifies RS256 tokens using %s", verifier.Source())
	}

	// PAT（个人访问令牌，mfp_ 前缀）的消费侧：目录不签发、不读 auth 库，带 mfp_ 的请求交给
	// 账号服务的内省端点判定（结果进程内缓存 60 秒 → 吊销与过期最长 60 秒后在下游生效）。
	// AUTH_URL 未配置时不装配内省器：这类请求回 503 auth_unavailable（依赖不可用），
	// 而不是 401——bot/CI 拿到 401 会以为凭据有问题去换令牌。
	if authURL := strings.TrimSpace(os.Getenv("AUTH_URL")); authURL != "" {
		s.PAT = catalog.NewPATIntrospector(authURL)
		log.Printf("catalog accepts personal access tokens via %s (introspection cached for %s)", authURL, catalog.PATCacheTTL)
	} else {
		log.Print("AUTH_URL is not configured: personal access tokens (mfp_ prefix) will be rejected with 503 auth_unavailable")
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

	catalogHTTP := catalog.HTTP{Store: s}
	catalogHTTP.Register(r)

	// 能力清单是**部署态声明**：子系统拆出去之后，能力由部署配置声明（见 capabilities 包），
	// 目录不探测上游、不发任何出站请求；运行时开关退役（PUT /api/admin/modules/:id 返回 409）。
	// 墓碑端点注册在 /api 组之外，因此把目录的管理员闸门显式传进去：未登录 401、非管理员 403，
	// 管理员才拿到 409 与 hint（闸门与 409 契约见 capabilities 包的注释）。
	// 墓碑端点（PUT /api/admin/modules/:id）的审计接线：该路由由 capabilities 包注册在 /api
	// 组之外，拿不到组内的审计中间件；而引擎级中间件（r.Use）是在 c.Next() 之前构造草稿的，
	// 那一刻 attachIdentity 还没跑，actor 会恒为空——那是假留痕（管理员试开开关会记成匿名）。
	// 所以把审计中间件排在闸门**之后**调用：闸门跑完（含身份与权限判定）再构造草稿，
	// actor 与响应状态都已知；未登录/无权限的尝试也照样留一行 failure。
	// 链长固定为 [本函数, 墓碑处理器]：闸门成功时它自己的 c.Next() 已经把链走完、abort 时 gin
	// 把 index 置到链外，两种情况 auditMW 里的 c.Next() 都不会重复执行处理器。
	toggleGate := catalogHTTP.AdminGate()
	toggleAudit := audit.Middleware(audit.Options{
		Recorder: s.Audit,
		Actions:  capabilities.AuditActions(),
		Actor:    catalog.DirectoryActor,
	})
	capabilities.New(os.Getenv).Register(r, func(c *gin.Context) {
		toggleGate(c)
		toggleAudit(c)
	})

	// /healthz 是进程存活；/health 与其它服务同形（status+service），供网关/运维面聚合探针统一读取。
	// /health 另外带 definitions（见 catalog.DefinitionStatus）：published_id 是当前**实际生效**的
	// 定义版本，degraded/pending_publish_error 表示"这次启动的种子合并没生效，站点仍按上一个
	// 已发布定义服务"。状态码刻意保持 200——降级可用不是"不健康"，回 503 会把编排器拉回
	// "重启到好为止"的循环，那正是要根除的 CrashLoop。探针判据：definitions.degraded == true。
	r.GET("/healthz", func(c *gin.Context) { c.JSON(200, gin.H{"status": "live"}) })
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "live", "service": "metafusion-catalog", "definitions": s.DefinitionStatus()})
	})
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
