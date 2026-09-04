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

// coverAspectValues 是允许手动固定的封面显示比例；空串/未知值一律归一为 ""（自动）。
var coverAspectValues = map[string]bool{"1:1": true, "2:3": true, "3:4": true, "4:3": true}

func NormalizeCoverAspect(raw string) string {
	v := strings.TrimSpace(raw)
	if coverAspectValues[v] {
		return v
	}
	return ""
}

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

// GetTaxonomy 获取全量虚拟货架、多维标签、媒介大类、演职角色与物理规格词表。
// tag_groups / tags 只含 Work 侧面相（形态/手法/流派/专题/通用）；规格不是标签，见 formats/packagings。
// 旧分类法 categories 已废弃（taxonomy 现用 tags + shelves），不再查询与返回。
func (s *CatalogService) GetTaxonomy(c *gin.Context) {
	var shelves []models.VirtualShelf
	_ = s.db.Order("sort_order asc").Find(&shelves).Error

	var allTags []models.Tag
	_ = s.db.Where("group_type != ?", models.TagGroupTopic).Order("id asc").Find(&allTags).Error

	tagGroups := make(map[string][]models.Tag)
	workTags := make([]models.Tag, 0, len(allTags))
	for _, t := range allTags {
		if models.TagGroupIsCarrier(t.GroupType) || !models.TagGroupIsWorkFacet(t.GroupType) {
			continue
		}
		tagGroups[t.GroupType] = append(tagGroups[t.GroupType], t)
		workTags = append(workTags, t)
	}

	locale := backendi18n.LocaleFromContext(c)

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

	packagings := ontology.StandardPackagings(locale)
	formats := ontology.StandardMediumFormats(locale)
	mediaCategories := ontology.StandardMediaCategories(locale)

	languages := []map[string]string{
		{"code": "zh", "name": "中文 (Chinese)"},
		{"code": "ja", "name": "日本語 (Japanese)"},
		{"code": "en", "name": "English"},
		{"code": "ko", "name": "한국어 (Korean)"},
		{"code": "fr", "name": "Français (French)"},
		{"code": "de", "name": "Deutsch (German)"},
	}

	c.JSON(http.StatusOK, gin.H{
		"shelves":          rootShelves,
		"tag_groups":       tagGroups,
		"tags":             workTags,
		"media_types":      mediaTypes,
		"media_categories": mediaCategories,
		"entity_types":     entityTypes,
		"roles":            roles,
		"packagings":       packagings,
		"packaging_types":  packagings,
		"formats":          formats,
		"medium_formats":   formats,
		"languages":        languages,
	})
}

// ListTags 获取标签列表
func (s *CatalogService) ListTags(c *gin.Context) {
	groupType := c.Query("group_type")

	query := s.db.Model(&models.Tag{})
	if groupType != "" {
		query = query.Where("group_type = ?", groupType)
	} else {
		query = query.Where("group_type NOT IN ?", []string{models.TagGroupTopic, models.TagGroupSpec})
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
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 24
	}
	shelfSlug := c.Query("shelf")
	customShelfID := c.Query("custom_shelf")
	tagsParam := c.Query("tags")
	tagParam := c.Query("tag")
	tagMatch := strings.ToLower(c.DefaultQuery("tag_match", "all"))
	searchQuery := c.Query("q")
	sortBy := c.DefaultQuery("sort", "created_at")
	status := c.Query("status")
	language := c.Query("language")
	if language == "" {
		language = c.Query("locale")
	}

	offset := (page - 1) * pageSize
	query := s.db.Model(&models.Work{}).Preload("Tags").Preload("Translations")

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

	// 自定义推荐分组过滤（与 shelf 互斥，只按 query_tags / exclude_tags）
	if customShelfID != "" {
		if cid, err := uuid.Parse(customShelfID); err == nil {
			var cs models.UserCustomShelf
			if err := s.db.Where("id = ?", cid).First(&cs).Error; err == nil {
				uidCS := currentUserID(c)
				roleCS, _ := c.Get("role")
				isOwnerCS := uidCS != nil && cs.OwnerID == *uidCS
				isAdminCS := roleCS == "admin" || roleCS == "archivist"
				if cs.IsPublic || isOwnerCS || isAdminCS {
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
		tagList := make([]string, 0)
		for _, tName := range strings.Split(tagsParam, ",") {
			trimmed := strings.TrimSpace(tName)
			if trimmed != "" {
				tagList = append(tagList, trimmed)
			}
		}
		if len(tagList) > 0 {
			if tagMatch == "any" {
				query = query.Where("id IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ANY(?))", pq.Array(tagList))
			} else {
				for _, tName := range tagList {
					query = query.Where("id IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ?)", tName)
				}
			}
		}
	}

	if language != "" {
		language = models.NormalizeLocale(language)
		if models.ValidLocales[language] {
			query = query.Where("language = ?", language)
		}
	}
	if searchQuery != "" {
		query = query.Where("title ILIKE ? OR original_title ILIKE ? OR ? = ANY(aliases)", "%"+searchQuery+"%", "%"+searchQuery+"%", searchQuery)
	}

	switch sortBy {
	case "views":
		query = query.Order("view_count desc")
	case "release_date":
		query = query.Order("release_date desc")
	case "title":
		query = query.Order("title asc")
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
	// 署名单轨化：artist_relations 由 entity_relationships 图边读时投影
	AttachWorkArtistRelations(s.db, works)

	c.JSON(http.StatusOK, gin.H{
		"items":     works,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}
// applyWorkReleaseFilter 筛选与指定 Work 关联的所有 Release：
// 1. releases.work_id = workID（母体作品直接发行版）
// 2. 载体曲目关联（Track / CanonicalEntry 归属于该 workID）
// 3. 实体关系直连（EntityRelationship source/target 为 release 与 work）
// 4. 汇编作品/盒装合集关系（Work 被收录于某 compilation/anthology work，该 compilation work 旗下的 release）
func applyWorkReleaseFilter(db *gorm.DB, workID uuid.UUID) *gorm.DB {
	return db.Where(`
		work_id = ? 
		OR id IN (
			SELECT m.release_id FROM mediums m 
			JOIN tracks t ON t.medium_id = m.id 
			WHERE t.work_id = ? 
			   OR t.canonical_entry_id IN (SELECT ce.id FROM canonical_entries ce WHERE ce.work_id = ?)
		)
		OR id IN (
			SELECT er.source_id FROM entity_relationships er 
			WHERE er.source_type = 'release' AND er.target_type = 'work' AND er.target_id = ?
		)
		OR id IN (
			SELECT er.target_id FROM entity_relationships er 
			WHERE er.target_type = 'release' AND er.source_type = 'work' AND er.source_id = ?
		)
		OR work_id IN (
			SELECT er.target_id FROM entity_relationships er 
			WHERE er.source_type = 'work' AND er.source_id = ? 
			  AND er.relationship_type IN ('included_in', 'part_of', 'anthology_of')
		)
		OR work_id IN (
			SELECT er.source_id FROM entity_relationships er 
			WHERE er.target_type = 'work' AND er.target_id = ? 
			  AND er.relationship_type IN ('includes_work', 'compilation_of', 'anthology_of')
		)
	`, workID, workID, workID, workID, workID, workID, workID)
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
	q := s.db.Preload("Tags").
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
	// 署名单轨化：artist_relations 由 entity_relationships 图边读时投影（保持旧 JSON 形状）
	work.ArtistRelations = ProjectWorkArtistRelations(s.db, work.ID)

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
		rq := applyReleaseVisibility(s.db.Model(&models.Release{}), uid)
		rq = applyWorkReleaseFilter(rq, work.ID).Order("edition_date asc, created_at asc").Limit(50)
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
	locale := backendi18n.LocaleFromContext(c)
	m["external_links"] = s.buildExternalLinks(locale, "work", work.ExternalIDs)
	c.JSON(http.StatusOK, m)
}

// ListReleases 按作品分页列出发行版，仅返回已审核通过的版本
func (s *CatalogService) ListReleases(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "24"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 24
	}
	workIDStr := c.Query("work_id")
	q := c.Query("q")
	sortBy := c.DefaultQuery("sort", "created_at")

	offset := (page - 1) * pageSize
	uid := currentUserID(c)
	query := applyReleaseVisibility(s.db.Model(&models.Release{}).Preload("Uploader"), uid)

	if workIDStr != "" {
		if workID, err := uuid.Parse(workIDStr); err == nil {
			query = applyWorkReleaseFilter(query, workID)
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
	if err := query.
		Preload("PublisherEntity").
		Preload("PublisherEntity.Translations").
		Preload("Work").
		Preload("Work.Translations").
		Preload("Work.Tags").
		Preload("Mediums").
		Offset(offset).
		Limit(pageSize).
		Find(&releases).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 署名单轨化：Work.ArtistRelations 由图边读时投影
	workPtrs := make([]*models.Work, 0, len(releases))
	for i := range releases {
		if releases[i].Work != nil {
			workPtrs = append(workPtrs, releases[i].Work)
		}
	}
	AttachWorkArtistRelationsPtr(s.db, workPtrs)

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
		Preload("Work.Translations").
		Preload("Work.Tags").
		Preload("PublisherEntity").
		Preload("PublisherEntity.Translations").
		Preload("Uploader").
		Preload("Mediums", func(db *gorm.DB) *gorm.DB { return db.Order("position asc") }).
		Preload("Mediums.Tracks", func(db *gorm.DB) *gorm.DB { return db.Order("position asc") }).
		Preload("Mediums.Tracks.Work").
		Preload("Mediums.Tracks.Work.Translations").
		Preload("Mediums.Tracks.Work.Tags").
		Preload("Mediums.Tracks.CanonicalEntry").
		Preload("Mediums.Tracks.CanonicalEntry.Work").
		Preload("Mediums.Tracks.CanonicalEntry.Work.Translations").
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

	// 聚合多作品合集/大盒装关联的所有 Works
	workIDMap := make(map[uuid.UUID]bool)
	if release.WorkID != uuid.Nil {
		workIDMap[release.WorkID] = true
	}
	for _, med := range release.Mediums {
		for _, tr := range med.Tracks {
			if tr.WorkID != nil && *tr.WorkID != uuid.Nil {
				workIDMap[*tr.WorkID] = true
			}
			if tr.CanonicalEntry != nil && tr.CanonicalEntry.WorkID != nil && *tr.CanonicalEntry.WorkID != uuid.Nil {
				workIDMap[*tr.CanonicalEntry.WorkID] = true
			}
		}
	}
	var relWorkIDs []uuid.UUID
	s.db.Raw(`
		SELECT DISTINCT source_id FROM entity_relationships WHERE source_type = 'work' AND (
			(target_type = 'release' AND target_id = ?) 
			OR (target_type = 'work' AND target_id = ? AND relationship_type IN ('included_in', 'part_of', 'anthology_of'))
		)
		UNION
		SELECT DISTINCT target_id FROM entity_relationships WHERE target_type = 'work' AND (
			(source_type = 'release' AND source_id = ?)
			OR (source_type = 'work' AND source_id = ? AND relationship_type IN ('includes_work', 'compilation_of', 'anthology_of'))
		)
	`, release.ID, release.WorkID, release.ID, release.WorkID).Pluck("source_id", &relWorkIDs)
	for _, rwid := range relWorkIDs {
		if rwid != uuid.Nil {
			workIDMap[rwid] = true
		}
	}

	var allWorkIDs []uuid.UUID
	for wid := range workIDMap {
		allWorkIDs = append(allWorkIDs, wid)
	}

	var includedWorks []models.Work
	if len(allWorkIDs) > 0 {
		_ = s.db.Preload("Translations").Preload("Tags").Where("id IN ?", allWorkIDs).Order("release_date asc, created_at asc").Find(&includedWorks).Error
	}

	// 署名单轨化：Release.Work.ArtistRelations 由图边读时投影（需在 JSON 序列化前填充）
	if release.Work != nil {
		wptrs := []*models.Work{release.Work}
		AttachWorkArtistRelationsPtr(s.db, wptrs)
	}

	inc := parseInc(c.Query("inc"))
	b, _ := json.Marshal(release)
	var m map[string]interface{}
	_ = json.Unmarshal(b, &m)
	m["included_works"] = includedWorks

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
	locale := backendi18n.LocaleFromContext(c)
	m["external_links"] = s.buildExternalLinks(locale, "release", release.ExternalIDs)
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
		Preload("Tracks", func(db *gorm.DB) *gorm.DB { return db.Order("position asc") }).
		Preload("Tracks.Work").
		Preload("Tracks.Work.Translations").
		Preload("Tracks.Work.Tags").
		Preload("Tracks.CanonicalEntry").
		Preload("Tracks.CanonicalEntry.Work").
		Preload("Tracks.CanonicalEntry.Work.Translations").
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
	_ = s.db.Where("id = ?", medium.ReleaseID).First(&release).Error

	c.JSON(http.StatusOK, gin.H{
		"medium":  medium,
		"release": release,
	})
}

// GraphNode 关系图谱节点
type GraphNode struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	OriginalName   string `json:"original_name,omitempty"`
	Type           string `json:"type"`     // 'work', 'artist', 'release', 'medium', 'franchise', 'canonical_entry'
	Category       string `json:"category"` // 'main_work', 'artist', 'soundtrack', 'adaptation', 'release', etc.
	Role           string `json:"role,omitempty"`
	Level          int    `json:"level"`
	CoverImageURL  string `json:"cover_image_url,omitempty"`
	Disambiguation string `json:"disambiguation,omitempty"`
	Country        string `json:"country,omitempty"`
	Status         string `json:"status,omitempty"`
}

// GraphLink 关系图谱连线
type GraphLink struct {
	ID             string       `json:"id,omitempty"`
	Source         string       `json:"source"`
	Target         string       `json:"target"`
	SourceType     string       `json:"source_type,omitempty"`
	TargetType     string       `json:"target_type,omitempty"`
	Type           string       `json:"type"`
	Label          string       `json:"label"`
	Qualifier      string       `json:"qualifier,omitempty"`
	Color          string       `json:"color,omitempty"`
	Attributes     models.JSONB `json:"attributes,omitempty"`
	BeginDate      string       `json:"begin_date,omitempty"`
	EndDate        string       `json:"end_date,omitempty"`
	Ended          bool         `json:"ended,omitempty"`
	IsHierarchical bool         `json:"is_hierarchical,omitempty"`
}

// GetWorkGraph 获取作品的高级关系图谱网络
func (s *CatalogService) GetWorkGraph(c *gin.Context) {
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID"})
		return
	}

	var work models.Work
	if err := s.db.Where("id = ?", workID).First(&work).Error; err != nil {
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
			ID:            work.ID.String(),
			Name:          work.Title,
			OriginalName:  work.OriginalTitle,
			Type:          "work",
			Category:      "main_work",
			Level:         1,
			CoverImageURL: work.CoverImageURL,
			Country:       work.Country,
			Status:        work.Status,
		},
	}
	nodeSet := map[string]bool{work.ID.String(): true}
	links := []GraphLink{}

	// 署名单轨化：演职节点/连线直接取自 entity_relationships 署名图边（agent_work 域 + 导入器兼容边）
	creditEdges, err := artistWorkEdges(s.db, []uuid.UUID{workID}, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	artistMap := loadArtistsForEdges(s.db, creditEdges)
	creditEdgeIDs := make([]uuid.UUID, 0, len(creditEdges))
	for _, e := range creditEdges {
		creditEdgeIDs = append(creditEdgeIDs, e.ID)
		artist := artistMap[e.SourceID]
		if artist == nil {
			continue
		}
		if !nodeSet[artist.ID.String()] {
			nodeSet[artist.ID.String()] = true
			nodes = append(nodes, GraphNode{
				ID:             artist.ID.String(),
				Name:           artist.Name,
				OriginalName:   artist.OriginalName,
				Type:           "artist",
				Category:       artist.EntityType,
				Role:           EdgeDisplayRole(e),
				Disambiguation: artist.Disambiguation,
				Country:        artist.Country,
				Level:          0,
			})
		}
		roleLabel := EdgeDisplayRole(e)
		color := "amber"
		if rt, ok := relTypeMap[e.RelationshipType]; ok {
			roleLabel = rt.LocalizedReverseLabel(locale)
			color = rt.Color
		}
		links = append(links, GraphLink{
			ID:         e.ID.String(),
			Source:     artist.ID.String(),
			Target:     work.ID.String(),
			SourceType: "artist",
			TargetType: "work",
			Type:       e.RelationshipType,
			Label:      roleLabel,
			Qualifier:  e.Qualifier,
			Color:      color,
			Attributes: e.Attributes,
			BeginDate:  e.BeginDate,
			EndDate:    e.EndDate,
			Ended:      e.Ended,
		})
	}

	// 跨实体语义边（署名边已单独渲染，避免重复连线）
	crossQuery := s.db.Where("source_id = ? OR target_id = ?", workID, workID)
	if len(creditEdgeIDs) > 0 {
		crossQuery = crossQuery.Where("id NOT IN ?", creditEdgeIDs)
	}
	var crossRels []models.EntityRelationship
	crossQuery.Find(&crossRels)

	for _, cr := range crossRels {
		otherID := cr.TargetID
		otherType := cr.TargetType
		dir := "forward"
		if cr.TargetID == workID {
			otherID = cr.SourceID
			otherType = cr.SourceType
			dir = "reverse"
		}

		if !nodeSet[otherID.String()] {
			nodeSet[otherID.String()] = true
			meta, _ := ontology.LookupNodeMeta(s.db, otherType, otherID)
			nodes = append(nodes, GraphNode{
				ID:             otherID.String(),
				Name:           meta.Name,
				OriginalName:   meta.OriginalName,
				Type:           otherType,
				Category:       cr.RelationshipType,
				CoverImageURL:  meta.CoverImageURL,
				Disambiguation: meta.Disambiguation,
				Country:        meta.Country,
				Status:         meta.Status,
				Level:          2,
			})
		}

		relLabel := cr.RelationshipType
		color := "sky"
		isHier := false
		if rt, ok := relTypeMap[cr.RelationshipType]; ok {
			color = rt.Color
			isHier = rt.IsHierarchical
			if dir == "forward" {
				relLabel = rt.LocalizedForwardLabel(locale)
			} else {
				relLabel = rt.LocalizedReverseLabel(locale)
			}
		}

		links = append(links, GraphLink{
			ID:             cr.ID.String(),
			Source:         cr.SourceID.String(),
			Target:         cr.TargetID.String(),
			SourceType:     cr.SourceType,
			TargetType:     cr.TargetType,
			Type:           cr.RelationshipType,
			Label:          relLabel,
			Qualifier:      cr.Qualifier,
			Color:          color,
			Attributes:     cr.Attributes,
			BeginDate:      cr.BeginDate,
			EndDate:        cr.EndDate,
			Ended:          cr.Ended,
			IsHierarchical: isHier,
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

// 与 ListWorks/BrowseWorks 的状态口径一致：published/completed 公开，
// 未设置状态的视为可见；登录用户额外可见自己创建的（pending_review/draft 等）
func applyWorkVisibility(q *gorm.DB, uid *uuid.UUID) *gorm.DB {
	if uid != nil {
		return q.Where("(status IN (?, ?) OR status IS NULL OR status = '' OR created_by = ?)",
			models.WorkStatusPublished, models.WorkStatusCompleted, uid)
	}
	return q.Where("status IN (?, ?) OR status IS NULL OR status = ''",
		models.WorkStatusPublished, models.WorkStatusCompleted)
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
		ID             *uuid.UUID             `json:"id"`
		Name           string                 `json:"name"`
		OriginalName   string                 `json:"original_name"`
		Disambiguation string                 `json:"disambiguation"`
		EntityType     string                 `json:"entity_type"`
		Country        string                 `json:"country"`
		Biography      string                 `json:"biography"`
		Language       string                 `json:"language"`
		ExternalIDs    map[string]interface{} `json:"external_ids"`
		Attributes     map[string]interface{} `json:"attributes"`
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
	attrs := models.JSONB{}
	if input.Attributes != nil {
		attrs = models.JSONB(input.Attributes)
	}
	artistID := uuid.New()
	if input.ID != nil && *input.ID != uuid.Nil {
		artistID = *input.ID
	}
	artist := models.Artist{
		ID:             artistID,
		Name:           strings.TrimSpace(input.Name),
		OriginalName:   strings.TrimSpace(input.OriginalName),
		Disambiguation: strings.TrimSpace(input.Disambiguation),
		EntityType:     input.EntityType,
		Country:        strings.TrimSpace(input.Country),
		Biography:      input.Biography,
		Language:       input.Language,
		ExternalIDs:    ext,
		Attributes:     attrs,
		CreatedBy:      uid,
	}
	items := applyArtistLocaleDefaults(&artist, input.Translations, input.Language)
	if strings.TrimSpace(artist.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
		return
	}
	// 查重防重机制：若同名同类型创作者已存在，复用现有实体并合并补充信息
	var existingArtist models.Artist
	trimmedName := strings.TrimSpace(artist.Name)
	if err := s.db.Where("LOWER(TRIM(name)) = LOWER(TRIM(?)) AND entity_type = ?", trimmedName, artist.EntityType).First(&existingArtist).Error; err == nil {
		s.upsertArtistTranslations(existingArtist.ID, items)
		_ = s.db.Preload("Translations").First(&existingArtist, existingArtist.ID).Error
		c.JSON(http.StatusOK, existingArtist)
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
	var releaseDate *time.Time
	if input.ReleaseDate != nil && *input.ReleaseDate != "" {
		if t, err := time.Parse("2006-01-02", *input.ReleaseDate); err == nil {
			releaseDate = &t
		}
	}
	workStatus := models.WorkStatusPendingReview
	roleStr, _ := c.Get("role")
	if roleStr == "admin" || roleStr == "archivist" {
		workStatus = models.WorkStatusPublished
	}

	extIDs := models.JSONB{}
	if input.ExternalIDs != nil {
		extIDs = models.JSONB(input.ExternalIDs)
	}

	attrs := models.JSONB{}
	if input.Attributes != nil {
		attrs = models.JSONB(input.Attributes)
	}

	work := models.Work{
		ID:               input.ID,
		Title:            strings.TrimSpace(input.Title),
		OriginalTitle:    strings.TrimSpace(input.OriginalTitle),
		Aliases:          input.Aliases,
		ReleaseDate:      releaseDate,
		Country:          strings.TrimSpace(input.Country),
		Language:         input.Language,
		OriginalLanguage: input.OriginalLanguage,
		Summary:          input.Summary,
		CoverImageURL:    input.CoverImageURL,
		CoverAspect:      NormalizeCoverAspect(input.CoverAspect),
		ContentRating:    input.ContentRating,
		Status:           workStatus,
		ExternalIDs:      extIDs,
		Attributes:       attrs,
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

	// 查重防重机制：若同名且同载体形态（封面比例）作品已存在，复用现有实体并合并补充信息
	var existingWork models.Work
	trimmedTitle := strings.TrimSpace(work.Title)
	dupQuery := s.db.Where("LOWER(TRIM(title)) = LOWER(TRIM(?))", trimmedTitle)
	if work.OriginalLanguage != "" {
		dupQuery = dupQuery.Where("original_language = ? OR original_language = ''", work.OriginalLanguage)
	}
	if work.CoverAspect != "" {
		dupQuery = dupQuery.Where("cover_aspect = ?", work.CoverAspect)
	}
	if err := dupQuery.First(&existingWork).Error; err == nil {
		tagNames := input.Tags
		if len(input.TagIDs) > 0 {
			var byID []models.Tag
			s.db.Where("id IN ?", input.TagIDs).Find(&byID)
			for _, t := range byID {
				tagNames = append(tagNames, t.Name)
			}
		}
		if len(tagNames) > 0 {
			s.replaceWorkTagsByName(&existingWork, tagNames)
		}
		s.upsertWorkTranslations(existingWork.ID, localeItems)

		// 检查封面是否需要更新（现有封面为空或为旧占位图且新封面有效）
		if work.CoverImageURL != "" && (existingWork.CoverImageURL == "" || strings.Contains(existingWork.CoverImageURL, "unsplash.com")) {
			s.db.Model(&models.Work{}).Where("id = ?", existingWork.ID).Updates(map[string]interface{}{
				"cover_image_url": work.CoverImageURL,
				"cover_aspect":    work.CoverAspect,
			})
			existingWork.CoverImageURL = work.CoverImageURL
			existingWork.CoverAspect = work.CoverAspect
		}

		_ = s.db.Preload("Tags").Preload("Translations").First(&existingWork, existingWork.ID).Error
		c.JSON(http.StatusOK, existingWork)
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

	// 记录创建修订历史
	s.recordRevision("work", work.ID, uid, "create", "创建作品元数据", "通过官方API创建作品初始档案", nil, nil, map[string]interface{}{
		"title":             work.Title,
		"original_title":    work.OriginalTitle,
		"aliases":           work.Aliases,
		"country":           work.Country,
		"language":          work.Language,
		"summary":           work.Summary,
		"cover_image_url":   work.CoverImageURL,
		"cover_aspect":      work.CoverAspect,
		"catalog_metadata":  work.CatalogMetadata,
	})

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
	isMasterVerified := false
	roleStr, _ := c.Get("role")
	if roleStr == "admin" || roleStr == "archivist" {
		isMasterVerified = true
	}
	extIDs := models.JSONB{}
	if input.ExternalIDs != nil {
		extIDs = models.JSONB(input.ExternalIDs)
	}
	attrs := models.JSONB{}
	if input.Attributes != nil {
		attrs = models.JSONB(input.Attributes)
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
		ExternalIDs:         extIDs,
		Attributes:          attrs,
		CatalogMetadata:     meta,
		UploaderID:          uid,
		IsMasterVerified:    isMasterVerified,
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
		WorkID           *uuid.UUID `json:"work_id"`
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
	targetWorkID := input.WorkID
	if targetWorkID == nil && rel.WorkID != uuid.Nil {
		targetWorkID = &rel.WorkID
	}
	track := models.Track{
		MediumID:         input.MediumID,
		WorkID:           targetWorkID,
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
		if !ontology.IsEnabledWorkRole(s.db, strings.ToLower(strings.TrimSpace(r.Role))) {
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
	// 旧表清理（无害）：work_artist_relations 已退役，仅删除遗留行
	if err := s.db.Where("work_id = ?", workID).Delete(&models.WorkArtistRelation{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 单轨化：只写 entity_relationships 署名图边（校验 + 幂等 + 删除重建语义）
	rows := make([]WorkRelationInput, 0, len(input.Relations))
	for _, r := range input.Relations {
		rows = append(rows, WorkRelationInput{ArtistID: r.ArtistID, Role: r.Role})
	}
	if err := SyncWorkRelationEdges(s.db, workID, rows); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "success", "count": len(input.Relations)})
}

// ListArtists 搜索与列表创作者与机构
func (s *CatalogService) ListArtists(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "24"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 24
	}
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
	if err := query.Preload("Translations").Order("name asc").Offset(offset).Limit(pageSize).Find(&artists).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     artists,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

type ConnectedEntityItem struct {
	EntityID         string                `json:"entity_id"`
	EntityName       string                `json:"entity_name"`
	OriginalName     string                `json:"original_name,omitempty"`
	OriginalLanguage string                `json:"original_language,omitempty"`
	Translations     []ontology.LocaleText `json:"translations,omitempty"`
	EntityType       string                `json:"entity_type"`
	Country          string                `json:"country,omitempty"`
	RelationshipType string                `json:"relationship_type"`
	Qualifier        string                `json:"qualifier,omitempty"`
	RelationshipName string                `json:"relationship_name"`
	Direction        string                `json:"direction"` // 'forward' | 'reverse'
	Label            string                `json:"label"`
	BeginDate        string                `json:"begin_date,omitempty"`
	EndDate          string                `json:"end_date,omitempty"`
	Ended            bool                  `json:"ended"`
	IsCurrent        bool                  `json:"is_current"`
	DateSpan         string                `json:"date_span,omitempty"`
	Attributes       models.JSONB          `json:"attributes"`
	Color            string                `json:"color"`
	Icon             string                `json:"icon"`
}

type ArtistWorkItem struct {
	models.Work
	Role string `json:"role"`
}

type ArtistDetailResponse struct {
	Artist            models.Artist           `json:"artist"`
	Works             []ArtistWorkItem        `json:"works"`
	Releases          []models.Release        `json:"releases"`
	ConnectedEntities []ConnectedEntityItem   `json:"connected_entities"`
	ExternalLinks     []models.ExternalLinkItem `json:"external_links"`
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

	// 署名单轨化：参演作品与角色直接取自 entity_relationships 署名图边
	creditEdges, _ := artistWorkEdges(s.db, nil, &artistID)
	workIDs := make([]uuid.UUID, 0, len(creditEdges))
	roleMap := make(map[uuid.UUID]string)
	for _, e := range creditEdges {
		workIDs = append(workIDs, e.TargetID)
		roleMap[e.TargetID] = EdgeDisplayRole(e)
	}

	works := make([]models.Work, 0)
	if len(workIDs) > 0 {
		wQ := s.db.Preload("Tags").Preload("Translations").Where("id IN ?", workIDs)
		wQ = applyWorkVisibility(wQ, currentUserID(c))
		if err := wQ.Find(&works).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	// 其余 artist<->work 图谱边（署名域之外的自定义关系类型），并入作者枢纽列表
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
		if _, isCredit := roleMap[wid]; isCredit || seenWorks[wid] {
			if isCredit {
				seenWorks[wid] = true
			}
			continue
		}
		var w models.Work
		wQ := applyWorkVisibility(s.db.Preload("Tags").Preload("Translations"), currentUserID(c)).Where("id = ?", wid)
		if err := wQ.First(&w).Error; err == nil {
			works = append(works, w)
			seenWorks[w.ID] = true
			roleMap[w.ID] = EdgeDisplayRole(er)
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
	pubQ := s.db.
		Preload("Work").
		Preload("Work.Translations").
		Preload("Work.Tags").
		Preload("Mediums").
		Preload("PublisherEntity").
		Preload("PublisherEntity.Translations").
		Where("(publisher_id = ? OR (publisher_id IS NULL AND publisher ILIKE ?))", artist.ID, "%"+artist.Name+"%")
	pubQ = applyReleaseVisibility(pubQ, uidPub)
	pubQ.Order("edition_date desc, created_at desc").Find(&releases)
	// 署名单轨化：Work.ArtistRelations 由图边读时投影
	pubWorkPtrs := make([]*models.Work, 0, len(releases))
	for i := range releases {
		if releases[i].Work != nil {
			pubWorkPtrs = append(pubWorkPtrs, releases[i].Work)
		}
	}
	AttachWorkArtistRelationsPtr(s.db, pubWorkPtrs)

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
		var otherType string
		var otherID uuid.UUID
		var dir string
		if er.SourceType == "artist" && er.SourceID == artist.ID {
			otherType, otherID, dir = er.TargetType, er.TargetID, "forward"
		} else {
			otherType, otherID, dir = er.SourceType, er.SourceID, "reverse"
		}
		pack, ok := ontology.LookupDisplay(s.db, otherType, otherID)
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
			EntityName:       pack.Name,
			OriginalName:     pack.OriginalName,
			OriginalLanguage: pack.OriginalLanguage,
			Translations:     pack.Translations,
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
		ExternalLinks:     s.buildExternalLinks(locale, "artist", artist.ExternalIDs),
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
			ID:             artist.ID.String(),
			Name:           artist.Name,
			OriginalName:   artist.OriginalName,
			Type:           "artist",
			Category:       artist.EntityType,
			Disambiguation: artist.Disambiguation,
			Country:        artist.Country,
			Level:          0,
		},
	}
	nodeSet := map[string]bool{artist.ID.String(): true}
	links := []GraphLink{}

	// 1. 作品演职制作关联 — 署名单轨化：直接取 entity_relationships 署名图边
	creditEdges, _ := artistWorkEdges(s.db, nil, &artistID)
	creditEdgeIDs := make([]uuid.UUID, 0, len(creditEdges))
	for _, e := range creditEdges {
		creditEdgeIDs = append(creditEdgeIDs, e.ID)
		var work models.Work
		if err := s.db.Where("id = ?", e.TargetID).First(&work).Error; err == nil {
			if !nodeSet[work.ID.String()] {
				nodeSet[work.ID.String()] = true
				nodes = append(nodes, GraphNode{
					ID:            work.ID.String(),
					Name:          work.Title,
					OriginalName:  work.OriginalTitle,
					Type:          "work",
					Category:      "main_work",
					Role:          EdgeDisplayRole(e),
					CoverImageURL: work.CoverImageURL,
					Country:       work.Country,
					Status:        work.Status,
					Level:         1,
				})
			}
			roleLabel := EdgeDisplayRole(e)
			color := "amber"
			if rt, ok := relTypeMap[e.RelationshipType]; ok {
				roleLabel = rt.LocalizedForwardLabel(locale)
				color = rt.Color
			}
			links = append(links, GraphLink{
				ID:         e.ID.String(),
				Source:     artistID.String(),
				Target:     work.ID.String(),
				SourceType: "artist",
				TargetType: "work",
				Type:       e.RelationshipType,
				Label:      roleLabel,
				Qualifier:  e.Qualifier,
				Color:      color,
				Attributes: e.Attributes,
				BeginDate:  e.BeginDate,
				EndDate:    e.EndDate,
				Ended:      e.Ended,
			})
		}
	}

	// 2. 主体间长效关联 (EntityRelationship: 签约、合作、隶属、代理、母子；署名边已单独渲染)
	entQuery := s.db.Where("(source_type = 'artist' AND source_id = ?) OR (target_type = 'artist' AND target_id = ?)", artistID, artistID)
	if len(creditEdgeIDs) > 0 {
		entQuery = entQuery.Where("id NOT IN ?", creditEdgeIDs)
	}
	var entRels []models.EntityRelationship
	entQuery.Find(&entRels)

	for _, er := range entRels {
		var otherType string
		var otherID uuid.UUID
		var dir string
		if er.SourceType == "artist" && er.SourceID == artistID {
			otherType, otherID, dir = er.TargetType, er.TargetID, "forward"
		} else {
			otherType, otherID, dir = er.SourceType, er.SourceID, "reverse"
		}

		if !nodeSet[otherID.String()] {
			nodeSet[otherID.String()] = true
			meta, _ := ontology.LookupNodeMeta(s.db, otherType, otherID)
			nodes = append(nodes, GraphNode{
				ID:             otherID.String(),
				Name:           meta.Name,
				OriginalName:   meta.OriginalName,
				Type:           otherType,
				Category:       er.RelationshipType,
				CoverImageURL:  meta.CoverImageURL,
				Disambiguation: meta.Disambiguation,
				Country:        meta.Country,
				Status:         meta.Status,
				Level:          1,
			})
		}

		label := er.RelationshipType
		color := "sky"
		isHier := false
		if rt, hit := relTypeMap[er.RelationshipType]; hit {
			color = rt.Color
			isHier = rt.IsHierarchical
			if dir == "forward" {
				label = rt.LocalizedForwardLabel(locale)
			} else {
				label = rt.LocalizedReverseLabel(locale)
			}
		}

		links = append(links, GraphLink{
			ID:             er.ID.String(),
			Source:         er.SourceID.String(),
			Target:         er.TargetID.String(),
			SourceType:     er.SourceType,
			TargetType:     er.TargetType,
			Type:           er.RelationshipType,
			Label:          label,
			Qualifier:      er.Qualifier,
			Color:          color,
			Attributes:     er.Attributes,
			BeginDate:      er.BeginDate,
			EndDate:        er.EndDate,
			Ended:          er.Ended,
			IsHierarchical: isHier,
		})
	}

	// 3. 如果是机构/厂牌/工作室，同时关联其出版的发行版
	if artist.EntityType == models.EntityTypePublisher || artist.EntityType == models.EntityTypeStudio {
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
					Country:  rel.Country,
					Level:    1,
				})
			}
			links = append(links, GraphLink{
				Source:     artist.ID.String(),
				Target:     rel.ID.String(),
				SourceType: "artist",
				TargetType: "release",
				Type:       "published",
				Label:      "出版发行",
				Color:      "cyan",
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"nodes": nodes,
		"links": links,
	})
}

// GetReleaseGraph 获取发行版的关系图谱网络
func (s *CatalogService) GetReleaseGraph(c *gin.Context) {
	releaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid release ID"})
		return
	}

	var rel models.Release
	if err := s.db.
		Preload("Work").
		Preload("PublisherEntity").
		Preload("Mediums.Tracks.Work").
		Preload("Mediums.Tracks.CanonicalEntry.Work").
		Where("id = ?", releaseID).
		First(&rel).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Release not found"})
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
			ID:       rel.ID.String(),
			Name:     rel.EditionName,
			Type:     "release",
			Category: "release",
			Level:    1,
			Country:  rel.Country,
		},
	}
	nodeSet := map[string]bool{rel.ID.String(): true}
	links := []GraphLink{}

	// 1. 所属主作品 Work
	if rel.Work != nil {
		if !nodeSet[rel.Work.ID.String()] {
			nodeSet[rel.Work.ID.String()] = true
			nodes = append(nodes, GraphNode{
				ID:            rel.Work.ID.String(),
				Name:          rel.Work.Title,
				OriginalName:  rel.Work.OriginalTitle,
				Type:          "work",
				Category:      "main_work",
				Level:         0,
				CoverImageURL: rel.Work.CoverImageURL,
				Country:       rel.Work.Country,
				Status:        rel.Work.Status,
			})
		}
		links = append(links, GraphLink{
			Source:     rel.Work.ID.String(),
			Target:     rel.ID.String(),
			SourceType: "work",
			TargetType: "release",
			Type:       "released_as",
			Label:      "发行实体",
			Color:      "cyan",
		})
	}

	// 1.1 分碟/曲目所属作品（多作品合集支持）
	for _, med := range rel.Mediums {
		for _, tr := range med.Tracks {
			targetWork := tr.Work
			if targetWork == nil && tr.CanonicalEntry != nil {
				targetWork = tr.CanonicalEntry.Work
			}
			if targetWork != nil && !nodeSet[targetWork.ID.String()] {
				nodeSet[targetWork.ID.String()] = true
				nodes = append(nodes, GraphNode{
					ID:            targetWork.ID.String(),
					Name:          targetWork.Title,
					OriginalName:  targetWork.OriginalTitle,
					Type:          "work",
					Category:      "included_work",
					Level:         0,
					CoverImageURL: targetWork.CoverImageURL,
					Country:       targetWork.Country,
					Status:        targetWork.Status,
				})
				links = append(links, GraphLink{
					Source:     targetWork.ID.String(),
					Target:     rel.ID.String(),
					SourceType: "work",
					TargetType: "release",
					Type:       "included_in",
					Label:      "收录作品",
					Color:      "cyan",
				})
			}
		}
	}

	// 2. 出版发行主体 PublisherEntity
	if rel.PublisherEntity != nil {
		if !nodeSet[rel.PublisherEntity.ID.String()] {
			nodeSet[rel.PublisherEntity.ID.String()] = true
			nodes = append(nodes, GraphNode{
				ID:             rel.PublisherEntity.ID.String(),
				Name:           rel.PublisherEntity.Name,
				OriginalName:   rel.PublisherEntity.OriginalName,
				Type:           "artist",
				Category:       rel.PublisherEntity.EntityType,
				Disambiguation: rel.PublisherEntity.Disambiguation,
				Country:        rel.PublisherEntity.Country,
				Level:          2,
			})
		}
		links = append(links, GraphLink{
			Source:     rel.PublisherEntity.ID.String(),
			Target:     rel.ID.String(),
			SourceType: "artist",
			TargetType: "release",
			Type:       "publisher_of",
			Label:      "出版发行",
			Color:      "emerald",
		})
	}

	// 3. 载体介质与音轨 (Mediums)
	for _, med := range rel.Mediums {
		if !nodeSet[med.ID.String()] {
			nodeSet[med.ID.String()] = true
			nodes = append(nodes, GraphNode{
				ID:       med.ID.String(),
				Name:     med.Name,
				Type:     "medium",
				Category: med.MediaCategory,
				Role:     med.Format,
				Level:    2,
			})
		}
		links = append(links, GraphLink{
			Source:     rel.ID.String(),
			Target:     med.ID.String(),
			SourceType: "release",
			TargetType: "medium",
			Type:       "contains_disc",
			Label:      med.Format,
			Color:      "purple",
		})
	}

	// 4. 跨实体语义边 (EntityRelationship)
	var crossRels []models.EntityRelationship
	s.db.Where("source_id = ? OR target_id = ?", releaseID, releaseID).Find(&crossRels)

	for _, cr := range crossRels {
		otherID := cr.TargetID
		otherType := cr.TargetType
		dir := "forward"
		if cr.TargetID == releaseID {
			otherID = cr.SourceID
			otherType = cr.SourceType
			dir = "reverse"
		}

		if !nodeSet[otherID.String()] {
			nodeSet[otherID.String()] = true
			meta, _ := ontology.LookupNodeMeta(s.db, otherType, otherID)
			nodes = append(nodes, GraphNode{
				ID:             otherID.String(),
				Name:           meta.Name,
				OriginalName:   meta.OriginalName,
				Type:           otherType,
				Category:       cr.RelationshipType,
				CoverImageURL:  meta.CoverImageURL,
				Disambiguation: meta.Disambiguation,
				Country:        meta.Country,
				Status:         meta.Status,
				Level:          2,
			})
		}

		relLabel := cr.RelationshipType
		color := "sky"
		isHier := false
		if rt, ok := relTypeMap[cr.RelationshipType]; ok {
			color = rt.Color
			isHier = rt.IsHierarchical
			if dir == "forward" {
				relLabel = rt.LocalizedForwardLabel(locale)
			} else {
				relLabel = rt.LocalizedReverseLabel(locale)
			}
		}

		links = append(links, GraphLink{
			ID:             cr.ID.String(),
			Source:         cr.SourceID.String(),
			Target:         cr.TargetID.String(),
			SourceType:     cr.SourceType,
			TargetType:     cr.TargetType,
			Type:           cr.RelationshipType,
			Label:          relLabel,
			Qualifier:      cr.Qualifier,
			Color:          color,
			Attributes:     cr.Attributes,
			BeginDate:      cr.BeginDate,
			EndDate:        cr.EndDate,
			Ended:          cr.Ended,
			IsHierarchical: isHier,
		})
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

// ListExternalDatabases 获取当前系统启用的外部数据库定义（公开接口）
func (s *CatalogService) ListExternalDatabases(c *gin.Context) {
	category := c.Query("category")
	locale := backendi18n.LocaleFromContext(c)

	query := s.db.Model(&models.ExternalDatabaseDefinition{}).Where("is_enabled = ?", true)
	if category != "" && category != "all" {
		query = query.Where("category = ? OR category = 'all'", category)
	}

	var items []models.ExternalDatabaseDefinition
	if err := query.Order("sort_order asc, code asc").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type OutItem struct {
		models.ExternalDatabaseDefinition
		DisplayName string `json:"display_name"`
	}

	out := make([]OutItem, 0, len(items))
	for _, it := range items {
		out = append(out, OutItem{
			ExternalDatabaseDefinition: it,
			DisplayName:                it.LocalizedName(locale),
		})
	}

	c.JSON(http.StatusOK, gin.H{"items": out, "total": len(out)})
}

// buildExternalLinks maps raw external_ids to rich ExternalLinkItem array based on registered definitions
func (s *CatalogService) buildExternalLinks(locale string, category string, externalIDs models.JSONB) []models.ExternalLinkItem {
	if externalIDs == nil || len(externalIDs) == 0 {
		return []models.ExternalLinkItem{}
	}

	var defs []models.ExternalDatabaseDefinition
	_ = s.db.Where("is_enabled = ?", true).Order("sort_order asc, code asc").Find(&defs).Error

	defMap := make(map[string]models.ExternalDatabaseDefinition, len(defs))
	for _, d := range defs {
		defMap[d.Code] = d
	}

	out := make([]models.ExternalLinkItem, 0, len(externalIDs))
	for _, d := range defs {
		if rawVal, exists := externalIDs[d.Code]; exists {
			valStr := strings.TrimSpace(fmt.Sprintf("%v", rawVal))
			if valStr != "" && valStr != "<nil>" {
				linkURL := d.BuildURL(valStr)
				out = append(out, models.ExternalLinkItem{
					Code:     d.Code,
					Name:     d.LocalizedName(locale),
					URL:      linkURL,
					ID:       valStr,
					Icon:     d.Icon,
					IconURL:  d.IconURL,
					Category: d.Category,
				})
			}
		}
	}

	for k, rawVal := range externalIDs {
		if _, known := defMap[k]; !known {
			valStr := strings.TrimSpace(fmt.Sprintf("%v", rawVal))
			if valStr != "" && valStr != "<nil>" {
				linkURL := valStr
				if !strings.HasPrefix(valStr, "http://") && !strings.HasPrefix(valStr, "https://") {
					linkURL = ""
				}
				out = append(out, models.ExternalLinkItem{
					Code:     k,
					Name:     k,
					URL:      linkURL,
					ID:       valStr,
					Icon:     "Globe",
					Category: "other",
				})
			}
		}
	}

	return out
}

type CreateWorkInput struct {
	ID               uuid.UUID              `json:"id"`
	Title            string                 `json:"title"`
	OriginalTitle    string                 `json:"original_title"`
	Aliases          []string               `json:"aliases"`
	ReleaseDate      *string                `json:"release_date"`
	Country          string                 `json:"country"`
	Language         string                 `json:"language"`
	OriginalLanguage string                 `json:"original_language"`
	Summary          string                 `json:"summary"`
	CoverImageURL    string                 `json:"cover_image_url"`
	CoverAspect      string                 `json:"cover_aspect"`
	ContentRating    string                 `json:"content_rating"`
	ExternalIDs      map[string]interface{} `json:"external_ids"`
	Attributes       map[string]interface{} `json:"attributes"`
	CatalogMetadata  map[string]interface{} `json:"catalog_metadata"`
	TagIDs           []uint                 `json:"tag_ids"`
	Tags             []string               `json:"tags"`
	Translations     []LocaleTextInput      `json:"translations"`
}

type CreateReleaseInput struct {
	WorkID              uuid.UUID              `json:"work_id" binding:"required"`
	PublisherID         *uuid.UUID             `json:"publisher_id"`
	EditionName         string                 `json:"edition_name" binding:"required"`
	CatalogNumber       string                 `json:"catalog_number"`
	Barcode             string                 `json:"barcode"`
	Publisher           string                 `json:"publisher"`
	Packaging           string                 `json:"packaging"`
	EditionDate         *string                `json:"edition_date"`
	Country             string                 `json:"country"`
	Language            string                 `json:"language"`
	DistributionChannel string                 `json:"distribution_channel"`
	ExternalIDs         map[string]interface{} `json:"external_ids"`
	Attributes          map[string]interface{} `json:"attributes"`
	CatalogMetadata     map[string]interface{} `json:"catalog_metadata"`
	Notes               string                 `json:"notes"`
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
	WorkID          *uuid.UUID `json:"work_id"`
	Position        int        `json:"position"`
	Title           string     `json:"title"`
	ArtistCredit    string     `json:"artist_credit"`
	DurationSeconds int        `json:"duration_seconds"`
	ISRC            string     `json:"isrc"`
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

	work := models.Work{
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

	// 查重防重机制：若同名且同载体形态（封面比例）作品已存在，复用现有实体
	var existingWork models.Work
	trimmedTitle := strings.TrimSpace(work.Title)
	dupQuery := s.db.Where("LOWER(TRIM(title)) = LOWER(TRIM(?))", trimmedTitle)
	if work.OriginalLanguage != "" {
		dupQuery = dupQuery.Where("original_language = ? OR original_language = ''", work.OriginalLanguage)
	}
	if work.CoverAspect != "" {
		dupQuery = dupQuery.Where("cover_aspect = ?", work.CoverAspect)
	}
	if err := dupQuery.First(&existingWork).Error; err == nil {
		work = existingWork
		if len(input.Tags) > 0 {
			s.replaceWorkTagsByName(&work, input.Tags)
		}
		s.upsertWorkTranslations(work.ID, localeItems)
		if input.CoverImageURL != "" && (work.CoverImageURL == "" || strings.Contains(work.CoverImageURL, "unsplash.com")) {
			s.db.Model(&models.Work{}).Where("id = ?", work.ID).Updates(map[string]interface{}{
				"cover_image_url": input.CoverImageURL,
			})
			work.CoverImageURL = input.CoverImageURL
		}
	} else {
		if err := s.db.Create(&work).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": backendi18n.T(c, "catalog.create_work_failed") + err.Error()})
			return
		}
		s.upsertWorkTranslations(work.ID, localeItems)
		s.replaceWorkTagsByName(&work, input.Tags)
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
		// 单轨化：只写 entity_relationships 署名图边，不再落 work_artist_relations 行。
		// "creator" 是历史别名，映射到 author 边保留署名可见性；无法解析的 role 静默跳过（与旧 mirror 行为一致）。
		edgeRole := strings.ToLower(role)
		if edgeRole == "creator" {
			edgeRole = "author"
		}
		_ = UpsertArtistWorkEdge(s.db, *relInput.ArtistID, work.ID, edgeRole)
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
					medCat = "music"
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
						tWorkID := tInput.WorkID
						if tWorkID == nil {
							tWorkID = &work.ID
						}
						track := models.Track{
							MediumID:        medium.ID,
							WorkID:          tWorkID,
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
							WorkID:       tWorkID,
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
		CoverAspect      string                 `json:"cover_aspect"`
		ContentRating    string                 `json:"content_rating"`
		Status           string                 `json:"status"`
		ExternalIDs      map[string]interface{} `json:"external_ids"`
		Attributes       map[string]interface{} `json:"attributes"`
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
		"aliases":           work.Aliases,
		"begin_date":        work.BeginDate,
		"end_date":          work.EndDate,
		"ended":             work.Ended,
		"country":           work.Country,
		"language":          work.Language,
		"original_language": work.OriginalLanguage,
		"summary":           work.Summary,
		"cover_image_url":   work.CoverImageURL,
		"cover_aspect":      work.CoverAspect,
		"external_ids":      work.ExternalIDs,
		"attributes":        work.Attributes,
		"catalog_metadata":  work.CatalogMetadata,
	}

	work.Title = strings.TrimSpace(input.Title)
	work.OriginalTitle = strings.TrimSpace(input.OriginalTitle)
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
	work.CoverAspect = NormalizeCoverAspect(input.CoverAspect)
	if input.ContentRating != "" {
		work.ContentRating = input.ContentRating
	}
	if input.Status != "" {
		work.Status = input.Status
	}
	if input.ExternalIDs != nil {
		work.ExternalIDs = models.JSONB(input.ExternalIDs)
	}
	if input.Attributes != nil {
		work.Attributes = models.JSONB(input.Attributes)
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
	if err := s.db.Save(&work).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.replaceWorkTagsByName(&work, tagNames)

	afterState := map[string]interface{}{
		"title":             work.Title,
		"original_title":    work.OriginalTitle,
		"aliases":           work.Aliases,
		"begin_date":        work.BeginDate,
		"end_date":          work.EndDate,
		"ended":             work.Ended,
		"country":           work.Country,
		"language":          work.Language,
		"original_language": work.OriginalLanguage,
		"summary":           work.Summary,
		"cover_image_url":   work.CoverImageURL,
		"cover_aspect":      work.CoverAspect,
		"external_ids":      work.ExternalIDs,
		"attributes":        work.Attributes,
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
		Attributes     map[string]interface{} `json:"attributes"`
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
		"attributes":     artist.Attributes,
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
	if input.Attributes != nil {
		artist.Attributes = models.JSONB(input.Attributes)
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
		"attributes":     artist.Attributes,
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
		ExternalIDs         map[string]interface{} `json:"external_ids"`
		Attributes          map[string]interface{} `json:"attributes"`
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
		"external_ids":   release.ExternalIDs,
		"attributes":     release.Attributes,
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
	if input.ExternalIDs != nil {
		release.ExternalIDs = models.JSONB(input.ExternalIDs)
	}
	if input.Attributes != nil {
		release.Attributes = models.JSONB(input.Attributes)
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
		"external_ids":   release.ExternalIDs,
		"attributes":     release.Attributes,
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


