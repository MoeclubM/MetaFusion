package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/apikey"
	"github.com/metafusion/metafusion-app/internal/auth"
	"github.com/metafusion/metafusion-app/internal/config"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/storage"
	"gorm.io/gorm"
)

func translateAuthError(c *gin.Context, msg string) string {
	m := map[string]string{
		"用户名与邮箱不能为空":                  backendi18n.T(c, "auth.empty_username_email"),
		"用户名或邮箱已被占用":                  backendi18n.T(c, "auth.username_email_taken"),
		"用户名或密码错误":                    backendi18n.T(c, "auth.wrong_password"),
		"账号已被封禁，请联系管理员":               backendi18n.T(c, "auth.account_banned"),
		"原密码错误":                       backendi18n.T(c, "auth.old_password_wrong"),
		"注册功能已关闭，请联系管理员":              backendi18n.T(c, "auth.registration_closed"),
		"需要邀请码才能注册":                   backendi18n.T(c, "auth.invite_required"),
		"邀请码不能为空":                     backendi18n.T(c, "auth.invite_empty"),
		"无效的邀请码，请向已有成员索取邀请码":          backendi18n.T(c, "auth.invite_invalid"),
		"系统已完成初始化，初始管理员账号已存在":          backendi18n.T(c, "auth.already_initialized"),
		"邮箱已完成验证，无需重复操作":              backendi18n.T(c, "auth.email_already_verified"),
		"验证邮件发送过于频繁，请稍候再试":            backendi18n.T(c, "auth.email_cooldown"),
		"验证码已过期或不存在，请重新发送":            backendi18n.T(c, "auth.verify_code_expired"),
		"验证码不正确，请核对后重试":                backendi18n.T(c, "auth.verify_code_invalid"),
		"验证码格式不正确，需为 6 位数字":            backendi18n.T(c, "auth.verify_code_invalid"),
		"邮箱验证功能暂未开启，请联系管理员":           backendi18n.T(c, "auth.email_verification_disabled"),
		"管理员已开启强制邮箱验证，请先前往个人设置完成邮箱验证": backendi18n.T(c, "auth.email_verification_required"),
	}
	if v, ok := m[msg]; ok {
		return v
	}
	return msg
}

func registerAuthRoutes(
	api *gin.RouterGroup,
	cfg *config.Config,
	db *gorm.DB,
	authSvc *auth.AuthService,
	apiKeySvc *apikey.Service,
	storageSvc *storage.StorageService,
	authBruteLimiter gin.HandlerFunc,
) {
	setupStatusHandler := func(c *gin.Context) {
		status, err := authSvc.GetSetupStatus()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, status)
	}
	setupHandler := func(c *gin.Context) {
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
	}

	// Keep both setup paths for compatibility while sharing one implementation.
	api.GET("/system/setup-status", setupStatusHandler)
	api.POST("/system/setup", authBruteLimiter, setupHandler)

	authGroup := api.Group("/auth")
	authGroup.GET("/setup-status", setupStatusHandler)
	authGroup.POST("/setup", authBruteLimiter, setupHandler)

	authGroup.GET("/settings", func(c *gin.Context) {
		var rows []models.SystemSetting
		_ = db.Find(&rows).Error
		settings := map[string]string{}
		for _, row := range rows {
			settings[row.Key] = row.Value
		}
		if _, ok := settings["registration_enabled"]; !ok {
			settings["registration_enabled"] = "true"
		}
		if _, ok := settings["invite_required"]; !ok {
			settings["invite_required"] = "true"
		}
		if _, ok := settings["email_verification_enabled"]; !ok {
			settings["email_verification_enabled"] = "true"
		}
		emailVerificationEnabled := settings["email_verification_enabled"] != "false"
		requireEmailVerification := emailVerificationEnabled && settings["require_email_verification"] == "true"
		c.JSON(http.StatusOK, gin.H{
			"registration_enabled":       settings["registration_enabled"] != "false",
			"invite_required":            settings["invite_required"] == "true",
			"require_email_verification": requireEmailVerification,
			"email_verification_enabled": emailVerificationEnabled,
			"rate_limit_enabled":         settings["rate_limit_enabled"] != "false",
			"auth_rate_limit_enabled":    settings["auth_rate_limit_enabled"] != "false",
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

	authGroup.POST("/logout", func(c *gin.Context) {
		var req struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = c.ShouldBindJSON(&req)
		if req.RefreshToken != "" {
			_ = authSvc.RevokeToken(req.RefreshToken)
		}
		if parts := strings.SplitN(c.GetHeader("Authorization"), " ", 2); len(parts) == 2 {
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

	authGroup.GET("/invite", auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
		userID := c.MustGet("userID").(uuid.UUID)
		info, err := authSvc.GetUserInviteInfo(userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, info)
	})

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

	authGroup.POST("/send-verification-email", authBruteLimiter, auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
		userID := c.MustGet("userID").(uuid.UUID)
		expiresIn, err := authSvc.SendVerificationEmail(userID, backendi18n.LocaleFromContext(c))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": translateAuthError(c, err.Error())})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message":    backendi18n.T(c, "auth.verification_email_sent"),
			"expires_in": expiresIn,
		})
	})

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

		if header.Size > 5*1024*1024 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "头像图片大小不能超过 5MB"})
			return
		}

		mimeType := header.Header.Get("Content-Type")
		ext := strings.ToLower(filepath.Ext(header.Filename))
		allowedMimes := map[string]bool{
			"image/jpeg": true, "image/png": true, "image/webp": true,
			"image/gif": true, "image/svg+xml": true, "image/avif": true,
		}
		allowedExts := map[string]bool{
			".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
			".gif": true, ".svg": true, ".avif": true,
		}
		if (!allowedMimes[mimeType] && mimeType != "application/octet-stream") || (!allowedExts[ext] && ext != "") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 JPG, PNG, WebP, GIF, SVG, AVIF 格式的图片"})
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
			case ".avif":
				mimeType = "image/avif"
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
			destFile, createErr := os.Create(destPath)
			if createErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "保存本地头像失败"})
				return
			}
			defer destFile.Close()
			if _, copyErr := io.Copy(destFile, file); copyErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "写入本地头像失败"})
				return
			}
			avatarURL = fmt.Sprintf("/uploads/avatars/%s", fileName)
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "头像上传失败: " + err.Error()})
			return
		}

		if err := db.Model(&models.User{}).Where("id = ?", userID).Update("avatar_url", avatarURL).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新头像信息失败"})
			return
		}
		var user models.User
		_ = db.First(&user, userID).Error
		c.JSON(http.StatusOK, gin.H{"avatar_url": avatarURL, "user": user, "message": "头像上传成功"})
	})

	authGroup.DELETE("/avatar", auth.UnifiedAuthMiddleware(cfg, db), func(c *gin.Context) {
		userID := c.MustGet("userID").(uuid.UUID)
		if err := db.Model(&models.User{}).Where("id = ?", userID).Update("avatar_url", "").Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "重置头像失败"})
			return
		}
		var user models.User
		_ = db.First(&user, userID).Error
		c.JSON(http.StatusOK, gin.H{"avatar_url": "", "user": user, "message": "已重置为默认头像"})
	})

	// MusicBrainz-style PAT management is intentionally JWT-only to avoid token chaining.
	authGroup.GET("/tokens", auth.AuthMiddleware(cfg), apiKeySvc.List)
	authGroup.POST("/tokens", auth.AuthMiddleware(cfg), apiKeySvc.Create)
	authGroup.DELETE("/tokens/:id", auth.AuthMiddleware(cfg), apiKeySvc.Delete)
}
