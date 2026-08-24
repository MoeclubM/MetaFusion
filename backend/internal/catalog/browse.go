package catalog

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/metafusion/metafusion-app/internal/models"
)

// parseInc 将 inc 参数按 + 或 , 或空格分割，转为集合
func parseInc(raw string) map[string]bool {
	m := map[string]bool{}
	if raw == "" {
		return m
	}
	raw = strings.ReplaceAll(raw, "+", " ")
	raw = strings.ReplaceAll(raw, ",", " ")
	for _, part := range strings.Fields(raw) {
		p := strings.ToLower(strings.TrimSpace(part))
		if p != "" {
			m[p] = true
		}
	}
	return m
}

// BrowseWorks 按 artist/tag/category 枚举作品，类似 MusicBrainz browse/recording
// GET /api/v1/browse/works?artist=<uuid>&tag=<name>&page=&page_size=&inc=
func (s *CatalogService) BrowseWorks(c *gin.Context) {
	artistIDStr := c.Query("artist")
	tag := c.Query("tag")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "24"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 24
	}
	offset := (page - 1) * pageSize
	query := s.db.Model(&models.Work{})

	// 关联过滤
	if artistIDStr != "" {
		if aid, err := uuid.Parse(artistIDStr); err == nil {
			query = query.Where("id IN (SELECT work_id FROM work_artist_relations WHERE artist_id = ?)", aid)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid artist id", "code": "BAD_REQUEST"})
			return
		}
	}
	if tag != "" {
		query = query.Where("id IN (SELECT work_id FROM work_tag_relations wtr JOIN tags t ON wtr.tag_id = t.id WHERE t.name = ?)", tag)
	}
	// 可见性：仅已发布（与 ListWorks 一致）
	userRole, _ := c.Get("role")
	roleStr, _ := userRole.(string)
	isAdmin := roleStr == "admin" || roleStr == "archivist"
	if !isAdmin {
		query = query.Where("status IN (?, ?) OR status IS NULL OR status = ''", models.WorkStatusPublished, models.WorkStatusCompleted)
	}

	// inc 展开
	inc := parseInc(c.Query("inc"))
	withArtists := inc["artists"] || inc["artist-rels"] || inc["artist_rels"]
	withTags := inc["tags"]

	qCount := query
	var total int64
	qCount.Count(&total)

	// 预加载按 inc 决定，避免匿名用户被拖慢
	if withArtists || withTags {
		if withArtists {
			query = query.Preload("ArtistRelations.Artist")
		}
		if withTags {
			query = query.Preload("Tags")
		}
	}

	query = query.Preload("Translations")

	var works []models.Work
	if err := query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&works).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 若需要返回更多关联，可在响应中附加，但为保持兼容仍以分页信封返回
	c.JSON(http.StatusOK, gin.H{
		"items":     works,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"inc":       c.Query("inc"),
	})
	_ = pq.Array(nil)
}

// BrowseReleases 按 artist/work 枚举发行版
// GET /api/v1/browse/releases?artist=<uuid>&work=<uuid>&page=&page_size=&inc=
func (s *CatalogService) BrowseReleases(c *gin.Context) {
	artistIDStr := c.Query("artist")
	workIDStr := c.Query("work")
	if workIDStr == "" {
		workIDStr = c.Query("work_id")
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	uid := currentUserID(c)
	query := applyReleaseVisibility(s.db.Model(&models.Release{}), uid)

	if workIDStr != "" {
		if wid, err := uuid.Parse(workIDStr); err == nil {
			query = applyWorkReleaseFilter(query, wid)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid work id"})
			return
		}
	}
	if artistIDStr != "" {
		if aid, err := uuid.Parse(artistIDStr); err == nil {
			// 通过 work_artist_relations 关联到 work 再到 release，或直接按 publisher_id
			query = query.Where("work_id IN (SELECT work_id FROM work_artist_relations WHERE artist_id = ?) OR publisher_id = ?", aid, aid)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid artist id"})
			return
		}
	}

	inc := parseInc(c.Query("inc"))
	var total int64
	query.Count(&total)

	// inc 控制预加载
	if inc["work"] || inc["works"] {
		query = query.Preload("Work").Preload("Work.Translations").Preload("Work.Tags").Preload("Work.ArtistRelations").Preload("Work.ArtistRelations.Artist")
	}
	if inc["mediums"] || inc["medium"] {
		query = query.Preload("Mediums")
	}
	if inc["artist"] || inc["artists"] || inc["publisher"] {
		query = query.Preload("PublisherEntity").Preload("PublisherEntity.Translations")
	}

	var releases []models.Release
	if err := query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&releases).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items":     releases,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"inc":       c.Query("inc"),
	})
}

// BrowseArtists 按 work/collaborator 枚举创作者
// GET /api/v1/browse/artists?work=<uuid>&collaborator=<uuid>&page=&page_size=
func (s *CatalogService) BrowseArtists(c *gin.Context) {
	workIDStr := c.Query("work")
	collabIDStr := c.Query("collaborator")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	query := s.db.Model(&models.Artist{})

	if workIDStr != "" {
		if wid, err := uuid.Parse(workIDStr); err == nil {
			query = query.Where("id IN (SELECT artist_id FROM work_artist_relations WHERE work_id = ?)", wid)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid work id"})
			return
		}
	}
	if collabIDStr != "" {
		if cid, err := uuid.Parse(collabIDStr); err == nil {
			// 共同参与同一作品的创作者
			query = query.Where("id IN (SELECT DISTINCT war2.artist_id FROM work_artist_relations war1 JOIN work_artist_relations war2 ON war1.work_id = war2.work_id WHERE war1.artist_id = ? AND war2.artist_id != ?)", cid, cid)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid collaborator id"})
			return
		}
	}

	// 简单搜索补充
	q := c.Query("q")
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("name ILIKE ? OR original_name ILIKE ?", like, like)
	}
	entityType := c.Query("entity_type")
	if entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}

	var total int64
	query.Count(&total)

	var artists []models.Artist
	if err := query.Preload("Translations").Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&artists).Error; err != nil {
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
