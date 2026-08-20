package community

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

type CommunityService struct {
	db *gorm.DB
}

func NewCommunityService(db *gorm.DB) *CommunityService {
	return &CommunityService{db: db}
}

// ListBoards 获取分区列表 (公开，支持 include_disabled，按 locale 返回 name 叠加 names)
func (s *CommunityService) ListBoards(c *gin.Context) {
	includeDisabled := c.Query("include_disabled") == "true" || c.Query("include_disabled") == "1"
	query := s.db.Model(&models.ForumBoard{})
	if !includeDisabled {
		query = query.Where("is_enabled = true")
	}
	var boards []models.ForumBoard
	if err := query.Order("sort_order asc, code asc").Find(&boards).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	locale := backendi18n.LocaleFromContext(c)
	// 在保留原始字段的同时，叠加本地化 name 回退字段，便于前端直接按 name 展示
	type boardOut struct {
		models.ForumBoard
		Name string `json:"name"`
	}
	out := make([]boardOut, 0, len(boards))
	for _, b := range boards {
		out = append(out, boardOut{ForumBoard: b, Name: b.LocalizedName(locale)})
	}
	c.JSON(http.StatusOK, out)
}

func isValidBoardCode(db *gorm.DB, code string) bool {
	if code == "" || code == "all" {
		return true
	}
	var cnt int64
	db.Model(&models.ForumBoard{}).Where("code = ? AND is_enabled = true", code).Count(&cnt)
	return cnt > 0
}

// ListTopics 获取论坛帖子列表 (支持按分区、按作品、标签、关键词、语种筛选)
// board_code=all 为聚合信息流，自动排除 show_in_feed=false 的评论专用分区；language 叠加过滤
func (s *CommunityService) ListTopics(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	boardCode := c.Query("board_code")
	categoryCode := c.Query("category_code")
	workIDStr := c.Query("work_id")
	searchQuery := c.Query("q")
	tagIDStr := c.Query("tag_id")
	tagName := c.Query("tag")
	language := c.Query("language")
	if language == "all" {
		language = ""
	} else if language != "" && !models.ValidLocales[language] {
		language = models.NormalizeLocale(language)
	}

	query := s.db.Model(&models.DiscussionTopic{}).
		Preload("User").
		Preload("Work.Category").
		Preload("Tags")

	if boardCode != "" && boardCode != "all" {
		query = query.Where("board_code = ?", boardCode)
	} else if boardCode == "all" {
		query = query.Where("board_code IN (SELECT code FROM forum_boards WHERE show_in_feed = true AND is_enabled = true)")
	} else if boardCode == "" {
		query = query.Where("board_code IN (SELECT code FROM forum_boards WHERE show_in_feed = true AND is_enabled = true)")
	}
	if language != "" {
		query = query.Where("language = ?", language)
	}
	if categoryCode != "" {
		query = query.Where("category_code = ?", categoryCode)
	}
	if workIDStr != "" {
		if workID, err := uuid.Parse(workIDStr); err == nil {
			query = query.Where("work_id = ?", workID)
		}
	}
	if searchQuery != "" {
		like := "%" + searchQuery + "%"
		query = query.Where("title ILIKE ? OR content ILIKE ? OR EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.topic_id = discussion_topics.id AND fp.content ILIKE ?)", like, like, like)
	}
	// 标签筛选
	if tagIDStr != "" {
		if tagID, err := strconv.Atoi(tagIDStr); err == nil {
			query = query.Where("id IN (SELECT topic_id FROM topic_tag_relations WHERE tag_id = ?)", tagID)
		}
	} else if tagName != "" {
		query = query.Where("id IN (SELECT ttr.topic_id FROM topic_tag_relations ttr JOIN tags t ON t.id = ttr.tag_id WHERE t.name = ?)", tagName)
	}

	var total int64
	query.Count(&total)

	var topics []models.DiscussionTopic
	offset := (page - 1) * pageSize
	if err := query.Order("is_pinned desc, COALESCE(pinned_at, created_at) desc, created_at desc").Offset(offset).Limit(pageSize).Find(&topics).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items": topics,
		"total": total,
		"page":  page,
	})
}

// GetTopic 获取论坛帖子详情及全部回复（Discourse 风格 posts 统一流）
func (s *CommunityService) GetTopic(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid topic ID"})
		return
	}

	var topic models.DiscussionTopic
	if err := s.db.Preload("User").
		Preload("Work.Category").
		Preload("Tags").
		Preload("Posts", func(db *gorm.DB) *gorm.DB { return db.Order("post_number asc") }).
		Preload("Posts.User").
		Preload("Comments.User").
		Where("id = ?", id).
		First(&topic).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Topic not found"})
		return
	}

	// 增加浏览量
	s.db.Model(&models.DiscussionTopic{}).Where("id = ?", topic.ID).UpdateColumn("view_count", gorm.Expr("view_count + 1"))
	topic.ViewCount++

	// Compat fallback: if no posts yet (pre-migration or direct DB insert), synthesize #1 from topic.content
	if len(topic.Posts) == 0 && topic.Content != "" {
		topic.Posts = []models.ForumPost{{
			ID:         uuid.Nil,
			TopicID:    topic.ID,
			PostNumber: 1,
			UserID:     topic.UserID,
			Content:    topic.Content,
			CreatedAt:  topic.CreatedAt,
			UpdatedAt:  topic.UpdatedAt,
			User:       topic.User,
		}}
	}

	c.JSON(http.StatusOK, topic)
}

// CreateTopic 在论坛发表新帖子 (可自由选择分区、关联作品与标签) — 事务内同时创建 ForumPost #1
func (s *CommunityService) CreateTopic(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)

	var input struct {
		BoardCode    string     `json:"board_code"`
		Title        string     `json:"title" binding:"required"`
		Content      string     `json:"content" binding:"required"`
		WorkID       *uuid.UUID `json:"work_id"`
		ReleaseID    *uuid.UUID `json:"release_id"`
		CategoryCode *string    `json:"category_code"`
		Language     string     `json:"language"`
		TagIDs       []uint     `json:"tag_ids"`
		TagNames     []string   `json:"tag_names"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	boardCode := input.BoardCode
	if boardCode == "" {
		if input.WorkID != nil {
			boardCode = "comment"
		} else {
			boardCode = "announcement"
		}
	}
	if !isValidBoardCode(s.db, boardCode) {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "community.invalid_board")})
		return
	}

	lang := input.Language
	if lang == "" {
		lang = backendi18n.LocaleFromContext(c)
	} else {
		lang = models.NormalizeLocale(lang)
	}

	var topic models.DiscussionTopic
	err := s.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		topic = models.DiscussionTopic{
			UserID:       userID,
			BoardCode:    boardCode,
			Title:        input.Title,
			Content:      input.Content,
			Language:     lang,
			WorkID:       input.WorkID,
			ReleaseID:    input.ReleaseID,
			CategoryCode: input.CategoryCode,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := tx.Create(&topic).Error; err != nil {
			return err
		}
		// Discourse #1: topic initial content as first post (dual-write compat)
		fp := models.ForumPost{
			TopicID:    topic.ID,
			PostNumber: 1,
			UserID:     userID,
			Content:    input.Content,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		if err := tx.Create(&fp).Error; err != nil {
			return err
		}
		// 关联标签：优先按 ID，其次按名称（不存在则创建 group_type=topic 的标签）
		var tags []models.Tag
		if len(input.TagIDs) > 0 {
			tx.Where("id IN ?", input.TagIDs).Find(&tags)
		}
		if len(input.TagNames) > 0 {
			for _, raw := range input.TagNames {
				name := strings.TrimSpace(raw)
				if name == "" {
					continue
				}
				skip := false
				for _, t := range tags {
					if t.Name == name {
						skip = true
						break
					}
				}
				if skip {
					continue
				}
				var tag models.Tag
				if err := tx.Where("name = ?", name).First(&tag).Error; err != nil {
					tag = models.Tag{Name: name, GroupType: "topic"}
					if err := tx.Create(&tag).Error; err != nil {
						continue
					}
				}
				tags = append(tags, tag)
			}
		}
		if len(tags) > 0 {
			if err := tx.Model(&topic).Association("Tags").Append(&tags); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	s.db.Preload("User").Preload("Work.Category").Preload("Tags").
		Preload("Posts", func(db *gorm.DB) *gorm.DB { return db.Order("post_number asc") }).Preload("Posts.User").
		Where("id = ?", topic.ID).First(&topic)
	c.JSON(http.StatusCreated, topic)
}

// CreatePost 创建统一回复（Discourse 风格）
// POST /community/topics/:id/posts  body {content, reply_to_post_number?, reply_to_post_id?}
func (s *CommunityService) CreatePost(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	topicID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid topic ID"})
		return
	}

	var input struct {
		Content            string     `json:"content" binding:"required"`
		ReplyToPostNumber *int       `json:"reply_to_post_number"`
		ReplyToPostID     *uuid.UUID `json:"reply_to_post_id"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var created models.ForumPost
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var topic models.DiscussionTopic
		if err := tx.Where("id = ?", topicID).First(&topic).Error; err != nil {
			return err
		}
		// Allocate next post_number with row-level lock
		var maxNum int
		if err := tx.Raw("SELECT COALESCE(MAX(post_number),0) FROM forum_posts WHERE topic_id = ? FOR UPDATE", topicID).Scan(&maxNum).Error; err != nil {
			return err
		}
		nextNum := maxNum + 1
		// If table had no row but topic already existed before migration, ensure #1 exists
		if maxNum == 0 {
			var cnt int64
			tx.Model(&models.ForumPost{}).Where("topic_id = ? AND post_number = 1", topicID).Count(&cnt)
			if cnt == 0 {
				// Backfill #1 inside this transaction before allocating reply
				fp1 := models.ForumPost{
					TopicID:    topicID,
					PostNumber: 1,
					UserID:     topic.UserID,
					Content:    topic.Content,
					CreatedAt:  topic.CreatedAt,
					UpdatedAt:  topic.UpdatedAt,
				}
				if err := tx.Create(&fp1).Error; err != nil {
					return err
				}
				maxNum = 1
				nextNum = 2
			}
		}

		var replyToPostNumber *int
		var replyToPostID *uuid.UUID

		if input.ReplyToPostNumber != nil {
			var parent models.ForumPost
			if err := tx.Where("topic_id = ? AND post_number = ?", topicID, *input.ReplyToPostNumber).First(&parent).Error; err == nil {
				replyToPostNumber = input.ReplyToPostNumber
				replyToPostID = &parent.ID
			} else {
				// keep number even if parent not found (do not fail)
				replyToPostNumber = input.ReplyToPostNumber
			}
		} else if input.ReplyToPostID != nil {
			var parent models.ForumPost
			if err := tx.Where("id = ? AND topic_id = ?", *input.ReplyToPostID, topicID).First(&parent).Error; err == nil {
				replyToPostID = input.ReplyToPostID
				n := parent.PostNumber
				replyToPostNumber = &n
			} else {
				replyToPostID = input.ReplyToPostID
			}
		}

		now := time.Now()
		created = models.ForumPost{
			TopicID:           topicID,
			PostNumber:        nextNum,
			UserID:            userID,
			Content:           input.Content,
			ReplyToPostNumber: replyToPostNumber,
			ReplyToPostID:     replyToPostID,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if err := tx.Create(&created).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.DiscussionTopic{}).Where("id = ?", topicID).UpdateColumn("reply_count", gorm.Expr("reply_count + 1")).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Topic not found"})
			return
		}
		// Unique constraint retry hint
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusConflict, gin.H{"error": "Post number conflict, please retry"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	s.db.Preload("User").Where("id = ?", created.ID).First(&created)
	c.JSON(http.StatusCreated, created)
}

// ListWorkComments 获取关联作品的文献评注论坛主题
func (s *CommunityService) ListWorkComments(c *gin.Context) {
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID"})
		return
	}

	var topics []models.DiscussionTopic
	if err := s.db.Where("work_id = ?", workID).
		Preload("User").
		Preload("Tags").
		Preload("Posts", func(db *gorm.DB) *gorm.DB { return db.Order("post_number asc") }).Preload("Posts.User").
		Order("created_at desc").
		Find(&topics).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, topics)
}

// CreateWorkComment 在作品详情页直接发起文献考注主题 (事务内创建 ForumPost #1)
func (s *CommunityService) CreateWorkComment(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	workID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid work ID"})
		return
	}

	var input struct {
		Title     string     `json:"title"`
		Content   string     `json:"content" binding:"required"`
		ReleaseID *uuid.UUID `json:"release_id"`
		Language  string     `json:"language"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	title := input.Title
	if title == "" {
		if len([]rune(input.Content)) > 30 {
			title = string([]rune(input.Content)[:30]) + "..."
		} else {
			title = input.Content
		}
	}
	lang := input.Language
	if lang == "" {
		lang = backendi18n.LocaleFromContext(c)
	} else {
		lang = models.NormalizeLocale(lang)
	}

	var topic models.DiscussionTopic
	err = s.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		topic = models.DiscussionTopic{
			UserID:    userID,
			BoardCode: "comment",
			Language:  lang,
			WorkID:    &workID,
			ReleaseID: input.ReleaseID,
			Title:     title,
			Content:   input.Content,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := tx.Create(&topic).Error; err != nil {
			return err
		}
		fp := models.ForumPost{
			TopicID:    topic.ID,
			PostNumber: 1,
			UserID:     userID,
			Content:    input.Content,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		if err := tx.Create(&fp).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	s.db.Preload("User").Preload("Tags").
		Preload("Posts", func(db *gorm.DB) *gorm.DB { return db.Order("post_number asc") }).Preload("Posts.User").
		Where("id = ?", topic.ID).First(&topic)
	c.JSON(http.StatusCreated, topic)
}

// ListTopicTags 获取论坛可用标签（按 group_type=topic 过滤，可按 q 搜索）
func (s *CommunityService) ListTopicTags(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	query := s.db.Model(&models.Tag{}).Where("group_type = ?", "topic")
	if q != "" {
		query = query.Where("name ILIKE ?", "%"+q+"%")
	}
	var tags []models.Tag
	if err := query.Order("name asc").Find(&tags).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tags)
}
