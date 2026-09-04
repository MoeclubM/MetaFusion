package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// AdminAuditLog persists privileged administrative actions for accountability.
type AdminAuditLog struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ActorID    *uuid.UUID `gorm:"type:uuid" json:"actor_id"`
	ActorRole  string     `gorm:"type:varchar(32)" json:"actor_role"`
	Action     string     `gorm:"type:varchar(64);not null" json:"action"`
	TargetType string     `gorm:"type:varchar(32)" json:"target_type"`
	TargetID   string     `gorm:"type:varchar(64)" json:"target_id"`
	Detail     JSONB      `gorm:"type:jsonb;default:'{}'" json:"detail"`
	IP         string     `gorm:"type:varchar(45)" json:"ip"`
	UserAgent  string     `gorm:"type:text" json:"user_agent"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (AdminAuditLog) TableName() string { return "admin_audit_logs" }

// EntityRevision represents append-only catalog edit snapshots.
type EntityRevision struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	TargetType  string         `gorm:"type:varchar(32);not null" json:"target_type"` // 'work', 'artist', 'release', 'canonical_entry'
	TargetID    uuid.UUID      `gorm:"type:uuid;not null" json:"target_id"`
	EditorID    *uuid.UUID     `gorm:"type:uuid" json:"editor_id,omitempty"`
	EditType    string         `gorm:"type:varchar(32);not null" json:"edit_type"` // 'create', 'update', 'delete', 'merge', 'rollback'
	Summary     string         `gorm:"type:varchar(255);default:'';not null" json:"summary"`
	EditNote    string         `gorm:"type:text;default:'';not null" json:"edit_note"`
	SourceURLs  pq.StringArray `gorm:"type:text[]" json:"source_urls"`
	BeforeState JSONB          `gorm:"type:jsonb;default:'{}'" json:"before_state"`
	AfterState  JSONB          `gorm:"type:jsonb;default:'{}'" json:"after_state"`
	Diff        JSONB          `gorm:"type:jsonb;default:'{}'" json:"diff"`
	Status      string         `gorm:"type:varchar(16);default:'applied';not null" json:"status"` // 'applied', 'pending', 'rejected', 'reverted'
	CreatedAt   time.Time      `json:"created_at"`

	Editor *User `gorm:"foreignKey:EditorID" json:"editor,omitempty"`
}

func (EntityRevision) TableName() string { return "entity_revisions" }
