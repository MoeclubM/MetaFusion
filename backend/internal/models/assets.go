package models

import (
	"time"

	"github.com/google/uuid"
)

// AssetFile represents the legacy release-bound physical asset model.
// New storage flows should prefer AssetRegistry + AssetBinding and keep this
// type only while compatibility readers/writers are being migrated.
type AssetFile struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ReleaseID        uuid.UUID  `gorm:"type:uuid;not null" json:"release_id"`
	MediumID         *uuid.UUID `gorm:"type:uuid" json:"medium_id,omitempty"`
	TrackID          *uuid.UUID `gorm:"type:uuid" json:"track_id,omitempty"`
	CanonicalEntryID *uuid.UUID `gorm:"type:uuid" json:"canonical_entry_id,omitempty"`
	FileRole         string     `gorm:"default:'master_archive';not null" json:"file_role"`
	FileName         string     `gorm:"not null" json:"file_name"`
	S3Bucket         string     `gorm:"not null" json:"s3_bucket"`
	S3Key            string     `gorm:"not null" json:"s3_key"`
	FileSize         int64      `gorm:"not null" json:"file_size"`
	Sha256Hash      string     `gorm:"not null;index" json:"sha256_hash"`
	MimeType        string     `gorm:"not null" json:"mime_type"`
	TechnicalSpecs  JSONB      `gorm:"type:jsonb;default:'{}'" json:"technical_specs"`
	TranscodeStatus string     `gorm:"default:'pending';not null" json:"transcode_status"`
	TranscodeError  string     `json:"transcode_error,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (AssetFile) TableName() string { return "asset_files" }

// AssetRegistry represents standalone bit-exact physical assets in the CAS storage system.
type AssetRegistry struct {
	ID              uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Sha256Hash      string     `gorm:"type:varchar(64);uniqueIndex;not null" json:"sha256_hash"`
	FileName        string     `gorm:"type:varchar(255);not null" json:"file_name"`
	FileSize        int64      `gorm:"not null" json:"file_size"`
	MimeType        string     `gorm:"type:varchar(128);not null" json:"mime_type"`
	S3Bucket        string     `gorm:"type:varchar(64);not null" json:"s3_bucket"`
	S3Key           string     `gorm:"type:varchar(1024);not null" json:"s3_key"`
	StorageTier     string     `gorm:"type:varchar(32);default:'hot_s3';not null" json:"storage_tier"`
	TechnicalSpecs  JSONB      `gorm:"type:jsonb;default:'{}'" json:"technical_specs"`
	TranscodeStatus string     `gorm:"type:varchar(32);default:'pending';not null" json:"transcode_status"`
	TranscodeError  string     `gorm:"type:text" json:"transcode_error,omitempty"`
	Derivatives     JSONB      `gorm:"type:jsonb;default:'{}'" json:"derivatives"`
	CreatedBy       *uuid.UUID `gorm:"type:uuid" json:"created_by,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`

	Bindings []AssetBinding `gorm:"foreignKey:AssetID" json:"bindings,omitempty"`
}

func (AssetRegistry) TableName() string { return "asset_registry" }

// AssetBinding attaches a standalone physical asset to a catalog entity.
type AssetBinding struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	AssetID          uuid.UUID `gorm:"type:uuid;not null;index" json:"asset_id"`
	TargetEntityType string    `gorm:"type:varchar(32);not null;index" json:"target_entity_type"` // 'medium', 'track', 'canonical_entry', 'release', 'work'
	TargetEntityID   uuid.UUID `gorm:"type:uuid;not null;index" json:"target_entity_id"`
	BindingRole      string    `gorm:"type:varchar(64);default:'master_archive';not null" json:"binding_role"` // 'disc_image', 'track_audio', 'scans', 'video', 'bonus'
	DisplayOrder     int       `gorm:"default:0;not null" json:"display_order"`
	Metadata         JSONB     `gorm:"type:jsonb;default:'{}'" json:"metadata"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`

	Asset *AssetRegistry `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}

func (AssetBinding) TableName() string { return "asset_bindings" }
