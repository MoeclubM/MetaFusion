package admin

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	catalogsvc "github.com/metafusion/metafusion-app/internal/catalog"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/mailer"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/search"
	"gorm.io/gorm"
)

type AdminService struct {
	db     *gorm.DB
	search *search.SearchService
	mailer *mailer.Mailer
	queue  *asynq.Client
}

func NewAdminService(db *gorm.DB, searchSvc *search.SearchService, queue *asynq.Client, mailerSvc ...*mailer.Mailer) *AdminService {
	svc := &AdminService{db: db, search: searchSvc, queue: queue}
	if len(mailerSvc) > 0 && mailerSvc[0] != nil {
		svc.mailer = mailerSvc[0]
	} else {
		svc.mailer = mailer.NewMailer(db)
	}
	return svc
}

// GetStats 获取全站运行指标统计
func (s *AdminService) GetStats(c *gin.Context) {
	var totalUsers, totalWorks, totalReleases, verifiedReleases int64
	var totalMediums, totalTracks, totalAssets, totalStorageBytes int64
	var totalTopics, totalComments int64

	s.db.Model(&models.User{}).Count(&totalUsers)
	s.db.Model(&models.Work{}).Count(&totalWorks)
	s.db.Model(&models.Release{}).Count(&totalReleases)
	s.db.Model(&models.Release{}).Where("is_master_verified = true").Count(&verifiedReleases)
	s.db.Model(&models.Medium{}).Count(&totalMediums)
	s.db.Model(&models.Track{}).Count(&totalTracks)
	s.db.Model(&models.DiscussionTopic{}).Count(&totalTopics)
	s.db.Model(&models.Comment{}).Count(&totalComments)

	totalAssets, totalStorageBytes, pendingAssets, processingAssets, failedAssets, completedAssets := s.assetStats()

	var totalBoards, totalTags, totalGroups int64
	s.db.Model(&models.ForumBoard{}).Count(&totalBoards)
	s.db.Model(&models.Tag{}).Count(&totalTags)
	s.db.Model(&models.UserGroup{}).Count(&totalGroups)

	c.JSON(http.StatusOK, gin.H{
		"total_users":         totalUsers,
		"total_works":         totalWorks,
		"total_releases":      totalReleases,
		"verified_releases":   verifiedReleases,
		"total_mediums":       totalMediums,
		"total_tracks":        totalTracks,
		"total_assets":        totalAssets,
		"total_asset_files":   totalAssets, // compatibility key for existing admin clients
		"total_storage_bytes": totalStorageBytes,
		"total_topics":        totalTopics,
		"total_comments":      totalComments,
		"pending_assets":      pendingAssets,
		"processing_assets":   processingAssets,
		"failed_assets":       failedAssets,
		"completed_assets":    completedAssets,
		"total_boards":        totalBoards,
		"total_tags":          totalTags,
		"total_groups":        totalGroups,
	})
}

// ListUsers 获取用户列表（支持按 username/display_name/email 搜索，分页）
func (s *AdminService) ListUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	role := c.Query("role")
	queryStr := c.Query("q")

	query := s.db.Model(&models.User{}).Preload("Inviter")
	if role != "" {
		query = query.Where("role = ?", role)
	}
	if queryStr != "" {
		like := "%" + queryStr + "%"
		query = query.Where("username ILIKE ? OR display_name ILIKE ? OR email ILIKE ?", like, like, like)
	}

	var total int64
	query.Count(&total)

	var users []models.User
	offset := (page - 1) * pageSize
	if err := query.Order("created_at desc").Offset(offset).Limit(pageSize).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     users,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// UpdateUserRole 修改用户权限角色（带自保与最后 admin 保护）
func (s *AdminService) UpdateUserRole(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var input struct {
		Role string `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Role != "admin" && input.Role != "archivist" && input.Role != "member" && input.Role != "banned" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role. Must be admin, archivist, member, or banned"})
		return
	}

	actorIDVal, _ := c.Get("userID")
	actorID, _ := actorIDVal.(uuid.UUID)
	if actorID == userID && input.Role == "banned" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.cannot_ban_self")})
		return
	}
	if actorID == userID && input.Role != "admin" {
		var actor models.User
		if err := s.db.First(&actor, actorID).Error; err == nil && actor.Role == "admin" {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.cannot_demote_self")})
			return
		}
	}

	var before models.User
	_ = s.db.First(&before, userID).Error
	if before.ID == uuid.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "admin.user_not_found")})
		return
	}
	// 最后一名 admin 保护：禁止把唯一 admin 降权/封禁
	if before.Role == "admin" && input.Role != "admin" {
		var adminCount int64
		s.db.Model(&models.User{}).Where("role = ?", "admin").Count(&adminCount)
		if adminCount <= 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.keep_one_admin")})
			return
		}
	}
	if err := s.db.Model(&models.User{}).Where("id = ?", userID).Update("role", input.Role).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "user.role.update", "user", userID.String(), map[string]interface{}{"from": before.Role, "to": input.Role})

	c.JSON(http.StatusOK, gin.H{"status": "success", "role": input.Role})
}

// ListWorks 获取作品管理列表 (分页+筛选，避免全量)
func (s *AdminService) ListWorks(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	q := c.Query("q")
	status := c.Query("status")

	query := s.db.Model(&models.Work{}).
		Preload("Releases.Mediums").
		Preload("Releases.PublisherEntity").
		Preload("Tags")
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("title ILIKE ? OR original_title ILIKE ?", like, like)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	query.Count(&total)
	var works []models.Work
	if err := query.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&works).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 署名单轨化：artist_relations 由 entity_relationships 图边读时投影
	catalogsvc.AttachWorkArtistRelations(s.db, works)
	c.JSON(http.StatusOK, gin.H{"items": works, "total": total, "page": page, "page_size": pageSize})
}

// UpdateWorkStatus 审核作品状态（通过 / 驳回）
func (s *AdminService) UpdateWorkStatus(c *gin.Context) {
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID"})
		return
	}
	var input struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.Status != models.WorkStatusPublished && input.Status != models.WorkStatusPendingReview && input.Status != models.WorkStatusRejected && input.Status != models.WorkStatusCompleted && input.Status != models.WorkStatusDraft {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status"})
		return
	}
	if err := s.db.Model(&models.Work{}).Where("id = ?", workID).Update("status", input.Status).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "work.status.update", "work", workID.String(), map[string]interface{}{"status": input.Status})
	s.refreshWorkSearchIndex(c.Request.Context(), workID)
	c.JSON(http.StatusOK, gin.H{"status": "success", "work_status": input.Status})
}

// ToggleReleaseVerification 切换发行版审核状态
func (s *AdminService) ToggleReleaseVerification(c *gin.Context) {
	releaseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid release ID"})
		return
	}

	var input struct {
		IsVerified bool `json:"is_master_verified"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.db.Model(&models.Release{}).Where("id = ?", releaseID).Update("is_master_verified", input.IsVerified).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "release.verify.toggle", "release", releaseID.String(), map[string]interface{}{"is_master_verified": input.IsVerified})

	c.JSON(http.StatusOK, gin.H{"status": "success", "is_master_verified": input.IsVerified})
}

// DeleteTopic 管理员删除不良或违规主题
func (s *AdminService) DeleteTopic(c *gin.Context) {
	topicID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid topic ID"})
		return
	}
	if err := s.db.Where("id = ?", topicID).Delete(&models.DiscussionTopic{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "topic.delete", "topic", topicID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *AdminService) ListTopicsAdmin(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	q := c.Query("q")
	board := c.Query("board_code")
	query := s.db.Model(&models.DiscussionTopic{}).Preload("User")
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("title ILIKE ? OR content ILIKE ? OR EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.topic_id = discussion_topics.id AND fp.content ILIKE ?)", like, like, like)
	}
	if board != "" && board != "all" {
		query = query.Where("board_code = ?", board)
	}
	var total int64
	query.Count(&total)
	var topics []models.DiscussionTopic
	if err := query.Order("is_pinned desc, COALESCE(pinned_at, created_at) desc, created_at desc").Offset((page-1)*pageSize).Limit(pageSize).Find(&topics).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": topics, "total": total, "page": page, "page_size": pageSize})
}

func (s *AdminService) ListCommentsAdmin(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	topicIDStr := c.Query("topic_id")
	query := s.db.Model(&models.Comment{}).Preload("User")
	if topicIDStr != "" {
		if tid, err := uuid.Parse(topicIDStr); err == nil {
			query = query.Where("topic_id = ?", tid)
		}
	}
	var total int64
	query.Count(&total)
	var comments []models.Comment
	if err := query.Order("created_at desc").Offset((page-1)*pageSize).Limit(pageSize).Find(&comments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": comments, "total": total, "page": page, "page_size": pageSize})
}

func (s *AdminService) DeleteComment(c *gin.Context) {
	commentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid comment ID"})
		return
	}
	if err := s.db.Where("id = ?", commentID).Delete(&models.Comment{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "comment.delete", "comment", commentID.String(), nil)
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}
