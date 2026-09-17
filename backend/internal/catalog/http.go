package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type HTTP struct{ Store *Store }

func respond(c *gin.Context, v any, err error) {
	if err == nil {
		c.JSON(200, v)
		return
	}
	status := 400
	code := err.Error()
	var pg *pq.Error
	if errors.Is(err, sql.ErrNoRows) {
		status = 404
		code = "not_found"
	} else if errors.As(err, &pg) {
		switch pg.Code {
		case "23503", "23514", "23505":
			code = "constraint_violation"
		case "22P02":
			code = "invalid_id"
		default:
			status = 500
			code = "database_error"
		}
	} else if errors.Is(err, errForbidden) {
		// 按错误链判定：delivery_partial/merge_relation_conflict 这类 %w 包裹后
		// err.Error() 是拼接串，全等比较会让 403 退化成 400。
		// 401 不在这里产生：未登录由 required() 闸门直接返回 authentication_required，
		// 目录服务内没有 invalid_credentials 的生产者（原分支已删）。
		status = 403
	} else if errors.Is(err, errVersionConflict) {
		status = 409
	}
	// 错误响应统一为单一 error 字段（值为稳定机器码）；database_error 只透出固定码，
	// 不附带 SQL 原文。
	c.JSON(status, gin.H{"error": code})
}
func body(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		c.JSON(400, gin.H{"error": "invalid_payload"})
		return false
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		c.JSON(400, gin.H{"error": "invalid_payload"})
		return false
	}
	return true
}
func user(c *gin.Context) *User {
	v, ok := c.Get("catalog_user")
	if !ok {
		return nil
	}
	return v.(*User)
}

// required 是路由级闸门：code 为空只要求已登录，否则要求令牌带对应权限码。
// 角色兜底集中在 User.Can 里，这里不再比角色字符串（见 permission.go）。
func required(code string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u := user(c)
		if u == nil {
			c.AbortWithStatusJSON(401, gin.H{"error": "authentication_required"})
			return
		}
		if code != "" && !u.Can(code) {
			c.AbortWithStatusJSON(403, gin.H{"error": "forbidden"})
			return
		}
		c.Next()
	}
}

// routeBucket 是内存固定窗口计数, key 为 IP+完整路由。账号侧的登录限流归账号服务，
type routeBucket struct {
	mu       sync.Mutex
	start    time.Time
	n        int
	lastSeen time.Time
}

var (
	routeAttempts sync.Map // string -> *routeBucket
	routeJanitor  sync.Once
)

// sweepStaleBuckets 每小时清理超 2 小时未见的限流桶，防止 sync.Map 无限增长。
// 进程内存限流本就只防单机突发，多实例一致性放三期（Redis）。
func sweepStaleBuckets(m *sync.Map, janitor *sync.Once) {
	janitor.Do(func() {
		go func() {
			for range time.Tick(time.Hour) {
				cutoff := time.Now().Add(-2 * time.Hour)
				m.Range(func(k, v any) bool {
					if b, ok := v.(*routeBucket); ok {
						b.mu.Lock()
						stale := !b.lastSeen.IsZero() && b.lastSeen.Before(cutoff)
						b.mu.Unlock()
						if stale {
							m.Delete(k)
						}
					}
					return true
				})
			}
		}()
	})
}

// routeLimiter 按 IP+路由限流重型 GET 接口, 超限返回 429 + Retry-After(秒)。
// 口径说明（最小一致化，不做 Redis 大重构）：内存固定窗口，只防单机突发；
// 写接口（POST entities/relations 等）暂无独立重型限流；多实例一致性与写接口重型限流
// 放三期（Redis）。
func routeLimiter(perMinute int) gin.HandlerFunc {
	sweepStaleBuckets(&routeAttempts, &routeJanitor)
	return func(c *gin.Context) {
		key := c.ClientIP() + "|" + c.FullPath()
		now := time.Now()
		v, _ := routeAttempts.LoadOrStore(key, &routeBucket{start: now, lastSeen: now})
		b := v.(*routeBucket)
		b.mu.Lock()
		if now.Sub(b.start) > time.Minute {
			b.start = now
			b.n = 0
		}
		b.n++
		b.lastSeen = now
		over := b.n > perMinute
		retrySecs := int(time.Until(b.start.Add(time.Minute)).Seconds()) + 1
		b.mu.Unlock()
		if retrySecs < 1 {
			retrySecs = 1
		}
		if over {
			c.Header("Retry-After", strconv.Itoa(retrySecs))
			c.AbortWithStatusJSON(429, gin.H{"error": "rate_limited"})
			return
		}
		c.Next()
	}
}

// idemEntry 写接口幂等缓存: Idempotency-Key -> 首创返回体, TTL 24h, 进程内存。
// 命中直接返回原结果, 不建重复实体; 分布式/持久化幂等放三期。
// 口径说明（最小一致化）：仅覆盖 POST /catalog/entities 与 POST /catalog/relations；
// 缓存键为 路由|用户|Idempotency-Key，不做载荷哈希；并发同键双建需调用方重试确认，
// 不保证单飞（singleflight）语义。
type idemEntry struct {
	value any
	exp   time.Time
}

var (
	idemCache   sync.Map // string -> idemEntry
	idemJanitor sync.Once
)

func idemSweep() {
	idemJanitor.Do(func() {
		go func() {
			for range time.Tick(time.Hour) {
				now := time.Now()
				idemCache.Range(func(k, v any) bool {
					if e, ok := v.(idemEntry); ok && now.After(e.exp) {
						idemCache.Delete(k)
					}
					return true
				})
			}
		}()
	})
}

func idemCacheKey(c *gin.Context) (string, bool) {
	key := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if key == "" {
		return "", false
	}
	uid := ""
	if u := user(c); u != nil {
		uid = u.ID
	}
	return c.FullPath() + "|" + uid + "|" + key, true
}

func idemLookup(c *gin.Context) (any, bool) {
	ck, ok := idemCacheKey(c)
	if !ok {
		return nil, false
	}
	if v, ok := idemCache.Load(ck); ok {
		if e, ok := v.(idemEntry); ok && time.Now().Before(e.exp) {
			return e.value, true
		}
		idemCache.Delete(ck)
	}
	return nil, false
}

func idemStore(c *gin.Context, value any) {
	ck, ok := idemCacheKey(c)
	if !ok {
		return
	}
	idemSweep()
	idemCache.Store(ck, idemEntry{value: value, exp: time.Now().Add(24 * time.Hour)})
}

// queryList 读取可重复/逗号分隔的多值查询参数（与 tags 同一约定），去空去重后返回，
// 供 kinds/types 这类多值过滤使用。
func queryList(c *gin.Context, name string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range c.QueryArray(name) {
		for _, v := range strings.Split(raw, ",") {
			if v = strings.TrimSpace(v); v != "" && !seen[v] {
				seen[v] = true
				out = append(out, v)
			}
		}
	}
	return out
}

func (h HTTP) Register(r *gin.Engine) {
	h.registerGroup(r.Group("/api"))
}

func (h HTTP) registerGroup(api *gin.RouterGroup) {
	s := h.Store
	// 实例间导入导出：原属模块层，随子系统拆分迁入目录包（见 exchange.go）。
	h.registerExchange(api)
	api.GET("/openapi.json", func(c *gin.Context) { c.JSON(200, OpenAPI()) })
	api.GET("/docs", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(200, docsHTML)
	})
	api.GET("/swagger", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(200, swaggerHTML)
	})
	// 身份只来自账号服务签发的 RS256 令牌：目录侧**只验签、不查库、不签发**。
	// 因此这里不再有"会话表兜底"分支——账号数据归账号服务，目录不读它的表。
	// Bearer 与 Cookie 各试一次：前端可能带着刚过期的 Bearer 令牌，
	// 而 HttpOnly Cookie 里是刷新后的新令牌（或反之），不能互相顶掉。
	api.Use(func(c *gin.Context) {
		bearer := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		cookie, _ := c.Cookie("mf_session")
		for _, token := range []string{bearer, cookie} {
			if token == "" {
				continue
			}
			if u, err := s.Authenticate(token); err == nil {
				c.Set("catalog_user", u)
				break
			}
		}
		c.Next()
	})
	cat := api.Group("/catalog")
	// 发布的定义文档 + 固定骨架的多语言名称。kinds 放在文档**外面**：它是骨架的显示名，
	// 不是可编辑的动态定义（放进 document 会被后台保存时当成未知键处理），但同样必须由服务端
	// 提供多语言，前端不硬编码。
	cat.GET("/definitions", func(c *gin.Context) {
		v, err := s.Definitions(c.Request.Context())
		if err != nil {
			respond(c, nil, err)
			return
		}
		respond(c, gin.H{"id": v.ID, "state": v.State, "base_version": v.BaseVersion, "document": v.Document, "created_at": v.CreatedAt, "kinds": KindNameRecords()}, nil)
	})
	// 标签聚合：标签不是独立字典表，而是散落在各实体的 attributes.tags 中。
	// jsonb_array_elements_text 展开数组就地统计频次，供前端标签云与筛选建议；
	// 只统计已发布实体（与列表接口的匿名可见性口径一致）。
	// 分页口径：limit 越界（<=0 或 >500）静默收敛为 200，与 List 的静默收敛风格一致，
	// 不硬拒绝；与 expressions/details 的 ids 硬拒绝（400）差异是刻意的：
	// 后者是 POST body 批量参数，超限直接拒绝避免大查询拖库。
	cat.GET("/tags", routeLimiter(120), func(c *gin.Context) {
		args := []any{}
		where := []string{"e.status='published'", "jsonb_typeof(e.document->'attributes'->'tags')='array'"}
		if q := strings.TrimSpace(c.Query("q")); q != "" {
			args = append(args, "%"+q+"%")
			where = append(where, fmt.Sprintf("t.name ILIKE $%d", len(args)))
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		if limit <= 0 || limit > 500 {
			limit = 200
		}
		args = append(args, limit)
		rows, err := s.DB.QueryContext(c.Request.Context(), `
		SELECT t.name, count(*) AS n
		FROM catalog.entities e,
		     jsonb_array_elements_text(e.document->'attributes'->'tags') AS t(name)
		WHERE `+strings.Join(where, " AND ")+`
		GROUP BY t.name
		ORDER BY n DESC, t.name
		LIMIT $`+strconv.Itoa(len(args)), args...)
		if err != nil {
			// 查询失败不能再回 200 空表：DB 故障看起来会像"库里没有标签"，
			// 前端标签云与筛选建议会静默变空（错误由 respond 统一成 500/database_error）。
			respond(c, nil, err)
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var name string
			var n int
			if err := rows.Scan(&name, &n); err != nil {
				respond(c, nil, err)
				return
			}
			items = append(items, map[string]any{"name": name, "count": n})
		}
		// 迭代中途断连同样要暴露：rows.Err() 才记录 Next 的终止原因。
		if err := rows.Err(); err != nil {
			respond(c, nil, err)
			return
		}
		respond(c, gin.H{"items": items, "total": len(items)}, nil)
	})
	cat.GET("/entities", routeLimiter(120), func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.Query("limit"))
		offset, _ := strconv.Atoi(c.Query("offset"))
		o := ListOptions{Kind: c.Query("kind"), Query: c.Query("q"), Type: c.Query("type"), Status: c.Query("status"), WorkID: c.Query("work_id"), ContentUnitID: c.Query("content_unit_id"), ReleaseID: c.Query("release_id"), MediumID: c.Query("medium_id"), ParentID: c.Query("parent_id"), Field: c.Query("field"), Value: c.Query("value"), Limit: limit, Offset: offset}
		// kinds / types 支持多次出现或逗号分隔：多值命中在 SQL 侧完成，
		// 供关系编辑器按"kind + 业务类型"收敛候选，避免前端先取固定条数再过滤而漏候选。
		o.Kinds = queryList(c, "kinds")
		o.Types = queryList(c, "types")
		// tags 支持多次出现或逗号分隔，任一命中即返回。
		for _, raw := range c.QueryArray("tags") {
			for _, tag := range strings.Split(raw, ",") {
				if t := strings.TrimSpace(tag); t != "" {
					o.Tags = append(o.Tags, t)
				}
			}
		}
		items, err := s.List(c.Request.Context(), o, user(c))
		if err != nil {
			respond(c, nil, err)
			return
		}
		total, err := s.Count(c.Request.Context(), o, user(c))
		respond(c, gin.H{"items": items, "total": total}, err)
	})
	cat.GET("/entities/:id", func(c *gin.Context) { e, err := s.Get(c.Request.Context(), c.Param("id"), user(c)); respond(c, e, err) })
	cat.GET("/entities/:id/resolve", func(c *gin.Context) {
		e, err := s.Resolve(c.Request.Context(), c.Param("id"), user(c))
		respond(c, e, err)
	})
	cat.POST("/entities", required(""), func(c *gin.Context) {
		// 幂等命中直接返回首创结果, 不建重复实体。
		if cached, ok := idemLookup(c); ok {
			c.JSON(200, cached)
			return
		}
		var in Edit
		if !body(c, &in) {
			return
		}
		if in.Entity.ID != "" {
			c.JSON(400, gin.H{"error": "id_must_be_empty"})
			return
		}
		e, err := s.Save(c.Request.Context(), in, *user(c))
		if err == nil {
			idemStore(c, e)
		}
		respond(c, e, err)
	})
	cat.PUT("/entities/:id", required(""), func(c *gin.Context) {
		var in Edit
		if !body(c, &in) {
			return
		}
		in.Entity.ID = c.Param("id")
		e, err := s.Save(c.Request.Context(), in, *user(c))
		respond(c, e, err)
	})
	cat.POST("/entities/:id/lifecycle", required(PermissionLifecycleManage), func(c *gin.Context) {
		var in LifecycleEdit
		if !body(c, &in) {
			return
		}
		e, err := s.Lifecycle(c.Request.Context(), c.Param("id"), in, *user(c))
		respond(c, e, err)
	})
	cat.GET("/entities/:id/revisions", func(c *gin.Context) {
		v, err := s.Revisions(c.Request.Context(), c.Param("id"), user(c))
		respond(c, gin.H{"items": v}, err)
	})
	cat.GET("/entities/:id/relations", func(c *gin.Context) {
		v, self, err := s.relationsWithSubject(c.Request.Context(), c.Param("id"), user(c))
		if err != nil {
			respond(c, nil, err)
			return
		}
		// 同一响应内返回关系两端实体 + 被查询实体自身（单次批量查询）：真实条目署名可达数百条，
		// 前端逐条 Get 会因截断与限流丢失端点，详情页只能显示原始 UUID。
		// subject_id 显式标出"哪个是自己"：调用方按 entities[it.source_id] 渲染"谁→谁"时
		// 不必再猜主体是哪一端。
		respond(c, gin.H{
			"items":      v,
			"entities":   h.resolveRelated(c.Request.Context(), self, v, user(c)),
			"subject_id": self.ID,
		}, nil)
	})
	cat.GET("/entities/:id/occurrences", func(c *gin.Context) {
		v, err := s.Occurrences(c.Request.Context(), c.Param("id"), user(c))
		respond(c, gin.H{"items": v}, err)
	})
	// 发行详情页批量上屏：一次取多条表达实体 + 自身收录 + 同篇目兄弟收录 + 署名，
	// 替代逐条四类 N+1 请求。用 POST + JSON body 传 ids：300 个 UUID 拼进 GET
	// query 约 11KB，会超过 Nginx 默认 8KB 请求行限制。
	cat.POST("/expressions/details", routeLimiter(120), func(c *gin.Context) {
		var in struct {
			IDs []string `json:"ids"`
		}
		if !body(c, &in) {
			return
		}
		ids := []string{}
		for _, id := range in.IDs {
			if id = strings.TrimSpace(id); id != "" {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			c.JSON(400, gin.H{"error": "invalid_payload"})
			return
		}
		if len(ids) > 500 {
			c.JSON(400, gin.H{"error": "too_many_ids"})
			return
		}
		v, err := s.ExpressionDetailsBatch(c.Request.Context(), ids, user(c))
		// 响应含 items（按表达聚合，收录以引用 id 呈现）与共享 entities 表。
		respond(c, v, err)
	})
	cat.GET("/external-databases", func(c *gin.Context) {
		v, err := s.ListExternalDatabases(c.Request.Context(), c.Query("category"), true)
		respond(c, gin.H{"items": v}, err)
	})
	cat.GET("/shelves", func(c *gin.Context) {
		v, err := s.ListShelves(c.Request.Context(), true)
		respond(c, gin.H{"items": v}, err)
	})
	// /shelves/feed 一次返回每个分区及其求值后的条目，供首页直接渲染。
	// 规则里的 fields/vocab_terms/relations 只有服务端能判定，放在这里避免前端近似匹配。
	// 登录用户按个人偏好合并：sections 覆盖同名系统货架/追加自建分区，order 重排，
	// hidden 过滤；每条 shelf 带 source（system/custom）供前端决定能否删除。
	// 匿名与未设置偏好者按 sort_order 默认序，且只有 system。
	cat.GET("/shelves/feed", routeLimiter(60), func(c *gin.Context) {
		perShelf, _ := strconv.Atoi(c.Query("per_shelf"))
		shelves, err := s.ListShelves(c.Request.Context(), true)
		if err != nil {
			respond(c, nil, err)
			return
		}
		prefs := HomePreferences{}
		if u := user(c); u != nil {
			prefs, err = s.GetHomePreferences(c.Request.Context(), u.ID)
			if err != nil {
				respond(c, nil, err)
				return
			}
		}
		shelves = applyHomePreferences(shelves, prefs)
		out := make([]gin.H, 0, len(shelves))
		for _, sh := range shelves {
			items, ierr := s.ListShelfItems(c.Request.Context(), sh, perShelf, user(c))
			if ierr != nil {
				respond(c, nil, ierr)
				return
			}
			out = append(out, gin.H{"shelf": sh, "items": items})
		}
		c.JSON(200, gin.H{"items": out})
	})
	// 个人首页偏好读：需登录，未登录返回 401（与 required("") 语义一致，
	// 不再用匿名 404 误导前端走“未找到”分支）。sections 为"覆盖 + 自建"列表，
	// slug 与系统货架同名表示覆盖本人视角（不是冲突），不同名表示新增分区。
	cat.GET("/me/home-preferences", required(""), func(c *gin.Context) {
		v, err := s.GetHomePreferences(c.Request.Context(), user(c).ID)
		respond(c, v, err)
	})
	// 个人首页偏好写：需登录、不限管理员，与读端对称。
	cat.PUT("/me/home-preferences", required(""), func(c *gin.Context) {
		var in HomePreferences
		if !body(c, &in) {
			return
		}
		v, err := s.SaveHomePreferences(c.Request.Context(), user(c).ID, in)
		respond(c, v, err)
	})
	cat.GET("/compare", routeLimiter(10), func(c *gin.Context) {
		v, err := s.Compare(c.Request.Context(), strings.Split(c.Query("ids"), ","), user(c))
		respond(c, gin.H{"items": v}, err)
	})
	// 导入端点按 catalog.import.submit 收口（账号服务已把该码分配给目录编辑/目录管理员组）：
	// 预览与落库同权限——两者都按载荷里的来源 ID 出站抓取，匿名预览是免费的出站放大面。
	// 预览另有分集分页与 ≤8 并发详情抓取，因此按 /compare 同档加 10/min 限流；
	// 顺序为先鉴权后限流：限流桶按 IP+路由计数，不该被未授权流量挤占。
	imp := api.Group("/importer")
	imp.POST("/preview", required(PermissionImportSubmit), routeLimiter(10), func(c *gin.Context) {
		var in ImporterPreviewRequest
		if !body(c, &in) {
			return
		}
		// media_type_hint 是声明而非输入：来源解析按 URL/ID 判定媒介类型，不接受调用方覆盖，
		// 与 /importer/import 同口径明确拒绝（旧行为是收下后从不读取）。
		if strings.TrimSpace(in.MediaTypeHint) != "" {
			c.JSON(400, gin.H{"error": "not_supported: media_type_hint"})
			return
		}
		if strings.TrimSpace(in.URLOrID) == "" {
			c.JSON(400, gin.H{"error": "invalid_payload"})
			return
		}
		v, err := s.Preview(c.Request.Context(), in.Source, in.URLOrID, in.EntityType)
		if err == nil {
			c.JSON(200, v)
			return
		}
		respond(c, nil, err)
	})
	imp.POST("/import", required(PermissionImportSubmit), func(c *gin.Context) {
		var in ImporterImportRequest
		if !body(c, &in) {
			return
		}
		v, err := s.Import(c.Request.Context(), in, *user(c))
		respond(c, v, err)
	})
	// 关系写端点强制 catalog.relation.edit：与实体编辑分开的码（账号服务已分配），
	// 端点级闸门挡住无码者的写请求，细粒度两端判定仍在 SaveRelation（canWriteRelation/canAttachToTarget）。
	cat.POST("/relations", required(PermissionRelationEdit), func(c *gin.Context) {
		// 幂等命中直接返回首创结果, 不建重复关系。
		if cached, ok := idemLookup(c); ok {
			c.JSON(200, cached)
			return
		}
		var in RelationEdit
		if !body(c, &in) {
			return
		}
		if in.Relation.ID != "" {
			c.JSON(400, gin.H{"error": "id_must_be_empty"})
			return
		}
		v, err := s.SaveRelation(c.Request.Context(), in, *user(c))
		if err == nil {
			idemStore(c, v)
		}
		respond(c, v, err)
	})
	cat.PUT("/relations/:id", required(PermissionRelationEdit), func(c *gin.Context) {
		var in RelationEdit
		if !body(c, &in) {
			return
		}
		in.Relation.ID = c.Param("id")
		v, err := s.SaveRelation(c.Request.Context(), in, *user(c))
		respond(c, v, err)
	})
	cat.DELETE("/relations/:id", required(PermissionRelationEdit), func(c *gin.Context) {
		var in LifecycleEdit
		if !body(c, &in) {
			return
		}
		respond(c, gin.H{"ok": true}, s.DeleteRelation(c.Request.Context(), c.Param("id"), in.ExpectedVersion, in.EditNote, in.Sources, *user(c)))
	})
	defs := api.Group("/admin/catalog-definitions", required(PermissionDefinitionsManage))
	// include_document 缺省 true（既有调用方不变）；false 时列表项不带 document，
	// 顶层的 include_document 说明本次响应是否含文档，前端据此决定要不要按 id 取详情。
	// 取值非法直接 400：静默按 true 处理会让"以为瘦身了"的调用方继续拉回整份文档。
	defs.GET("", func(c *gin.Context) {
		includeDocument := true
		if raw, ok := c.GetQuery("include_document"); ok && strings.TrimSpace(raw) != "" {
			v, err := strconv.ParseBool(strings.TrimSpace(raw))
			if err != nil {
				c.JSON(400, gin.H{"error": "invalid_payload"})
				return
			}
			includeDocument = v
		}
		v, err := s.DefinitionVersions(c.Request.Context(), includeDocument)
		respond(c, gin.H{"items": v, "include_document": includeDocument}, err)
	})
	// 单版本详情：{id} 是任意历史版本行（含 superseded/draft），返回完整文档与元数据。
	// 非数字 id 与不存在的 id 同处理：解析成 0 后查不到即 404 not_found，与 /impact、/rollback 同风格。
	defs.GET("/:id", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		v, err := s.DefinitionDetail(c.Request.Context(), id)
		respond(c, v, err)
	})
	// 版本间差异：against 缺省（未传或空）= 该版本的 base_version，即"与上一版比"；显式给出则与指定
	// 版本比。两端任一版本不存在即 404（非数字 id 照旧按不存在处理）；query 里的 against 不合法是
	// 请求形状错误，直接 400 invalid_payload，不静默退回默认基线。
	defs.GET("/:id/diff", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		var against int64
		if raw, ok := c.GetQuery("against"); ok && strings.TrimSpace(raw) != "" {
			v, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
			if err != nil {
				c.JSON(400, gin.H{"error": "invalid_payload"})
				return
			}
			against = v
		}
		v, err := s.DefinitionDiff(c.Request.Context(), id, against)
		respond(c, v, err)
	})
	defs.POST("", func(c *gin.Context) {
		var in struct {
			Document    Definitions `json:"document"`
			BaseVersion int64       `json:"base_version"`
			EditNote    string      `json:"edit_note"`
			Sources     []Source    `json:"sources"`
		}
		if !body(c, &in) {
			return
		}
		id, err := s.Draft(c.Request.Context(), in.Document, in.BaseVersion, *user(c), in.EditNote, in.Sources)
		respond(c, gin.H{"id": id}, err)
	})
	defs.GET("/:id/impact", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		v, err := s.Impact(c.Request.Context(), id)
		respond(c, gin.H{"issues": v}, err)
	})
	defs.POST("/:id/publish", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		var in LifecycleEdit
		if !body(c, &in) {
			return
		}
		respond(c, gin.H{"ok": true}, s.Publish(c.Request.Context(), id, *user(c), in.EditNote, in.Sources))
	})
	// 回滚：{id} 是任意历史版本行（含 superseded），编辑说明与来源由服务端从该版本自己的修订记录
	// 拼出，因此不接受请求体。非数字 id 与不存在的 id 同处理：查不到即 404 not_found，
	// 与 /impact、/publish 的既有风格一致。
	defs.POST("/:id/rollback", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		v, err := s.RollbackDefinitions(c.Request.Context(), id, *user(c))
		respond(c, v, err)
	})
	ext := api.Group("/admin/external-databases", required(PermissionDefinitionsManage))
	ext.GET("", func(c *gin.Context) {
		v, err := s.ListExternalDatabases(c.Request.Context(), c.Query("category"), false)
		respond(c, gin.H{"items": v}, err)
	})
	ext.POST("", func(c *gin.Context) {
		var in ExternalDatabase
		if !body(c, &in) {
			return
		}
		v, err := s.CreateExternalDatabase(c.Request.Context(), in)
		respond(c, gin.H{"message": "created", "data": v}, err)
	})
	ext.PUT("/:code", func(c *gin.Context) {
		var in ExternalDatabase
		if !body(c, &in) {
			return
		}
		v, err := s.UpdateExternalDatabase(c.Request.Context(), c.Param("code"), in)
		respond(c, gin.H{"message": "updated", "data": v}, err)
	})
	ext.DELETE("/:code", func(c *gin.Context) {
		respond(c, gin.H{"message": "deleted"}, s.DeleteExternalDatabase(c.Request.Context(), c.Param("code")))
	})
	shelves := api.Group("/admin/shelves", required(PermissionShelvesManage))
	shelves.GET("", func(c *gin.Context) {
		v, err := s.ListShelves(c.Request.Context(), false)
		respond(c, gin.H{"items": v}, err)
	})
	shelves.POST("", func(c *gin.Context) {
		var in Shelf
		if !body(c, &in) {
			return
		}
		v, err := s.CreateShelf(c.Request.Context(), in)
		respond(c, gin.H{"message": "created", "data": v}, err)
	})
	shelves.GET("/:id", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		v, err := s.GetShelf(c.Request.Context(), id)
		respond(c, gin.H{"data": v}, err)
	})
	shelves.PUT("/:id", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		var in Shelf
		if !body(c, &in) {
			return
		}
		v, err := s.UpdateShelf(c.Request.Context(), id, in)
		respond(c, gin.H{"message": "updated", "data": v}, err)
	})
	shelves.DELETE("/:id", func(c *gin.Context) {
		id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
		respond(c, gin.H{"message": "deleted"}, s.DeleteShelf(c.Request.Context(), id))
	})
}

const docsHTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <title>MetaFusion API 交互式文档 (Scalar)</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
      body { margin: 0; padding: 0; background: #0b0f19; }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/api/openapi.json"
      data-configuration='{"theme": "purple", "hideModels": false, "showSidebar": true}'>
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`

const swaggerHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>MetaFusion API 文档 (Swagger UI)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`

// resolveRelated 批量解析关系实体（单次查询），失败/不可见的跳过。
// 映射必须覆盖**每条返回关系的两端**，外加被查询实体自身：
// 只解析"另一端"会让调用方按 entities[it.source_id] 渲染时把主体一侧渲染成 ?；
// 属性引用边（Via 非空）两端都不是本实体，只补一端同样会缺。
// 输入是本次响应真正要返回的 rels，因此分页/截断（limit）后映射不会因"某端不在本页"而缺失。
// u 用请求方身份，保证草稿实体的创建者/管理员能看到自己的关系端点。
// 不设固定条数上限：真实条目（如动画）署名可达数百条，截断会让详情页缺数据。
func (h HTTP) resolveRelated(ctx context.Context, self Entity, rels []Relation, u *User) map[string]Entity {
	ids := make([]string, 0, len(rels)*2+1)
	seen := map[string]bool{}
	add := func(id string) {
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	// 主体排在最前：它在响应里是 subject_id 指向的条目，缺失会让调用方拿不到主体摘要。
	add(self.ID)
	for _, r := range rels {
		add(r.SourceID)
		add(r.TargetID)
	}
	got, err := h.Store.GetManyVisible(ctx, ids, u)
	if err != nil {
		return map[string]Entity{}
	}
	return got
}
