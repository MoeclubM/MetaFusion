package modules

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Processing owns a queue and technical results; no metadata entity is changed.
const mediaSchema = `CREATE SCHEMA IF NOT EXISTS media;
 CREATE TABLE IF NOT EXISTS media.jobs(id uuid PRIMARY KEY,resource_id uuid NOT NULL,owner_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN ('analyze','preview')),status text NOT NULL DEFAULT 'queued',result jsonb NOT NULL DEFAULT '{}',error text NOT NULL DEFAULT '',lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now());`

func (m *Manager) readableResource(c *gin.Context, id string) (resource, bool) {
	var x resource
	err := m.db.QueryRowContext(c.Request.Context(), "SELECT id,entity_id,owner_id,public,name,mime,size,hash FROM modules.resources WHERE id=$1", id).Scan(&x.ID, &x.EntityID, &x.OwnerID, &x.Public, &x.Name, &x.Mime, &x.Size, &x.Hash)
	p := m.principal(c)
	if err != nil || !x.Public && (p == nil || p.ID != x.OwnerID) {
		failure(c, 404, "not_found")
		return x, false
	}
	if !m.entity(c, x.EntityID) {
		return x, false
	}
	return x, true
}
func (m *Manager) registerMedia(api *gin.RouterGroup) {
	api.POST("/media/resources/:id/jobs", m.guard("media", true), func(c *gin.Context) {
		x, ok := m.readableResource(c, c.Param("id"))
		if !ok {
			return
		}
		var in struct {
			Operation string `json:"operation"`
		}
		if c.ShouldBindJSON(&in) != nil || !contains([]string{"analyze", "preview"}, in.Operation) {
			failure(c, 400, "invalid_payload")
			return
		}
		id := uuid.NewString()
		_, err := m.db.ExecContext(c.Request.Context(), "INSERT INTO media.jobs(id,resource_id,owner_id,operation) VALUES($1,$2,$3,$4)", id, x.ID, m.principal(c).ID, in.Operation)
		if err != nil {
			failure(c, 503, "module_error")
			return
		}
		c.JSON(200, gin.H{"id": id, "status": "queued"})
	})
	api.GET("/media/jobs/:id", m.guard("media", false), func(c *gin.Context) {
		var rid, status, operation, code string
		var result json.RawMessage
		err := m.db.QueryRowContext(c.Request.Context(), "SELECT resource_id,status,operation,result,error FROM media.jobs WHERE id=$1", c.Param("id")).Scan(&rid, &status, &operation, &result, &code)
		if err != nil {
			failure(c, 404, "not_found")
			return
		}
		if _, ok := m.readableResource(c, rid); !ok {
			return
		}
		c.JSON(200, gin.H{"id": c.Param("id"), "status": status, "operation": operation, "result": result, "error": code})
	})
	api.GET("/media/jobs/:id/preview", m.guard("media", false), func(c *gin.Context) {
		var rid, status, operation string
		err := m.db.QueryRowContext(c.Request.Context(), "SELECT resource_id,status,operation FROM media.jobs WHERE id=$1", c.Param("id")).Scan(&rid, &status, &operation)
		if err != nil || status != "complete" || operation != "preview" {
			failure(c, 404, "not_found")
			return
		}
		if _, ok := m.readableResource(c, rid); !ok {
			return
		}
		c.Header("Content-Type", "video/mp4")
		c.Header("Cache-Control", "private, no-store")
		c.File(filepath.Join(m.root, "derived", c.Param("id")+".mp4"))
	})
}

func (m *Manager) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if m.Enabled("media") {
					m.processOne(ctx)
				}
			}
		}
	}()
}
func (m *Manager) processOne(ctx context.Context) {
	jobCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	var id, rid, operation string
	err := m.db.QueryRowContext(jobCtx, `UPDATE media.jobs SET status='running',lease_until=now()+interval '6 minutes' WHERE id=(SELECT id FROM media.jobs WHERE status='queued' OR (status='running' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,resource_id,operation`).Scan(&id, &rid, &operation)
	if err == sql.ErrNoRows || err != nil {
		return
	}
	result, err := m.processResource(jobCtx, id, rid, operation)
	status, code := "complete", ""
	if err != nil {
		status = "failed"
		code = "processing_failed"
		result = json.RawMessage(`{}`)
	}
	_, _ = m.db.ExecContext(ctx, "UPDATE media.jobs SET status=$2,result=$3,error=$4,lease_until=NULL WHERE id=$1", id, status, string(result), code)
}
func (m *Manager) processResource(ctx context.Context, id, rid, operation string) (json.RawMessage, error) {
	var hash string
	if err := m.db.QueryRowContext(ctx, "SELECT hash FROM modules.resources WHERE id=$1", rid).Scan(&hash); err != nil {
		return nil, err
	}
	object, err := m.objectStorage().Open(ctx, hash)
	if err != nil {
		return nil, err
	}
	defer object.Close()
	temp, err := os.CreateTemp(m.root, "process-")
	if err != nil {
		return nil, err
	}
	defer os.Remove(temp.Name())
	_, err = io.Copy(temp, object)
	temp.Close()
	if err != nil {
		return nil, err
	}
	// No shell, no user command arguments, and protocol restrictions block network inputs.
	formats := "mov,matroska,webm,wav,flac,mp3,ogg,aac,avi,mpeg,mpegts"
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", formats, "-show_format", "-show_streams", "-of", "json", temp.Name())
	raw, err := cmd.Output()
	if err != nil || len(raw) > 2<<20 {
		return nil, fmt.Errorf("analysis_failed")
	}
	var probe struct {
		Format  map[string]any   `json:"format"`
		Streams []map[string]any `json:"streams"`
	}
	if err = json.Unmarshal(raw, &probe); err != nil {
		return nil, err
	}
	delete(probe.Format, "filename")
	if operation == "preview" {
		destDir := filepath.Join(m.root, "derived")
		if err = os.MkdirAll(destDir, 0700); err != nil {
			return nil, err
		}
		dest := filepath.Join(destDir, id+".mp4")
		pending := dest + ".partial.mp4"
		defer os.Remove(pending)
		cmd = exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", formats, "-i", temp.Name(), "-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-c:a", "aac", "-movflags", "+faststart", "-y", pending)
		if err = cmd.Run(); err != nil {
			return nil, err
		}
		if err = os.Rename(pending, dest); err != nil {
			return nil, err
		}
	}
	return json.Marshal(probe)
}
