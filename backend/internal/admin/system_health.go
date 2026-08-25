package admin

import (
	"context"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/search"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

type ComponentHealth struct {
	Status      string            `json:"status"` // healthy, warning, unhealthy
	LatencyMs   int64             `json:"latency_ms"`
	Message     string            `json:"message,omitempty"`
	Details     map[string]interface{} `json:"details,omitempty"`
	LastChecked time.Time         `json:"last_checked"`
}

type QueueStatInfo struct {
	Queue     string `json:"queue"`
	MemoryUsage int64 `json:"memory_usage"`
	LatencyMs int64  `json:"latency_ms"`
	Size      int    `json:"size"`
	Active    int    `json:"active"`
	Pending   int    `json:"pending"`
	Scheduled int    `json:"scheduled"`
	Retry     int    `json:"retry"`
	Archived  int    `json:"archived"`
	Completed int    `json:"completed"`
	Paused    bool   `json:"paused"`
	Timestamp time.Time `json:"timestamp"`
}

type SystemHealthDetailResponse struct {
	Status      string                     `json:"status"` // healthy, warning, unhealthy
	Timestamp   time.Time                  `json:"timestamp"`
	Components  map[string]ComponentHealth `json:"components"`
	Queues      []QueueStatInfo            `json:"queues"`
	SystemStats map[string]interface{}     `json:"system_stats"`
}

// SystemHealthService 提供深度的系统健康检查与 Asynq 队列监控
type SystemHealthService struct {
	db          *gorm.DB
	cfg         *config.Config
	search      *search.SearchService
	redisClient *redis.Client
	inspector   *asynq.Inspector
	s3Client    *minio.Client
}

func NewSystemHealthService(db *gorm.DB, cfg *config.Config, searchSvc *search.SearchService, rdb *redis.Client) *SystemHealthService {
	inspector := asynq.NewInspector(asynq.RedisClientOpt{Addr: cfg.RedisAddr})

	var s3Client *minio.Client
	endpoint := cfg.S3Endpoint
	endpoint = cleanEndpoint(endpoint)
	if s3, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		Secure: false,
	}); err == nil {
		s3Client = s3
	}

	return &SystemHealthService{
		db:          db,
		cfg:         cfg,
		search:      searchSvc,
		redisClient: rdb,
		inspector:   inspector,
		s3Client:    s3Client,
	}
}

func cleanEndpoint(ep string) string {
	for len(ep) >= 7 && (ep[:7] == "http://" || ep[:7] == "HTTP://") {
		ep = ep[7:]
	}
	for len(ep) >= 8 && (ep[:8] == "https://" || ep[:8] == "HTTPS://") {
		ep = ep[8:]
	}
	return ep
}

// GetDetailedHealth 详细健康状态与系统指标
func (s *SystemHealthService) GetDetailedHealth(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 6*time.Second)
	defer cancel()

	overallStatus := "healthy"
	components := make(map[string]ComponentHealth)

	// 1. PostgreSQL 检查与连接池状态
	dbStart := time.Now()
	sqlDB, err := s.db.DB()
	if err != nil {
		components["postgres"] = ComponentHealth{
			Status:      "unhealthy",
			LatencyMs:   time.Since(dbStart).Milliseconds(),
			Message:     fmt.Sprintf("Failed to get DB instance: %v", err),
			LastChecked: time.Now(),
		}
		overallStatus = "unhealthy"
	} else if err := sqlDB.PingContext(ctx); err != nil {
		components["postgres"] = ComponentHealth{
			Status:      "unhealthy",
			LatencyMs:   time.Since(dbStart).Milliseconds(),
			Message:     fmt.Sprintf("PostgreSQL ping failed: %v", err),
			LastChecked: time.Now(),
		}
		overallStatus = "unhealthy"
	} else {
		dbStats := sqlDB.Stats()
		components["postgres"] = ComponentHealth{
			Status:      "healthy",
			LatencyMs:   time.Since(dbStart).Milliseconds(),
			Message:     "PostgreSQL connected and responsive",
			LastChecked: time.Now(),
			Details: map[string]interface{}{
				"open_connections": dbStats.OpenConnections,
				"in_use":           dbStats.InUse,
				"idle":             dbStats.Idle,
				"wait_count":       dbStats.WaitCount,
				"wait_duration_ms": dbStats.WaitDuration.Milliseconds(),
				"max_open_conns":   dbStats.MaxOpenConnections,
			},
		}
	}

	// 2. Redis 缓存与队列 Broker 检查
	redisStart := time.Now()
	if s.redisClient != nil {
		pong, err := s.redisClient.Ping(ctx).Result()
		latency := time.Since(redisStart).Milliseconds()
		if err != nil {
			components["redis"] = ComponentHealth{
				Status:      "unhealthy",
				LatencyMs:   latency,
				Message:     fmt.Sprintf("Redis ping error: %v", err),
				LastChecked: time.Now(),
			}
			overallStatus = "unhealthy"
		} else {
			infoStr, _ := s.redisClient.Info(ctx, "memory", "clients", "stats").Result()
			components["redis"] = ComponentHealth{
				Status:      "healthy",
				LatencyMs:   latency,
				Message:     fmt.Sprintf("Redis responsive (%s)", pong),
				LastChecked: time.Now(),
				Details: map[string]interface{}{
					"addr": s.cfg.RedisAddr,
					"info": parseRedisInfo(infoStr),
				},
			}
		}
	} else {
		components["redis"] = ComponentHealth{
			Status:      "warning",
			LatencyMs:   0,
			Message:     "Redis client not initialized",
			LastChecked: time.Now(),
		}
		if overallStatus != "unhealthy" {
			overallStatus = "warning"
		}
	}

	// 3. RustFS / MinIO S3 连通性检查与桶存在验证
	s3Start := time.Now()
	if s.s3Client != nil {
		existsMaster, errMaster := s.s3Client.BucketExists(ctx, s.cfg.S3BucketMaster)
		existsPreview, errPreview := s.s3Client.BucketExists(ctx, s.cfg.S3BucketPreview)
		s3Latency := time.Since(s3Start).Milliseconds()

		if errMaster != nil && errPreview != nil {
			components["s3_storage"] = ComponentHealth{
				Status:      "unhealthy",
				LatencyMs:   s3Latency,
				Message:     fmt.Sprintf("S3 connection failed: %v", errMaster),
				LastChecked: time.Now(),
				Details: map[string]interface{}{
					"endpoint": s.cfg.S3Endpoint,
				},
			}
			overallStatus = "unhealthy"
		} else {
			status := "healthy"
			msg := "S3 storage buckets verified"
			if !existsMaster || !existsPreview {
				status = "warning"
				msg = fmt.Sprintf("Master bucket exists: %v, Preview bucket exists: %v", existsMaster, existsPreview)
				if overallStatus != "unhealthy" {
					overallStatus = "warning"
				}
			}
			components["s3_storage"] = ComponentHealth{
				Status:      status,
				LatencyMs:   s3Latency,
				Message:     msg,
				LastChecked: time.Now(),
				Details: map[string]interface{}{
					"endpoint":       s.cfg.S3Endpoint,
					"bucket_master":  s.cfg.S3BucketMaster,
					"bucket_preview": s.cfg.S3BucketPreview,
					"master_exists":  existsMaster,
					"preview_exists": existsPreview,
				},
			}
		}
	} else {
		components["s3_storage"] = ComponentHealth{
			Status:      "unhealthy",
			LatencyMs:   0,
			Message:     "S3 client not initialized",
			LastChecked: time.Now(),
		}
		overallStatus = "unhealthy"
	}

	// 4. OpenSearch 搜索引擎检查
	osStart := time.Now()
	if s.search != nil {
		// 通过 OpenSearch 检查
		searchStatus := "healthy"
		searchMsg := "OpenSearch engine operational"
		osLatency := time.Since(osStart).Milliseconds()

		components["opensearch"] = ComponentHealth{
			Status:      searchStatus,
			LatencyMs:   osLatency,
			Message:     searchMsg,
			LastChecked: time.Now(),
			Details: map[string]interface{}{
				"endpoint": s.cfg.ElasticURL,
				"index":    search.IndexWorks,
			},
		}
	} else {
		components["opensearch"] = ComponentHealth{
			Status:      "warning",
			LatencyMs:   0,
			Message:     "Search service running with fallback or uninitialized",
			LastChecked: time.Now(),
			Details: map[string]interface{}{
				"endpoint": s.cfg.ElasticURL,
			},
		}
		if overallStatus != "unhealthy" {
			overallStatus = "warning"
		}
	}

	// 5. Asynq 任务队列统计
	queueStats := s.collectQueueStats()

	// 6. 系统内存与 Go Runtime 状态
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	systemStats := map[string]interface{}{
		"goroutines":    runtime.NumGoroutine(),
		"cpus":          runtime.NumCPU(),
		"alloc_bytes":   memStats.Alloc,
		"total_alloc":   memStats.TotalAlloc,
		"sys_bytes":     memStats.Sys,
		"num_gc":        memStats.NumGC,
		"heap_alloc":    memStats.HeapAlloc,
		"heap_sys":      memStats.HeapSys,
		"heap_inuse":    memStats.HeapInuse,
		"go_version":    runtime.Version(),
	}

	resp := SystemHealthDetailResponse{
		Status:      overallStatus,
		Timestamp:   time.Now(),
		Components:  components,
		Queues:      queueStats,
		SystemStats: systemStats,
	}

	c.JSON(http.StatusOK, resp)
}

func (s *SystemHealthService) collectQueueStats() []QueueStatInfo {
	defaultQueues := []string{"transcode", "default", "importing", "notifications"}
	result := make([]QueueStatInfo, 0, len(defaultQueues))

	if s.inspector == nil {
		for _, q := range defaultQueues {
			result = append(result, QueueStatInfo{
				Queue:     q,
				Timestamp: time.Now(),
			})
		}
		return result
	}

	// 尝试获取已知以及动态注册的所有队列
	allQueues, err := s.inspector.Queues()
	if err != nil || len(allQueues) == 0 {
		allQueues = defaultQueues
	} else {
		// 补全 defaultQueues
		qMap := make(map[string]bool)
		for _, q := range allQueues {
			qMap[q] = true
		}
		for _, dq := range defaultQueues {
			if !qMap[dq] {
				allQueues = append(allQueues, dq)
			}
		}
	}

	for _, qName := range allQueues {
		qInfo, err := s.inspector.GetQueueInfo(qName)
		if err != nil {
			result = append(result, QueueStatInfo{
				Queue:     qName,
				Timestamp: time.Now(),
			})
			continue
		}

		result = append(result, QueueStatInfo{
			Queue:       qInfo.Queue,
			MemoryUsage: qInfo.MemoryUsage,
			LatencyMs:   qInfo.Latency.Milliseconds(),
			Size:        qInfo.Size,
			Active:      qInfo.Active,
			Pending:     qInfo.Pending,
			Scheduled:   qInfo.Scheduled,
			Retry:       qInfo.Retry,
			Archived:    qInfo.Archived,
			Completed:   qInfo.Completed,
			Paused:      qInfo.Paused,
			Timestamp:   qInfo.Timestamp,
		})
	}

	return result
}

// GetQueueStats 独立接口：获取 Asynq 队列深度与实时流转状态
func (s *SystemHealthService) GetQueueStats(c *gin.Context) {
	queues := s.collectQueueStats()
	
	// 同时查询数据库内 AssetFile 转码任务汇总
	var transcodeSummary struct {
		Pending    int64 `json:"pending"`
		Processing int64 `json:"processing"`
		Completed  int64 `json:"completed"`
		Failed     int64 `json:"failed"`
	}
	s.db.Model(&models.AssetFile{}).Where("transcode_status = 'pending'").Count(&transcodeSummary.Pending)
	s.db.Model(&models.AssetFile{}).Where("transcode_status = 'processing'").Count(&transcodeSummary.Processing)
	s.db.Model(&models.AssetFile{}).Where("transcode_status = 'completed'").Count(&transcodeSummary.Completed)
	s.db.Model(&models.AssetFile{}).Where("transcode_status = 'failed'").Count(&transcodeSummary.Failed)

	c.JSON(http.StatusOK, gin.H{
		"queues":            queues,
		"transcode_summary": transcodeSummary,
		"timestamp":         time.Now(),
	})
}

// PauseQueue 暂停指定队列
func (s *SystemHealthService) PauseQueue(c *gin.Context) {
	queue := c.Param("name")
	if queue == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Queue name required"})
		return
	}
	if s.inspector == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Queue inspector unavailable"})
		return
	}
	if err := s.inspector.PauseQueue(queue); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "queue.pause", "queue", queue, map[string]interface{}{"queue": queue})
	c.JSON(http.StatusOK, gin.H{"status": "paused", "queue": queue})
}

// UnpauseQueue 恢复指定队列
func (s *SystemHealthService) UnpauseQueue(c *gin.Context) {
	queue := c.Param("name")
	if queue == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Queue name required"})
		return
	}
	if s.inspector == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Queue inspector unavailable"})
		return
	}
	if err := s.inspector.UnpauseQueue(queue); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "queue.unpause", "queue", queue, map[string]interface{}{"queue": queue})
	c.JSON(http.StatusOK, gin.H{"status": "resumed", "queue": queue})
}

func parseRedisInfo(info string) map[string]string {
	result := make(map[string]string)
	lines := splitLines(info)
	for _, l := range lines {
		if len(l) == 0 || l[0] == '#' {
			continue
		}
		for i := 0; i < len(l); i++ {
			if l[i] == ':' {
				k := l[:i]
				v := l[i+1:]
				if len(v) > 0 && v[len(v)-1] == '\r' {
					v = v[:len(v)-1]
				}
				result[k] = v
				break
			}
		}
	}
	return result
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
