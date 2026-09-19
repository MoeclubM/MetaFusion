package catalog

import (
	"context"
	"database/sql"
	"io/fs"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/migrations"
)

// API 调用日志（开发者中心「API 请求日志」）：只记已登录请求。
//
// 单一来源是 backend/migrations/000005_api_request_logs.up.sql：mf-migrate up 走它，
// 从未跑过迁移的实例由 ensureRequestLogTable 读同一份嵌入文件补建（幂等），
// 不在 Go 里再存一份 DDL——两处各存一份正是当年 schema.sql 终态快照被删掉的原因。
const requestLogMigrationFile = "000005_api_request_logs.up.sql"

// requestLogRetentionDays 调用日志保留天数：写入时按概率顺手清理，无外部 cron。
const requestLogRetentionDays = 30

// requestLogEnsured 按库去重：同一 *sql.DB 只补建一次。包级 Once 是错的——
// 测试里每个用例库不同，首个库会把后面的建表全吞掉（2026-09-20 全量套件实测）。
var requestLogEnsured sync.Map

// ensureRequestLogTable 补建日志表（无库/已建时直接返回）。日志是派生数据：
// 建表失败不阻断请求，写入失败同样吞掉（见 LogRequest）——日志不能反过来拖累主流程。
func ensureRequestLogTable(db *sql.DB) {
	if db == nil {
		return
	}
	if _, ok := requestLogEnsured.Load(db); ok {
		return
	}
	b, err := fs.ReadFile(migrations.FS, requestLogMigrationFile)
	if err != nil {
		return
	}
	if _, err := db.ExecContext(context.Background(), string(b)); err != nil {
		return
	}
	requestLogEnsured.Store(db, true)
}

// RequestLogEntry 是一次 API 调用记录：route 为 gin 模板路径，不含实体 id 与查询串。
type RequestLogEntry struct {
	At             string `json:"at"`
	CredentialType string `json:"credential_type"`
	CredentialName string `json:"credential_name,omitempty"`
	Method         string `json:"method"`
	Route          string `json:"route"`
	Status         int    `json:"status"`
	MS             int    `json:"ms"`
}

// requestLogSelfPaths 是日志自己的读写路径：读日志不能再写日志，否则每次查看都污染列表。
func requestLogSelfPaths(path string) bool {
	return strings.Contains(path, "request-logs")
}

// requestLogSkippedPaths 是不记的面：文档/探针/版本（匿名或纯 UI，无归因价值）。
func requestLogSkippedPaths(path string) bool {
	return strings.Contains(path, "/docs") || strings.Contains(path, "/swagger") ||
		path == "/api/version" || path == "/api/openapi.json"
}

// requestLogMiddleware 记已登录请求的调用日志：挂在 attachUser 之后（要身份），
// 所有路由注册之前（gin Use 只对之后注册的生效，见 http.go 的 0be8ae9 注释）。
// 无库实例（单测桩）直接放行；写库失败吞掉，绝不影响主响应。
func requestLogMiddleware(s *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		u := user(c)
		if u == nil || s == nil || s.DB == nil {
			return
		}
		path := c.FullPath()
		if path == "" || requestLogSelfPaths(path) || requestLogSkippedPaths(path) {
			return
		}
		credential := "session"
		name := ""
		if u.FromPAT {
			credential = "pat"
			name = u.TokenName
		}
		LogRequest(c.Request.Context(), s.DB, u.ID, credential, name,
			c.Request.Method, path, c.Writer.Status(), int(time.Since(start).Milliseconds()))
	}
}

// LogRequest 写一行调用日志并按概率清理过期行。错误一律吞掉：日志是派生数据。
func LogRequest(ctx context.Context, db *sql.DB, userID, credential, name, method, route string, status, ms int) {
	if db == nil {
		return
	}
	ensureRequestLogTable(db)
	_, _ = db.ExecContext(ctx, "INSERT INTO catalog.api_request_logs(user_id,credential_type,credential_name,method,route,status,ms) VALUES($1,$2,$3,$4,$5,$6,$7)",
		userID, credential, name, method, route, status, ms)
	// 1% 概率顺手清 30 天前的行：无 cron，自维护；高频写入下期望每百次清一次。
	if rand.Intn(100) == 0 {
		_, _ = db.ExecContext(context.Background(), "DELETE FROM catalog.api_request_logs WHERE at < now() - make_interval(days => $1)", requestLogRetentionDays)
	}
}

// ListRequestLogs 读本人的调用日志（倒序）：credential 为空即全部，否则精确匹配
// credential_name（同名令牌视为同一组）。limit 缺省 50、上限 200。
func ListRequestLogs(ctx context.Context, db *sql.DB, userID, credential string, limit int) ([]RequestLogEntry, error) {
	out := []RequestLogEntry{}
	if db == nil {
		return out, nil
	}
	ensureRequestLogTable(db)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args := []any{userID}
	where := "WHERE user_id=$1"
	if c := strings.TrimSpace(credential); c != "" {
		args = append(args, c)
		where += " AND credential_name=$2"
	}
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, "SELECT at,credential_type,credential_name,method,route,status,ms FROM catalog.api_request_logs "+where+" ORDER BY at DESC LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var e RequestLogEntry
		var at time.Time
		if err := rows.Scan(&at, &e.CredentialType, &e.CredentialName, &e.Method, &e.Route, &e.Status, &e.MS); err != nil {
			return nil, err
		}
		e.At = at.Format(time.RFC3339)
		out = append(out, e)
	}
	return out, rows.Err()
}

// requestLogEndpoint 挂 GET /catalog/developer/request-logs：只读本人的日志。
func requestLogEndpoint(s *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		u := user(c)
		if u == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication_required"})
			return
		}
		if err := validateTextQuery(c, "credential"); err != nil {
			respond(c, nil, err)
			return
		}
		limit, _, err := listPagination(c)
		if err != nil {
			respond(c, nil, err)
			return
		}
		items, err := ListRequestLogs(c.Request.Context(), s.DB, u.ID, c.Query("credential"), limit)
		respond(c, gin.H{"items": items}, err)
	}
}
