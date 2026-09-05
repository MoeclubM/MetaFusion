package importer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
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

// mergeLocaleTitles 按语种归并多语言标题：同一语种的多个标题中，首个为主标题，
// 其余进入该语种翻译行的 Aliases（同语种多标题）。返回归并后的翻译行与实体级
// 别名（已剔除所有翻译标题中出现过的值——原语言标题归属翻译行，不进别名）。
func mergeLocaleTitles(translations []TranslationItem, aliases []string) ([]TranslationItem, []string) {
	byLocale := map[string]*TranslationItem{}
	order := make([]string, 0)
	seenTitle := map[string]bool{}
	addTitle := func(locale, title, summary string) {
		title = strings.TrimSpace(title)
		if title == "" {
			return
		}
		loc := models.NormalizeLocale(strings.TrimSpace(locale))
		low := strings.ToLower(title)
		if ex, ok := byLocale[loc]; ok {
			if strings.EqualFold(strings.TrimSpace(ex.Title), title) {
				return
			}
			for _, a := range ex.Aliases {
				if strings.EqualFold(strings.TrimSpace(a), title) {
					return
				}
			}
			if summary != "" && ex.Summary == "" {
				ex.Summary = summary
			}
			ex.Aliases = append(ex.Aliases, title)
			seenTitle[loc+"\x00"+low] = true
			return
		}
		byLocale[loc] = &TranslationItem{Locale: loc, Title: title, Summary: summary}
		order = append(order, loc)
		seenTitle[loc+"\x00"+low] = true
	}
	for _, tr := range translations {
		addTitle(tr.Locale, tr.Title, tr.Summary)
		for _, a := range tr.Aliases {
			t := strings.TrimSpace(a)
			if t == "" {
				continue
			}
			loc := models.NormalizeLocale(strings.TrimSpace(tr.Locale))
			if ex, ok := byLocale[loc]; ok {
				dup := strings.EqualFold(strings.TrimSpace(ex.Title), t)
				if !dup {
					for _, e := range ex.Aliases {
						if strings.EqualFold(strings.TrimSpace(e), t) {
							dup = true
							break
						}
					}
				}
				if !dup {
					ex.Aliases = append(ex.Aliases, t)
					seenTitle[loc+"\x00"+strings.ToLower(t)] = true
				}
			} else {
				// 仅有并列标题的语种行（主标题可后补）也要保留，不能静默丢弃。
				byLocale[loc] = &TranslationItem{Locale: loc, Aliases: []string{t}}
				order = append(order, loc)
				seenTitle[loc+"\x00"+strings.ToLower(t)] = true
			}
		}
	}
	out := make([]TranslationItem, 0, len(order))
	for _, loc := range order {
		out = append(out, *byLocale[loc])
	}
	known := map[string]bool{}
	for _, tr := range out {
		if t := strings.ToLower(strings.TrimSpace(tr.Title)); t != "" {
			known[t] = true
		}
		for _, a := range tr.Aliases {
			if t := strings.ToLower(strings.TrimSpace(a)); t != "" {
				known[t] = true
			}
		}
	}
	filtered := make([]string, 0, len(aliases))
	for _, a := range aliases {
		t := strings.TrimSpace(a)
		if t == "" || known[strings.ToLower(t)] {
			continue
		}
		filtered = append(filtered, t)
	}
	return out, filtered
}

// mergeLocaleAliasList 合并同一翻译行的并列标题：去重、剔除与主标题相同的项。
func mergeLocaleAliasList(primary string, aliases []string) []string {
	seen := map[string]bool{strings.ToLower(strings.TrimSpace(primary)): true}
	out := make([]string, 0, len(aliases))
	for _, a := range aliases {
		t := strings.TrimSpace(a)
		if t == "" {
			continue
		}
		if seen[strings.ToLower(t)] {
			continue
		}
		seen[strings.ToLower(t)] = true
		out = append(out, t)
	}
	return out
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
			entType = models.EntityTypeVirtualCharacter
		case "organization", "studio":
			entType = models.EntityTypeStudio
		case "publisher":
			entType = models.EntityTypePublisher
		case "label":
			// 独立厂牌已并入出版机构（publisher 覆盖 imprint / 子厂牌）
			entType = models.EntityTypePublisher
		case "circle":
			// 同人社团已并入团体（group）
			entType = models.EntityTypeGroup
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
		if finalAvatarURL != "" && (artist.AvatarURL == "" || !strings.HasPrefix(artist.AvatarURL, "/uploads/")) {
			updates["avatar_url"] = finalAvatarURL
			artist.AvatarURL = finalAvatarURL
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
		artist = models.Artist{
			ID:             uuid.New(),
			Name:           strings.TrimSpace(artPrev.Name),
			OriginalName:   strings.TrimSpace(artPrev.OriginalName),
			Disambiguation: artPrev.Disambiguation,
			EntityType:     entType,
			AvatarURL:      finalAvatarURL,
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

		// 多语言名称与简介（含同语种并列名称）
		for _, trans := range artPrev.Translations {
			if trans.Locale != "" {
				at := models.ArtistTranslation{
					ArtistID:  artist.ID,
					Locale:    models.NormalizeLocale(trans.Locale),
					Name:      trans.Title,
					Biography: trans.Summary,
					Aliases:   pq.StringArray(trans.Aliases),
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
			"name":         artist.Name,
			"entity_type":  artist.EntityType,
			"country":      artist.Country,
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
		req.HasRelease = preview.HasRelease
		req.CanonicalEntries = preview.CanonicalEntries
		if preview.HasRelease != nil && !*preview.HasRelease {
			req.Release = nil
		}
		req.Mediums = preview.Mediums
	}

	workPrev := req.Work
	if workPrev == nil || strings.TrimSpace(workPrev.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Work title is required"})
		return
	}

	// 多语言标题归并：原语言标题归属对应语种翻译行（原始语言只是标记），
	// 同语种多标题进翻译行 Aliases；实体级 Aliases 只留真正的跨语种异名/搜索别名。
	// 默认显示语种的题名与主 Title 同步，保证 catalog 回退链一致。
	mergedTranslations, mergedAliases := mergeLocaleTitles(workPrev.Translations, workPrev.Aliases)
	if workPrev.Language != "" && workPrev.Title != "" {
		mergedTranslations, _ = mergeLocaleTitles(append(mergedTranslations, TranslationItem{
			Locale:  workPrev.Language,
			Title:   workPrev.Title,
			Summary: workPrev.Summary,
		}), nil)
	}
	if workPrev.OriginalLanguage != "" && workPrev.OriginalTitle != "" {
		mergedTranslations, _ = mergeLocaleTitles(append(mergedTranslations, TranslationItem{
			Locale: workPrev.OriginalLanguage,
			Title:  workPrev.OriginalTitle,
		}), nil)
	}
	workPrev.Translations = mergedTranslations
	workPrev.Aliases = mergedAliases

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

	meta := models.JSONB{}
	if workPrev.CatalogMetadata != nil {
		meta = workPrev.CatalogMetadata
	}
	meta["imported_from"] = req.Source
	meta["imported_at"] = time.Now().Format(time.RFC3339)

	var releaseDate *time.Time
	var releaseBegin string
	if workPrev.ReleaseDate != "" {
		// 外部源日期精度不一（MusicBrainz 年精度、Bangumi 年月）：完整日进 exact 列，
		// 月/年精度进 Begin 模糊列，非法格式保留 raw 到 catalog_metadata 不再静默丢弃。
		if exact, partial, ok := ontology.ParseFlexibleDate(workPrev.ReleaseDate); ok {
			releaseDate = exact
			releaseBegin = partial
		} else {
			meta["raw_release_date"] = workPrev.ReleaseDate
		}
	}
	beginDate, dateErr := ontology.NormalizePartialDate(workPrev.BeginDate)
	if dateErr != nil {
		meta["raw_begin_date"] = workPrev.BeginDate
		beginDate = ""
	}
	endDate, dateErr := ontology.NormalizePartialDate(workPrev.EndDate)
	if dateErr != nil {
		meta["raw_end_date"] = workPrev.EndDate
		endDate = ""
	}
	if err := ontology.ValidateDateSpan(beginDate, endDate); err != nil {
		meta["invalid_date_span"] = err.Error()
		endDate = ""
	}
	// 导入源只给 ReleaseDate 时回填 Begin，保证连载/发行区间可查。
	if beginDate == "" {
		beginDate = releaseBegin
		if beginDate == "" && releaseDate != nil {
			beginDate = releaseDate.Format("2006-01-02")
		}
	}

	workStatus := models.WorkStatusPublished
	roleStr, _ := c.Get("role")
	if roleStr != "admin" && roleStr != "archivist" {
		workStatus = models.WorkStatusPendingReview
	}

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

		// 1. 合并多语言题名与简介（含同语种并列标题 aliases）
		type transCandidate struct {
			locale  string
			title   string
			summary string
			aliases []string
		}
		var candidates []transCandidate
		for _, tr := range workPrev.Translations {
			if tr.Locale != "" {
				candidates = append(candidates, transCandidate{
					locale:  models.NormalizeLocale(tr.Locale),
					title:   strings.TrimSpace(tr.Title),
					summary: strings.TrimSpace(tr.Summary),
					aliases: tr.Aliases,
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
			if cand.locale == "" || (cand.title == "" && cand.summary == "" && len(cand.aliases) == 0) {
				continue
			}
			var existingWT models.WorkTranslation
			if err := tx.Where("work_id = ? AND locale = ?", work.ID, cand.locale).First(&existingWT).Error; err != nil {
				newWT := models.WorkTranslation{
					WorkID:  work.ID,
					Locale:  cand.locale,
					Title:   cand.title,
					Summary: cand.summary,
					Aliases: pq.StringArray(cand.aliases),
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
				if len(cand.aliases) > 0 {
					merged := append(append([]string{}, existingWT.Aliases...), cand.aliases...)
					upd["aliases"] = pq.StringArray(mergeLocaleAliasList(existingWT.Title, merged))
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
				aliasSet[strings.ToLower(t)] = true
			}
		}
		for _, a := range workPrev.Aliases {
			if t := strings.TrimSpace(a); t != "" && !aliasSet[strings.ToLower(t)] {
				aliasSet[strings.ToLower(t)] = true
				work.Aliases = append(work.Aliases, t)
			}
		}
		// OriginalTitle 归属翻译行，不再塞进实体级 aliases。

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
		if work.BeginDate == "" && beginDate != "" {
			workUpdates["begin_date"] = beginDate
			work.BeginDate = beginDate
		}
		if work.EndDate == "" && endDate != "" {
			workUpdates["end_date"] = endDate
			work.EndDate = endDate
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
			BeginDate:        beginDate,
			EndDate:          endDate,
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

		// 多语言标题与简介（含同语种并列标题）
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
						Aliases: pq.StringArray(trans.Aliases),
					}
					_ = tx.Create(&wt).Error
				}
			}
		}
	}

	// 标签关联 (无论是新建还是合并)：分组优先取导入器声明的 TagGroups，
	// 未声明的原生源标签回退 genre；非法分组同样回退 genre 不中断导入。
	if len(workPrev.Tags) > 0 {
		for _, tagName := range workPrev.Tags {
			tName := strings.TrimSpace(tagName)
			if tName == "" {
				continue
			}
			group := models.TagGroupGenre
			if g, ok := workPrev.TagGroups[tName]; ok {
				switch strings.TrimSpace(strings.ToLower(g)) {
				case models.TagGroupFormat, models.TagGroupMedium, models.TagGroupGenre,
					models.TagGroupTheme, models.TagGroupTopic, models.TagGroupGeneral:
					group = strings.TrimSpace(strings.ToLower(g))
				}
			}
			var tag models.Tag
			if err := tx.Where("name = ?", tName).First(&tag).Error; err != nil {
				tag = models.Tag{
					Name:      tName,
					GroupType: group,
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

		// 模式 2: 依据 external_ids 或精确名称查找已有主体 (多平台权威 ID 集合联合索引查重)
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
			entType := assoc.EntityType
			if entType == "" {
				entType = models.EntityTypePerson
			}
			if entType == models.EntityTypeVirtualCharacter {
				if err := tx.Where("name = ? AND entity_type = ?", artName, models.EntityTypeVirtualCharacter).First(&artist).Error; err == nil {
					found = true
				}
			} else {
				if err := tx.Where("name = ?", artName).First(&artist).Error; err == nil {
					found = true
				}
			}
		}

		// 模式 2.1: 已有主体信息合并与多平台 external_ids 累积
		if found {
			if artist.ExternalIDs == nil {
				artist.ExternalIDs = models.JSONB{}
			}
			mergedExt := false
			for k, v := range assoc.ExternalIDs {
				if v != nil && fmt.Sprintf("%v", v) != "" {
					if _, exists := artist.ExternalIDs[k]; !exists {
						artist.ExternalIDs[k] = v
						mergedExt = true
					}
				}
			}

			artAvatarURL := assoc.AvatarURL
			if req.DownloadCover && artAvatarURL != "" && strings.HasPrefix(artAvatarURL, "http") {
				if storedURL, err := s.downloadAndStoreCover(c.Request.Context(), artAvatarURL); err == nil && storedURL != "" {
					artAvatarURL = storedURL
				}
			}

			updArtist := map[string]interface{}{}
			if mergedExt {
				updArtist["external_ids"] = artist.ExternalIDs
			}
			if artist.OriginalName == "" && assoc.ParsedOriginal != "" {
				artist.OriginalName = assoc.ParsedOriginal
				updArtist["original_name"] = assoc.ParsedOriginal
			}
			if artist.Biography == "" && assoc.Biography != "" {
				artist.Biography = assoc.Biography
				updArtist["biography"] = assoc.Biography
			}
			// 头像更新：空值必填；非本地链路照常刷新；存量 /uploads/ 本地死链
			// （容器重建即丢）在新链已成功落 S3 时迁移替换，避免永久 404。
			shouldSetAvatar := artAvatarURL != "" &&
				(artist.AvatarURL == "" ||
					!strings.HasPrefix(artist.AvatarURL, "/uploads/") ||
					strings.HasPrefix(artAvatarURL, "/storage/preview/"))
			if shouldSetAvatar {
				artist.AvatarURL = artAvatarURL
				updArtist["avatar_url"] = artAvatarURL
			}
			if len(updArtist) > 0 {
				// artists 表无 updated_at 列（CreatedAt 唯一时间戳），禁止写入该键。
				_ = tx.Model(&artist).Updates(updArtist).Error
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

			artist = models.Artist{
				ID:           uuid.New(),
				Name:         artName,
				OriginalName: assoc.ParsedOriginal,
				EntityType:   entType,
				AvatarURL:    artAvatarURL,
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
							Aliases:   pq.StringArray(tr.Aliases),
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

		if assoc.CharacterName != "" && !strings.Contains(roleToAssign, "配演") {
			roleToAssign = fmt.Sprintf("声优 (配演: %s)", assoc.CharacterName)
		}

		// 挂载目录关系图谱动态语义边 (EntityRelationship)
		// 默认 creator_of 仅允许指向 franchise（企划创立），对作品目标非法——
		// 未命中任何已知制作分工时保持该默认并依赖本体校验跳过（不伪造边）。
		// 分支次序敏感：performer 须先于 director（主题歌演出含「演出」），
		// producer 须先于 illustrator（作画监督含「制作」的变体不冲突，但「美术监督」含「监督」）。
		relTypeCode := "creator_of"
		roleLower := strings.ToLower(roleToAssign)
		isCharacterEntity := artist.EntityType == models.EntityTypeVirtualCharacter
		switch {
		case strings.Contains(roleLower, "composer") || strings.Contains(roleLower, "配乐") || strings.Contains(roleLower, "配樂") || strings.Contains(roleLower, "音乐") || strings.Contains(roleLower, "音樂") || strings.Contains(roleLower, "作曲") || strings.Contains(roleLower, "编曲") || strings.Contains(roleLower, "編曲"):
			relTypeCode = "composer"
		case strings.Contains(roleLower, "author") || strings.Contains(roleLower, "原作") || strings.Contains(roleLower, "原案") || strings.Contains(roleLower, "作者") || strings.Contains(roleLower, "编剧") || strings.Contains(roleLower, "劇本") || strings.Contains(roleLower, "剧本") || strings.Contains(roleLower, "系列构成") || strings.Contains(roleLower, "系列構成"):
			relTypeCode = "author"
		case strings.Contains(roleLower, "illustrator") || strings.Contains(roleLower, "作画") || strings.Contains(roleLower, "作畫") || strings.Contains(roleLower, "原画") || strings.Contains(roleLower, "原畫") || strings.Contains(roleLower, "插画") || strings.Contains(roleLower, "插畫") || strings.Contains(roleLower, "人物设定") || strings.Contains(roleLower, "人物設定") || strings.Contains(roleLower, "美术") || strings.Contains(roleLower, "美術") || strings.Contains(roleLower, "设定") || strings.Contains(roleLower, "設定"):
			relTypeCode = "illustrator"
		case strings.Contains(roleLower, "publisher") || strings.Contains(roleLower, "出版社") || strings.Contains(roleLower, "发行") || strings.Contains(roleLower, "發行") || strings.Contains(roleLower, "厂牌") || strings.Contains(roleLower, "唱片"):
			relTypeCode = "producer"
		case strings.Contains(roleLower, "studio") || strings.Contains(roleLower, "制作") || strings.Contains(roleLower, "製作") || strings.Contains(roleLower, "开发") || strings.Contains(roleLower, "開發") || strings.Contains(roleLower, "制片") || strings.Contains(roleLower, "製片") || strings.Contains(roleLower, "企划") || strings.Contains(roleLower, "企畫") || strings.Contains(roleLower, "企劃") || strings.Contains(roleLower, "监制") || strings.Contains(roleLower, "監製"):
			// agent_work 域的 studio 关系已去重移除，制作/企划链路统一走 producer
			relTypeCode = "producer"
		case !isCharacterEntity && (strings.Contains(roleLower, "performer") || strings.Contains(roleLower, "演奏") || strings.Contains(roleLower, "演唱") || strings.Contains(roleLower, "艺术家") || strings.Contains(roleLower, "藝術家") || strings.Contains(roleLower, "歌手") || strings.Contains(roleLower, "主演") || strings.Contains(roleLower, "配角") || strings.Contains(roleLower, "主题歌") || strings.Contains(roleLower, "主題歌") || strings.Contains(roleLower, "主题曲") || strings.Contains(roleLower, "主題曲") || strings.Contains(roleLower, "表演")):
			// 演唱/出演类统一走 performer；角色实体（主角/配角/主演定位）排除在外，
			// 由后序 character_in 分支承接，避免 performer 源端点校验失败吞掉角色边。
			relTypeCode = "performer"
		case strings.Contains(roleLower, "director") || strings.Contains(roleLower, "导演") || strings.Contains(roleLower, "導演") || strings.Contains(roleLower, "监督") || strings.Contains(roleLower, "監督") || strings.Contains(roleLower, "演出") || strings.Contains(roleLower, "分镜") || strings.Contains(roleLower, "分鏡") || strings.Contains(roleLower, "音响监督") || strings.Contains(roleLower, "音響監督"):
			relTypeCode = "director"
		case strings.Contains(roleLower, "voice") || strings.Contains(roleLower, "声优") || strings.Contains(roleLower, "聲優") || strings.Contains(roleLower, "配音") || strings.Contains(roleLower, "actor") || strings.Contains(roleLower, "演员") || assoc.CharacterName != "":
			relTypeCode = "voice_actor_of"
		case strings.Contains(roleLower, "character") || strings.Contains(roleLower, "角色") || strings.Contains(roleLower, "主角") || strings.Contains(roleLower, "配角") || strings.Contains(roleLower, "客串") || isCharacterEntity:
			relTypeCode = "character_in"
		}

		if ontology.IsEnabledRelationType(tx, relTypeCode) {
			qualifier := roleToAssign
			if assoc.CharacterName != "" {
				qualifier = fmt.Sprintf("Voice Actor (as %s)", assoc.CharacterName)
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
				if verr := ontology.ValidateRelationEdge(tx, ontology.EdgeSpec{
					SourceType:       "artist",
					SourceID:         artist.ID,
					TargetType:       "work",
					TargetID:         work.ID,
					RelationshipType: relTypeCode,
					Qualifier:        qualifier,
				}); verr != nil {
					// 本体校验失败仅跳过该边，不中断整个导入事务
					log.Printf("[Importer] skip invalid relationship %s (artist %s -> work %s): %v", relTypeCode, artist.ID, work.ID, verr)
				} else {
					_ = tx.Create(&edge).Error
				}
			}
		}

		// 当为声优时，自动建立 声优 -> 角色实体的图谱边 (voice_actor_of)
		if assoc.CharacterName != "" {
			var charEntity models.Artist
			if err := tx.Where("name = ? AND entity_type = ?", assoc.CharacterName, models.EntityTypeVirtualCharacter).First(&charEntity).Error; err == nil {
				if ontology.IsEnabledRelationType(tx, "voice_actor_of") {
					var existingCharRel models.EntityRelationship
					if err := tx.Where("source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relationship_type = ?",
						"artist", artist.ID, "artist", charEntity.ID, "voice_actor_of").First(&existingCharRel).Error; err != nil {
						cEdge := models.EntityRelationship{
							SourceType:       "artist",
							SourceID:         artist.ID,
							TargetType:       "artist",
							TargetID:         charEntity.ID,
							RelationshipType: "voice_actor_of",
							Qualifier:        "Voice Actor",
						}
						if verr := ontology.ValidateRelationEdge(tx, ontology.EdgeSpec{
							SourceType:       "artist",
							SourceID:         artist.ID,
							TargetType:       "artist",
							TargetID:         charEntity.ID,
							RelationshipType: "voice_actor_of",
							Qualifier:        "Voice Actor",
						}); verr != nil {
							// 本体校验失败仅跳过该边，不中断整个导入事务
							log.Printf("[Importer] skip invalid relationship voice_actor_of (artist %s -> artist %s): %v", artist.ID, charEntity.ID, verr)
						} else {
							_ = tx.Create(&cEdge).Error
						}
					}
				}
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
				relTypeCode = "adapted_from"
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
				if verr := ontology.ValidateRelationEdge(tx, ontology.EdgeSpec{
					SourceType:       "work",
					SourceID:         work.ID,
					TargetType:       "work",
					TargetID:         *req.TargetWorkID,
					RelationshipType: relTypeCode,
					Qualifier:        "Cross-source auto link",
				}); verr != nil {
					// 本体校验失败仅跳过该边，不中断整个导入事务
					log.Printf("[Importer] skip invalid relationship %s (work %s -> work %s): %v", relTypeCode, work.ID, *req.TargetWorkID, verr)
				} else {
					_ = tx.Create(&edge).Error
				}
			}
		}
	}

	// 内容目录不依赖发行存在；同一作品锁保证并发导入外部篇目不会重复创建。
	if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", work.ID.String()).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	createdEntries := []models.CanonicalEntry{}
	for _, entry := range req.CanonicalEntries {
		if strings.TrimSpace(entry.Title) == "" || entry.Position < 0 || entry.DurationSeconds < 0 {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid canonical entry"})
			return
		}
		canon := models.CanonicalEntry{ID: uuid.New(), WorkID: &work.ID, Title: entry.Title, SortTitle: entry.Title, Position: entry.Position, Number: entry.Number, EntryRole: entry.EntryRole, OriginalLanguage: entry.OriginalLanguage, Translations: entry.Translations, Duration: entry.DurationSeconds, Attributes: entry.Attributes, ExternalIDs: entry.ExternalIDs}
		created, err := importCanonicalEntry(tx, &canon)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if created {
			createdEntries = append(createdEntries, canon)
		}
	}

	// 4. 创建 Release 发行版与 Medium/Tracks (除 merge_translations 外均挂载 Release)
	var release models.Release
	importedMediumsCount := 0
	importedTracksCount := 0

	if req.LinkMode != "merge_translations" && req.Release != nil && (req.HasRelease == nil || *req.HasRelease) {
		relPrev := req.Release
		editionName := fmt.Sprintf("%s（官方首发版）", work.Title)
		if isMerge {
			editionName = fmt.Sprintf("%s（%s 导入版）", work.Title, req.Source)
		}
		catalogNum := ""
		barcode := ""
		publisherStr := ""
		// 默认包装/渠道按作品形态给：书籍平装、音乐 jewel_case、游戏 digital；
		// 未知形态回退 digital_release→digital 规范值（旧占位 digital_release 不再落库）。
		packaging := "digital"
		distChannel := "mixed"
		var editionDate *time.Time = releaseDate

		if relPrev != nil {
			if relPrev.EditionName != "" {
				editionName = relPrev.EditionName
			}
			catalogNum = relPrev.CatalogNumber
			barcode = relPrev.Barcode
			publisherStr = relPrev.Publisher
			if p := ontology.NormalizePackaging(relPrev.Packaging); p != "" {
				packaging = p
			}
			if relPrev.DistributionChannel != "" {
				if ch := ontology.NormalizeDistributionChannel(relPrev.DistributionChannel); ch != "" {
					distChannel = ch
				}
			}
			if relPrev.EditionDate != "" {
				// 精确日进 EditionDate 列；月/年精度无法进 *time.Time，
				// 保留 raw 到 catalog_metadata，EditionDate 回退 work 级 releaseDate。
				if exact, _, ok := ontology.ParseFlexibleDate(relPrev.EditionDate); ok && exact != nil {
					editionDate = exact
				} else {
					meta["raw_edition_date"] = relPrev.EditionDate
				}
			}
		}
		releaseCoverURL := finalCoverURL
		releaseCoverAspect := work.CoverAspect
		releaseOriginalLanguage := work.OriginalLanguage
		releaseTranslations := models.JSONB{}
		if relPrev != nil {
			if relPrev.CoverImageURL != "" {
				releaseCoverURL = relPrev.CoverImageURL
			}
			if relPrev.CoverAspect != "" {
				releaseCoverAspect = relPrev.CoverAspect
			}
			if relPrev.OriginalLanguage != "" {
				releaseOriginalLanguage = relPrev.OriginalLanguage
			}
			if relPrev.Translations != nil {
				releaseTranslations = relPrev.Translations
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
			CoverImageURL:       releaseCoverURL,
			CoverAspect:         releaseCoverAspect,
			OriginalLanguage:    releaseOriginalLanguage,
			Translations:        releaseTranslations,
		}
		if err := tx.Create(&release).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create release: " + err.Error()})
			return
		}

		// 创建 Medium 与 Tracks / CanonicalEntries。
		// 介质归属分类经 ontology 共享归一化（聚合词按 hint 细化，未知回退 movie），
		// 载体规格归一化失败时按作品形态回退（书 paperback / 音乐 cd / 影视 broadcast / 其他 digital）。
		defaultCat := ontology.MediaCategoryFromHint("", req.MediaTypeHint, "movie")
		defaultFormat := "digital"
		hintLower := strings.ToLower(req.MediaTypeHint)
		if strings.Contains(hintLower, "book") || strings.Contains(hintLower, "novel") || strings.Contains(hintLower, "comic") || strings.Contains(hintLower, "manga") {
			defaultFormat = "paperback"
		} else if strings.Contains(hintLower, "music") || strings.Contains(hintLower, "audio") {
			defaultFormat = "cd"
		} else if strings.Contains(hintLower, "anime") || strings.Contains(hintLower, "tv") || strings.Contains(hintLower, "movie") || strings.Contains(hintLower, "series") {
			defaultFormat = "broadcast"
		}
		for _, medPrev := range req.Mediums {
			medCat := ontology.MediaCategoryFromHint(medPrev.MediaCategory, req.MediaTypeHint, defaultCat)
			var countMT int64
			tx.Table("media_types").Where("code = ?", medCat).Count(&countMT)
			if countMT == 0 {
				medCat = defaultCat
			}

			medFormat := ontology.NormalizeMediumFormat(medPrev.Format)
			if medFormat == "" {
				medFormat = defaultFormat
			}
			medRole := strings.TrimSpace(medPrev.Role)
			if medRole == "" {
				medRole = "primary"
				formatLower := strings.ToLower(medFormat)
				if strings.Contains(formatLower, "blu-ray") || strings.Contains(formatLower, "dvd") {
					medRole = "supplement"
				}
			}
			med := models.Medium{
				ID:               uuid.New(),
				ReleaseID:        release.ID,
				Position:         medPrev.Position,
				Number:           medPrev.Number,
				Name:             medPrev.Name,
				Format:           medFormat,
				MediaCategory:    medCat,
				Role:             medRole,
				OriginalLanguage: medPrev.OriginalLanguage,
				Translations:     medPrev.Translations,
				TrackCount:       len(medPrev.Tracks),
			}
			if med.Position <= 0 {
				med.Position = importedMediumsCount + 1
			}
			if med.Number == "" {
				med.Number = strconv.Itoa(med.Position)
			}
			if err := tx.Create(&med).Error; err != nil {
				log.Printf("[Importer] Create medium notice: %v", err)
				continue
			}
			importedMediumsCount++

			for _, trkPrev := range medPrev.Tracks {
				// 母版条目 CanonicalEntry：创建失败则跳过该曲目（不再写孤儿 canon，
				// 旧逻辑忽略错误继续建 track 是线上 657 条孤儿的来源）。
				canon := models.CanonicalEntry{
					ID:               uuid.New(),
					Title:            trkPrev.Title,
					SortTitle:        trkPrev.Title,
					Position:         trkPrev.Position,
					Number:           strconv.Itoa(trkPrev.Position),
					EntryRole:        "main",
					OriginalLanguage: work.OriginalLanguage,
					Duration:         trkPrev.DurationSeconds,
					ISRC:             trkPrev.ISRC,
					ArtistCredit:     trkPrev.ArtistCredit,
					WorkID:           &work.ID,
					ExternalIDs: models.JSONB{
						"source": req.Source,
					},
				}
				if trkPrev.RecordingMBID != "" {
					canon.ExternalIDs["musicbrainz_recording_id"] = trkPrev.RecordingMBID
				}
				if trkPrev.BangumiEpisodeID != "" {
					canon.ExternalIDs["bangumi_episode"] = trkPrev.BangumiEpisodeID
				}
				created, err := importCanonicalEntry(tx, &canon)
				if err != nil {
					tx.Rollback()
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				if created {
					createdEntries = append(createdEntries, canon)
				}

				// 实体曲目/单集 Track
				trkAirDate, airErr := ontology.NormalizePartialDate(trkPrev.AirDate)
				if airErr != nil {
					trkAirDate = ""
				}
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
					AirDate:          trkAirDate,
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
	sourceURLs := pq.StringArray{}
	if len(req.SourceURLs) > 0 {
		sourceURLs = pq.StringArray(req.SourceURLs)
	} else if req.URLOrID != "" {
		sourceURLs = pq.StringArray{req.URLOrID}
	} else if req.ExternalID != "" {
		sourceURLs = pq.StringArray{fmt.Sprintf("%s:%s", req.Source, req.ExternalID)}
	} else {
		sourceURLs = pq.StringArray{req.Source}
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
		BeforeState: models.JSONB{},
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
			BeforeState: models.JSONB{},
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

	for _, canon := range createdEntries {
		snapshot, err := json.Marshal(canon)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		after := models.JSONB{}
		if err := json.Unmarshal(snapshot, &after); err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		revision := models.EntityRevision{TargetType: "canonical_entry", TargetID: canon.ID, EditorID: &userID, EditType: "create", Summary: canon.Title, EditNote: editNote, SourceURLs: sourceURLs, BeforeState: models.JSONB{}, AfterState: after, Diff: models.JSONB{"action": "imported", "source": req.Source}, Status: "applied", CreatedAt: time.Now()}
		if err := tx.Create(&revision).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
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

	var responseRelease *models.Release
	if release.ID != uuid.Nil {
		responseRelease = &release
	}
	c.JSON(http.StatusOK, ImportResponse{
		Success:    true,
		EntityType: "work",
		WorkID:     work.ID,
		ReleaseID:  release.ID,
		Work:       &work,
		Release:    responseRelease,
		ImportedCounts: map[string]int{
			"canonical_entries": len(createdEntries),
			"artists":           importedArtistsCount,
			"mediums":           importedMediumsCount,
			"tracks":            importedTracksCount,
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

// importCanonicalEntry 仅以所属作品和来源标识复用内容；同名不代表同一表达。
// 调用方持有作品级事务锁，避免两次并行导入同时通过存在性检查。
func importCanonicalEntry(tx *gorm.DB, canon *models.CanonicalEntry) (bool, error) {
	for _, key := range []string{"bangumi_episode", "musicbrainz_recording_id"} {
		value, ok := canon.ExternalIDs[key].(string)
		if !ok || value == "" {
			continue
		}
		var existing models.CanonicalEntry
		err := tx.Where("work_id = ? AND external_ids ->> ? = ?", canon.WorkID, key, value).First(&existing).Error
		if err == nil {
			*canon = existing
			return false, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
	}
	if err := tx.Create(canon).Error; err != nil {
		return false, err
	}
	return true, nil
}
