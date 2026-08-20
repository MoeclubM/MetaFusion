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

type MessageService struct {
	db *gorm.DB
}

func NewMessageService(db *gorm.DB) *MessageService {
	return &MessageService{db: db}
}

type SendMessageRequest struct {
	Content string `json:"content" binding:"required"`
}

// SendMessage 发送私聊消息给指定用户
func (s *MessageService) SendMessage(c *gin.Context) {
	currentUserID := c.MustGet("userID").(uuid.UUID)
	targetIDStr := c.Param("user_id")
	targetUserID, err := uuid.Parse(targetIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.user_not_found")})
		return
	}

	if currentUserID == targetUserID {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "messages.cannot_message_self")})
		return
	}

	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "messages.content_required")})
		return
	}

	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "messages.content_required")})
		return
	}
	if len(content) > 5000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "messages.content_too_long")})
		return
	}

	// 检查目标用户是否存在
	var targetUser models.User
	if err := s.db.Select("id, username, role, avatar_url, bio, created_at").First(&targetUser, "id = ?", targetUserID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "admin.user_not_found")})
		return
	}

	now := time.Now()
	msg := models.DirectMessage{
		SenderID:   currentUserID,
		ReceiverID: targetUserID,
		Content:    content,
		IsRead:     false,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	if err := s.db.Create(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 加载 Sender 信息
	var sender models.User
	_ = s.db.Select("id, username, role, avatar_url").First(&sender, "id = ?", currentUserID)
	msg.Sender = &sender
	msg.Receiver = &targetUser

	c.JSON(http.StatusOK, msg)
}

// GetMessagesWithUser 获取与指定用户的私聊历史，并自动将对方发给自己的未读消息标记为已读
func (s *MessageService) GetMessagesWithUser(c *gin.Context) {
	currentUserID := c.MustGet("userID").(uuid.UUID)
	targetIDStr := c.Param("user_id")
	targetUserID, err := uuid.Parse(targetIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "admin.user_not_found")})
		return
	}

	var targetUser models.User
	if err := s.db.Select("id, username, role, avatar_url, bio, created_at").First(&targetUser, "id = ?", targetUserID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "admin.user_not_found")})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}

	query := s.db.Model(&models.DirectMessage{}).
		Where("((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))",
			currentUserID, targetUserID, targetUserID, currentUserID)

	var total int64
	query.Count(&total)

	var messages []models.DirectMessage
	offset := (page - 1) * pageSize
	if err := query.
		Preload("Sender", func(db *gorm.DB) *gorm.DB { return db.Select("id, username, role, avatar_url") }).
		Preload("Receiver", func(db *gorm.DB) *gorm.DB { return db.Select("id, username, role, avatar_url") }).
		Order("created_at asc").
		Offset(offset).
		Limit(pageSize).
		Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 标记来自对方的未读私聊为已读
	go func(senderID, receiverID uuid.UUID) {
		s.db.Model(&models.DirectMessage{}).
			Where("sender_id = ? AND receiver_id = ? AND is_read = false", senderID, receiverID).
			Update("is_read", true)
	}(targetUserID, currentUserID)

	c.JSON(http.StatusOK, gin.H{
		"peer":     targetUser,
		"messages": messages,
		"total":    total,
		"page":     page,
	})
}

type ConversationItem struct {
	Peer        models.User           `json:"peer"`
	LastMessage *models.DirectMessage `json:"last_message"`
	UnreadCount int64                 `json:"unread_count"`
}

// ListConversations 列出当前用户的所有私聊对话列表
func (s *MessageService) ListConversations(c *gin.Context) {
	currentUserID := c.MustGet("userID").(uuid.UUID)

	// 查询所有与当前用户发生过私聊的 peer IDs
	type PeerRecord struct {
		PeerID uuid.UUID `gorm:"column:peer_id"`
	}
	var peers []PeerRecord
	err := s.db.Raw(`
		SELECT DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS peer_id
		FROM direct_messages
		WHERE sender_id = ? OR receiver_id = ?
	`, currentUserID, currentUserID, currentUserID).Scan(&peers).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	conversations := make([]ConversationItem, 0, len(peers))
	for _, p := range peers {
		var user models.User
		if err := s.db.Select("id, username, role, avatar_url, bio, created_at").First(&user, "id = ?", p.PeerID).Error; err != nil {
			continue
		}

		var lastMsg models.DirectMessage
		s.db.Where("((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))",
			currentUserID, p.PeerID, p.PeerID, currentUserID).
			Order("created_at desc").
			First(&lastMsg)

		var unread int64
		s.db.Model(&models.DirectMessage{}).
			Where("sender_id = ? AND receiver_id = ? AND is_read = false", p.PeerID, currentUserID).
			Count(&unread)

		conversations = append(conversations, ConversationItem{
			Peer:        user,
			LastMessage: &lastMsg,
			UnreadCount: unread,
		})
	}

	c.JSON(http.StatusOK, conversations)
}

// GetUnreadCount 获取当前用户总的未读私聊数
func (s *MessageService) GetUnreadCount(c *gin.Context) {
	currentUserID := c.MustGet("userID").(uuid.UUID)
	var count int64
	s.db.Model(&models.DirectMessage{}).
		Where("receiver_id = ? AND is_read = false", currentUserID).
		Count(&count)

	c.JSON(http.StatusOK, gin.H{"unread_count": count})
}
