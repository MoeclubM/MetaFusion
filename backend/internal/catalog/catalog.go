package catalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
	"github.com/metafusion/metafusion-app/internal/security"
	"gorm.io/gorm"
)

func validateCoverURL(raw string) error {
	if raw == "" {
		return nil
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	if trimmed[0] == '/' {
		return nil
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("cover_image_url must be http/https or absolute path")
	}
	if u.Host == "" {
		return fmt.Errorf("cover_image_url missing host")
	}
	if err := security.ValidateExternalURL(trimmed); err != nil {
		return err
	}
	return nil
}

type CatalogService struct {
	db *gorm.DB
}

func NewCatalogService(db *gorm.DB) *CatalogService {
	return &CatalogService{db: db}
}

// ListCategories 获取所有分类层级，按 locale 叠加本地化 name
func (s *CatalogService) ListCategories(c *gin.Context) {
	var categories []models.Category
	if err := s.db.Order("sort_order asc").Find(&categories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	locale := backendi18n.LocaleFromContext(c)
	type outCat struct {
		models.Category
		Name string `json:"name"`
	}
	out := make([]outCat, 0, len(categories))
	for _, cat := range categories {
		out = append(out, outCat{Category: cat, Name: cat.LocalizedName(locale)})
	}
	c.JSON(http.StatusOK, out)
}

// ListShelves 获取所有虚拟分类与货架列表 (树状结构)
func (s *CatalogService) ListShelves(c *gin.Context) {
	var shelves []models.VirtualShelf
	if err := s.db.Order("sort_order asc").Find(&shelves).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	shelfMap := make(map[string]*models.VirtualShelf)
	var rootShelves []models.VirtualShelf
	for i := range shelves {
		shelfMap[shelves[i].Slug] = &shelves[i]
	}
	for _, shelf := range shelves {
		if shelf.ParentSlug == nil || *shelf.ParentSlug == "" {
			rootShelves = append(rootShelves, shelf)
		} else {
			if parent, ok := shelfMap[*shelf.ParentSlug]; ok {
				parent.Children = append(parent.Children, shelf)
			}
		}
	}

	c.JSON(http.StatusOK, rootShelves)
}

// GetTaxonomy 获取全量分类层级、虚拟货架、多维标签、媒介大类、演职角色与物理规格
func (s *CatalogService) GetTaxonomy(c *gin.Context) {
	var categories []models.Category
	if err := s.db.Order("sort_order asc").Find(&categories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var shelves []models.VirtualShelf
	_ = s.db.Order("sort_order asc").Find(&shelves).Error

	var allTags []models.Tag
	_ = s.db.Where("group_type != ?", "topic").Order("id asc").Find(&allTags).Error

	tagGroups := make(map[string][]models.Tag)
	for _, t := range allTags {
		tagGroups[t.GroupType] = append(tagGroups[t.GroupType], t)
	}

	locale := backendi18n.LocaleFromContext(c)

	type outCat struct {
		models.Category
		Name string `json:"name"`
	}
	outCats := make([]outCat, 0, len(categories))
	for _, cat := range categories {
		outCats = append(outCats, outCat{Category: cat, Name: cat.LocalizedName(locale)})
	}

	mediaTypes := make([]map[string]string, 0)
	var mtRows []models.MediaType
	_ = s.db.Where("is_enabled = ?", true).Order("sort_order asc").Find(&mtRows).Error
	for _, mt := range mtRows {
		name := mt.NameZh
		if locale == "en-US" && mt.NameEn != "" {
			name = mt.NameEn
		}
		if mt.Names != nil {
			if v, ok := mt.Names[locale]; ok {
				if s, ok := v.(string); ok && s != "" {
					name = s
				}
			}
		}
		mediaTypes = append(mediaTypes, map[string]string{
			"id": mt.Code, "name_zh": mt.NameZh, "name_en": mt.NameEn, "name": name,
		})
	}

	// 组装虚拟货架树
	shelfMap := make(map[string]*models.VirtualShelf)
	var rootShelves []models.VirtualShelf
	for i := range shelves {
		shelfMap[shelves[i].Slug] = &shelves[i]
	}
	for _, shelf := range shelves {
		if shelf.ParentSlug == nil || *shelf.ParentSlug == "" {
			rootShelves = append(rootShelves, shelf)
		} else {
			if parent, ok := shelfMap[*shelf.ParentSlug]; ok {
				parent.Children = append(parent.Children, shelf)
			}
		}
	}

	var dynamicRoles []models.RelationType
	_ = s.db.Where("domain = ? AND is_enabled = ?", "agent_work", true).Order("sort_order asc").Find(&dynamicRoles).Error

	roles := make([]map[string]string, 0, len(dynamicRoles))
	for _, dr := range dynamicRoles {
		roles = append(roles, map[string]string{
			"id":      dr.Code,
			"name_zh": dr.NameZh,
			"name_en": dr.NameEn,
			"name":    dr.LocalizedName(locale),
			"forward": dr.LocalizedForwardLabel(locale),
			"reverse": dr.LocalizedReverseLabel(locale),
			"color":   dr.Color,
			"icon":    dr.Icon,
		})
	}

	var dynamicEntityTypes []models.EntityTypeDefinition
	_ = s.db.Where("is_enabled = ?", true).Order("sort_order asc").Find(&dynamicEntityTypes).Error

	entityTypes := make([]map[string]string, 0, len(dynamicEntityTypes))
	for _, det := range dynamicEntityTypes {
		name := det.LocalizedName(locale)
		desc := det.LocalizedDesc(locale)
		entityTypes = append(entityTypes, map[string]string{
			"id":           det.Code,
			"name_zh":      det.NameZh,
			"name_en":      det.NameEn,
			"name":         name,
			"desc_zh":      det.DescZh,
			"desc_en":      det.DescEn,
			"desc":         desc,
			"color":        det.Color,
			"bg_color":     det.BgColor,
			"border_color": det.BorderColor,
		})
	}

	packagings := []map[string]string{
		{"id": "jewel_case", "name_zh": "标准珠宝盒 (Jewel Case)", "name_en": "Jewel Case"},
		{"id": "digipak", "name_zh": "纸套包装 (Digipak)", "name_en": "Digipak"},
		{"id": "steelbook", "name_zh": "限量铁盒 (Steelbook)", "name_en": "Steelbook"},
		{"id": "box_set", "name_zh": "豪华精装盒 (Box Set)", "name_en": "Box Set"},
		{"id": "gatefold", "name_zh": "黑胶折页 (Gatefold)", "name_en": "Gatefold"},
		{"id": "slipcase", "name_zh": "考据收藏盒 (Slipcase)", "name_en": "Slipcase"},
		{"id": "digital", "name_zh": "高解析数字母带 (Digital Master)", "name_en": "Digital Master"},
	}

	formats := []map[string]string{
		{"id": "CD", "name": "CD (Compact Disc)"},
		{"id": "Blu-ray", "name": "Blu-ray (BDMV)"},
		{"id": "4K Ultra HD Blu-ray", "name": "4K Ultra HD Blu-ray"},
		{"id": "Vinyl", "name": "Vinyl (12\" LP)"},
		{"id": "SACD", "name": "SACD / DSD ISO"},
		{"id": "Hi-Res FLAC", "name": "Hi-Res FLAC (24/192)"},
		{"id": "DVD-Video", "name": "DVD-Video"},
		{"id": "EPUB/PDF", "name": "EPUB / PDF"},
		{"id": "Cassette", "name": "Cassette Tape"},
	}

	languages := []map[string]string{
		{"code": "zh", "name": "中文 (Chinese)"},
		{"code": "ja", "name": "日本語 (Japanese)"},
		{"code": "en", "name": "English"},
		{"code": "ko", "name": "한국어 (Korean)"},
		{"code": "fr", "name": "Français (French)"},
		{"code": "de", "name": "Deutsch (German)"},
	}

	c.JSON(http.StatusOK, gin.H{
		"categories":  outCats,
		"shelves":     rootShelves,
		"tag_groups":  tagGroups,
		"tags":        allTags,
		"media_types":  mediaTypes,
		"entity_types": entityTypes,
		"roles":        roles,
		"packagings":   packagings,
		"formats":      formats,
		"languages":    languages,
	})
}

// ListTags 获取标签列表
func (s *CatalogService) ListTags(c *gin.Context) {
	groupType := c.Query("group_type")
	mediaType := c.Query("media_type")

	query := s.db.Model(&models.Tag{})
	if groupType != "" {
		query = query.Where("group_type = ?", groupType)
	}
	if mediaType != "" {
		query = query.Where("? = ANY(category_scope) OR category_scope = '{}'", mediaType)
	}

	var tags []models.Tag
	if err := query.Find(&tags).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tags)
}

// ListWorks 多维筛选作品列表（支持 shelf, tags, language 过滤与 status 校验）
func (s *CatalogService) ListWorks(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "24"))
	shelfSlug := c.Query("shelf")
	customShelfID := c.Query("custom_shelf")
	tagsParam := c.Query("tags")
	tagParam := c.Query("tag")
	mediaType := c.Query("media_type")
	categoryCode := c.Query("category_code")
	searchQuery := c.Query("q")
	sortBy := c.DefaultQuery("sort", "created_at")
	status := c.Query("status")
	language := c.Query("language")
	if language == "" {
		language = c.Query("locale")
	}

	offset := (page - 1) * pageSize
	query := s.db.Model(&models.Work{}).Preload("Category").Preload("Tags").Preload("ArtistRelations.Artist")

	// 状态过滤：未登录/普通用户默认只能查 published/completed 作品
	userRole, _ := c.Get("role")
	roleStr, _ := userRole.(string)
	isAdmin := roleStr == "admin" || roleStr == "archivist"

	if status != "" {
		if isAdmin || status == models.WorkStatusPublished || status == models.WorkStatusCompleted {
			query = query.Where("status = ?", status)
		} else {
			query = query.Where("status IN (?, ?) OR status IS NULL OR status = ''", models.WorkStatusPublished, models.WorkStatusCompleted)
		}
	} else if !isAdmin {
		query = query.Where("status IN (?, ?) OR status IS NULL OR status = ''", models.WorkStatusPublished, models.WorkStatusCompleted)
	}

	// 虚拟货架规则过滤 (Virtual Shelf Rule)
	if shelfSlug != "" {
		var shelf models.VirtualShelf
		if err := s.db.Where("slug = ?", shelfSlug).First(&shelf).Error; err == nil {
			if shelf.MediaType != "" && shelf.MediaType != "all" {
				switch shelf.MediaType {
				case "video":
					query = query.Where("media_type IN ('movie', 'tv_series', 'anime')")
				case "audio":
					query = query.Where("media_type IN ('music', 'audiobook')")
				case "text":
					query = query.Where("media_type IN ('novel')")
				case "graphic":
					query = query.Where("media_type IN ('comic', 'gallery')")
				case "movie", "tv_series", "anime", "music", "audiobook", "novel", "comic", "gallery":
					query = query.Where("media_type = ?", shelf.MediaType)
				}
			}
			if len(shelf.QueryTags) > 0 {
				if shelf.RequireAllTags {
					for _, tName := range shelf.QueryTags {
						query = query.Where("id IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ?)", tName)
					}
				} else {
					query = query.Where("id IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ANY(?))", pq.Array(shelf.QueryTags))
				}
			}
			if len(shelf.ExcludeTags) > 0 {
				query = query.Where("id NOT IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ANY(?))", pq.Array(shelf.ExcludeTags))
			}
		}
	}

	// 自定义推荐分组过滤 (与 shelf 互斥，复用同一套 media_type/query_tags 逻辑)
	if customShelfID != "" {
		if cid, err := uuid.Parse(customShelfID); err == nil {
			var cs models.UserCustomShelf
			if err := s.db.Where("id = ?", cid).First(&cs).Error; err == nil {
				uidCS := currentUserID(c)
				roleCS, _ := c.Get("role")
				isOwnerCS := uidCS != nil && cs.OwnerID == *uidCS
				isAdminCS := roleCS == "admin" || roleCS == "archivist"
				if cs.IsPublic || isOwnerCS || isAdminCS {
					// media_type
					if cs.MediaType != "" && cs.MediaType != "all" {
						switch cs.MediaType {
						case "video":
							query = query.Where("media_type IN ('movie', 'tv_series', 'anime')")
						case "audio":
							query = query.Where("media_type IN ('music', 'audiobook')")
						case "text":
							query = query.Where("media_type IN ('novel')")
						case "graphic":
							query = query.Where("media_type IN ('comic', 'gallery')")
						default:
							query = query.Where("media_type = ?", cs.MediaType)
						}
					}
					if len(cs.QueryTags) > 0 {
						if cs.RequireAllTags {
							for _, tName := range cs.QueryTags {
								query = query.Where("id IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ?)", tName)
							}
						} else {
							query = query.Where("id IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ANY(?))", pq.Array(cs.QueryTags))
						}
					}
					if len(cs.ExcludeTags) > 0 {
						query = query.Where("id NOT IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ANY(?))", pq.Array(cs.ExcludeTags))
					}
				}
			}
		}
	}

	// 单标签或多标签过滤
	if tagParam != "" {
		query = query.Where("id IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ?)", tagParam)
	}
	if tagsParam != "" {
		tagList := strings.Split(tagsParam, ",")
		for _, tName := range tagList {
			trimmed := strings.TrimSpace(tName)
			if trimmed != "" {
				query = query.Where("id IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ?)", trimmed)
			}
		}
	}

	if language != "" {
		language = models.NormalizeLocale(language)
		if models.ValidLocales[language] {
			query = query.Where("language = ?", language)
		}
	}
	if mediaType != "" && shelfSlug == "" && customShelfID == "" {
		query = query.Where("media_type = ?", mediaType)
	}
	if categoryCode != "" && shelfSlug == "" && customShelfID == "" {
		query = query.Where("category_code = ? OR category_code IN (SELECT code FROM categories WHERE parent_code = ?)", categoryCode, categoryCode)
	}
	if searchQuery != "" {
		query = query.Where("title ILIKE ? OR original_title ILIKE ? OR ? = ANY(aliases)", "%"+searchQuery+"%", "%"+searchQuery+"%", searchQuery)
	}

	switch sortBy {
	case "views":
		query = query.Order("view_count desc")
	case "release_date":
		query = query.Order("release_date desc")
	default:
		query = query.Order("created_at desc")
	}

	var total int64
	query.Count(&total)

	var works []models.Work
	if err := query.Offset(offset).Limit(pageSize).Find(&works).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     works,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}
// GetWorkDetail 获取作品概览（轻量，不再全量预加载 Release/Medium/Track）
// 如需关联版本列表，请调 GET /releases?work_id= 分页接口
// ?inc=releases+relations+revisions 附加展开字段，响应始终为作品字段平铺
func (s *CatalogService) GetWorkDetail(c *gin.Context) {
	idStr := c.Param("id")
	workID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_work_id")})
		return
	}

	var work models.Work
	q := s.db.Preload("Category").
		Preload("Tags").
		Preload("ArtistRelations.Artist").
		Preload("Translations").
		Where("id = ?", workID)

	if err := q.First(&work).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "catalog.work_not_found")})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

		s.db.Model(&work).UpdateColumn("view_count", gorm.Expr("view_count + 1"))
		work.ViewCount++

		var favCount int64
		_ = s.db.Table("favorites").Where("target_type = ? AND target_id = ?", "work", work.ID).Count(&favCount).Error
		work.FavoriteCount = favCount

	inc := parseInc(c.Query("inc"))
	b, _ := json.Marshal(work)
	var m map[string]interface{}
	_ = json.Unmarshal(b, &m)

	if inc["releases"] {
		var releases []models.Release
		uid := currentUserID(c)
		rq := applyReleaseVisibility(s.db.Model(&models.Release{}), uid).Where("work_id = ?", work.ID).Order("edition_date asc, created_at asc").Limit(50)
		_ = rq.Find(&releases).Error
		m["releases"] = releases
	}
	if inc["relations"] || inc["rels"] {
		var rels []models.EntityRelationship
		_ = s.db.Where("(source_type = 'work' AND source_id = ?) OR (target_type = 'work' AND target_id = ?)", work.ID, work.ID).Order("created_at desc").Limit(50).Find(&rels).Error
		m["relations"] = rels
		locale := backendi18n.LocaleFromContext(c)
		m["connected_entities"] = s.connectedFromRels(locale, rels, "work", work.ID)
	}
	if inc["revisions"] {
		var revs []models.EntityRevision
		_ = s.db.Where("target_type = 'work' AND target_id = ?", work.ID).Order("created_at desc").Limit(20).Find(&revs).Error
		m["revisions"] = revs
	}
	c.JSON(http.StatusOK, m)
}

// ListReleases 按作品分页列出发行版，仅返回已审核通过的版本
func (s *CatalogService) ListReleases(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	workIDStr := c.Query("work_id")
	q := c.Query("q")
	sortBy := c.DefaultQuery("sort", "created_at")

	offset := (page - 1) * pageSize
	uid := currentUserID(c)
	query := applyReleaseVisibility(s.db.Model(&models.Release{}).Preload("Uploader"), uid)

	if workIDStr != "" {
		if workID, err := uuid.Parse(workIDStr); err == nil {
			query = query.Where("work_id = ?", workID)
		} else if workIDStr != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_work_id_q")})
			return
		}
	}
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("edition_name ILIKE ? OR publisher ILIKE ? OR catalog_number ILIKE ?", like, like, like)
	}

	switch sortBy {
	case "edition_date":
		query = query.Order("edition_date desc")
	default:
		query = query.Order("created_at desc")
	}

	var total int64
	query.Count(&total)

	var releases []models.Release
	if err := query.Preload("PublisherEntity").Preload("Work").Offset(offset).Limit(pageSize).Find(&releases).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     releases,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetReleaseDetail 获取单发行版详情，含 Work 摘要与载体/条目/文件
// 支持 inc=mediums+tracks+artists+relations+revisions
func (s *CatalogService) GetReleaseDetail(c *gin.Context) {
	releaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_release_id")})
		return
	}

	var release models.Release
	if err := s.db.
		Preload("Work.Category").
		Preload("PublisherEntity").
		Preload("Uploader").
		Preload("Mediums", func(db *gorm.DB) *gorm.DB { return db.Order("position asc") }).
		Preload("Mediums.Tracks.CanonicalEntry").
		Preload("Mediums.AssetFiles").
		Preload("AssetFiles").
		Where("id = ?", releaseID).
		First(&release).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "catalog.release_not_found")})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !release.IsMasterVerified {
		uidDet := currentUserID(c)
		roleDet, _ := c.Get("role")
		allowed := roleDet == "admin" || roleDet == "archivist"
		if !allowed && (uidDet == nil || release.UploaderID == nil || *release.UploaderID != *uidDet) {
			c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "catalog.release_not_found")})
			return
		}
	}
	inc := parseInc(c.Query("inc"))
	b, _ := json.Marshal(release)
	var m map[string]interface{}
	_ = json.Unmarshal(b, &m)
	if inc["relations"] || inc["rels"] {
		var rels []models.EntityRelationship
		_ = s.db.Where("(source_type = 'release' AND source_id = ?) OR (target_type = 'release' AND target_id = ?)", release.ID, release.ID).Limit(50).Find(&rels).Error
		m["relations"] = rels
	}
	if inc["revisions"] {
		var revs []models.EntityRevision
		_ = s.db.Where("target_type = 'release' AND target_id = ?", release.ID).Order("created_at desc").Limit(20).Find(&revs).Error
		m["revisions"] = revs
	}
	c.JSON(http.StatusOK, m)
}

// GetMediumDetail 获取单载体详情
func (s *CatalogService) GetMediumDetail(c *gin.Context) {
	mediumID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_medium_id")})
		return
	}

	var medium models.Medium
	if err := s.db.
		Preload("Tracks.CanonicalEntry").
		Preload("AssetFiles").
		Where("id = ?", mediumID).
		First(&medium).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "catalog.medium_not_found")})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 附带 Release 与 Work 供面包屑
	var release models.Release
	_ = s.db.Preload("Work.Category").Where("id = ?", medium.ReleaseID).First(&release).Error

	c.JSON(http.StatusOK, gin.H{
		"medium":  medium,
		"release": release,
	})
}

// GraphNode 关系图谱节点
type GraphNode struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`     // 'work', 'artist', 'release', 'medium'
	Category string `json:"category"` // 'main_work', 'artist', 'soundtrack', 'adaptation', 'release'
	Role     string `json:"role,omitempty"`
	Level    int    `json:"level"`
}

// GraphLink 关系图谱连线
type GraphLink struct {
	Source     string       `json:"source"`
	Target     string       `json:"target"`
	Type       string       `json:"type"`
	Label      string       `json:"label"`
	Color      string       `json:"color,omitempty"`
	Attributes models.JSONB `json:"attributes,omitempty"`
}

// GetWorkGraph 获取作品的高级知识图谱网络
func (s *CatalogService) GetWorkGraph(c *gin.Context) {
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID"})
		return
	}

	var work models.Work
	if err := s.db.Preload("ArtistRelations.Artist").Preload("Releases.Mediums").Where("id = ?", workID).First(&work).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Work not found: " + err.Error()})
		return
	}

	var allRelTypes []models.RelationType
	s.db.Find(&allRelTypes)
	relTypeMap := make(map[string]models.RelationType)
	for _, rt := range allRelTypes {
		relTypeMap[rt.Code] = rt
	}
	locale := backendi18n.LocaleFromContext(c)

	nodes := []GraphNode{
		{
			ID:       work.ID.String(),
			Name:     work.Title,
			Type:     "work",
			Category: "main_work",
			Level:    1,
		},
	}
	links := []GraphLink{}

	for _, rel := range work.ArtistRelations {
		if rel.Artist != nil {
			nodes = append(nodes, GraphNode{
				ID:       rel.Artist.ID.String(),
				Name:     rel.Artist.Name,
				Type:     "artist",
				Category: "artist",
				Role:     rel.Role,
				Level:    0,
			})
			roleLabel := rel.Role
			color := "amber"
			if rt, ok := relTypeMap[rel.Role]; ok {
				roleLabel = rt.LocalizedReverseLabel(locale)
				color = rt.Color
			}
			links = append(links, GraphLink{
				Source: rel.Artist.ID.String(),
				Target: work.ID.String(),
				Type:   rel.Role,
				Label:  roleLabel,
				Color:  color,
			})
		}
	}

	for _, rel := range work.Releases {
		nodes = append(nodes, GraphNode{
			ID:       rel.ID.String(),
			Name:     rel.EditionName,
			Type:     "release",
			Category: "release",
			Level:    2,
		})
		links = append(links, GraphLink{
			Source: work.ID.String(),
			Target: rel.ID.String(),
			Type:   "released_as",
			Label:  "发行实体",
			Color:  "cyan",
		})

		for _, med := range rel.Mediums {
			nodes = append(nodes, GraphNode{
				ID:       med.ID.String(),
				Name:     med.Name,
				Type:     "medium",
				Category: med.MediaCategory,
				Role:     med.Format,
				Level:    3,
			})
			links = append(links, GraphLink{
				Source: rel.ID.String(),
				Target: med.ID.String(),
				Type:   "contains_disc",
				Label:  med.Format,
				Color:  "purple",
			})
		}
	}

	var crossRels []models.EntityRelationship
	s.db.Where("source_id = ? OR target_id = ?", workID, workID).Find(&crossRels)

	for _, cr := range crossRels {
		otherID := cr.TargetID
		otherType := cr.TargetType
		dir := "forward"
		if cr.TargetID == workID {
			otherID = cr.SourceID
			otherType = cr.SourceType
			dir = "reverse"
		}

		var otherName = "关联实体"
		if n, ok := ontology.LookupName(s.db, otherType, otherID); ok {
			otherName = n
		}

		relLabel := cr.RelationshipType
		color := "sky"
		if rt, ok := relTypeMap[cr.RelationshipType]; ok {
			color = rt.Color
			if dir == "forward" {
				relLabel = rt.LocalizedForwardLabel(locale)
			} else {
				relLabel = rt.LocalizedReverseLabel(locale)
			}
		}

		nodes = append(nodes, GraphNode{
			ID:       otherID.String(),
			Name:     otherName,
			Type:     otherType,
			Category: cr.RelationshipType,
			Level:    2,
		})
		links = append(links, GraphLink{
			Source:     cr.SourceID.String(),
			Target:     cr.TargetID.String(),
			Type:       cr.RelationshipType,
			Label:      relLabel,
			Color:      color,
			Attributes: cr.Attributes,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"nodes": nodes,
		"links": links,
	})
}

func currentUserID(c *gin.Context) *uuid.UUID {
	if v, ok := c.Get("userID"); ok {
		if id, ok := v.(uuid.UUID); ok {
			return &id
		}
	}
	return nil
}

func applyReleaseVisibility(q *gorm.DB, uid *uuid.UUID) *gorm.DB {
	if uid != nil {
		return q.Where("(is_master_verified = true OR uploader_id = ?)", *uid)
	}
	return q.Where("is_master_verified = true")
}

func applyWorkVisibility(q *gorm.DB, uid *uuid.UUID) *gorm.DB {
	if uid != nil {
		return q.Where("(status = 'active' OR status IS NULL OR user_id = ?)", *uid)
	}
	return q.Where("status = 'active' OR status IS NULL")
}

func getUserID(c *gin.Context) (uuid.UUID, error) {
	if v, ok := c.Get("userID"); ok {
		if id, ok := v.(uuid.UUID); ok {
			return id, nil
		}
	}
	return uuid.Nil, errors.New("unauthorized")
}

// ── Member 级分级创建：仅关联现有实体，不做 name 兜底创建 ──

func (s *CatalogService) CreateArtistForMember(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	var input struct {
		Name           string                 `json:"name"`
		OriginalName   string                 `json:"original_name"`
		Disambiguation string                 `json:"disambiguation"`
		EntityType     string                 `json:"entity_type"`
		Country        string                 `json:"country"`
		Biography      string                 `json:"biography"`
		Language       string                 `json:"language"`
		ExternalIDs    map[string]interface{} `json:"external_ids"`
		Translations   []LocaleTextInput      `json:"translations"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.EntityType == "" {
		input.EntityType = models.EntityTypePerson
	} else if !ontology.IsEnabledEntityType(s.db, input.EntityType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_entity_type")})
		return
	}
	ext := models.JSONB{}
	if input.ExternalIDs != nil {
		ext = models.JSONB(input.ExternalIDs)
	}
	artist := models.Artist{
		Name:           strings.TrimSpace(input.Name),
		OriginalName:   strings.TrimSpace(input.OriginalName),
		Disambiguation: strings.TrimSpace(input.Disambiguation),
		EntityType:     input.EntityType,
		Country:        strings.TrimSpace(input.Country),
		Biography:      input.Biography,
		Language:       input.Language,
		ExternalIDs:    ext,
		CreatedBy:      uid,
	}
	items := applyArtistLocaleDefaults(&artist, input.Translations, input.Language)
	if strings.TrimSpace(artist.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
		return
	}
	if err := s.db.Create(&artist).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.upsertArtistTranslations(artist.ID, items)
	_ = s.db.Preload("Translations").First(&artist, artist.ID).Error
	c.JSON(http.StatusCreated, artist)
}

func (s *CatalogService) CreateWorkForMember(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	var input CreateWorkInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	mt := s.resolveMediaType(input.MediaType, input.Tags, input.TagIDs)
	if mt == "" || !ontology.IsEnabledMediaType(s.db, mt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请添加形态标签（如电影、专辑、游戏、漫画）以便推断作品形态"})
		return
	}
	var releaseDate *time.Time
	if input.ReleaseDate != nil && *input.ReleaseDate != "" {
		if t, err := time.Parse("2006-01-02", *input.ReleaseDate); err == nil {
			releaseDate = &t
		}
	}
	workStatus := models.WorkStatusPendingReview

	work := models.Work{
		CategoryCode:     input.CategoryCode,
		MediaType:        mt,
		Title:            strings.TrimSpace(input.Title),
		OriginalTitle:    strings.TrimSpace(input.OriginalTitle),
		Aliases:          input.Aliases,
		ReleaseDate:      releaseDate,
		Country:          strings.TrimSpace(input.Country),
		Language:         input.Language,
		OriginalLanguage: input.OriginalLanguage,
		Summary:          input.Summary,
		CoverImageURL:    input.CoverImageURL,
		ContentRating:    input.ContentRating,
		Status:           workStatus,
		CatalogMetadata:  models.JSONB(input.CatalogMetadata),
		CreatedBy:        uid,
	}
	localeItems := applyWorkLocaleDefaults(&work, input.Translations, input.Language)
	if strings.TrimSpace(work.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title required"})
		return
	}
	if err := validateCoverURL(work.CoverImageURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := s.db.Create(&work).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tagNames := input.Tags
	if len(input.TagIDs) > 0 {
		var byID []models.Tag
		s.db.Where("id IN ?", input.TagIDs).Find(&byID)
		for _, t := range byID {
			tagNames = append(tagNames, t.Name)
		}
	}
	s.replaceWorkTagsByName(&work, tagNames)
	s.upsertWorkTranslations(work.ID, localeItems)
	_ = s.db.Preload("Tags").Preload("Translations").First(&work, work.ID).Error
	c.JSON(http.StatusCreated, work)
}

func (s *CatalogService) CreateReleaseForMember(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	var input CreateReleaseInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.PublisherID != nil {
		var cnt int64
		s.db.Model(&models.Artist{}).Where("id = ?", *input.PublisherID).Count(&cnt)
		if cnt == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.publisher_not_found")})
			return
		}
	}
	var cnt int64
	s.db.Model(&models.Work{}).Where("id = ?", input.WorkID).Count(&cnt)
	if cnt == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.work_not_found")})
		return
	}
	var editionDate *time.Time
	if input.EditionDate != nil && *input.EditionDate != "" {
		if t, err := time.Parse("2006-01-02", *input.EditionDate); err == nil {
			editionDate = &t
		}
	}
	publisherName := input.Publisher
	if input.PublisherID != nil && publisherName == "" {
		var pubArtist models.Artist
		if err := s.db.Where("id = ?", *input.PublisherID).First(&pubArtist).Error; err == nil {
			publisherName = pubArtist.Name
		}
	}
	ch := ontology.NormalizeDistributionChannel(input.DistributionChannel)
	if input.DistributionChannel != "" && ch == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid distribution_channel"})
		return
	}
	meta := models.JSONB{}
	if input.CatalogMetadata != nil {
		meta = models.JSONB(input.CatalogMetadata)
	}
	release := models.Release{
		WorkID:              input.WorkID,
		PublisherID:         input.PublisherID,
		EditionName:         input.EditionName,
		CatalogNumber:       input.CatalogNumber,
		Barcode:             input.Barcode,
		Publisher:           publisherName,
		Packaging:           input.Packaging,
		EditionDate:         editionDate,
		Country:             strings.TrimSpace(input.Country),
		Language:            strings.TrimSpace(input.Language),
		DistributionChannel: ch,
		CatalogMetadata:     meta,
		UploaderID:          uid,
		IsMasterVerified:    false,
		Notes:               input.Notes,
	}
	if release.Packaging == "" {
		release.Packaging = "box_set"
	}
	if err := s.db.Create(&release).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, release)
}

func (s *CatalogService) CreateMediumForMember(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	var input struct {
		ReleaseID     uuid.UUID `json:"release_id" binding:"required"`
		Position      int       `json:"position" binding:"required"`
		Name          string    `json:"name" binding:"required"`
		Format        string    `json:"format" binding:"required"`
		MediaCategory string    `json:"media_category" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var rel models.Release
	if err := s.db.Where("id = ?", input.ReleaseID).First(&rel).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.release_not_found")})
		return
	}
	if !rel.IsMasterVerified && (rel.UploaderID == nil || *rel.UploaderID != *uid) {
		role, _ := c.Get("role")
		if role != "admin" && role != "archivist" {
			c.JSON(http.StatusForbidden, gin.H{"error": backendi18n.T(c, "catalog.forbidden_attach_pending")})
			return
		}
	}
	medium := models.Medium{ReleaseID: input.ReleaseID, Position: input.Position, Name: input.Name, Format: input.Format, MediaCategory: input.MediaCategory}
	if err := s.db.Create(&medium).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, medium)
}

func (s *CatalogService) CreateTrackForMember(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	var input struct {
		MediumID         uuid.UUID  `json:"medium_id" binding:"required"`
		Position         int        `json:"position" binding:"required"`
		Title            string     `json:"title"`
		CanonicalEntryID *uuid.UUID `json:"canonical_entry_id"`
		DurationSeconds  int        `json:"duration_seconds"`
		ISRC             string     `json:"isrc"`
		ArtistCredit     string     `json:"artist_credit"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var med models.Medium
	if err := s.db.Where("id = ?", input.MediumID).First(&med).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.medium_not_found")})
		return
	}
	var rel models.Release
	if err := s.db.Where("id = ?", med.ReleaseID).First(&rel).Error; err == nil {
		if !rel.IsMasterVerified && (rel.UploaderID == nil || *rel.UploaderID != *uid) {
			role, _ := c.Get("role")
			if role != "admin" && role != "archivist" {
				c.JSON(http.StatusForbidden, gin.H{"error": backendi18n.T(c, "catalog.forbidden_attach_pending")})
				return
			}
		}
	}
	if input.CanonicalEntryID != nil {
		var cnt int64
		s.db.Model(&models.CanonicalEntry{}).Where("id = ?", *input.CanonicalEntryID).Count(&cnt)
		if cnt == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.canonical_not_found")})
			return
		}
	}
	track := models.Track{
		MediumID:         input.MediumID,
		CanonicalEntryID: input.CanonicalEntryID,
		Position:         input.Position,
		Title:            strings.TrimSpace(input.Title),
		DurationSeconds:  input.DurationSeconds,
		ISRC:             strings.TrimSpace(input.ISRC),
		ArtistCredit:     strings.TrimSpace(input.ArtistCredit),
	}
	if err := s.db.Create(&track).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, track)
}

func (s *CatalogService) UpsertWorkRelationsForMember(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_work_id")})
		return
	}
	var work models.Work
	if err := s.db.Where("id = ?", workID).First(&work).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "catalog.work_not_found")})
		return
	}
	roleStr, _ := c.Get("role")
	isAdmin := roleStr == "admin" || roleStr == "archivist"
	if work.CreatedBy != nil && *work.CreatedBy != *uid && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": backendi18n.T(c, "catalog.forbidden_edit_work")})
		return
	}
	var input struct {
		Relations []struct {
			ArtistID uuid.UUID `json:"artist_id" binding:"required"`
			Role     string    `json:"role" binding:"required"`
		} `json:"relations" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, r := range input.Relations {
		if !ontology.IsEnabledWorkRole(s.db, r.Role) {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_role") + r.Role})
			return
		}
		var cnt int64
		s.db.Model(&models.Artist{}).Where("id = ?", r.ArtistID).Count(&cnt)
		if cnt == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.artist_not_found")})
			return
		}
	}
	if err := s.db.Where("work_id = ?", workID).Delete(&models.WorkArtistRelation{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for _, r := range input.Relations {
		rel := models.WorkArtistRelation{WorkID: workID, ArtistID: r.ArtistID, Role: r.Role}
		if err := s.db.Create(&rel).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		s.mirrorArtistWorkEdge(r.ArtistID, workID, r.Role)
	}
	c.JSON(http.StatusOK, gin.H{"status": "success", "count": len(input.Relations)})
}

// ListArtists 搜索与列表创作者与机构
func (s *CatalogService) ListArtists(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "24"))
	entityType := c.Query("entity_type")
	searchQuery := c.Query("q")
	offset := (page - 1) * pageSize

	query := s.db.Model(&models.Artist{})
	if entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	if searchQuery != "" {
		query = query.Where("name ILIKE ? OR original_name ILIKE ?", "%"+searchQuery+"%", "%"+searchQuery+"%")
	}

	var total int64
	query.Count(&total)

	var artists []models.Artist
	if err := query.Order("name asc").Offset(offset).Limit(pageSize).Find(&artists).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items": artists,
		"total": total,
		"page":  page,
	})
}

type ConnectedEntityItem struct {
	EntityID         string       `json:"entity_id"`
	EntityName       string       `json:"entity_name"`
	EntityType       string       `json:"entity_type"`
	Country          string       `json:"country,omitempty"`
	RelationshipType string       `json:"relationship_type"`
	Qualifier        string       `json:"qualifier,omitempty"`
	RelationshipName string       `json:"relationship_name"`
	Direction        string       `json:"direction"` // 'forward' | 'reverse'
	Label            string       `json:"label"`
	BeginDate        string       `json:"begin_date,omitempty"`
	EndDate          string       `json:"end_date,omitempty"`
	Ended            bool         `json:"ended"`
	IsCurrent        bool         `json:"is_current"`
	DateSpan         string       `json:"date_span,omitempty"`
	Attributes       models.JSONB `json:"attributes"`
	Color            string       `json:"color"`
	Icon             string       `json:"icon"`
}

type ArtistWorkItem struct {
	models.Work
	Role string `json:"role"`
}

type ArtistDetailResponse struct {
	Artist            models.Artist         `json:"artist"`
	Works             []ArtistWorkItem      `json:"works"`
	Releases          []models.Release      `json:"releases"`
	ConnectedEntities []ConnectedEntityItem `json:"connected_entities"`
}

// GetArtistDetail 获取创作者/机构实体详情及参演/出版列表与关联机构
func (s *CatalogService) GetArtistDetail(c *gin.Context) {
	artistID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_artist_id")})
		return
	}

	var artist models.Artist
	if err := s.db.Preload("Translations").Where("id = ?", artistID).First(&artist).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Artist not found"})
		return
	}

	locale := backendi18n.LocaleFromContext(c)

	var relations []models.WorkArtistRelation
	s.db.Where("artist_id = ?", artistID).Find(&relations)

	var workIDs []uuid.UUID
	roleMap := make(map[uuid.UUID]string)
	for _, rel := range relations {
		workIDs = append(workIDs, rel.WorkID)
		roleMap[rel.WorkID] = rel.Role
	}

	works := make([]models.Work, 0)
	if len(workIDs) > 0 {
		wQ := s.db.Preload("Category").Preload("Tags").Where("id IN ?", workIDs)
		wQ = applyWorkVisibility(wQ, currentUserID(c))
		if err := wQ.Find(&works).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	// 图谱边中的作品（character_in / creator 等），并入作者枢纽列表
	var graphWorkRels []models.EntityRelationship
	s.db.Where(
		"(source_type = 'artist' AND source_id = ? AND target_type = 'work') OR (target_type = 'artist' AND target_id = ? AND source_type = 'work')",
		artistID, artistID,
	).Find(&graphWorkRels)
	seenWorks := map[uuid.UUID]bool{}
	for _, w := range works {
		seenWorks[w.ID] = true
	}
	for _, er := range graphWorkRels {
		wid := er.TargetID
		if er.TargetType != "work" {
			wid = er.SourceID
		}
		if seenWorks[wid] {
			continue
		}
		var w models.Work
		wQ := applyWorkVisibility(s.db.Preload("Category").Preload("Tags"), currentUserID(c)).Where("id = ?", wid)
		if err := wQ.First(&w).Error; err == nil {
			works = append(works, w)
			seenWorks[w.ID] = true
			roleMap[w.ID] = er.RelationshipType
		}
	}

	workItems := make([]ArtistWorkItem, 0)
	for _, w := range works {
		workItems = append(workItems, ArtistWorkItem{
			Work: w,
			Role: roleMap[w.ID],
		})
	}

	releases := make([]models.Release, 0)
	uidPub := currentUserID(c)
	pubQ := s.db.Preload("Work").Where("(publisher_id = ? OR (publisher_id IS NULL AND publisher ILIKE ?))", artist.ID, "%"+artist.Name+"%")
	pubQ = applyReleaseVisibility(pubQ, uidPub)
	pubQ.Order("edition_date desc, created_at desc").Find(&releases)

	// 查询主体间关联 (签约、合作、隶属、代理、创始人等)
	var entRels []models.EntityRelationship
	s.db.Where("(source_type = 'artist' AND source_id = ?) OR (target_type = 'artist' AND target_id = ?)", artist.ID, artist.ID).
		Order("ended asc, begin_date desc, created_at desc").
		Find(&entRels)

	var allRelTypes []models.RelationType
	s.db.Find(&allRelTypes)
	relTypeMap := make(map[string]models.RelationType)
	for _, rt := range allRelTypes {
		relTypeMap[rt.Code] = rt
	}

	connectedEntities := make([]ConnectedEntityItem, 0)
	for _, er := range entRels {
		otherType, otherID, dir := er.TargetType, er.TargetID, "forward"
		if er.SourceType == "artist" && er.SourceID == artist.ID {
			otherType, otherID, dir = er.TargetType, er.TargetID, "forward"
		} else {
			otherType, otherID, dir = er.SourceType, er.SourceID, "reverse"
		}
		name, ok := ontology.LookupName(s.db, otherType, otherID)
		if !ok {
			continue
		}
		label := er.RelationshipType
		relName := er.RelationshipType
		color := "sky"
		icon := "Link"
		if rt, hit := relTypeMap[er.RelationshipType]; hit {
			relName = rt.LocalizedName(locale)
			color = rt.Color
			icon = rt.Icon
			if dir == "forward" {
				label = rt.LocalizedForwardLabel(locale)
			} else {
				label = rt.LocalizedReverseLabel(locale)
			}
		}
		connectedEntities = append(connectedEntities, ConnectedEntityItem{
			EntityID:         otherID.String(),
			EntityName:       name,
			EntityType:       otherType,
			RelationshipType: er.RelationshipType,
			Qualifier:        er.Qualifier,
			RelationshipName: relName,
			Direction:        dir,
			Label:            label,
			BeginDate:        er.BeginDate,
			EndDate:          er.EndDate,
			Ended:            er.Ended,
			IsCurrent:        er.IsCurrent(),
			DateSpan:         er.DateSpan(),
			Attributes:       er.Attributes,
			Color:            color,
			Icon:             icon,
		})
	}

	c.JSON(http.StatusOK, ArtistDetailResponse{
		Artist:            artist,
		Works:             workItems,
		Releases:          releases,
		ConnectedEntities: connectedEntities,
	})
}

// GetArtistGraph 获取创作者/机构的关系图谱网络
func (s *CatalogService) GetArtistGraph(c *gin.Context) {
	artistID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid artist ID"})
		return
	}

	var artist models.Artist
	if err := s.db.Where("id = ?", artistID).First(&artist).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Artist not found"})
		return
	}

	var allRelTypes []models.RelationType
	s.db.Find(&allRelTypes)
	relTypeMap := make(map[string]models.RelationType)
	for _, rt := range allRelTypes {
		relTypeMap[rt.Code] = rt
	}
	locale := backendi18n.LocaleFromContext(c)

	nodes := []GraphNode{
		{
			ID:       artist.ID.String(),
			Name:     artist.Name,
			Type:     "artist",
			Category: artist.EntityType,
			Level:    0,
		},
	}
	nodeSet := map[string]bool{artist.ID.String(): true}
	links := []GraphLink{}

	// 1. 作品演职制作关联 (WorkArtistRelation)
	var relations []models.WorkArtistRelation
	s.db.Where("artist_id = ?", artistID).Find(&relations)

	for _, rel := range relations {
		var work models.Work
		if err := s.db.Where("id = ?", rel.WorkID).First(&work).Error; err == nil {
			if !nodeSet[work.ID.String()] {
				nodeSet[work.ID.String()] = true
				nodes = append(nodes, GraphNode{
					ID:       work.ID.String(),
					Name:     work.Title,
					Type:     "work",
					Category: work.MediaType,
					Role:     rel.Role,
					Level:    1,
				})
			}
			roleLabel := rel.Role
			color := "amber"
			if rt, ok := relTypeMap[rel.Role]; ok {
				roleLabel = rt.LocalizedReverseLabel(locale)
				color = rt.Color
			}
			links = append(links, GraphLink{
				Source: artist.ID.String(),
				Target: work.ID.String(),
				Type:   rel.Role,
				Label:  roleLabel,
				Color:  color,
			})
		}
	}

	// 2. 主体间长效关联 (EntityRelationship: 签约、合作、隶属、代理、母子)
	var entRels []models.EntityRelationship
	s.db.Where("(source_type = 'artist' AND source_id = ?) OR (target_type = 'artist' AND target_id = ?)", artistID, artistID).Find(&entRels)

	for _, er := range entRels {
		otherType, otherID, dir := er.TargetType, er.TargetID, "forward"
		if er.SourceType == "artist" && er.SourceID == artistID {
			otherType, otherID, dir = er.TargetType, er.TargetID, "forward"
		} else {
			otherType, otherID, dir = er.SourceType, er.SourceID, "reverse"
		}

		name, ok := ontology.LookupName(s.db, otherType, otherID)
		if !ok {
			continue
		}
		if !nodeSet[otherID.String()] {
			nodeSet[otherID.String()] = true
			nodes = append(nodes, GraphNode{
				ID:       otherID.String(),
				Name:     name,
				Type:     otherType,
				Category: otherType,
				Level:    1,
			})
		}

		label := er.RelationshipType
		color := "sky"
		if rt, hit := relTypeMap[er.RelationshipType]; hit {
			color = rt.Color
			if dir == "forward" {
				label = rt.LocalizedForwardLabel(locale)
			} else {
				label = rt.LocalizedReverseLabel(locale)
			}
		}

		links = append(links, GraphLink{
			Source:     er.SourceID.String(),
			Target:     er.TargetID.String(),
			Type:       er.RelationshipType,
			Label:      label,
			Color:      color,
			Attributes: er.Attributes,
		})
	}

	// 3. 如果是机构/厂牌/工作室，同时关联其出版的发行版
	if artist.EntityType == models.EntityTypePublisher || artist.EntityType == models.EntityTypeStudio || artist.EntityType == models.EntityTypeLabel {
		var pubReleases []models.Release
		s.db.Where("publisher_id = ?", artistID).Find(&pubReleases)
		for _, rel := range pubReleases {
			if !nodeSet[rel.ID.String()] {
				nodeSet[rel.ID.String()] = true
				nodes = append(nodes, GraphNode{
					ID:       rel.ID.String(),
					Name:     rel.EditionName,
					Type:     "release",
					Category: "release",
					Role:     "publisher",
					Level:    1,
				})
			}
			links = append(links, GraphLink{
				Source: artist.ID.String(),
				Target: rel.ID.String(),
				Type:   "published",
				Label:  "出版发行",
				Color:  "cyan",
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"nodes": nodes,
		"links": links,
	})
}

// ListRelationTypes 获取启用的动态关系类型列表
func (s *CatalogService) ListRelationTypes(c *gin.Context) {
	domain := c.Query("domain")
	sourceType := c.Query("source_type")
	targetType := c.Query("target_type")
	locale := backendi18n.LocaleFromContext(c)

	query := s.db.Model(&models.RelationType{}).Where("is_enabled = ?", true)
	if domain != "" {
		query = query.Where("domain = ?", domain)
	}
	if sourceType != "" {
		query = query.Where("? = ANY(allowed_source_types) OR cardinality(allowed_source_types) = 0", sourceType)
	}
	if targetType != "" {
		query = query.Where("? = ANY(allowed_target_types) OR cardinality(allowed_target_types) = 0", targetType)
	}

	var items []models.RelationType
	if err := query.Order("sort_order asc, created_at asc").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type OutItem struct {
		models.RelationType
		DisplayName  string `json:"display_name"`
		ForwardLabel string `json:"forward_label"`
		ReverseLabel string `json:"reverse_label"`
	}

	out := make([]OutItem, 0, len(items))
	for _, it := range items {
		out = append(out, OutItem{
			RelationType: it,
			DisplayName:  it.LocalizedName(locale),
			ForwardLabel: it.LocalizedForwardLabel(locale),
			ReverseLabel: it.LocalizedReverseLabel(locale),
		})
	}

	c.JSON(http.StatusOK, gin.H{"items": out})
}

type CreateWorkInput struct {
	CategoryCode     string                 `json:"category_code"`
	MediaType        string                 `json:"media_type"`
	Title            string                 `json:"title"`
	OriginalTitle    string                 `json:"original_title"`
	Aliases          []string               `json:"aliases"`
	ReleaseDate      *string                `json:"release_date"`
	Country          string                 `json:"country"`
	Language         string                 `json:"language"`
	OriginalLanguage string                 `json:"original_language"`
	Summary          string                 `json:"summary"`
	CoverImageURL    string                 `json:"cover_image_url"`
	ContentRating    string                 `json:"content_rating"`
	CatalogMetadata  map[string]interface{} `json:"catalog_metadata"`
	TagIDs           []uint                 `json:"tag_ids"`
	Tags             []string               `json:"tags"`
	Translations     []LocaleTextInput      `json:"translations"`
}

type CreateReleaseInput struct {
	WorkID        uuid.UUID  `json:"work_id" binding:"required"`
	PublisherID   *uuid.UUID `json:"publisher_id"`
	EditionName   string     `json:"edition_name" binding:"required"`
	CatalogNumber string     `json:"catalog_number"`
	Barcode       string     `json:"barcode"`
	Publisher     string     `json:"publisher"`
	Packaging           string     `json:"packaging"`
	EditionDate         *string    `json:"edition_date"`
	Country             string     `json:"country"`
	Language            string     `json:"language"`
	DistributionChannel string     `json:"distribution_channel"`
	CatalogMetadata     map[string]interface{} `json:"catalog_metadata"`
	Notes               string     `json:"notes"`
}

// CreateRelease 创建发行商品版本
func (s *CatalogService) CreateRelease(c *gin.Context) {
	userIDVal, _ := c.Get("userID")
	userID := userIDVal.(uuid.UUID)

	var input CreateReleaseInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var editionDate *time.Time
	if input.EditionDate != nil && *input.EditionDate != "" {
		if t, err := time.Parse("2006-01-02", *input.EditionDate); err == nil {
			editionDate = &t
		}
	}

	publisherName := input.Publisher
	if input.PublisherID != nil && publisherName == "" {
		var pubArtist models.Artist
		if err := s.db.Where("id = ?", *input.PublisherID).First(&pubArtist).Error; err == nil {
			publisherName = pubArtist.Name
		}
	}

	release := models.Release{
		WorkID:        input.WorkID,
		PublisherID:   input.PublisherID,
		EditionName:   input.EditionName,
		CatalogNumber: input.CatalogNumber,
		Barcode:       input.Barcode,
		Publisher:     publisherName,
		Packaging:     input.Packaging,
		EditionDate:   editionDate,
		UploaderID:    &userID,
		Notes:         input.Notes,
	}

	if err := s.db.Create(&release).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, release)
}

type ComprehensiveTrackInput struct {
	Position        int    `json:"position"`
	Title           string `json:"title"`
	ArtistCredit    string `json:"artist_credit"`
	DurationSeconds int    `json:"duration_seconds"`
	ISRC            string `json:"isrc"`
}

type ComprehensiveMediumInput struct {
	Position      int                       `json:"position"`
	Name          string                    `json:"name"`
	Format        string                    `json:"format"`
	MediaCategory string                    `json:"media_category"`
	Tracks        []ComprehensiveTrackInput `json:"tracks"`
}

type ComprehensiveArtistRelationInput struct {
	ArtistID       *uuid.UUID `json:"artist_id"`
	ArtistName     string     `json:"artist_name"`
	Role           string     `json:"role"`
	Disambiguation string     `json:"disambiguation"`
}

type ComprehensiveSubmissionInput struct {
	CategoryCode     string                             `json:"category_code"`
	MediaType        string                             `json:"media_type"`
	Title            string                             `json:"title"`
	OriginalTitle    string                             `json:"original_title"`
	Aliases          []string                           `json:"aliases"`
	ReleaseDate      *string                            `json:"release_date"`
	Country          string                             `json:"country"`
	Language         string                             `json:"language"`
	OriginalLanguage string                             `json:"original_language"`
	Summary          string                             `json:"summary"`
	CoverImageURL    string                             `json:"cover_image_url"`
	Tags             []string                           `json:"tags"`
	CatalogMetadata  map[string]interface{}             `json:"catalog_metadata"`
	ExternalIDs      map[string]interface{}             `json:"external_ids"`
	ArtistRelations  []ComprehensiveArtistRelationInput `json:"artist_relations"`
	EditionName      string                             `json:"edition_name"`
	CatalogNumber    string                             `json:"catalog_number"`
	Barcode          string                             `json:"barcode"`
	Publisher        string                             `json:"publisher"`
	PublisherID      *uuid.UUID                         `json:"publisher_id"`
	Packaging        string                             `json:"packaging"`
	EditionDate      *string                            `json:"edition_date"`
	Notes            string                             `json:"notes"`
	Mediums          []ComprehensiveMediumInput         `json:"mediums"`
	Translations     []LocaleTextInput                  `json:"translations"`
}

// SubmitComprehensiveArchive 处理类似 MusicBrainz 的详尽多实体一站式考据录入
func (s *CatalogService) SubmitComprehensiveArchive(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	userID := userIDVal.(uuid.UUID)

	var input ComprehensiveSubmissionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	mt := s.resolveMediaType(input.MediaType, input.Tags, nil)
	if mt == "" || !ontology.IsEnabledMediaType(s.db, mt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请添加形态标签（如电影、专辑、游戏、漫画）以便推断作品形态"})
		return
	}

	var releaseDate *time.Time
	if input.ReleaseDate != nil && *input.ReleaseDate != "" {
		if t, err := time.Parse("2006-01-02", *input.ReleaseDate); err == nil {
			releaseDate = &t
		}
	}

	mergedMetadata := make(map[string]interface{})
	if input.CatalogMetadata != nil {
		for k, v := range input.CatalogMetadata {
			mergedMetadata[k] = v
		}
	}
	if input.ExternalIDs != nil {
		mergedMetadata["external_ids"] = input.ExternalIDs
	}

	catCode := input.CategoryCode
	if catCode == "" {
		catCode = "general"
	}

	work := models.Work{
		CategoryCode:     catCode,
		MediaType:        mt,
		Title:            strings.TrimSpace(input.Title),
		OriginalTitle:    strings.TrimSpace(input.OriginalTitle),
		Aliases:          input.Aliases,
		ReleaseDate:      releaseDate,
		Country:          input.Country,
		Language:         input.Language,
		OriginalLanguage: input.OriginalLanguage,
		Summary:          input.Summary,
		CoverImageURL:    input.CoverImageURL,
		Status:           models.WorkStatusPendingReview,
		CatalogMetadata:  models.JSONB(mergedMetadata),
		CreatedBy:        &userID,
	}
	localeItems := applyWorkLocaleDefaults(&work, input.Translations, input.Language)
	if strings.TrimSpace(work.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title required"})
		return
	}
	if err := validateCoverURL(work.CoverImageURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.db.Create(&work).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": backendi18n.T(c, "catalog.create_work_failed") + err.Error()})
		return
	}
	s.upsertWorkTranslations(work.ID, localeItems)

	// 关联并注入多维标签
	for _, tName := range input.Tags {
		trimmed := strings.TrimSpace(tName)
		if trimmed == "" {
			continue
		}
		var tag models.Tag
		if err := s.db.Where("name = ?", trimmed).First(&tag).Error; err != nil {
			tag = models.Tag{
				Name:      trimmed,
				GroupType: "general",
			}
			_ = s.db.Create(&tag).Error
		}
		if tag.ID > 0 {
			_ = s.db.Exec("INSERT INTO work_tag_relations (work_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING", work.ID, tag.ID).Error
		}
	}

	// 演职人员与关联实体关系录入 — 仅允许关联现有 artist_id，禁止直接填写名称自动创建
	for _, relInput := range input.ArtistRelations {
		if relInput.ArtistID == nil {
			if strings.TrimSpace(relInput.ArtistName) != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.artist_direct_fill_forbidden")})
				return
			}
			continue
		}
		var cnt int64
		s.db.Model(&models.Artist{}).Where("id = ?", *relInput.ArtistID).Count(&cnt)
		if cnt == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.artist_not_found")})
			return
		}
		role := strings.TrimSpace(relInput.Role)
		if role == "" {
			role = "author"
		}
		if !ontology.IsEnabledWorkRole(s.db, strings.ToLower(role)) && strings.ToLower(role) != "creator" && strings.ToLower(role) != "author" {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_role") + role})
			return
		}
		relation := models.WorkArtistRelation{
			WorkID:   work.ID,
			ArtistID: *relInput.ArtistID,
			Role:     role,
		}
		s.db.Create(&relation)
		s.mirrorArtistWorkEdge(*relInput.ArtistID, work.ID, role)
	}

	// 发行版与载体/曲目录入
	if input.EditionName != "" {
		var editionDate *time.Time
		if input.EditionDate != nil && *input.EditionDate != "" {
			if t, err := time.Parse("2006-01-02", *input.EditionDate); err == nil {
				editionDate = &t
			}
		}

		var publisherID *uuid.UUID
		pubName := strings.TrimSpace(input.Publisher)
		if input.PublisherID != nil {
			var cnt int64
			s.db.Model(&models.Artist{}).Where("id = ?", *input.PublisherID).Count(&cnt)
			if cnt == 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.publisher_not_found")})
				return
			}
			publisherID = input.PublisherID
			if pubName == "" {
				var pubArtist models.Artist
				if err := s.db.Where("id = ?", *publisherID).First(&pubArtist).Error; err == nil {
					pubName = pubArtist.Name
				}
			}
		} else if pubName != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.publisher_direct_fill_forbidden")})
			return
		}

		release := models.Release{
			WorkID:           work.ID,
			PublisherID:      publisherID,
			EditionName:      input.EditionName,
			CatalogNumber:    input.CatalogNumber,
			Barcode:          input.Barcode,
			Publisher:        pubName,
			Packaging:        input.Packaging,
			EditionDate:      editionDate,
			UploaderID:       &userID,
			Notes:            input.Notes,
			IsMasterVerified: false,
		}
		if release.Packaging == "" {
			release.Packaging = "jewel_case"
		}

		if err := s.db.Create(&release).Error; err == nil {
			for idx, mInput := range input.Mediums {
				medName := mInput.Name
				if medName == "" {
					medName = fmt.Sprintf("Disc %d", idx+1)
				}
				medFormat := mInput.Format
				if medFormat == "" {
					medFormat = "CD"
				}
				medCat := mInput.MediaCategory
				if medCat == "" {
					medCat = input.MediaType
				}

				medium := models.Medium{
					ReleaseID:     release.ID,
					Position:      idx + 1,
					Name:          medName,
					Format:        medFormat,
					MediaCategory: medCat,
					TrackCount:    len(mInput.Tracks),
				}
				if err := s.db.Create(&medium).Error; err == nil {
					for tIdx, tInput := range mInput.Tracks {
						tTitle := strings.TrimSpace(tInput.Title)
						if tTitle == "" {
							tTitle = fmt.Sprintf("Track %02d", tIdx+1)
						}
						pos := tInput.Position
						if pos <= 0 {
							pos = tIdx + 1
						}
						track := models.Track{
							MediumID:        medium.ID,
							WorkID:          &work.ID,
							Position:        pos,
							Title:           tTitle,
							ArtistCredit:    tInput.ArtistCredit,
							DurationSeconds: tInput.DurationSeconds,
							ISRC:            tInput.ISRC,
						}
						// 自动注册至 FRBR Expression 规范母版层
						canonical := models.CanonicalEntry{
							Title:        tTitle,
							Duration:     tInput.DurationSeconds,
							ISRC:         tInput.ISRC,
							ArtistCredit: tInput.ArtistCredit,
							WorkID:       &work.ID,
						}
						if err := s.db.Create(&canonical).Error; err == nil {
							track.CanonicalEntryID = &canonical.ID
						}
						s.db.Create(&track)
					}
				}
			}
		}
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "媒体编目录入成功",
		"work_id": work.ID,
		"work":    work,
	})
}

// recordRevision 记录实体变更快照与编辑附言
func (s *CatalogService) recordRevision(
	targetType string,
	targetID uuid.UUID,
	editorID *uuid.UUID,
	editType string,
	summary string,
	editNote string,
	sourceURLs []string,
	beforeState map[string]interface{},
	afterState map[string]interface{},
) {
	diff := make(map[string]interface{})
	for k, newV := range afterState {
		oldV, exists := beforeState[k]
		if !exists || fmt.Sprintf("%v", oldV) != fmt.Sprintf("%v", newV) {
			diff[k] = map[string]interface{}{
				"old": oldV,
				"new": newV,
			}
		}
	}
	rev := models.EntityRevision{
		TargetType:  targetType,
		TargetID:    targetID,
		EditorID:    editorID,
		EditType:    editType,
		Summary:     summary,
		EditNote:    editNote,
		SourceURLs:  sourceURLs,
		BeforeState: models.JSONB(beforeState),
		AfterState:  models.JSONB(afterState),
		Diff:        models.JSONB(diff),
		Status:      "applied",
		CreatedAt:   time.Now(),
	}
	_ = s.db.Create(&rev).Error
}

// UpdateWorkForMember 社区成员/编目员编辑作品信息并记录修订快照
func (s *CatalogService) UpdateWorkForMember(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID"})
		return
	}

	var work models.Work
	if err := s.db.Where("id = ?", workID).First(&work).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Work not found"})
		return
	}

	var input struct {
		Title            string                 `json:"title"`
		OriginalTitle    string                 `json:"original_title"`
		CategoryCode     string                 `json:"category_code"`
		MediaType        string                 `json:"media_type"`
		Aliases          []string               `json:"aliases"`
		ReleaseDate      *string                `json:"release_date"`
		BeginDate        string                 `json:"begin_date"`
		EndDate          string                 `json:"end_date"`
		Ended            bool                   `json:"ended"`
		Country          string                 `json:"country"`
		Language         string                 `json:"language"`
		OriginalLanguage string                 `json:"original_language"`
		Summary          string                 `json:"summary"`
		CoverImageURL    string                 `json:"cover_image_url"`
		ContentRating    string                 `json:"content_rating"`
		Status           string                 `json:"status"`
		CatalogMetadata  map[string]interface{} `json:"catalog_metadata"`
		EditNote         string                 `json:"edit_note"`
		SourceURLs       []string               `json:"source_urls"`
		Tags             []string               `json:"tags"`
		TagIDs           []uint                 `json:"tag_ids"`
		Translations     []LocaleTextInput      `json:"translations"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	beforeState := map[string]interface{}{
		"title":             work.Title,
		"original_title":    work.OriginalTitle,
		"category_code":     work.CategoryCode,
		"media_type":        work.MediaType,
		"aliases":           work.Aliases,
		"begin_date":        work.BeginDate,
		"end_date":          work.EndDate,
		"ended":             work.Ended,
		"country":           work.Country,
		"language":          work.Language,
		"original_language": work.OriginalLanguage,
		"summary":           work.Summary,
		"cover_image_url":   work.CoverImageURL,
		"catalog_metadata":  work.CatalogMetadata,
	}

	work.Title = strings.TrimSpace(input.Title)
	work.OriginalTitle = strings.TrimSpace(input.OriginalTitle)
	if input.CategoryCode != "" {
		work.CategoryCode = input.CategoryCode
	}
	if input.Aliases != nil {
		work.Aliases = input.Aliases
	}
	if input.ReleaseDate != nil && *input.ReleaseDate != "" {
		if t, err := time.Parse("2006-01-02", *input.ReleaseDate); err == nil {
			work.ReleaseDate = &t
		}
	}
	work.BeginDate = input.BeginDate
	work.EndDate = input.EndDate
	work.Ended = input.Ended
	work.Country = input.Country
	work.OriginalLanguage = input.OriginalLanguage
	work.Summary = input.Summary
	work.CoverImageURL = input.CoverImageURL
	if input.ContentRating != "" {
		work.ContentRating = input.ContentRating
	}
	if input.Status != "" {
		work.Status = input.Status
	}
	if input.CatalogMetadata != nil {
		work.CatalogMetadata = models.JSONB(input.CatalogMetadata)
	}
	localeItems := applyWorkLocaleDefaults(&work, input.Translations, input.Language)
	if strings.TrimSpace(work.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title required"})
		return
	}
	tagNames := input.Tags
	if len(input.TagIDs) > 0 {
		var byID []models.Tag
		s.db.Where("id IN ?", input.TagIDs).Find(&byID)
		for _, t := range byID {
			tagNames = append(tagNames, t.Name)
		}
	}
	if mt := s.resolveMediaType(input.MediaType, tagNames, nil); mt != "" {
		work.MediaType = mt
	} else if input.MediaType != "" && ontology.IsEnabledMediaType(s.db, input.MediaType) {
		work.MediaType = input.MediaType
	}

	if err := s.db.Save(&work).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.replaceWorkTagsByName(&work, input.Tags)

	afterState := map[string]interface{}{
		"title":             work.Title,
		"original_title":    work.OriginalTitle,
		"category_code":     work.CategoryCode,
		"media_type":        work.MediaType,
		"aliases":           work.Aliases,
		"begin_date":        work.BeginDate,
		"end_date":          work.EndDate,
		"ended":             work.Ended,
		"country":           work.Country,
		"language":          work.Language,
		"original_language": work.OriginalLanguage,
		"summary":           work.Summary,
		"cover_image_url":   work.CoverImageURL,
		"catalog_metadata":  work.CatalogMetadata,
	}

	s.recordRevision("work", work.ID, &userID, "update", "更新作品元数据", input.EditNote, input.SourceURLs, beforeState, afterState)
	s.upsertWorkTranslations(work.ID, localeItems)
	_ = s.db.Preload("Tags").Preload("Translations").First(&work, work.ID).Error
	c.JSON(http.StatusOK, gin.H{"status": "success", "work": work})
}

// UpdateArtistForMember 社区成员/编目员编辑创作者与机构主体
func (s *CatalogService) UpdateArtistForMember(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	artistID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid artist ID"})
		return
	}

	var artist models.Artist
	if err := s.db.Where("id = ?", artistID).First(&artist).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Artist not found"})
		return
	}

	var input struct {
		Name           string                 `json:"name"`
		OriginalName   string                 `json:"original_name"`
		Disambiguation string                 `json:"disambiguation"`
		EntityType     string                 `json:"entity_type"`
		Country        string                 `json:"country"`
		Biography      string                 `json:"biography"`
		Language       string                 `json:"language"`
		BeginDate      string                 `json:"begin_date"`
		EndDate        string                 `json:"end_date"`
		Ended          bool                   `json:"ended"`
		ExternalIDs    map[string]interface{} `json:"external_ids"`
		EditNote       string                 `json:"edit_note"`
		SourceURLs     []string               `json:"source_urls"`
		Translations   []LocaleTextInput      `json:"translations"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	beforeState := map[string]interface{}{
		"name":           artist.Name,
		"original_name":  artist.OriginalName,
		"disambiguation": artist.Disambiguation,
		"entity_type":    artist.EntityType,
		"country":        artist.Country,
		"biography":      artist.Biography,
		"begin_date":     artist.BeginDate,
		"end_date":       artist.EndDate,
		"ended":          artist.Ended,
		"external_ids":   artist.ExternalIDs,
	}

	artist.Name = strings.TrimSpace(input.Name)
	artist.OriginalName = strings.TrimSpace(input.OriginalName)
	artist.Disambiguation = strings.TrimSpace(input.Disambiguation)
	if input.EntityType != "" {
		if !ontology.IsEnabledEntityType(s.db, input.EntityType) {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_entity_type")})
			return
		}
		artist.EntityType = input.EntityType
	}
	artist.Country = input.Country
	artist.Biography = input.Biography
	artist.BeginDate = input.BeginDate
	artist.EndDate = input.EndDate
	artist.Ended = input.Ended
	if input.ExternalIDs != nil {
		artist.ExternalIDs = models.JSONB(input.ExternalIDs)
	}
	items := applyArtistLocaleDefaults(&artist, input.Translations, input.Language)
	if strings.TrimSpace(artist.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
		return
	}

	if err := s.db.Save(&artist).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	afterState := map[string]interface{}{
		"name":           artist.Name,
		"original_name":  artist.OriginalName,
		"disambiguation": artist.Disambiguation,
		"entity_type":    artist.EntityType,
		"country":        artist.Country,
		"biography":      artist.Biography,
		"begin_date":     artist.BeginDate,
		"end_date":       artist.EndDate,
		"ended":          artist.Ended,
		"external_ids":   artist.ExternalIDs,
	}

	s.recordRevision("artist", artist.ID, &userID, "update", "更新创作者/机构主体档案", input.EditNote, input.SourceURLs, beforeState, afterState)
	s.upsertArtistTranslations(artist.ID, items)
	_ = s.db.Preload("Translations").First(&artist, artist.ID).Error
	c.JSON(http.StatusOK, gin.H{"status": "success", "artist": artist})
}

// UpdateReleaseForMember 社区成员/编目员编辑发行版信息
func (s *CatalogService) UpdateReleaseForMember(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	releaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid release ID"})
		return
	}

	var release models.Release
	if err := s.db.Where("id = ?", releaseID).First(&release).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Release not found"})
		return
	}

	var input struct {
		EditionName         string                 `json:"edition_name" binding:"required"`
		CatalogNumber       string                 `json:"catalog_number"`
		Barcode             string                 `json:"barcode"`
		PublisherID         *string                `json:"publisher_id"`
		Packaging           string                 `json:"packaging"`
		EditionDate         *string                `json:"edition_date"`
		Country             string                 `json:"country"`
		Language            string                 `json:"language"`
		DistributionChannel string                 `json:"distribution_channel"`
		CatalogMetadata     map[string]interface{} `json:"catalog_metadata"`
		Notes               string                 `json:"notes"`
		EditNote            string                 `json:"edit_note"`
		SourceURLs          []string               `json:"source_urls"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	beforeState := map[string]interface{}{
		"edition_name":   release.EditionName,
		"catalog_number": release.CatalogNumber,
		"barcode":        release.Barcode,
		"publisher_id":   release.PublisherID,
		"packaging":      release.Packaging,
		"notes":          release.Notes,
	}

	release.EditionName = strings.TrimSpace(input.EditionName)
	release.CatalogNumber = strings.TrimSpace(input.CatalogNumber)
	release.Barcode = strings.TrimSpace(input.Barcode)
	if input.Packaging != "" {
		release.Packaging = input.Packaging
	}
	release.Notes = input.Notes
	if input.PublisherID != nil && *input.PublisherID != "" {
		if pid, err := uuid.Parse(*input.PublisherID); err == nil {
			release.PublisherID = &pid
		}
	} else if input.PublisherID != nil && *input.PublisherID == "" {
		release.PublisherID = nil
	}
	if input.EditionDate != nil && *input.EditionDate != "" {
		if t, err := time.Parse("2006-01-02", *input.EditionDate); err == nil {
			release.EditionDate = &t
		}
	}
	release.Country = strings.TrimSpace(input.Country)
	release.Language = strings.TrimSpace(input.Language)
	if input.DistributionChannel != "" {
		ch := ontology.NormalizeDistributionChannel(input.DistributionChannel)
		if ch == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid distribution_channel"})
			return
		}
		release.DistributionChannel = ch
	}
	if input.CatalogMetadata != nil {
		release.CatalogMetadata = models.JSONB(input.CatalogMetadata)
	}

	if err := s.db.Save(&release).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	afterState := map[string]interface{}{
		"edition_name":   release.EditionName,
		"catalog_number": release.CatalogNumber,
		"barcode":        release.Barcode,
		"publisher_id":   release.PublisherID,
		"packaging":      release.Packaging,
		"notes":          release.Notes,
	}

	s.recordRevision("release", release.ID, &userID, "update", "更新发行版信息", input.EditNote, input.SourceURLs, beforeState, afterState)
	c.JSON(http.StatusOK, gin.H{"status": "success", "release": release})
}

// ListEntityRevisions 获取实体的版本修订历史时间线
func (s *CatalogService) ListEntityRevisions(c *gin.Context) {
	targetType := c.Query("target_type")
	targetIDStr := c.Query("target_id")
	if targetType == "" || targetIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target_type and target_id are required"})
		return
	}
	targetID, err := uuid.Parse(targetIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid target_id UUID"})
		return
	}

	var revisions []models.EntityRevision
	s.db.Preload("Editor").Where("target_type = ? AND target_id = ?", targetType, targetID).
		Order("created_at desc").
		Find(&revisions)

	c.JSON(http.StatusOK, gin.H{"items": revisions, "total": len(revisions)})
}

// MergeEntities 实体合并工作流 (Merge Source Entity into Target Entity)
func (s *CatalogService) MergeEntities(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var input struct {
		TargetType string   `json:"target_type" binding:"required"` // 'artist', 'work', 'release'
		SourceID   string   `json:"source_id" binding:"required"`
		TargetID   string   `json:"target_id" binding:"required"`
		MergeNote  string   `json:"merge_note" binding:"required"`
		SourceURLs []string `json:"source_urls"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	srcUUID, err1 := uuid.Parse(input.SourceID)
	tgtUUID, err2 := uuid.Parse(input.TargetID)
	if err1 != nil || err2 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid UUID format"})
		return
	}
	if srcUUID == tgtUUID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot merge entity into itself"})
		return
	}

	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	switch input.TargetType {
	case "artist":
		var srcArtist, tgtArtist models.Artist
		if err := tx.Where("id = ?", srcUUID).First(&srcArtist).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "Source artist not found"})
			return
		}
		if err := tx.Where("id = ?", tgtUUID).First(&tgtArtist).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "Target artist not found"})
			return
		}

		// 1. 迁移演职员关系
		tx.Model(&models.WorkArtistRelation{}).Where("artist_id = ?", srcUUID).Update("artist_id", tgtUUID)
		// 2. 迁移图谱关系
		tx.Model(&models.EntityRelationship{}).Where("source_type = 'artist' AND source_id = ?", srcUUID).Update("source_id", tgtUUID)
		tx.Model(&models.EntityRelationship{}).Where("target_type = 'artist' AND target_id = ?", srcUUID).Update("target_id", tgtUUID)
		// 3. 迁移作为发行商的 releases
		tx.Model(&models.Release{}).Where("publisher_id = ?", srcUUID).Update("publisher_id", tgtUUID)

		// 4. 记录合并快照
		rev := models.EntityRevision{
			TargetType:  "artist",
			TargetID:    tgtUUID,
			EditorID:    &userID,
			EditType:    "merge",
			Summary:     fmt.Sprintf("合并实体: 将 [%s] (%s) 合并至当前主体", srcArtist.Name, srcArtist.ID.String()[:8]),
			EditNote:    input.MergeNote,
			SourceURLs:  input.SourceURLs,
			BeforeState: models.JSONB(map[string]interface{}{"merged_source": srcArtist}),
			AfterState:  models.JSONB(map[string]interface{}{"target_artist": tgtArtist}),
			Status:      "applied",
			CreatedAt:   time.Now(),
		}
		tx.Create(&rev)
		// 5. 删除/归档源主体
		tx.Where("id = ?", srcUUID).Delete(&models.Artist{})

	case "work":
		var srcWork, tgtWork models.Work
		if err := tx.Where("id = ?", srcUUID).First(&srcWork).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "Source work not found"})
			return
		}
		if err := tx.Where("id = ?", tgtUUID).First(&tgtWork).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "Target work not found"})
			return
		}

		// 1. 迁移发行版
		tx.Model(&models.Release{}).Where("work_id = ?", srcUUID).Update("work_id", tgtUUID)
		// 2. 迁移母版条目
		tx.Model(&models.CanonicalEntry{}).Where("work_id = ?", srcUUID).Update("work_id", tgtUUID)
		// 3. 迁移图谱关系
		tx.Model(&models.EntityRelationship{}).Where("source_type = 'work' AND source_id = ?", srcUUID).Update("source_id", tgtUUID)
		tx.Model(&models.EntityRelationship{}).Where("target_type = 'work' AND target_id = ?", srcUUID).Update("target_id", tgtUUID)
		// 4. 迁移演职员
		tx.Model(&models.WorkArtistRelation{}).Where("work_id = ?", srcUUID).Update("work_id", tgtUUID)
		// 5. 迁移讨论区
		tx.Model(&models.DiscussionTopic{}).Where("work_id = ?", srcUUID).Update("work_id", tgtUUID)

		// 6. 继承别名
		mergedAliases := append(tgtWork.Aliases, srcWork.Title)
		for _, a := range srcWork.Aliases {
			mergedAliases = append(mergedAliases, a)
		}
		tx.Model(&tgtWork).Update("aliases", mergedAliases)

		// 7. 记录合并快照
		rev := models.EntityRevision{
			TargetType:  "work",
			TargetID:    tgtUUID,
			EditorID:    &userID,
			EditType:    "merge",
			Summary:     fmt.Sprintf("合并作品: 将 [%s] (%s) 合并至当前作品", srcWork.Title, srcWork.ID.String()[:8]),
			EditNote:    input.MergeNote,
			SourceURLs:  input.SourceURLs,
			BeforeState: models.JSONB(map[string]interface{}{"merged_source": srcWork}),
			AfterState:  models.JSONB(map[string]interface{}{"target_work": tgtWork}),
			Status:      "applied",
			CreatedAt:   time.Now(),
		}
		tx.Create(&rev)
		tx.Where("id = ?", srcUUID).Delete(&models.Work{})

	case "franchise":
		var srcFr, tgtFr models.Franchise
		if err := tx.Where("id = ?", srcUUID).First(&srcFr).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "Source franchise not found"})
			return
		}
		if err := tx.Where("id = ?", tgtUUID).First(&tgtFr).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "Target franchise not found"})
			return
		}
		tx.Model(&models.EntityRelationship{}).Where("source_type = 'franchise' AND source_id = ?", srcUUID).Update("source_id", tgtUUID)
		tx.Model(&models.EntityRelationship{}).Where("target_type = 'franchise' AND target_id = ?", srcUUID).Update("target_id", tgtUUID)
		mergedAliases := append(tgtFr.Aliases, srcFr.Title)
		mergedAliases = append(mergedAliases, srcFr.Aliases...)
		tx.Model(&tgtFr).Update("aliases", mergedAliases)
		rev := models.EntityRevision{
			TargetType:  "franchise",
			TargetID:    tgtUUID,
			EditorID:    &userID,
			EditType:    "merge",
			Summary:     fmt.Sprintf("合并企划: 将 [%s] 合并至当前企划", srcFr.Title),
			EditNote:    input.MergeNote,
			SourceURLs:  input.SourceURLs,
			BeforeState: models.JSONB(map[string]interface{}{"merged_source": srcFr}),
			AfterState:  models.JSONB(map[string]interface{}{"target_franchise": tgtFr}),
			Status:      "applied",
			CreatedAt:   time.Now(),
		}
		tx.Create(&rev)
		tx.Where("id = ?", srcUUID).Delete(&models.Franchise{})

	default:
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported target_type for merge: " + input.TargetType})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "实体合并成功完成",
		"target_id": tgtUUID,
	})
}


