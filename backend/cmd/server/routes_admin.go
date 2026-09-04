package main

import (
	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/admin"
	"github.com/metafusion/metafusion-app/internal/auth"
	"github.com/metafusion/metafusion-app/internal/catalog"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/plugin"
	"gorm.io/gorm"
)

func registerAdminRoutes(
	api *gin.RouterGroup,
	cfg *config.Config,
	db *gorm.DB,
	adminSvc *admin.AdminService,
	systemHealthSvc *admin.SystemHealthService,
	catalogSvc *catalog.CatalogService,
	pluginHandler *plugin.Handler,
) {
	registerAdminSystemRoutes(api, cfg, db, adminSvc, systemHealthSvc, pluginHandler)
	registerCurationRoutes(api, cfg, db, adminSvc, catalogSvc)
}

func registerAdminSystemRoutes(
	api *gin.RouterGroup,
	cfg *config.Config,
	db *gorm.DB,
	adminSvc *admin.AdminService,
	systemHealthSvc *admin.SystemHealthService,
	pluginHandler *plugin.Handler,
) {
	adminGroup := api.Group("/admin", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireRoles("admin"))
	adminGroup.GET("/stats", adminSvc.GetStats)
	adminGroup.GET("/users", adminSvc.ListUsers)
	adminGroup.PUT("/users/:id", adminSvc.UpdateUser)
	adminGroup.PUT("/users/:id/role", adminSvc.UpdateUserRole)
	adminGroup.PUT("/users/roles/batch", adminSvc.BatchUpdateUserRoles)
	adminGroup.GET("/user-groups", adminSvc.ListUserGroups)
	adminGroup.POST("/user-groups", adminSvc.CreateUserGroup)
	adminGroup.PUT("/user-groups/:id", adminSvc.UpdateUserGroup)
	adminGroup.DELETE("/user-groups/:id", adminSvc.DeleteUserGroup)
	adminGroup.POST("/user-groups/:id/members", adminSvc.AddUserToGroup)
	adminGroup.DELETE("/user-groups/:id/members/:user_id", adminSvc.RemoveUserFromGroup)
	adminGroup.GET("/invitations", adminSvc.ListInvitations)

	adminGroup.GET("/settings", adminSvc.GetSystemSettings)
	adminGroup.PUT("/settings", adminSvc.UpdateSystemSettings)
	adminGroup.POST("/settings/test-email", adminSvc.TestSendEmail)

	adminGroup.GET("/audit-logs", adminSvc.ListAuditLogs)
	adminGroup.GET("/system/health", systemHealthSvc.GetDetailedHealth)
	adminGroup.GET("/system/queues", systemHealthSvc.GetQueueStats)
	adminGroup.POST("/system/queues/:name/pause", systemHealthSvc.PauseQueue)
	adminGroup.POST("/system/queues/:name/unpause", systemHealthSvc.UnpauseQueue)

	adminGroup.GET("/plugins", pluginHandler.ListAdminPlugins)
	adminGroup.GET("/plugins/:id", pluginHandler.GetAdminPlugin)
	adminGroup.POST("/plugins", pluginHandler.RegisterExternalPlugin)
	adminGroup.PUT("/plugins/:id", pluginHandler.UpdatePlugin)
	adminGroup.DELETE("/plugins/:id", pluginHandler.DeletePlugin)
	adminGroup.POST("/plugins/:id/test", pluginHandler.TestPluginHealth)
	adminGroup.POST("/plugins/test-notify", pluginHandler.TestNotify)
}

func registerCurationRoutes(
	api *gin.RouterGroup,
	cfg *config.Config,
	db *gorm.DB,
	adminSvc *admin.AdminService,
	catalogSvc *catalog.CatalogService,
) {
	curationGroup := api.Group("/admin", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireRoles("admin", "archivist"))

	curationGroup.GET("/works", adminSvc.ListWorks)
	curationGroup.POST("/works", adminSvc.CreateWork)
	curationGroup.PUT("/works/:id", adminSvc.UpdateWork)
	curationGroup.PUT("/works/:id/status", adminSvc.UpdateWorkStatus)
	curationGroup.DELETE("/works/:id", adminSvc.DeleteWork)

	curationGroup.GET("/releases", adminSvc.ListReleasesAdmin)
	curationGroup.POST("/releases", adminSvc.CreateRelease)
	curationGroup.PUT("/releases/:id", adminSvc.UpdateRelease)
	curationGroup.PUT("/releases/:id/verify", adminSvc.ToggleReleaseVerification)
	curationGroup.DELETE("/releases/:id", adminSvc.DeleteRelease)

	curationGroup.POST("/mediums", adminSvc.CreateMedium)
	curationGroup.DELETE("/mediums/:id", adminSvc.DeleteMedium)
	curationGroup.POST("/tracks", adminSvc.CreateTrack)
	curationGroup.DELETE("/tracks/:id", adminSvc.DeleteTrack)

	curationGroup.GET("/shelves", adminSvc.ListVirtualShelves)
	curationGroup.POST("/shelves", adminSvc.CreateVirtualShelf)
	curationGroup.PUT("/shelves/:slug", adminSvc.UpdateVirtualShelf)
	curationGroup.DELETE("/shelves/:slug", adminSvc.DeleteVirtualShelf)
	curationGroup.GET("/tags", adminSvc.ListTagsAdmin)
	curationGroup.POST("/tags", adminSvc.CreateTag)
	curationGroup.PUT("/tags/:id", adminSvc.UpdateTag)
	curationGroup.DELETE("/tags/:id", adminSvc.DeleteTag)

	curationGroup.GET("/artists", adminSvc.ListArtistsAdmin)
	curationGroup.POST("/artists", adminSvc.CreateArtist)
	curationGroup.PUT("/artists/:id", adminSvc.UpdateArtist)
	curationGroup.DELETE("/artists/:id", adminSvc.DeleteArtist)

	curationGroup.GET("/franchises", catalogSvc.ListFranchises)
	curationGroup.POST("/franchises", catalogSvc.CreateFranchiseForMember)
	curationGroup.DELETE("/franchises/:id", adminSvc.DeleteFranchise)

	curationGroup.GET("/canonical-entries", adminSvc.ListCanonicalEntries)
	curationGroup.POST("/canonical-entries", adminSvc.CreateCanonicalEntry)
	curationGroup.PUT("/canonical-entries/:id", adminSvc.UpdateCanonicalEntry)
	curationGroup.DELETE("/canonical-entries/:id", adminSvc.DeleteCanonicalEntry)

	curationGroup.GET("/assets", adminSvc.ListAssetFiles)
	curationGroup.GET("/assets/:id", adminSvc.GetAssetDetail)
	curationGroup.POST("/assets/:id/retry", adminSvc.RetryAsset)

	curationGroup.GET("/topics", adminSvc.ListTopicsAdmin)
	curationGroup.DELETE("/topics/:id", adminSvc.DeleteTopic)
	curationGroup.PUT("/topics/:id", adminSvc.UpdateTopic)
	curationGroup.GET("/comments", adminSvc.ListCommentsAdmin)
	curationGroup.DELETE("/comments/:id", adminSvc.DeleteComment)

	curationGroup.GET("/boards", adminSvc.ListBoardsAdmin)
	curationGroup.PUT("/boards", adminSvc.UpsertBoard)
	curationGroup.PUT("/boards/:code", adminSvc.UpdateBoard)
	curationGroup.PATCH("/boards/:code", adminSvc.PatchBoard)
	curationGroup.DELETE("/boards/:code", adminSvc.DeleteBoard)

	curationGroup.PUT("/works/:id/relations", adminSvc.UpsertWorkRelations)
	curationGroup.PUT("/entity-relations", adminSvc.UpsertEntityRelations)
	curationGroup.DELETE("/entity-relations/:id", adminSvc.DeleteEntityRelation)
	curationGroup.GET("/relation-types", adminSvc.ListRelationTypesAdmin)
	curationGroup.POST("/relation-types", adminSvc.CreateRelationType)
	curationGroup.PUT("/relation-types/:code", adminSvc.UpdateRelationType)
	curationGroup.DELETE("/relation-types/:code", adminSvc.DeleteRelationType)
	curationGroup.GET("/entity-types", adminSvc.ListEntityTypesAdmin)
	curationGroup.POST("/entity-types", adminSvc.CreateEntityType)
	curationGroup.PUT("/entity-types/:code", adminSvc.UpdateEntityType)
	curationGroup.DELETE("/entity-types/:code", adminSvc.DeleteEntityType)

	curationGroup.GET("/attributes", adminSvc.ListAttributeSchemasAdmin)
	curationGroup.POST("/attributes", adminSvc.CreateAttributeSchema)
	curationGroup.PUT("/attributes/:id", adminSvc.UpdateAttributeSchema)
	curationGroup.DELETE("/attributes/:id", adminSvc.DeleteAttributeSchema)

	curationGroup.GET("/external-databases", adminSvc.ListExternalDatabasesAdmin)
	curationGroup.POST("/external-databases", adminSvc.CreateExternalDatabase)
	curationGroup.PUT("/external-databases/:code", adminSvc.UpdateExternalDatabase)
	curationGroup.DELETE("/external-databases/:code", adminSvc.DeleteExternalDatabase)

	curationGroup.GET("/translations/works/:id", adminSvc.ListWorkTranslations)
	curationGroup.PUT("/translations/works/:id", adminSvc.UpsertWorkTranslations)
	curationGroup.GET("/translations/topics/:id", adminSvc.ListTopicTranslations)
	curationGroup.PUT("/translations/topics/:id", adminSvc.UpsertTopicTranslations)
	curationGroup.GET("/translations/tags/:id", adminSvc.ListTagTranslations)
	curationGroup.PUT("/translations/tags/:id", adminSvc.UpsertTagTranslations)
	curationGroup.GET("/translations/artists/:id", adminSvc.ListArtistTranslations)
	curationGroup.PUT("/translations/artists/:id", adminSvc.UpsertArtistTranslations)
}
