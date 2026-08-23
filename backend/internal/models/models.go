package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// JSONB is a custom GORM type for Postgres JSONB fields
type JSONB map[string]interface{}

func (j JSONB) Value() (driver.Value, error) {
	if j == nil {
		return "{}", nil
	}
	return json.Marshal(j)
}

func (j *JSONB) Scan(value interface{}) error {
	if value == nil {
		*j = make(map[string]interface{})
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		s, ok2 := value.(string)
		if !ok2 {
			return errors.New("type assertion to []byte failed")
		}
		bytes = []byte(s)
	}
	if len(bytes) == 0 || string(bytes) == "null" {
		*j = make(map[string]interface{})
		return nil
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(bytes, &obj); err == nil {
		*j = obj
		return nil
	}
	// relation_types.attribute_schema 等字段在 SQL 种子里是 JSON 数组
	var arr []interface{}
	if err := json.Unmarshal(bytes, &arr); err == nil {
		*j = JSONB{"fields": arr}
		return nil
	}
	return json.Unmarshal(bytes, j)
}

// User represents a platform member
type User struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Username         string     `gorm:"uniqueIndex;not null" json:"username"`
	DisplayName      *string    `gorm:"type:varchar(128)" json:"display_name,omitempty"`
	Email            string     `gorm:"uniqueIndex;not null" json:"email"`
	PasswordHash     string     `gorm:"not null" json:"-"`
	Role             string     `gorm:"default:'member';not null" json:"role"`
	InviteCode       string     `gorm:"uniqueIndex" json:"invite_code"`
	InvitesRemaining int        `gorm:"default:999;not null" json:"invites_remaining"`
	InvitedBy        *uuid.UUID `gorm:"type:uuid" json:"invited_by,omitempty"`
	AvatarURL        string     `json:"avatar_url"`
	Bio              string     `json:"bio"`
	FavoritesPublic  bool       `gorm:"default:true;not null" json:"favorites_public"`
	EmailPublic      bool       `gorm:"default:false;not null" json:"email_public"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`

	Inviter *User `gorm:"foreignKey:InvitedBy" json:"inviter,omitempty"`
}

// Favorite 用户收藏（作品 / 发行版 / 艺术家），user_id + target 唯一
type Favorite struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_fav_user_target,priority:1" json:"user_id"`
	TargetType string    `gorm:"type:varchar(16);not null;uniqueIndex:idx_fav_user_target,priority:2" json:"target_type"` // 'work', 'release', 'artist', 'franchise'
	TargetID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_fav_user_target,priority:3" json:"target_id"`
	CreatedAt  time.Time `gorm:"index" json:"created_at"`

	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (Favorite) TableName() string { return "favorites" }


// Invitation represents an invite code
type Invitation struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Code      string     `gorm:"uniqueIndex;not null" json:"code"`
	InviterID uuid.UUID  `gorm:"type:uuid;not null" json:"inviter_id"`
	UsedBy    *uuid.UUID `gorm:"type:uuid" json:"used_by,omitempty"`
	IsUsed    bool       `gorm:"default:false;not null" json:"is_used"`
	ExpiresAt time.Time  `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`

	Inviter *User `gorm:"foreignKey:InviterID" json:"inviter,omitempty"`
	User    *User `gorm:"foreignKey:UsedBy" json:"user,omitempty"`
}

// ValidLocales 允许的语种白名单（翻译表；未单独建 Nomen 的题名仍可用 original_title/aliases）
var ValidLocales = map[string]bool{
	"zh-CN": true, "zh-TW": true, "en-US": true, "ja": true, "ko": true,
}

// NormalizeLocale maps inbound tags (Accept-Language, typed aliases) onto ValidLocales.
func NormalizeLocale(input string) string {
	if ValidLocales[input] {
		return input
	}
	low := input
	if len(low) >= 5 {
		switch low[:5] {
		case "zh-TW", "zh-HK":
			return "zh-TW"
		}
	}
	if len(low) >= 2 {
		switch low[:2] {
		case "en", "EN":
			return "en-US"
		case "zh", "ZH":
			return "zh-CN"
		case "ja", "JA":
			return "ja"
		case "ko", "KO":
			return "ko"
		}
	}
	return "zh-CN"
}

// MediaType is the admin-governed form dictionary (game/comic/music/…)
type MediaType struct {
	Code        string    `gorm:"primaryKey;type:varchar(32)" json:"code"`
	NameZh      string    `gorm:"type:varchar(64);not null" json:"name_zh"`
	NameEn      string    `gorm:"type:varchar(64);not null" json:"name_en"`
	Names       JSONB     `gorm:"type:jsonb;default:'{}'" json:"names"`
	Description string    `gorm:"type:text" json:"description"`
	Icon        string    `gorm:"type:varchar(64)" json:"icon"`
	SortOrder   int       `gorm:"default:0;not null" json:"sort_order"`
	IsEnabled   bool      `gorm:"default:true;not null" json:"is_enabled"`
	CLCPrefix   string    `gorm:"type:varchar(16)" json:"clc_prefix"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (MediaType) TableName() string { return "media_types" }

// Category represents hierarchical media classifications
type Category struct {
	Code       string  `gorm:"primaryKey" json:"code"`
	ParentCode *string `json:"parent_code,omitempty"`
	NameZh     string  `gorm:"not null" json:"name_zh"`
	NameEn     string  `gorm:"not null" json:"name_en"`
	Names      JSONB   `gorm:"type:jsonb;default:'{}'" json:"names"`
	MediaType  string  `gorm:"not null" json:"media_type"`
	SortOrder  int     `gorm:"default:0;not null" json:"sort_order"`
	CLCPrefix  string  `json:"clc_prefix,omitempty"`
}

func (c Category) LocalizedName(locale string) string {
	loc := NormalizeLocale(locale)
	if c.Names != nil {
		if v, ok := c.Names[loc]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	if loc == "en-US" && c.NameEn != "" {
		return c.NameEn
	}
	return c.NameZh
}

// VirtualShelf represents decoupled external classification and curated view rules
type VirtualShelf struct {
	Slug           string         `gorm:"primaryKey" json:"slug"`
	ParentSlug     *string        `json:"parent_slug,omitempty"`
	NameZh         string         `gorm:"not null" json:"name_zh"`
	NameEn         string         `gorm:"not null" json:"name_en"`
	Description    string         `json:"description"`
	Icon           string         `json:"icon"`
	SortOrder      int            `gorm:"default:0;not null" json:"sort_order"`
	QueryTags      pq.StringArray `gorm:"type:text[]" json:"query_tags"`
	RequireAllTags bool           `gorm:"default:false;not null" json:"require_all_tags"`
	ExcludeTags    pq.StringArray `gorm:"type:text[]" json:"exclude_tags"`

	Children []VirtualShelf `gorm:"foreignKey:ParentSlug;references:Slug" json:"children,omitempty"`
}

func (s VirtualShelf) LocalizedName(locale string) string {
	if NormalizeLocale(locale) == "en-US" && s.NameEn != "" {
		return s.NameEn
	}
	return s.NameZh
}

// WorkStatus constants
const (
	WorkStatusPendingReview = "pending_review"
	WorkStatusPublished     = "published"
	WorkStatusCompleted     = "completed"
	WorkStatusRejected      = "rejected"
	WorkStatusDraft         = "draft"
)

// Tag group_type values. format/medium/genre/theme/general apply to Work.
// spec is leftover ontology only — 规格 is Release/Medium/AssetFile metadata, not a tag facet.
const (
	TagGroupFormat  = "format"
	TagGroupMedium  = "medium"
	TagGroupGenre   = "genre"
	TagGroupTheme   = "theme"
	TagGroupSpec    = "spec"
	TagGroupGeneral = "general"
	TagGroupTopic   = "topic"
)

func TagGroupIsCarrier(groupType string) bool {
	return groupType == TagGroupSpec
}

func TagGroupIsWorkFacet(groupType string) bool {
	switch groupType {
	case TagGroupFormat, TagGroupMedium, TagGroupGenre, TagGroupTheme, TagGroupGeneral:
		return true
	default:
		return false
	}
}

// Tag represents taxonomy tags
type Tag struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	Name          string         `gorm:"uniqueIndex;not null" json:"name"`
	GroupType     string         `gorm:"not null" json:"group_type"`
	CategoryScope pq.StringArray `gorm:"type:text[]" json:"category_scope"`
}

// EntityType constants
const (
	EntityTypePerson    = "person"
	EntityTypeGroup     = "group"
	EntityTypeOrchestra = "orchestra"
	EntityTypeStudio    = "studio"
	EntityTypePublisher = "publisher"
	EntityTypeCircle    = "circle"
	EntityTypeLabel     = "label"
)

// Artist represents MusicBrainz-grade creators, entities, orchestras, studios
type Artist struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name           string     `gorm:"not null" json:"name"`
	OriginalName   string     `json:"original_name"`
	Disambiguation string     `json:"disambiguation"`
	EntityType     string     `gorm:"default:'person';not null" json:"entity_type"`
	Country        string     `json:"country"`
	Biography      string     `json:"biography"`
	BeginDate      string     `gorm:"type:varchar(16)" json:"begin_date"`
	EndDate        string     `gorm:"type:varchar(16)" json:"end_date"`
	Ended          bool       `gorm:"default:false;not null" json:"ended"`
	ExternalIDs    JSONB      `gorm:"type:jsonb;default:'{}'" json:"external_ids"`
	Attributes     JSONB      `gorm:"type:jsonb;default:'{}'" json:"attributes"`
	Language       string     `gorm:"type:varchar(16);default:'zh-CN'" json:"language"`
	CreatedBy      *uuid.UUID `gorm:"type:uuid" json:"created_by,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`

	Translations []ArtistTranslation `gorm:"foreignKey:ArtistID" json:"translations,omitempty"`
}

// WorkArtistRelation represents structured creator roles (Composer, Director, Author, etc.)
type WorkArtistRelation struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	WorkID    uuid.UUID `gorm:"type:uuid;not null" json:"work_id"`
	ArtistID  uuid.UUID `gorm:"type:uuid;not null" json:"artist_id"`
	Role      string    `gorm:"not null" json:"role"`
	CreatedAt time.Time `json:"created_at"`

	Artist *Artist `gorm:"foreignKey:ArtistID" json:"artist,omitempty"`
}

// Work represents FRBR Work entity
type Work struct {
	ID              uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	CategoryCode    string         `gorm:"default:''" json:"category_code"`
	Title           string         `gorm:"not null" json:"title"`
	OriginalTitle   string         `json:"original_title"`
	Aliases         pq.StringArray `gorm:"type:text[]" json:"aliases"`
	ReleaseDate     *time.Time     `json:"release_date,omitempty"`
	BeginDate       string         `gorm:"type:varchar(16)" json:"begin_date"`
	EndDate         string         `gorm:"type:varchar(16)" json:"end_date"`
	Ended           bool           `gorm:"default:false;not null" json:"ended"`
	Country         string         `json:"country"`
	Language        string         `gorm:"default:'zh-CN'" json:"language"`
	// OriginalLanguage 作品内容本身的语言（ISO 639-1，如 zh/ja/en/ko）。
	// Language 是默认显示语种（BCP-47），与 translations 中设为默认的那一组题名+简介对应。
	OriginalLanguage string `gorm:"type:varchar(16);default:''" json:"original_language"`
	Summary          string `json:"summary"`
	CoverImageURL   string         `json:"cover_image_url"`
	// CoverAspect 手动指定的封面显示比例（"1:1"/"2:3"/"3:4"），空串 = 自动推断
	CoverAspect     string         `gorm:"type:varchar(8);default:''" json:"cover_aspect"`
	ContentRating   string         `gorm:"default:'General'" json:"content_rating"`
	Status          string         `gorm:"default:'completed'" json:"status"`
	ViewCount       int64          `gorm:"default:0;not null" json:"view_count"`
	FavoriteCount   int64          `gorm:"-" json:"favorite_count"`
	ExternalIDs     JSONB          `gorm:"type:jsonb;default:'{}'" json:"external_ids"`
	Attributes      JSONB          `gorm:"type:jsonb;default:'{}'" json:"attributes"`
	CatalogMetadata JSONB          `gorm:"type:jsonb;default:'{}'" json:"catalog_metadata"`
	CreatedBy       *uuid.UUID     `gorm:"type:uuid" json:"created_by,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`

	Category        *Category            `gorm:"foreignKey:CategoryCode;references:Code" json:"category,omitempty"`
	Tags            []Tag                `gorm:"many2many:work_tag_relations;" json:"tags,omitempty"`
	ArtistRelations []WorkArtistRelation `gorm:"foreignKey:WorkID" json:"artist_relations,omitempty"`
	Releases        []Release            `gorm:"foreignKey:WorkID" json:"releases,omitempty"`
	Translations    []WorkTranslation    `gorm:"foreignKey:WorkID" json:"translations,omitempty"`
}

// Release represents FRBR Manifestation / Commercial Release Boxset
type Release struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	WorkID           uuid.UUID  `gorm:"type:uuid;not null" json:"work_id"`
	PublisherID      *uuid.UUID `gorm:"type:uuid" json:"publisher_id,omitempty"`
	EditionName      string     `gorm:"not null" json:"edition_name"`
	CatalogNumber    string     `json:"catalog_number"`
	Barcode          string     `json:"barcode"`
	Publisher        string     `json:"publisher"`
	Packaging            string     `gorm:"default:'box_set'" json:"packaging"`
	EditionDate          *time.Time `json:"edition_date,omitempty"`
	Country              string     `json:"country"`
	Language             string     `json:"language"`
	DistributionChannel  string     `gorm:"default:'mixed';not null" json:"distribution_channel"`
	ExternalIDs          JSONB      `gorm:"type:jsonb;default:'{}'" json:"external_ids"`
	Attributes           JSONB      `gorm:"type:jsonb;default:'{}'" json:"attributes"`
	CatalogMetadata      JSONB      `gorm:"type:jsonb;default:'{}'" json:"catalog_metadata"`
	UploaderID           *uuid.UUID `gorm:"type:uuid" json:"uploader_id,omitempty"`
	IsMasterVerified     bool       `gorm:"default:false;not null" json:"is_master_verified"`
	Notes                string     `json:"notes"`
	CreatedAt            time.Time  `json:"created_at"`

	PublisherEntity *Artist     `gorm:"foreignKey:PublisherID" json:"publisher_entity,omitempty"`
	Work            *Work       `gorm:"foreignKey:WorkID" json:"work,omitempty"`
	Uploader        *User       `gorm:"foreignKey:UploaderID" json:"uploader,omitempty"`
	Mediums         []Medium    `gorm:"foreignKey:ReleaseID" json:"mediums,omitempty"`
	AssetFiles      []AssetFile `gorm:"foreignKey:ReleaseID" json:"asset_files,omitempty"`
}

// Medium represents physical discs or volumes within a release
type Medium struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ReleaseID     uuid.UUID `gorm:"type:uuid;not null" json:"release_id"`
	Position      int       `gorm:"not null" json:"position"`
	Name          string    `gorm:"not null" json:"name"`
	Format        string    `gorm:"not null" json:"format"`
	MediaCategory string    `gorm:"not null" json:"media_category"`
	TrackCount    int       `gorm:"default:0;not null" json:"track_count"`
	Attributes    JSONB     `gorm:"type:jsonb;default:'{}'" json:"attributes"`

	Tracks     []Track     `gorm:"foreignKey:MediumID" json:"tracks,omitempty"`
	AssetFiles []AssetFile `gorm:"foreignKey:MediumID" json:"asset_files,omitempty"`
}

func (Artist) TableName() string {
	return "artists"
}

func (Work) TableName() string {
	return "works"
}

func (Release) TableName() string {
	return "releases"
}

func (Medium) TableName() string {
	return "mediums"
}

func (Track) TableName() string {
	return "tracks"
}

func (AssetFile) TableName() string {
	return "asset_files"
}

func (WorkArtistRelation) TableName() string {
	return "work_artist_relations"
}

// Franchise is a first-class IP / universe hub (not a Work)
type Franchise struct {
	ID              uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Title           string         `gorm:"not null" json:"title"`
	OriginalTitle   string         `json:"original_title"`
	Aliases         pq.StringArray `gorm:"type:text[]" json:"aliases"`
	Disambiguation  string         `json:"disambiguation"`
	Summary         string         `json:"summary"`
	CoverImageURL   string         `json:"cover_image_url"`
	BeginDate       string         `gorm:"type:varchar(16)" json:"begin_date"`
	EndDate         string         `gorm:"type:varchar(16)" json:"end_date"`
	Ended           bool           `gorm:"default:false;not null" json:"ended"`
	Country         string         `json:"country"`
	Language        string         `gorm:"type:varchar(16);default:'zh-CN'" json:"language"`
	ExternalIDs     JSONB          `gorm:"type:jsonb;default:'{}'" json:"external_ids"`
	Attributes      JSONB          `gorm:"type:jsonb;default:'{}'" json:"attributes"`
	CatalogMetadata JSONB          `gorm:"type:jsonb;default:'{}'" json:"catalog_metadata"`
	CreatedBy       *uuid.UUID     `gorm:"type:uuid" json:"created_by,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	FavoriteCount   int64          `gorm:"-" json:"favorite_count"`

	Tags         []Tag                   `gorm:"many2many:franchise_tag_relations;" json:"tags,omitempty"`
	Translations []FranchiseTranslation  `gorm:"foreignKey:FranchiseID" json:"translations,omitempty"`
}

func (Franchise) TableName() string { return "franchises" }

type FranchiseTranslation struct {
	FranchiseID uuid.UUID `gorm:"type:uuid;primaryKey" json:"franchise_id"`
	Locale      string    `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Title       string    `gorm:"type:varchar(255)" json:"title"`
	Summary     string    `gorm:"type:text" json:"summary"`
}

func (FranchiseTranslation) TableName() string { return "franchise_translations" }

func (EntityRelationship) TableName() string {
	return "entity_relationships"
}

func (DiscussionTopic) TableName() string {
	return "discussion_topics"
}

func (CanonicalEntry) TableName() string {
	return "canonical_entries"
}

// CanonicalEntry represents a reusable master entry for multi-edition unification
// Generic naming covers all media: music recording, TV episode master, book chapter, gallery page
type CanonicalEntry struct {
	ID            uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Title         string     `gorm:"not null" json:"title"`
	SortTitle     string     `json:"sort_title"`
	Duration      int        `gorm:"column:duration_seconds" json:"duration_seconds"`
	ISRC          string     `json:"isrc"`
	ISBN          string     `json:"isbn"`
	ArtistCredit  string     `json:"artist_credit"`
	RecordingDate string     `gorm:"type:varchar(16)" json:"recording_date"`
	WorkID        *uuid.UUID `gorm:"type:uuid" json:"work_id,omitempty"`
	ExternalIDs   JSONB      `gorm:"type:jsonb;default:'{}'" json:"external_ids"`
	Attributes    JSONB      `gorm:"type:jsonb;default:'{}'" json:"attributes"`
	CreatedAt     time.Time  `json:"created_at"`

	Work *Work `gorm:"foreignKey:WorkID" json:"work,omitempty"`
}

// Track represents a position reference to a CanonicalEntry on a medium
type Track struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	MediumID         uuid.UUID  `gorm:"type:uuid;not null" json:"medium_id"`
	CanonicalEntryID *uuid.UUID `gorm:"type:uuid" json:"canonical_entry_id,omitempty"`
	WorkID           *uuid.UUID `gorm:"type:uuid" json:"work_id,omitempty"`
	Position         int        `gorm:"not null" json:"position"`
	Title            string     `json:"title"`
	TitleOverride    string     `json:"title_override"`
	DurationSeconds  int        `json:"duration_seconds"`
	ISRC             string     `json:"isrc"`
	ArtistCredit     string     `json:"artist_credit"`
	Attributes       JSONB      `gorm:"type:jsonb;default:'{}'" json:"attributes"`

	CanonicalEntry *CanonicalEntry `gorm:"foreignKey:CanonicalEntryID" json:"canonical_entry,omitempty"`
}

// AssetFile represents physical bit-exact files in S3
type AssetFile struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ReleaseID        uuid.UUID  `gorm:"type:uuid;not null" json:"release_id"`
	MediumID         *uuid.UUID `gorm:"type:uuid" json:"medium_id,omitempty"`
	TrackID          *uuid.UUID `gorm:"type:uuid" json:"track_id,omitempty"`
	CanonicalEntryID *uuid.UUID `gorm:"type:uuid" json:"canonical_entry_id,omitempty"`
	FileRole        string     `gorm:"default:'master_archive';not null" json:"file_role"`
	FileName        string     `gorm:"not null" json:"file_name"`
	S3Bucket        string     `gorm:"not null" json:"s3_bucket"`
	S3Key           string     `gorm:"not null" json:"s3_key"`
	FileSize        int64      `gorm:"not null" json:"file_size"`
	Sha256Hash      string     `gorm:"not null;index" json:"sha256_hash"`
	MimeType        string     `gorm:"not null" json:"mime_type"`
	TechnicalSpecs  JSONB      `gorm:"type:jsonb;default:'{}'" json:"technical_specs"`
	TranscodeStatus string     `gorm:"default:'pending';not null" json:"transcode_status"`
	TranscodeError  string     `json:"transcode_error,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// AssetRegistry represents standalone bit-exact physical assets in the decoupled storage system (CAS)
type AssetRegistry struct {
	ID              uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Sha256Hash      string    `gorm:"type:varchar(64);uniqueIndex;not null" json:"sha256_hash"`
	FileName        string    `gorm:"type:varchar(255);not null" json:"file_name"`
	FileSize        int64     `gorm:"not null" json:"file_size"`
	MimeType        string    `gorm:"type:varchar(128);not null" json:"mime_type"`
	S3Bucket        string    `gorm:"type:varchar(64);not null" json:"s3_bucket"`
	S3Key           string    `gorm:"type:varchar(1024);not null" json:"s3_key"`
	StorageTier     string    `gorm:"type:varchar(32);default:'hot_s3';not null" json:"storage_tier"`
	TechnicalSpecs  JSONB     `gorm:"type:jsonb;default:'{}'" json:"technical_specs"`
	TranscodeStatus string    `gorm:"type:varchar(32);default:'pending';not null" json:"transcode_status"`
	TranscodeError  string    `gorm:"type:text" json:"transcode_error,omitempty"`
	Derivatives     JSONB     `gorm:"type:jsonb;default:'{}'" json:"derivatives"`
	CreatedBy       *uuid.UUID `gorm:"type:uuid" json:"created_by,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`

	Bindings []AssetBinding `gorm:"foreignKey:AssetID" json:"bindings,omitempty"`
}

func (AssetRegistry) TableName() string { return "asset_registry" }

// AssetBinding represents polymorphic attachment from standalone physical assets to catalog entities (Medium, Track, CanonicalEntry, Work, Release)
type AssetBinding struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	AssetID          uuid.UUID  `gorm:"type:uuid;not null;index" json:"asset_id"`
	TargetEntityType string     `gorm:"type:varchar(32);not null;index" json:"target_entity_type"` // 'medium', 'track', 'canonical_entry', 'release', 'work'
	TargetEntityID   uuid.UUID  `gorm:"type:uuid;not null;index" json:"target_entity_id"`
	BindingRole      string     `gorm:"type:varchar(64);default:'master_archive';not null" json:"binding_role"` // 'disc_image', 'track_audio', 'scans', 'video', 'bonus'
	DisplayOrder     int        `gorm:"default:0;not null" json:"display_order"`
	Metadata         JSONB      `gorm:"type:jsonb;default:'{}'" json:"metadata"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`

	Asset *AssetRegistry `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}

func (AssetBinding) TableName() string { return "asset_bindings" }

// EntityRelationship represents graph edges between works, artists, releases with temporal lifecycle
type EntityRelationship struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SourceType       string    `gorm:"type:varchar(32);not null" json:"source_type"`
	SourceID         uuid.UUID `gorm:"type:uuid;not null" json:"source_id"`
	TargetType       string    `gorm:"type:varchar(32);not null" json:"target_type"`
	TargetID         uuid.UUID `gorm:"type:uuid;not null" json:"target_id"`
	RelationshipType string    `gorm:"type:varchar(64);not null" json:"relationship_type"`
	Qualifier        string    `gorm:"type:varchar(64);default:'';not null" json:"qualifier"`
	BeginDate        string    `gorm:"type:varchar(16)" json:"begin_date"`
	EndDate          string    `gorm:"type:varchar(16)" json:"end_date"`
	Ended            bool      `gorm:"default:false;not null" json:"ended"`
	Attributes       JSONB     `gorm:"type:jsonb;default:'{}'" json:"attributes"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// IsCurrent checks whether this relationship is currently active
func (r EntityRelationship) IsCurrent() bool {
	if r.Ended {
		return false
	}
	if r.EndDate != "" {
		nowStr := time.Now().Format("2006-01-02")
		checkLen := len(r.EndDate)
		if checkLen > len(nowStr) {
			checkLen = len(nowStr)
		}
		if r.EndDate < nowStr[:checkLen] {
			return false
		}
	}
	return true
}

// DateSpan returns a formatted human-readable date interval string
func (r EntityRelationship) DateSpan() string {
	if r.BeginDate == "" && r.EndDate == "" {
		return ""
	}
	if r.EndDate == "" {
		if r.Ended {
			return r.BeginDate + " ~ (已终结)"
		}
		return r.BeginDate + " ~ 至今"
	}
	return r.BeginDate + " ~ " + r.EndDate
}

// RelationType represents dynamic relationship types and roles in knowledge graph ontology
type RelationType struct {
	Code               string         `gorm:"primaryKey;type:varchar(64)" json:"code"`
	Domain             string         `gorm:"type:varchar(32);not null;index" json:"domain"` // 'agent_agent', 'agent_work', 'work_work', 'agent_release'
	NameZh             string         `gorm:"type:varchar(64);not null" json:"name_zh"`
	NameEn             string         `gorm:"type:varchar(64);not null" json:"name_en"`
	Names              JSONB          `gorm:"type:jsonb;default:'{}'" json:"names"`
	Description        string         `gorm:"type:text" json:"description"`
	ForwardLabelZh     string         `gorm:"type:varchar(64);not null" json:"forward_label_zh"`
	ReverseLabelZh     string         `gorm:"type:varchar(64);not null" json:"reverse_label_zh"`
	ForwardLabelEn     string         `gorm:"type:varchar(64);not null" json:"forward_label_en"`
	ReverseLabelEn     string         `gorm:"type:varchar(64);not null" json:"reverse_label_en"`
	AllowedSourceTypes pq.StringArray `gorm:"type:text[]" json:"allowed_source_types"`
	AllowedTargetTypes pq.StringArray `gorm:"type:text[]" json:"allowed_target_types"`
	IsSymmetric        bool           `gorm:"default:false;not null" json:"is_symmetric"`
	IsHierarchical     bool           `gorm:"default:false;not null" json:"is_hierarchical"`
	AttributeSchema    JSONB          `gorm:"type:jsonb;default:'[]'" json:"attribute_schema"`
	Color              string         `gorm:"type:varchar(32);default:'sky';not null" json:"color"`
	Icon               string         `gorm:"type:varchar(64);default:'Link';not null" json:"icon"`
	SortOrder          int            `gorm:"default:0;not null" json:"sort_order"`
	IsSystem           bool           `gorm:"default:false;not null" json:"is_system"`
	IsEnabled          bool           `gorm:"default:true;not null" json:"is_enabled"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
}

func (r RelationType) LocalizedName(locale string) string {
	loc := NormalizeLocale(locale)
	if r.Names != nil {
		if v, ok := r.Names[loc]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	if loc == "en-US" && r.NameEn != "" {
		return r.NameEn
	}
	return r.NameZh
}

func (r RelationType) LocalizedForwardLabel(locale string) string {
	loc := NormalizeLocale(locale)
	if loc == "en-US" && r.ForwardLabelEn != "" {
		return r.ForwardLabelEn
	}
	return r.ForwardLabelZh
}

func (r RelationType) LocalizedReverseLabel(locale string) string {
	loc := NormalizeLocale(locale)
	if loc == "en-US" && r.ReverseLabelEn != "" {
		return r.ReverseLabelEn
	}
	return r.ReverseLabelZh
}

// ForumBoard represents a community partition manageable from admin
// show_in_feed=false 的分区仅作评论承载，不进入 all/首页信息流
type ForumBoard struct {
	Code       string `gorm:"primaryKey;type:varchar(32)" json:"code"`
	NameZh     string `gorm:"not null" json:"name_zh"`
	NameEn     string `json:"name_en"`
	Names      JSONB  `gorm:"type:jsonb;default:'{}'" json:"names"`
	Description string `json:"description"`
	Color      string `gorm:"default:'emerald';not null" json:"color"`
	Icon       string `gorm:"default:'BookOpen';not null" json:"icon"`
	SortOrder  int    `gorm:"default:0;not null" json:"sort_order"`
	IsEnabled  bool   `gorm:"default:true;not null" json:"is_enabled"`
	ShowInFeed bool   `gorm:"default:true;not null" json:"show_in_feed"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (b ForumBoard) LocalizedName(locale string) string {
	loc := NormalizeLocale(locale)
	if b.Names != nil {
		if v, ok := b.Names[loc]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	if loc == "en-US" && b.NameEn != "" {
		return b.NameEn
	}
	return b.NameZh
}

var ValidBoardColors = map[string]bool{
	"emerald": true, "amber": true, "sky": true, "purple": true,
	"cyan": true, "rose": true, "indigo": true, "teal": true,
}

var ValidBoardIcons = map[string]bool{
	"BookOpen": true, "Cpu": true, "Archive": true, "Coffee": true,
	"Layers": true, "Hash": true, "Tag": true, "Sparkles": true,
	"Flame": true, "Bookmark": true, "MessageSquare": true, "Globe": true,
	"Megaphone": true, "Bug": true, "MessageCircle": true,
}

// EntityTypeDefinition represents dynamic, extensible entity types for artists/creators/organizations
type EntityTypeDefinition struct {
	Code        string    `gorm:"primaryKey;type:varchar(64)" json:"code"`
	NameZh      string    `gorm:"type:varchar(64);not null" json:"name_zh"`
	NameEn      string    `gorm:"type:varchar(64);not null" json:"name_en"`
	Names       JSONB     `gorm:"type:jsonb;default:'{}'" json:"names"`
	DescZh      string    `gorm:"type:text" json:"desc_zh"`
	DescEn      string    `gorm:"type:text" json:"desc_en"`
	Color       string    `gorm:"type:varchar(32);default:'amber';not null" json:"color"`
	BgColor     string    `gorm:"type:varchar(32);default:'bg-amber-500/10';not null" json:"bg_color"`
	BorderColor string    `gorm:"type:varchar(32);default:'border-amber-500/30';not null" json:"border_color"`
	SortOrder   int       `gorm:"default:0;not null" json:"sort_order"`
	IsSystem    bool      `gorm:"default:false;not null" json:"is_system"`
	IsEnabled   bool      `gorm:"default:true;not null" json:"is_enabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (e EntityTypeDefinition) TableName() string { return "entity_type_definitions" }

func (e EntityTypeDefinition) LocalizedName(locale string) string {
	loc := NormalizeLocale(locale)
	if e.Names != nil {
		if v, ok := e.Names[loc]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	if loc == "en-US" && e.NameEn != "" {
		return e.NameEn
	}
	return e.NameZh
}

func (e EntityTypeDefinition) LocalizedDesc(locale string) string {
	loc := NormalizeLocale(locale)
	if loc == "en-US" && e.DescEn != "" {
		return e.DescEn
	}
	return e.DescZh
}

// ExternalDatabaseDefinition represents dynamic, admin-governed external authority database presets
type ExternalDatabaseDefinition struct {
	Code            string    `gorm:"primaryKey;type:varchar(64)" json:"code"`
	NameZh          string    `gorm:"type:varchar(64);not null" json:"name_zh"`
	NameEn          string    `gorm:"type:varchar(64);not null" json:"name_en"`
	Names           JSONB     `gorm:"type:jsonb;default:'{}'" json:"names"`
	Category        string    `gorm:"type:varchar(32);default:'all';not null" json:"category"` // 'all', 'work', 'artist', 'release', 'franchise', 'canonical_entry'
	URLPattern      string    `gorm:"type:varchar(512);not null" json:"url_pattern"`
	Icon            string    `gorm:"type:varchar(64);default:'Globe';not null" json:"icon"`
	IconURL         string    `gorm:"type:varchar(512);default:'';not null" json:"icon_url"`
	ValidationRegex string    `gorm:"type:varchar(255);default:'';not null" json:"validation_regex"`
	Description     string    `gorm:"type:text;default:'';not null" json:"description"`
	SortOrder       int       `gorm:"default:0;not null" json:"sort_order"`
	IsEnabled       bool      `gorm:"default:true;not null" json:"is_enabled"`
	IsSystem        bool      `gorm:"default:false;not null" json:"is_system"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (ExternalDatabaseDefinition) TableName() string { return "external_database_definitions" }

func (e ExternalDatabaseDefinition) LocalizedName(locale string) string {
	loc := NormalizeLocale(locale)
	if e.Names != nil {
		if v, ok := e.Names[loc]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	if loc == "en-US" && e.NameEn != "" {
		return e.NameEn
	}
	return e.NameZh
}

// BuildURL transforms an external ID or raw URL into a canonical destination URL using url_pattern
func (e ExternalDatabaseDefinition) BuildURL(idOrURL string) string {
	idOrURL = strings.TrimSpace(idOrURL)
	if idOrURL == "" {
		return ""
	}
	if strings.HasPrefix(idOrURL, "http://") || strings.HasPrefix(idOrURL, "https://") {
		return idOrURL
	}
	if e.URLPattern == "" {
		return ""
	}
	if strings.Contains(e.URLPattern, "{id}") {
		return strings.ReplaceAll(e.URLPattern, "{id}", idOrURL)
	}
	return e.URLPattern + idOrURL
}

// ExternalLinkItem represents assembled link metadata for frontend presentation
type ExternalLinkItem struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	ID       string `json:"id"`
	Icon     string `json:"icon"`
	IconURL  string `json:"icon_url,omitempty"`
	Category string `json:"category"`
}

// EntityAttributeSchema represents dynamic, extensible custom attribute schemas for any catalog entity
type EntityAttributeSchema struct {
	ID              uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	EntityType      string    `gorm:"type:varchar(32);not null;index" json:"entity_type"` // 'work', 'artist', 'release', 'medium', 'track', 'franchise', 'canonical_entry'
	AttributeKey    string    `gorm:"type:varchar(64);not null;index" json:"attribute_key"`
	NameZh          string    `gorm:"type:varchar(128);not null" json:"name_zh"`
	NameEn          string    `gorm:"type:varchar(128);not null" json:"name_en"`
	Names           JSONB     `gorm:"type:jsonb;default:'{}'" json:"names"`
	DescZh          string    `gorm:"type:text;default:''" json:"desc_zh"`
	DescEn          string    `gorm:"type:text;default:''" json:"desc_en"`
	Descriptions    JSONB     `gorm:"type:jsonb;default:'{}'" json:"descriptions"`
	DataType        string    `gorm:"type:varchar(32);default:'text';not null" json:"data_type"` // 'text', 'number', 'select', 'multiselect', 'date', 'boolean', 'array', 'url'
	Options         JSONB     `gorm:"type:jsonb;default:'[]'" json:"options"`
	ValidationRules JSONB     `gorm:"type:jsonb;default:'{}'" json:"validation_rules"`
	CategoryFilter  string    `gorm:"type:varchar(64);default:''" json:"category_filter"`
	DisplayOrder    int       `gorm:"default:0;not null" json:"display_order"`
	IsRequired      bool      `gorm:"default:false;not null" json:"is_required"`
	IsSearchable    bool      `gorm:"default:true;not null" json:"is_searchable"`
	IsEnabled       bool      `gorm:"default:true;not null" json:"is_enabled"`
	IsSystem        bool      `gorm:"default:false;not null" json:"is_system"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (EntityAttributeSchema) TableName() string { return "entity_attribute_schemas" }

func (s EntityAttributeSchema) LocalizedName(locale string) string {
	loc := NormalizeLocale(locale)
	if s.Names != nil {
		if v, ok := s.Names[loc]; ok {
			if str, ok := v.(string); ok && str != "" {
				return str
			}
		}
	}
	if loc == "en-US" && s.NameEn != "" {
		return s.NameEn
	}
	return s.NameZh
}

func (s EntityAttributeSchema) LocalizedDesc(locale string) string {
	loc := NormalizeLocale(locale)
	if s.Descriptions != nil {
		if v, ok := s.Descriptions[loc]; ok {
			if str, ok := v.(string); ok && str != "" {
				return str
			}
		}
	}
	if loc == "en-US" && s.DescEn != "" {
		return s.DescEn
	}
	return s.DescZh
}

// UserGroup represents an admin-manageable permission grouping
type UserGroup struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name        string    `gorm:"uniqueIndex;not null" json:"name"`
	Description string    `json:"description"`
	Permissions JSONB     `gorm:"type:jsonb;default:'{}'" json:"permissions"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`

	Members []User `gorm:"many2many:user_group_members;" json:"members,omitempty"`
}

func (ForumBoard) TableName() string { return "forum_boards" }
func (UserGroup) TableName() string { return "user_groups" }

// DiscussionTopic represents community threads and archive reviews
type DiscussionTopic struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null" json:"user_id"`
	BoardCode  string     `gorm:"default:'announcement';not null" json:"board_code"`
	WorkID     *uuid.UUID `gorm:"type:uuid" json:"work_id,omitempty"`
	ReleaseID  *uuid.UUID `gorm:"type:uuid" json:"release_id,omitempty"`
	Title      string     `gorm:"not null" json:"title"`
	Content    string     `gorm:"not null" json:"content"` // Deprecated: canonical content is Posts[0].Content
	Language   string     `gorm:"default:'zh-CN';not null" json:"language"`
	ViewCount  int        `gorm:"default:0;not null" json:"view_count"`
	ReplyCount int        `gorm:"default:0;not null" json:"reply_count"`
	IsPinned   bool       `gorm:"default:false;not null" json:"is_pinned"`
	PinnedAt   *time.Time `json:"pinned_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`

	User     *User       `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Work     *Work       `gorm:"foreignKey:WorkID" json:"work,omitempty"`
	Comments []Comment   `gorm:"foreignKey:TopicID" json:"comments,omitempty"`
	Posts    []ForumPost `gorm:"foreignKey:TopicID" json:"posts,omitempty"`
	Tags     []Tag       `gorm:"many2many:topic_tag_relations;joinForeignKey:TopicID;joinReferences:TagID" json:"tags,omitempty"`
}

// ForumPost holds the unified Discourse-style post stream: #1 is the topic's initial content, #2+ are replies.
type ForumPost struct {
	ID                uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	TopicID           uuid.UUID  `gorm:"type:uuid;not null;index" json:"topic_id"`
	PostNumber        int        `gorm:"not null" json:"post_number"`
	UserID            uuid.UUID  `gorm:"type:uuid;not null" json:"user_id"`
	Content           string     `gorm:"type:text;not null" json:"content"`
	ReplyToPostNumber *int       `gorm:"" json:"reply_to_post_number,omitempty"`
	ReplyToPostID     *uuid.UUID `gorm:"type:uuid" json:"reply_to_post_id,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	User              *User      `gorm:"foreignKey:UserID" json:"user,omitempty"`
	ReplyToPost       *ForumPost `gorm:"foreignKey:ReplyToPostID" json:"reply_to_post,omitempty"`
}

func (ForumPost) TableName() string { return "forum_posts" }

// WorkTranslation / TopicTranslation / TagTranslation / ArtistTranslation — 内容多语言
type WorkTranslation struct {
	WorkID  uuid.UUID `gorm:"type:uuid;primaryKey" json:"work_id"`
	Locale  string    `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Title   string    `gorm:"type:varchar(255)" json:"title"`
	Summary string    `gorm:"type:text" json:"summary"`
}

func (WorkTranslation) TableName() string { return "work_translations" }

type TopicTranslation struct {
	TopicID uuid.UUID `gorm:"type:uuid;primaryKey" json:"topic_id"`
	Locale  string    `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Title   string    `gorm:"type:varchar(255)" json:"title"`
	Content string    `gorm:"type:text" json:"content"`
}

func (TopicTranslation) TableName() string { return "topic_translations" }

type TagTranslation struct {
	TagID  uint   `gorm:"primaryKey" json:"tag_id"`
	Locale string `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Name   string `gorm:"type:varchar(64);not null" json:"name"`
}

func (TagTranslation) TableName() string { return "tag_translations" }

type ArtistTranslation struct {
	ArtistID  uuid.UUID `gorm:"type:uuid;primaryKey" json:"artist_id"`
	Locale    string    `gorm:"type:varchar(16);primaryKey" json:"locale"`
	Name      string    `gorm:"type:varchar(255)" json:"name"`
	Biography string    `gorm:"type:text" json:"biography"`
}

func (ArtistTranslation) TableName() string { return "artist_translations" }

// Comment represents unified comments attached to topics or works
type Comment struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	TopicID   *uuid.UUID `gorm:"type:uuid" json:"topic_id,omitempty"`
	WorkID    *uuid.UUID `gorm:"type:uuid" json:"work_id,omitempty"`
	ReleaseID *uuid.UUID `gorm:"type:uuid" json:"release_id,omitempty"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null" json:"user_id"`
	ParentID  *uuid.UUID `gorm:"type:uuid" json:"parent_id,omitempty"`
	Content   string     `gorm:"not null" json:"content"`
	CreatedAt time.Time  `json:"created_at"`

	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

// AdminAuditLog 持久化记录管理后台写操作，用于追责与合规
type AdminAuditLog struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ActorID   *uuid.UUID `gorm:"type:uuid" json:"actor_id"`
	ActorRole string     `gorm:"type:varchar(32)" json:"actor_role"`
	Action    string     `gorm:"type:varchar(64);not null" json:"action"`
	TargetType string    `gorm:"type:varchar(32)" json:"target_type"`
	TargetID  string     `gorm:"type:varchar(64)" json:"target_id"`
	Detail    JSONB      `gorm:"type:jsonb;default:'{}'" json:"detail"`
	IP        string     `gorm:"type:varchar(45)" json:"ip"`
	UserAgent string     `gorm:"type:text" json:"user_agent"`
	CreatedAt time.Time  `json:"created_at"`
}

func (AdminAuditLog) TableName() string { return "admin_audit_logs" }

// UserCustomShelf 用户自建推荐分组（私有默认，可设公开，标签动态聚合）
type UserCustomShelf struct {
	ID             uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	OwnerID        uuid.UUID      `gorm:"type:uuid;not null;index" json:"owner_id"`
	Slug           string         `gorm:"type:varchar(64);not null" json:"slug"`
	NameZh         string         `gorm:"not null" json:"name_zh"`
	NameEn         string         `gorm:"default:'';not null" json:"name_en"`
	Description    string         `gorm:"type:text;default:'';not null" json:"description"`
	Icon           string         `gorm:"type:varchar(64);default:'Sparkles';not null" json:"icon"`
	SortOrder      int            `gorm:"default:0;not null" json:"sort_order"`
	QueryTags      pq.StringArray `gorm:"type:text[]" json:"query_tags"`
	RequireAllTags bool           `gorm:"default:false;not null" json:"require_all_tags"`
	ExcludeTags    pq.StringArray `gorm:"type:text[]" json:"exclude_tags"`
	IsPublic       bool           `gorm:"default:false;not null" json:"is_public"`
	ViewCount      int            `gorm:"default:0;not null" json:"view_count"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	Owner          *User          `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
}

func (UserCustomShelf) TableName() string { return "user_custom_shelves" }

func (s UserCustomShelf) LocalizedName(locale string) string {
	if NormalizeLocale(locale) == "en-US" && s.NameEn != "" {
		return s.NameEn
	}
	return s.NameZh
}

// UserHomeLayout 个人首页布局：隐藏的系统预设 + 整体顺序
type UserHomeLayout struct {
	UserID             uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	HiddenSystemSlugs  pq.StringArray `gorm:"type:text[]" json:"hidden_system_slugs"`
	OrderJSON          JSONB       `gorm:"type:jsonb;default:'[]'" json:"order_json"`
	UpdatedAt          time.Time   `json:"updated_at"`
}

func (UserHomeLayout) TableName() string { return "user_home_layouts" }

// SystemSetting 站点级开关配置（注册/邀请等）
type SystemSetting struct {
	Key       string    `gorm:"primaryKey;type:varchar(64)" json:"key"`
	Value     string    `gorm:"type:text;not null" json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (SystemSetting) TableName() string { return "system_settings" }

// DirectMessage 私聊消息模型
type DirectMessage struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SenderID   uuid.UUID `gorm:"type:uuid;not null;index:idx_dm_sender_receiver" json:"sender_id"`
	ReceiverID uuid.UUID `gorm:"type:uuid;not null;index:idx_dm_sender_receiver" json:"receiver_id"`
	Content    string    `gorm:"type:text;not null" json:"content"`
	IsRead     bool      `gorm:"default:false;not null;index" json:"is_read"`
	CreatedAt  time.Time `gorm:"not null;index" json:"created_at"`
	UpdatedAt  time.Time `gorm:"not null" json:"updated_at"`

	Sender   *User `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
	Receiver *User `gorm:"foreignKey:ReceiverID" json:"receiver,omitempty"`
}

func (DirectMessage) TableName() string { return "direct_messages" }

// EntityRevision represents immutable audit & revision snapshots for community edits
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

// ApiToken represents a MusicBrainz-style long-lived Personal Access Token for external apps/agents
type ApiToken struct {
	ID         uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID     uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	Name       string         `gorm:"type:varchar(64);not null" json:"name"`
	TokenHash  string         `gorm:"type:varchar(64);not null;uniqueIndex" json:"-"`
	Prefix     string         `gorm:"type:varchar(12);not null" json:"prefix"`
	Scopes     pq.StringArray `gorm:"type:text[];not null;default:'{read}'" json:"scopes"`
	LastUsedAt *time.Time     `json:"last_used_at,omitempty"`
	ExpiresAt  *time.Time     `json:"expires_at,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	User       *User          `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (ApiToken) TableName() string { return "api_tokens" }

// SystemPlugin represents an in-process or out-of-process modular extension
type SystemPlugin struct {
	ID           string         `gorm:"primaryKey;type:varchar(64)" json:"id"`
	Name         string         `gorm:"type:varchar(128);not null" json:"name"`
	Version      string         `gorm:"type:varchar(32);not null" json:"version"`
	Description  string         `gorm:"type:text;not null" json:"description"`
	Author       string         `gorm:"type:varchar(128);not null" json:"author"`
	Icon         string         `gorm:"type:varchar(64);default:'Puzzle';not null" json:"icon"`
	Type         string         `gorm:"type:varchar(32);default:'native';not null" json:"type"` // "native", "external_http", "webhook"
	EndpointURL  string         `gorm:"type:varchar(512);default:'';not null" json:"endpoint_url"`
	SecretToken  string         `gorm:"type:varchar(255);default:'';not null" json:"secret_token,omitempty"`
	Capabilities pq.StringArray `gorm:"type:text[];not null" json:"capabilities"`
	Dependencies JSONB          `gorm:"type:jsonb;default:'{}'" json:"dependencies"`
	ConfigSchema JSONB          `gorm:"type:jsonb;default:'{}'" json:"config_schema"`
	Config       JSONB          `gorm:"type:jsonb;default:'{}'" json:"config"`
	IsEnabled    bool           `gorm:"default:true;not null" json:"is_enabled"`
	IsSystem     bool           `gorm:"default:false;not null" json:"is_system"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

func (SystemPlugin) TableName() string { return "system_plugins" }


