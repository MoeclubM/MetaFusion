package importer

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/catalog"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
	"github.com/metafusion/metafusion-app/internal/search"
	"github.com/metafusion/metafusion-app/internal/security"
	"github.com/metafusion/metafusion-app/internal/storage"
	"gorm.io/gorm"
)

// PluginImporterResolver 插件体系对接解析器
type PluginImporterResolver interface {
	GetImporterPreview(ctx context.Context, req *PreviewRequest) (*PreviewResponse, error)
	NotifyEvent(ctx context.Context, event string, payload map[string]interface{})
}

type ImporterService struct {
	db             *gorm.DB
	cfg            *config.Config
	storageSvc     *storage.StorageService
	searchSvc      *search.SearchService
	catalogSvc     *catalog.CatalogService
	pluginResolver PluginImporterResolver
}

func NewImporterService(
	db *gorm.DB,
	cfg *config.Config,
	storageSvc *storage.StorageService,
	searchSvc *search.SearchService,
	catalogSvc *catalog.CatalogService,
) *ImporterService {
	return &ImporterService{
		db:         db,
		cfg:        cfg,
		storageSvc: storageSvc,
		searchSvc:  searchSvc,
		catalogSvc: catalogSvc,
	}
}

// SetPluginResolver 注入插件内核解析器
func (s *ImporterService) SetPluginResolver(r PluginImporterResolver) {
	s.pluginResolver = r
}

// DetectSource 根据 URL 或 ID 格式自动识别权威源
func DetectSource(input string, hint string) string {
	clean := strings.ToLower(strings.TrimSpace(input))
	if strings.Contains(clean, "musicbrainz.org") || mbidRegex.MatchString(clean) {
		return "musicbrainz"
	}
	if strings.Contains(clean, "bgm.tv") || strings.Contains(clean, "bangumi.tv") || strings.Contains(clean, "chii.in") {
		return "bangumi"
	}
	if strings.Contains(clean, "imdb.com") || imdbIDRegex.MatchString(clean) || imdbNameRegex.MatchString(clean) {
		return "imdb"
	}
	if strings.Contains(clean, "themoviedb.org") {
		return "tmdb"
	}
	if strings.Contains(clean, "vndb.org") || (strings.HasPrefix(clean, "v") && regexp.MustCompile(`^v\d+$`).MatchString(clean)) ||
		(strings.HasPrefix(clean, "s") && regexp.MustCompile(`^s\d+$`).MatchString(clean)) ||
		(strings.HasPrefix(clean, "c") && regexp.MustCompile(`^c\d+$`).MatchString(clean)) ||
		(strings.HasPrefix(clean, "p") && regexp.MustCompile(`^p\d+$`).MatchString(clean)) {
		return "vndb"
	}
	if strings.Contains(clean, "douban.com") {
		return "douban"
	}

	// 纯数字 ID 时依据 hint 判断
	if numericIDRegex.MatchString(clean) {
		switch strings.ToLower(hint) {
		case "music":
			return "musicbrainz"
		case "book", "anime", "manga", "comic", "acg":
			return "bangumi"
		case "movie", "tv", "cinema", "series":
			return "tmdb"
		default:
			return "bangumi"
		}
	}
	return "unknown"
}

// DetectEntityType 根据输入特征或显式参数判断实体类型
func DetectEntityType(input string, explicitType string) string {
	exp := strings.ToLower(strings.TrimSpace(explicitType))
	if exp != "" && exp != "auto" {
		return exp
	}
	clean := strings.ToLower(strings.TrimSpace(input))
	if strings.Contains(clean, "musicbrainz.org/artist") || strings.Contains(clean, "/person/") || strings.Contains(clean, "/prsn/") ||
		imdbNameRegex.MatchString(clean) || vndbStaffRegex.MatchString(clean) {
		return "artist"
	}
	if strings.Contains(clean, "musicbrainz.org/label") || strings.Contains(clean, "/company/") || vndbProducerRegex.MatchString(clean) {
		return "organization"
	}
	if strings.Contains(clean, "/character/") || strings.Contains(clean, "/crt/") || vndbCharacterRegex.MatchString(clean) {
		return "character"
	}
	return "work"
}

// PreviewHandler 解析外部权威数据源并返回标准化预览结构（支持 Work、Artist、Organization、Character 等多实体类型）
func (s *ImporterService) PreviewHandler(c *gin.Context) {
	var req PreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()

	// 优先通过动态插件体系调度解析（仅当插件成功返回时采纳，否则平滑降级至内置权威引擎）
	if s.pluginResolver != nil {
		pRes, pErr := s.pluginResolver.GetImporterPreview(ctx, &req)
		if pErr == nil && pRes != nil {
			s.enrichArtistMatches(pRes)
			c.JSON(http.StatusOK, pRes)
			return
		}
	}

	src := strings.ToLower(strings.TrimSpace(req.Source))
	if src == "" || src == "auto" {
		src = DetectSource(req.URLOrID, req.MediaTypeHint)
	}

	entityType := DetectEntityType(req.URLOrID, req.EntityType)

	var res *PreviewResponse
	var err error

	switch entityType {
	case "artist", "person":
		switch src {
		case "musicbrainz":
			res, err = FetchMusicBrainzArtistPreview(ctx, req.URLOrID)
		case "tmdb", "imdb":
			res, err = FetchTMDBPersonPreview(ctx, req.URLOrID, s.cfg.TMDBAPIKey)
		case "bangumi":
			res, err = FetchBangumiPersonPreview(ctx, req.URLOrID)
		case "vndb":
			_, id, parseErr := ParseVNDBID(req.URLOrID)
			if parseErr != nil {
				err = parseErr
			} else {
				res, err = FetchVNDBStaffPreview(ctx, id)
			}
		default:
			err = fmt.Errorf("unsupported source %s for artist import", src)
		}

	case "organization", "publisher", "studio", "label":
		switch src {
		case "musicbrainz":
			res, err = FetchMusicBrainzLabelPreview(ctx, req.URLOrID)
		case "tmdb", "imdb":
			res, err = FetchTMDBCompanyPreview(ctx, req.URLOrID, s.cfg.TMDBAPIKey)
		case "bangumi":
			res, err = FetchBangumiPersonPreview(ctx, req.URLOrID)
		case "vndb":
			_, id, parseErr := ParseVNDBID(req.URLOrID)
			if parseErr != nil {
				err = parseErr
			} else {
				res, err = FetchVNDBProducerPreview(ctx, id)
			}
		default:
			err = fmt.Errorf("unsupported source %s for organization import", src)
		}

	case "character":
		switch src {
		case "bangumi":
			res, err = FetchBangumiCharacterPreview(ctx, req.URLOrID)
		case "vndb":
			_, id, parseErr := ParseVNDBID(req.URLOrID)
			if parseErr != nil {
				err = parseErr
			} else {
				res, err = FetchVNDBCharacterPreview(ctx, id)
			}
		default:
			err = fmt.Errorf("unsupported source %s for character import (supported: bangumi, vndb)", src)
		}

	default: // "work"
		switch src {
		case "musicbrainz":
			res, err = FetchMusicBrainzPreview(ctx, req.URLOrID)
		case "tmdb", "imdb":
			res, err = FetchTMDBPreview(ctx, req.URLOrID, req.MediaTypeHint, s.cfg.TMDBAPIKey)
		case "bangumi":
			res, err = FetchBangumiPreview(ctx, req.URLOrID)
		case "vndb":
			_, id, parseErr := ParseVNDBID(req.URLOrID)
			if parseErr != nil {
				err = parseErr
			} else {
				res, err = FetchVNDBVNPreview(ctx, id)
			}
		default:
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("Unsupported or unrecognized data source: %s. Supported: musicbrainz, tmdb, imdb, bangumi, vndb, douban", req.URLOrID),
			})
			return
		}
	}

	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error": fmt.Sprintf("Failed to fetch metadata from %s: %s", src, err.Error()),
		})
		return
	}

	// 智能关联自动预匹配 MetaFusion 数据库已有主体
	s.enrichArtistMatches(res)

	c.JSON(http.StatusOK, res)
}

// enrichArtistMatches 在 MetaFusion 数据库中自动检索同名或相同 external_id 的主体
func (s *ImporterService) enrichArtistMatches(res *PreviewResponse) {
	if res == nil {
		return
	}

	// 若为单主体预览
	if res.Artist != nil {
		s.matchSingleArtist(res.Artist)
	}

	// 若为作品演职员列表预览
	for i := range res.Artists {
		s.matchSingleArtist(&res.Artists[i])
	}
}

func (s *ImporterService) matchSingleArtist(art *ArtistPreview) {
	if art == nil {
		return
	}

	// 1. 优先通过 ExternalIDs 查找精确匹配
	if art.ExternalIDs != nil {
		for k, v := range art.ExternalIDs {
			if vStr := fmt.Sprintf("%v", v); vStr != "" {
				var match models.Artist
				if err := s.db.Where("external_ids->>? = ?", k, vStr).First(&match).Error; err == nil {
					art.MatchedArtist = &match
					art.ID = &match.ID
					return
				}
			}
		}
	}

	// 2. 次选名称精确匹配
	cleanName := strings.TrimSpace(art.Name)
	cleanOrig := strings.TrimSpace(art.OriginalName)
	if cleanName != "" {
		var match models.Artist
		query := s.db.Where("name = ?", cleanName)
		if cleanOrig != "" {
			query = s.db.Where("name = ? OR name = ? OR original_name = ? OR original_name = ?", cleanName, cleanOrig, cleanName, cleanOrig)
		}
		if err := query.First(&match).Error; err == nil {
			art.MatchedArtist = &match
			art.ID = &match.ID
			return
		}
	}
}

// ImportHandler 最终持久化导入数据源并落库、下载封面与同步 OpenSearch
func (s *ImporterService) ImportHandler(c *gin.Context) {
	var req ImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid import request: " + err.Error()})
		return
	}

	uidVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: please log in first"})
		return
	}
	userID := uidVal.(uuid.UUID)

	entityType := strings.ToLower(strings.TrimSpace(req.EntityType))
	if entityType == "" {
		if req.Artist != nil && req.Work == nil {
			entityType = "artist"
		} else {
			entityType = "work"
		}
	}

	// =========================================================================
	// 分支 A: 直接导入单一主体（创作者/组织/角色）
	// =========================================================================
	if entityType == "artist" || entityType == "person" || entityType == "organization" || entityType == "studio" || entityType == "publisher" || entityType == "character" {
		s.importSingleArtistHandler(c, userID, req, entityType)
		return
	}

	// =========================================================================
	// 分支 B: 导入作品（Work）及交互式演职员与出版机构关联审查
	// =========================================================================
	s.importWorkHandler(c, userID, req)
}

// importSingleArtistHandler 导入创作者、机构、角色单一实体
func (s *ImporterService) importSingleArtistHandler(c *gin.Context, userID uuid.UUID, req ImportRequest, entityType string) {
	artPrev := req.Artist
	if artPrev == nil || strings.TrimSpace(artPrev.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Artist/Organization/Character name is required"})
		return
	}

	// 下载头像
	finalAvatarURL := artPrev.AvatarURL
	if req.DownloadCover && artPrev.AvatarURL != "" && strings.HasPrefix(artPrev.AvatarURL, "http") {
		if storedURL, err := s.downloadAndStoreCover(c.Request.Context(), artPrev.AvatarURL); err == nil && storedURL != "" {
			finalAvatarURL = storedURL
		}
	}

	tx := s.db.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database transaction failed"})
		return
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	entType := artPrev.EntityType
	if entType == "" {
		switch entityType {
		case "character":
			entType = models.EntityTypeCharacter
		case "organization", "studio":
			entType = models.EntityTypeStudio
		case "publisher":
			entType = models.EntityTypePublisher
		case "label":
			entType = models.EntityTypeLabel
		default:
			entType = models.EntityTypePerson
		}
	}

	// 查重
	var artist models.Artist
	found := false
	if artPrev.ExternalIDs != nil {
		for k, v := range artPrev.ExternalIDs {
			if vStr := fmt.Sprintf("%v", v); vStr != "" {
				if err := tx.Where("external_ids->>? = ?", k, vStr).First(&artist).Error; err == nil {
					found = true
					break
				}
			}
		}
	}
	if !found {
		if err := tx.Where("name = ? AND entity_type = ?", artPrev.Name, entType).First(&artist).Error; err == nil {
			found = true
		}
	}

	if found {
		// 更新已有主体
		updates := map[string]interface{}{}
		if artist.Biography == "" && artPrev.Biography != "" {
			updates["biography"] = artPrev.Biography
			artist.Biography = artPrev.Biography
		}
		if artist.OriginalName == "" && artPrev.OriginalName != "" {
			updates["original_name"] = artPrev.OriginalName
			artist.OriginalName = artPrev.OriginalName
		}
		if artist.Country == "" && artPrev.Country != "" {
			updates["country"] = artPrev.Country
			artist.Country = artPrev.Country
		}
		if finalAvatarURL != "" {
			if artist.Attributes == nil {
				artist.Attributes = models.JSONB{}
			}
			artist.Attributes["avatar_url"] = finalAvatarURL
			updates["attributes"] = artist.Attributes
		}
		if artPrev.ExternalIDs != nil {
			if artist.ExternalIDs == nil {
				artist.ExternalIDs = models.JSONB{}
			}
			for k, v := range artPrev.ExternalIDs {
				artist.ExternalIDs[k] = v
			}
			updates["external_ids"] = artist.ExternalIDs
		}
		if len(updates) > 0 {
			_ = tx.Model(&artist).Updates(updates).Error
		}
	} else {
		// 新建主体
		attrs := models.JSONB{}
		if finalAvatarURL != "" {
			attrs["avatar_url"] = finalAvatarURL
		}
		artist = models.Artist{
			ID:             uuid.New(),
			Name:           strings.TrimSpace(artPrev.Name),
			OriginalName:   strings.TrimSpace(artPrev.OriginalName),
			Disambiguation: artPrev.Disambiguation,
			EntityType:     entType,
			Country:        artPrev.Country,
			Biography:      artPrev.Biography,
			Language:       artPrev.Language,
			ExternalIDs:    artPrev.ExternalIDs,
			Attributes:     attrs,
			CreatedBy:      &userID,
		}
		if artist.Language == "" {
			artist.Language = "zh-CN"
		}
		if err := tx.Create(&artist).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create artist: " + err.Error()})
			return
		}

		// 多语言名称与简介
		for _, trans := range artPrev.Translations {
			if trans.Locale != "" {
				at := models.ArtistTranslation{
					ArtistID:  artist.ID,
					Locale:    models.NormalizeLocale(trans.Locale),
					Name:      trans.Title,
					Biography: trans.Summary,
				}
				_ = tx.Create(&at).Error
			}
		}
	}

	// 记录版本审计快照
	editNote := req.EditNote
	if editNote == "" {
		editNote = fmt.Sprintf("通过 OmniSource Importer 权威数据源 (%s) 导入主体《%s》", req.Source, artist.Name)
	}
	sourceURLs := req.SourceURLs
	if len(sourceURLs) == 0 && req.URLOrID != "" {
		sourceURLs = []string{req.URLOrID}
	}

	rev := models.EntityRevision{
		TargetType: "artist",
		TargetID:   artist.ID,
		EditorID:   &userID,
		EditType:   "create",
		Summary:    fmt.Sprintf("导入主体: %s", artist.Name),
		EditNote:   editNote,
		SourceURLs: sourceURLs,
		AfterState: models.JSONB{
			"name":        artist.Name,
			"entity_type": artist.EntityType,
			"country":     artist.Country,
			"external_ids": artist.ExternalIDs,
		},
		Diff: models.JSONB{
			"action": "imported",
			"source": req.Source,
		},
		Status:    "applied",
		CreatedAt: time.Now(),
	}
	_ = tx.Create(&rev).Error

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit transaction: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, ImportResponse{
		Success:     true,
		EntityType:  entityType,
		ArtistID:    artist.ID,
		Artist:      &artist,
		RedirectURL: fmt.Sprintf("/artists/%s", artist.ID.String()),
	})
}

// importWorkHandler 导入作品母体、发行版及交互式审查关联
func (s *ImporterService) importWorkHandler(c *gin.Context, userID uuid.UUID, req ImportRequest) {
	// 若未传入完整 WorkPreview，先自动解析 Preview
	if req.Work == nil {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
		defer cancel()

		var preview *PreviewResponse
		var err error

		if s.pluginResolver != nil {
			preview, err = s.pluginResolver.GetImporterPreview(ctx, &PreviewRequest{
				Source:        req.Source,
				URLOrID:       req.URLOrID,
				MediaTypeHint: req.MediaTypeHint,
			})
		}

		if preview == nil {
			src := strings.ToLower(strings.TrimSpace(req.Source))
			if src == "" || src == "auto" {
				src = DetectSource(req.URLOrID, req.MediaTypeHint)
			}

			switch src {
			case "musicbrainz":
				preview, err = FetchMusicBrainzPreview(ctx, req.URLOrID)
			case "tmdb", "imdb":
				preview, err = FetchTMDBPreview(ctx, req.URLOrID, req.MediaTypeHint, s.cfg.TMDBAPIKey)
			case "bangumi":
				preview, err = FetchBangumiPreview(ctx, req.URLOrID)
			case "vndb":
				_, id, parseErr := ParseVNDBID(req.URLOrID)
				if parseErr != nil {
					err = parseErr
				} else {
					preview, err = FetchVNDBVNPreview(ctx, id)
				}
			default:
				c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot identify source for " + req.URLOrID})
				return
			}
		}

		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "Preview extraction failed: " + err.Error()})
			return
		}

		req.Source = preview.Source
		req.Work = &preview.Work
		req.Artists = preview.Artists
		req.Release = &preview.Release
		req.Mediums = preview.Mediums
	}

	workPrev := req.Work
	if workPrev == nil || strings.TrimSpace(workPrev.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Work title is required"})
		return
	}

	// 1. 封面下载与持久化至 RustFS/S3 预览桶
	finalCoverURL := workPrev.CoverImageURL
	if req.DownloadCover && workPrev.CoverImageURL != "" && strings.HasPrefix(workPrev.CoverImageURL, "http") {
		if storedURL, err := s.downloadAndStoreCover(c.Request.Context(), workPrev.CoverImageURL); err == nil && storedURL != "" {
			finalCoverURL = storedURL
		} else if err != nil {
			cleanErrMsg := strings.ReplaceAll(strings.ReplaceAll(err.Error(), "\n", " "), "\r", " ")
			log.Printf("[Importer] Notice: cover download fallback to raw URL (%s)", cleanErrMsg)
		}
	}

	// 2. 数据库事务落库
	tx := s.db.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database transaction failed"})
		return
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var releaseDate *time.Time
	if workPrev.ReleaseDate != "" {
		if t, err := time.Parse("2006-01-02", workPrev.ReleaseDate); err == nil {
			releaseDate = &t
		}
	}

	workStatus := models.WorkStatusPublished
	roleStr, _ := c.Get("role")
	if roleStr != "admin" && roleStr != "archivist" {
		workStatus = models.WorkStatusPendingReview
	}

	meta := models.JSONB{}
	if workPrev.CatalogMetadata != nil {
		meta = workPrev.CatalogMetadata
	}
	meta["imported_from"] = req.Source
	meta["imported_at"] = time.Now().Format(time.RFC3339)

	workExtIDs := models.JSONB{}
	if workPrev.ExternalIDs != nil {
		workExtIDs = workPrev.ExternalIDs
	} else if req.ExternalID != "" && req.Source != "" {
		workExtIDs = models.JSONB{req.Source: req.ExternalID}
	}

	isMerge := req.TargetWorkID != nil && *req.TargetWorkID != uuid.Nil && (req.LinkMode == "append_release_to_work" || req.LinkMode == "merge_translations")
	isCreateRelation := req.TargetWorkID != nil && *req.TargetWorkID != uuid.Nil && req.LinkMode == "create_relation"

	var work models.Work
	if isMerge {
		if err := tx.Preload("Translations").Preload("Tags").First(&work, "id = ?", *req.TargetWorkID).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "Target work not found for merging"})
			return
		}

		// 1. 合并多语言题名与简介
		type transCandidate struct {
			locale  string
			title   string
			summary string
		}
		var candidates []transCandidate
		for _, tr := range workPrev.Translations {
			if tr.Locale != "" {
				candidates = append(candidates, transCandidate{
					locale:  models.NormalizeLocale(tr.Locale),
					title:   strings.TrimSpace(tr.Title),
					summary: strings.TrimSpace(tr.Summary),
				})
			}
		}
		if workPrev.Language != "" && workPrev.Title != "" {
			normLoc := models.NormalizeLocale(workPrev.Language)
			has := false
			for _, c := range candidates {
				if c.locale == normLoc {
					has = true
					break
				}
			}
			if !has {
				candidates = append(candidates, transCandidate{
					locale:  normLoc,
					title:   strings.TrimSpace(workPrev.Title),
					summary: strings.TrimSpace(workPrev.Summary),
				})
			}
		}
		if workPrev.OriginalLanguage != "" && workPrev.OriginalTitle != "" {
			normLoc := models.NormalizeLocale(workPrev.OriginalLanguage)
			has := false
			for _, c := range candidates {
				if c.locale == normLoc {
					has = true
					break
				}
			}
			if !has {
				candidates = append(candidates, transCandidate{
					locale:  normLoc,
					title:   strings.TrimSpace(workPrev.OriginalTitle),
					summary: "",
				})
			}
		}

		for _, cand := range candidates {
			if cand.locale == "" || (cand.title == "" && cand.summary == "") {
				continue
			}
			var existingWT models.WorkTranslation
			if err := tx.Where("work_id = ? AND locale = ?", work.ID, cand.locale).First(&existingWT).Error; err != nil {
				newWT := models.WorkTranslation{
					WorkID:  work.ID,
					Locale:  cand.locale,
					Title:   cand.title,
					Summary: cand.summary,
				}
				_ = tx.Create(&newWT).Error
			} else {
				upd := map[string]interface{}{}
				if existingWT.Title == "" && cand.title != "" {
					upd["title"] = cand.title
				}
				if existingWT.Summary == "" && cand.summary != "" {
					upd["summary"] = cand.summary
				}
				if len(upd) > 0 {
					_ = tx.Model(&existingWT).Updates(upd).Error
				}
			}
		}

		// 2. 外部标识符多维合并与 Work 基础信息补充
		if work.ExternalIDs == nil {
			work.ExternalIDs = models.JSONB{}
		}
		if workPrev.ExternalIDs != nil {
			for k, v := range workPrev.ExternalIDs {
				if v != nil && fmt.Sprintf("%v", v) != "" {
					work.ExternalIDs[k] = v
				}
			}
		}
		if req.ExternalID != "" && req.Source != "" {
			work.ExternalIDs[req.Source] = req.ExternalID
		}

		aliasSet := make(map[string]bool)
		for _, a := range work.Aliases {
			if t := strings.TrimSpace(a); t != "" {
				aliasSet[t] = true
			}
		}
		for _, a := range workPrev.Aliases {
			if t := strings.TrimSpace(a); t != "" && !aliasSet[t] {
				aliasSet[t] = true
				work.Aliases = append(work.Aliases, t)
			}
		}
		if workPrev.OriginalTitle != "" && workPrev.OriginalTitle != work.Title && !aliasSet[workPrev.OriginalTitle] {
			aliasSet[workPrev.OriginalTitle] = true
			work.Aliases = append(work.Aliases, workPrev.OriginalTitle)
		}

		workUpdates := map[string]interface{}{
			"external_ids": work.ExternalIDs,
			"aliases":      work.Aliases,
			"updated_at":   time.Now(),
		}
		if work.OriginalTitle == "" && workPrev.OriginalTitle != "" {
			workUpdates["original_title"] = strings.TrimSpace(workPrev.OriginalTitle)
			work.OriginalTitle = workPrev.OriginalTitle
		}
		if work.Summary == "" && workPrev.Summary != "" {
			workUpdates["summary"] = workPrev.Summary
			work.Summary = workPrev.Summary
		}
		if work.CoverImageURL == "" && finalCoverURL != "" {
			workUpdates["cover_image_url"] = finalCoverURL
			work.CoverImageURL = finalCoverURL
		}
		if work.CoverAspect == "" && workPrev.CoverAspect != "" {
			workUpdates["cover_aspect"] = workPrev.CoverAspect
			work.CoverAspect = workPrev.CoverAspect
		}
		if work.Country == "" && workPrev.Country != "" {
			workUpdates["country"] = workPrev.Country
			work.Country = workPrev.Country
		}
		if work.OriginalLanguage == "" && workPrev.OriginalLanguage != "" {
			workUpdates["original_language"] = workPrev.OriginalLanguage
			work.OriginalLanguage = workPrev.OriginalLanguage
		}
		if work.ReleaseDate == nil && releaseDate != nil {
			workUpdates["release_date"] = releaseDate
			work.ReleaseDate = releaseDate
		}

		_ = tx.Model(&work).Updates(workUpdates).Error
	} else {
		// 新建独立作品
		work = models.Work{
			ID:               uuid.New(),
			Title:            strings.TrimSpace(workPrev.Title),
			OriginalTitle:    strings.TrimSpace(workPrev.OriginalTitle),
			Aliases:          workPrev.Aliases,
			ReleaseDate:      releaseDate,
			BeginDate:        workPrev.BeginDate,
			Country:          workPrev.Country,
			Language:         workPrev.Language,
			OriginalLanguage: workPrev.OriginalLanguage,
			Summary:          workPrev.Summary,
			CoverImageURL:    finalCoverURL,
			CoverAspect:      workPrev.CoverAspect,
			ContentRating:    workPrev.ContentRating,
			Status:           workStatus,
			ExternalIDs:      workExtIDs,
			CatalogMetadata:  meta,
			CreatedBy:        &userID,
		}
		if work.Language == "" {
			work.Language = "zh-CN"
		}
		if work.ContentRating == "" {
			work.ContentRating = "General"
		}

		if err := tx.Create(&work).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create work: " + err.Error()})
			return
		}

			// 多语言标题与简介
			for _, trans := range workPrev.Translations {
				if trans.Locale != "" {
					normLocale := models.NormalizeLocale(trans.Locale)
					var existingWT models.WorkTranslation
					if err := tx.Where("work_id = ? AND locale = ?", work.ID, normLocale).First(&existingWT).Error; err != nil {
						wt := models.WorkTranslation{
							WorkID:  work.ID,
							Locale:  normLocale,
							Title:   trans.Title,
							Summary: trans.Summary,
						}
						_ = tx.Create(&wt).Error
					}
				}
			}
	}

	// 标签关联 (无论是新建还是合并)
	if len(workPrev.Tags) > 0 {
		for _, tagName := range workPrev.Tags {
			tName := strings.TrimSpace(tagName)
			if tName == "" {
				continue
			}
			var tag models.Tag
			if err := tx.Where("name = ?", tName).First(&tag).Error; err != nil {
				tag = models.Tag{
					Name:      tName,
					GroupType: models.TagGroupGenre,
				}
				_ = tx.Create(&tag).Error
			}
			if tag.ID > 0 {
				_ = tx.Exec("INSERT INTO work_tag_relations (work_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING", work.ID, tag.ID).Error
			}
		}
	}

	// 3. 演职员与出版机构交互式关联审查工作台 (Staff & Publisher Association Workbench)
	// 组装最终关联清单：若前端传入结构化 staff_associations，按用户审查后的规则写入；若无则自动转换 req.Artists
	associations := req.StaffAssociations
	if len(associations) == 0 && len(req.Artists) > 0 {
		for _, a := range req.Artists {
			action := "create"
			var targetID *uuid.UUID
			if a.ID != nil && *a.ID != uuid.Nil {
				action = "link"
				targetID = a.ID
			} else if a.MatchedArtist != nil && a.MatchedArtist.ID != uuid.Nil {
				action = "link"
				targetID = &a.MatchedArtist.ID
			}
			associations = append(associations, StaffAssociation{
				ParsedName:     a.Name,
				ParsedOriginal: a.OriginalName,
				ParsedRole:     a.Role,
				EntityType:     a.EntityType,
				Action:         action,
				TargetArtistID: targetID,
				CharacterName:  a.CharacterName,
				Country:        a.Country,
				Biography:      a.Biography,
				AvatarURL:      a.AvatarURL,
				ExternalIDs:    a.ExternalIDs,
				Translations:   a.Translations,
			})
		}
	}

	importedArtistsCount := 0
	var primaryPublisherID *uuid.UUID

	for _, assoc := range associations {
		// 跳过不关联
		if assoc.Action == "skip" {
			continue
		}

		artName := strings.TrimSpace(assoc.ParsedName)
		if artName == "" {
			continue
		}

		var artist models.Artist
		found := false

		// 模式 1: 关联至已有主体 (Link)
		if assoc.Action == "link" && assoc.TargetArtistID != nil && *assoc.TargetArtistID != uuid.Nil {
			if err := tx.First(&artist, "id = ?", *assoc.TargetArtistID).Error; err == nil {
				found = true
			}
		}

		// 模式 2: 依据 external_ids 或精确名称查找已有主体
		if !found {
			for k, v := range assoc.ExternalIDs {
				if vStr := fmt.Sprintf("%v", v); vStr != "" {
					var matches []models.Artist
					tx.Where("external_ids->>? = ?", k, vStr).Find(&matches)
					if len(matches) > 0 {
						artist = matches[0]
						found = true
						break
					}
				}
			}
		}
		if !found {
			if err := tx.Where("name = ?", artName).First(&artist).Error; err == nil {
				found = true
			}
		}

		// 模式 3: 新建主体 (Create)
		if !found {
			entType := assoc.EntityType
			if entType == "" {
				entType = models.EntityTypePerson
			}

			// 头像下载
			artAvatarURL := assoc.AvatarURL
			if req.DownloadCover && artAvatarURL != "" && strings.HasPrefix(artAvatarURL, "http") {
				if storedURL, err := s.downloadAndStoreCover(c.Request.Context(), artAvatarURL); err == nil && storedURL != "" {
					artAvatarURL = storedURL
				}
			}

			attrs := models.JSONB{}
			if artAvatarURL != "" {
				attrs["avatar_url"] = artAvatarURL
			}

			artist = models.Artist{
				ID:           uuid.New(),
				Name:         artName,
				OriginalName: assoc.ParsedOriginal,
				EntityType:   entType,
				Country:      assoc.Country,
				Biography:    assoc.Biography,
				ExternalIDs:  assoc.ExternalIDs,
				Attributes:   attrs,
				CreatedBy:    &userID,
			}
			if artist.Language == "" {
				artist.Language = "zh-CN"
			}
			if err := tx.Create(&artist).Error; err != nil {
				log.Printf("[Importer] Create artist notice: %v", err)
				continue
			}

				for _, tr := range assoc.Translations {
					if tr.Locale != "" {
						normLocale := models.NormalizeLocale(tr.Locale)
						var existingTr models.ArtistTranslation
						if err := tx.Where("artist_id = ? AND locale = ?", artist.ID, normLocale).First(&existingTr).Error; err != nil {
							at := models.ArtistTranslation{
								ArtistID:  artist.ID,
								Locale:    normLocale,
								Name:      tr.Title,
								Biography: tr.Summary,
							}
							_ = tx.Create(&at).Error
						}
					}
				}

				importedArtistsCount++
			}

			roleToAssign := assoc.CustomRole
			if strings.TrimSpace(roleToAssign) == "" {
				roleToAssign = assoc.ParsedRole
			}
			if strings.TrimSpace(roleToAssign) == "" {
				roleToAssign = "Creator"
			}

			if strings.Contains(strings.ToLower(roleToAssign), "publisher") || strings.Contains(strings.ToLower(roleToAssign), "label") || strings.Contains(strings.ToLower(roleToAssign), "出版社") {
				primaryPublisherID = &artist.ID
			}

			// 建立 WorkArtistRelation
			var countRel int64
			tx.Model(&models.WorkArtistRelation{}).Where("work_id = ? AND artist_id = ?", work.ID, artist.ID).Count(&countRel)
			if countRel == 0 {
				workArtRel := models.WorkArtistRelation{
					WorkID:   work.ID,
					ArtistID: artist.ID,
					Role:     roleToAssign,
				}
				_ = tx.Create(&workArtRel).Error
			}

			// 挂载知识图谱动态语义边 (EntityRelationship)
			relTypeCode := "creator_of"
			roleLower := strings.ToLower(roleToAssign)
			switch {
			case strings.Contains(roleLower, "director") || strings.Contains(roleLower, "监督") || strings.Contains(roleLower, "导演"):
				relTypeCode = "director"
			case strings.Contains(roleLower, "composer") || strings.Contains(roleLower, "配乐") || strings.Contains(roleLower, "音乐") || strings.Contains(roleLower, "作曲"):
				relTypeCode = "composer"
			case strings.Contains(roleLower, "author") || strings.Contains(roleLower, "原作") || strings.Contains(roleLower, "作者") || strings.Contains(roleLower, "编剧") || strings.Contains(roleLower, "剧本"):
				relTypeCode = "author"
			case strings.Contains(roleLower, "illustrator") || strings.Contains(roleLower, "作画") || strings.Contains(roleLower, "原画") || strings.Contains(roleLower, "插画") || strings.Contains(roleLower, "人物设定"):
				relTypeCode = "illustrator"
			case strings.Contains(roleLower, "publisher") || strings.Contains(roleLower, "出版社") || strings.Contains(roleLower, "发行"):
				relTypeCode = "producer"
			case strings.Contains(roleLower, "studio") || strings.Contains(roleLower, "制作") || strings.Contains(roleLower, "开发"):
				relTypeCode = "studio"
			case strings.Contains(roleLower, "performer") || strings.Contains(roleLower, "演奏") || strings.Contains(roleLower, "演唱"):
				relTypeCode = "performer"
			case strings.Contains(roleLower, "voice") || strings.Contains(roleLower, "声优") || strings.Contains(roleLower, "配音") || strings.Contains(roleLower, "actor") || strings.Contains(roleLower, "演员"):
				relTypeCode = "voice_actor_of"
			case strings.Contains(roleLower, "character") || strings.Contains(roleLower, "角色"):
				relTypeCode = "character_in"
			}

			if ontology.IsEnabledRelationType(tx, relTypeCode) {
				qualifier := roleToAssign
				if assoc.CharacterName != "" {
					qualifier = fmt.Sprintf("%s (as %s)", roleToAssign, assoc.CharacterName)
				}
				var existingEdge models.EntityRelationship
				if err := tx.Where("source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relationship_type = ? AND qualifier = ?",
					"artist", artist.ID, "work", work.ID, relTypeCode, qualifier).First(&existingEdge).Error; err != nil {
					edge := models.EntityRelationship{
						SourceType:       "artist",
						SourceID:         artist.ID,
						TargetType:       "work",
						TargetID:         work.ID,
						RelationshipType: relTypeCode,
						Qualifier:        qualifier,
					}
					_ = tx.Create(&edge).Error
				}
			}
		}

		// 跨媒介语义关系建立 (当 link_mode 为 create_relation 时)
		if isCreateRelation {
			relTypeCode := strings.TrimSpace(req.RelationType)
			if relTypeCode == "" {
				switch strings.ToLower(req.MediaTypeHint) {
				case "music":
					relTypeCode = "soundtrack_of"
				case "movie", "tv", "anime":
					relTypeCode = "adaptation_of"
				case "game":
					relTypeCode = "spin_off_of"
				default:
					relTypeCode = "spin_off_of"
				}
			}
			if ontology.IsEnabledRelationType(tx, relTypeCode) {
				var existingEdge models.EntityRelationship
				if err := tx.Where("source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relationship_type = ? AND qualifier = ?",
					"work", work.ID, "work", *req.TargetWorkID, relTypeCode, "Cross-source auto link").First(&existingEdge).Error; err != nil {
					edge := models.EntityRelationship{
						SourceType:       "work",
						SourceID:         work.ID,
						TargetType:       "work",
						TargetID:         *req.TargetWorkID,
						RelationshipType: relTypeCode,
						Qualifier:        "Cross-source auto link",
					}
					_ = tx.Create(&edge).Error
				}
			}
		}

	// 4. 创建 Release 发行版与 Medium/Tracks (除 merge_translations 外均挂载 Release)
	var release models.Release
	importedMediumsCount := 0
	importedTracksCount := 0

	if req.LinkMode != "merge_translations" {
		relPrev := req.Release
		editionName := fmt.Sprintf("%s（官方首发版）", work.Title)
		if isMerge {
			editionName = fmt.Sprintf("%s（%s 导入版）", work.Title, req.Source)
		}
		catalogNum := ""
		barcode := ""
		publisherStr := ""
		packaging := "digital_release"
		distChannel := "mixed"
		var editionDate *time.Time = releaseDate

		if relPrev != nil {
			if relPrev.EditionName != "" {
				editionName = relPrev.EditionName
			}
			catalogNum = relPrev.CatalogNumber
			barcode = relPrev.Barcode
			publisherStr = relPrev.Publisher
			if relPrev.Packaging != "" {
				packaging = relPrev.Packaging
			}
			if relPrev.DistributionChannel != "" {
				distChannel = ontology.NormalizeDistributionChannel(relPrev.DistributionChannel)
			}
			if relPrev.EditionDate != "" {
				if t, err := time.Parse("2006-01-02", relPrev.EditionDate); err == nil {
					editionDate = &t
				}
			}
		}

		relExtIDs := models.JSONB{}
		if relPrev != nil && relPrev.ExternalIDs != nil {
			relExtIDs = relPrev.ExternalIDs
		} else if req.ExternalID != "" && req.Source != "" {
			relExtIDs = models.JSONB{req.Source: req.ExternalID}
		}

		release = models.Release{
			ID:                  uuid.New(),
			WorkID:              work.ID,
			PublisherID:         primaryPublisherID,
			EditionName:         editionName,
			CatalogNumber:       catalogNum,
			Barcode:             barcode,
			Publisher:           publisherStr,
			Packaging:           packaging,
			EditionDate:         editionDate,
			Country:             work.Country,
			Language:            work.Language,
			DistributionChannel: distChannel,
			ExternalIDs:         relExtIDs,
			CatalogMetadata:     meta,
			UploaderID:          &userID,
			IsMasterVerified:    req.IsMasterVerified,
			Notes:               fmt.Sprintf("Auto-imported via OmniSource Importer from %s", req.Source),
		}
		if err := tx.Create(&release).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create release: " + err.Error()})
			return
		}

		// 创建 Medium 与 Tracks / CanonicalEntries
		for _, medPrev := range req.Mediums {
				medCat := strings.ToLower(strings.TrimSpace(medPrev.MediaCategory))
				switch medCat {
				case "audio":
					medCat = "music"
				case "video":
					if strings.Contains(strings.ToLower(req.MediaTypeHint), "anime") {
						medCat = "anime"
					} else if strings.Contains(strings.ToLower(req.MediaTypeHint), "tv") {
						medCat = "tv_series"
					} else {
						medCat = "movie"
					}
				case "book":
					if strings.Contains(strings.ToLower(req.MediaTypeHint), "comic") || strings.Contains(strings.ToLower(req.MediaTypeHint), "manga") {
						medCat = "comic"
					} else {
						medCat = "novel"
					}
				case "":
					medCat = "music"
				}
				var countMT int64
				tx.Table("media_types").Where("code = ?", medCat).Count(&countMT)
				if countMT == 0 {
					medCat = "movie"
				}

				med := models.Medium{
					ID:            uuid.New(),
					ReleaseID:     release.ID,
					Position:      medPrev.Position,
					Name:          medPrev.Name,
					Format:        medPrev.Format,
					MediaCategory: medCat,
					TrackCount:    len(medPrev.Tracks),
				}
				if med.Position <= 0 {
					med.Position = importedMediumsCount + 1
				}
				if med.Format == "" {
					med.Format = "Digital"
				}
				if err := tx.Create(&med).Error; err != nil {
					log.Printf("[Importer] Create medium notice: %v", err)
					continue
				}
			importedMediumsCount++

			for _, trkPrev := range medPrev.Tracks {
				// 母版录音条目 CanonicalEntry
				canon := models.CanonicalEntry{
					ID:              uuid.New(),
					Title:           trkPrev.Title,
					SortTitle:       trkPrev.Title,
					Duration:        trkPrev.DurationSeconds,
					ISRC:            trkPrev.ISRC,
					ArtistCredit:    trkPrev.ArtistCredit,
					WorkID:          &work.ID,
					ExternalIDs: models.JSONB{
						"source": req.Source,
					},
				}
				if trkPrev.RecordingMBID != "" {
					canon.ExternalIDs["musicbrainz_recording_id"] = trkPrev.RecordingMBID
				}
				_ = tx.Create(&canon).Error

				// 实体曲目/单集 Track
				trk := models.Track{
					ID:               uuid.New(),
					MediumID:         med.ID,
					CanonicalEntryID: &canon.ID,
					WorkID:           &work.ID,
					Position:         trkPrev.Position,
					Title:            trkPrev.Title,
					DurationSeconds:  trkPrev.DurationSeconds,
					ISRC:             trkPrev.ISRC,
					ArtistCredit:     trkPrev.ArtistCredit,
				}
				if trk.Position <= 0 {
					trk.Position = importedTracksCount + 1
				}
				if err := tx.Create(&trk).Error; err == nil {
					importedTracksCount++
				}
			}
		}
	}

	// 5. 记录版本审计快照 (entity_revisions)
	editNote := req.EditNote
	if editNote == "" {
		if isMerge {
			editNote = fmt.Sprintf("合并来自权威数据源 (%s) 的多语言与发行版规格至作品《%s》", req.Source, work.Title)
		} else {
			editNote = fmt.Sprintf("通过 OmniSource Importer 权威数据源 (%s) 快速一键导入入库", req.Source)
		}
	}
	sourceURLs := req.SourceURLs
	if len(sourceURLs) == 0 && req.URLOrID != "" {
		sourceURLs = []string{req.URLOrID}
	}

	workEditType := "create"
	workSummary := fmt.Sprintf("一键导入作品: %s", work.Title)
	if isMerge {
		workEditType = "update"
		workSummary = fmt.Sprintf("合并导入作品数据源 (%s): %s", req.Source, work.Title)
	}

	revWork := models.EntityRevision{
		TargetType:  "work",
		TargetID:    work.ID,
		EditorID:    &userID,
		EditType:    workEditType,
		Summary:     workSummary,
		EditNote:    editNote,
		SourceURLs:  sourceURLs,
		AfterState: models.JSONB{
			"title":           work.Title,
			"original_title":  work.OriginalTitle,
			"cover_image_url": work.CoverImageURL,
			"release_date":    work.ReleaseDate,
			"country":         work.Country,
			"external_ids":    work.ExternalIDs,
			"aliases":         work.Aliases,
		},
		Diff: models.JSONB{
			"action":    "imported",
			"source":    req.Source,
			"link_mode": req.LinkMode,
		},
		Status:    "applied",
		CreatedAt: time.Now(),
	}
	_ = tx.Create(&revWork).Error

	if release.ID != uuid.Nil {
		revRelease := models.EntityRevision{
			TargetType:  "release",
			TargetID:    release.ID,
			EditorID:    &userID,
			EditType:    "create",
			Summary:     fmt.Sprintf("一键导入/挂载版本: %s", release.EditionName),
			EditNote:    editNote,
			SourceURLs:  sourceURLs,
			AfterState: models.JSONB{
				"edition_name": release.EditionName,
				"publisher":    release.Publisher,
				"packaging":    release.Packaging,
				"work_id":      work.ID,
			},
			Diff: models.JSONB{
				"action": "imported",
				"source": req.Source,
			},
			Status:    "applied",
			CreatedAt: time.Now(),
		}
		_ = tx.Create(&revRelease).Error
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit transaction: " + err.Error()})
		return
	}

	// 触发插件系统通知钩子
	if s.pluginResolver != nil {
		eventName := "import.completed"
		if isMerge {
			eventName = "import.merged"
		}
		s.pluginResolver.NotifyEvent(context.Background(), eventName, map[string]interface{}{
			"work_id":   work.ID.String(),
			"title":     work.Title,
			"source":    req.Source,
			"link_mode": req.LinkMode,
			"user_id":   userID.String(),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}

	// 6. 异步同步至 OpenSearch 索引
	if s.searchSvc != nil {
		go func(w models.Work) {
			ctxOS, cancelOS := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancelOS()
			_ = s.searchSvc.IndexWorkDoc(ctxOS, &w)
		}(work)
	}

	c.JSON(http.StatusOK, ImportResponse{
		Success:    true,
		EntityType: "work",
		WorkID:     work.ID,
		ReleaseID:  release.ID,
		Work:       &work,
		Release:    &release,
		ImportedCounts: map[string]int{
			"artists": importedArtistsCount,
			"mediums": importedMediumsCount,
			"tracks":  importedTracksCount,
		},
		RedirectURL: fmt.Sprintf("/works/%s", work.ID.String()),
	})
}

// downloadAndStoreCover 下载外部高清封面并存入 RustFS 预览桶或本地存储
func (s *ImporterService) downloadAndStoreCover(ctx context.Context, rawURL string) (string, error) {
	if err := security.ValidateExternalURL(rawURL); err != nil {
		return "", err
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		return "", fmt.Errorf("invalid external url: %s", rawURL)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", parsedURL.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")

	client := security.NewSafeHTTPClient(20 * time.Second)

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("remote image server returned %d", resp.StatusCode)
	}

	// 限制封面 20MB
	limitReader := io.LimitReader(resp.Body, 20*1024*1024)
	buf, err := io.ReadAll(limitReader)
	if err != nil {
		return "", err
	}

	mimeType := resp.Header.Get("Content-Type")
	ext := ".jpg"
	if parsed, err := url.Parse(rawURL); err == nil {
		ext = strings.ToLower(filepath.Ext(parsed.Path))
	}
	if ext == "" || len(ext) > 5 {
		if strings.Contains(mimeType, "png") {
			ext = ".png"
		} else if strings.Contains(mimeType, "webp") {
			ext = ".webp"
		} else {
			ext = ".jpg"
		}
	}

	if s.storageSvc != nil {
		return s.storageSvc.UploadCover(ctx, bytes.NewReader(buf), int64(len(buf)), mimeType, ext)
	}

	return rawURL, nil
}
