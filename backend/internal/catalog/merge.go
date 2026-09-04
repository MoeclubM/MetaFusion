package catalog

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
)

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
