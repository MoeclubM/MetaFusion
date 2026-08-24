package admin

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
)

// ListAttributeSchemasAdmin 管理员获取全部动态属性定义
func (s *AdminService) ListAttributeSchemasAdmin(c *gin.Context) {
	entityType := strings.TrimSpace(c.Query("entity_type"))
	query := s.db.Model(&models.EntityAttributeSchema{})
	if entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	var items []models.EntityAttributeSchema
	if err := query.Order("entity_type asc, display_order asc, created_at asc").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

// CreateAttributeSchema 创建新动态属性定义
func (s *AdminService) CreateAttributeSchema(c *gin.Context) {
	var input struct {
		EntityType      string                 `json:"entity_type" binding:"required"`
		AttributeKey    string                 `json:"attribute_key" binding:"required"`
		NameZh          string                 `json:"name_zh" binding:"required"`
		NameEn          string                 `json:"name_en" binding:"required"`
		Names           map[string]interface{} `json:"names"`
		DescZh          string                 `json:"desc_zh"`
		DescEn          string                 `json:"desc_en"`
		Descriptions    map[string]interface{} `json:"descriptions"`
		DataType        string                 `json:"data_type"`
		Options         []interface{}          `json:"options"`
		ValidationRules map[string]interface{} `json:"validation_rules"`
		CategoryFilter  string                 `json:"category_filter"`
		DisplayOrder    int                    `json:"display_order"`
		IsRequired      bool                   `json:"is_required"`
		IsSearchable    *bool                  `json:"is_searchable"`
		IsEnabled       *bool                  `json:"is_enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	entityType := strings.ToLower(strings.TrimSpace(input.EntityType))
	attrKey := strings.ToLower(strings.TrimSpace(input.AttributeKey))
	if entityType == "" || attrKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "entity_type and attribute_key are required"})
		return
	}

	var count int64
	s.db.Model(&models.EntityAttributeSchema{}).Where("entity_type = ? AND attribute_key = ?", entityType, attrKey).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Attribute schema key already exists for this entity type"})
		return
	}

	names := models.JSONB{"zh-CN": input.NameZh, "en-US": input.NameEn}
	if input.Names != nil {
		names = models.JSONB(input.Names)
	}

	descriptions := models.JSONB{"zh-CN": input.DescZh, "en-US": input.DescEn}
	if input.Descriptions != nil {
		descriptions = models.JSONB(input.Descriptions)
	}

	options := models.JSONB{"fields": []interface{}{}}
	if input.Options != nil {
		options = models.JSONB{"fields": input.Options}
	}

	validationRules := models.JSONB{}
	if input.ValidationRules != nil {
		validationRules = models.JSONB(input.ValidationRules)
	}

	dataType := input.DataType
	if dataType == "" {
		dataType = "text"
	}

	isSearchable := true
	if input.IsSearchable != nil {
		isSearchable = *input.IsSearchable
	}

	isEnabled := true
	if input.IsEnabled != nil {
		isEnabled = *input.IsEnabled
	}

	schema := models.EntityAttributeSchema{
		EntityType:      entityType,
		AttributeKey:    attrKey,
		NameZh:          input.NameZh,
		NameEn:          input.NameEn,
		Names:           names,
		DescZh:          input.DescZh,
		DescEn:          input.DescEn,
		Descriptions:    descriptions,
		DataType:        dataType,
		Options:         options,
		ValidationRules: validationRules,
		CategoryFilter:  strings.TrimSpace(input.CategoryFilter),
		DisplayOrder:    input.DisplayOrder,
		IsRequired:      input.IsRequired,
		IsSearchable:    isSearchable,
		IsEnabled:       isEnabled,
		IsSystem:        false,
	}

	if err := s.db.Create(&schema).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create attribute schema: " + err.Error()})
		return
	}

	writeAudit(s.db, c, "attribute_schema.create", "entity_attribute_schema", schema.ID.String(), map[string]interface{}{
		"entity_type":   entityType,
		"attribute_key": attrKey,
		"name_zh":       input.NameZh,
	})
	c.JSON(http.StatusCreated, schema)
}

// UpdateAttributeSchema 更新动态属性定义
func (s *AdminService) UpdateAttributeSchema(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid schema ID"})
		return
	}

	var schema models.EntityAttributeSchema
	if err := s.db.Where("id = ?", id).First(&schema).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Attribute schema not found"})
		return
	}

	var input struct {
		NameZh          *string                `json:"name_zh"`
		NameEn          *string                `json:"name_en"`
		Names           map[string]interface{} `json:"names"`
		DescZh          *string                `json:"desc_zh"`
		DescEn          *string                `json:"desc_en"`
		Descriptions    map[string]interface{} `json:"descriptions"`
		DataType        *string                `json:"data_type"`
		Options         []interface{}          `json:"options"`
		ValidationRules map[string]interface{} `json:"validation_rules"`
		CategoryFilter  *string                `json:"category_filter"`
		DisplayOrder    *int                   `json:"display_order"`
		IsRequired      *bool                  `json:"is_required"`
		IsSearchable    *bool                  `json:"is_searchable"`
		IsEnabled       *bool                  `json:"is_enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if input.NameZh != nil {
		updates["name_zh"] = *input.NameZh
	}
	if input.NameEn != nil {
		updates["name_en"] = *input.NameEn
	}
	if input.Names != nil {
		updates["names"] = models.JSONB(input.Names)
	}
	if input.DescZh != nil {
		updates["desc_zh"] = *input.DescZh
	}
	if input.DescEn != nil {
		updates["desc_en"] = *input.DescEn
	}
	if input.Descriptions != nil {
		updates["descriptions"] = models.JSONB(input.Descriptions)
	}
	if input.DataType != nil {
		updates["data_type"] = *input.DataType
	}
	if input.Options != nil {
		updates["options"] = models.JSONB{"fields": input.Options}
	}
	if input.ValidationRules != nil {
		updates["validation_rules"] = models.JSONB(input.ValidationRules)
	}
	if input.CategoryFilter != nil {
		updates["category_filter"] = strings.TrimSpace(*input.CategoryFilter)
	}
	if input.DisplayOrder != nil {
		updates["display_order"] = *input.DisplayOrder
	}
	if input.IsRequired != nil {
		updates["is_required"] = *input.IsRequired
	}
	if input.IsSearchable != nil {
		updates["is_searchable"] = *input.IsSearchable
	}
	if input.IsEnabled != nil {
		updates["is_enabled"] = *input.IsEnabled
	}

	if len(updates) > 0 {
		if err := s.db.Model(&schema).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update attribute schema: " + err.Error()})
			return
		}
	}

	writeAudit(s.db, c, "attribute_schema.update", "entity_attribute_schema", id.String(), updates)
	s.db.Where("id = ?", id).First(&schema)
	c.JSON(http.StatusOK, schema)
}

// DeleteAttributeSchema 删除动态属性定义
func (s *AdminService) DeleteAttributeSchema(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid schema ID"})
		return
	}

	var schema models.EntityAttributeSchema
	if err := s.db.Where("id = ?", id).First(&schema).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Attribute schema not found"})
		return
	}

	if err := s.db.Delete(&schema).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete attribute schema: " + err.Error()})
		return
	}

	writeAudit(s.db, c, "attribute_schema.delete", "entity_attribute_schema", id.String(), map[string]interface{}{
		"entity_type":   schema.EntityType,
		"attribute_key": schema.AttributeKey,
	})
	c.JSON(http.StatusOK, gin.H{"status": "deleted", "id": id})
}
