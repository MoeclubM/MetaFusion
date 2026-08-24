package admin

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/models"
)

// ListExternalDatabasesAdmin 管理员获取全部外部数据库预设项目（含已禁用）
func (s *AdminService) ListExternalDatabasesAdmin(c *gin.Context) {
	category := c.Query("category")
	query := s.db.Model(&models.ExternalDatabaseDefinition{})
	if category != "" && category != "all" {
		query = query.Where("category = ? OR category = 'all'", category)
	}

	var items []models.ExternalDatabaseDefinition
	if err := query.Order("sort_order asc, code asc").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

// CreateExternalDatabase 创建新的外部数据库预设
func (s *AdminService) CreateExternalDatabase(c *gin.Context) {
	var input struct {
		Code            string                 `json:"code" binding:"required"`
		NameZh          string                 `json:"name_zh" binding:"required"`
		NameEn          string                 `json:"name_en" binding:"required"`
		Names           map[string]interface{} `json:"names"`
		Category        string                 `json:"category"`
		URLPattern      string                 `json:"url_pattern" binding:"required"`
		Icon            string                 `json:"icon"`
		IconURL         string                 `json:"icon_url"`
		ValidationRegex string                 `json:"validation_regex"`
		Description     string                 `json:"description"`
		SortOrder       int                    `json:"sort_order"`
		IsEnabled       *bool                  `json:"is_enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code := strings.ToLower(strings.TrimSpace(input.Code))
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Database code cannot be empty"})
		return
	}

	var count int64
	s.db.Model(&models.ExternalDatabaseDefinition{}).Where("code = ?", code).Count(&count)
	if count > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "External database with this code already exists"})
		return
	}

	category := strings.TrimSpace(input.Category)
	if category == "" {
		category = "all"
	}

	icon := strings.TrimSpace(input.Icon)
	if icon == "" {
		icon = "Globe"
	}

	names := models.JSONB{"zh-CN": input.NameZh, "en-US": input.NameEn}
	if input.Names != nil {
		names = models.JSONB(input.Names)
	}

	isEnabled := true
	if input.IsEnabled != nil {
		isEnabled = *input.IsEnabled
	}

	item := models.ExternalDatabaseDefinition{
		Code:            code,
		NameZh:          strings.TrimSpace(input.NameZh),
		NameEn:          strings.TrimSpace(input.NameEn),
		Names:           names,
		Category:        category,
		URLPattern:      strings.TrimSpace(input.URLPattern),
		Icon:            icon,
		IconURL:         strings.TrimSpace(input.IconURL),
		ValidationRegex: strings.TrimSpace(input.ValidationRegex),
		Description:     strings.TrimSpace(input.Description),
		SortOrder:       input.SortOrder,
		IsEnabled:       isEnabled,
		IsSystem:        false,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	if err := s.db.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	writeAudit(s.db, c, "external_database.create", "external_database", item.Code, map[string]interface{}{
		"code":        item.Code,
		"name_zh":     item.NameZh,
		"url_pattern": item.URLPattern,
		"category":    item.Category,
	})

	c.JSON(http.StatusOK, item)
}

// UpdateExternalDatabase 更新外部数据库配置
func (s *AdminService) UpdateExternalDatabase(c *gin.Context) {
	code := strings.ToLower(strings.TrimSpace(c.Param("code")))
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid database code"})
		return
	}

	var existing models.ExternalDatabaseDefinition
	if err := s.db.Where("code = ?", code).First(&existing).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "External database definition not found"})
		return
	}

	var input struct {
		NameZh          *string                `json:"name_zh"`
		NameEn          *string                `json:"name_en"`
		Names           map[string]interface{} `json:"names"`
		Category        *string                `json:"category"`
		URLPattern      *string                `json:"url_pattern"`
		Icon            *string                `json:"icon"`
		IconURL         *string                `json:"icon_url"`
		ValidationRegex *string                `json:"validation_regex"`
		Description     *string                `json:"description"`
		SortOrder       *int                   `json:"sort_order"`
		IsEnabled       *bool                  `json:"is_enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{
		"updated_at": time.Now(),
	}

	if input.NameZh != nil {
		updates["name_zh"] = strings.TrimSpace(*input.NameZh)
	}
	if input.NameEn != nil {
		updates["name_en"] = strings.TrimSpace(*input.NameEn)
	}
	if input.Names != nil {
		updates["names"] = models.JSONB(input.Names)
	}
	if input.Category != nil {
		updates["category"] = strings.TrimSpace(*input.Category)
	}
	if input.URLPattern != nil {
		updates["url_pattern"] = strings.TrimSpace(*input.URLPattern)
	}
	if input.Icon != nil {
		updates["icon"] = strings.TrimSpace(*input.Icon)
	}
	if input.IconURL != nil {
		updates["icon_url"] = strings.TrimSpace(*input.IconURL)
	}
	if input.ValidationRegex != nil {
		updates["validation_regex"] = strings.TrimSpace(*input.ValidationRegex)
	}
	if input.Description != nil {
		updates["description"] = strings.TrimSpace(*input.Description)
	}
	if input.SortOrder != nil {
		updates["sort_order"] = *input.SortOrder
	}
	if input.IsEnabled != nil {
		updates["is_enabled"] = *input.IsEnabled
	}

	if err := s.db.Model(&existing).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var updated models.ExternalDatabaseDefinition
	_ = s.db.Where("code = ?", code).First(&updated)

	writeAudit(s.db, c, "external_database.update", "external_database", code, map[string]interface{}{
		"updates": updates,
	})

	c.JSON(http.StatusOK, updated)
}

// DeleteExternalDatabase 删除外部数据库配置（系统内置不可物理删除，仅可禁用）
func (s *AdminService) DeleteExternalDatabase(c *gin.Context) {
	code := strings.ToLower(strings.TrimSpace(c.Param("code")))
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid database code"})
		return
	}

	var existing models.ExternalDatabaseDefinition
	if err := s.db.Where("code = ?", code).First(&existing).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "External database definition not found"})
		return
	}

	if existing.IsSystem {
		c.JSON(http.StatusBadRequest, gin.H{"error": "System preset database definitions cannot be deleted; you can disable them instead"})
		return
	}

	if err := s.db.Where("code = ?", code).Delete(&models.ExternalDatabaseDefinition{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	writeAudit(s.db, c, "external_database.delete", "external_database", code, map[string]interface{}{
		"code": code,
	})

	c.JSON(http.StatusOK, gin.H{"message": "External database definition deleted successfully"})
}
