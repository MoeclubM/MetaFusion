package catalog

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
)

// ListAttributeSchemas 获取指定实体类型的动态属性定义（面向客户端/编目表单）
func (s *CatalogService) ListAttributeSchemas(c *gin.Context) {
	entityType := strings.ToLower(strings.TrimSpace(c.Query("entity_type")))
	category := strings.TrimSpace(c.Query("category"))
	locale := backendi18n.LocaleFromContext(c)

	query := s.db.Model(&models.EntityAttributeSchema{}).Where("is_enabled = ?", true)
	if entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	if category != "" {
		query = query.Where("category_filter = '' OR category_filter IS NULL OR category_filter = ?", category)
	}

	var items []models.EntityAttributeSchema
	if err := query.Order("display_order asc, created_at asc").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type OutSchema struct {
		models.EntityAttributeSchema
		DisplayName string `json:"display_name"`
		DisplayDesc string `json:"display_description"`
	}

	out := make([]OutSchema, 0, len(items))
	for _, it := range items {
		out = append(out, OutSchema{
			EntityAttributeSchema: it,
			DisplayName:           it.LocalizedName(locale),
			DisplayDesc:           it.LocalizedDesc(locale),
		})
	}

	c.JSON(http.StatusOK, gin.H{"items": out, "total": len(out)})
}

// DeleteEntityRelationForMember 社区成员/编目员删除单条实体关系边
func (s *CatalogService) DeleteEntityRelationForMember(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	relID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid relation ID"})
		return
	}

	var rel models.EntityRelationship
	if err := s.db.Where("id = ?", relID).First(&rel).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relation not found"})
		return
	}

	beforeState := map[string]interface{}{
		"source_type":       rel.SourceType,
		"source_id":         rel.SourceID,
		"target_type":       rel.TargetType,
		"target_id":         rel.TargetID,
		"relationship_type": rel.RelationshipType,
		"qualifier":         rel.Qualifier,
	}

	if err := s.db.Delete(&rel).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	s.recordRevision(rel.SourceType, rel.SourceID, &userID, "delete_relation", "解除实体关联关系", "", nil, beforeState, nil)
	c.JSON(http.StatusOK, gin.H{"status": "deleted", "id": relID})
}
