package admin

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/transcoder"
	"gorm.io/gorm"
)

type adminAssetView struct {
	models.AssetRegistry
	FileRole string `json:"file_role"`
}

func toAdminAssetView(asset models.AssetRegistry) adminAssetView {
	role := "master_archive"
	for _, binding := range asset.Bindings {
		if binding.BindingRole != "" {
			role = binding.BindingRole
			break
		}
	}
	return adminAssetView{AssetRegistry: asset, FileRole: role}
}

func (s *AdminService) assetStats() (total, totalBytes, pending, processing, failed, completed int64) {
	s.db.Model(&models.AssetRegistry{}).Count(&total)
	type sumResult struct{ TotalSize int64 }
	var sum sumResult
	s.db.Model(&models.AssetRegistry{}).Select("COALESCE(SUM(file_size), 0) as total_size").Scan(&sum)
	totalBytes = sum.TotalSize
	s.db.Model(&models.AssetRegistry{}).Where("transcode_status = 'pending'").Count(&pending)
	s.db.Model(&models.AssetRegistry{}).Where("transcode_status = 'processing'").Count(&processing)
	s.db.Model(&models.AssetRegistry{}).Where("transcode_status = 'failed'").Count(&failed)
	s.db.Model(&models.AssetRegistry{}).Where("transcode_status = 'completed'").Count(&completed)
	return
}

// ListAssetFiles keeps the legacy endpoint name while serving the CAS registry.
func (s *AdminService) ListAssetFiles(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	query := s.db.Model(&models.AssetRegistry{})
	if status := c.Query("transcode_status"); status != "" {
		query = query.Where("transcode_status = ?", status)
	}
	if q := c.Query("q"); q != "" {
		like := "%" + q + "%"
		query = query.Where("file_name ILIKE ? OR sha256_hash ILIKE ?", like, like)
	}

	var total int64
	query.Count(&total)
	var assets []models.AssetRegistry
	if err := query.Preload("Bindings").Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&assets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]adminAssetView, 0, len(assets))
	for _, asset := range assets {
		items = append(items, toAdminAssetView(asset))
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

func (s *AdminService) GetAssetDetail(c *gin.Context) {
	assetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid asset ID"})
		return
	}
	var asset models.AssetRegistry
	if err := s.db.Preload("Bindings").Where("id = ?", assetID).First(&asset).Error; err == nil {
		c.JSON(http.StatusOK, toAdminAssetView(asset))
		return
	}

	// Old instances may still contain assets that predate AssetRegistry.
	var legacy models.AssetFile
	if err := s.db.Where("id = ?", assetID).First(&legacy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Asset not found"})
		return
	}
	c.JSON(http.StatusOK, legacy)
}

func (s *AdminService) RetryAsset(c *gin.Context) {
	assetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid asset ID"})
		return
	}
	if s.queue == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "transcode queue unavailable"})
		return
	}

	var hash string
	var registry models.AssetRegistry
	if err := s.db.Where("id = ?", assetID).First(&registry).Error; err == nil {
		hash = registry.Sha256Hash
	} else {
		var legacy models.AssetFile
		if err := s.db.Where("id = ?", assetID).First(&legacy).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Asset not found"})
			return
		}
		hash = legacy.Sha256Hash
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		registryQuery := tx.Model(&models.AssetRegistry{}).Where("id = ?", assetID)
		legacyQuery := tx.Model(&models.AssetFile{}).Where("id = ?", assetID)
		if hash != "" {
			registryQuery = registryQuery.Or("sha256_hash = ?", hash)
			legacyQuery = legacyQuery.Or("sha256_hash = ?", hash)
		}
		updates := map[string]interface{}{"transcode_status": "pending", "transcode_error": ""}
		if err := registryQuery.Updates(updates).Error; err != nil {
			return err
		}
		if err := legacyQuery.Updates(updates).Error; err != nil {
			return err
		}
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	task, err := transcoder.NewTranscodeTask(assetID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := s.queue.Enqueue(task, asynq.Queue("transcode"), asynq.MaxRetry(3)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to enqueue transcode task: %v", err)})
		return
	}

	writeAudit(s.db, c, "asset.retry", "asset", assetID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}
