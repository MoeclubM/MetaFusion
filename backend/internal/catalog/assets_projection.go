package catalog

import (
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

type AssetResourceItem struct {
	models.AssetRegistry
	FileRole         string    `json:"file_role"`
	TargetEntityType string    `json:"target_entity_type"`
	TargetEntityID   uuid.UUID `json:"target_entity_id"`
}

// ProjectAssetResourcesForTarget returns exact CAS-bound resources without
// inventing release ownership for expression-level assets.
func ProjectAssetResourcesForTarget(db *gorm.DB, targetType string, targetID uuid.UUID) []AssetResourceItem {
	var bindings []models.AssetBinding
	if err := db.Preload("Asset").
		Where("target_entity_type = ? AND target_entity_id = ?", targetType, targetID).
		Order("display_order asc, created_at asc").
		Find(&bindings).Error; err != nil {
		return []AssetResourceItem{}
	}

	out := make([]AssetResourceItem, 0, len(bindings))
	for _, binding := range bindings {
		if binding.Asset == nil {
			continue
		}
		out = append(out, AssetResourceItem{
			AssetRegistry:    *binding.Asset,
			FileRole:         binding.BindingRole,
			TargetEntityType: binding.TargetEntityType,
			TargetEntityID:   binding.TargetEntityID,
		})
	}
	return out
}

// AttachReleaseAssetProjections preserves the old release.asset_files and
// medium.asset_files response shape from CAS bindings. A release owns direct
// release bindings and assets bound to its Medium/Track descendants. Assets
// bound to CanonicalEntry are expression-level resources and are intentionally
// not inferred as release-specific.
func AttachReleaseAssetProjections(db *gorm.DB, release *models.Release) {
	if release == nil || release.ID == uuid.Nil {
		return
	}

	mediumIDs := make([]uuid.UUID, 0, len(release.Mediums))
	trackIDs := make([]uuid.UUID, 0)
	mediumIndex := make(map[uuid.UUID]int, len(release.Mediums))
	trackMedium := make(map[uuid.UUID]uuid.UUID)
	for i := range release.Mediums {
		medium := &release.Mediums[i]
		mediumIDs = append(mediumIDs, medium.ID)
		mediumIndex[medium.ID] = i
		medium.AssetFiles = []models.AssetFile{}
		for _, track := range medium.Tracks {
			trackIDs = append(trackIDs, track.ID)
			trackMedium[track.ID] = medium.ID
		}
	}

	query := db.Preload("Asset").Where("target_entity_type = 'release' AND target_entity_id = ?", release.ID)
	if len(mediumIDs) > 0 {
		query = query.Or("target_entity_type = 'medium' AND target_entity_id IN ?", mediumIDs)
	}
	if len(trackIDs) > 0 {
		query = query.Or("target_entity_type = 'track' AND target_entity_id IN ?", trackIDs)
	}

	var bindings []models.AssetBinding
	if err := query.Order("display_order asc, created_at asc").Find(&bindings).Error; err != nil {
		release.AssetFiles = []models.AssetFile{}
		return
	}

	release.AssetFiles = make([]models.AssetFile, 0, len(bindings))
	seenRelease := make(map[string]bool, len(bindings))
	seenMedium := make(map[uuid.UUID]map[string]bool, len(release.Mediums))
	for _, binding := range bindings {
		if binding.Asset == nil {
			continue
		}

		var mediumID, trackID *uuid.UUID
		switch binding.TargetEntityType {
		case "medium":
			id := binding.TargetEntityID
			mediumID = &id
		case "track":
			tid := binding.TargetEntityID
			trackID = &tid
			if mid, ok := trackMedium[tid]; ok {
				id := mid
				mediumID = &id
			}
		}

		projected := projectAssetBinding(binding, &release.ID, mediumID, trackID)
		key := projected.ID.String() + "|" + projected.FileRole
		if !seenRelease[key] {
			seenRelease[key] = true
			release.AssetFiles = append(release.AssetFiles, projected)
		}
		if mediumID != nil {
			if idx, ok := mediumIndex[*mediumID]; ok {
				if seenMedium[*mediumID] == nil {
					seenMedium[*mediumID] = make(map[string]bool)
				}
				if !seenMedium[*mediumID][key] {
					seenMedium[*mediumID][key] = true
					release.Mediums[idx].AssetFiles = append(release.Mediums[idx].AssetFiles, projected)
				}
			}
		}
	}
}

// AttachMediumAssetProjection is the single-medium equivalent used by the
// medium detail endpoint.
func AttachMediumAssetProjection(db *gorm.DB, medium *models.Medium) {
	if medium == nil || medium.ID == uuid.Nil {
		return
	}

	trackIDs := make([]uuid.UUID, 0, len(medium.Tracks))
	for _, track := range medium.Tracks {
		trackIDs = append(trackIDs, track.ID)
	}
	query := db.Preload("Asset").Where("target_entity_type = 'medium' AND target_entity_id = ?", medium.ID)
	if len(trackIDs) > 0 {
		query = query.Or("target_entity_type = 'track' AND target_entity_id IN ?", trackIDs)
	}
	var bindings []models.AssetBinding
	if err := query.Order("display_order asc, created_at asc").Find(&bindings).Error; err != nil {
		medium.AssetFiles = []models.AssetFile{}
		return
	}

	medium.AssetFiles = make([]models.AssetFile, 0, len(bindings))
	seen := make(map[string]bool, len(bindings))
	for _, binding := range bindings {
		if binding.Asset == nil {
			continue
		}
		mid := medium.ID
		var trackID *uuid.UUID
		if binding.TargetEntityType == "track" {
			id := binding.TargetEntityID
			trackID = &id
		}
		projected := projectAssetBinding(binding, &medium.ReleaseID, &mid, trackID)
		key := projected.ID.String() + "|" + projected.FileRole
		if seen[key] {
			continue
		}
		seen[key] = true
		medium.AssetFiles = append(medium.AssetFiles, projected)
	}
}

func projectAssetBinding(binding models.AssetBinding, releaseID, mediumID, trackID *uuid.UUID) models.AssetFile {
	asset := binding.Asset
	legacy := models.AssetFile{
		ID:              asset.ID,
		FileRole:        binding.BindingRole,
		FileName:        asset.FileName,
		S3Bucket:        asset.S3Bucket,
		S3Key:           asset.S3Key,
		FileSize:        asset.FileSize,
		Sha256Hash:      asset.Sha256Hash,
		MimeType:        asset.MimeType,
		TechnicalSpecs:  asset.TechnicalSpecs,
		TranscodeStatus: asset.TranscodeStatus,
		TranscodeError:  asset.TranscodeError,
		CreatedAt:       asset.CreatedAt,
		UpdatedAt:       asset.UpdatedAt,
	}
	if releaseID != nil {
		legacy.ReleaseID = *releaseID
	}
	legacy.MediumID = mediumID
	legacy.TrackID = trackID
	if binding.TargetEntityType == "canonical_entry" {
		id := binding.TargetEntityID
		legacy.CanonicalEntryID = &id
	}
	return legacy
}
