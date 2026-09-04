package catalog

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
	"gorm.io/gorm"
)

var errUnsupportedMergeType = errors.New("unsupported merge target type")

type mergeEntityInput struct {
	TargetType string   `json:"target_type" binding:"required"`
	SourceID   string   `json:"source_id" binding:"required"`
	TargetID   string   `json:"target_id" binding:"required"`
	MergeNote  string   `json:"merge_note" binding:"required"`
	SourceURLs []string `json:"source_urls"`
}

// MergeEntities merges duplicate catalog entities while preserving references.
// PostgreSQL remains the source of truth; the entire merge is one transaction.
func (s *CatalogService) MergeEntities(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var input mergeEntityInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.TargetType = strings.ToLower(strings.TrimSpace(input.TargetType))
	input.MergeNote = strings.TrimSpace(input.MergeNote)

	sourceID, sourceErr := uuid.Parse(input.SourceID)
	targetID, targetErr := uuid.Parse(input.TargetID)
	if sourceErr != nil || targetErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid UUID format"})
		return
	}
	if sourceID == targetID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot merge entity into itself"})
		return
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		switch input.TargetType {
		case "artist":
			return mergeArtist(tx, sourceID, targetID, userID, input)
		case "work":
			return mergeWork(tx, sourceID, targetID, userID, input)
		case "release":
			return mergeRelease(tx, sourceID, targetID, userID, input)
		case "franchise":
			return mergeFranchise(tx, sourceID, targetID, userID, input)
		default:
			return fmt.Errorf("%w: %s", errUnsupportedMergeType, input.TargetType)
		}
	})
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Source or target entity not found"})
		case errors.Is(err, errUnsupportedMergeType):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		}
		return
	}

	if input.TargetType == "work" {
		s.deleteWorkSearchIndex(c.Request.Context(), sourceID)
		s.refreshWorkSearchIndex(c.Request.Context(), targetID)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "实体合并成功完成",
		"target_type": input.TargetType,
		"source_id":   sourceID,
		"target_id":   targetID,
	})
}

func mergeArtist(tx *gorm.DB, sourceID, targetID, editorID uuid.UUID, input mergeEntityInput) error {
	var source, target models.Artist
	if err := tx.Where("id = ?", sourceID).First(&source).Error; err != nil {
		return err
	}
	if err := tx.Where("id = ?", targetID).First(&target).Error; err != nil {
		return err
	}

	targetBefore := target
	if err := mergeEntityRelationships(tx, "artist", sourceID, targetID); err != nil {
		return err
	}
	if err := tx.Model(&models.Release{}).Where("publisher_id = ?", sourceID).Update("publisher_id", targetID).Error; err != nil {
		return err
	}
	if err := mergeFavorites(tx, "artist", sourceID, targetID); err != nil {
		return err
	}
	if err := mergeArtistTranslations(tx, sourceID, targetID); err != nil {
		return err
	}

	target.ExternalIDs = mergeJSONBPreferTarget(source.ExternalIDs, target.ExternalIDs)
	if err := tx.Model(&target).Update("external_ids", target.ExternalIDs).Error; err != nil {
		return err
	}
	if err := recordRevisionDB(tx, "artist", targetID, &editorID, "merge",
		fmt.Sprintf("合并主体: 将 [%s] (%s) 合并至当前主体", source.Name, shortID(source.ID)),
		input.MergeNote, input.SourceURLs,
		map[string]interface{}{"target_before": targetBefore, "merged_source": source},
		map[string]interface{}{"target_id": targetID, "merged_source_id": sourceID, "external_ids": target.ExternalIDs},
	); err != nil {
		return err
	}
	return tx.Where("id = ?", sourceID).Delete(&models.Artist{}).Error
}

func mergeWork(tx *gorm.DB, sourceID, targetID, editorID uuid.UUID, input mergeEntityInput) error {
	var source, target models.Work
	if err := tx.Where("id = ?", sourceID).First(&source).Error; err != nil {
		return err
	}
	if err := tx.Where("id = ?", targetID).First(&target).Error; err != nil {
		return err
	}

	targetBefore := target
	updates := []struct {
		model interface{}
		where string
		column string
	}{
		{&models.Release{}, "work_id = ?", "work_id"},
		{&models.CanonicalEntry{}, "work_id = ?", "work_id"},
		{&models.Track{}, "work_id = ?", "work_id"},
		{&models.DiscussionTopic{}, "work_id = ?", "work_id"},
		{&models.Comment{}, "work_id = ?", "work_id"},
	}
	for _, update := range updates {
		if err := tx.Model(update.model).Where(update.where, sourceID).Update(update.column, targetID).Error; err != nil {
			return err
		}
	}
	if err := mergeEntityRelationships(tx, "work", sourceID, targetID); err != nil {
		return err
	}
	if err := mergeFavorites(tx, "work", sourceID, targetID); err != nil {
		return err
	}
	if err := mergeAssetBindings(tx, "work", sourceID, targetID); err != nil {
		return err
	}
	if err := mergeWorkTranslations(tx, sourceID, targetID); err != nil {
		return err
	}
	if err := mergeTagJoin(tx, "work_tag_relations", "work_id", sourceID, targetID); err != nil {
		return err
	}

	target.Aliases = mergeAliases(target.Aliases, append([]string{source.Title, source.OriginalTitle}, []string(source.Aliases)...)...)
	target.ExternalIDs = mergeJSONBPreferTarget(source.ExternalIDs, target.ExternalIDs)
	if err := tx.Model(&target).Updates(map[string]interface{}{
		"aliases":      target.Aliases,
		"external_ids": target.ExternalIDs,
	}).Error; err != nil {
		return err
	}
	if err := recordRevisionDB(tx, "work", targetID, &editorID, "merge",
		fmt.Sprintf("合并作品: 将 [%s] (%s) 合并至当前作品", source.Title, shortID(source.ID)),
		input.MergeNote, input.SourceURLs,
		map[string]interface{}{"target_before": targetBefore, "merged_source": source},
		map[string]interface{}{"target_id": targetID, "merged_source_id": sourceID, "aliases": target.Aliases, "external_ids": target.ExternalIDs},
	); err != nil {
		return err
	}
	return tx.Where("id = ?", sourceID).Delete(&models.Work{}).Error
}

func mergeRelease(tx *gorm.DB, sourceID, targetID, editorID uuid.UUID, input mergeEntityInput) error {
	var source, target models.Release
	if err := tx.Where("id = ?", sourceID).First(&source).Error; err != nil {
		return err
	}
	if err := tx.Where("id = ?", targetID).First(&target).Error; err != nil {
		return err
	}

	targetBefore := target
	if err := tx.Model(&models.Medium{}).Where("release_id = ?", sourceID).Update("release_id", targetID).Error; err != nil {
		return err
	}
	if err := tx.Model(&models.DiscussionTopic{}).Where("release_id = ?", sourceID).Update("release_id", targetID).Error; err != nil {
		return err
	}
	if err := tx.Model(&models.Comment{}).Where("release_id = ?", sourceID).Update("release_id", targetID).Error; err != nil {
		return err
	}
	// Historical rows only; new resource writes use AssetRegistry + AssetBinding.
	if err := tx.Model(&models.AssetFile{}).Where("release_id = ?", sourceID).Update("release_id", targetID).Error; err != nil {
		return err
	}
	if err := mergeEntityRelationships(tx, "release", sourceID, targetID); err != nil {
		return err
	}
	if err := mergeFavorites(tx, "release", sourceID, targetID); err != nil {
		return err
	}
	if err := mergeAssetBindings(tx, "release", sourceID, targetID); err != nil {
		return err
	}

	target.ExternalIDs = mergeJSONBPreferTarget(source.ExternalIDs, target.ExternalIDs)
	target.CatalogMetadata = mergeJSONBPreferTarget(source.CatalogMetadata, target.CatalogMetadata)
	if err := tx.Model(&target).Updates(map[string]interface{}{
		"external_ids":     target.ExternalIDs,
		"catalog_metadata": target.CatalogMetadata,
	}).Error; err != nil {
		return err
	}
	if err := recordRevisionDB(tx, "release", targetID, &editorID, "merge",
		fmt.Sprintf("合并发行版: 将 [%s] (%s) 合并至当前发行版", source.EditionName, shortID(source.ID)),
		input.MergeNote, input.SourceURLs,
		map[string]interface{}{"target_before": targetBefore, "merged_source": source},
		map[string]interface{}{"target_id": targetID, "merged_source_id": sourceID, "external_ids": target.ExternalIDs},
	); err != nil {
		return err
	}
	return tx.Where("id = ?", sourceID).Delete(&models.Release{}).Error
}

func mergeFranchise(tx *gorm.DB, sourceID, targetID, editorID uuid.UUID, input mergeEntityInput) error {
	var source, target models.Franchise
	if err := tx.Where("id = ?", sourceID).First(&source).Error; err != nil {
		return err
	}
	if err := tx.Where("id = ?", targetID).First(&target).Error; err != nil {
		return err
	}

	targetBefore := target
	if err := mergeEntityRelationships(tx, "franchise", sourceID, targetID); err != nil {
		return err
	}
	if err := mergeFavorites(tx, "franchise", sourceID, targetID); err != nil {
		return err
	}
	if err := mergeFranchiseTranslations(tx, sourceID, targetID); err != nil {
		return err
	}
	if err := mergeTagJoin(tx, "franchise_tag_relations", "franchise_id", sourceID, targetID); err != nil {
		return err
	}

	target.Aliases = mergeAliases(target.Aliases, append([]string{source.Title, source.OriginalTitle}, []string(source.Aliases)...)...)
	target.ExternalIDs = mergeJSONBPreferTarget(source.ExternalIDs, target.ExternalIDs)
	if err := tx.Model(&target).Updates(map[string]interface{}{
		"aliases":      target.Aliases,
		"external_ids": target.ExternalIDs,
	}).Error; err != nil {
		return err
	}
	if err := recordRevisionDB(tx, "franchise", targetID, &editorID, "merge",
		fmt.Sprintf("合并企划: 将 [%s] (%s) 合并至当前企划", source.Title, shortID(source.ID)),
		input.MergeNote, input.SourceURLs,
		map[string]interface{}{"target_before": targetBefore, "merged_source": source},
		map[string]interface{}{"target_id": targetID, "merged_source_id": sourceID, "aliases": target.Aliases, "external_ids": target.ExternalIDs},
	); err != nil {
		return err
	}
	return tx.Where("id = ?", sourceID).Delete(&models.Franchise{}).Error
}

func mergeEntityRelationships(tx *gorm.DB, entityType string, sourceID, targetID uuid.UUID) error {
	var edges []models.EntityRelationship
	if err := tx.Where(
		"(source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)",
		entityType, sourceID, entityType, sourceID,
	).Find(&edges).Error; err != nil {
		return err
	}

	for _, edge := range edges {
		nextSourceID := edge.SourceID
		nextTargetID := edge.TargetID
		if edge.SourceType == entityType && edge.SourceID == sourceID {
			nextSourceID = targetID
		}
		if edge.TargetType == entityType && edge.TargetID == sourceID {
			nextTargetID = targetID
		}

		if edge.SourceType == edge.TargetType && nextSourceID == nextTargetID {
			if err := tx.Delete(&models.EntityRelationship{}, edge.ID).Error; err != nil {
				return err
			}
			continue
		}

		var relationType models.RelationType
		if err := tx.Where("code = ?", edge.RelationshipType).First(&relationType).Error; err == nil && relationType.IsEnabled {
			if err := ontology.ValidateRelationEdge(tx, ontology.EdgeSpec{
				SourceType:       edge.SourceType,
				SourceID:         nextSourceID,
				TargetType:       edge.TargetType,
				TargetID:         nextTargetID,
				RelationshipType: edge.RelationshipType,
				Qualifier:        edge.Qualifier,
			}); err != nil {
				return fmt.Errorf("merge would create invalid relation %s: %w", edge.RelationshipType, err)
			}
		}

		candidate := models.EntityRelationship{
			SourceType:       edge.SourceType,
			SourceID:         nextSourceID,
			TargetType:       edge.TargetType,
			TargetID:         nextTargetID,
			RelationshipType: edge.RelationshipType,
			Qualifier:        edge.Qualifier,
			BeginDate:        edge.BeginDate,
			EndDate:          edge.EndDate,
			Ended:            edge.Ended,
			Attributes:       edge.Attributes,
		}
		existing := candidate
		if err := tx.Where(
			"source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relationship_type = ? AND qualifier = ?",
			candidate.SourceType, candidate.SourceID, candidate.TargetType, candidate.TargetID, candidate.RelationshipType, candidate.Qualifier,
		).FirstOrCreate(&existing).Error; err != nil {
			return err
		}
		if err := tx.Delete(&models.EntityRelationship{}, edge.ID).Error; err != nil {
			return err
		}
	}
	return nil
}

func mergeFavorites(tx *gorm.DB, entityType string, sourceID, targetID uuid.UUID) error {
	if err := tx.Exec(`
		INSERT INTO favorites (user_id, target_type, target_id, created_at)
		SELECT user_id, target_type, ?, created_at
		FROM favorites
		WHERE target_type = ? AND target_id = ?
		ON CONFLICT (user_id, target_type, target_id) DO NOTHING
	`, targetID, entityType, sourceID).Error; err != nil {
		return err
	}
	return tx.Where("target_type = ? AND target_id = ?", entityType, sourceID).Delete(&models.Favorite{}).Error
}

func mergeAssetBindings(tx *gorm.DB, entityType string, sourceID, targetID uuid.UUID) error {
	var bindings []models.AssetBinding
	if err := tx.Where("target_entity_type = ? AND target_entity_id = ?", entityType, sourceID).Find(&bindings).Error; err != nil {
		return err
	}
	for _, binding := range bindings {
		candidate := models.AssetBinding{
			AssetID:          binding.AssetID,
			TargetEntityType: entityType,
			TargetEntityID:   targetID,
			BindingRole:      binding.BindingRole,
			DisplayOrder:     binding.DisplayOrder,
			Metadata:         binding.Metadata,
		}
		existing := candidate
		if err := tx.Where(
			"asset_id = ? AND target_entity_type = ? AND target_entity_id = ? AND binding_role = ?",
			candidate.AssetID, candidate.TargetEntityType, candidate.TargetEntityID, candidate.BindingRole,
		).FirstOrCreate(&existing).Error; err != nil {
			return err
		}
		if err := tx.Delete(&models.AssetBinding{}, binding.ID).Error; err != nil {
			return err
		}
	}
	return nil
}

func mergeWorkTranslations(tx *gorm.DB, sourceID, targetID uuid.UUID) error {
	if err := tx.Exec(`
		INSERT INTO work_translations (work_id, locale, title, summary)
		SELECT ?, locale, title, summary FROM work_translations WHERE work_id = ?
		ON CONFLICT (work_id, locale) DO NOTHING
	`, targetID, sourceID).Error; err != nil {
		return err
	}
	return tx.Where("work_id = ?", sourceID).Delete(&models.WorkTranslation{}).Error
}

func mergeArtistTranslations(tx *gorm.DB, sourceID, targetID uuid.UUID) error {
	if err := tx.Exec(`
		INSERT INTO artist_translations (artist_id, locale, name, biography)
		SELECT ?, locale, name, biography FROM artist_translations WHERE artist_id = ?
		ON CONFLICT (artist_id, locale) DO NOTHING
	`, targetID, sourceID).Error; err != nil {
		return err
	}
	return tx.Where("artist_id = ?", sourceID).Delete(&models.ArtistTranslation{}).Error
}

func mergeFranchiseTranslations(tx *gorm.DB, sourceID, targetID uuid.UUID) error {
	if err := tx.Exec(`
		INSERT INTO franchise_translations (franchise_id, locale, title, summary)
		SELECT ?, locale, title, summary FROM franchise_translations WHERE franchise_id = ?
		ON CONFLICT (franchise_id, locale) DO NOTHING
	`, targetID, sourceID).Error; err != nil {
		return err
	}
	return tx.Where("franchise_id = ?", sourceID).Delete(&models.FranchiseTranslation{}).Error
}

func mergeTagJoin(tx *gorm.DB, table, entityColumn string, sourceID, targetID uuid.UUID) error {
	allowed := map[string]string{
		"work_tag_relations":      "work_id",
		"franchise_tag_relations": "franchise_id",
	}
	if allowed[table] != entityColumn {
		return fmt.Errorf("unsupported tag join table %s", table)
	}
	query := fmt.Sprintf(`
		INSERT INTO %s (%s, tag_id)
		SELECT ?, tag_id FROM %s WHERE %s = ?
		ON CONFLICT (%s, tag_id) DO NOTHING
	`, table, entityColumn, table, entityColumn, entityColumn)
	if err := tx.Exec(query, targetID, sourceID).Error; err != nil {
		return err
	}
	return tx.Exec(fmt.Sprintf("DELETE FROM %s WHERE %s = ?", table, entityColumn), sourceID).Error
}

func mergeJSONBPreferTarget(source, target models.JSONB) models.JSONB {
	merged := models.JSONB{}
	for key, value := range source {
		merged[key] = value
	}
	for key, value := range target {
		merged[key] = value
	}
	return merged
}

func mergeAliases(existing pq.StringArray, values ...string) pq.StringArray {
	out := make([]string, 0, len(existing)+len(values))
	seen := make(map[string]bool, len(existing)+len(values))
	appendValue := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}
	for _, value := range existing {
		appendValue(value)
	}
	for _, value := range values {
		appendValue(value)
	}
	return pq.StringArray(out)
}

func shortID(id uuid.UUID) string {
	value := id.String()
	if len(value) > 8 {
		return value[:8]
	}
	return value
}
