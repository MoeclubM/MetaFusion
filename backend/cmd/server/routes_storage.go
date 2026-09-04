package main

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/auth"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/storage"
	"gorm.io/gorm"
)

func registerStorageRoutes(api *gin.RouterGroup, cfg *config.Config, db *gorm.DB, storageSvc *storage.StorageService) {
	if storageSvc == nil {
		return
	}

	storageGroup := api.Group("/storage", auth.UnifiedAuthMiddleware(cfg, db))
	storageGroup.POST("/upload/initiate", func(c *gin.Context) {
		var req storage.InitiateUploadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		resp, err := storageSvc.InitiateUpload(c.Request.Context(), &req)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
	})

	storageGroup.POST("/upload/complete", func(c *gin.Context) {
		var req storage.CompleteUploadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := storageSvc.CompleteUpload(c.Request.Context(), &req); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Upload completed, transcoding started"})
	})

	storageGroup.GET("/download/:asset_id", func(c *gin.Context) {
		assetID, err := uuid.Parse(c.Param("asset_id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid asset ID"})
			return
		}
		downloadURL, err := storageSvc.GetDownloadURL(c.Request.Context(), assetID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"download_url": downloadURL})
	})

	storageGroup.POST("/bind", func(c *gin.Context) {
		var req storage.BindAssetRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		binding, err := storageSvc.BindAsset(&req)
		if err != nil {
			switch {
			case errors.Is(err, storage.ErrInvalidBindingTarget):
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			case errors.Is(err, storage.ErrAssetNotFound), errors.Is(err, storage.ErrBindingTargetNotFound):
				c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "bound", "binding": binding})
	})
}
