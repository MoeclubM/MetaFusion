package favorite

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

var validTargets = map[string]bool{"work": true, "release": true, "artist": true}

// favoriteItem 列表条目：收藏元数据 + 实体摘要
type favoriteItem struct {
	ID         uuid.UUID `json:"id"`
	TargetType string    `json:"target_type"`
	TargetID   uuid.UUID `json:"target_id"`
	CreatedAt  string    `json:"created_at"`
	Work       *workBrief    `json:"work,omitempty"`
	Release    *releaseBrief `json:"release,omitempty"`
	Artist     *artistBrief  `json:"artist,omitempty"`
}

type workBrief struct {
	ID            uuid.UUID `json:"id"`
	Title         string    `json:"title"`
	MediaType     string    `json:"media_type"`
	CoverImageURL string    `json:"cover_image_url"`
}

type releaseBrief struct {
	ID          uuid.UUID `json:"id"`
	WorkID      uuid.UUID `json:"work_id"`
	EditionName string    `json:"edition_name"`
}

type artistBrief struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	OriginalName string    `json:"original_name"`
	EntityType   string    `json:"entity_type"`
}

// Toggle 收藏 / 取消收藏（幂等切换）
func Toggle(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.MustGet("userID").(uuid.UUID)

		var req struct {
			TargetType string `json:"target_type" binding:"required"`
			TargetID   string `json:"target_id" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !validTargets[req.TargetType] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid target_type"})
			return
		}
		targetID, err := uuid.Parse(req.TargetID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid target_id"})
			return
		}

		// 目标实体必须存在，防止悬挂引用
		if !targetExists(db, req.TargetType, targetID) {
			c.JSON(http.StatusNotFound, gin.H{"error": "target not found"})
			return
		}

		var existing models.Favorite
		err = db.Where("user_id = ? AND target_type = ? AND target_id = ?", userID, req.TargetType, targetID).First(&existing).Error
		if err == nil {
			if err := db.Delete(&existing).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"favorited": false})
			return
		}
		if err != gorm.ErrRecordNotFound {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		fav := models.Favorite{UserID: userID, TargetType: req.TargetType, TargetID: targetID}
		if err := db.Create(&fav).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"favorited": true})
	}
}

// Status 查询当前用户对若干目标是否已收藏
func Status(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.MustGet("userID").(uuid.UUID)

		targetType := c.Query("target_type")
		if !validTargets[targetType] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid target_type"})
			return
		}
		idsRaw := c.Query("target_ids")
		if idsRaw == "" {
			c.JSON(http.StatusOK, gin.H{"favorited": []string{}})
			return
		}
		var ids []uuid.UUID
		for _, part := range splitIDs(idsRaw) {
			if id, err := uuid.Parse(part); err == nil {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			c.JSON(http.StatusOK, gin.H{"favorited": []string{}})
			return
		}

		var rows []models.Favorite
		if err := db.Where("user_id = ? AND target_type = ? AND target_id IN ?", userID, targetType, ids).Find(&rows).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		favorited := make([]string, 0, len(rows))
		for _, r := range rows {
			favorited = append(favorited, r.TargetID.String())
		}
		c.JSON(http.StatusOK, gin.H{"favorited": favorited})
	}
}

// ListMy 当前用户自己的收藏列表（不受隐私开关影响）
func ListMy(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.MustGet("userID").(uuid.UUID)
		listFavorites(c, db, userID)
	}
}

// ListByUser 查看指定用户的收藏列表；未公开时仅本人可见
func ListByUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
			return
		}
		viewerID, _ := c.Get("userID")
		isSelf := viewerID != nil && viewerID.(uuid.UUID) == uid

		var owner models.User
		if err := db.Select("id", "favorites_public").First(&owner, "id = ?", uid).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		if !isSelf && !owner.FavoritesPublic {
			c.JSON(http.StatusOK, gin.H{"items": []favoriteItem{}, "total": 0, "visible": false})
			return
		}
		listFavorites(c, db, uid)
	}
}

func listFavorites(c *gin.Context, db *gorm.DB, userID uuid.UUID) {
	targetType := c.Query("target_type")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	q := db.Model(&models.Favorite{}).Where("user_id = ?", userID)
	if validTargets[targetType] {
		q = q.Where("target_type = ?", targetType)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var rows []models.Favorite
	if err := q.Order("created_at desc").Offset(offset).Limit(pageSize).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	items := make([]favoriteItem, 0, len(rows))
	for _, r := range rows {
		it := favoriteItem{ID: r.ID, TargetType: r.TargetType, TargetID: r.TargetID, CreatedAt: r.CreatedAt.Format("2006-01-02T15:04:05Z07:00")}
		switch r.TargetType {
		case "work":
			var w models.Work
			if err := db.Select("id", "title", "media_type", "cover_image_url").First(&w, "id = ?", r.TargetID).Error; err == nil {
				it.Work = &workBrief{ID: w.ID, Title: w.Title, MediaType: w.MediaType, CoverImageURL: w.CoverImageURL}
			}
		case "release":
			var rel models.Release
			if err := db.Select("id", "work_id", "edition_name").First(&rel, "id = ?", r.TargetID).Error; err == nil {
				it.Release = &releaseBrief{ID: rel.ID, WorkID: rel.WorkID, EditionName: rel.EditionName}
			}
		case "artist":
			var a models.Artist
			if err := db.Select("id", "name", "original_name", "entity_type").First(&a, "id = ?", r.TargetID).Error; err == nil {
				it.Artist = &artistBrief{ID: a.ID, Name: a.Name, OriginalName: a.OriginalName, EntityType: a.EntityType}
			}
		}
		items = append(items, it)
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize, "visible": true})
}

func targetExists(db *gorm.DB, targetType string, id uuid.UUID) bool {
	switch targetType {
	case "work":
		return exists(db, &models.Work{}, id)
	case "release":
		return exists(db, &models.Release{}, id)
	case "artist":
		return exists(db, &models.Artist{}, id)
	}
	return false
}

func exists(db *gorm.DB, model interface{}, id uuid.UUID) bool {
	var count int64
	db.Model(model).Where("id = ?", id).Count(&count)
	return count > 0
}

func splitIDs(s string) []string {
	return strings.Split(s, ",")
}
