package community

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

type userProfileResponse struct {
	User  models.User `json:"user"`
	Stats struct {
		WorksCreated    int64 `json:"works_created"`
		ReleasesCreated int64 `json:"releases_created"`
		ArtistsCreated  int64 `json:"artists_created"`
		TopicsCreated   int64 `json:"topics_created"`
		CommentsCreated int64 `json:"comments_created"`
		AuditActions    int64 `json:"audit_actions"`
		RevisionsCount  int64 `json:"revisions_count"`
		InvitedCount    int64 `json:"invited_count"`
		FavoritesCount  int64 `json:"favorites_count"`
	} `json:"stats"`
}

func GetUserProfile(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		idStr := c.Param("id")
		uid, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
			return
		}
		var user models.User
		if err := db.Select("id", "username", "display_name", "email", "email_public", "favorites_public", "role", "avatar_url", "bio", "created_at", "invited_by", "invite_code").First(&user, "id = ?", uid).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		var resp userProfileResponse
		resp.User = user
		db.Model(&models.Work{}).Where("created_by = ?", uid).Count(&resp.Stats.WorksCreated)
		db.Model(&models.Release{}).Where("uploader_id = ?", uid).Count(&resp.Stats.ReleasesCreated)
		db.Model(&models.Artist{}).Where("created_by = ?", uid).Count(&resp.Stats.ArtistsCreated)
		db.Model(&models.DiscussionTopic{}).Where("user_id = ?", uid).Count(&resp.Stats.TopicsCreated)
		db.Model(&models.ForumPost{}).Where("user_id = ? AND post_number > 1", uid).Count(&resp.Stats.CommentsCreated)
		db.Model(&models.AdminAuditLog{}).Where("actor_id = ?", uid).Count(&resp.Stats.AuditActions)
		db.Model(&models.EntityRevision{}).Where("editor_id = ?", uid).Count(&resp.Stats.RevisionsCount)
		db.Model(&models.User{}).Where("invited_by = ?", uid).Count(&resp.Stats.InvitedCount)
		db.Model(&models.Favorite{}).Where("user_id = ?", uid).Count(&resp.Stats.FavoritesCount)

		// 隐私控制：非本人时抹除未公开的邮箱与专属邀请码；本人始终可见
		viewerID, hasViewer := c.Get("userID")
		isSelf := hasViewer && viewerID.(uuid.UUID) == uid
		if !isSelf {
			if !user.EmailPublic {
				resp.User.Email = ""
			}
			resp.User.InviteCode = ""
		}
		c.JSON(http.StatusOK, resp)
	}
}

func GetUserContributions(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		idStr := c.Param("id")
		uid, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
			return
		}
		tab := c.DefaultQuery("tab", "all")
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
		if page < 1 {
			page = 1
		}
		if pageSize < 1 || pageSize > 100 {
			pageSize = 20
		}
		offset := (page - 1) * pageSize

		switch tab {
		case "works":
			var total int64
			q := db.Model(&models.Work{}).Where("created_by = ?", uid)
			q.Count(&total)
			var items []models.Work
			q.Preload("Translations").Order("created_at desc").Offset(offset).Limit(pageSize).Find(&items)
			c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
		case "releases":
			var total int64
			q := db.Model(&models.Release{}).Where("uploader_id = ?", uid)
			q.Count(&total)
			var items []models.Release
			q.Preload("Work").Preload("Work.Translations").Preload("PublisherEntity").Order("created_at desc").Offset(offset).Limit(pageSize).Find(&items)
			c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
		case "artists":
			var total int64
			q := db.Model(&models.Artist{}).Where("created_by = ?", uid)
			q.Count(&total)
			var items []models.Artist
			q.Preload("Translations").Order("created_at desc").Offset(offset).Limit(pageSize).Find(&items)
			c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
		case "topics":
			var total int64
			q := db.Model(&models.DiscussionTopic{}).Where("user_id = ?", uid)
			q.Count(&total)
			var items []models.DiscussionTopic
			q.Preload("User").Order("created_at desc").Offset(offset).Limit(pageSize).Find(&items)
			c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
		case "comments":
			var total int64
			q := db.Model(&models.Comment{}).Where("user_id = ?", uid)
			q.Count(&total)
			var items []models.Comment
			q.Order("created_at desc").Offset(offset).Limit(pageSize).Find(&items)
			c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
		case "revisions":
			var total int64
			q := db.Model(&models.EntityRevision{}).Where("editor_id = ?", uid)
			q.Count(&total)
			var items []models.EntityRevision
			q.Preload("Editor").Order("created_at desc").Offset(offset).Limit(pageSize).Find(&items)

			type RevisionItem struct {
				models.EntityRevision
				TargetTitle string `json:"target_title,omitempty"`
			}
			resultItems := make([]RevisionItem, 0, len(items))
			for _, rev := range items {
				var title string
				switch rev.TargetType {
				case "work":
					var w models.Work
					if err := db.Select("title").First(&w, "id = ?", rev.TargetID).Error; err == nil {
						title = w.Title
					}
				case "release":
					var r models.Release
					if err := db.Select("edition_name").First(&r, "id = ?", rev.TargetID).Error; err == nil {
						title = r.EditionName
					}
				case "artist":
					var a models.Artist
					if err := db.Select("name").First(&a, "id = ?", rev.TargetID).Error; err == nil {
						title = a.Name
					}
				case "franchise":
					var f models.Franchise
					if err := db.Select("title").First(&f, "id = ?", rev.TargetID).Error; err == nil {
						title = f.Title
					}
				}
				resultItems = append(resultItems, RevisionItem{
					EntityRevision: rev,
					TargetTitle:    title,
				})
			}
			c.JSON(http.StatusOK, gin.H{"items": resultItems, "total": total, "page": page, "page_size": pageSize})
		case "audits":
			var total int64
			q := db.Model(&models.AdminAuditLog{}).Where("actor_id = ?", uid)
			q.Count(&total)
			var items []models.AdminAuditLog
			q.Order("created_at desc").Offset(offset).Limit(pageSize).Find(&items)
			c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
		default:
			// all: query revisions first, if none then audit logs
			var revTotal int64
			db.Model(&models.EntityRevision{}).Where("editor_id = ?", uid).Count(&revTotal)
			if revTotal > 0 {
				var items []models.EntityRevision
				db.Preload("Editor").Where("editor_id = ?", uid).Order("created_at desc").Offset(offset).Limit(pageSize).Find(&items)

				type RevisionItem struct {
					models.EntityRevision
					TargetTitle string `json:"target_title,omitempty"`
				}
				resultItems := make([]RevisionItem, 0, len(items))
				for _, rev := range items {
					var title string
					switch rev.TargetType {
					case "work":
						var w models.Work
						if err := db.Select("title").First(&w, "id = ?", rev.TargetID).Error; err == nil {
							title = w.Title
						}
					case "release":
						var r models.Release
						if err := db.Select("edition_name").First(&r, "id = ?", rev.TargetID).Error; err == nil {
							title = r.EditionName
						}
					case "artist":
						var a models.Artist
						if err := db.Select("name").First(&a, "id = ?", rev.TargetID).Error; err == nil {
							title = a.Name
						}
					case "franchise":
						var f models.Franchise
						if err := db.Select("title").First(&f, "id = ?", rev.TargetID).Error; err == nil {
							title = f.Title
						}
					}
					resultItems = append(resultItems, RevisionItem{
						EntityRevision: rev,
						TargetTitle:    title,
					})
				}
				c.JSON(http.StatusOK, gin.H{"items": resultItems, "total": revTotal, "page": page, "page_size": pageSize, "tab": "all"})
				return
			}

			var audits []models.AdminAuditLog
			db.Where("actor_id = ?", uid).Order("created_at desc").Limit(pageSize).Offset(offset).Find(&audits)
			var total int64
			db.Model(&models.AdminAuditLog{}).Where("actor_id = ?", uid).Count(&total)
			c.JSON(http.StatusOK, gin.H{"items": audits, "total": total, "page": page, "page_size": pageSize, "tab": "all"})
		}
	}
}
