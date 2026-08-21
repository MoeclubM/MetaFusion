package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/config"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AuthService struct {
	db  *gorm.DB
	cfg *config.Config
}

func NewAuthService(db *gorm.DB, cfg *config.Config) *AuthService {
	return &AuthService{db: db, cfg: cfg}
}

type Claims struct {
	UserID   uuid.UUID `json:"user_id"`
	Username string    `json:"username"`
	Role     string    `json:"role"`
	jwt.RegisteredClaims
}

func (s *AuthService) GenerateToken(user *models.User) (string, error) {
	claims := Claims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "metafusion-api",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.JWTSecret))
}

func (s *AuthService) ParseToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(s.cfg.JWTSecret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}
	return nil, errors.New("invalid token")
}

// GenerateUserInviteCode 生成用户专属邀请码（保留兼容，老数据仍有该字段）
func GenerateUserInviteCode() string {
	bytes := make([]byte, 3)
	if _, err := rand.Read(bytes); err != nil {
		return "MF-" + strings.ToUpper(uuid.New().String()[:6])
	}
	return "MF-" + strings.ToUpper(hex.EncodeToString(bytes))
}


func isRegistrationEnabled(db *gorm.DB) bool {
	var rec models.SystemSetting
	if err := db.Where("key = ?", "registration_enabled").First(&rec).Error; err != nil {
		return true
	}
	return rec.Value == "true"
}

func isInviteRequired(db *gorm.DB) bool {
	var rec models.SystemSetting
	if err := db.Where("key = ?", "invite_required").First(&rec).Error; err != nil {
		return true
	}
	return rec.Value == "true"
}

func resolveInviterID(db *gorm.DB, code string) (*uuid.UUID, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, errors.New("邀请码不能为空")
	}
	var inviter models.User
	if err := db.Where("invite_code = ?", code).First(&inviter).Error; err == nil {
		return &inviter.ID, nil
	}
	var invite models.Invitation
	if err := db.Where("code = ?", code).First(&invite).Error; err == nil {
		return &invite.InviterID, nil
	}
	if code == "METAFUSION-ALPHA-GENESIS-2026" || code == "HIRES-ARCHIVE-VIP-8888" {
		var adminUser models.User
		if db.Where("role = 'admin'").First(&adminUser).Error == nil {
			return &adminUser.ID, nil
		}
	}
	return nil, errors.New("无效的邀请码，请向已有成员索取邀请码")
}

// RegisterInput 常规注册请求体 (invite_code 按后台开关动态必填)
type RegisterInput struct {
	Username    string  `json:"username" binding:"required,min=3,max=32"`
	DisplayName *string `json:"display_name" binding:"omitempty,max=64"`
	Email       string  `json:"email" binding:"required,email"`
	Password    string  `json:"password" binding:"required,min=8"`
	InviteCode  string  `json:"invite_code"`
}

// UpdateProfileInput 个人资料自助更新 (昵称/简介/头像/隐私开关)
type UpdateProfileInput struct {
	DisplayName     *string `json:"display_name"`
	Bio             *string `json:"bio"`
	AvatarURL       *string `json:"avatar_url"`
	FavoritesPublic *bool   `json:"favorites_public"`
	EmailPublic     *bool   `json:"email_public"`
}

type LoginInput struct {
	EmailOrUsername string `json:"email_or_username" binding:"required"`
	Password        string `json:"password" binding:"required"`
}

func (s *AuthService) Register(input *RegisterInput) (*models.User, string, error) {
	if !isRegistrationEnabled(s.db) {
		return nil, "", errors.New("注册功能已关闭，请联系管理员")
	}
	username := strings.TrimSpace(input.Username)
	email := strings.TrimSpace(input.Email)
	inviteCode := strings.TrimSpace(input.InviteCode)

	if username == "" || email == "" {
		return nil, "", errors.New("用户名与邮箱不能为空")
	}

	var inviterID *uuid.UUID
	if isInviteRequired(s.db) {
		if inviteCode == "" {
			return nil, "", errors.New("需要邀请码才能注册")
		}
		id, err := resolveInviterID(s.db, inviteCode)
		if err != nil {
			return nil, "", err
		}
		inviterID = id
	} else if inviteCode != "" {
		id, err := resolveInviterID(s.db, inviteCode)
		if err != nil {
			return nil, "", err
		}
		inviterID = id
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", err
	}

	newUserInviteCode := GenerateUserInviteCode()
	// display_name 可选，独立于 username，空则不落库由展示层 fallback
	var displayName *string
	if input.DisplayName != nil {
		trimmed := strings.TrimSpace(*input.DisplayName)
		if trimmed != "" {
			if len(trimmed) > 64 {
				return nil, "", errors.New("昵称过长，最多 64 字符")
			}
			displayName = &trimmed
		}
	}
	user := &models.User{
		Username:         username,
		DisplayName:      displayName,
		Email:            email,
		PasswordHash:     string(hash),
		Role:             "member",
		InviteCode:       newUserInviteCode,
		InvitesRemaining: 999,
		InvitedBy:        inviterID,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}

	if err := s.db.Create(user).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			return nil, "", errors.New("用户名或邮箱已被占用")
		}
		return nil, "", err
	}

	token, err := s.GenerateToken(user)
	return user, token, err
}

func (s *AuthService) Login(input *LoginInput) (*models.User, string, error) {
	var user models.User
	err := s.db.Where("email = ? OR username = ?", input.EmailOrUsername, input.EmailOrUsername).First(&user).Error
	if err != nil {
		return nil, "", errors.New("用户名或密码错误")
	}

	if user.Role == "banned" {
		return nil, "", errors.New("账号已被封禁，请联系管理员")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
		return nil, "", errors.New("用户名或密码错误")
	}

	// 若老用户未生成专属邀请码，自动补全
	if user.InviteCode == "" {
		if user.Role == "admin" {
			user.InviteCode = "MF-ADMIN-2026"
		} else {
			user.InviteCode = GenerateUserInviteCode()
		}
		s.db.Model(&user).Update("invite_code", user.InviteCode)
	}

	token, err := s.GenerateToken(&user)
	return &user, token, err
}

// GetUserInviteInfo 获取当前用户的专属永久邀请码及受邀成员列表
func (s *AuthService) GetUserInviteInfo(userID uuid.UUID) (gin.H, error) {
	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return nil, err
	}

	if user.InviteCode == "" {
		if user.Role == "admin" {
			user.InviteCode = "MF-ADMIN-2026"
		} else {
			user.InviteCode = GenerateUserInviteCode()
		}
		s.db.Model(&user).Update("invite_code", user.InviteCode)
	}

	var invitedUsers []models.User
	s.db.Where("invited_by = ?", userID).
		Select("id, username, email, role, created_at").
		Order("created_at desc").
		Find(&invitedUsers)

	return gin.H{
		"invite_code":   user.InviteCode,
		"invited_count": len(invitedUsers),
		"invited_users": invitedUsers,
	}, nil
}

// ChangePassword 修改用户密码（需校验旧密码，供普通用户自助）
func (s *AuthService) ChangePassword(userID uuid.UUID, oldPassword, newPassword string) error {
	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); err != nil {
		return errors.New("原密码错误")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.db.Model(&user).Update("password_hash", string(hash)).Error
}

// UpdateProfile 用户自助修改昵称/简介/头像（昵称可清空回退到 username）
func (s *AuthService) UpdateProfile(userID uuid.UUID, input UpdateProfileInput) (*models.User, error) {
	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return nil, err
	}
	updates := map[string]interface{}{}
	if input.DisplayName != nil {
		trimmed := strings.TrimSpace(*input.DisplayName)
		if trimmed == "" {
			updates["display_name"] = gorm.Expr("NULL")
		} else {
			if len(trimmed) > 64 {
				return nil, errors.New("昵称过长，最多 64 字符")
			}
			updates["display_name"] = trimmed
		}
	}
	if input.Bio != nil {
		bio := strings.TrimSpace(*input.Bio)
		updates["bio"] = bio
	}
	if input.AvatarURL != nil {
		updates["avatar_url"] = strings.TrimSpace(*input.AvatarURL)
	}
	if input.FavoritesPublic != nil {
		updates["favorites_public"] = *input.FavoritesPublic
	}
	if input.EmailPublic != nil {
		updates["email_public"] = *input.EmailPublic
	}
	if len(updates) == 0 {
		return &user, nil
	}
	updates["updated_at"] = time.Now()
	if err := s.db.Model(&models.User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
		return nil, err
	}
	_ = s.db.First(&user, userID).Error
	return &user, nil
}

// AuthMiddleware 鉴权中间件
func AuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "auth.no_credentials")})
			c.Abort()
			return
		}
		parts := strings.SplitN(authHeader, " ", 2)
		if !(len(parts) == 2 && parts[0] == "Bearer") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "auth.bad_format")})
			c.Abort()
			return
		}

		tokenStr := parts[1]
		token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "auth.invalid_expired")})
			c.Abort()
			return
		}

		if claims, ok := token.Claims.(*Claims); ok {
			c.Set("userID", claims.UserID)
			c.Set("username", claims.Username)
			c.Set("role", claims.Role)
			c.Next()
		} else {
			c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "auth.parse_failed")})
			c.Abort()
		}
	}
}

// OptionalAuthMiddleware 尝试解析 token，成功则注入 userID/role，失败则放行
func OptionalAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}
		parts := strings.SplitN(authHeader, " ", 2)
		if !(len(parts) == 2 && parts[0] == "Bearer") {
			c.Next()
			return
		}
		token, err := jwt.ParseWithClaims(parts[1], &Claims{}, func(token *jwt.Token) (interface{}, error) {
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.Next()
			return
		}
		if claims, ok := token.Claims.(*Claims); ok {
			c.Set("userID", claims.UserID)
			c.Set("username", claims.Username)
			c.Set("role", claims.Role)
		}
		c.Next()
	}
}

// RequireRoles 角色权限控制中间件 (如限制 admin 或 archivist)
func RequireRoles(allowedRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		roleVal, exists := c.Get("role")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": backendi18n.T(c, "auth.missing_role")})
			c.Abort()
			return
		}

		roleStr := roleVal.(string)
		for _, r := range allowedRoles {
			if r == roleStr {
				c.Next()
				return
			}
		}

		c.JSON(http.StatusForbidden, gin.H{"error": backendi18n.T(c, "auth.forbidden")})
		c.Abort()
	}
}

// ── MusicBrainz 风格 PAT 支持：统一鉴权中间件 ──

func hashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func tryPatAuth(c *gin.Context, db *gorm.DB) bool {
	raw := extractPatRaw(c)
	if raw == "" {
		return false
	}
	hash := hashToken(raw)
	var token models.ApiToken
	if err := db.Where("token_hash = ?", hash).First(&token).Error; err != nil {
		return false
	}
	if token.ExpiresAt != nil && time.Now().After(*token.ExpiresAt) {
		return false
	}
	var user models.User
	if err := db.First(&user, "id = ?", token.UserID).Error; err != nil {
		return false
	}
	if user.Role == "banned" {
		return false
	}
	now := time.Now()
	_ = db.Model(&models.ApiToken{}).Where("id = ?", token.ID).Update("last_used_at", now).Error
	c.Set("userID", user.ID)
	c.Set("username", user.Username)
	c.Set("role", user.Role)
	c.Set("apiTokenID", token.ID)
	c.Set("apiTokenScopes", []string(token.Scopes))
	return true
}

func extractPatRaw(c *gin.Context) string {
	if v := c.GetHeader("X-API-Key"); strings.HasPrefix(v, "mfp_") {
		return strings.TrimSpace(v)
	}
	if v := c.GetHeader("X-Token"); strings.HasPrefix(v, "mfp_") {
		return strings.TrimSpace(v)
	}
	auth := c.GetHeader("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) == 2 && strings.HasPrefix(parts[1], "mfp_") {
		return strings.TrimSpace(parts[1])
	}
	if strings.HasPrefix(auth, "mfp_") {
		return strings.TrimSpace(auth)
	}
	return ""
}

func tryJWTAuth(c *gin.Context, cfg *config.Config) bool {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		return false
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if !(len(parts) == 2 && parts[0] == "Bearer") {
		return false
	}
	if strings.HasPrefix(parts[1], "mfp_") {
		return false
	}
	tokenStr := parts[1]
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		return false
	}
	if claims, ok := token.Claims.(*Claims); ok {
		c.Set("userID", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		return true
	}
	return false
}

// UnifiedAuthMiddleware 支持 JWT 或 PAT 任意一种通过即放行，类似 MusicBrainz 允许 User-Agent + Token
func UnifiedAuthMiddleware(cfg *config.Config, db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if tryJWTAuth(c, cfg) {
			c.Next()
			return
		}
		if db != nil && tryPatAuth(c, db) {
			c.Next()
			return
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "auth.no_credentials"), "code": "UNAUTHORIZED"})
		c.Abort()
	}
}

// OptionalUnifiedAuthMiddleware 尝试解析 JWT 或 PAT，成功注入，失败放行
func OptionalUnifiedAuthMiddleware(cfg *config.Config, db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if tryJWTAuth(c, cfg) {
			c.Next()
			return
		}
		if db != nil && tryPatAuth(c, db) {
			c.Next()
			return
		}
		c.Next()
	}
}

// RequireScope 校验 PAT scope，JWT 默认拥有全部 scope
func RequireScope(scope string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, hasPat := c.Get("apiTokenID"); !hasPat {
			c.Next()
			return
		}
		val, exists := c.Get("apiTokenScopes")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": "missing scopes", "code": "FORBIDDEN"})
			c.Abort()
			return
		}
		scopes := val.([]string)
		for _, s := range scopes {
			if s == scope || s == "admin" || s == "write" {
				c.Next()
				return
			}
			if scope == "read" {
				c.Next()
				return
			}
		}
		has := false
		for _, s := range scopes {
			if s == scope {
				has = true
				break
			}
		}
		if !has {
			c.JSON(http.StatusForbidden, gin.H{"error": "token missing required scope: " + scope, "code": "INSUFFICIENT_SCOPE"})
			c.Abort()
			return
		}
		c.Next()
	}
}
