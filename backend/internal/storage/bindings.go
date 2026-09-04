package storage

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

var (
	ErrAssetNotFound        = errors.New("asset not found")
	ErrBindingTargetNotFound = errors.New("binding target not found")
	ErrInvalidBindingTarget  = errors.New("invalid binding target")
)

type BindAssetRequest struct {
	AssetID          uuid.UUID `json:"asset_id" binding:"required"`
	TargetEntityType string    `json:"target_entity_type" binding:"required"`
	TargetEntityID   uuid.UUID `json:"target_entity_id" binding:"required"`
	BindingRole      string    `json:"binding_role"`
}

// BindAsset attaches a CAS asset to an existing catalog entity. AssetRegistry
// is the storage source of truth; legacy AssetFile rows cannot receive new
// bindings.
func (s *StorageService) BindAsset(req *BindAssetRequest) (*models.AssetBinding, error) {
	return bindAssetDB(s.db, req)
}

func bindAssetDB(db *gorm.DB, req *BindAssetRequest) (*models.AssetBinding, error) {
	if req == nil || req.AssetID == uuid.Nil || req.TargetEntityID == uuid.Nil {
		return nil, ErrInvalidBindingTarget
	}

	var assetCount int64
	if err := db.Model(&models.AssetRegistry{}).Where("id = ?", req.AssetID).Count(&assetCount).Error; err != nil {
		return nil, err
	}
	if assetCount == 0 {
		return nil, ErrAssetNotFound
	}

	targetType := strings.ToLower(strings.TrimSpace(req.TargetEntityType))
	if err := validateBindingTarget(db, targetType, req.TargetEntityID); err != nil {
		return nil, err
	}

	role := strings.TrimSpace(req.BindingRole)
	if role == "" {
		role = "master_archive"
	}
	if len(role) > 64 {
		return nil, fmt.Errorf("%w: binding_role exceeds 64 characters", ErrInvalidBindingTarget)
	}

	binding := models.AssetBinding{
		AssetID:          req.AssetID,
		TargetEntityType: targetType,
		TargetEntityID:   req.TargetEntityID,
		BindingRole:      role,
	}
	if err := db.Where(
		"asset_id = ? AND target_entity_type = ? AND target_entity_id = ? AND binding_role = ?",
		binding.AssetID, binding.TargetEntityType, binding.TargetEntityID, binding.BindingRole,
	).FirstOrCreate(&binding).Error; err != nil {
		return nil, err
	}
	return &binding, nil
}

func validateBindingTarget(db *gorm.DB, targetType string, targetID uuid.UUID) error {
	var model interface{}
	switch targetType {
	case "work":
		model = &models.Work{}
	case "release":
		model = &models.Release{}
	case "medium":
		model = &models.Medium{}
	case "track":
		model = &models.Track{}
	case "canonical_entry":
		model = &models.CanonicalEntry{}
	default:
		return fmt.Errorf("%w: unsupported target_entity_type %q", ErrInvalidBindingTarget, targetType)
	}

	var count int64
	if err := db.Model(model).Where("id = ?", targetID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return fmt.Errorf("%w: %s %s", ErrBindingTargetNotFound, targetType, targetID)
	}
	return nil
}
