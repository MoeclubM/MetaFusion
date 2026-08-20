package admin

import (
	"net/http"
	"strings"
	"time"

	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// UpdateUser 管理员更新用户信息：email / display_name / password / role
// password 留空不改；email 唯一性校验；display_name 独立昵称可清空回退；role 走原有保护逻辑
func (s *AdminService) UpdateUser(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var input struct {
		Email       *string `json:"email"`
		DisplayName *string `json:"display_name"`
		Password    *string `json:"password"`
		Role        *string `json:"role"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := s.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "admin.user_not_found")})
		return
	}

	updates := map[string]interface{}{}
	detail := map[string]interface{}{}

	if input.Email != nil {
		email := strings.TrimSpace(*input.Email)
		if email == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "auth.empty_username_email")})
			return
		}
		if !strings.Contains(email, "@") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid email format"})
			return
		}
		if email != user.Email {
			var cnt int64
			s.db.Model(&models.User{}).Where("email = ? AND id != ?", email, userID).Count(&cnt)
			if cnt > 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "auth.username_email_taken")})
				return
			}
			updates["email"] = email
			detail["email"] = map[string]interface{}{"from": user.Email, "to": email}
		}
	}

	if input.DisplayName != nil {
		trimmed := strings.TrimSpace(*input.DisplayName)
		if trimmed == "" {
			updates["display_name"] = gorm.Expr("NULL")
			detail["display_name"] = map[string]interface{}{"from": strPtr(user.DisplayName), "to": nil}
		} else {
			if len(trimmed) > 64 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "昵称过长，最多 64 字符"})
				return
			}
			updates["display_name"] = trimmed
			detail["display_name"] = map[string]interface{}{"from": strPtr(user.DisplayName), "to": trimmed}
		}
	}

	var newRole string
	if input.Role != nil {
		newRole = strings.TrimSpace(*input.Role)
		if newRole != "" && newRole != "admin" && newRole != "archivist" && newRole != "member" && newRole != "banned" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role. Must be admin, archivist, member, or banned"})
			return
		}
		if newRole != "" && newRole != user.Role {
			actorIDVal, _ := c.Get("userID")
			actorID, _ := actorIDVal.(uuid.UUID)
			if actorID == userID && newRole == "banned" {
				c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.cannot_ban_self")})
				return
			}
			if actorID == userID && newRole != "admin" {
				var actor models.User
				if err := s.db.First(&actor, actorID).Error; err == nil && actor.Role == "admin" {
					c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.cannot_demote_self")})
					return
				}
			}
			if user.Role == "admin" && newRole != "admin" {
				var adminCount int64
				s.db.Model(&models.User{}).Where("role = ?", "admin").Count(&adminCount)
				if adminCount <= 1 {
					c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.keep_one_admin")})
					return
				}
			}
			updates["role"] = newRole
			detail["role"] = map[string]interface{}{"from": user.Role, "to": newRole}
		}
	}

	if input.Password != nil {
		pw := *input.Password
		if pw != "" {
			if len(pw) < 8 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "密码至少 8 位"})
				return
			}
			hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			updates["password_hash"] = string(hash)
			detail["password"] = "reset"
		}
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid fields to update"})
		return
	}
	updates["updated_at"] = time.Now()

	if err := s.db.Model(&models.User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "auth.username_email_taken")})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "user.update", "user", userID.String(), detail)

	var updated models.User
	_ = s.db.First(&updated, userID).Error
	c.JSON(http.StatusOK, updated)
}

func strPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
