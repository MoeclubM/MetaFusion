// Package modulesv2 owns optional application data, never catalog tables.
package modules

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/moduleapi"
	"github.com/metafusion/metafusion-app/internal/moduledeps"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Manager struct {
	db        *sql.DB
	catalog   moduleapi.Catalog
	root      string
	mu        sync.RWMutex
	manifests map[string]moduleapi.Manifest
	objects   objectStore
}

func New(ctx context.Context, db *sql.DB, catalog moduleapi.Catalog, root string) (*Manager, error) {
	m := &Manager{db: db, catalog: catalog, root: root, manifests: map[string]moduleapi.Manifest{}}
	_, err := db.ExecContext(ctx, `CREATE SCHEMA IF NOT EXISTS modules;
 CREATE TABLE IF NOT EXISTS modules.settings(id text PRIMARY KEY,enabled boolean NOT NULL);
 CREATE TABLE IF NOT EXISTS modules.resources(id uuid PRIMARY KEY,entity_id uuid NOT NULL,owner_id uuid NOT NULL,public boolean NOT NULL DEFAULT false,name text NOT NULL,mime text NOT NULL,size bigint NOT NULL,hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS modules.records(owner_id uuid NOT NULL,entity_id uuid NOT NULL,document jsonb NOT NULL,PRIMARY KEY(owner_id,entity_id));
 CREATE TABLE IF NOT EXISTS modules.consumed(event_id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS modules.redirects(source_id uuid PRIMARY KEY,target_id uuid NOT NULL);
 -- 论坛（本站自建的独立讨论系统）。板块是运营维度，主题是帖子容器，
 -- 回复按 post_number 编号并支持引用楼号；主题可选择性关联目录实体。
 CREATE TABLE IF NOT EXISTS modules.forum_boards(code text PRIMARY KEY,names jsonb NOT NULL DEFAULT '{}'::jsonb,descriptions jsonb NOT NULL DEFAULT '{}'::jsonb,color text NOT NULL DEFAULT 'emerald',icon text NOT NULL DEFAULT 'BookOpen',sort_order int NOT NULL DEFAULT 0,is_enabled boolean NOT NULL DEFAULT true,show_in_feed boolean NOT NULL DEFAULT true);
 CREATE TABLE IF NOT EXISTS modules.forum_topics(id uuid PRIMARY KEY,board_code text NOT NULL REFERENCES modules.forum_boards(code),author_id uuid NOT NULL,author_name text NOT NULL DEFAULT '',title text NOT NULL,body text NOT NULL,language text NOT NULL DEFAULT '',entity_id uuid,is_pinned boolean NOT NULL DEFAULT false,is_locked boolean NOT NULL DEFAULT false,view_count int NOT NULL DEFAULT 0,reply_count int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),last_activity_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS modules.forum_posts(id uuid PRIMARY KEY,topic_id uuid NOT NULL REFERENCES modules.forum_topics(id) ON DELETE CASCADE,author_id uuid NOT NULL,author_name text NOT NULL DEFAULT '',body text NOT NULL,post_number int NOT NULL,reply_to_post_number int,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(topic_id,post_number));
 CREATE TABLE IF NOT EXISTS modules.forum_tags(id bigserial PRIMARY KEY,name text NOT NULL,slug text NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS modules.forum_topic_tags(topic_id uuid NOT NULL REFERENCES modules.forum_topics(id) ON DELETE CASCADE,tag_id bigint NOT NULL REFERENCES modules.forum_tags(id) ON DELETE CASCADE,PRIMARY KEY(topic_id,tag_id));
 CREATE INDEX IF NOT EXISTS forum_topics_board ON modules.forum_topics(board_code,last_activity_at DESC);
 CREATE INDEX IF NOT EXISTS forum_topics_entity ON modules.forum_topics(entity_id);
 CREATE INDEX IF NOT EXISTS forum_posts_topic ON modules.forum_posts(topic_id,post_number);
 `)
	if err != nil {
		return nil, err
	}
	if _, err = db.ExecContext(ctx, mediaSchema); err != nil {
		return nil, err
	}
	// 论坛板块是运营配置，首次运行播种；已存在的不覆盖，保留后台调整。
	if err = seedForum(ctx, db); err != nil {
		return nil, err
	}
	// 历史实体短评并入 forum_topics 评论板块（幂等，见 forum.go）。
	if err = migratePostsToComments(ctx, db); err != nil {
		return nil, err
	}
	// defaultEnabled：无依赖、仅用本库即可工作的模块默认开启（社区短评与个人收藏）；
	// 归档/播放/媒体依赖对象存储，交换依赖外部服务，保持默认关闭，由管理台按需开启。
	defaultEnabled := map[string]bool{"community": true, "records": true}
	for _, id := range []string{"archive", "playback", "media", "community", "records", "exchange"} {
		deps := map[string]string{}
		if id == "playback" || id == "media" {
			deps["archive"] = "^2.0.0"
		}
		enabled := defaultEnabled[id]
		err = db.QueryRowContext(ctx, "SELECT enabled FROM modules.settings WHERE id=$1", id).Scan(&enabled)
		if err == nil {
			// 已有显式配置以配置为准。
		} else if err == sql.ErrNoRows {
			// 首次运行按默认值播种，使管理台与运行时口径一致。
			if _, ierr := db.ExecContext(ctx, "INSERT INTO modules.settings(id,enabled) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", id, enabled); ierr != nil {
				return nil, ierr
			}
		} else {
			return nil, err
		}
		m.manifests[id] = moduleapi.Manifest{ID: id, Version: "2.0.0", Dependencies: deps, Enabled: enabled, Healthy: true}
	}
	if m.manifests["archive"].Enabled {
		if err = m.initArchive(ctx); err != nil {
			for _, id := range []string{"archive", "playback", "media"} {
				v := m.manifests[id]
				v.Healthy = false
				m.manifests[id] = v
			}
		}
	}
	return m, nil
}
func (m *Manager) Manifests() []moduleapi.Manifest {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []moduleapi.Manifest{}
	for _, id := range []string{"archive", "playback", "media", "community", "records", "exchange"} {
		out = append(out, m.manifests[id])
	}
	return out
}
func (m *Manager) Enabled(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.manifests[id].Enabled && m.manifests[id].Healthy
}
func (m *Manager) Set(ctx context.Context, id string, enabled, cascade bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.manifests[id]; !ok {
		return fmt.Errorf("unknown_module")
	}
	g := moduledeps.NewDependencyGraph()
	for _, v := range m.manifests {
		g.AddNode(moduledeps.PluginNode{ID: v.ID, Version: v.Version, Dependencies: v.Dependencies, IsEnabled: v.Enabled})
	}
	if _, err := g.CheckCycles(); err != nil {
		return err
	}
	ids := []string{id}
	if enabled {
		deps := g.GetTransitiveDependencies(id)
		if !cascade {
			for _, d := range deps {
				if !m.manifests[d].Enabled {
					return fmt.Errorf("inactive_dependency")
				}
			}
		}
		ids = append(deps, ids...)
	} else {
		deps := g.GetTransitiveDependents(id)
		if !cascade {
			for _, d := range deps {
				if m.manifests[d].Enabled {
					return fmt.Errorf("active_dependents")
				}
			}
		} else {
			ids = append(deps, ids...)
		}
	}
	for _, key := range ids {
		v := m.manifests[key]
		for dep, constraint := range v.Dependencies {
			ok, err := moduledeps.CheckVersionConstraint(m.manifests[dep].Version, constraint)
			if err != nil || !ok {
				return fmt.Errorf("module_version_mismatch")
			}
		}
	}
	if enabled && contains(ids, "archive") {
		if err := m.initArchive(ctx); err != nil {
			return err
		}
	}
	if enabled && contains(ids, "media") {
		for _, binary := range []string{"ffprobe", "ffmpeg"} {
			if _, err := exec.LookPath(binary); err != nil {
				return fmt.Errorf("media_unavailable")
			}
		}
	}
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, key := range ids {
		if _, err = tx.ExecContext(ctx, "INSERT INTO modules.settings(id,enabled) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET enabled=EXCLUDED.enabled", key, enabled); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	for _, key := range ids {
		v := m.manifests[key]
		v.Enabled = enabled
		v.Healthy = true
		m.manifests[key] = v
	}
	return nil
}
func contains(a []string, b string) bool {
	for _, x := range a {
		if x == b {
			return true
		}
	}
	return false
}
func (m *Manager) principal(c *gin.Context) *moduleapi.Principal {
	token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if token == "" {
		token, _ = c.Cookie("mf_session")
	}
	p, err := m.catalog.Authenticate(c.Request.Context(), token)
	if err != nil {
		return nil
	}
	return &p
}
func failure(c *gin.Context, status int, code string) {
	c.AbortWithStatusJSON(status, gin.H{"error": code})
}
func (m *Manager) guard(module string, auth bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !m.Enabled(module) {
			failure(c, 404, "module_disabled")
			return
		}
		if auth && m.principal(c) == nil {
			failure(c, 401, "authentication_required")
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Minute)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
func (m *Manager) entity(c *gin.Context, id string) bool {
	if _, err := m.catalog.Lookup(c.Request.Context(), id, m.principal(c)); err != nil {
		failure(c, 404, "not_found")
		return false
	}
	return true
}
func (m *Manager) Register(r *gin.Engine) {
	m.registerGroup(r.Group("/api"))
}

func (m *Manager) registerGroup(api *gin.RouterGroup) {
	m.registerMedia(api)
	m.registerForum(api)
	api.GET("/capabilities", func(c *gin.Context) { items := m.Manifests(); c.JSON(200, gin.H{"modules": items}) })
	api.PUT("/admin/modules/:id", func(c *gin.Context) {
		p := m.principal(c)
		if p == nil || p.Role != "admin" {
			failure(c, 403, "forbidden")
			return
		}
		var in struct {
			Enabled bool `json:"enabled"`
			Cascade bool `json:"cascade"`
		}
		if c.ShouldBindJSON(&in) != nil {
			failure(c, 400, "invalid_payload")
			return
		}
		if err := m.Set(c.Request.Context(), c.Param("id"), in.Enabled, in.Cascade); err != nil {
			failure(c, 409, err.Error())
			return
		}
		c.JSON(200, gin.H{"modules": m.Manifests()})
	})
	api.GET("/archive/entities/:id/resources", m.guard("archive", false), m.resources)
	api.POST("/archive/entities/:id/resources", m.guard("archive", true), m.upload)
	api.GET("/archive/resources/:id/content", m.guard("archive", false), m.download)
	api.GET("/playback/resources/:id/content", m.guard("playback", false), m.download)
	// 站点级评论流：跨实体聚合评论（评论板块），并带上被评论条目的题名。
	// 支持 sort=recent（默认，最新在前）/ oldest；entity_id 限定单个条目；
	// q 对正文与条目题名做模糊匹配。筛选下推到 SQL，避免前端拿全量再过滤。
	api.GET("/community/feed", m.guard("community", false), func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.Query("limit"))
		if limit <= 0 || limit > 100 {
			limit = 50
		}
		args := []any{commentBoard}
		where := []string{"t.board_code = $1", "(e.id IS NULL OR e.status = 'published')"}
		// entity_id 必须是合法 UUID，否则直接判为空结果，而不是把非法字面量送进查询。
		if raw := strings.TrimSpace(c.Query("entity_id")); raw != "" {
			if _, err := uuid.Parse(raw); err != nil {
				c.JSON(200, gin.H{"items": []any{}})
				return
			}
			args = append(args, raw)
			where = append(where, fmt.Sprintf("t.entity_id = $%d", len(args)))
		}
		if q := strings.TrimSpace(c.Query("q")); q != "" {
			args = append(args, "%"+q+"%")
			where = append(where, fmt.Sprintf("(t.body ILIKE $%d OR e.title ILIKE $%d)", len(args), len(args)))
		}
		order := "DESC"
		if c.Query("sort") == "oldest" {
			order = "ASC"
		}
		args = append(args, limit)
		q := `
			SELECT t.id::text, t.entity_id::text, t.author_id::text,
			       COALESCE(NULLIF(t.author_name, ''), 'Anonymous'), t.body, t.created_at,
			       e.title, COALESCE(e.document->>'kind', '')
			FROM modules.forum_topics t
			LEFT JOIN catalog.entities e ON e.id = t.entity_id
			WHERE ` + strings.Join(where, " AND ") + `
			ORDER BY t.created_at ` + order + `, t.id
			LIMIT $` + strconv.Itoa(len(args))
		rows, err := m.db.QueryContext(c.Request.Context(), q, args...)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, entityID, author, authorName, body, at string
			var title, kind sql.NullString
			if rows.Scan(&id, &entityID, &author, &authorName, &body, &at, &title, &kind) != nil {
				failure(c, 500, "module_error")
				return
			}
			items = append(items, map[string]any{
				"id": id, "entity_id": entityID, "author_id": author,
				"author_name": authorName, "body": body, "created_at": at,
				"entity_title": title.String, "entity_kind": kind.String,
			})
		}
		c.JSON(200, gin.H{"items": items})
	})
	// 实体评论：语义上是"文章下的评论"，与论坛主题（独立成文的帖子）区分开。
	// 存储复用 forum_topics 的评论板块：锚定实体、无独立标题、不进信息流。
	// URL 契约沿用 /community/entities/:id/posts，前端无需改动。
	api.GET("/community/entities/:id/posts", m.guard("community", false), func(c *gin.Context) {
		id := c.Param("id")
		if !m.entity(c, id) {
			return
		}
		rows, err := m.db.QueryContext(c.Request.Context(), `SELECT id::text,author_id::text,COALESCE(NULLIF(author_name, ''), 'Anonymous'),body,created_at FROM modules.forum_topics WHERE board_code=$1 AND entity_id=$2 ORDER BY created_at DESC LIMIT 100`, commentBoard, id)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, author, authorName, body string
			var at time.Time
			if rows.Scan(&id, &author, &authorName, &body, &at) != nil {
				failure(c, 500, "module_error")
				return
			}
			items = append(items, map[string]any{"id": id, "author_id": author, "author_name": authorName, "body": body, "created_at": at})
		}
		c.JSON(200, gin.H{"items": items})
	})
	api.POST("/community/entities/:id/posts", m.guard("community", true), func(c *gin.Context) {
		id := c.Param("id")
		if !m.entity(c, id) {
			return
		}
		var in struct {
			Body string `json:"body"`
		}
		if c.ShouldBindJSON(&in) != nil || len(strings.TrimSpace(in.Body)) == 0 || len(in.Body) > 20000 {
			failure(c, 400, "invalid_payload")
			return
		}
		p := m.principal(c)
		pid := uuid.NewString()
		_, err := m.db.ExecContext(c.Request.Context(), `INSERT INTO modules.forum_topics(id,board_code,author_id,author_name,title,body,entity_id) VALUES($1,$2,$3,$4,'',$5,$6)`, pid, commentBoard, p.ID, authorName(p), in.Body, id)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.JSON(200, gin.H{
			"ok": true,
			"item": map[string]any{
				"id": pid,
				"author_id": p.ID,
				"author_name": authorName(p),
				"body": in.Body,
				"created_at": time.Now().Format(time.RFC3339),
			},
		})
	})
	// 评论删除：只作用于评论板块，避免仅凭 id 误删论坛主题。
	api.DELETE("/community/posts/:id", m.guard("community", true), func(c *gin.Context) {
		p := m.principal(c)
		query := "DELETE FROM modules.forum_topics WHERE id=$1 AND board_code=$2 AND author_id=$3"
		args := []any{c.Param("id"), commentBoard, p.ID}
		if p.Role == "admin" {
			query = "DELETE FROM modules.forum_topics WHERE id=$1 AND board_code=$2"
			args = args[:2]
		}
		_, err := m.db.ExecContext(c.Request.Context(), query, args...)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	// 单条评论：为评论提供稳定的直达链接（permalink）。同样限定评论板块。
	api.GET("/community/posts/:id", m.guard("community", false), func(c *gin.Context) {
		id := c.Param("id")
		if _, err := uuid.Parse(id); err != nil {
			failure(c, 404, "not_found")
			return
		}
		var postID, entityID, author, authorName, body string
		var at time.Time
		err := m.db.QueryRowContext(c.Request.Context(), `
			SELECT t.id::text, COALESCE(t.entity_id::text,''), t.author_id::text,
			       COALESCE(NULLIF(t.author_name, ''), 'Anonymous'), t.body, t.created_at
			FROM modules.forum_topics t
			WHERE t.id = $1 AND t.board_code = $2`, id, commentBoard).
			Scan(&postID, &entityID, &author, &authorName, &body, &at)
		if err == sql.ErrNoRows {
			failure(c, 404, "not_found")
			return
		}
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		// 关联实体的可见性：匿名只应看到 published 条目的评论。
		title, kind := "", ""
		if entityID != "" {
			meta, lerr := m.catalog.Lookup(c.Request.Context(), entityID, m.principal(c))
			if lerr != nil {
				failure(c, 404, "not_found")
				return
			}
			title, kind = meta.Title, meta.Kind
		}
		c.JSON(200, gin.H{
			"id": postID, "entity_id": entityID, "author_id": author,
			"author_name": authorName, "body": body, "created_at": at,
			"entity_title": title, "entity_kind": kind,
		})
	})
	api.GET("/community/entities/:id/collections", m.guard("community", false), func(c *gin.Context) {
		id := c.Param("id")
		if !m.entity(c, id) {
			return
		}
		rows, err := m.db.QueryContext(c.Request.Context(), `
			SELECT e.id, e.title, e.document
			FROM catalog.relations r
			JOIN catalog.entities e ON (CASE WHEN r.source_id = $1 THEN r.target_id ELSE r.source_id END = e.id)
			WHERE (r.source_id = $1 OR r.target_id = $1) AND e.kind = 'collection' AND e.status = 'published'
			LIMIT 20`, id)
		if err != nil {
			c.JSON(200, gin.H{"items": []any{}})
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var cid, title string
			var docBytes []byte
			if rows.Scan(&cid, &title, &docBytes) == nil {
				var doc map[string]any
				_ = json.Unmarshal(docBytes, &doc)
				items = append(items, map[string]any{
					"id": cid,
					"title": title,
					"document": doc,
				})
			}
		}
		c.JSON(200, gin.H{"items": items})
	})
	api.GET("/records/entities/:id", m.guard("records", true), func(c *gin.Context) {
		if !m.entity(c, c.Param("id")) {
			return
		}
		var b json.RawMessage
		err := m.db.QueryRowContext(c.Request.Context(), "SELECT document FROM modules.records WHERE owner_id=$1 AND entity_id=$2", m.principal(c).ID, c.Param("id")).Scan(&b)
		if err == sql.ErrNoRows {
			c.JSON(200, gin.H{})
			return
		}
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.Data(200, "application/json", b)
	})
	api.PUT("/records/entities/:id", m.guard("records", true), func(c *gin.Context) {
		if !m.entity(c, c.Param("id")) {
			return
		}
		var in struct {
			Favorite bool   `json:"favorite"`
			Rating   int    `json:"rating"`
			Progress string `json:"progress"`
			Owned    bool   `json:"owned"`
		}
		if c.ShouldBindJSON(&in) != nil || in.Rating < 0 || in.Rating > 10 || len(in.Progress) > 1000 {
			failure(c, 400, "invalid_payload")
			return
		}
		b, _ := json.Marshal(in)
		_, err := m.db.ExecContext(c.Request.Context(), "INSERT INTO modules.records(owner_id,entity_id,document) VALUES($1,$2,$3) ON CONFLICT(owner_id,entity_id) DO UPDATE SET document=EXCLUDED.document", m.principal(c).ID, c.Param("id"), string(b))
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.JSON(200, in)
	})
	api.GET("/exchange/entities/:id", m.guard("exchange", false), func(c *gin.Context) {
		b, err := m.catalog.Export(c.Request.Context(), c.Param("id"), m.principal(c))
		if err != nil {
			failure(c, 404, "not_found")
			return
		}
		c.Data(200, "application/json", b)
	})
	api.POST("/exchange/proposals", m.guard("exchange", true), func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		b, err := io.ReadAll(c.Request.Body)
		if err != nil {
			failure(c, 400, "invalid_payload")
			return
		}
		out, err := m.catalog.Submit(c.Request.Context(), b, *m.principal(c))
		if err != nil {
			failure(c, 400, "proposal_rejected")
			return
		}
		c.Data(200, "application/json", out)
	})
}

type resource struct {
	ID       string `json:"id"`
	EntityID string `json:"entity_id"`
	OwnerID  string `json:"owner_id"`
	Public   bool   `json:"public"`
	Name     string `json:"name"`
	Mime     string `json:"mime"`
	Size     int64  `json:"size"`
	Hash     string `json:"hash"`
}

func (m *Manager) resources(c *gin.Context) {
	id := c.Param("id")
	if !m.entity(c, id) {
		return
	}
	owner := "00000000-0000-0000-0000-000000000000"
	p := m.principal(c)
	if p != nil {
		owner = p.ID
	}
	rows, err := m.db.QueryContext(c.Request.Context(), "SELECT id,entity_id,owner_id,public,name,mime,size,hash FROM modules.resources WHERE entity_id=$1 AND (public OR owner_id=$2) ORDER BY created_at DESC LIMIT 100", id, owner)
	if err != nil {
		failure(c, 500, "module_error")
		return
	}
	defer rows.Close()
	items := []resource{}
	for rows.Next() {
		var x resource
		if rows.Scan(&x.ID, &x.EntityID, &x.OwnerID, &x.Public, &x.Name, &x.Mime, &x.Size, &x.Hash) != nil {
			failure(c, 500, "module_error")
			return
		}
		items = append(items, x)
	}
	c.JSON(200, gin.H{"items": items})
}
func (m *Manager) upload(c *gin.Context) {
	id := c.Param("id")
	if !m.entity(c, id) {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<30)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		failure(c, 400, "invalid_upload")
		return
	}
	defer file.Close()
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	temp, err := os.CreateTemp(m.root, "incoming-")
	if err != nil {
		failure(c, 503, "archive_unavailable")
		return
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(temp, hash), file)
	closeErr := temp.Close()
	if err != nil || closeErr != nil {
		failure(c, 400, "upload_failed")
		return
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	mime := header.Header.Get("Content-Type")
	if mime == "" {
		mime = "application/octet-stream"
	}
	if err = m.objectStorage().Put(c.Request.Context(), tempName, digest, mime); err != nil {
		failure(c, 503, "archive_unavailable")
		return
	}
	rid := uuid.NewString()
	_, err = m.db.ExecContext(c.Request.Context(), "INSERT INTO modules.resources(id,entity_id,owner_id,public,name,mime,size,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", rid, id, m.principal(c).ID, c.PostForm("public") == "true", filepath.Base(header.Filename), mime, size, digest)
	if err != nil {
		failure(c, 500, "module_error")
		return
	}
	c.JSON(200, gin.H{"id": rid, "hash": digest, "size": size})
}
func (m *Manager) download(c *gin.Context) {
	var x resource
	err := m.db.QueryRowContext(c.Request.Context(), "SELECT id,entity_id,owner_id,public,name,mime,size,hash FROM modules.resources WHERE id=$1", c.Param("id")).Scan(&x.ID, &x.EntityID, &x.OwnerID, &x.Public, &x.Name, &x.Mime, &x.Size, &x.Hash)
	if err != nil {
		failure(c, 404, "not_found")
		return
	}
	p := m.principal(c)
	if !x.Public && (p == nil || p.ID != x.OwnerID) {
		failure(c, 404, "not_found")
		return
	}
	if !m.entity(c, x.EntityID) {
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	object, err := m.objectStorage().Open(c.Request.Context(), x.Hash)
	if err != nil {
		failure(c, 503, "archive_unavailable")
		return
	}
	defer object.Close()
	if strings.Contains(c.FullPath(), "/playback/") {
		if !strings.HasPrefix(x.Mime, "audio/") && !strings.HasPrefix(x.Mime, "video/") && !contains([]string{"image/jpeg", "image/png", "image/webp", "image/gif"}, x.Mime) {
			failure(c, 415, "preview_unsupported")
			return
		}
		c.Header("Content-Type", x.Mime)
		http.ServeContent(c.Writer, c.Request, x.Name, time.Time{}, object)
	} else {
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": x.Name}))
		c.Header("Content-Type", "application/octet-stream")
		http.ServeContent(c.Writer, c.Request, x.Name, time.Time{}, object)
	}
}

// ConsumeMerge uses its own transaction and inbox, without joining catalog data.
func (m *Manager) ConsumeMerge(ctx context.Context, eventID, source, target string) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "INSERT INTO modules.consumed(event_id) VALUES($1) ON CONFLICT DO NOTHING", eventID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return nil
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO modules.redirects(source_id,target_id) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET target_id=EXCLUDED.target_id", source, target); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE modules.resources SET entity_id=$2 WHERE entity_id=$1", source, target); err != nil {
		return err
	}
	// 评论与论坛主题都锚定实体，合并后必须一并改写，否则留下悬空引用。
	if _, err = tx.ExecContext(ctx, "UPDATE modules.forum_topics SET entity_id=$2 WHERE entity_id=$1", source, target); err != nil {
		return err
	}
	// Keep conflicting personal records as history instead of silently choosing a rating.
	if _, err = tx.ExecContext(ctx, `INSERT INTO modules.records(owner_id,entity_id,document)
 SELECT owner_id,$2,document FROM modules.records WHERE entity_id=$1
 ON CONFLICT(owner_id,entity_id) DO NOTHING`, source, target); err != nil {
		return err
	}
	return tx.Commit()
}
