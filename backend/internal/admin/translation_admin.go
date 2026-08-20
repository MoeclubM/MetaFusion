package admin

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
)

func isValidLocale(s string) bool { return models.ValidLocales[s] }

// ---- Works ----

func (s *AdminService) ListWorkTranslations(c *gin.Context) {
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid work id"})
		return
	}
	var rows []models.WorkTranslation
	_ = s.db.Where("work_id = ?", workID).Order("locale asc").Find(&rows).Error
	c.JSON(http.StatusOK, gin.H{"items": rows, "total": len(rows)})
}

func (s *AdminService) UpsertWorkTranslations(c *gin.Context) {
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid work id"})
		return
	}
	var input struct {
		Translations []models.WorkTranslation `json:"translations" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, tr := range input.Translations {
		loc := strings.TrimSpace(tr.Locale)
		if !isValidLocale(loc) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid locale: " + loc})
			return
		}
		row := models.WorkTranslation{WorkID: workID, Locale: loc, Title: strings.TrimSpace(tr.Title), Summary: tr.Summary}
		_ = s.db.Save(&row).Error
	}
	writeAudit(s.db, c, "translation.work.upsert", "work", workID.String(), map[string]interface{}{"count": len(input.Translations)})
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// ---- Topics ----

func (s *AdminService) ListTopicTranslations(c *gin.Context) {
	topicID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid topic id"})
		return
	}
	var rows []models.TopicTranslation
	_ = s.db.Where("topic_id = ?", topicID).Order("locale asc").Find(&rows).Error
	c.JSON(http.StatusOK, gin.H{"items": rows, "total": len(rows)})
}

func (s *AdminService) UpsertTopicTranslations(c *gin.Context) {
	topicID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid topic id"})
		return
	}
	var input struct {
		Translations []models.TopicTranslation `json:"translations" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, tr := range input.Translations {
		loc := strings.TrimSpace(tr.Locale)
		if !isValidLocale(loc) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid locale: " + loc})
			return
		}
		row := models.TopicTranslation{TopicID: topicID, Locale: loc, Title: strings.TrimSpace(tr.Title), Content: tr.Content}
		_ = s.db.Save(&row).Error
	}
	writeAudit(s.db, c, "translation.topic.upsert", "topic", topicID.String(), map[string]interface{}{"count": len(input.Translations)})
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// ---- Tags ----

func (s *AdminService) ListTagTranslations(c *gin.Context) {
	var parsed uint
	if _, err := parseUint(c.Param("id"), &parsed); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag id"})
		return
	}
	var rows []models.TagTranslation
	_ = s.db.Where("tag_id = ?", parsed).Order("locale asc").Find(&rows).Error
	c.JSON(http.StatusOK, gin.H{"items": rows, "total": len(rows)})
}

func (s *AdminService) UpsertTagTranslations(c *gin.Context) {
	var parsed uint
	if _, err := parseUint(c.Param("id"), &parsed); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag id"})
		return
	}
	var input struct {
		Translations []models.TagTranslation `json:"translations" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, tr := range input.Translations {
		loc := strings.TrimSpace(tr.Locale)
		if !isValidLocale(loc) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid locale: " + loc})
			return
		}
		name := strings.TrimSpace(tr.Name)
		if name == "" {
			continue
		}
		row := models.TagTranslation{TagID: parsed, Locale: loc, Name: name}
		_ = s.db.Save(&row).Error
	}
	writeAudit(s.db, c, "translation.tag.upsert", "tag", c.Param("id"), map[string]interface{}{"count": len(input.Translations)})
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func parseUint(s string, out *uint) (uint, error) {
	val, err := strconv.ParseUint(s, 10, 32)
	if err != nil {
		return 0, err
	}
	*out = uint(val)
	return uint(val), nil
}

// ---- Artists ----

func (s *AdminService) ListArtistTranslations(c *gin.Context) {
	artistID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid artist id"})
		return
	}
	var rows []models.ArtistTranslation
	_ = s.db.Where("artist_id = ?", artistID).Order("locale asc").Find(&rows).Error
	c.JSON(http.StatusOK, gin.H{"items": rows, "total": len(rows)})
}

func (s *AdminService) UpsertArtistTranslations(c *gin.Context) {
	artistID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid artist id"})
		return
	}
	var input struct {
		Translations []models.ArtistTranslation `json:"translations" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, tr := range input.Translations {
		loc := strings.TrimSpace(tr.Locale)
		if !isValidLocale(loc) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid locale: " + loc})
			return
		}
		row := models.ArtistTranslation{ArtistID: artistID, Locale: loc, Name: strings.TrimSpace(tr.Name), Biography: tr.Biography}
		_ = s.db.Save(&row).Error
	}
	writeAudit(s.db, c, "translation.artist.upsert", "artist", artistID.String(), map[string]interface{}{"count": len(input.Translations)})
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
