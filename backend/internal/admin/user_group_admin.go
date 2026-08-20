package admin

import (
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
)

func (s *AdminService) ListUserGroups(c *gin.Context) {
	var groups []models.UserGroup
	if err := s.db.Preload("Members").Order("created_at asc").Find(&groups).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": groups, "total": len(groups)})
}

func (s *AdminService) CreateUserGroup(c *gin.Context) {
	var input struct {
		Name        string                 `json:"name" binding:"required"`
		Description string                 `json:"description"`
		Permissions map[string]interface{} `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.name_required")})
		return
	}
	perms := models.JSONB{}
	if input.Permissions != nil {
		perms = models.JSONB(input.Permissions)
	}
	g := models.UserGroup{Name: input.Name, Description: input.Description, Permissions: perms}
	if err := s.db.Create(&g).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "user_group.create", "user_group", g.ID.String(), map[string]interface{}{"name": g.Name})
	c.JSON(http.StatusCreated, g)
}

func (s *AdminService) UpdateUserGroup(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	allowed := map[string]bool{"name": true, "description": true, "permissions": true}
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
	if err := s.db.Model(&models.UserGroup{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "user_group.update", "user_group", id.String(), updates)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) DeleteUserGroup(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}
	if err := s.db.Where("id = ?", id).Delete(&models.UserGroup{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "user_group.delete", "user_group", id.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) AddUserToGroup(c *gin.Context) {
	gid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}
	var input struct {
		UserID uuid.UUID `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var group models.UserGroup
	if err := s.db.First(&group, gid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}
	var user models.User
	if err := s.db.First(&user, input.UserID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if err := s.db.Model(&group).Association("Members").Append(&user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "user_group.member.add", "user_group", gid.String(), map[string]interface{}{"user_id": input.UserID.String()})
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) RemoveUserFromGroup(c *gin.Context) {
	gid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}
	uid, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	var group models.UserGroup
	if err := s.db.First(&group, gid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}
	var user models.User
	if err := s.db.First(&user, uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if err := s.db.Model(&group).Association("Members").Delete(&user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "user_group.member.remove", "user_group", gid.String(), map[string]interface{}{"user_id": uid.String()})
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}
