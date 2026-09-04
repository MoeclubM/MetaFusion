package importer

import (
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
)

// PreviewRequest 一键导入解析预览请求
type PreviewRequest struct {
	Source        string `json:"source"`                     // "musicbrainz", "tmdb", "imdb", "bangumi", "vndb", "auto"
	URLOrID       string `json:"url_or_id" binding:"required"`
	EntityType    string `json:"entity_type,omitempty"`      // "work" (默认), "artist", "person", "organization", "studio", "publisher", "character"
	MediaTypeHint string `json:"media_type_hint,omitempty"`  // "music", "movie", "tv", "book", "anime", "game"
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
	EndDate          string            `json:"end_date,omitempty"`
	Country          string            `json:"country"`
	Language         string            `json:"language"`
	OriginalLanguage string            `json:"original_language"`
	Summary          string            `json:"summary"`
	CoverImageURL    string            `json:"cover_image_url"`
	CoverAspect      string            `json:"cover_aspect"` // "1:1", "2:3", "3:4", "16:9"
	ContentRating    string            `json:"content_rating"`
	Tags             []string          `json:"tags"`
	// TagGroups 标签名 -> 分组（format/medium/genre/theme/topic），仅携带导入器已知的
	// 规范标签分组；原生源标签无分组（nil 键缺失），落库时回退 genre。
	TagGroups        map[string]string `json:"tag_groups,omitempty"`
	ExternalIDs      models.JSONB      `json:"external_ids"`
	Translations     []TranslationItem `json:"translations"`
	CatalogMetadata  models.JSONB      `json:"catalog_metadata"`
}

// ArtistPreview 解析出的演职员/创作者/出版方/角色主体
type ArtistPreview struct {
	ID             *uuid.UUID        `json:"id,omitempty"`
	Name           string            `json:"name"`
	OriginalName   string            `json:"original_name"`
	Role           string            `json:"role"`        // "Author", "Director", "Composer", "Performer", "Publisher", "Studio", "Voice Actor", "Character", etc.
	EntityType     string            `json:"entity_type"` // "person", "group", "publisher", "studio", "circle", "label", "character"
	Country        string            `json:"country"`
	Biography      string            `json:"biography"`
	Disambiguation string            `json:"disambiguation"`
	Language       string            `json:"language"`
	AvatarURL      string            `json:"avatar_url,omitempty"`
	CharacterName  string            `json:"character_name,omitempty"` // 当角色为配音/声优/演员时的对应角色名
	Aliases        []string          `json:"aliases,omitempty"`
	ExternalIDs    models.JSONB      `json:"external_ids"`
	Translations   []TranslationItem `json:"translations"`
	MatchedArtist  *models.Artist    `json:"matched_artist,omitempty"` // 系统根据名称/外部ID预先在库中匹配到的已有主体
}

// StaffAssociation 演职员与出版机构交互式审查配置项
type StaffAssociation struct {
	ParsedName     string            `json:"parsed_name"`               // 解析到的名称
	ParsedOriginal string            `json:"parsed_original,omitempty"` // 原名
	ParsedRole     string            `json:"parsed_role"`               // 解析角色
	EntityType     string            `json:"entity_type"`               // "person", "studio", "publisher", "character", etc.
	Action         string            `json:"action"`                    // "create" (新建并关联), "link" (关联已有), "skip" (跳过不关联)
	TargetArtistID *uuid.UUID        `json:"target_artist_id,omitempty"`// 当 action 为 "link" 时指定的已有主体 UUID
	CustomRole     string            `json:"custom_role,omitempty"`     // 用户自定义分配的角色/谓词
	CharacterName  string            `json:"character_name,omitempty"`  // 配音/演出的角色名称
	Country        string            `json:"country,omitempty"`
	Biography      string            `json:"biography,omitempty"`
	AvatarURL      string            `json:"avatar_url,omitempty"`
	ExternalIDs    models.JSONB      `json:"external_ids,omitempty"`
	Translations   []TranslationItem `json:"translations,omitempty"`
}

// TrackPreview 音轨/分镜/单集条目
type TrackPreview struct {
	Position        int    `json:"position"`
	Title           string `json:"title"`
	DurationSeconds int    `json:"duration_seconds"`
	ArtistCredit    string `json:"artist_credit"`
	ISRC            string `json:"isrc"`
	RecordingMBID   string `json:"recording_mbid,omitempty"`
	// AirDate 单集播出/曲目发行日期（模糊日期规约，空串=源未提供）
	AirDate string `json:"air_date,omitempty"`
	// BangumiEpisodeID Bangumi 分集 ID（external_ids 去重与回链用，空串=合成条目）
	BangumiEpisodeID string `json:"bangumi_episode_id,omitempty"`
}

// MediumPreview 盘片/卷册/介质载体
type MediumPreview struct {
	Position      int            `json:"position"`
	Name          string         `json:"name"`
	Format        string         `json:"format"`         // "CD", "Digital", "Vinyl", "Blu-ray", "Paperback", etc.
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
	ExternalIDs         models.JSONB `json:"external_ids"`
	CatalogMetadata     models.JSONB `json:"catalog_metadata"`
}

// PreviewResponse 一键导入解析预览响应
type PreviewResponse struct {
	Source      string           `json:"source"`
	EntityType  string           `json:"entity_type"` // "work", "artist", "organization", "character"
	ExternalID  string           `json:"external_id"`
	ExternalURL string           `json:"external_url"`
	MediaType   string           `json:"media_type"`
	Work        WorkPreview      `json:"work"`
	Artist      *ArtistPreview   `json:"artist,omitempty"`  // 单一主体解析结果（当 entity_type 为 artist/organization/character 时）
	Artists     []ArtistPreview  `json:"artists"`           // 作品关联演职员/机构列表
	Release     ReleasePreview   `json:"release"`
	Mediums     []MediumPreview  `json:"mediums"`
	Tags        []string         `json:"tags"`
}

// ImportRequest 最终导入持久化请求
type ImportRequest struct {
	EntityType         string             `json:"entity_type,omitempty"` // "work" (默认), "artist", "organization", "character"
	Source             string             `json:"source"`
	URLOrID            string             `json:"url_or_id"`
	ExternalID         string             `json:"external_id,omitempty"`
	MediaTypeHint      string             `json:"media_type_hint,omitempty"`
	Work               *WorkPreview       `json:"work,omitempty"`
	Artist             *ArtistPreview     `json:"artist,omitempty"`      // 单一主体直接导入
	Artists            []ArtistPreview    `json:"artists,omitempty"`
	StaffAssociations  []StaffAssociation `json:"staff_associations,omitempty"` // 交互式关联审查配置清单
	Release            *ReleasePreview    `json:"release,omitempty"`
	Mediums            []MediumPreview    `json:"mediums,omitempty"`
	DownloadCover      bool               `json:"download_cover"`     // 默认 true，自动拉取封面/头像存入 RustFS
	EditNote           string             `json:"edit_note"`          // 编辑注记 (默认自动生成)
	SourceURLs         []string           `json:"source_urls"`        // 参考链接列表
	IsMasterVerified   bool               `json:"is_master_verified"` // 是否标记为核验主版
	TargetWorkID       *uuid.UUID         `json:"target_work_id,omitempty"` // 目标母体作品 UUID（已有作品）
	LinkMode           string             `json:"link_mode,omitempty"`      // "new_work" (默认), "append_release_to_work", "merge_translations", "create_relation"
	RelationType       string             `json:"relation_type,omitempty"`  // 当 link_mode 为 "create_relation" 时的关系类型
}

// ImportResponse 导入成功响应
type ImportResponse struct {
	Success        bool                   `json:"success"`
	EntityType     string                 `json:"entity_type"` // "work", "artist", "organization", "character"
	WorkID         uuid.UUID              `json:"work_id,omitempty"`
	ReleaseID      uuid.UUID              `json:"release_id,omitempty"`
	ArtistID       uuid.UUID              `json:"artist_id,omitempty"`
	Work           *models.Work           `json:"work,omitempty"`
	Release        *models.Release        `json:"release,omitempty"`
	Artist         *models.Artist         `json:"artist,omitempty"`
	ImportedCounts map[string]int         `json:"imported_counts"`
	RedirectURL    string                 `json:"redirect_url"`
}
