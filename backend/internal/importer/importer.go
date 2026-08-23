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
	if strings.Contains(clean, "imdb.com") || imdbIDRegex.MatchString(clean) {
		return "imdb"
	}
	if strings.Contains(clean, "themoviedb.org") {
		return "tmdb"
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
			// 默认数字 ID 优先尝试 Bangumi (ACG/书影音综合)
			return "bangumi"
		}
	}
	return "unknown"
}

// PreviewHandler 解析外部权威数据源并返回标准化预览结构
func (s *ImporterService) PreviewHandler(c *gin.Context) {
	var req PreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()

	// 优先通过动态插件体系调度解析
	if s.pluginResolver != nil {
		pRes, pErr := s.pluginResolver.GetImporterPreview(ctx, &req)
		if pErr == nil && pRes != nil {
			c.JSON(http.StatusOK, pRes)
			return
		}
		if pErr != nil && !strings.Contains(pErr.Error(), "no enabled importer plugin found") {
			c.JSON(http.StatusBadGateway, gin.H{
				"error": fmt.Sprintf("Plugin importer error: %s", pErr.Error()),
			})
			return
		}
	}

	src := strings.ToLower(strings.TrimSpace(req.Source))
	if src == "" || src == "auto" {
		src = DetectSource(req.URLOrID, req.MediaTypeHint)
	}

	var res *PreviewResponse
	var err error

	switch src {
	case "musicbrainz":
		res, err = FetchMusicBrainzPreview(ctx, req.URLOrID)
	case "tmdb", "imdb":
		res, err = FetchTMDBPreview(ctx, req.URLOrID, req.MediaTypeHint, s.cfg.TMDBAPIKey)
	case "bangumi":
		res, err = FetchBangumiPreview(ctx, req.URLOrID)
	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Unsupported or unrecognized data source: %s. Supported: musicbrainz, tmdb, imdb, bangumi, vndb, douban", req.URLOrID),
		})
		return
	}

	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error": fmt.Sprintf("Failed to fetch metadata from %s: %s", src, err.Error()),
		})
		return
	}

	c.JSON(http.StatusOK, res)
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
			log.Printf("[Importer] Notice: cover download fallback to raw URL (%v)", err)
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

	work := models.Work{
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
			wt := models.WorkTranslation{
				WorkID:  work.ID,
				Locale:  models.NormalizeLocale(trans.Locale),
				Title:   trans.Title,
				Summary: trans.Summary,
			}
			_ = tx.Create(&wt).Error
		}
	}

	// 标签关联
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

	// 演职人员及创作者主体创建与关联
	importedArtistsCount := 0
	var primaryPublisherID *uuid.UUID

	for _, artPrev := range req.Artists {
		artName := strings.TrimSpace(artPrev.Name)
		if artName == "" {
			continue
		}

		var artist models.Artist
		found := false

		// 检查 external_ids 中是否已存在
		for k, v := range artPrev.ExternalIDs {
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

		if !found {
			// 按名称查询
			if err := tx.Where("name = ?", artName).First(&artist).Error; err == nil {
				found = true
			}
		}

		if !found {
			entType := artPrev.EntityType
			if entType == "" {
				entType = models.EntityTypePerson
			}
			artist = models.Artist{
				ID:             uuid.New(),
				Name:           artName,
				OriginalName:   artPrev.OriginalName,
				EntityType:     entType,
				Country:        artPrev.Country,
				Biography:      artPrev.Biography,
				Disambiguation: artPrev.Disambiguation,
				Language:       artPrev.Language,
				ExternalIDs:    artPrev.ExternalIDs,
				CreatedBy:      &userID,
			}
			if err := tx.Create(&artist).Error; err != nil {
				log.Printf("[Importer] Create artist notice: %v", err)
				continue
			}
			importedArtistsCount++
		}

		if strings.Contains(strings.ToLower(artPrev.Role), "publisher") || strings.Contains(strings.ToLower(artPrev.Role), "label") {
			primaryPublisherID = &artist.ID
		}

		// 建立 WorkArtistRelation
		relRole := artPrev.Role
		if relRole == "" {
			relRole = "Creator"
		}
		workArtRel := models.WorkArtistRelation{
			WorkID:   work.ID,
			ArtistID: artist.ID,
			Role:     relRole,
		}
		_ = tx.Create(&workArtRel).Error

		// 挂载知识图谱动态关系
		relTypeCode := "creator"
		if strings.EqualFold(relRole, "Director") {
			relTypeCode = "director"
		} else if strings.EqualFold(relRole, "Composer") {
			relTypeCode = "composer"
		} else if strings.EqualFold(relRole, "Author") {
			relTypeCode = "author"
		}
		if ontology.IsEnabledRelationType(tx, relTypeCode) {
			edge := models.EntityRelationship{
				SourceType:       "artist",
				SourceID:         artist.ID,
				TargetType:       "work",
				TargetID:         work.ID,
				RelationshipType: relTypeCode,
				Qualifier:        relRole,
			}
			_ = tx.Create(&edge).Error
		}
	}

	// 3. 创建 Release 发行版
	var release models.Release
	importedMediumsCount := 0
	importedTracksCount := 0

	relPrev := req.Release
	editionName := fmt.Sprintf("%s（官方首发版）", work.Title)
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

	// 4. 创建 Medium 与 Tracks / CanonicalEntries
	for _, medPrev := range req.Mediums {
		med := models.Medium{
			ID:            uuid.New(),
			ReleaseID:     release.ID,
			Position:      medPrev.Position,
			Name:          medPrev.Name,
			Format:        medPrev.Format,
			MediaCategory: medPrev.MediaCategory,
			TrackCount:    len(medPrev.Tracks),
		}
		if med.Position <= 0 {
			med.Position = importedMediumsCount + 1
		}
		if med.Format == "" {
			med.Format = "Digital"
		}
		if med.MediaCategory == "" {
			med.MediaCategory = "audio"
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

	// 5. 记录版本审计快照 (entity_revisions)
	editNote := req.EditNote
	if editNote == "" {
		editNote = fmt.Sprintf("通过 OmniSource Importer 权威数据源 (%s) 快速一键导入入库", req.Source)
	}
	sourceURLs := req.SourceURLs
	if len(sourceURLs) == 0 && req.URLOrID != "" {
		sourceURLs = []string{req.URLOrID}
	}

	revWork := models.EntityRevision{
		TargetType:  "work",
		TargetID:    work.ID,
		EditorID:    &userID,
		EditType:    "create",
		Summary:     fmt.Sprintf("一键导入作品: %s", work.Title),
		EditNote:    editNote,
		SourceURLs:  sourceURLs,
		AfterState: models.JSONB{
			"title":           work.Title,
			"original_title":  work.OriginalTitle,
			"cover_image_url": work.CoverImageURL,
			"release_date":    work.ReleaseDate,
			"country":         work.Country,
		},
		Diff: models.JSONB{
			"action": "imported",
			"source": req.Source,
		},
		Status:    "applied",
		CreatedAt: time.Now(),
	}
	_ = tx.Create(&revWork).Error

	revRelease := models.EntityRevision{
		TargetType:  "release",
		TargetID:    release.ID,
		EditorID:    &userID,
		EditType:    "create",
		Summary:     fmt.Sprintf("一键导入版本: %s", release.EditionName),
		EditNote:    editNote,
		SourceURLs:  sourceURLs,
		AfterState: models.JSONB{
			"edition_name": release.EditionName,
			"publisher":    release.Publisher,
			"packaging":    release.Packaging,
		},
		Diff: models.JSONB{
			"action": "imported",
			"source": req.Source,
		},
		Status:    "applied",
		CreatedAt: time.Now(),
	}
	_ = tx.Create(&revRelease).Error

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit transaction: " + err.Error()})
		return
	}

	// 触发插件系统通知钩子
	if s.pluginResolver != nil {
		s.pluginResolver.NotifyEvent(context.Background(), "import.completed", map[string]interface{}{
			"work_id":   work.ID.String(),
			"title":     work.Title,
			"source":    req.Source,
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
		Success:   true,
		WorkID:    work.ID,
		ReleaseID: release.ID,
		Work:      &work,
		Release:   &release,
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

	req, err := http.NewRequestWithContext(ctx, "GET", rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")

	client := &http.Client{
		Timeout: 20 * time.Second,
	}

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
