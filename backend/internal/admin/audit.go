package admin

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

func writeAudit(db *gorm.DB, c *gin.Context, action, targetType, targetID string, detail map[string]interface{}) {
	actorIDVal, _ := c.Get("userID")
	var actorID *uuid.UUID
	if v, ok := actorIDVal.(uuid.UUID); ok {
		actorID = &v
	}
	roleVal, _ := c.Get("role")
	role, _ := roleVal.(string)
	ip := c.ClientIP()
	ua := c.GetHeader("User-Agent")
	if detail == nil {
		detail = map[string]interface{}{}
	}
	entry := models.AdminAuditLog{
		ActorID:   actorID,
		ActorRole: role,
		Action:    action,
		TargetType: targetType,
		TargetID:  targetID,
		Detail:    models.JSONB(detail),
		IP:        ip,
		UserAgent: ua,
		CreatedAt: time.Now(),
	}
	_ = db.Create(&entry).Error
}

func (s *AdminService) ListAuditLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	action := strings.TrimSpace(c.Query("action"))
	targetType := strings.TrimSpace(c.Query("target_type"))
	actorIDStr := strings.TrimSpace(c.Query("actor_id"))
	fromStr := strings.TrimSpace(c.Query("from"))
	toStr := strings.TrimSpace(c.Query("to"))

	query := s.db.Model(&models.AdminAuditLog{})
	if action != "" {
		query = query.Where("action = ?", action)
	}
	if targetType != "" {
		query = query.Where("target_type = ?", targetType)
	}
	if actorIDStr != "" {
		if aid, err := uuid.Parse(actorIDStr); err == nil {
			query = query.Where("actor_id = ?", aid)
		}
	}
	if fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			query = query.Where("created_at >= ?", t)
		} else if t, err := time.Parse("2006-01-02", fromStr); err == nil {
			query = query.Where("created_at >= ?", t)
		}
	}
	if toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			query = query.Where("created_at <= ?", t)
		} else if t, err := time.Parse("2006-01-02", toStr); err == nil {
			query = query.Where("created_at < ?", t.Add(24*time.Hour))
		}
	}

	var total int64
	query.Count(&total)
	var logs []models.AdminAuditLog
	if err := query.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": logs, "total": total, "page": page, "page_size": pageSize})
}

func (s *AdminService) GetSystemHealth(c *gin.Context) {
	sqlDB, err := s.db.DB()
	status := gin.H{}
	if err != nil {
		status["postgres"] = "error: " + err.Error()
	} else if err := sqlDB.Ping(); err != nil {
		status["postgres"] = "unreachable: " + err.Error()
	} else {
		status["postgres"] = "healthy"
	}
	status["api"] = "healthy"
	c.JSON(http.StatusOK, gin.H{"status": "ok", "checks": status, "time": time.Now()})
}
