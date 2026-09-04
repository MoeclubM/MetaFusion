package catalog

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
	"gorm.io/gorm"
)

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
		t, err := ontology.ParseExactDate(*input.ReleaseDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		work.ReleaseDate = t
	}
	beginDate, err := ontology.NormalizePartialDate(input.BeginDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	endDate, err := ontology.NormalizePartialDate(input.EndDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := ontology.ValidateDateSpan(beginDate, endDate); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	work.BeginDate = beginDate
	work.EndDate = endDate
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

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&work).Error; err != nil {
			return err
		}
		if err := replaceWorkTagsByNameDB(tx, &work, tagNames); err != nil {
			return err
		}
		if err := upsertWorkTranslationsDB(tx, work.ID, localeItems); err != nil {
			return err
		}
		return recordRevisionDB(tx, "work", work.ID, &userID, "update", "更新作品元数据", input.EditNote, input.SourceURLs, beforeState, afterState)
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = s.db.Preload("Tags").Preload("Translations").First(&work, work.ID).Error
	s.refreshWorkSearchIndex(c.Request.Context(), work.ID)
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
	beginDate, err := ontology.NormalizePartialDate(input.BeginDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	endDate, err := ontology.NormalizePartialDate(input.EndDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := ontology.ValidateDateSpan(beginDate, endDate); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	artist.BeginDate = beginDate
	artist.EndDate = endDate
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

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&artist).Error; err != nil {
			return err
		}
		if err := upsertArtistTranslationsDB(tx, artist.ID, items); err != nil {
			return err
		}
		return recordRevisionDB(tx, "artist", artist.ID, &userID, "update", "更新创作者/机构主体档案", input.EditNote, input.SourceURLs, beforeState, afterState)
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
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
		t, err := ontology.ParseExactDate(*input.EditionDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		release.EditionDate = t
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

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&release).Error; err != nil {
			return err
		}
		return recordRevisionDB(tx, "release", release.ID, &userID, "update", "更新发行版信息", input.EditNote, input.SourceURLs, beforeState, afterState)
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "success", "release": release})
}
