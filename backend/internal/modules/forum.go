package modules

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/metafusion/metafusion-app/internal/moduleapi"
)

// 论坛是本站自建的独立讨论系统：板块（board）→ 主题（topic）→ 回复（post）。
// 话题（主题）与"实体评论"共用 forum_topics 存储，靠板块区分语义：
// 评论锚定实体、无独立标题、不进信息流；主题可独立成文、有标题、进信息流。
//
// 数据只落 modules schema，不触碰 catalog 实体表。

// defaultBoards 是首次运行播种的板块。名称以 names JSONB 存储（四语回退），
// 前端展示优先走 i18n 键 board.<code>，这里的名称仅作离线/未知语种回退。
var defaultBoards = []struct {
	Code    string
	Names   map[string]string
	Descs   map[string]string
	Color   string
	Icon    string
	Order   int
	InFeed  bool
}{
	{"announcement", map[string]string{"zh-CN": "站点公告", "zh-TW": "站點公告", "ja-JP": "お知らせ", "en-US": "Announcements"},
		map[string]string{"zh-CN": "站点公告与运营通知", "zh-TW": "站點公告與營運通知", "ja-JP": "サイトからのお知らせ", "en-US": "Site announcements"}, "amber", "Megaphone", 10, true},
	{"casual", map[string]string{"zh-CN": "闲聊杂谈", "zh-TW": "閒聊雜談", "ja-JP": "雑談", "en-US": "Casual"},
		map[string]string{"zh-CN": "轻松闲聊与日常交流", "zh-TW": "輕鬆閒聊與日常交流", "ja-JP": "気軽な雑談と交流", "en-US": "Casual chat"}, "purple", "Coffee", 20, true},
	{"qa", map[string]string{"zh-CN": "求助答疑", "zh-TW": "求助答疑", "ja-JP": "質問・回答", "en-US": "Q&A"},
		map[string]string{"zh-CN": "使用问题、编目与功能答疑", "zh-TW": "使用問題、編目與功能答疑", "ja-JP": "使い方・編目・機能の質問", "en-US": "Questions and help"}, "teal", "Hash", 30, true},
	{"reviews", map[string]string{"zh-CN": "考据评注", "zh-TW": "考據評註", "ja-JP": "考証・レビュー", "en-US": "Reviews"},
		map[string]string{"zh-CN": "版本考证、原盘评析与文献释读", "zh-TW": "版本考證、原盤評析與文獻釋讀", "ja-JP": "版の考証・レビュー", "en-US": "Edition analysis and reviews"}, "emerald", "BookOpen", 40, true},
	{"bug_report", map[string]string{"zh-CN": "反馈与建议", "zh-TW": "回饋與建議", "ja-JP": "不具合報告・要望", "en-US": "Feedback"},
		map[string]string{"zh-CN": "缺陷反馈、功能建议与复现信息", "zh-TW": "缺陷回饋、功能建議與重現資訊", "ja-JP": "不具合報告と機能要望", "en-US": "Bug reports and feature requests"}, "rose", "Bug", 50, true},
	{"comment", map[string]string{"zh-CN": "评论专用", "zh-TW": "評論專用", "ja-JP": "コメント用", "en-US": "Comments"},
		map[string]string{"zh-CN": "作品与讨论的评论承载区，不进入信息流", "zh-TW": "作品與討論的評論承載區，不進入資訊流", "ja-JP": "コメント専用（フィード非表示）", "en-US": "Comment carrier, excluded from feeds"}, "sky", "MessageCircle", 60, false},
}

func seedForum(ctx context.Context, db *sql.DB) error {
	for _, b := range defaultBoards {
		names, _ := json.Marshal(b.Names)
		descs, _ := json.Marshal(b.Descs)
		if _, err := db.ExecContext(ctx, `
			INSERT INTO modules.forum_boards(code,names,descriptions,color,icon,sort_order,is_enabled,show_in_feed)
			VALUES($1,$2,$3,$4,$5,$6,true,$7) ON CONFLICT (code) DO NOTHING`,
			b.Code, string(names), string(descs), b.Color, b.Icon, b.Order, b.InFeed); err != nil {
			return err
		}
	}
	return nil
}

// commentBoard 是承载"实体评论"的板块。评论与论坛主题共用 forum_topics 存储，
// 靠板块区分语义：评论锚定实体、无独立标题、不进信息流；主题有标题、可独立成文。
const commentBoard = "comment"

// feedScanCap 是带关键词搜索时的扫描上限。评论正文在 modules schema，而条目
// 标题在 catalog schema，跨 schema 无法在一条 SQL 内完成匹配，因此取一个有界
// 窗口在 Go 侧过滤，避免无上限地把整表读进内存。
const feedScanCap = 500

// migratePostsToComments 把历史表 modules.posts（实体短评）并入 forum_topics 的
// 评论板块。modules schema 的表由本包内联 DDL 创建，不走 SQL 迁移文件，否则在全新
// 数据库上会出现"迁移先于建表"的顺序问题；因此这里同样用内联、幂等的方式做。
// 复用原 uuid 作为 forum_topics.id，使既有 permalink 继续可用。
func migratePostsToComments(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS modules.schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	var done bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM modules.schema_migrations WHERE name='posts_to_comments')`).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	// 仅当历史表存在时才并轨；全新部署没有该表，直接标记完成。
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='modules' AND table_name='posts')`).Scan(&exists); err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if exists {
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO modules.forum_topics(id,board_code,author_id,author_name,title,body,entity_id,created_at,updated_at,last_activity_at)
			SELECT p.id, $1, p.author_id, COALESCE(NULLIF(p.author_name,''),'Anonymous'), '', p.body, p.entity_id, p.created_at, p.created_at, p.created_at
			FROM modules.posts p
			WHERE NOT EXISTS (SELECT 1 FROM modules.forum_topics t WHERE t.id = p.id)`, commentBoard); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `DROP TABLE modules.posts`); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO modules.schema_migrations(name) VALUES('posts_to_comments') ON CONFLICT DO NOTHING`); err != nil {
		return err
	}
	return tx.Commit()
}

type forumBoard struct {
	Code         string            `json:"code"`
	Names        map[string]string `json:"names"`
	Descriptions map[string]string `json:"descriptions"`
	Color        string            `json:"color"`
	Icon         string            `json:"icon"`
	SortOrder    int               `json:"sort_order"`
	IsEnabled    bool              `json:"is_enabled"`
	ShowInFeed   bool              `json:"show_in_feed"`
}

func (m *Manager) listBoards(ctx context.Context) ([]forumBoard, error) {
	rows, err := m.db.QueryContext(ctx, `SELECT code,names,descriptions,color,icon,sort_order,is_enabled,show_in_feed FROM modules.forum_boards ORDER BY sort_order,code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []forumBoard{}
	for rows.Next() {
		var b forumBoard
		var names, descs []byte
		if err := rows.Scan(&b.Code, &names, &descs, &b.Color, &b.Icon, &b.SortOrder, &b.IsEnabled, &b.ShowInFeed); err != nil {
			return nil, err
		}
		b.Names = map[string]string{}
		b.Descriptions = map[string]string{}
		_ = json.Unmarshal(names, &b.Names)
		_ = json.Unmarshal(descs, &b.Descriptions)
		out = append(out, b)
	}
	return out, rows.Err()
}

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

// tagSlug 生成标签的唯一键。仅把 ASCII 字母数字规整成 kebab-case；
// 非拉丁标签（如中文）规范化后会变成空串，此时**回退为原名称**——
// 否则纯中文标签会因 slug 为空被静默丢弃（曾因此丢失全部中文标签）。
func tagSlug(name string) string {
	name = strings.TrimSpace(name)
	if s := strings.Trim(slugPattern.ReplaceAllString(strings.ToLower(name), "-"), "-"); s != "" {
		return s
	}
	return name
}

// topicRow 是主题列表/详情的统一扫描结果。tags 由独立查询补齐。
type topicRow struct {
	ID           string         `json:"id"`
	BoardCode    string         `json:"board_code"`
	AuthorID     string         `json:"user_id"`
	AuthorName   string         `json:"author_name"`
	Title        string         `json:"title"`
	Body         string         `json:"content"`
	Language     string         `json:"language"`
	EntityID     sql.NullString `json:"-"`
	IsPinned     bool           `json:"is_pinned"`
	IsLocked     bool           `json:"is_locked"`
	ViewCount    int            `json:"view_count"`
	ReplyCount   int            `json:"reply_count"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	LastActivity time.Time      `json:"last_activity_at"`
}

func (t topicRow) toMap() map[string]any {
	out := map[string]any{
		"id": t.ID, "board_code": t.BoardCode, "user_id": t.AuthorID,
		"author_name": t.AuthorName, "title": t.Title, "content": t.Body,
		"language": t.Language, "is_pinned": t.IsPinned, "is_locked": t.IsLocked,
		"view_count": t.ViewCount, "reply_count": t.ReplyCount,
		"created_at": t.CreatedAt, "updated_at": t.UpdatedAt,
		"last_activity_at": t.LastActivity,
		"user":            map[string]any{"id": t.AuthorID, "username": t.AuthorName},
	}
	if t.EntityID.Valid {
		out["entity_id"] = t.EntityID.String
		out["work_id"] = t.EntityID.String
	}
	return out
}

const topicCols = `t.id::text,t.board_code,t.author_id::text,COALESCE(NULLIF(t.author_name,''),'Anonymous'),t.title,t.body,t.language,t.entity_id::text,t.is_pinned,t.is_locked,t.view_count,t.reply_count,t.created_at,t.updated_at,t.last_activity_at`

func scanTopic(rows *sql.Rows) (topicRow, error) {
	var t topicRow
	err := rows.Scan(&t.ID, &t.BoardCode, &t.AuthorID, &t.AuthorName, &t.Title, &t.Body, &t.Language,
		&t.EntityID, &t.IsPinned, &t.IsLocked, &t.ViewCount, &t.ReplyCount, &t.CreatedAt, &t.UpdatedAt, &t.LastActivity)
	return t, err
}

// topicTags 批量取主题标签，避免逐条查询。
func (m *Manager) topicTags(ctx context.Context, ids []string) (map[string][]string, error) {
	out := map[string][]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := m.db.QueryContext(ctx, `
		SELECT tt.topic_id::text, g.name
		FROM modules.forum_topic_tags tt JOIN modules.forum_tags g ON g.id = tt.tag_id
		WHERE tt.topic_id = ANY($1::uuid[])
		ORDER BY g.name`, pq.Array(ids))
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var tid, name string
		if err = rows.Scan(&tid, &name); err != nil {
			return out, err
		}
		out[tid] = append(out[tid], name)
	}
	return out, rows.Err()
}

func (m *Manager) registerForum(api *gin.RouterGroup) {
	// 板块列表：前端 fetchBoards 期望裸数组。
	api.GET("/community/boards", m.guard("community", false), func(c *gin.Context) {
		boards, err := m.listBoards(c.Request.Context())
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.JSON(200, boards)
	})

	api.GET("/community/topics", m.guard("community", false), func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.Query("limit"))
		if limit <= 0 || limit > 100 {
			limit = 30
		}
		offset, _ := strconv.Atoi(c.Query("offset"))
		if offset < 0 {
			offset = 0
		}
		args := []any{}
		where := []string{"1=1"}
		// 评论与主题共用存储但语义不同：默认只列"主题"（排除评论板块），
		// 仅当显式按评论板块筛选时才返回评论。
		if bc := strings.TrimSpace(c.Query("board_code")); bc != "" && bc != "all" {
			args = append(args, bc)
			where = append(where, fmt.Sprintf("t.board_code=$%d", len(args)))
		} else {
			args = append(args, commentBoard)
			where = append(where, fmt.Sprintf("t.board_code<>$%d", len(args)))
		}
		if lang := strings.TrimSpace(c.Query("language")); lang != "" && lang != "all" {
			args = append(args, lang)
			where = append(where, fmt.Sprintf("t.language=$%d", len(args)))
		}
		if q := strings.TrimSpace(c.Query("q")); q != "" {
			args = append(args, "%"+q+"%")
			where = append(where, fmt.Sprintf("(t.title ILIKE $%d OR t.body ILIKE $%d)", len(args), len(args)))
		}
		if raw := strings.TrimSpace(c.Query("entity_id")); raw != "" {
			if _, err := uuid.Parse(raw); err != nil {
				c.JSON(200, gin.H{"items": []any{}, "total": 0})
				return
			}
			args = append(args, raw)
			where = append(where, fmt.Sprintf("t.entity_id=$%d", len(args)))
		}
		// 标签筛选按名称或 id 命中关联表。
		if tagID := strings.TrimSpace(c.Query("tag_id")); tagID != "" {
			args = append(args, tagID)
			where = append(where, fmt.Sprintf("EXISTS (SELECT 1 FROM modules.forum_topic_tags tt WHERE tt.topic_id=t.id AND tt.tag_id=$%d)", len(args)))
		} else if tag := strings.TrimSpace(c.Query("tag")); tag != "" {
			args = append(args, tag)
			where = append(where, fmt.Sprintf("EXISTS (SELECT 1 FROM modules.forum_topic_tags tt JOIN modules.forum_tags g ON g.id=tt.tag_id WHERE tt.topic_id=t.id AND g.name=$%d)", len(args)))
		}
		clause := strings.Join(where, " AND ")

		var total int
		if err := m.db.QueryRowContext(c.Request.Context(), "SELECT count(*) FROM modules.forum_topics t WHERE "+clause, args...).Scan(&total); err != nil {
			failure(c, 500, "module_error")
			return
		}
		pageArgs := append(append([]any{}, args...), limit, offset)
		rows, err := m.db.QueryContext(c.Request.Context(),
			"SELECT "+topicCols+" FROM modules.forum_topics t WHERE "+clause+
				" ORDER BY t.is_pinned DESC, t.last_activity_at DESC LIMIT $"+strconv.Itoa(len(pageArgs)-1)+" OFFSET $"+strconv.Itoa(len(pageArgs)),
			pageArgs...)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		items := []map[string]any{}
		ids := []string{}
		for rows.Next() {
			t, err := scanTopic(rows)
			if err != nil {
				rows.Close()
				failure(c, 500, "module_error")
				return
			}
			ids = append(ids, t.ID)
			items = append(items, t.toMap())
		}
		rows.Close()
		tags, terr := m.topicTags(c.Request.Context(), ids)
		if terr != nil {
			failure(c, 500, "module_error")
			return
		}
		for _, it := range items {
			if tg, ok := tags[it["id"].(string)]; ok {
				it["tags"] = tg
			} else {
				it["tags"] = []string{}
			}
		}
		c.JSON(200, gin.H{"items": items, "total": total})
	})

	// 标签清单：前端期望裸数组。
	api.GET("/community/topic-tags", m.guard("community", false), func(c *gin.Context) {
		args := []any{}
		q := "SELECT g.id,g.name FROM modules.forum_tags g"
		if s := strings.TrimSpace(c.Query("q")); s != "" {
			args = append(args, "%"+s+"%")
			q += " WHERE g.name ILIKE $1"
		}
		q += " ORDER BY g.name LIMIT 200"
		rows, err := m.db.QueryContext(c.Request.Context(), q, args...)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id int64
			var name string
			if err := rows.Scan(&id, &name); err != nil {
				failure(c, 500, "module_error")
				return
			}
			out = append(out, map[string]any{"id": id, "name": name})
		}
		c.JSON(200, out)
	})

	api.GET("/community/topics/:id", m.guard("community", false), func(c *gin.Context) {
		id := c.Param("id")
		if _, err := uuid.Parse(id); err != nil {
			failure(c, 404, "not_found")
			return
		}
		// 浏览量自增与读取合并：一次 UPDATE ... RETURNING 完成。
		// 排除评论板块：评论不是"文章"，不应有主题详情页（应回到其锚定的条目）。
		rows, err := m.db.QueryContext(c.Request.Context(),
			"UPDATE modules.forum_topics t SET view_count=view_count+1 WHERE t.id=$1 AND t.board_code<>$2 RETURNING "+topicCols, id, commentBoard)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		if !rows.Next() {
			rows.Close()
			failure(c, 404, "not_found")
			return
		}
		t, err := scanTopic(rows)
		rows.Close()
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		posts, err := m.topicPosts(c.Request.Context(), id)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		tags, _ := m.topicTags(c.Request.Context(), []string{id})
		out := t.toMap()
		out["posts"] = posts
		out["comments"] = posts
		if tg, ok := tags[id]; ok {
			out["tags"] = tg
		} else {
			out["tags"] = []string{}
		}
		c.JSON(200, out)
	})

	api.POST("/community/topics", m.guard("community", true), func(c *gin.Context) {
		var in struct {
			BoardCode string   `json:"board_code"`
			Title     string   `json:"title"`
			Content   string   `json:"content"`
			Language  string   `json:"language"`
			WorkID    string   `json:"work_id"`
			EntityID  string   `json:"entity_id"`
			TagIDs    []int64  `json:"tag_ids"`
			TagNames  []string `json:"tag_names"`
		}
		if c.ShouldBindJSON(&in) != nil {
			failure(c, 400, "invalid_payload")
			return
		}
		in.Title = strings.TrimSpace(in.Title)
		in.Content = strings.TrimSpace(in.Content)
		if in.Title == "" || len(in.Title) > 300 || in.Content == "" || len(in.Content) > 50000 {
			failure(c, 400, "invalid_payload")
			return
		}
		// 板块必须存在且启用，避免写入悬空引用。
		var ok bool
		if err := m.db.QueryRowContext(c.Request.Context(), "SELECT is_enabled FROM modules.forum_boards WHERE code=$1", in.BoardCode).Scan(&ok); err != nil || !ok {
			failure(c, 400, "invalid_board")
			return
		}
		// 关联实体必须可见，否则视为非法引用。
		entityID := strings.TrimSpace(in.EntityID)
		if entityID == "" {
			entityID = strings.TrimSpace(in.WorkID)
		}
		if entityID != "" {
			if _, err := uuid.Parse(entityID); err != nil {
				failure(c, 400, "invalid_reference")
				return
			}
			if !m.entity(c, entityID) {
				return
			}
		}
		p := m.principal(c)
		tid := uuid.NewString()
		tx, err := m.db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		defer tx.Rollback()
		var entity any
		if entityID != "" {
			entity = entityID
		}
		if _, err = tx.ExecContext(c.Request.Context(), `
			INSERT INTO modules.forum_topics(id,board_code,author_id,author_name,title,body,language,entity_id)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
			tid, in.BoardCode, p.ID, authorName(p), in.Title, in.Content, in.Language, entity); err != nil {
			failure(c, 500, "module_error")
			return
		}
		for _, name := range in.TagNames {
			if err = m.attachTagByName(c.Request.Context(), tx, tid, name); err != nil {
				failure(c, 500, "module_error")
				return
			}
		}
		for _, tagID := range in.TagIDs {
			if _, err = tx.ExecContext(c.Request.Context(), `INSERT INTO modules.forum_topic_tags(topic_id,tag_id) SELECT $1,id FROM modules.forum_tags WHERE id=$2 ON CONFLICT DO NOTHING`, tid, tagID); err != nil {
				failure(c, 500, "module_error")
				return
			}
		}
		if err = tx.Commit(); err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.JSON(200, gin.H{
			"id": tid, "board_code": in.BoardCode, "title": in.Title, "content": in.Content,
			"user_id": p.ID, "author_name": authorName(p), "view_count": 0, "reply_count": 0,
			"is_pinned": false, "is_locked": false,
		})
	})

	api.POST("/community/topics/:id/posts", m.guard("community", true), func(c *gin.Context) {
		topicID := c.Param("id")
		if _, err := uuid.Parse(topicID); err != nil {
			failure(c, 404, "not_found")
			return
		}
		var in struct {
			Content            string `json:"content"`
			Body               string `json:"body"`
			ReplyToPostNumber  *int   `json:"reply_to_post_number"`
			ReplyToPostID      string `json:"reply_to_post_id"`
		}
		if c.ShouldBindJSON(&in) != nil {
			failure(c, 400, "invalid_payload")
			return
		}
		content := strings.TrimSpace(in.Content)
		if content == "" {
			content = strings.TrimSpace(in.Body)
		}
		if content == "" || len(content) > 50000 {
			failure(c, 400, "invalid_payload")
			return
		}
		var locked bool
		if err := m.db.QueryRowContext(c.Request.Context(), "SELECT is_locked FROM modules.forum_topics WHERE id=$1", topicID).Scan(&locked); err == sql.ErrNoRows {
			failure(c, 404, "not_found")
			return
		} else if err != nil {
			failure(c, 500, "module_error")
			return
		}
		if locked {
			failure(c, 403, "topic_locked")
			return
		}
		p := m.principal(c)
		pid := uuid.NewString()
		tx, err := m.db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		defer tx.Rollback()
		// post_number 在主题内单调递增。必须锁"主题行"而不是聚合查询：
		// PostgreSQL 不允许 FOR UPDATE 与 MAX() 等聚合函数同时出现。
		// 先锁住该主题即可把同一主题的回帖串行化，再取当前最大楼号。
		var lockedNow bool
		if err = tx.QueryRowContext(c.Request.Context(),
			"SELECT is_locked FROM modules.forum_topics WHERE id=$1 FOR UPDATE", topicID).Scan(&lockedNow); err == sql.ErrNoRows {
			// 主题在预检与开启事务之间被删除。
			failure(c, 404, "not_found")
			return
		} else if err != nil {
			failure(c, 500, "module_error")
			return
		}
		if lockedNow {
			failure(c, 403, "topic_locked")
			return
		}
		var next int
		if err = tx.QueryRowContext(c.Request.Context(),
			"SELECT COALESCE(MAX(post_number),1)+1 FROM modules.forum_posts WHERE topic_id=$1", topicID).Scan(&next); err != nil {
			failure(c, 500, "module_error")
			return
		}
		replyTo := in.ReplyToPostNumber
		if replyTo == nil && in.ReplyToPostID != "" {
			var n int
			if err = tx.QueryRowContext(c.Request.Context(), "SELECT post_number FROM modules.forum_posts WHERE id=$1 AND topic_id=$2", in.ReplyToPostID, topicID).Scan(&n); err == nil {
				replyTo = &n
			}
		}
		if _, err = tx.ExecContext(c.Request.Context(), `
			INSERT INTO modules.forum_posts(id,topic_id,author_id,author_name,body,post_number,reply_to_post_number)
			VALUES($1,$2,$3,$4,$5,$6,$7)`, pid, topicID, p.ID, authorName(p), content, next, replyTo); err != nil {
			failure(c, 500, "module_error")
			return
		}
		if _, err = tx.ExecContext(c.Request.Context(),
			"UPDATE modules.forum_topics SET reply_count=reply_count+1, last_activity_at=now(), updated_at=now() WHERE id=$1", topicID); err != nil {
			failure(c, 500, "module_error")
			return
		}
		if err = tx.Commit(); err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.JSON(200, gin.H{
			"id": pid, "topic_id": topicID, "user_id": p.ID, "author_name": authorName(p),
			"content": content, "post_number": next, "reply_to_post_number": replyTo,
		})
	})

	// 主题删除：作者本人或管理员。
	api.DELETE("/community/topics/:id", m.guard("community", true), func(c *gin.Context) {
		p := m.principal(c)
		q := "DELETE FROM modules.forum_topics WHERE id=$1 AND author_id=$2"
		args := []any{c.Param("id"), p.ID}
		if p.Role == "admin" {
			q = "DELETE FROM modules.forum_topics WHERE id=$1"
			args = args[:1]
		}
		res, err := m.db.ExecContext(c.Request.Context(), q, args...)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			failure(c, 404, "not_found")
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})

	// 回复删除：作者本人或管理员。
	api.DELETE("/community/topics/:id/posts/:postId", m.guard("community", true), func(c *gin.Context) {
		p := m.principal(c)
		topicID, postID := c.Param("id"), c.Param("postId")
		q := "DELETE FROM modules.forum_posts WHERE id=$1 AND topic_id=$2 AND author_id=$3"
		args := []any{postID, topicID, p.ID}
		if p.Role == "admin" {
			q = "DELETE FROM modules.forum_posts WHERE id=$1 AND topic_id=$2"
			args = args[:2]
		}
		res, err := m.db.ExecContext(c.Request.Context(), q, args...)
		if err != nil {
			failure(c, 500, "module_error")
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			failure(c, 404, "not_found")
			return
		}
		if _, err := m.db.ExecContext(c.Request.Context(),
			"UPDATE modules.forum_topics SET reply_count=GREATEST(reply_count-1,0) WHERE id=$1", topicID); err != nil {
			failure(c, 500, "module_error")
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
}

func authorName(p *moduleapi.Principal) string {
	if p == nil || p.Username == "" {
		return "User"
	}
	return p.Username
}

func (m *Manager) topicPosts(ctx context.Context, topicID string) ([]map[string]any, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id::text, topic_id::text, author_id::text, COALESCE(NULLIF(author_name,''),'Anonymous'),
		       body, post_number, reply_to_post_number, created_at
		FROM modules.forum_posts WHERE topic_id=$1 ORDER BY post_number`, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, tid, uid, uname, body string
		var num int
		var replyTo sql.NullInt64
		var at time.Time
		if err := rows.Scan(&id, &tid, &uid, &uname, &body, &num, &replyTo, &at); err != nil {
			return nil, err
		}
		item := map[string]any{
			"id": id, "topic_id": tid, "user_id": uid, "author_name": uname,
			"content": body, "post_number": num, "created_at": at,
			"user": map[string]any{"id": uid, "username": uname},
		}
		if replyTo.Valid {
			item["reply_to_post_number"] = replyTo.Int64
		} else {
			item["reply_to_post_number"] = nil
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// attachTagByName 按名称取或建标签并关联；名称为空则跳过。
func (m *Manager) attachTagByName(ctx context.Context, tx *sql.Tx, topicID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	if len(name) > 60 {
		name = name[:60]
	}
	slug := tagSlug(name)
	if slug == "" {
		return nil
	}
	var id int64
	err := tx.QueryRowContext(ctx, `INSERT INTO modules.forum_tags(name,slug) VALUES($1,$2) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`, name, slug).Scan(&id)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO modules.forum_topic_tags(topic_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, topicID, id)
	return err
}
