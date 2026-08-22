package catalog

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
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
	c.JSON(http.StatusOK, gin.H{"status": "success", "count": len(input.Relations)})
}

func (s *CatalogService) persistEntityRelations(rows []entityRelInput) error {
	for _, r := range rows {
		spec := ontology.EdgeSpec{
			SourceType:       r.SourceType,
			SourceID:         r.SourceID,
			TargetType:       r.TargetType,
			TargetID:         r.TargetID,
			RelationshipType: r.RelationshipType,
			Qualifier:        strings.TrimSpace(r.Qualifier),
		}
		if err := ontology.ValidateRelationEdge(s.db, spec); err != nil {
			return err
		}
	}
	for _, r := range rows {
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
			BeginDate:        r.BeginDate,
			EndDate:          r.EndDate,
			Ended:            r.Ended,
			Attributes:       attrs,
		}
		if err := s.db.Where(
			"source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relationship_type = ? AND qualifier = ?",
			rel.SourceType, rel.SourceID, rel.TargetType, rel.TargetID, rel.RelationshipType, rel.Qualifier,
		).Assign(models.EntityRelationship{
			BeginDate:  r.BeginDate,
			EndDate:    r.EndDate,
			Ended:      r.Ended,
			Attributes: attrs,
		}).FirstOrCreate(&rel).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *CatalogService) mirrorArtistWorkEdge(artistID, workID uuid.UUID, role string) {
	role = strings.ToLower(strings.TrimSpace(role))
	if role == "" {
		return
	}
	spec := ontology.EdgeSpec{
		SourceType:       "artist",
		SourceID:         artistID,
		TargetType:       "work",
		TargetID:         workID,
		RelationshipType: role,
	}
	if err := ontology.ValidateRelationEdge(s.db, spec); err != nil {
		return
	}
	rel := models.EntityRelationship{
		SourceType:       "artist",
		SourceID:         artistID,
		TargetType:       "work",
		TargetID:         workID,
		RelationshipType: role,
		Qualifier:        "",
		Attributes:       models.JSONB{},
	}
	_ = s.db.Where(
		"source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relationship_type = ? AND qualifier = ?",
		rel.SourceType, rel.SourceID, rel.TargetType, rel.TargetID, rel.RelationshipType, rel.Qualifier,
	).FirstOrCreate(&rel).Error
}
