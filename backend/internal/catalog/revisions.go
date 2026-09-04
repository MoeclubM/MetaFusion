package catalog

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

// recordRevision records catalog edit snapshots. Legacy callers remain best-effort;
// core edit transactions use recordRevisionDB so the snapshot is committed atomically.
func (s *CatalogService) recordRevision(
	targetType string,
	targetID uuid.UUID,
	editorID *uuid.UUID,
	editType string,
	summary string,
	editNote string,
	sourceURLs []string,
	beforeState map[string]interface{},
	afterState map[string]interface{},
) {
	_ = recordRevisionDB(s.db, targetType, targetID, editorID, editType, summary, editNote, sourceURLs, beforeState, afterState)
}

func recordRevisionDB(
	db *gorm.DB,
	targetType string,
	targetID uuid.UUID,
	editorID *uuid.UUID,
	editType string,
	summary string,
	editNote string,
	sourceURLs []string,
	beforeState map[string]interface{},
	afterState map[string]interface{},
) error {
	diff := make(map[string]interface{})
	for k, newV := range afterState {
		oldV, exists := beforeState[k]
		if !exists || fmt.Sprintf("%v", oldV) != fmt.Sprintf("%v", newV) {
			diff[k] = map[string]interface{}{
				"old": oldV,
				"new": newV,
			}
		}
	}
	rev := models.EntityRevision{
		TargetType:  targetType,
		TargetID:    targetID,
		EditorID:    editorID,
		EditType:    editType,
		Summary:     summary,
		EditNote:    editNote,
		SourceURLs:  sourceURLs,
		BeforeState: models.JSONB(beforeState),
		AfterState:  models.JSONB(afterState),
		Diff:        models.JSONB(diff),
		Status:      "applied",
		CreatedAt:   time.Now(),
	}
	return db.Create(&rev).Error
}

// ListEntityRevisions returns the revision timeline for one catalog entity.
func (s *CatalogService) ListEntityRevisions(c *gin.Context) {
	targetType := c.Query("target_type")
	targetIDStr := c.Query("target_id")
	if targetType == "" || targetIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target_type and target_id are required"})
		return
	}
	targetID, err := uuid.Parse(targetIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid target_id UUID"})
		return
	}

	var revisions []models.EntityRevision
	s.db.Preload("Editor").Where("target_type = ? AND target_id = ?", targetType, targetID).
		Order("created_at desc").
		Find(&revisions)

	c.JSON(http.StatusOK, gin.H{"items": revisions, "total": len(revisions)})
}
