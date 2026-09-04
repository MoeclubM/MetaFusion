package main

import (
	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/auth"
	"github.com/metafusion/metafusion-app/internal/catalog"
	"github.com/metafusion/metafusion-app/internal/community"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/importer"
	"github.com/metafusion/metafusion-app/internal/plugin"
	"github.com/metafusion/metafusion-app/internal/search"
	"gorm.io/gorm"
)

func registerCatalogRoutes(
	api *gin.RouterGroup,
	cfg *config.Config,
	db *gorm.DB,
	catalogSvc *catalog.CatalogService,
	communitySvc *community.CommunityService,
	importerSvc *importer.ImporterService,
	pluginHandler *plugin.Handler,
	searchSvc *search.SearchService,
) {
	catGroup := api.Group("/catalog")
	catGroup.GET("/taxonomy", catalogSvc.GetTaxonomy)
	catGroup.GET("/relation-types", catalogSvc.ListRelationTypes)
	catGroup.GET("/external-databases", catalogSvc.ListExternalDatabases)
	catGroup.GET("/shelves", catalogSvc.ListShelves)
	catGroup.GET("/tags", catalogSvc.ListTags)
	catGroup.GET("/artists", catalogSvc.ListArtists)
	catGroup.GET("/artists/:id", catalogSvc.GetArtistDetail)
	catGroup.GET("/artists/:id/graph", catalogSvc.GetArtistGraph)
	catGroup.GET("/franchises", catalogSvc.ListFranchises)
	catGroup.GET("/franchises/:id", catalogSvc.GetFranchiseDetail)
	catGroup.GET("/franchises/:id/graph", catalogSvc.GetFranchiseGraph)
	catGroup.GET("/works", catalogSvc.ListWorks)
	catGroup.GET("/works/:id", catalogSvc.GetWorkDetail)
	catGroup.GET("/works/:id/graph", catalogSvc.GetWorkGraph)
	catGroup.GET("/works/:id/comments", communitySvc.ListWorkComments)
	catGroup.POST("/works/:id/comments", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), communitySvc.CreateWorkComment)
	catGroup.GET("/releases", catalogSvc.ListReleases)
	catGroup.GET("/releases/:id", catalogSvc.GetReleaseDetail)
	catGroup.GET("/releases/:id/graph", catalogSvc.GetReleaseGraph)
	catGroup.GET("/canonical-entries", catalogSvc.ListCanonicalEntriesPublic)
	catGroup.GET("/canonical-entries/:id", catalogSvc.GetCanonicalEntryDetail)
	catGroup.GET("/canonical-entries/:id/graph", catalogSvc.GetCanonicalEntryGraph)
	catGroup.PUT("/canonical-entries/:id", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.UpdateCanonicalEntryForMember)
	catGroup.GET("/attributes", catalogSvc.ListAttributeSchemas)
	catGroup.GET("/mediums/:id", catalogSvc.GetMediumDetail)

	catGroup.POST("/artists", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.CreateArtistForMember)
	catGroup.PUT("/artists/:id", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.UpdateArtistForMember)
	catGroup.POST("/franchises", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.CreateFranchiseForMember)
	catGroup.PUT("/franchises/:id", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.UpdateFranchiseForMember)
	catGroup.POST("/works", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.CreateWorkForMember)
	catGroup.PUT("/works/:id", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.UpdateWorkForMember)
	catGroup.POST("/releases", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.CreateReleaseForMember)
	catGroup.PUT("/releases/:id", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.UpdateReleaseForMember)
	catGroup.POST("/mediums", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.CreateMediumForMember)
	catGroup.POST("/tracks", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.CreateTrackForMember)
	catGroup.PUT("/works/:id/relations", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.UpsertWorkRelationsForMember)
	catGroup.PUT("/entity-relations", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.UpsertEntityRelationsForMember)
	catGroup.DELETE("/entity-relations/:id", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.DeleteEntityRelationForMember)
	catGroup.GET("/revisions", catalogSvc.ListEntityRevisions)
	catGroup.POST("/merge", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.MergeEntities)
	catGroup.POST("/submit", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), catalogSvc.SubmitComprehensiveArchive)

	catGroup.GET("/shelves/custom", auth.OptionalUnifiedAuthMiddleware(cfg, db), catalogSvc.ListCustomShelves)
	catGroup.POST("/shelves/custom", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.CreateCustomShelf)
	catGroup.POST("/shelves/custom/sync-presets", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.SyncPresetShelves)
	catGroup.POST("/shelves/custom/ensure-defaults", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.EnsureDefaultShelves)
	catGroup.POST("/shelves/custom/reset-defaults", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.ResetDefaultShelves)
	catGroup.POST("/shelves/custom/fork/:slug", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.ForkPresetShelf)
	catGroup.GET("/shelves/custom/:id", auth.OptionalUnifiedAuthMiddleware(cfg, db), catalogSvc.GetCustomShelf)
	catGroup.PUT("/shelves/custom/:id", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.UpdateCustomShelf)
	catGroup.DELETE("/shelves/custom/:id", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.DeleteCustomShelf)
	catGroup.GET("/home/layout", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.GetHomeLayout)
	catGroup.PUT("/home/layout", auth.UnifiedAuthMiddleware(cfg, db), catalogSvc.PutHomeLayout)

	browse := api.Group("/browse", auth.OptionalUnifiedAuthMiddleware(cfg, db))
	browse.GET("/works", catalogSvc.BrowseWorks)
	browse.GET("/releases", catalogSvc.BrowseReleases)
	browse.GET("/artists", catalogSvc.BrowseArtists)
	browse.GET("/franchises", catalogSvc.ListFranchises)

	importerGroup := api.Group("/importer")
	importerGroup.POST("/preview", auth.OptionalUnifiedAuthMiddleware(cfg, db), importerSvc.PreviewHandler)
	importerGroup.POST("/import", auth.UnifiedAuthMiddleware(cfg, db), auth.RequireEmailVerified(db), importerSvc.ImportHandler)

	api.GET("/metadata/external-databases", catalogSvc.ListExternalDatabases)
	api.GET("/metadata/attributes", catalogSvc.ListAttributeSchemas)
	api.GET("/plugins", auth.OptionalUnifiedAuthMiddleware(cfg, db), pluginHandler.ListPublicPlugins)
	api.GET("/export/:format/:id", auth.OptionalUnifiedAuthMiddleware(cfg, db), pluginHandler.ExportWorkHandler)

	ws2 := api.Group("/ws/2", auth.OptionalUnifiedAuthMiddleware(cfg, db))
	ws2.GET("/work/:id", catalogSvc.GetWorkDetail)
	ws2.GET("/release/:id", catalogSvc.GetReleaseDetail)
	ws2.GET("/artist/:id", catalogSvc.GetArtistDetail)
	ws2.GET("/franchise/:id", catalogSvc.GetFranchiseDetail)
	ws2.GET("/work", catalogSvc.ListWorks)
	ws2.GET("/release", catalogSvc.ListReleases)
	ws2.GET("/artist", catalogSvc.ListArtists)
	ws2.GET("/franchise", catalogSvc.ListFranchises)

	if searchSvc != nil {
		api.GET("/search", auth.OptionalUnifiedAuthMiddleware(cfg, db), searchSvc.SearchWorks)
		api.GET("/ws/2/search", auth.OptionalUnifiedAuthMiddleware(cfg, db), searchSvc.SearchWorks)
	}
}
