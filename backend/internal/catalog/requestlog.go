package catalog

import (
	"context"
	"database/sql"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// API 调用日志（开发者中心「API 请求日志」）：只记已登录请求。

// requestLogRetentionDays 调用日志保留天数：按概率触发后台清理。
const requestLogRetentionDays = 30

// 同一进程最多运行一个清理，避免高流量下清理任务堆积。
var requestLogCleanupSlot = make(chan struct{}, 1)

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

// LogRequest 写一行调用日志并按概率安排限时清理。错误一律吞掉：日志是派生数据。
func LogRequest(ctx context.Context, db *sql.DB, userID, credential, name, method, route string, status, ms int) {
	if db == nil {
		return
	}
	_, err := db.ExecContext(ctx, "INSERT INTO catalog.api_request_logs(user_id,credential_type,credential_name,method,route,status,ms) VALUES($1,$2,$3,$4,$5,$6,$7)",
		userID, credential, name, method, route, status, ms)
	if err != nil {
		return
	}
	// 1% 概率触发清理；任务不占用请求尾声，且限时避免持续占用数据库连接。
	if rand.Intn(100) == 0 {
		select {
		case requestLogCleanupSlot <- struct{}{}:
			go func() {
				defer func() { <-requestLogCleanupSlot }()
				cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, _ = db.ExecContext(cleanupCtx, "DELETE FROM catalog.api_request_logs WHERE at < now() - make_interval(days => $1)", requestLogRetentionDays)
			}()
		default:
		}
	}
}

// ListRequestLogs 读本人的调用日志（倒序）：credential 为空即全部，否则精确匹配
// credential_name（同名令牌视为同一组）。limit 缺省 50、上限 200。
func ListRequestLogs(ctx context.Context, db *sql.DB, userID, credential string, limit int) ([]RequestLogEntry, error) {
	out := []RequestLogEntry{}
	if db == nil {
		return out, nil
	}
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
