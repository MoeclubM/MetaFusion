package catalog

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
)

type MediumListItem struct {
	models.Medium
	Release *models.Release `json:"release,omitempty"`
}

// ListMediumsPublic lists visible carrier rows independently of release pages.
func (s *CatalogService) ListMediumsPublic(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "24"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 24
	}
	query := applyReleaseVisibility(
		s.db.Model(&models.Medium{}).Joins("JOIN releases ON releases.id = mediums.release_id"),
		currentUserID(c),
	)
	if raw := c.Query("release_id"); raw != "" {
		releaseID, err := uuid.Parse(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_release_id")})
			return
		}
		query = query.Where("mediums.release_id = ?", releaseID)
	}
	if raw := c.Query("work_id"); raw != "" {
		workID, err := uuid.Parse(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_work_id_q")})
			return
		}
		query = query.Where("releases.work_id = ?", workID)
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		like := "%" + q + "%"
		query = query.Where(`
			mediums.name ILIKE ? OR mediums.number ILIKE ? OR mediums.format ILIKE ? OR
			mediums.media_category ILIKE ? OR releases.edition_name ILIKE ? OR
			releases.catalog_number ILIKE ? OR releases.barcode ILIKE ?`,
			like, like, like, like, like, like, like,
		)
	}
	if format := strings.TrimSpace(c.Query("format")); format != "" {
		query = query.Where("mediums.format = ?", format)
	}
	if category := strings.TrimSpace(c.Query("media_category")); category != "" {
		query = query.Where("mediums.media_category = ?", category)
	}
	if role := strings.TrimSpace(c.Query("role")); role != "" {
		query = query.Where("mediums.role = ?", role)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var mediums []models.Medium
	if err := query.Order("mediums.position ASC, mediums.created_at DESC, mediums.id ASC").
		Offset((page - 1) * size).Limit(size).Find(&mediums).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	releaseIDs := make([]uuid.UUID, 0, len(mediums))
	seen := map[uuid.UUID]bool{}
	for _, medium := range mediums {
		if !seen[medium.ReleaseID] {
			releaseIDs = append(releaseIDs, medium.ReleaseID)
			seen[medium.ReleaseID] = true
		}
	}
	releases := make([]models.Release, 0, len(releaseIDs))
	if len(releaseIDs) > 0 {
		releaseQuery := applyReleaseVisibility(s.db.Model(&models.Release{}), currentUserID(c)).
			Preload("Work").Preload("Work.Translations")
		if err := releaseQuery.Where("releases.id IN ?", releaseIDs).Find(&releases).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	releaseMap := make(map[uuid.UUID]*models.Release, len(releases))
	locale := backendi18n.LocaleFromContext(c)
	for i := range releases {
		localizeRelease(&releases[i], locale)
		releaseMap[releases[i].ID] = &releases[i]
	}
	items := make([]MediumListItem, 0, len(mediums))
	for i := range mediums {
		localizeMedium(&mediums[i], locale)
		items = append(items, MediumListItem{Medium: mediums[i], Release: releaseMap[mediums[i].ReleaseID]})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}
