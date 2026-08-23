package importer

import (
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
)

// PreviewRequest 一键导入解析预览请求
type PreviewRequest struct {
	Source        string `json:"source"` // "musicbrainz", "tmdb", "imdb", "bangumi", "auto"
	URLOrID       string `json:"url_or_id" binding:"required"`
	MediaTypeHint string `json:"media_type_hint,omitempty"` // "music", "movie", "tv", "book", "anime", "game"
}

// TranslationItem 多语言题名与简介
type TranslationItem struct {
	Locale  string `json:"locale"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

// WorkPreview 解析出的母体作品预览
type WorkPreview struct {
	Title            string            `json:"title"`
	OriginalTitle    string            `json:"original_title"`
	Aliases          []string          `json:"aliases"`
	ReleaseDate      string            `json:"release_date"` // YYYY-MM-DD
	BeginDate        string            `json:"begin_date"`
	Country          string            `json:"country"`
	Language         string            `json:"language"`
	OriginalLanguage string            `json:"original_language"`
	Summary          string            `json:"summary"`
	CoverImageURL    string            `json:"cover_image_url"`
	CoverAspect      string            `json:"cover_aspect"` // "1:1", "2:3", "3:4", "16:9"
	ContentRating    string            `json:"content_rating"`
	Tags             []string          `json:"tags"`
	Translations     []TranslationItem `json:"translations"`
	CatalogMetadata  models.JSONB      `json:"catalog_metadata"`
}

// ArtistPreview 解析出的演职员/创作者/出版方
type ArtistPreview struct {
	ID             *uuid.UUID        `json:"id,omitempty"`
	Name           string            `json:"name"`
	OriginalName   string            `json:"original_name"`
	Role           string            `json:"role"` // "Author", "Director", "Composer", "Performer", "Publisher", "Studio", etc.
	EntityType     string            `json:"entity_type"` // "person", "group", "publisher", "studio"
	Country        string            `json:"country"`
	Biography      string            `json:"biography"`
	Disambiguation string            `json:"disambiguation"`
	Language       string            `json:"language"`
	ExternalIDs    models.JSONB      `json:"external_ids"`
	Translations   []TranslationItem `json:"translations"`
}

// TrackPreview 音轨/分镜/单集条目
type TrackPreview struct {
	Position        int    `json:"position"`
	Title           string `json:"title"`
	DurationSeconds int    `json:"duration_seconds"`
	ArtistCredit    string `json:"artist_credit"`
	ISRC            string `json:"isrc"`
	RecordingMBID   string `json:"recording_mbid,omitempty"`
}

// MediumPreview 盘片/卷册/介质载体
type MediumPreview struct {
	Position      int            `json:"position"`
	Name          string         `json:"name"`
	Format        string         `json:"format"` // "CD", "Digital", "Vinyl", "Blu-ray", "Paperback", etc.
	MediaCategory string         `json:"media_category"` // "audio", "video", "book", "game"
	Tracks        []TrackPreview `json:"tracks"`
}

// ReleasePreview 发行版本规格
type ReleasePreview struct {
	EditionName         string       `json:"edition_name"`
	CatalogNumber       string       `json:"catalog_number"`
	Barcode             string       `json:"barcode"`
	Publisher           string       `json:"publisher"`
	Packaging           string       `json:"packaging"`
	Country             string       `json:"country"`
	Language            string       `json:"language"`
	DistributionChannel string       `json:"distribution_channel"`
	EditionDate         string       `json:"edition_date"`
	Notes               string       `json:"notes"`
	CatalogMetadata     models.JSONB `json:"catalog_metadata"`
}

// PreviewResponse 一键导入解析预览响应
type PreviewResponse struct {
	Source      string          `json:"source"`
	ExternalID  string          `json:"external_id"`
	ExternalURL string          `json:"external_url"`
	MediaType   string          `json:"media_type"`
	Work        WorkPreview     `json:"work"`
	Artists     []ArtistPreview `json:"artists"`
	Release     ReleasePreview  `json:"release"`
	Mediums     []MediumPreview `json:"mediums"`
	Tags        []string        `json:"tags"`
}

// ImportRequest 最终导入持久化请求
type ImportRequest struct {
	Source           string           `json:"source"`
	URLOrID          string           `json:"url_or_id"`
	MediaTypeHint    string           `json:"media_type_hint,omitempty"`
	Work             *WorkPreview     `json:"work,omitempty"`
	Artists          []ArtistPreview  `json:"artists,omitempty"`
	Release          *ReleasePreview  `json:"release,omitempty"`
	Mediums          []MediumPreview  `json:"mediums,omitempty"`
	DownloadCover    bool             `json:"download_cover"`     // 默认 true，自动拉取封面存入 RustFS
	EditNote         string           `json:"edit_note"`          // 编辑注记 (默认自动生成)
	SourceURLs       []string         `json:"source_urls"`        // 参考链接列表
	IsMasterVerified bool             `json:"is_master_verified"` // 是否标记为核验主版
}

// ImportResponse 导入成功响应
type ImportResponse struct {
	Success        bool                   `json:"success"`
	WorkID         uuid.UUID              `json:"work_id"`
	ReleaseID      uuid.UUID              `json:"release_id"`
	Work           *models.Work           `json:"work"`
	Release        *models.Release        `json:"release"`
	ImportedCounts map[string]int         `json:"imported_counts"`
	RedirectURL    string                 `json:"redirect_url"`
}
