package admin

import (
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
)

func (s *AdminService) UpdateTopic(c *gin.Context) {
	topicID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid topic ID"})
		return
	}
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	allowed := map[string]bool{"title": true, "content": true, "board_code": true, "is_pinned": true}
	updates := map[string]interface{}{}
	for k, v := range input {
		if allowed[k] {
			updates[k] = v
		}
	}
	if v, ok := updates["is_pinned"]; ok {
		pinned, _ := v.(bool)
		updates["is_pinned"] = pinned
		if pinned {
			now := time.Now()
			updates["pinned_at"] = now
		} else {
			updates["pinned_at"] = nil
		}
	}
	if bc, ok := updates["board_code"].(string); ok {
		if bc == "all" {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "community.all_forbidden")})
			return
		}
		var cnt int64
		s.db.Model(&models.ForumBoard{}).Where("code = ? AND is_enabled = true", bc).Count(&cnt)
		if cnt == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "community.invalid_board")})
			return
		}
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid fields"})
		return
	}
	if err := s.db.Model(&models.DiscussionTopic{}).Where("id = ?", topicID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "topic.update", "topic", topicID.String(), updates)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) UpdateTag(c *gin.Context) {
	idStr := c.Param("id")
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	allowed := map[string]bool{"name": true, "group_type": true, "category_scope": true}
	updates := map[string]interface{}{}
	for k, v := range input {
		if allowed[k] {
			updates[k] = v
		}
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid fields"})
		return
	}
	if err := s.db.Model(&models.Tag{}).Where("id = ?", idStr).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "tag.update", "tag", idStr, updates)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) BatchUpdateUserRoles(c *gin.Context) {
	var input struct {
		UserIDs []uuid.UUID `json:"user_ids" binding:"required"`
		Role    string      `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.Role != "admin" && input.Role != "archivist" && input.Role != "member" && input.Role != "banned" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role"})
		return
	}
	if len(input.UserIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.user_ids_required")})
		return
	}
	actorIDVal, _ := c.Get("userID")
	actorID, _ := actorIDVal.(uuid.UUID)
	for _, uid := range input.UserIDs {
		if uid == actorID && input.Role == "banned" {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.batch_no_self_ban")})
			return
		}
	}
	// 最后 admin 保护：若批量会把所有 admin 移除，需拒绝
	if input.Role != "admin" {
		var adminCount int64
		s.db.Model(&models.User{}).Where("role = ?", "admin").Count(&adminCount)
		var affectedAdmins int64
		s.db.Model(&models.User{}).Where("id IN ? AND role = ?", input.UserIDs, "admin").Count(&affectedAdmins)
		if adminCount > 0 && affectedAdmins >= adminCount {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.batch_would_remove_all")})
			return
		}
	}
	if err := s.db.Model(&models.User{}).Where("id IN ?", input.UserIDs).Update("role", input.Role).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "user.role.batch_update", "user", "", map[string]interface{}{"role": input.Role, "count": len(input.UserIDs)})
	c.JSON(http.StatusOK, gin.H{"status": "success", "updated": len(input.UserIDs)})
}
