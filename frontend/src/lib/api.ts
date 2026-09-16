// 各服务的 API 客户端按域放在 ./api/*；本文件是 barrel，导出名与拆分前完全一致，
// 既有 import { ... } from "@/lib/api" 的调用点不需要改动。

export { displayNameOf, getAccessToken, getRefreshToken, setAuthTokens, clearAuthTokens, ApiError, fetchApi } from "./api/client";
export type { User } from "./api/client";
export { registerAccount, fetchInviteLedger, createInviteCode, fetchSetupStatus, fetchAuthSettings, performInitialSetup } from "./api/auth";
export type { AuthSessionResponse, InviteCode, InviteLedger, SetupStatusResponse, InitialSetupPayload, InitialSetupResult, PublicAuthSettings } from "./api/auth";
export { toggleFavorite, fetchFavoriteStatus, fetchFavorites, normalizeBoard, boardDisplayName, boardDisplayDesc, FORUM_BOARDS, fetchBoards, getBoardSync, shareContent, buildShareUrl, createTopic, createPost, fetchDirectMessages, sendDirectMessage } from "./api/community";
export type { FavoriteTargetType, FavoriteItem, ForumPost, DiscussionTopic, CreateTopicPayload, CreatePostPayload, Comment, DirectMessage, ConversationItem, ForumBoard } from "./api/community";
export { CATALOG_HUBS, isCatalogHub, catalogHubOf, pickLocalizedName, catalogEntityHref, fetchEntityRevisions, mergeEntities } from "./api/catalog";
export type { CatalogHub, Tag, ConnectedEntityItem, EntityRevision, EntityRelationship, RelationType, GraphNode, GraphLink } from "./api/catalog";
export { fetchPublicPlugins, fetchExternalDatabases, fetchAdminExternalDatabases, createExternalDatabase, updateExternalDatabase, deleteExternalDatabase } from "./api/admin";
export type { PluginConfigField, PluginConfigSchema, PluginHealthStatus, PluginItem, RegisterExternalPluginPayload, UpdatePluginPayload, ExternalDatabaseDefinition, ExternalLinkDisplay } from "./api/admin";
export { previewExternalCatalog, importExternalCatalog } from "./api/importer";
export type { ImporterPreviewRequest, ImporterTranslationItem, ImporterWorkPreview, ImporterArtistPreview, StaffAssociation, ImporterTrackPreview, ImporterMediumPreview, ImporterReleasePreview, ImporterCanonicalEntryPreview, ImporterPreviewResponse, ImporterImportRequest, ImporterImportResponse } from "./api/importer";
