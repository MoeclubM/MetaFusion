package main

import (
	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/auth"
	"github.com/metafusion/metafusion-app/internal/community"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/favorite"
	"gorm.io/gorm"
)

func registerSocialRoutes(
	api *gin.RouterGroup,
	cfg *config.Config,
	db *gorm.DB,
	communitySvc *community.CommunityService,
	messageSvc *community.MessageService,
) {
	// Public profiles and contribution history; handlers enforce privacy settings.
	api.GET("/users/:id", auth.OptionalUnifiedAuthMiddleware(cfg, db), community.GetUserProfile(db))
	api.GET("/users/:id/contributions", auth.OptionalUnifiedAuthMiddleware(cfg, db), community.GetUserContributions(db))

	favGroup := api.Group("/favorites")
	favGroup.POST("/toggle", auth.UnifiedAuthMiddleware(cfg, db), favorite.Toggle(db))
	favGroup.GET("/status", auth.UnifiedAuthMiddleware(cfg, db), favorite.Status(db))
	favGroup.GET("/mine", auth.UnifiedAuthMiddleware(cfg, db), favorite.ListMy(db))
	api.GET("/users/:id/favorites", auth.UnifiedAuthMiddleware(cfg, db), favorite.ListByUser(db))

	messagesGroup := api.Group("/messages", auth.UnifiedAuthMiddleware(cfg, db))
	messagesGroup.POST("/with/:user_id", messageSvc.SendMessage)
	messagesGroup.GET("/with/:user_id", messageSvc.GetMessagesWithUser)
	messagesGroup.GET("/conversations", messageSvc.ListConversations)
	messagesGroup.GET("/unread-count", messageSvc.GetUnreadCount)

	// Community metadata is public to read; authenticated and verified users may write.
	communityGroup := api.Group("/community", auth.OptionalUnifiedAuthMiddleware(cfg, db))
	communityGroup.GET("/boards", communitySvc.ListBoards)
	communityGroup.GET("/topic-tags", communitySvc.ListTopicTags)
	communityGroup.GET("/topics", communitySvc.ListTopics)
	communityGroup.GET("/topics/:id", communitySvc.GetTopic)
	communityGroup.POST("/topics", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), communitySvc.CreateTopic)
	communityGroup.POST("/topics/:id/posts", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), communitySvc.CreatePost)
}
