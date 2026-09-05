package models

import "github.com/google/uuid"

// TrackContent identifies an expression included at a location on a carrier.
// Position orders the included expressions independently of printed numbering.
type TrackContent struct {
	ID               uuid.UUID       `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	TrackID          uuid.UUID       `gorm:"type:uuid;not null" json:"track_id"`
	CanonicalEntryID uuid.UUID       `gorm:"type:uuid;not null" json:"canonical_entry_id"`
	Position         int             `gorm:"not null" json:"position"`
	Locator          JSONB           `gorm:"type:jsonb;default:'{}'" json:"locator"`
	CanonicalEntry   *CanonicalEntry `gorm:"foreignKey:CanonicalEntryID" json:"canonical_entry,omitempty"`
}

func (TrackContent) TableName() string { return "track_contents" }
