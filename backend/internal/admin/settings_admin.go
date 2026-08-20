package admin

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/models"
)

func (s *AdminService) GetSystemSettings(c *gin.Context) {
	var rows []models.SystemSetting
	if err := s.db.Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
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
		"raw":                  m,
	})
}

func (s *AdminService) UpdateSystemSettings(c *gin.Context) {
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	allowed := map[string]bool{"registration_enabled": true, "invite_required": true}
	updates := map[string]string{}
	for k, v := range input {
		if !allowed[k] {
			continue
		}
		var strVal string
		switch vv := v.(type) {
		case bool:
			if vv {
				strVal = "true"
			} else {
				strVal = "false"
			}
		case string:
			low := strings.ToLower(strings.TrimSpace(vv))
			if low == "true" || low == "1" || low == "yes" {
				strVal = "true"
			} else if low == "false" || low == "0" || low == "no" {
				strVal = "false"
			} else {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid value for " + k + ": must be boolean"})
				return
			}
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid value type for " + k})
			return
		}
		updates[k] = strVal
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no valid settings provided"})
		return
	}
	for k, v := range updates {
		rec := models.SystemSetting{Key: k, Value: v, UpdatedAt: time.Now()}
		if err := s.db.Save(&rec).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	writeAudit(s.db, c, "system.settings.update", "system_setting", "", map[string]interface{}{"updates": updates})

	var rows []models.SystemSetting
	_ = s.db.Find(&rows).Error
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
		"raw":                  m,
	})
}
