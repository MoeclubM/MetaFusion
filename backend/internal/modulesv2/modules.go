// Package modulesv2 owns optional application data, never catalog tables.
package modulesv2

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
 CREATE TABLE IF NOT EXISTS modules.posts(id uuid PRIMARY KEY,entity_id uuid NOT NULL,author_id uuid NOT NULL,body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS modules.records(owner_id uuid NOT NULL,entity_id uuid NOT NULL,document jsonb NOT NULL,PRIMARY KEY(owner_id,entity_id));
 CREATE TABLE IF NOT EXISTS modules.consumed(event_id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS modules.redirects(source_id uuid PRIMARY KEY,target_id uuid NOT NULL);
 `)
	if err != nil {
		return nil, err
	}
	if _, err = db.ExecContext(ctx, mediaSchema); err != nil {
		return nil, err
	}
	for _, id := range []string{"archive", "playback", "media", "community", "records", "exchange"} {
		deps := map[string]string{}
		if id == "playback" || id == "media" {
			deps["archive"] = "^2.0.0"
		}
		var enabled bool
		err = db.QueryRowContext(ctx, "SELECT enabled FROM modules.settings WHERE id=$1", id).Scan(&enabled)
		if err != nil && err != sql.ErrNoRows {
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
		token, _ = c.Cookie("mf_v2_session")
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
	for _, prefix := range []string{"/api", "/api/v2"} {
		m.registerGroup(r.Group(prefix))
	}
}

func (m *Manager) registerGroup(api *gin.RouterGroup) {
	m.registerMedia(api)
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
	api.GET("/community/entities/:id/posts", m.guard("community", false), func(c *gin.Context) {
		id := c.Param("id")
		if !m.entity(c, id) {
			return
		}
		rows, err := m.db.QueryContext(c.Request.Context(), "SELECT id,author_id,body,created_at FROM modules.posts WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 100", id)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, author, body, at string
			if rows.Scan(&id, &author, &body, &at) != nil {
				failure(c, 500, "module_error")
				return
			}
			items = append(items, map[string]any{"id": id, "author_id": author, "body": body, "created_at": at})
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
		_, err := m.db.ExecContext(c.Request.Context(), "INSERT INTO modules.posts(id,entity_id,author_id,body) VALUES($1,$2,$3,$4)", uuid.NewString(), id, m.principal(c).ID, in.Body)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	api.DELETE("/community/posts/:id", m.guard("community", true), func(c *gin.Context) {
		p := m.principal(c)
		query := "DELETE FROM modules.posts WHERE id=$1 AND author_id=$2"
		args := []any{c.Param("id"), p.ID}
		if p.Role == "admin" {
			query = "DELETE FROM modules.posts WHERE id=$1"
			args = args[:1]
		}
		_, err := m.db.ExecContext(c.Request.Context(), query, args...)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.JSON(200, gin.H{"ok": true})
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
	if _, err = tx.ExecContext(ctx, "UPDATE modules.posts SET entity_id=$2 WHERE entity_id=$1", source, target); err != nil {
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
