package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
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
	"github.com/metafusion/metafusion-app/internal/favorite"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/importer"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/openapi"
	"github.com/metafusion/metafusion-app/internal/plugin"
	"github.com/metafusion/metafusion-app/internal/ratelimit"
	"github.com/metafusion/metafusion-app/internal/search"
	"github.com/metafusion/metafusion-app/internal/storage"
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

	// 2. 初始化 Redis Asynq 任务客户端
	asynqClient := asynq.NewClient(asynq.RedisClientOpt{Addr: cfg.RedisAddr})
	defer asynqClient.Close()

	searchSvc, err := search.NewSearchService(cfg, db)
	if err != nil {
		log.Printf("Search service warning: %v", err)
	}

	// 3. 初始化各模块服务
	authSvc := auth.NewAuthService(db, cfg)
	catalogSvc := catalog.NewCatalogService(db)
	communitySvc := community.NewCommunityService(db)
	messageSvc := community.NewMessageService(db)
	adminSvc := admin.NewAdminService(db, searchSvc)
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
	limiter := ratelimit.New(60, 600)
	r.Use(limiter.Middleware())

	// 生产健康检查探针体系 (Liveness & Readiness Probes)
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "live", "service": "metafusion-backend"})
	})
	r.GET("/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "live", "service": "metafusion-backend"})
	})
	r.GET("/ready", func(c *gin.Context) {
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
		if err := asynqClient.Ping(); err != nil {
			checks["redis"] = "unhealthy"
			allHealthy = false
		} else {
			checks["redis"] = "healthy"
		}

		if allHealthy {
			c.JSON(http.StatusOK, gin.H{"status": "ready", "checks": checks})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy", "checks": checks})
		}
	})
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "metafusion-backend"})
	})
	r.GET("/api/v1/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "metafusion-backend"})
	})
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "metafusion-backend"})
	})

	// 静态本地上传目录路由（支持离线开发与回退）
	_ = os.MkdirAll("./uploads/avatars", 0755)
	r.Static("/uploads", "./uploads")

	// OpenAPI 3.1 规范 — 类似 MusicBrainz 的文档化可发现性
	r.GET("/api/v1/openapi.json", openapi.Handler())
	r.GET("/api/openapi.json", openapi.Handler())

	api := r.Group("/api/v1")
	{
		// 认证与专属邀请码
		authGroup := api.Group("/auth")
		{
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
				c.JSON(http.StatusOK, gin.H{
					"registration_enabled": m["registration_enabled"] == "true",
					"invite_required":      m["invite_required"] == "true",
				})
			})

			authGroup.POST("/register", func(c *gin.Context) {
				var input auth.RegisterInput
				if err := c.ShouldBindJSON(&input); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				user, token, err := authSvc.Register(&input)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": translateAuthError(c, err.Error())})
					return
				}
				c.JSON(http.StatusOK, gin.H{"user": user, "token": token})
			})

			authGroup.POST("/login", func(c *gin.Context) {
				var input auth.LoginInput
				if err := c.ShouldBindJSON(&input); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				user, token, err := authSvc.Login(&input)
				if err != nil {
					c.JSON(http.StatusUnauthorized, gin.H{"error": translateAuthError(c, err.Error())})
					return
				}
				c.JSON(http.StatusOK, gin.H{"user": user, "token": token})
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

		// 图书馆级编目与分类（读操作公开/可选鉴权，写操作强制统一鉴权）
		catGroup := api.Group("/catalog")
		{
			catGroup.GET("/taxonomy", catalogSvc.GetTaxonomy)
			catGroup.GET("/relation-types", catalogSvc.ListRelationTypes)
			catGroup.GET("/shelves", catalogSvc.ListShelves)
			catGroup.GET("/categories", catalogSvc.ListCategories)
			catGroup.GET("/tags", catalogSvc.ListTags)
			catGroup.GET("/artists", catalogSvc.ListArtists)
			catGroup.GET("/artists/:id", catalogSvc.GetArtistDetail)
			catGroup.GET("/artists/:id/graph", catalogSvc.GetArtistGraph)
			catGroup.GET("/franchises", catalogSvc.ListFranchises)
			catGroup.GET("/franchises/:id", catalogSvc.GetFranchiseDetail)
			catGroup.GET("/franchises/:id/graph", catalogSvc.GetFranchiseGraph)
			catGroup.GET("/works", catalogSvc.ListWorks)
			catGroup.GET("/works/:id", catalogSvc.GetWorkDetail)
			catGroup.GET("/works/:id/graph", catalogSvc.GetWorkGraph)
			catGroup.GET("/works/:id/comments", communitySvc.ListWorkComments)
			catGroup.POST("/works/:id/comments", auth.UnifiedAuthMiddleware(cfg, db), communitySvc.CreateWorkComment)
			catGroup.GET("/releases", catalogSvc.ListReleases)
			catGroup.GET("/releases/:id", catalogSvc.GetReleaseDetail)
			catGroup.GET("/mediums/:id", catalogSvc.GetMediumDetail)
			catGroup.POST("/artists", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.CreateArtistForMember)
			catGroup.PUT("/artists/:id", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.UpdateArtistForMember)
			catGroup.POST("/franchises", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.CreateFranchiseForMember)
			catGroup.PUT("/franchises/:id", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.UpdateFranchiseForMember)
			catGroup.POST("/works", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.CreateWorkForMember)
			catGroup.PUT("/works/:id", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.UpdateWorkForMember)
			catGroup.POST("/releases", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.CreateReleaseForMember)
			catGroup.PUT("/releases/:id", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.UpdateReleaseForMember)
			catGroup.POST("/mediums", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.CreateMediumForMember)
			catGroup.POST("/tracks", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.CreateTrackForMember)
			catGroup.PUT("/works/:id/relations", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.UpsertWorkRelationsForMember)
			catGroup.PUT("/entity-relations", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.UpsertEntityRelationsForMember)
			catGroup.GET("/revisions", catalogSvc.ListEntityRevisions)
			catGroup.POST("/merge", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.MergeEntities)
			catGroup.POST("/submit", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.SubmitComprehensiveArchive)
			// 用户自建推荐分组（私有默认，可设公开）
			catGroup.GET("/shelves/custom", auth.OptionalUnifiedAuthMiddleware(cfg, db), catalogSvc.ListCustomShelves)
			catGroup.POST("/shelves/custom", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.CreateCustomShelf)
			catGroup.POST("/shelves/custom/sync-presets", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.SyncPresetShelves)
			catGroup.POST("/shelves/custom/ensure-defaults", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.EnsureDefaultShelves)
			catGroup.POST("/shelves/custom/reset-defaults", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.ResetDefaultShelves)
			catGroup.POST("/shelves/custom/fork/:slug", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.ForkPresetShelf)
			catGroup.GET("/shelves/custom/:id", auth.OptionalUnifiedAuthMiddleware(cfg, db), catalogSvc.GetCustomShelf)
			catGroup.PUT("/shelves/custom/:id", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.UpdateCustomShelf)
			catGroup.DELETE("/shelves/custom/:id", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.DeleteCustomShelf)
			// 个人首页布局
			catGroup.GET("/home/layout", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.GetHomeLayout)
			catGroup.PUT("/home/layout", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.PutHomeLayout)
		}

		// ── MusicBrainz WS/2 兼容浏览层（开放读取） ──
		browse := api.Group("/browse", auth.OptionalUnifiedAuthMiddleware(cfg, db))
		{
			browse.GET("/works", catalogSvc.BrowseWorks)
			browse.GET("/releases", catalogSvc.BrowseReleases)
			browse.GET("/artists", catalogSvc.BrowseArtists)
			browse.GET("/franchises", catalogSvc.ListFranchises)
		}

		// ── 多源权威数字馆藏一键导入套件 (OmniSource Importer: MusicBrainz / TMDB / IMDb / Bangumi) ──
		importerGroup := api.Group("/importer")
		{
			importerGroup.POST("/preview", auth.OptionalUnifiedAuthMiddleware(cfg, db), importerSvc.PreviewHandler)
			importerGroup.POST("/import", auth.UnifiedAuthMiddleware(cfg, db), importerSvc.ImportHandler)
		}

		// ── 插件中心公开接口与数据导出 ──
		api.GET("/plugins", auth.OptionalUnifiedAuthMiddleware(cfg, db), pluginHandler.ListPublicPlugins)
		api.GET("/export/:format/:id", auth.OptionalUnifiedAuthMiddleware(cfg, db), pluginHandler.ExportWorkHandler)

		ws2 := api.Group("/ws/2", auth.OptionalUnifiedAuthMiddleware(cfg, db))
		{
			ws2.GET("/work/:id", catalogSvc.GetWorkDetail)
			ws2.GET("/release/:id", catalogSvc.GetReleaseDetail)
			ws2.GET("/artist/:id", catalogSvc.GetArtistDetail)
			ws2.GET("/franchise/:id", catalogSvc.GetFranchiseDetail)
			ws2.GET("/work", catalogSvc.ListWorks)
			ws2.GET("/release", catalogSvc.ListReleases)
			ws2.GET("/artist", catalogSvc.ListArtists)
			ws2.GET("/franchise", catalogSvc.ListFranchises)
		}

		// 分片直传与对象存储（统一鉴权）
		if storageSvc != nil {
			storageGroup := api.Group("/storage", auth.UnifiedAuthMiddleware(cfg, db))
			{
				storageGroup.POST("/upload/initiate", func(c *gin.Context) {
					var req storage.InitiateUploadRequest
					if err := c.ShouldBindJSON(&req); err != nil {
						c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
						return
					}
					resp, err := storageSvc.InitiateUpload(c.Request.Context(), &req)
					if err != nil {
						c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
						return
					}
					c.JSON(http.StatusOK, resp)
				})

				storageGroup.POST("/upload/complete", func(c *gin.Context) {
					var req storage.CompleteUploadRequest
					if err := c.ShouldBindJSON(&req); err != nil {
						c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
						return
					}
					if err := storageSvc.CompleteUpload(c.Request.Context(), &req); err != nil {
						c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
						return
					}
					c.JSON(http.StatusOK, gin.H{"message": "Upload completed, transcoding started"})
				})

					storageGroup.GET("/download/:asset_id", func(c *gin.Context) {
						assetID, err := uuid.Parse(c.Param("asset_id"))
						if err != nil {
							c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid asset ID"})
							return
						}
						downloadURL, err := storageSvc.GetDownloadURL(c.Request.Context(), assetID)
						if err != nil {
							c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
							return
						}
						c.JSON(http.StatusOK, gin.H{"download_url": downloadURL})
					})

					// 资产挂载绑定接口 (Asset Polymorphic Bindings)
					storageGroup.POST("/bind", func(c *gin.Context) {
						var input struct {
							AssetID          uuid.UUID `json:"asset_id" binding:"required"`
							TargetEntityType string    `json:"target_entity_type" binding:"required"`
							TargetEntityID   uuid.UUID `json:"target_entity_id" binding:"required"`
							BindingRole      string    `json:"binding_role"`
						}
						if err := c.ShouldBindJSON(&input); err != nil {
							c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
							return
						}
						bindingRole := input.BindingRole
						if bindingRole == "" {
							bindingRole = "master_archive"
						}
						binding := models.AssetBinding{
							AssetID:          input.AssetID,
							TargetEntityType: input.TargetEntityType,
							TargetEntityID:   input.TargetEntityID,
							BindingRole:      bindingRole,
						}
						if err := db.Where("asset_id = ? AND target_entity_type = ? AND target_entity_id = ? AND binding_role = ?",
							input.AssetID, input.TargetEntityType, input.TargetEntityID, bindingRole).FirstOrCreate(&binding).Error; err != nil {
							c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
							return
						}
						c.JSON(http.StatusOK, gin.H{"status": "bound", "binding": binding})
					})
			}
		}

		// 用户公开资料与贡献历史（开放浏览；处理器内部按隐私开关过滤邮箱/收藏）
		api.GET("/users/:id", auth.OptionalUnifiedAuthMiddleware(cfg, db), community.GetUserProfile(db))
		api.GET("/users/:id/contributions", auth.OptionalUnifiedAuthMiddleware(cfg, db), community.GetUserContributions(db))

		// 用户收藏：切换 / 批量状态 / 本人列表 / 他人列表（尊重隐私开关）
		favGroup := api.Group("/favorites")
		{
			favGroup.POST("/toggle", auth.UnifiedAuthMiddleware(cfg, db), favorite.Toggle(db))
			favGroup.GET("/status", auth.UnifiedAuthMiddleware(cfg, db), favorite.Status(db))
			favGroup.GET("/mine", auth.UnifiedAuthMiddleware(cfg, db), favorite.ListMy(db))
		}
		api.GET("/users/:id/favorites", auth.UnifiedAuthMiddleware(cfg, db), favorite.ListByUser(db))

		// 用户私聊消息 (Direct Messaging)
		messagesGroup := api.Group("/messages", auth.UnifiedAuthMiddleware(cfg, db))
		{
			messagesGroup.POST("/with/:user_id", messageSvc.SendMessage)
			messagesGroup.GET("/with/:user_id", messageSvc.GetMessagesWithUser)
			messagesGroup.GET("/conversations", messageSvc.ListConversations)
			messagesGroup.GET("/unread-count", messageSvc.GetUnreadCount)
		}

		// 社区讨论与文献评注 (Discourse 论坛 - 统一鉴权)
		communityGroup := api.Group("/community", auth.UnifiedAuthMiddleware(cfg, db))
		{
			communityGroup.GET("/boards", communitySvc.ListBoards)
			communityGroup.GET("/topic-tags", communitySvc.ListTopicTags)
			communityGroup.GET("/topics", communitySvc.ListTopics)
			communityGroup.GET("/topics/:id", communitySvc.GetTopic)
			communityGroup.POST("/topics", communitySvc.CreateTopic)
			communityGroup.POST("/topics/:id/posts", communitySvc.CreatePost)
		}

		// 全文与多维检索 — MusicBrainz 搜索对等，支持 inc 与多类型（开放检索）
		if searchSvc != nil {
			api.GET("/search", auth.OptionalUnifiedAuthMiddleware(cfg, db), searchSvc.SearchWorks)
			api.GET("/ws/2/search", auth.OptionalUnifiedAuthMiddleware(cfg, db), searchSvc.SearchWorks)
		}

		// 管理后台专用 API (限 admin / archivist 权限)
		adminGroup := api.Group("/admin", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireRoles("admin", "archivist"))
		{
			adminGroup.GET("/stats", adminSvc.GetStats)
			adminGroup.GET("/users", adminSvc.ListUsers)
			adminGroup.PUT("/users/:id", adminSvc.UpdateUser)
			adminGroup.PUT("/users/:id/role", adminSvc.UpdateUserRole)
			// 作品
			adminGroup.GET("/works", adminSvc.ListWorks)
			adminGroup.POST("/works", adminSvc.CreateWork)
			adminGroup.PUT("/works/:id", adminSvc.UpdateWork)
			adminGroup.PUT("/works/:id/status", adminSvc.UpdateWorkStatus)
			adminGroup.DELETE("/works/:id", adminSvc.DeleteWork)
			// 发行版
			adminGroup.GET("/releases", adminSvc.ListReleasesAdmin)
			adminGroup.POST("/releases", adminSvc.CreateRelease)
			adminGroup.PUT("/releases/:id", adminSvc.UpdateRelease)
			adminGroup.PUT("/releases/:id/verify", adminSvc.ToggleReleaseVerification)
			adminGroup.DELETE("/releases/:id", adminSvc.DeleteRelease)
			// 载体 / 曲目
			adminGroup.POST("/mediums", adminSvc.CreateMedium)
			adminGroup.DELETE("/mediums/:id", adminSvc.DeleteMedium)
			adminGroup.POST("/tracks", adminSvc.CreateTrack)
			adminGroup.DELETE("/tracks/:id", adminSvc.DeleteTrack)
			// 虚拟货架 / 分类 / 标签 / 艺术家 / 母版
			adminGroup.GET("/shelves", adminSvc.ListVirtualShelves)
			adminGroup.POST("/shelves", adminSvc.CreateVirtualShelf)
			adminGroup.PUT("/shelves/:slug", adminSvc.UpdateVirtualShelf)
			adminGroup.DELETE("/shelves/:slug", adminSvc.DeleteVirtualShelf)
			adminGroup.GET("/categories", adminSvc.ListCategoriesAdmin)
			adminGroup.PUT("/categories", adminSvc.UpsertCategory)
			adminGroup.DELETE("/categories/:code", adminSvc.DeleteCategory)
			adminGroup.GET("/tags", adminSvc.ListTagsAdmin)
			adminGroup.POST("/tags", adminSvc.CreateTag)
			adminGroup.DELETE("/tags/:id", adminSvc.DeleteTag)
			adminGroup.GET("/artists", adminSvc.ListArtistsAdmin)
			adminGroup.POST("/artists", adminSvc.CreateArtist)
			adminGroup.PUT("/artists/:id", adminSvc.UpdateArtist)
			adminGroup.DELETE("/artists/:id", adminSvc.DeleteArtist)
			adminGroup.GET("/franchises", catalogSvc.ListFranchises)
			adminGroup.POST("/franchises", catalogSvc.CreateFranchiseForMember)
			adminGroup.DELETE("/franchises/:id", adminSvc.DeleteFranchise)
			adminGroup.GET("/canonical-entries", adminSvc.ListCanonicalEntries)
			adminGroup.POST("/canonical-entries", adminSvc.CreateCanonicalEntry)
			adminGroup.PUT("/canonical-entries/:id", adminSvc.UpdateCanonicalEntry)
			adminGroup.DELETE("/canonical-entries/:id", adminSvc.DeleteCanonicalEntry)
			adminGroup.GET("/invitations", adminSvc.ListInvitations)
			// 资产
			adminGroup.GET("/assets", adminSvc.ListAssetFiles)
			adminGroup.GET("/assets/:id", adminSvc.GetAssetDetail)
			adminGroup.POST("/assets/:id/retry", adminSvc.RetryAsset)
			// 社区
			adminGroup.GET("/topics", adminSvc.ListTopicsAdmin)
			adminGroup.DELETE("/topics/:id", adminSvc.DeleteTopic)
			adminGroup.PUT("/topics/:id", adminSvc.UpdateTopic)
			adminGroup.GET("/comments", adminSvc.ListCommentsAdmin)
			adminGroup.DELETE("/comments/:id", adminSvc.DeleteComment)
			// 板块
			adminGroup.GET("/boards", adminSvc.ListBoardsAdmin)
			adminGroup.PUT("/boards", adminSvc.UpsertBoard)
			adminGroup.PUT("/boards/:code", adminSvc.UpdateBoard)
			adminGroup.PATCH("/boards/:code", adminSvc.PatchBoard)
			adminGroup.DELETE("/boards/:code", adminSvc.DeleteBoard)
			// 标签编辑
			adminGroup.PUT("/tags/:id", adminSvc.UpdateTag)
			// 用户批量与用户组
			adminGroup.PUT("/users/roles/batch", adminSvc.BatchUpdateUserRoles)
			adminGroup.GET("/user-groups", adminSvc.ListUserGroups)
			adminGroup.POST("/user-groups", adminSvc.CreateUserGroup)
			adminGroup.PUT("/user-groups/:id", adminSvc.UpdateUserGroup)
			adminGroup.DELETE("/user-groups/:id", adminSvc.DeleteUserGroup)
			adminGroup.POST("/user-groups/:id/members", adminSvc.AddUserToGroup)
			adminGroup.DELETE("/user-groups/:id/members/:user_id", adminSvc.RemoveUserFromGroup)
				// 实体关系与动态关系类型、实体类型定义
				adminGroup.PUT("/works/:id/relations", adminSvc.UpsertWorkRelations)
				adminGroup.PUT("/entity-relations", adminSvc.UpsertEntityRelations)
				adminGroup.GET("/relation-types", adminSvc.ListRelationTypesAdmin)
				adminGroup.POST("/relation-types", adminSvc.CreateRelationType)
				adminGroup.PUT("/relation-types/:code", adminSvc.UpdateRelationType)
				adminGroup.DELETE("/relation-types/:code", adminSvc.DeleteRelationType)
				adminGroup.GET("/entity-types", adminSvc.ListEntityTypesAdmin)
				adminGroup.POST("/entity-types", adminSvc.CreateEntityType)
				adminGroup.PUT("/entity-types/:code", adminSvc.UpdateEntityType)
				adminGroup.DELETE("/entity-types/:code", adminSvc.DeleteEntityType)
			// 内容多语言翻译
			adminGroup.GET("/translations/works/:id", adminSvc.ListWorkTranslations)
			adminGroup.PUT("/translations/works/:id", adminSvc.UpsertWorkTranslations)
			adminGroup.GET("/translations/topics/:id", adminSvc.ListTopicTranslations)
			adminGroup.PUT("/translations/topics/:id", adminSvc.UpsertTopicTranslations)
			adminGroup.GET("/translations/tags/:id", adminSvc.ListTagTranslations)
			adminGroup.PUT("/translations/tags/:id", adminSvc.UpsertTagTranslations)
			adminGroup.GET("/translations/artists/:id", adminSvc.ListArtistTranslations)
			adminGroup.PUT("/translations/artists/:id", adminSvc.UpsertArtistTranslations)
			// 站点开关：注册 / 邀请（后台可控）
			adminGroup.GET("/settings", adminSvc.GetSystemSettings)
			adminGroup.PUT("/settings", adminSvc.UpdateSystemSettings)
			// 审计与系统
			adminGroup.GET("/audit-logs", adminSvc.ListAuditLogs)
			adminGroup.GET("/system/health", adminSvc.GetSystemHealth)
			// 插件管理中心 (Plugin Center)
			adminGroup.GET("/plugins", pluginHandler.ListAdminPlugins)
			adminGroup.GET("/plugins/:id", pluginHandler.GetAdminPlugin)
			adminGroup.POST("/plugins", pluginHandler.RegisterExternalPlugin)
			adminGroup.PUT("/plugins/:id", pluginHandler.UpdatePlugin)
			adminGroup.DELETE("/plugins/:id", pluginHandler.DeletePlugin)
			adminGroup.POST("/plugins/:id/test", pluginHandler.TestPluginHealth)
			adminGroup.POST("/plugins/test-notify", pluginHandler.TestNotify)
		}
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
