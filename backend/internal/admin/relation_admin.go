package admin

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
)

// ListRelationTypesAdmin 管理员获取全部动态关系类型
func (s *AdminService) ListRelationTypesAdmin(c *gin.Context) {
	domain := c.Query("domain")
	query := s.db.Model(&models.RelationType{})
	if domain != "" {
		query = query.Where("domain = ?", domain)
	}
	var items []models.RelationType
	if err := query.Order("sort_order asc, created_at asc").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

// CreateRelationType 创建新关系类型
func (s *AdminService) CreateRelationType(c *gin.Context) {
	var input struct {
		Code               string                 `json:"code" binding:"required"`
		Domain             string                 `json:"domain" binding:"required"`
		NameZh             string                 `json:"name_zh" binding:"required"`
		NameEn             string                 `json:"name_en" binding:"required"`
		Names              map[string]interface{} `json:"names"`
		Description        string                 `json:"description"`
		ForwardLabelZh     string                 `json:"forward_label_zh" binding:"required"`
		ReverseLabelZh     string                 `json:"reverse_label_zh" binding:"required"`
		ForwardLabelEn     string                 `json:"forward_label_en" binding:"required"`
		ReverseLabelEn     string                 `json:"reverse_label_en" binding:"required"`
		AllowedSourceTypes []string               `json:"allowed_source_types"`
		AllowedTargetTypes []string               `json:"allowed_target_types"`
		IsSymmetric        bool                   `json:"is_symmetric"`
		IsHierarchical     bool                   `json:"is_hierarchical"`
		AttributeSchema    []interface{}          `json:"attribute_schema"`
		Color              string                 `json:"color"`
		Icon               string                 `json:"icon"`
		SortOrder          int                    `json:"sort_order"`
		IsEnabled          *bool                  `json:"is_enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code := strings.ToLower(strings.TrimSpace(input.Code))
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Relation type code cannot be empty"})
		return
	}

	names := models.JSONB{"zh-CN": input.NameZh, "en-US": input.NameEn}
	if input.Names != nil {
		names = models.JSONB(input.Names)
	}

	attrSchema := models.JSONB{}
	if input.AttributeSchema != nil {
		attrSchema = models.JSONB{"fields": input.AttributeSchema}
	}

	isEnabled := true
	if input.IsEnabled != nil {
		isEnabled = *input.IsEnabled
	}

	color := input.Color
	if color == "" {
		color = "sky"
	}
	icon := input.Icon
	if icon == "" {
		icon = "Link"
	}

	relType := models.RelationType{
		Code:               code,
		Domain:             input.Domain,
		NameZh:             input.NameZh,
		NameEn:             input.NameEn,
		Names:              names,
		Description:        input.Description,
		ForwardLabelZh:     input.ForwardLabelZh,
		ReverseLabelZh:     input.ReverseLabelZh,
		ForwardLabelEn:     input.ForwardLabelEn,
		ReverseLabelEn:     input.ReverseLabelEn,
		AllowedSourceTypes: input.AllowedSourceTypes,
		AllowedTargetTypes: input.AllowedTargetTypes,
		IsSymmetric:        input.IsSymmetric,
		IsHierarchical:     input.IsHierarchical,
		AttributeSchema:    attrSchema,
		Color:              color,
		Icon:               icon,
		SortOrder:          input.SortOrder,
		IsSystem:           false,
		IsEnabled:          isEnabled,
	}

	if err := s.db.Create(&relType).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create relation type: " + err.Error()})
		return
	}

	writeAudit(s.db, c, "relation_type.create", "relation_type", code, map[string]interface{}{"name_zh": input.NameZh, "domain": input.Domain})
	c.JSON(http.StatusCreated, relType)
}

// UpdateRelationType 更新动态关系类型
func (s *AdminService) UpdateRelationType(c *gin.Context) {
	code := strings.ToLower(strings.TrimSpace(c.Param("code")))
	var existing models.RelationType
	if err := s.db.Where("code = ?", code).First(&existing).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relation type not found"})
		return
	}

	var input struct {
		NameZh             string                 `json:"name_zh"`
		NameEn             string                 `json:"name_en"`
		Names              map[string]interface{} `json:"names"`
		Description        string                 `json:"description"`
		ForwardLabelZh     string                 `json:"forward_label_zh"`
		ReverseLabelZh     string                 `json:"reverse_label_zh"`
		ForwardLabelEn     string                 `json:"forward_label_en"`
		ReverseLabelEn     string                 `json:"reverse_label_en"`
		AllowedSourceTypes *[]string              `json:"allowed_source_types"`
		AllowedTargetTypes *[]string              `json:"allowed_target_types"`
		IsSymmetric        *bool                  `json:"is_symmetric"`
		IsHierarchical     *bool                  `json:"is_hierarchical"`
		AttributeSchema    []interface{}          `json:"attribute_schema"`
		Color              string                 `json:"color"`
		Icon               string                 `json:"icon"`
		SortOrder          *int                   `json:"sort_order"`
		IsEnabled          *bool                  `json:"is_enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if input.NameZh != "" {
		updates["name_zh"] = input.NameZh
	}
	if input.NameEn != "" {
		updates["name_en"] = input.NameEn
	}
	if input.Names != nil {
		updates["names"] = models.JSONB(input.Names)
	}
	updates["description"] = input.Description
	if input.ForwardLabelZh != "" {
		updates["forward_label_zh"] = input.ForwardLabelZh
	}
	if input.ReverseLabelZh != "" {
		updates["reverse_label_zh"] = input.ReverseLabelZh
	}
	if input.ForwardLabelEn != "" {
		updates["forward_label_en"] = input.ForwardLabelEn
	}
	if input.ReverseLabelEn != "" {
		updates["reverse_label_en"] = input.ReverseLabelEn
	}
	if input.AllowedSourceTypes != nil {
		updates["allowed_source_types"] = *input.AllowedSourceTypes
	}
	if input.AllowedTargetTypes != nil {
		updates["allowed_target_types"] = *input.AllowedTargetTypes
	}
	if input.IsSymmetric != nil {
		updates["is_symmetric"] = *input.IsSymmetric
	}
	if input.IsHierarchical != nil {
		updates["is_hierarchical"] = *input.IsHierarchical
	}
	if input.AttributeSchema != nil {
		updates["attribute_schema"] = models.JSONB{"fields": input.AttributeSchema}
	}
	if input.Color != "" {
		updates["color"] = input.Color
	}
	if input.Icon != "" {
		updates["icon"] = input.Icon
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

	writeAudit(s.db, c, "relation_type.update", "relation_type", code, updates)
	s.db.Where("code = ?", code).First(&existing)
	c.JSON(http.StatusOK, existing)
}

// DeleteRelationType 删除动态关系类型
func (s *AdminService) DeleteRelationType(c *gin.Context) {
	code := strings.ToLower(strings.TrimSpace(c.Param("code")))
	var existing models.RelationType
	if err := s.db.Where("code = ?", code).First(&existing).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relation type not found"})
		return
	}

	if err := s.db.Where("code = ?", code).Delete(&models.RelationType{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	writeAudit(s.db, c, "relation_type.delete", "relation_type", code, map[string]interface{}{"name_zh": existing.NameZh})
	c.JSON(http.StatusOK, gin.H{"status": "deleted", "code": code})
}

// UpsertWorkRelations 保存作品演职关系
func (s *AdminService) UpsertWorkRelations(c *gin.Context) {
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID"})
		return
	}
	var input struct {
		Relations []struct {
			ArtistID uuid.UUID `json:"artist_id" binding:"required"`
			Role     string    `json:"role" binding:"required"`
		} `json:"relations" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for _, r := range input.Relations {
		var count int64
		s.db.Model(&models.RelationType{}).Where("code = ? AND is_enabled = ?", r.Role, true).Count(&count)
		if count == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.invalid_role") + r.Role})
			return
		}
	}
	// 幂等：先清后插置
	if err := s.db.Where("work_id = ?", workID).Delete(&models.WorkArtistRelation{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for _, r := range input.Relations {
		rel := models.WorkArtistRelation{WorkID: workID, ArtistID: r.ArtistID, Role: r.Role}
		if err := s.db.Create(&rel).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	writeAudit(s.db, c, "work.relations.upsert", "work", workID.String(), map[string]interface{}{"count": len(input.Relations)})
	c.JSON(http.StatusOK, gin.H{"status": "success", "count": len(input.Relations)})
}

// UpsertEntityRelations 批量保存实体高级图谱关系
func (s *AdminService) UpsertEntityRelations(c *gin.Context) {
	var input struct {
		Relations []struct {
			SourceType       string                 `json:"source_type" binding:"required"`
			SourceID         uuid.UUID              `json:"source_id" binding:"required"`
			TargetType       string                 `json:"target_type" binding:"required"`
			TargetID         uuid.UUID              `json:"target_id" binding:"required"`
			RelationshipType string                 `json:"relationship_type" binding:"required"`
			Qualifier        string                 `json:"qualifier"`
			BeginDate        string                 `json:"begin_date"`
			EndDate          string                 `json:"end_date"`
			Ended            bool                   `json:"ended"`
			Attributes       map[string]interface{} `json:"attributes"`
		} `json:"relations" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, r := range input.Relations {
		spec := ontology.EdgeSpec{
			SourceType: r.SourceType, SourceID: r.SourceID,
			TargetType: r.TargetType, TargetID: r.TargetID,
			RelationshipType: r.RelationshipType, Qualifier: r.Qualifier,
		}
		if err := ontology.ValidateRelationEdge(s.db, spec); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}
	for _, r := range input.Relations {
		attrs := models.JSONB{}
		if r.Attributes != nil {
			attrs = models.JSONB(r.Attributes)
		}
		qual := strings.TrimSpace(r.Qualifier)
		rel := models.EntityRelationship{
			SourceType: r.SourceType, SourceID: r.SourceID,
			TargetType: r.TargetType, TargetID: r.TargetID,
			RelationshipType: r.RelationshipType,
			Qualifier:        qual,
			BeginDate:        r.BeginDate,
			EndDate:          r.EndDate,
			Ended:            r.Ended,
			Attributes:       attrs,
		}
		if err := s.db.Where("source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relationship_type = ? AND qualifier = ?",
			r.SourceType, r.SourceID, r.TargetType, r.TargetID, r.RelationshipType, qual).
			Assign(models.EntityRelationship{
				BeginDate:  r.BeginDate,
				EndDate:    r.EndDate,
				Ended:      r.Ended,
				Attributes: attrs,
			}).
			FirstOrCreate(&rel).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	writeAudit(s.db, c, "entity.relations.upsert", "entity_relationship", "", map[string]interface{}{"count": len(input.Relations)})
	c.JSON(http.StatusOK, gin.H{"status": "success", "count": len(input.Relations)})
}

// DeleteEntityRelation 管理员删除实体关系
func (s *AdminService) DeleteEntityRelation(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid relation ID"})
		return
	}
	if err := s.db.Where("id = ?", id).Delete(&models.EntityRelationship{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "entity_relationship.delete", "entity_relationship", id.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "deleted", "id": id})
}

	// ListEntityTypesAdmin 管理员获取全部实体类型定义
	func (s *AdminService) ListEntityTypesAdmin(c *gin.Context) {
		var items []models.EntityTypeDefinition
		if err := s.db.Order("sort_order asc, created_at asc").Find(&items).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
	}

	// CreateEntityType 创建新实体类型定义
	func (s *AdminService) CreateEntityType(c *gin.Context) {
		var input struct {
			Code        string                 `json:"code" binding:"required"`
			NameZh      string                 `json:"name_zh" binding:"required"`
			NameEn      string                 `json:"name_en" binding:"required"`
			Names       map[string]interface{} `json:"names"`
			DescZh      string                 `json:"desc_zh"`
			DescEn      string                 `json:"desc_en"`
			Color       string                 `json:"color"`
			BgColor     string                 `json:"bg_color"`
			BorderColor string                 `json:"border_color"`
			SortOrder   int                    `json:"sort_order"`
			IsEnabled   *bool                  `json:"is_enabled"`
		}
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		code := strings.ToLower(strings.TrimSpace(input.Code))
		if code == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Entity type code cannot be empty"})
			return
		}

		var existing models.EntityTypeDefinition
		if err := s.db.Where("code = ?", code).First(&existing).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.entity_type_already_exists")})
			return
		}

		names := models.JSONB{"zh-CN": input.NameZh, "en-US": input.NameEn}
		if input.Names != nil {
			names = models.JSONB(input.Names)
		}

		isEnabled := true
		if input.IsEnabled != nil {
			isEnabled = *input.IsEnabled
		}

		color := input.Color
		if color == "" {
			color = "amber"
		}
		bgColor := input.BgColor
		if bgColor == "" {
			bgColor = "bg-amber-500/10"
		}
		borderColor := input.BorderColor
		if borderColor == "" {
			borderColor = "border-amber-500/30"
		}

		item := models.EntityTypeDefinition{
			Code:        code,
			NameZh:      input.NameZh,
			NameEn:      input.NameEn,
			Names:       names,
			DescZh:      input.DescZh,
			DescEn:      input.DescEn,
			Color:       color,
			BgColor:     bgColor,
			BorderColor: borderColor,
			SortOrder:   input.SortOrder,
			IsSystem:    false,
			IsEnabled:   isEnabled,
		}

		if err := s.db.Create(&item).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create entity type: " + err.Error()})
			return
		}

		writeAudit(s.db, c, "entity_type.create", "entity_type", code, map[string]interface{}{"name_zh": input.NameZh})
		c.JSON(http.StatusCreated, item)
	}

	// UpdateEntityType 更新实体类型定义
	func (s *AdminService) UpdateEntityType(c *gin.Context) {
		code := strings.ToLower(strings.TrimSpace(c.Param("code")))
		var existing models.EntityTypeDefinition
		if err := s.db.Where("code = ?", code).First(&existing).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Entity type definition not found"})
			return
		}

		var input struct {
			NameZh      string                 `json:"name_zh"`
			NameEn      string                 `json:"name_en"`
			Names       map[string]interface{} `json:"names"`
			DescZh      string                 `json:"desc_zh"`
			DescEn      string                 `json:"desc_en"`
			Color       string                 `json:"color"`
			BgColor     string                 `json:"bg_color"`
			BorderColor string                 `json:"border_color"`
			SortOrder   *int                   `json:"sort_order"`
			IsEnabled   *bool                  `json:"is_enabled"`
		}
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		updates := map[string]interface{}{}
		if input.NameZh != "" {
			updates["name_zh"] = input.NameZh
		}
		if input.NameEn != "" {
			updates["name_en"] = input.NameEn
		}
		if input.Names != nil {
			updates["names"] = models.JSONB(input.Names)
		}
		if input.DescZh != "" {
			updates["desc_zh"] = input.DescZh
		}
		if input.DescEn != "" {
			updates["desc_en"] = input.DescEn
		}
		if input.Color != "" {
			updates["color"] = input.Color
		}
		if input.BgColor != "" {
			updates["bg_color"] = input.BgColor
		}
		if input.BorderColor != "" {
			updates["border_color"] = input.BorderColor
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

		writeAudit(s.db, c, "entity_type.update", "entity_type", code, updates)
		s.db.Where("code = ?", code).First(&existing)
		c.JSON(http.StatusOK, existing)
	}

	// DeleteEntityType 删除实体类型定义
	func (s *AdminService) DeleteEntityType(c *gin.Context) {
		code := strings.ToLower(strings.TrimSpace(c.Param("code")))
		var existing models.EntityTypeDefinition
		if err := s.db.Where("code = ?", code).First(&existing).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Entity type definition not found"})
			return
		}

		if existing.IsSystem {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.cannot_delete_system_entity_type")})
			return
		}

		var count int64
		s.db.Model(&models.Artist{}).Where("entity_type = ?", code).Count(&count)
		if count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(backendi18n.T(c, "admin.entity_type_in_use"), count)})
			return
		}

		if err := s.db.Where("code = ?", code).Delete(&models.EntityTypeDefinition{}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		writeAudit(s.db, c, "entity_type.delete", "entity_type", code, map[string]interface{}{"name_zh": existing.NameZh})
		c.JSON(http.StatusOK, gin.H{"status": "deleted", "code": code})
	}
