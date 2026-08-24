package admin

import (
	"fmt"
	"net/url"
	"strings"

	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/security"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	catalogsvc "github.com/metafusion/metafusion-app/internal/catalog"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
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

func (s *AdminService) CreateWork(c *gin.Context) {
	userIDVal, _ := c.Get("userID")
	uid, _ := userIDVal.(uuid.UUID)
	var input struct {
		Title           string                 `json:"title" binding:"required"`
		OriginalTitle   string                 `json:"original_title"`
		Summary         string                 `json:"summary"`
		CoverImageURL   string                 `json:"cover_image_url"`
		CoverAspect     string                 `json:"cover_aspect"`
		ExternalIDs     map[string]interface{} `json:"external_ids"`
		CatalogMetadata map[string]interface{} `json:"catalog_metadata"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 查重防重机制：若同名作品已存在，复用现有实体
	var existingWork models.Work
	trimmedTitle := strings.TrimSpace(input.Title)
	if err := s.db.Where("LOWER(TRIM(title)) = LOWER(TRIM(?))", trimmedTitle).First(&existingWork).Error; err == nil {
		if input.CoverImageURL != "" && (existingWork.CoverImageURL == "" || strings.Contains(existingWork.CoverImageURL, "unsplash.com")) {
			s.db.Model(&models.Work{}).Where("id = ?", existingWork.ID).Updates(map[string]interface{}{
				"cover_image_url": input.CoverImageURL,
				"cover_aspect":    catalogsvc.NormalizeCoverAspect(input.CoverAspect),
			})
			existingWork.CoverImageURL = input.CoverImageURL
			existingWork.CoverAspect = catalogsvc.NormalizeCoverAspect(input.CoverAspect)
		}
		c.JSON(http.StatusOK, existingWork)
		return
	}

	extIDs := models.JSONB{}
	if input.ExternalIDs != nil {
		extIDs = models.JSONB(input.ExternalIDs)
	}
	work := models.Work{
		Title:           strings.TrimSpace(input.Title),
		OriginalTitle:   input.OriginalTitle,
		Summary:         input.Summary,
		CoverImageURL:   input.CoverImageURL,
		CoverAspect:     catalogsvc.NormalizeCoverAspect(input.CoverAspect),
		Status:          models.WorkStatusPendingReview,
		ExternalIDs:     extIDs,
		CatalogMetadata: models.JSONB(input.CatalogMetadata),
		CreatedBy:       &uid,
	}
	if err := validateCoverURL(work.CoverImageURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := s.db.Create(&work).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	loc := "zh-CN"
	_ = s.db.Create(&models.WorkTranslation{WorkID: work.ID, Locale: loc, Title: work.Title, Summary: work.Summary}).Error
	writeAudit(s.db, c, "work.create", "work", work.ID.String(), map[string]interface{}{"title": work.Title})
	c.JSON(http.StatusCreated, work)
}

func (s *AdminService) UpdateWork(c *gin.Context) {
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID"})
		return
	}
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	allowed := map[string]bool{"title": true, "original_title": true, "summary": true, "cover_image_url": true, "cover_aspect": true, "external_ids": true, "catalog_metadata": true, "status": true, "content_rating": true}
	updates := map[string]interface{}{}
	for k, v := range input {
		if allowed[k] {
			updates[k] = v
		}
	}
	if v, ok := updates["cover_aspect"]; ok {
		if s, isStr := v.(string); isStr {
			updates["cover_aspect"] = catalogsvc.NormalizeCoverAspect(s)
		} else {
			delete(updates, "cover_aspect")
		}
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid fields"})
		return
	}
	if v, ok := updates["cover_image_url"]; ok {
		if s, ok := v.(string); ok {
			if err := validateCoverURL(s); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
		}
	}
	if err := s.db.Model(&models.Work{}).Where("id = ?", workID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "work.update", "work", workID.String(), updates)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) DeleteWork(c *gin.Context) {
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID"})
		return
	}

	// 物理级联删除多态关系与关联数据
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// 1. 删除 entity_relationships (作为 source 或 target)
		if err := tx.Where("(source_type = 'work' AND source_id = ?) OR (target_type = 'work' AND target_id = ?)", workID, workID).Delete(&models.EntityRelationship{}).Error; err != nil {
			return err
		}
		// 2. 删除 asset_bindings (挂载到 work 的资产)
		if err := tx.Where("target_entity_type = 'work' AND target_entity_id = ?", workID).Delete(&models.AssetBinding{}).Error; err != nil {
			return err
		}
		// 3. 删除 favorites 收藏
		if err := tx.Where("target_type = 'work' AND target_id = ?", workID).Delete(&models.Favorite{}).Error; err != nil {
			return err
		}
		// 4. 删除 work_translations 多语言翻译
		if err := tx.Where("work_id = ?", workID).Delete(&models.WorkTranslation{}).Error; err != nil {
			return err
		}
		// 5. 删除 work_tag_relations 关联
		if err := tx.Exec("DELETE FROM work_tag_relations WHERE work_id = ?", workID).Error; err != nil {
			return err
		}
		// 6. 删除 work_artist_relations 关联
		if err := tx.Where("work_id = ?", workID).Delete(&models.WorkArtistRelation{}).Error; err != nil {
			return err
		}
		// 7. 删除 entity_revisions 修订审计快照
		if err := tx.Where("entity_type = 'work' AND entity_id = ?", workID).Delete(&models.EntityRevision{}).Error; err != nil {
			return err
		}
		// 8. 删除评论与论坛讨论
		if err := tx.Where("work_id = ?", workID).Delete(&models.Comment{}).Error; err != nil {
			return err
		}
		var topicIDs []uuid.UUID
		tx.Model(&models.DiscussionTopic{}).Where("work_id = ?", workID).Pluck("id", &topicIDs)
		if len(topicIDs) > 0 {
			_ = tx.Where("topic_id IN ?", topicIDs).Delete(&models.ForumPost{}).Error
			_ = tx.Where("id IN ?", topicIDs).Delete(&models.DiscussionTopic{}).Error
		}
		// 9. 删除 Releases 及其 Mediums 与 Tracks
		var relIDs []uuid.UUID
		tx.Model(&models.Release{}).Where("work_id = ?", workID).Pluck("id", &relIDs)
		if len(relIDs) > 0 {
			var medIDs []uuid.UUID
			tx.Model(&models.Medium{}).Where("release_id IN ?", relIDs).Pluck("id", &medIDs)
			if len(medIDs) > 0 {
				_ = tx.Where("medium_id IN ?", medIDs).Delete(&models.Track{}).Error
				_ = tx.Where("id IN ?", medIDs).Delete(&models.Medium{}).Error
			}
			_ = tx.Where("target_entity_type = 'release' AND target_entity_id IN ?", relIDs).Delete(&models.AssetBinding{}).Error
			_ = tx.Where("entity_type = 'release' AND entity_id IN ?", relIDs).Delete(&models.EntityRevision{}).Error
			_ = tx.Where("id IN ?", relIDs).Delete(&models.Release{}).Error
		}
		// 10. 删除 CanonicalEntries 与剩余 Tracks
		_ = tx.Where("work_id = ?", workID).Delete(&models.Track{}).Error
		_ = tx.Where("work_id = ?", workID).Delete(&models.CanonicalEntry{}).Error

		// 11. 删除主体 Work
		if err := tx.Where("id = ?", workID).Delete(&models.Work{}).Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 同步从 OpenSearch 中删除索引文档
	if s.search != nil {
		_ = s.search.DeleteWorkDoc(c.Request.Context(), workID)
	}

	writeAudit(s.db, c, "work.delete", "work", workID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) ListArtistsAdmin(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	entityType := c.Query("entity_type")
	searchQuery := c.Query("q")
	offset := (page - 1) * pageSize

	query := s.db.Model(&models.Artist{})
	if entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	if searchQuery != "" {
		like := "%" + searchQuery + "%"
		query = query.Where("name ILIKE ? OR original_name ILIKE ? OR disambiguation ILIKE ?", like, like, like)
	}

	var total int64
	query.Count(&total)

	var artists []models.Artist
	if err := query.Order("created_at desc").Offset(offset).Limit(pageSize).Find(&artists).Error; err != nil {
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

func (s *AdminService) CreateArtist(c *gin.Context) {
	var input struct {
		Name           string                 `json:"name" binding:"required"`
		OriginalName   string                 `json:"original_name"`
		Disambiguation string                 `json:"disambiguation"`
		EntityType     string                 `json:"entity_type"`
		Country        string                 `json:"country"`
		Biography      string                 `json:"biography"`
		ExternalIDs    map[string]interface{} `json:"external_ids"`
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

	extIDs := models.JSONB{}
	if input.ExternalIDs != nil {
		extIDs = models.JSONB(input.ExternalIDs)
	}

	artist := models.Artist{
		Name:           input.Name,
		OriginalName:   input.OriginalName,
		Disambiguation: input.Disambiguation,
		EntityType:     input.EntityType,
		Country:        input.Country,
		Biography:      input.Biography,
		ExternalIDs:    extIDs,
	}
	if err := s.db.Create(&artist).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "artist.create", "artist", artist.ID.String(), map[string]interface{}{"name": artist.Name, "entity_type": artist.EntityType})
	c.JSON(http.StatusCreated, artist)
}

func (s *AdminService) UpdateArtist(c *gin.Context) {
	artistID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid artist ID"})
		return
	}
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if et, ok := input["entity_type"].(string); ok && et != "" {
		if !ontology.IsEnabledEntityType(s.db, et) {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "catalog.invalid_entity_type")})
			return
		}
	}

	allowed := map[string]bool{
		"name": true, "original_name": true, "entity_type": true,
		"country": true, "biography": true, "disambiguation": true, "external_ids": true,
	}
	updates := map[string]interface{}{}
	for k, v := range input {
		if allowed[k] {
			updates[k] = v
		}
	}
	if err := s.db.Model(&models.Artist{}).Where("id = ?", artistID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "artist.update", "artist", artistID.String(), updates)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) DeleteArtist(c *gin.Context) {
	artistID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid artist ID"})
		return
	}

	// 物理级联删除多态关系与关联数据
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// 1. 删除 entity_relationships (作为 source 或 target)
		if err := tx.Where("(source_type = 'artist' AND source_id = ?) OR (target_type = 'artist' AND target_id = ?)", artistID, artistID).Delete(&models.EntityRelationship{}).Error; err != nil {
			return err
		}
		// 2. 删除 asset_bindings (挂载到 artist 的资产)
		if err := tx.Where("target_entity_type = 'artist' AND target_entity_id = ?", artistID).Delete(&models.AssetBinding{}).Error; err != nil {
			return err
		}
		// 3. 删除 favorites 收藏
		if err := tx.Where("target_type = 'artist' AND target_id = ?", artistID).Delete(&models.Favorite{}).Error; err != nil {
			return err
		}
		// 4. 删除 artist_translations 多语言翻译
		if err := tx.Where("artist_id = ?", artistID).Delete(&models.ArtistTranslation{}).Error; err != nil {
			return err
		}
		// 5. 删除 work_artist_relations 关联
		if err := tx.Where("artist_id = ?", artistID).Delete(&models.WorkArtistRelation{}).Error; err != nil {
			return err
		}
		// 6. 删除 entity_revisions 审计修订记录
		if err := tx.Where("entity_type = 'artist' AND entity_id = ?", artistID).Delete(&models.EntityRevision{}).Error; err != nil {
			return err
		}
		// 7. 删除主体 Artist
		if err := tx.Where("id = ?", artistID).Delete(&models.Artist{}).Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	writeAudit(s.db, c, "artist.delete", "artist", artistID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) DeleteFranchise(c *gin.Context) {
	franchiseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid franchise ID"})
		return
	}

	// 物理级联删除多态关系与关联数据
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// 1. 删除 entity_relationships (作为 source 或 target)
		if err := tx.Where("(source_type = 'franchise' AND source_id = ?) OR (target_type = 'franchise' AND target_id = ?)", franchiseID, franchiseID).Delete(&models.EntityRelationship{}).Error; err != nil {
			return err
		}
		// 2. 删除 asset_bindings (挂载到 franchise 的资产)
		if err := tx.Where("target_entity_type = 'franchise' AND target_entity_id = ?", franchiseID).Delete(&models.AssetBinding{}).Error; err != nil {
			return err
		}
		// 3. 删除 favorites 收藏
		if err := tx.Where("target_type = 'franchise' AND target_id = ?", franchiseID).Delete(&models.Favorite{}).Error; err != nil {
			return err
		}
		// 4. 删除 franchise_translations 多语言翻译
		if err := tx.Where("franchise_id = ?", franchiseID).Delete(&models.FranchiseTranslation{}).Error; err != nil {
			return err
		}
		// 5. 删除 franchise_tag_relations 关联
		if err := tx.Exec("DELETE FROM franchise_tag_relations WHERE franchise_id = ?", franchiseID).Error; err != nil {
			return err
		}
		// 6. 删除主体 Franchise
		if err := tx.Where("id = ?", franchiseID).Delete(&models.Franchise{}).Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	writeAudit(s.db, c, "franchise.delete", "franchise", franchiseID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) CreateRelease(c *gin.Context) {
	userIDVal, _ := c.Get("userID")
	uid, _ := userIDVal.(uuid.UUID)
	var input struct {
		WorkID              uuid.UUID              `json:"work_id" binding:"required"`
		PublisherID         *uuid.UUID             `json:"publisher_id"`
		EditionName         string                 `json:"edition_name" binding:"required"`
		CatalogNumber       string                 `json:"catalog_number"`
		Barcode             string                 `json:"barcode"`
		Publisher           string                 `json:"publisher"`
		Packaging           string                 `json:"packaging"`
		Country             string                 `json:"country"`
		Language            string                 `json:"language"`
		DistributionChannel string                 `json:"distribution_channel"`
		ExternalIDs         map[string]interface{} `json:"external_ids"`
		CatalogMetadata     map[string]interface{} `json:"catalog_metadata"`
		Notes               string                 `json:"notes"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	publisherName := input.Publisher
	if input.PublisherID != nil && publisherName == "" {
		var pubArtist models.Artist
		if err := s.db.Where("id = ?", *input.PublisherID).First(&pubArtist).Error; err == nil {
			publisherName = pubArtist.Name
		}
	}

	extIDs := models.JSONB{}
	if input.ExternalIDs != nil {
		extIDs = models.JSONB(input.ExternalIDs)
	}

	release := models.Release{
		WorkID:              input.WorkID,
		PublisherID:         input.PublisherID,
		EditionName:         input.EditionName,
		CatalogNumber:       input.CatalogNumber,
		Barcode:             input.Barcode,
		Publisher:           publisherName,
		Packaging:           input.Packaging,
		Country:             strings.TrimSpace(input.Country),
		Language:            strings.TrimSpace(input.Language),
		DistributionChannel: input.DistributionChannel,
		ExternalIDs:         extIDs,
		CatalogMetadata:     models.JSONB(input.CatalogMetadata),
		Notes:               input.Notes,
		UploaderID:          &uid,
		IsMasterVerified:    false,
	}
	if release.Packaging == "" {
		release.Packaging = "box_set"
	}
	if err := s.db.Create(&release).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "release.create", "release", release.ID.String(), map[string]interface{}{"edition_name": release.EditionName})
	c.JSON(http.StatusCreated, release)
}

func (s *AdminService) UpdateRelease(c *gin.Context) {
	releaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid release ID"})
		return
	}
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	allowed := map[string]bool{
		"edition_name": true, "catalog_number": true, "barcode": true,
		"publisher": true, "publisher_id": true, "packaging": true, "notes": true,
		"country": true, "language": true, "distribution_channel": true, "external_ids": true, "catalog_metadata": true,
	}
	updates := map[string]interface{}{}
	for k, v := range input {
		if allowed[k] {
			updates[k] = v
		}
	}
	if err := s.db.Model(&models.Release{}).Where("id = ?", releaseID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "release.update", "release", releaseID.String(), updates)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) DeleteRelease(c *gin.Context) {
	releaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid release ID"})
		return
	}
	if err := s.db.Where("id = ?", releaseID).Delete(&models.Release{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "release.delete", "release", releaseID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) ListReleasesAdmin(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	workIDStr := c.Query("work_id")
	q := c.Query("q")
	query := s.db.Model(&models.Release{}).
		Preload("Work").
		Preload("PublisherEntity").
		Preload("Mediums.Tracks").
		Preload("AssetFiles").
		Preload("Uploader")
	if workIDStr != "" {
		if wid, err := uuid.Parse(workIDStr); err == nil {
			query = query.Where("work_id = ?", wid)
		}
	}
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("edition_name ILIKE ? OR catalog_number ILIKE ? OR barcode ILIKE ? OR publisher ILIKE ?", like, like, like, like)
	}
	var total int64
	query.Count(&total)
	var releases []models.Release
	offset := (page - 1) * pageSize
	if err := query.Order("created_at desc").Offset(offset).Limit(pageSize).Find(&releases).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": releases, "total": total, "page": page, "page_size": pageSize})
}

func (s *AdminService) CreateMedium(c *gin.Context) {
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
	medium := models.Medium{ReleaseID: input.ReleaseID, Position: input.Position, Name: input.Name, Format: input.Format, MediaCategory: input.MediaCategory}
	if err := s.db.Create(&medium).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "medium.create", "medium", medium.ID.String(), nil)
	c.JSON(http.StatusCreated, medium)
}

func (s *AdminService) DeleteMedium(c *gin.Context) {
	mediumID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid medium ID"})
		return
	}
	if err := s.db.Where("id = ?", mediumID).Delete(&models.Medium{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "medium.delete", "medium", mediumID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) CreateTrack(c *gin.Context) {
	var input struct {
		MediumID uuid.UUID `json:"medium_id" binding:"required"`
		Position int       `json:"position" binding:"required"`
		Title    string    `json:"title"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	track := models.Track{MediumID: input.MediumID, Position: input.Position, Title: input.Title}
	if err := s.db.Create(&track).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "track.create", "track", track.ID.String(), nil)
	c.JSON(http.StatusCreated, track)
}

func (s *AdminService) DeleteTrack(c *gin.Context) {
	trackID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid track ID"})
		return
	}
	if err := s.db.Where("id = ?", trackID).Delete(&models.Track{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "track.delete", "track", trackID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) ListCategoriesAdmin(c *gin.Context) {
	var cats []models.Category
	if err := s.db.Order("sort_order asc").Find(&cats).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cats)
}

func (s *AdminService) UpsertCategory(c *gin.Context) {
	var input models.Category
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := s.db.Save(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "category.upsert", "category", input.Code, nil)
	c.JSON(http.StatusOK, input)
}

func (s *AdminService) DeleteCategory(c *gin.Context) {
	code := c.Param("code")
	if err := s.db.Where("code = ?", code).Delete(&models.Category{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "category.delete", "category", code, nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) ListTagsAdmin(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	groupType := strings.TrimSpace(c.Query("group_type"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "100"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 100
	}
	query := s.db.Model(&models.Tag{})
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("name ILIKE ?", like)
	}
	if groupType != "" {
		query = query.Where("group_type = ?", groupType)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var tags []models.Tag
	if err := query.Order("group_type asc, name asc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&tags).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": tags, "total": total, "page": page, "page_size": pageSize})
}

func (s *AdminService) CreateTag(c *gin.Context) {
	var input struct {
		Name          string   `json:"name" binding:"required"`
		GroupType     string   `json:"group_type" binding:"required"`
		CategoryScope []string `json:"category_scope"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tag := models.Tag{Name: strings.TrimSpace(input.Name), GroupType: strings.TrimSpace(input.GroupType), CategoryScope: input.CategoryScope}
	if tag.CategoryScope == nil {
		tag.CategoryScope = []string{}
	}
	if err := s.db.Create(&tag).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "tag.create", "tag", strings.TrimSpace(input.Name), nil)
	c.JSON(http.StatusCreated, tag)
}

func (s *AdminService) DeleteTag(c *gin.Context) {
	idStr := c.Param("id")
	if err := s.db.Where("id = ?", idStr).Delete(&models.Tag{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "tag.delete", "tag", idStr, nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) ListCanonicalEntries(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	workIDStr := c.Query("work_id")
	q := c.Query("q")
	query := s.db.Model(&models.CanonicalEntry{}).Preload("Work")
	if workIDStr != "" {
		if wid, err := uuid.Parse(workIDStr); err == nil {
			query = query.Where("work_id = ?", wid)
		}
	}
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("title ILIKE ? OR isrc ILIKE ? OR isbn ILIKE ? OR artist_credit ILIKE ?", like, like, like, like)
	}
	var total int64
	query.Count(&total)
	var entries []models.CanonicalEntry
	offset := (page - 1) * pageSize
	if err := query.Order("created_at desc").Offset(offset).Limit(pageSize).Find(&entries).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": entries, "total": total, "page": page, "page_size": pageSize})
}

func (s *AdminService) CreateCanonicalEntry(c *gin.Context) {
	var input struct {
		Title        string                 `json:"title" binding:"required"`
		SortTitle    string                 `json:"sort_title"`
		Duration     int                    `json:"duration_seconds"`
		ISRC         string                 `json:"isrc"`
		ISBN         string                 `json:"isbn"`
		ArtistCredit string                 `json:"artist_credit"`
		WorkID       *uuid.UUID             `json:"work_id"`
		ExternalIDs  map[string]interface{} `json:"external_ids"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ext := models.JSONB{}
	if input.ExternalIDs != nil {
		ext = models.JSONB(input.ExternalIDs)
	}
	entry := models.CanonicalEntry{
		Title:        strings.TrimSpace(input.Title),
		SortTitle:    strings.TrimSpace(input.SortTitle),
		Duration:     input.Duration,
		ISRC:         strings.TrimSpace(input.ISRC),
		ISBN:         strings.TrimSpace(input.ISBN),
		ArtistCredit: strings.TrimSpace(input.ArtistCredit),
		WorkID:       input.WorkID,
		ExternalIDs:  ext,
	}
	if err := s.db.Create(&entry).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "canonical_entry.create", "canonical_entry", entry.ID.String(), map[string]interface{}{"title": entry.Title})
	c.JSON(http.StatusCreated, entry)
}

func (s *AdminService) UpdateCanonicalEntry(c *gin.Context) {
	entryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid canonical entry ID"})
		return
	}
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	allowed := map[string]bool{"title": true, "sort_title": true, "duration_seconds": true, "isrc": true, "isbn": true, "artist_credit": true, "work_id": true, "external_ids": true}
	updates := map[string]interface{}{}
	for k, v := range input {
		if allowed[k] {
			updates[k] = v
		}
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid fields"})
		return
	}
	if err := s.db.Model(&models.CanonicalEntry{}).Where("id = ?", entryID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "canonical_entry.update", "canonical_entry", entryID.String(), updates)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) DeleteCanonicalEntry(c *gin.Context) {
	entryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid canonical entry ID"})
		return
	}
	if err := s.db.Where("id = ?", entryID).Delete(&models.CanonicalEntry{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "canonical_entry.delete", "canonical_entry", entryID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) ListInvitations(c *gin.Context) {
	var invites []models.Invitation
	if err := s.db.Preload("Inviter").Order("created_at desc").Limit(100).Find(&invites).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, invites)
}

// 虚拟货架管理 (Virtual Shelf Taxonomy)
func (s *AdminService) ListVirtualShelves(c *gin.Context) {
	var shelves []models.VirtualShelf
	if err := s.db.Order("sort_order asc").Find(&shelves).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shelves)
}

func coerceStringSlice(v interface{}) []string {
	var out []string
	switch arr := v.(type) {
	case []string:
		for _, s := range arr {
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
	case []interface{}:
		for _, e := range arr {
			if s, ok := e.(string); ok {
				s = strings.TrimSpace(s)
				if s != "" {
					out = append(out, s)
				}
			}
		}
	}
	return out
}

func (s *AdminService) rejectCarrierShelfTags(names []string) error {
	if len(names) == 0 {
		return nil
	}
	var tags []models.Tag
	if err := s.db.Where("name IN ? AND group_type = ?", names, models.TagGroupSpec).Find(&tags).Error; err != nil {
		return err
	}
	if len(tags) > 0 {
		return fmt.Errorf("规格标签不能用于作品货架: %s", tags[0].Name)
	}
	return nil
}

func (s *AdminService) CreateVirtualShelf(c *gin.Context) {
	var shelf models.VirtualShelf
	if err := c.ShouldBindJSON(&shelf); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	names := append([]string{}, shelf.QueryTags...)
	names = append(names, shelf.ExcludeTags...)
	if err := s.rejectCarrierShelfTags(names); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := s.db.Create(&shelf).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "virtual_shelf.create", "virtual_shelf", shelf.Slug, map[string]interface{}{"name": shelf.NameZh})
	c.JSON(http.StatusCreated, shelf)
}

func (s *AdminService) UpdateVirtualShelf(c *gin.Context) {
	slug := c.Param("slug")
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var check []string
	if v, ok := input["query_tags"]; ok {
		check = append(check, coerceStringSlice(v)...)
	}
	if v, ok := input["exclude_tags"]; ok {
		check = append(check, coerceStringSlice(v)...)
	}
	if err := s.rejectCarrierShelfTags(check); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := s.db.Model(&models.VirtualShelf{}).Where("slug = ?", slug).Updates(input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "virtual_shelf.update", "virtual_shelf", slug, input)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) DeleteVirtualShelf(c *gin.Context) {
	slug := c.Param("slug")
	if err := s.db.Where("slug = ?", slug).Delete(&models.VirtualShelf{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "virtual_shelf.delete", "virtual_shelf", slug, nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

var _ = time.Now
