package openapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler returns the OpenAPI 3.1 document for MetaFusion — MusicBrainz WS/2 inspired.
// 前端 /developers 页面与外部 Agent 可直接拉取此 JSON 进行代码生成或 LLM 工具调用。
func Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Header("Access-Control-Allow-Origin", "*")
		c.JSON(http.StatusOK, spec)
	}
}

// 完整规范对象，直接内联避免额外文件读取，deployment 时即刻可用
var spec = map[string]interface{}{
	"openapi": "3.1.0",
	"info": map[string]interface{}{
		"title":       "MetaFusion API",
		"version":     "1.0.0",
		"description": "MusicBrainz WS/2 风格的多媒介 FRBR 编目开放 API。元数据（Work/Release/Artist/Tag/Category）对游客开放可爬；媒体二进制（下载/预览）与写入操作需认证（JWT Bearer 或 PAT mfp_）。所有网页端功能均可经此 API 复现，适合自建应用与 Agent 接入。",
		"contact": map[string]interface{}{
			"name": "MetaFusion",
			"url":  "/developers",
		},
		"license": map[string]interface{}{"name": "AGPL-3.0"},
	},
	"servers": []map[string]interface{}{
		{"url": "/api/v1", "description": "当前环境"},
	},
	"tags": []map[string]interface{}{
		{"name": "auth", "description": "认证、注册、邀请与 PAT 令牌（MusicBrainz 式机器接入）"},
		{"name": "lookup", "description": "Lookup 实体详情，支持 inc 展开（类似 MusicBrainz inc=artists+releases+tags）"},
		{"name": "browse", "description": "Browse 按关联实体枚举（按 artist / work / label 浏览）"},
		{"name": "search", "description": "Search 全文检索（Lucene 风格 q，ES 优先，SQL ILIKE 降级）"},
		{"name": "catalog", "description": "FRBR 编目分类、标签、货架与图谱关系"},
		{"name": "edit", "description": "新建与编辑（需认证，自动记录 EntityRevision 与 edit_note/source_urls）"},
		{"name": "community", "description": "论坛板块、帖子、回复与私聊（读开放，写需认证）"},
		{"name": "storage", "description": "分片直传与预签名下载（全部需认证）"},
		{"name": "user", "description": "用户资料与贡献历史"},
	},
	"components": map[string]interface{}{
		"securitySchemes": map[string]interface{}{
			"bearerAuth": map[string]interface{}{
				"type":         "http",
				"scheme":       "bearer",
				"bearerFormat": "JWT",
				"description":  "JWT Bearer（登录后获取）或 PAT（mfp_ 前缀，明文形式同样放入 Authorization: Bearer）。也支持 X-API-Key: mfp_... 头。",
			},
			"apiKeyHeader": map[string]interface{}{
				"type":        "apiKey",
				"in":          "header",
				"name":        "X-API-Key",
				"description": "Personal Access Token，格式 mfp_<64 hex>",
			},
		},
		"parameters": map[string]interface{}{
			"IncParam": map[string]interface{}{
				"name":        "inc",
				"in":          "query",
				"description": "MusicBrainz 风格展开参数，+ 或空格分隔：artists, releases, mediums, tracks, tags, relations, revisions, graph。例如 inc=artists+releases",
				"schema":      map[string]interface{}{"type": "string", "example": "artists+releases"},
			},
			"FmtParam": map[string]interface{}{
				"name":        "fmt",
				"in":          "query",
				"description": "响应格式，默认 json，可选 json（仅 json）",
				"schema":      map[string]interface{}{"type": "string", "enum": []string{"json"}},
			},
			"PaginationPage":     map[string]interface{}{"name": "page", "in": "query", "schema": map[string]interface{}{"type": "integer", "default": 1}},
			"PaginationPageSize": map[string]interface{}{"name": "page_size", "in": "query", "schema": map[string]interface{}{"type": "integer", "default": 20, "maximum": 100}},
		},
	},
	"security": []map[string]interface{}{{}, {"bearerAuth": []string{}}},
	"paths": map[string]interface{}{
		"/auth/settings": map[string]interface{}{
			"get": map[string]interface{}{
				"tags": []string{"auth"}, "summary": "获取注册开关", "operationId": "getAuthSettings",
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "ok"}},
			},
		},
		"/auth/register": map[string]interface{}{
			"post": map[string]interface{}{
				"tags": []string{"auth"}, "summary": "注册（受 registration_enabled / invite_required 控制）", "operationId": "register",
				"requestBody": map[string]interface{}{"required": true, "content": map[string]interface{}{"application/json": map[string]interface{}{"schema": map[string]interface{}{"type": "object", "required": []string{"username", "email", "password"}, "properties": map[string]interface{}{
					"username": map[string]interface{}{"type": "string"}, "email": map[string]interface{}{"type": "string"}, "password": map[string]interface{}{"type": "string"}, "invite_code": map[string]interface{}{"type": "string", "description": "邀请码，invite_required 时必填"},
				}}}},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "ok"}, "400": map[string]interface{}{"description": "bad"}},
			},
		},
		"/auth/login": map[string]interface{}{
			"post": map[string]interface{}{
				"tags": []string{"auth"}, "summary": "登录", "operationId": "login",
				"requestBody": map[string]interface{}{"required": true, "content": map[string]interface{}{"application/json": map[string]interface{}{"schema": map[string]interface{}{"type": "object", "required": []string{"email_or_username", "password"}}}}},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "ok"}},
			},
		},
		"/auth/me": map[string]interface{}{
			"get": map[string]interface{}{
				"tags": []string{"auth"}, "summary": "当前用户信息", "security": []map[string]interface{}{{"bearerAuth": []string{}}},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "ok"}},
			},
		},
		"/auth/tokens": map[string]interface{}{
			"get": map[string]interface{}{
				"tags": []string{"auth"}, "summary": "列出个人访问令牌 PAT", "description": "需 JWT 登录态（PAT 自身不可列出/创建 PAT，避免派生）", "security": []map[string]interface{}{{"bearerAuth": []string{}}},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "ok"}},
			},
			"post": map[string]interface{}{
				"tags": []string{"auth"}, "summary": "创建 PAT（明文仅返回一次）", "security": []map[string]interface{}{{"bearerAuth": []string{}}},
				"requestBody": map[string]interface{}{"required": true, "content": map[string]interface{}{"application/json": map[string]interface{}{"schema": map[string]interface{}{"type": "object", "required": []string{"name"}, "properties": map[string]interface{}{
					"name": map[string]interface{}{"type": "string", "maxLength": 64}, "scopes": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string", "enum": []string{"read", "write", "edit", "upload", "community", "admin"}}, "expires_at": map[string]interface{}{"type": "string", "format": "date-time"},
				}}}},
				"responses": map[string]interface{}{"201": map[string]interface{}{"description": "created"}},
			},
		},
		"/auth/tokens/{id}": map[string]interface{}{
			"delete": map[string]interface{}{
				"tags": []string{"auth"}, "summary": "撤销 PAT", "security": []map[string]interface{}{{"bearerAuth": []string{}}},
				"parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string", "format": "uuid"}}},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "deleted"}},
			},
		},
		"/catalog/works": map[string]interface{}{
			"get": map[string]interface{}{
				"tags": []string{"lookup", "catalog"}, "summary": "列表 / 搜索作品（支持多维过滤）", "operationId": "listWorks",
				"parameters": []map[string]interface{}{
					{"name": "q", "in": "query", "description": "关键词（标题/别名/概要）"}, {"name": "category", "in": "query", "description": "分类 code"}, {"name": "media_type", "in": "query", "description": "movie/tv_series/anime/music/audiobook/novel/comic/gallery"},
					{"name": "status", "in": "query"}, {"name": "tag", "in": "query"}, {"name": "shelf", "in": "query"}, {"name": "language", "in": "query"},
					{"name": "sort", "in": "query", "description": "created_at / view_count / title"}, {"name": "order", "in": "query", "description": "asc/desc"},
					{"name": "inc", "in": "query", "description": "展开：artists, tags, relations"}, {"name": "fmt", "in": "query", "schema": map[string]interface{}{"type": "string"}},
					{"name": "page", "in": "query", "schema": map[string]interface{}{"type": "integer"}}, {"name": "page_size", "in": "query", "schema": map[string]interface{}{"type": "integer"}},
				},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "paginated works"}},
			},
			"post": map[string]interface{}{
				"tags": []string{"edit"}, "summary": "新建作品（需认证，自动记录 revision）", "security": []map[string]interface{}{{"bearerAuth": []string{}}},
				"requestBody": map[string]interface{}{"required": true, "content": map[string]interface{}{"application/json": map[string]interface{}{"schema": map[string]interface{}{"type": "object", "required": []string{"title", "media_type"}}}}},
				"responses": map[string]interface{}{"201": map[string]interface{}{"description": "created"}},
			},
		},
		"/catalog/works/{id}": map[string]interface{}{
			"get": map[string]interface{}{
				"tags": []string{"lookup"}, "summary": "作品详情（支持 inc）", "parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}, {"name": "inc", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "fmt", "in": "query", "schema": map[string]interface{}{"type": "string"}}},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "work"}},
			},
			"put": map[string]interface{}{
				"tags": []string{"edit"}, "summary": "编辑作品（需认证，需 edit_note/source_urls）", "security": []map[string]interface{}{{"bearerAuth": []string{}}},
				"parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "updated"}},
			},
		},
		"/catalog/releases": map[string]interface{}{
			"get": map[string]interface{}{
				"tags": []string{"lookup"}, "summary": "发行版列表（按 work_id 过滤）", "parameters": []map[string]interface{}{{"name": "work_id", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "inc", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "page", "in": "query", "schema": map[string]interface{}{"type": "integer"}}, {"name": "page_size", "in": "query", "schema": map[string]interface{}{"type": "integer"}}},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "releases"}},
			},
			"post": map[string]interface{}{
				"tags": []string{"edit"}, "summary": "新建发行版（需认证）", "security": []map[string]interface{}{{"bearerAuth": []string{}}},
				"responses": map[string]interface{}{"201": map[string]interface{}{"description": "created"}},
			},
		},
		"/catalog/releases/{id}": map[string]interface{}{
			"get":  map[string]interface{}{"tags": []string{"lookup"}, "summary": "发行版详情", "parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}, {"name": "inc", "in": "query", "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "release"}}},
			"put":  map[string]interface{}{"tags": []string{"edit"}, "summary": "编辑发行版", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "updated"}}},
		},
		"/catalog/artists": map[string]interface{}{
			"get": map[string]interface{}{
				"tags": []string{"lookup"}, "summary": "创作者列表",
				"parameters": []map[string]interface{}{{"name": "q", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "entity_type", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "page", "in": "query", "schema": map[string]interface{}{"type": "integer"}}, {"name": "page_size", "in": "query", "schema": map[string]interface{}{"type": "integer"}}},
				"responses": map[string]interface{}{"200": map[string]interface{}{"description": "artists"}},
			},
			"post": map[string]interface{}{"tags": []string{"edit"}, "summary": "新建创作者", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "responses": map[string]interface{}{"201": map[string]interface{}{"description": "created"}}},
		},
		"/catalog/artists/{id}": map[string]interface{}{
			"get": map[string]interface{}{"tags": []string{"lookup"}, "summary": "创作者详情（inc 支持 works/releases/relations）", "parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}, {"name": "inc", "in": "query", "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "artist"}}},
			"put": map[string]interface{}{"tags": []string{"edit"}, "summary": "编辑创作者", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "updated"}}},
		},
		"/catalog/taxonomy":           map[string]interface{}{"get": map[string]interface{}{"tags": []string{"catalog"}, "summary": "全量分类层级、货架、标签、媒介大类、角色与规格", "responses": map[string]interface{}{"200": map[string]interface{}{"description": "taxonomy"}}}},
		"/catalog/categories":         map[string]interface{}{"get": map[string]interface{}{"tags": []string{"catalog"}, "summary": "分类列表", "responses": map[string]interface{}{"200": map[string]interface{}{"description": "categories"}}}},
		"/catalog/tags":               map[string]interface{}{"get": map[string]interface{}{"tags": []string{"catalog"}, "summary": "标签列表", "responses": map[string]interface{}{"200": map[string]interface{}{"description": "tags"}}}},
		"/catalog/shelves":            map[string]interface{}{"get": map[string]interface{}{"tags": []string{"catalog"}, "summary": "虚拟货架", "responses": map[string]interface{}{"200": map[string]interface{}{"description": "shelves"}}}},
		"/catalog/relation-types":     map[string]interface{}{"get": map[string]interface{}{"tags": []string{"catalog"}, "summary": "动态关系类型", "responses": map[string]interface{}{"200": map[string]interface{}{"description": "relationTypes"}}}},
		"/catalog/revisions":          map[string]interface{}{"get": map[string]interface{}{"tags": []string{"edit"}, "summary": "版本修订历史", "parameters": []map[string]interface{}{{"name": "target_type", "in": "query", "required": true, "schema": map[string]interface{}{"type": "string"}}, {"name": "target_id", "in": "query", "required": true, "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "revisions"}}}},
		"/catalog/merge":              map[string]interface{}{"post": map[string]interface{}{"tags": []string{"edit"}, "summary": "实体合并（需认证）", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "merged"}}}},
		"/catalog/submit":             map[string]interface{}{"post": map[string]interface{}{"tags": []string{"edit"}, "summary": "一站式详尽档案提交（MusicBrainz 式综合提交）", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "submitted"}}}},
		"/browse/works":               map[string]interface{}{"get": map[string]interface{}{"tags": []string{"browse"}, "summary": "Browse works by artist/tag/category", "parameters": []map[string]interface{}{{"name": "artist", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "tag", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "category", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "page", "in": "query", "schema": map[string]interface{}{"type": "integer"}}, {"name": "page_size", "in": "query", "schema": map[string]interface{}{"type": "integer"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "works"}}}},
		"/browse/releases":            map[string]interface{}{"get": map[string]interface{}{"tags": []string{"browse"}, "summary": "Browse releases by artist/work", "parameters": []map[string]interface{}{{"name": "artist", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "work", "in": "query", "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "releases"}}}},
		"/browse/artists":             map[string]interface{}{"get": map[string]interface{}{"tags": []string{"browse"}, "summary": "Browse artists by work/collaborator", "parameters": []map[string]interface{}{{"name": "work", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "collaborator", "in": "query", "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "artists"}}}},
		"/search":                     map[string]interface{}{"get": map[string]interface{}{"tags": []string{"search"}, "summary": "全文检索（支持 type=work|artist|release|all）", "parameters": []map[string]interface{}{{"name": "q", "in": "query", "required": true, "schema": map[string]interface{}{"type": "string"}}, {"name": "type", "in": "query", "schema": map[string]interface{}{"type": "string", "enum": []string{"work", "artist", "release", "all"}}}, {"name": "limit", "in": "query", "schema": map[string]interface{}{"type": "integer"}}, {"name": "offset", "in": "query", "schema": map[string]interface{}{"type": "integer"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "search results"}}}},
		"/community/boards":           map[string]interface{}{"get": map[string]interface{}{"tags": []string{"community"}, "summary": "板块列表", "responses": map[string]interface{}{"200": map[string]interface{}{"description": "boards"}}}},
		"/community/topics":           map[string]interface{}{"get": map[string]interface{}{"tags": []string{"community"}, "summary": "帖子列表", "parameters": []map[string]interface{}{{"name": "board_code", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "q", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "page", "in": "query", "schema": map[string]interface{}{"type": "integer"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "topics"}}}, "post": map[string]interface{}{"tags": []string{"community"}, "summary": "发帖（需认证）", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "responses": map[string]interface{}{"201": map[string]interface{}{"description": "created"}}}},
		"/community/topics/{id}":      map[string]interface{}{"get": map[string]interface{}{"tags": []string{"community"}, "summary": "帖子详情含回复流", "parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "topic"}}}},
		"/community/topics/{id}/posts": map[string]interface{}{"post": map[string]interface{}{"tags": []string{"community"}, "summary": "回帖", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "responses": map[string]interface{}{"201": map[string]interface{}{"description": "posted"}}}},
		"/storage/upload/initiate":    map[string]interface{}{"post": map[string]interface{}{"tags": []string{"storage"}, "summary": "初始化分片上传（含秒传检测）", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "init"}}}},
		"/storage/upload/complete":    map[string]interface{}{"post": map[string]interface{}{"tags": []string{"storage"}, "summary": "完成上传并触发转码", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "completed"}}}},
		"/storage/download/{asset_id}": map[string]interface{}{"get": map[string]interface{}{"tags": []string{"storage"}, "summary": "获取预签名下载链接（需认证）", "security": []map[string]interface{}{{"bearerAuth": []string{}}}, "parameters": []map[string]interface{}{{"name": "asset_id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "url"}}}},
		"/users/{id}":                 map[string]interface{}{"get": map[string]interface{}{"tags": []string{"user"}, "summary": "用户公开资料", "parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "user"}}}},
		"/users/{id}/contributions":   map[string]interface{}{"get": map[string]interface{}{"tags": []string{"user"}, "summary": "贡献历史", "parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "contributions"}}}},
		"/ws/2/work/{id}":             map[string]interface{}{"get": map[string]interface{}{"tags": []string{"lookup"}, "summary": "MusicBrainz WS/2 兼容：work lookup", "parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}, {"name": "inc", "in": "query", "schema": map[string]interface{}{"type": "string"}}, {"name": "fmt", "in": "query", "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "work"}}}},
		"/ws/2/release/{id}":          map[string]interface{}{"get": map[string]interface{}{"tags": []string{"lookup"}, "summary": "MusicBrainz WS/2 兼容：release lookup", "parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}, {"name": "inc", "in": "query", "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "release"}}}},
		"/ws/2/artist/{id}":           map[string]interface{}{"get": map[string]interface{}{"tags": []string{"lookup"}, "summary": "MusicBrainz WS/2 兼容：artist lookup", "parameters": []map[string]interface{}{{"name": "id", "in": "path", "required": true, "schema": map[string]interface{}{"type": "string"}}, {"name": "inc", "in": "query", "schema": map[string]interface{}{"type": "string"}}}, "responses": map[string]interface{}{"200": map[string]interface{}{"description": "artist"}}}},
	},
}
