package apikey

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

const (
	Prefix     = "mfp_"
	RawLength  = 32 // 32 bytes -> 64 hex chars
	PrefixShow = 8  // 可见前缀长度
)

var ValidScopes = map[string]bool{
	"read":      true,
	"write":     true,
	"edit":      true,
	"upload":    true,
	"community": true,
	"admin":     true,
}

type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func generateRawToken() (string, error) {
	b := make([]byte, RawLength)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return Prefix + hex.EncodeToString(b), nil
}

func hashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

// Create 创建新 PAT，明文仅返回一次
func (s *Service) Create(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "code": "NO_CREDENTIALS"})
		return
	}
	userID := userIDVal.(uuid.UUID)

	var req struct {
		Name      string   `json:"name" binding:"required,min=1,max=64"`
		Scopes    []string `json:"scopes"`
		ExpiresAt *string  `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "BAD_REQUEST"})
		return
	}
	if req.Scopes == nil || len(req.Scopes) == 0 {
		req.Scopes = []string{"read", "write", "edit", "community", "upload"}
	}
	for _, sc := range req.Scopes {
		if !ValidScopes[sc] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scope: " + sc, "code": "INVALID_SCOPE"})
			return
		}
	}

	raw, err := generateRawToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token", "code": "INTERNAL"})
		return
	}
	hash := hashToken(raw)
	prefix := raw
	if len(raw) > len(Prefix)+PrefixShow {
		prefix = raw[:len(Prefix)+PrefixShow]
	}

	var expiresAt *time.Time
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "expires_at must be RFC3339", "code": "BAD_REQUEST"})
			return
		}
		expiresAt = &t
	}

	// 限制每用户最多 10 个 token
	var count int64
	s.db.Model(&models.ApiToken{}).Where("user_id = ?", userID).Count(&count)
	if count >= 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token limit reached (max 10)", "code": "LIMIT_REACHED"})
		return
	}

	token := models.ApiToken{
		UserID:    userID,
		Name:      req.Name,
		TokenHash: hash,
		Prefix:    prefix,
		Scopes:    req.Scopes,
		ExpiresAt: expiresAt,
	}
	if err := s.db.Create(&token).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "code": "DB_ERROR"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"id":         token.ID,
		"name":       token.Name,
		"prefix":     token.Prefix,
		"scopes":     token.Scopes,
		"expires_at": token.ExpiresAt,
		"created_at": token.CreatedAt,
		"token":      raw, // 仅此一次返回明文
		"message":    "Token created. Copy it now — it will not be shown again.",
	})
}

func (s *Service) List(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := userIDVal.(uuid.UUID)
	var tokens []models.ApiToken
	if err := s.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&tokens).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 脱敏：不返回 hash
	type out struct {
		ID         uuid.UUID  `json:"id"`
		Name       string     `json:"name"`
		Prefix     string     `json:"prefix"`
		Scopes     []string   `json:"scopes"`
		LastUsedAt *time.Time `json:"last_used_at"`
		ExpiresAt  *time.Time `json:"expires_at"`
		CreatedAt  time.Time  `json:"created_at"`
		UpdatedAt  time.Time  `json:"updated_at"`
	}
	res := make([]out, 0, len(tokens))
	for _, t := range tokens {
		res = append(res, out{
			ID: t.ID, Name: t.Name, Prefix: t.Prefix, Scopes: []string(t.Scopes),
			LastUsedAt: t.LastUsedAt, ExpiresAt: t.ExpiresAt, CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": res, "total": len(res)})
}

func (s *Service) Delete(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := userIDVal.(uuid.UUID)
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	res := s.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.ApiToken{})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": res.Error.Error()})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

// LookupByRaw 通过明文 token 查找并校验有效期，返回关联用户
func (s *Service) LookupByRaw(raw string) (*models.ApiToken, *models.User, error) {
	if !strings.HasPrefix(raw, Prefix) {
		return nil, nil, errors.New("invalid prefix")
	}
	hash := hashToken(raw)
	var token models.ApiToken
	if err := s.db.Where("token_hash = ?", hash).First(&token).Error; err != nil {
		return nil, nil, err
	}
	if token.ExpiresAt != nil && time.Now().After(*token.ExpiresAt) {
		return nil, nil, errors.New("token expired")
	}
	var user models.User
	if err := s.db.First(&user, "id = ?", token.UserID).Error; err != nil {
		return nil, nil, err
	}
	if user.Role == "banned" {
		return nil, nil, errors.New("user banned")
	}
	// 异步更新 last_used_at
	now := time.Now()
	_ = s.db.Model(&models.ApiToken{}).Where("id = ?", token.ID).Update("last_used_at", now).Error
	return &token, &user, nil
}

// HasScope 检查 token 是否包含所需 scope
func HasScope(token *models.ApiToken, required string) bool {
	if token == nil {
		return false
	}
	for _, s := range token.Scopes {
		if s == required || s == "admin" {
			return true
		}
		// write 隐含 edit/community/upload/read 语义简化
		if required == "read" {
			return true // 任何 token 都有 read
		}
		if s == "write" && (required == "edit" || required == "community" || required == "upload") {
			return true
		}
	}
	return false
}

// ExtractRaw 从 Authorization 头中提取 PAT 明文，支持多种格式：
// Authorization: Bearer mfp_...  (与 JWT 复用 Bearer)
// Authorization: Token mfp_...
// X-API-Key: mfp_...
func ExtractRaw(c *gin.Context) string {
	if v := c.GetHeader("X-API-Key"); strings.HasPrefix(v, Prefix) {
		return strings.TrimSpace(v)
	}
	if v := c.GetHeader("X-Token"); strings.HasPrefix(v, Prefix) {
		return strings.TrimSpace(v)
	}
	auth := c.GetHeader("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 {
		if strings.HasPrefix(auth, Prefix) {
			return auth
		}
		return ""
	}
	if strings.HasPrefix(parts[1], Prefix) {
		return strings.TrimSpace(parts[1])
	}
	return ""
}
