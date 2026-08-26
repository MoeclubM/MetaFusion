package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/config"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/mailer"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	AccessTokenDuration  = 2 * time.Hour         // 短期 Access Token (2小时)
	RefreshTokenDuration = 14 * 24 * time.Hour   // 长期 Refresh Token (14天)
	TokenTypeAccess      = "access"
	TokenTypeRefresh     = "refresh"
)

type memoryCodeEntry struct {
	code      string
	expiresAt time.Time
}

type AuthService struct {
	db       *gorm.DB
	cfg      *config.Config
	rdb      *redis.Client
	mailer   *mailer.Mailer
	memCodes sync.Map
}

func NewAuthService(db *gorm.DB, cfg *config.Config, rdb *redis.Client, mailerSvc ...*mailer.Mailer) *AuthService {
	var m *mailer.Mailer
	if len(mailerSvc) > 0 && mailerSvc[0] != nil {
		m = mailerSvc[0]
	} else {
		m = mailer.NewMailer(db)
	}
	return &AuthService{
		db:     db,
		cfg:    cfg,
		rdb:    rdb,
		mailer: m,
	}
}

type Claims struct {
	UserID    uuid.UUID `json:"user_id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	TokenType string    `json:"token_type,omitempty"` // "access" 或 "refresh"
	jwt.RegisteredClaims
}

type TokenPair struct {
	AccessToken  string       `json:"access_token"`
	RefreshToken string       `json:"refresh_token"`
	ExpiresIn    int64        `json:"expires_in"` // access_token 有效秒数
	TokenType    string       `json:"token_type"` // "Bearer"
	Token        string       `json:"token"`      // 保持向后兼容老客户端 (等同 access_token)
	User         *models.User `json:"user,omitempty"`
}

// GenerateTokenPair 为指定用户生成双 Token 对（Access Token + Refresh Token）
func (s *AuthService) GenerateTokenPair(user *models.User) (*TokenPair, error) {
	now := time.Now()
	accessJti := uuid.New().String()
	refreshJti := uuid.New().String()

	accessClaims := Claims{
		UserID:    user.ID,
		Username:  user.Username,
		Role:      user.Role,
		TokenType: TokenTypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        accessJti,
			Subject:   user.ID.String(),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenDuration)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "metafusion-api",
		},
	}
	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims).SignedString([]byte(s.cfg.JWTSecret))
	if err != nil {
		return nil, fmt.Errorf("failed to sign access token: %w", err)
	}

	refreshClaims := Claims{
		UserID:    user.ID,
		Username:  user.Username,
		Role:      user.Role,
		TokenType: TokenTypeRefresh,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        refreshJti,
			Subject:   user.ID.String(),
			ExpiresAt: jwt.NewNumericDate(now.Add(RefreshTokenDuration)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "metafusion-api",
		},
	}
	refreshToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims).SignedString([]byte(s.cfg.JWTSecret))
	if err != nil {
		return nil, fmt.Errorf("failed to sign refresh token: %w", err)
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(AccessTokenDuration.Seconds()),
		TokenType:    "Bearer",
		Token:        accessToken,
		User:         user,
	}, nil
}

// GenerateToken 保留老签名生成方法，生成标准 Access Token (保持向下兼容)
func (s *AuthService) GenerateToken(user *models.User) (string, error) {
	pair, err := s.GenerateTokenPair(user)
	if err != nil {
		return "", err
	}
	return pair.AccessToken, nil
}

func (s *AuthService) ParseToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(s.cfg.JWTSecret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		// 检查是否在 Redis 吊销黑名单中
		if s.isTokenBlacklisted(claims.ID, claims.UserID.String()) {
			return nil, errors.New("token has been revoked")
		}
		return claims, nil
	}
	return nil, errors.New("invalid token")
}

// isTokenBlacklisted 检查 token ID 或用户级吊销状态
func (s *AuthService) isTokenBlacklisted(jti string, userID string) bool {
	if s.rdb == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if jti != "" {
		exists, err := s.rdb.Exists(ctx, "auth:blacklist:"+jti).Result()
		if err == nil && exists > 0 {
			return true
		}
	}
	return false
}

// RevokeToken 将指定 Token（或其 JTI）置入 Redis 黑名单
func (s *AuthService) RevokeToken(tokenStr string) error {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(s.cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		return nil // 无效 token 无需额外入黑名单
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || claims.ID == "" {
		return nil
	}
	if s.rdb == nil {
		return nil
	}
	ttl := time.Until(claims.ExpiresAt.Time)
	if ttl <= 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.rdb.Set(ctx, "auth:blacklist:"+claims.ID, "revoked", ttl).Err()
}

// RefreshToken 用有效的 Refresh Token 换取全新的 TokenPair，并使原 Refresh Token 失效 (Rotation)
func (s *AuthService) RefreshToken(refreshTokenStr string) (*TokenPair, error) {
	token, err := jwt.ParseWithClaims(refreshTokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(s.cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("invalid or expired refresh token")
	}
	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, errors.New("invalid token claims")
	}

	// 必须为 refresh 类型的 token
	if claims.TokenType != "" && claims.TokenType != TokenTypeRefresh {
		return nil, errors.New("provided token is not a refresh token")
	}

	// 检查黑名单
	if s.isTokenBlacklisted(claims.ID, claims.UserID.String()) {
		return nil, errors.New("refresh token has been revoked")
	}

	// 查询用户最新状态（确保未被封禁或删除）
	var user models.User
	if err := s.db.First(&user, "id = ?", claims.UserID).Error; err != nil {
		return nil, errors.New("user not found")
	}
	if user.Role == "banned" {
		return nil, errors.New("account has been banned")
	}

	// 生成新 Token 对
	pair, err := s.GenerateTokenPair(&user)
	if err != nil {
		return nil, err
	}

	// 吊销使用过的旧 Refresh Token (Rotation 保护)
	_ = s.RevokeToken(refreshTokenStr)

	return pair, nil
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

func isEmailVerificationEnabled(db *gorm.DB) bool {
	var rec models.SystemSetting
	if err := db.Where("key = ?", "email_verification_enabled").First(&rec).Error; err != nil {
		return true
	}
	return rec.Value != "false"
}

func isRequireEmailVerification(db *gorm.DB) bool {
	if !isEmailVerificationEnabled(db) {
		return false
	}
	var rec models.SystemSetting
	if err := db.Where("key = ?", "require_email_verification").First(&rec).Error; err != nil {
		return false
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

func (s *AuthService) RegisterWithPair(input *RegisterInput) (*models.User, *TokenPair, error) {
	if !isRegistrationEnabled(s.db) {
		return nil, nil, errors.New("注册功能已关闭，请联系管理员")
	}
	username := strings.TrimSpace(input.Username)
	email := strings.TrimSpace(input.Email)
	inviteCode := strings.TrimSpace(input.InviteCode)

	if username == "" || email == "" {
		return nil, nil, errors.New("用户名与邮箱不能为空")
	}

	var inviterID *uuid.UUID
	if isInviteRequired(s.db) {
		if inviteCode == "" {
			return nil, nil, errors.New("需要邀请码才能注册")
		}
		id, err := resolveInviterID(s.db, inviteCode)
		if err != nil {
			return nil, nil, err
		}
		inviterID = id
	} else if inviteCode != "" {
		id, err := resolveInviterID(s.db, inviteCode)
		if err != nil {
			return nil, nil, err
		}
		inviterID = id
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, nil, err
	}

	newUserInviteCode := GenerateUserInviteCode()
	var displayName *string
	if input.DisplayName != nil {
		trimmed := strings.TrimSpace(*input.DisplayName)
		if trimmed != "" {
			if len(trimmed) > 64 {
				return nil, nil, errors.New("昵称过长，最多 64 字符")
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
			return nil, nil, errors.New("用户名或邮箱已被占用")
		}
		return nil, nil, err
	}

	pair, err := s.GenerateTokenPair(user)
	return user, pair, err
}

func (s *AuthService) Register(input *RegisterInput) (*models.User, string, error) {
	user, pair, err := s.RegisterWithPair(input)
	if err != nil {
		return nil, "", err
	}
	return user, pair.AccessToken, nil
}

func (s *AuthService) LoginWithPair(input *LoginInput) (*models.User, *TokenPair, error) {
	var user models.User
	err := s.db.Where("email = ? OR username = ?", input.EmailOrUsername, input.EmailOrUsername).First(&user).Error
	if err != nil {
		return nil, nil, errors.New("用户名或密码错误")
	}

	if user.Role == "banned" {
		return nil, nil, errors.New("账号已被封禁，请联系管理员")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
		return nil, nil, errors.New("用户名或密码错误")
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

	pair, err := s.GenerateTokenPair(&user)
	return &user, pair, err
}

func (s *AuthService) Login(input *LoginInput) (*models.User, string, error) {
	user, pair, err := s.LoginWithPair(input)
	if err != nil {
		return nil, "", err
	}
	return user, pair.AccessToken, nil
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

func generateNumericCode(digits int) string {
	max := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "888888"
	}
	return fmt.Sprintf("%0*d", digits, n.Int64())
}

// SendVerificationEmail 生成并发送 6 位邮箱验证码
func (s *AuthService) SendVerificationEmail(userID uuid.UUID, locale string) (int, error) {
	if !isEmailVerificationEnabled(s.db) {
		return 0, errors.New("邮箱验证功能暂未开启，请联系管理员")
	}

	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return 0, errors.New("用户不存在")
	}

	if user.IsEmailVerified {
		return 0, errors.New("邮箱已完成验证，无需重复操作")
	}

	ctx := context.Background()
	cooldownKey := fmt.Sprintf("email_cooldown:%s", userID.String())

	// 频率检查 (60 秒冷却)
	if s.rdb != nil {
		if val, err := s.rdb.Get(ctx, cooldownKey).Result(); err == nil && val != "" {
			return 0, errors.New("验证邮件发送过于频繁，请稍候再试")
		}
	}

	code := generateNumericCode(6)
	expiresIn := 15 * time.Minute

	// 保存验证码到 Redis 或内存
	codeKey := fmt.Sprintf("email_verify:%s", userID.String())
	if s.rdb != nil {
		if err := s.rdb.Set(ctx, codeKey, code, expiresIn).Err(); err != nil {
			return 0, fmt.Errorf("failed to store verification code: %w", err)
		}
		_ = s.rdb.Set(ctx, cooldownKey, "1", 60*time.Second).Err()
	} else {
		s.memCodes.Store(codeKey, memoryCodeEntry{
			code:      code,
			expiresAt: time.Now().Add(expiresIn),
		})
	}

	name := user.Username
	if user.DisplayName != nil && *user.DisplayName != "" {
		name = *user.DisplayName
	}

	if s.mailer != nil {
		if err := s.mailer.SendVerificationEmail(user.Email, name, code, locale); err != nil {
			return 0, fmt.Errorf("邮件发送失败: %w", err)
		}
	}

	return int(expiresIn.Seconds()), nil
}

// VerifyEmail 校验邮箱验证码并标记用户为已验证
func (s *AuthService) VerifyEmail(userID uuid.UUID, code string) (*models.User, error) {
	if !isEmailVerificationEnabled(s.db) {
		return nil, errors.New("邮箱验证功能暂未开启，请联系管理员")
	}

	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return nil, errors.New("验证码格式不正确，需为 6 位数字")
	}

	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return nil, errors.New("用户不存在")
	}

	if user.IsEmailVerified {
		return &user, nil
	}

	ctx := context.Background()
	codeKey := fmt.Sprintf("email_verify:%s", userID.String())

	var validCode string
	if s.rdb != nil {
		val, err := s.rdb.Get(ctx, codeKey).Result()
		if err != nil || val == "" {
			return nil, errors.New("验证码已过期或不存在，请重新发送")
		}
		validCode = val
	} else {
		if val, ok := s.memCodes.Load(codeKey); ok {
			entry := val.(memoryCodeEntry)
			if time.Now().Before(entry.expiresAt) {
				validCode = entry.code
			}
		}
		if validCode == "" {
			return nil, errors.New("验证码已过期或不存在，请重新发送")
		}
	}

	if validCode != code {
		return nil, errors.New("验证码不正确，请核对后重试")
	}

	if err := s.db.Model(&models.User{}).Where("id = ?", userID).Update("is_email_verified", true).Error; err != nil {
		return nil, err
	}

	if s.rdb != nil {
		_ = s.rdb.Del(ctx, codeKey).Err()
	} else {
		s.memCodes.Delete(codeKey)
	}

	user.IsEmailVerified = true
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

// RequireEmailVerified 角色权限与邮箱强制验证复合中间件
func RequireEmailVerified(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isEmailVerificationEnabled(db) || !isRequireEmailVerification(db) {
			c.Next()
			return
		}

		roleVal, exists := c.Get("role")
		if exists {
			if roleStr, ok := roleVal.(string); ok && (roleStr == "admin" || roleStr == "archivist") {
				c.Next()
				return
			}
		}

		userIDVal, exists := c.Get("userID")
		if !exists {
			c.Next()
			return
		}
		userID, ok := userIDVal.(uuid.UUID)
		if !ok {
			c.Next()
			return
		}

		var user models.User
		if err := db.Select("id, is_email_verified").First(&user, "id = ?", userID).Error; err != nil {
			c.Next()
			return
		}

		if !user.IsEmailVerified {
			c.JSON(http.StatusForbidden, gin.H{"error": backendi18n.T(c, "auth.email_verification_required")})
			c.Abort()
			return
		}

		c.Next()
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

func tryJWTAuth(c *gin.Context, cfg *config.Config, db *gorm.DB) bool {
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
		// refresh token 不能用于普通 API 鉴权
		if claims.TokenType == TokenTypeRefresh {
			return false
		}
		if db != nil {
			var user models.User
			if err := db.Select("id, username, role").First(&user, "id = ?", claims.UserID).Error; err != nil {
				return false
			}
			if user.Role == "banned" {
				return false
			}
			c.Set("userID", user.ID)
			c.Set("username", user.Username)
			c.Set("role", user.Role)
			return true
		}
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
		if tryJWTAuth(c, cfg, db) {
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
		if tryJWTAuth(c, cfg, db) {
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

// SetupStatusResponse 系统 OOBE 初始化状态
type SetupStatusResponse struct {
	IsInitialized bool   `json:"is_initialized"`
	HasAdmin      bool   `json:"has_admin"`
	SiteName      string `json:"site_name"`
	TotalUsers    int64  `json:"total_users"`
}

// InitialSetupInput OOBE 首次部署管理员初始化输入
type InitialSetupInput struct {
	Username            string  `json:"username" binding:"required,min=3,max=32"`
	DisplayName         *string `json:"display_name" binding:"omitempty,max=64"`
	Email               string  `json:"email" binding:"required,email"`
	Password            string  `json:"password" binding:"required,min=8"`
	SiteName            string  `json:"site_name" binding:"omitempty,max=64"`
	RegistrationEnabled *bool   `json:"registration_enabled"`
	InviteRequired      *bool   `json:"invite_required"`
}

// GetSetupStatus 获取当前系统是否已经配置初始管理员
func (s *AuthService) GetSetupStatus() (*SetupStatusResponse, error) {
	var adminCount int64
	s.db.Model(&models.User{}).Where("role = ?", "admin").Count(&adminCount)

	var totalUsers int64
	s.db.Model(&models.User{}).Count(&totalUsers)

	siteName := "MetaFusion"
	var setting models.SystemSetting
	if err := s.db.Where("key = ?", "site_name").First(&setting).Error; err == nil && setting.Value != "" {
		siteName = setting.Value
	}

	return &SetupStatusResponse{
		IsInitialized: adminCount > 0,
		HasAdmin:      adminCount > 0,
		SiteName:      siteName,
		TotalUsers:    totalUsers,
	}, nil
}

// PerformInitialSetup 在系统无管理员时执行 OOBE 首次初始化，创建超级管理员
func (s *AuthService) PerformInitialSetup(input *InitialSetupInput) (*models.User, *TokenPair, error) {
	var adminCount int64
	s.db.Model(&models.User{}).Where("role = ?", "admin").Count(&adminCount)
	if adminCount > 0 {
		return nil, nil, errors.New("系统已完成初始化，初始管理员账号已存在")
	}

	username := strings.TrimSpace(input.Username)
	email := strings.TrimSpace(input.Email)
	if username == "" || email == "" {
		return nil, nil, errors.New("用户名与邮箱不能为空")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, nil, err
	}

	var displayName *string
	if input.DisplayName != nil {
		trimmed := strings.TrimSpace(*input.DisplayName)
		if trimmed != "" {
			displayName = &trimmed
		}
	}

	adminUser := &models.User{
		Username:         username,
		DisplayName:      displayName,
		Email:            email,
		PasswordHash:     string(hash),
		Role:             "admin",
		InviteCode:       "MF-ADMIN-2026",
		InvitesRemaining: 9999,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}

	if err := s.db.Create(adminUser).Error; err != nil {
		return nil, nil, fmt.Errorf("创建超级管理员账号失败: %w", err)
	}

	if input.SiteName != "" {
		s.db.Save(&models.SystemSetting{Key: "site_name", Value: strings.TrimSpace(input.SiteName)})
	}
	if input.RegistrationEnabled != nil {
		val := "false"
		if *input.RegistrationEnabled {
			val = "true"
		}
		s.db.Save(&models.SystemSetting{Key: "registration_enabled", Value: val})
	}
	if input.InviteRequired != nil {
		val := "false"
		if *input.InviteRequired {
			val = "true"
		}
		s.db.Save(&models.SystemSetting{Key: "invite_required", Value: val})
	}
	s.db.Save(&models.SystemSetting{Key: "is_initialized", Value: "true"})

	pair, err := s.GenerateTokenPair(adminUser)
	return adminUser, pair, err
}

