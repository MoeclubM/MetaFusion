package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/openapi"
	"github.com/metafusion/metafusion-app/internal/plugin"
	"github.com/metafusion/metafusion-app/internal/ratelimit"
	"github.com/metafusion/metafusion-app/internal/search"
	"github.com/metafusion/metafusion-app/internal/storage"
	"github.com/redis/go-redis/v9"
)

func translateAuthError(c *gin.Context, msg string) string {
	m := map[string]string{
		"用户名与邮箱不能为空":         backendi18n.T(c, "auth.empty_username_email"),
		"用户名或邮箱已被占用":         backendi18n.T(c, "auth.username_email_taken"),
		"用户名或密码错误":           backendi18n.T(c, "auth.wrong_password"),
		"账号已被封禁，请联系管理员":      backendi18n.T(c, "auth.account_banned"),
		"原密码错误":              backendi18n.T(c, "auth.old_password_wrong"),
		"注册功能已关闭，请联系管理员":     backendi18n.T(c, "auth.registration_closed"),
		"需要邀请码才能注册":          backendi18n.T(c, "auth.invite_required"),
		"邀请码不能为空":            backendi18n.T(c, "auth.invite_empty"),
		"无效的邀请码，请向已有成员索取邀请码": backendi18n.T(c, "auth.invite_invalid"),
		"系统已完成初始化，初始管理员账号已存在": backendi18n.T(c, "auth.already_initialized"),
		"邮箱已完成验证，无需重复操作":     backendi18n.T(c, "auth.email_already_verified"),
		"验证邮件发送过于频繁，请稍候再试":   backendi18n.T(c, "auth.email_cooldown"),
		"验证码已过期或不存在，请重新发送":   backendi18n.T(c, "auth.verify_code_expired"),
		"验证码不正确，请核对后重试":       backendi18n.T(c, "auth.verify_code_invalid"),
		"验证码格式不正确，需为 6 位数字":   backendi18n.T(c, "auth.verify_code_invalid"),
		"邮箱验证功能暂未开启，请联系管理员":    backendi18n.T(c, "auth.email_verification_disabled"),
		"管理员已开启强制邮箱验证，请先前往个人设置完成邮箱验证": backendi18n.T(c, "auth.email_verification_required"),
	}
	if v, ok := m[msg]; ok {
		return v
	}
	return msg
}

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
	catalogSvc := catalog.NewCatalogService(db)
	communitySvc := community.NewCommunityService(db)
	messageSvc := community.NewMessageService(db)
	adminSvc := admin.NewAdminService(db, searchSvc, mailerSvc)
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
		// OOBE 首次开箱即用初始化检测与设置
		api.GET("/system/setup-status", func(c *gin.Context) {
			status, err := authSvc.GetSetupStatus()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, status)
		})

		api.POST("/system/setup", authBruteLimiter, func(c *gin.Context) {
			var input auth.InitialSetupInput
			if err := c.ShouldBindJSON(&input); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			user, pair, err := authSvc.PerformInitialSetup(&input)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": translateAuthError(c, err.Error())})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"message":       backendi18n.T(c, "auth.setup_success"),
				"user":          user,
				"token":         pair.AccessToken,
				"access_token":  pair.AccessToken,
				"refresh_token": pair.RefreshToken,
				"expires_in":    pair.ExpiresIn,
				"token_type":    pair.TokenType,
			})
		})

		// 认证与专属邀请码
		authGroup := api.Group("/auth")
		{
			authGroup.GET("/setup-status", func(c *gin.Context) {
				status, err := authSvc.GetSetupStatus()
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, status)
			})

			authGroup.POST("/setup", authBruteLimiter, func(c *gin.Context) {
				var input auth.InitialSetupInput
				if err := c.ShouldBindJSON(&input); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				user, pair, err := authSvc.PerformInitialSetup(&input)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": translateAuthError(c, err.Error())})
					return
				}
				c.JSON(http.StatusOK, gin.H{
					"message":       backendi18n.T(c, "auth.setup_success"),
					"user":          user,
					"token":         pair.AccessToken,
					"access_token":  pair.AccessToken,
					"refresh_token": pair.RefreshToken,
					"expires_in":    pair.ExpiresIn,
					"token_type":    pair.TokenType,
				})
			})

			authGroup.GET("/settings", func(c *gin.Context) {
				var rows []models.SystemSetting
				_ = db.Find(&rows).Error
				m := map[string]string{}
				for _, r := range rows {
					m[r.Key] = r.Value
				}
				if _, ok := m["registration_enabled"]; !ok {
					m["registration_enabled"] = "true"
				}
				if _, ok := m["invite_required"]; !ok {
					m["invite_required"] = "true"
				}
				if _, ok := m["email_verification_enabled"]; !ok {
					m["email_verification_enabled"] = "true"
				}
				emailVerificationEnabled := m["email_verification_enabled"] != "false"
				requireEmailVerification := emailVerificationEnabled && (m["require_email_verification"] == "true")
				c.JSON(http.StatusOK, gin.H{
					"registration_enabled":       m["registration_enabled"] != "false",
					"invite_required":            m["invite_required"] == "true",
					"require_email_verification": requireEmailVerification,
					"email_verification_enabled": emailVerificationEnabled,
					"rate_limit_enabled":         m["rate_limit_enabled"] != "false",
					"auth_rate_limit_enabled":    m["auth_rate_limit_enabled"] != "false",
				})
			})

			authGroup.POST("/register", authBruteLimiter, func(c *gin.Context) {
				var input auth.RegisterInput
				if err := c.ShouldBindJSON(&input); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				user, pair, err := authSvc.RegisterWithPair(&input)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": translateAuthError(c, err.Error())})
					return
				}
				c.JSON(http.StatusOK, gin.H{
					"user":          user,
					"token":         pair.AccessToken,
					"access_token":  pair.AccessToken,
					"refresh_token": pair.RefreshToken,
					"expires_in":    pair.ExpiresIn,
					"token_type":    pair.TokenType,
				})
			})

			authGroup.POST("/login", authBruteLimiter, func(c *gin.Context) {
				var input auth.LoginInput
				if err := c.ShouldBindJSON(&input); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				user, pair, err := authSvc.LoginWithPair(&input)
				if err != nil {
					c.JSON(http.StatusUnauthorized, gin.H{"error": translateAuthError(c, err.Error())})
					return
				}
				c.JSON(http.StatusOK, gin.H{
					"user":          user,
					"token":         pair.AccessToken,
					"access_token":  pair.AccessToken,
					"refresh_token": pair.RefreshToken,
					"expires_in":    pair.ExpiresIn,
					"token_type":    pair.TokenType,
				})
			})

			// 双 Token 刷新端点 (Rotation 支持)
			authGroup.POST("/refresh", func(c *gin.Context) {
				var req struct {
					RefreshToken string `json:"refresh_token" binding:"required"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "auth.refresh_token_required")})
					return
				}
				pair, err := authSvc.RefreshToken(req.RefreshToken)
				if err != nil {
					c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "auth.refresh_token_invalid"), "detail": err.Error()})
					return
				}
				c.JSON(http.StatusOK, gin.H{
					"user":          pair.User,
					"token":         pair.AccessToken,
					"access_token":  pair.AccessToken,
					"refresh_token": pair.RefreshToken,
					"expires_in":    pair.ExpiresIn,
					"token_type":    pair.TokenType,
				})
			})

			// 登出并吊销 Token
			authGroup.POST("/logout", func(c *gin.Context) {
				var req struct {
					RefreshToken string `json:"refresh_token"`
				}
				_ = c.ShouldBindJSON(&req)
				if req.RefreshToken != "" {
					_ = authSvc.RevokeToken(req.RefreshToken)
				}
				authHeader := c.GetHeader("Authorization")
				if parts := strings.SplitN(authHeader, " ", 2); len(parts) == 2 {
					_ = authSvc.RevokeToken(parts[1])
				}
				c.JSON(http.StatusOK, gin.H{"message": backendi18n.T(c, "auth.logged_out")})
			})

			authGroup.GET("/me", auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
				userID := c.MustGet("userID").(uuid.UUID)
				var user models.User
				if err := db.First(&user, userID).Error; err != nil {
					c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
					return
				}
				c.JSON(http.StatusOK, user)
			})

			// 获取当前用户的专属永久邀请码与受邀记录 (一个账号一个专属码)
			authGroup.GET("/invite", auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
				userID := c.MustGet("userID").(uuid.UUID)
				info, err := authSvc.GetUserInviteInfo(userID)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, info)
			})

			// 修改密码
			authGroup.POST("/change-password", auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
				userID := c.MustGet("userID").(uuid.UUID)
				var req struct {
					OldPassword string `json:"old_password" binding:"required"`
					NewPassword string `json:"new_password" binding:"required,min=8"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				if err := authSvc.ChangePassword(userID, req.OldPassword, req.NewPassword); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": translateAuthError(c, err.Error())})
					return
				}
				c.JSON(http.StatusOK, gin.H{"message": backendi18n.T(c, "password.changed")})
			})

			// 发送邮箱验证码 (带频率限制与防刷控制)
			authGroup.POST("/send-verification-email", authBruteLimiter, auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
				userID := c.MustGet("userID").(uuid.UUID)
				locale := backendi18n.LocaleFromContext(c)
				expiresIn, err := authSvc.SendVerificationEmail(userID, locale)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": translateAuthError(c, err.Error())})
					return
				}
				c.JSON(http.StatusOK, gin.H{
					"message":    backendi18n.T(c, "auth.verification_email_sent"),
					"expires_in": expiresIn,
				})
			})

			// 提交验证码完成邮箱验证
			authGroup.POST("/verify-email", authBruteLimiter, auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
				userID := c.MustGet("userID").(uuid.UUID)
				var req struct {
					Code string `json:"code" binding:"required"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "auth.verify_code_invalid")})
					return
				}
				user, err := authSvc.VerifyEmail(userID, req.Code)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": translateAuthError(c, err.Error())})
					return
				}
				c.JSON(http.StatusOK, gin.H{
					"message": backendi18n.T(c, "auth.email_verified_success"),
					"user":    user,
				})
			})

			// 个人资料自助更新（昵称/简介/头像）
			authGroup.PUT("/profile", auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
				userID := c.MustGet("userID").(uuid.UUID)
				var input auth.UpdateProfileInput
				if err := c.ShouldBindJSON(&input); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				updated, err := authSvc.UpdateProfile(userID, input)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": translateAuthError(c, err.Error())})
					return
				}
				c.JSON(http.StatusOK, updated)
			})

			// 用户头像上传
			authGroup.POST("/avatar", auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
				userID := c.MustGet("userID").(uuid.UUID)
				file, header, err := c.Request.FormFile("avatar")
				if err != nil {
					file, header, err = c.Request.FormFile("file")
				}
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要上传的头像图片"})
					return
				}
				defer file.Close()

				// 限制单张头像 5MB
				if header.Size > 5*1024*1024 {
					c.JSON(http.StatusBadRequest, gin.H{"error": "头像图片大小不能超过 5MB"})
					return
				}

				mimeType := header.Header.Get("Content-Type")
				ext := strings.ToLower(filepath.Ext(header.Filename))
				allowedMimes := map[string]bool{
					"image/jpeg":    true,
					"image/png":     true,
					"image/webp":    true,
					"image/gif":     true,
					"image/svg+xml": true,
					"image/avif":    true,
				}
				allowedExts := map[string]bool{
					".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true, ".svg": true, ".avif": true,
				}

				if (!allowedMimes[mimeType] && mimeType != "application/octet-stream") || (!allowedExts[ext] && ext != "") {
					c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 JPG, PNG, WebP, GIF, SVG 格式的图片"})
					return
				}
				if mimeType == "application/octet-stream" || mimeType == "" {
					switch ext {
					case ".png":
						mimeType = "image/png"
					case ".webp":
						mimeType = "image/webp"
					case ".gif":
						mimeType = "image/gif"
					case ".svg":
						mimeType = "image/svg+xml"
					default:
						mimeType = "image/jpeg"
					}
				}

				var avatarURL string
				if storageSvc != nil {
					avatarURL, err = storageSvc.UploadAvatar(c.Request.Context(), file, header.Size, mimeType, ext)
				} else {
					uploadDir := filepath.Join(".", "uploads", "avatars")
					_ = os.MkdirAll(uploadDir, 0755)
					fileName := fmt.Sprintf("%s%s", uuid.New().String(), ext)
					destPath := filepath.Join(uploadDir, fileName)
					destFile, errCreate := os.Create(destPath)
					if errCreate != nil {
						c.JSON(http.StatusInternalServerError, gin.H{"error": "保存本地头像失败"})
						return
					}
					defer destFile.Close()
					if _, errCopy := io.Copy(destFile, file); errCopy != nil {
						c.JSON(http.StatusInternalServerError, gin.H{"error": "写入本地头像失败"})
						return
					}
					avatarURL = fmt.Sprintf("/uploads/avatars/%s", fileName)
				}

				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "头像上传失败: " + err.Error()})
					return
				}

				// 更新数据库中的用户头像
				if err := db.Model(&models.User{}).Where("id = ?", userID).Update("avatar_url", avatarURL).Error; err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "更新头像信息失败"})
					return
				}

				var user models.User
				_ = db.First(&user, userID)
				c.JSON(http.StatusOK, gin.H{
					"avatar_url": avatarURL,
					"user":       user,
					"message":    "头像上传成功",
				})
			})

			// 移除用户头像（恢复默认）
			authGroup.DELETE("/avatar", auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
				userID := c.MustGet("userID").(uuid.UUID)
				if err := db.Model(&models.User{}).Where("id = ?", userID).Update("avatar_url", "").Error; err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "重置头像失败"})
					return
				}
				var user models.User
				_ = db.First(&user, userID)
				c.JSON(http.StatusOK, gin.H{
					"avatar_url": "",
					"user":       user,
					"message":    "已重置为默认头像",
				})
			})

			// ── MusicBrainz 风格 PAT 管理（外部应用 / Agent 接入） ──
			// 需 JWT 登录态创建，PAT 自身不允许再创建 PAT，避免无限派生
			authGroup.GET("/tokens", auth.AuthMiddleware(cfg), apiKeySvc.List)
			authGroup.POST("/tokens", auth.AuthMiddleware(cfg), apiKeySvc.Create)
			authGroup.DELETE("/tokens/:id", auth.AuthMiddleware(cfg), apiKeySvc.Delete)
		}

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
