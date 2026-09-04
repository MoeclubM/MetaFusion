package catalog

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
	"gorm.io/gorm"
)

type entityRelInput struct {
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
}

func (s *CatalogService) UpsertEntityRelationsForMember(c *gin.Context) {
	if currentUserID(c) == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	var input struct {
		Relations []entityRelInput `json:"relations" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := s.persistEntityRelations(input.Relations); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 边变更可能影响 Work 署名投影：收集涉及的 work 逐个刷新索引。
	seen := make(map[uuid.UUID]bool)
	for _, r := range input.Relations {
		if strings.ToLower(strings.TrimSpace(r.TargetType)) == "work" {
			if !seen[r.TargetID] {
				seen[r.TargetID] = true
				s.refreshWorkSearchIndex(c.Request.Context(), r.TargetID)
			}
		}
		if strings.ToLower(strings.TrimSpace(r.SourceType)) == "work" {
			if !seen[r.SourceID] {
				seen[r.SourceID] = true
				s.refreshWorkSearchIndex(c.Request.Context(), r.SourceID)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"status": "success", "count": len(input.Relations)})
}

func (s *CatalogService) persistEntityRelations(rows []entityRelInput) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		for _, r := range rows {
			beginDate, err := ontology.NormalizePartialDate(r.BeginDate)
			if err != nil {
				return err
			}
			endDate, err := ontology.NormalizePartialDate(r.EndDate)
			if err != nil {
				return err
			}
			if err := ontology.ValidateDateSpan(beginDate, endDate); err != nil {
				return err
			}
			spec := ontology.EdgeSpec{
				SourceType:       r.SourceType,
				SourceID:         r.SourceID,
				TargetType:       r.TargetType,
				TargetID:         r.TargetID,
				RelationshipType: r.RelationshipType,
				Qualifier:        strings.TrimSpace(r.Qualifier),
				BeginDate:        beginDate,
				EndDate:          endDate,
				Ended:            r.Ended,
			}
			// Validate against the same transaction after each prior edge is written,
			// so a single batch cannot hide a newly-created cycle.
			if err := ontology.ValidateRelationEdge(tx, spec); err != nil {
				return err
			}

			attrs := models.JSONB{}
			if r.Attributes != nil {
				attrs = models.JSONB(r.Attributes)
			}
			qual := strings.TrimSpace(r.Qualifier)
			rel := models.EntityRelationship{
				SourceType:       strings.ToLower(strings.TrimSpace(r.SourceType)),
				SourceID:         r.SourceID,
				TargetType:       strings.ToLower(strings.TrimSpace(r.TargetType)),
				TargetID:         r.TargetID,
				RelationshipType: strings.ToLower(strings.TrimSpace(r.RelationshipType)),
				Qualifier:        qual,
				BeginDate:        beginDate,
				EndDate:          endDate,
				Ended:            r.Ended,
				Attributes:       attrs,
			}
			if err := tx.Where(
				"source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relationship_type = ? AND qualifier = ?",
				rel.SourceType, rel.SourceID, rel.TargetType, rel.TargetID, rel.RelationshipType, rel.Qualifier,
			).Assign(models.EntityRelationship{
				BeginDate:  beginDate,
				EndDate:    endDate,
				Ended:      r.Ended,
				Attributes: attrs,
			}).FirstOrCreate(&rel).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// mirrorArtistWorkEdge 已废弃并由 artist_relations.go 的 UpsertArtistWorkEdge 取代：
// 署名写路径单轨化后不再存在「写 relation 行 + 镜像边」的双轨写入。
// SubmitComprehensiveArchive 需要的静默容错写入改用 IgnoreRelationErrors 包装。
