package models

import (
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// WorkTranslation stores localized work display metadata.
// Aliases holds additional same-locale titles (e.g. 并列译名 / 同语种异名);
// the row Title is the primary title of that locale.
type WorkTranslation struct {
	WorkID  uuid.UUID      `gorm:"type:uuid;primaryKey" json:"work_id"`
	Locale  string         `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Title   string         `gorm:"type:varchar(255)" json:"title"`
	Summary string         `gorm:"type:text" json:"summary"`
	Aliases pq.StringArray `gorm:"type:text[]" json:"aliases"`
}

func (WorkTranslation) TableName() string { return "work_translations" }

// TopicTranslation stores localized community topic content.
type TopicTranslation struct {
	TopicID uuid.UUID `gorm:"type:uuid;primaryKey" json:"topic_id"`
	Locale  string    `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Title   string    `gorm:"type:varchar(255)" json:"title"`
	Content string    `gorm:"type:text" json:"content"`
}

func (TopicTranslation) TableName() string { return "topic_translations" }

// TagTranslation stores localized taxonomy labels while Tag keeps stable identity.
type TagTranslation struct {
	TagID  uint   `gorm:"primaryKey" json:"tag_id"`
	Locale string `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Name   string `gorm:"type:varchar(64);not null" json:"name"`
}

func (TagTranslation) TableName() string { return "tag_translations" }

// ArtistTranslation stores localized artist/entity display metadata.
type ArtistTranslation struct {
	ArtistID  uuid.UUID      `gorm:"type:uuid;primaryKey" json:"artist_id"`
	Locale    string         `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Name      string         `gorm:"type:varchar(255)" json:"name"`
	Biography string         `gorm:"type:text" json:"biography"`
	Aliases   pq.StringArray `gorm:"type:text[]" json:"aliases"`
}

func (ArtistTranslation) TableName() string { return "artist_translations" }

// FranchiseTranslation stores localized franchise display metadata.
type FranchiseTranslation struct {
	FranchiseID uuid.UUID      `gorm:"type:uuid;primaryKey" json:"franchise_id"`
	Locale      string         `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Title       string         `gorm:"type:varchar(255)" json:"title"`
	Summary     string         `gorm:"type:text" json:"summary"`
	Aliases     pq.StringArray `gorm:"type:text[]" json:"aliases"`
}

func (FranchiseTranslation) TableName() string { return "franchise_translations" }
