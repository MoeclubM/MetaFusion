package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// Shelf 是首页货架与探索页共用的聚合规则。
// 前后端共用同一规则：query 描述“收录什么”（types 按动态类型、fields 按
// 字段取值、vocab_terms 按词表项、relations 按关系存在性），sort/icon/
// enabled 描述“如何展示”。names 走四语 map，legacy name_zh/name_en 仅作回退。
type Shelf struct {
	ID      int64             `json:"id"`
	Slug    string            `json:"slug"`
	Names   map[string]string `json:"names"`
	NameZh  string            `json:"name_zh"`
	NameEn  string            `json:"name_en"`
	Query   ShelfQuery        `json:"query"`
	Sort    string            `json:"sort"`
	Icon    string            `json:"icon"`
	Enabled bool              `json:"enabled"`
	SortOrder int             `json:"sort_order"`
}

// ShelfQuery 描述货架收录规则。各子条件之间为 AND；同一数组内为 OR。
// 空 query 表示收录全部已发布作品。
type ShelfQuery struct {
	Types      []string            `json:"types,omitempty"`
	Fields     map[string][]string `json:"fields,omitempty"`
	VocabTerms map[string][]string `json:"vocab_terms,omitempty"`
	Relations  []string            `json:"relations,omitempty"`
}

var shelfSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,63}$`)

func scanShelf(row func(...any) error) (Shelf, error) {
	var s Shelf
	var names []byte
	var query []byte
	err := row(&s.ID, &s.Slug, &names, &s.NameZh, &s.NameEn, &query, &s.Sort, &s.Icon, &s.Enabled, &s.SortOrder)
	if err != nil {
		return s, err
	}
	s.Names = map[string]string{}
	if len(names) > 0 {
		_ = json.Unmarshal(names, &s.Names)
	}
	s.Query = ShelfQuery{}
	if len(query) > 0 {
		_ = json.Unmarshal(query, &s.Query)
	}
	if s.Query.Fields == nil {
		s.Query.Fields = map[string][]string{}
	}
	if s.Query.VocabTerms == nil {
		s.Query.VocabTerms = map[string][]string{}
	}
	return s, nil
}

func validateShelf(s Shelf) error {
	if !shelfSlugPattern.MatchString(s.Slug) {
		return fmt.Errorf("invalid_slug")
	}
	if strings.TrimSpace(s.Names["zh-CN"]) == "" || strings.TrimSpace(s.Names["en-US"]) == "" {
		return fmt.Errorf("bilingual_names_required")
	}
	switch s.Sort {
	case "", "updated", "created", "title":
	default:
		return fmt.Errorf("invalid_sort")
	}
	return nil
}

const shelfColumns = `id,slug,names,name_zh,name_en,query,sort,icon,is_enabled,sort_order`

// ListShelves 返回货架规则（按 sort_order 排序）。
// enabledOnly 为 true 时只返回启用项，供首页/探索等公开入口使用。
func (s *Store) ListShelves(ctx context.Context, enabledOnly bool) ([]Shelf, error) {
	q := `SELECT ` + shelfColumns + ` FROM catalog.shelves`
	if enabledOnly {
		q += ` WHERE is_enabled`
	}
	q += ` ORDER BY sort_order,id`
	rows, err := s.DB.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Shelf{}
	for rows.Next() {
		item, err := scanShelf(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// GetShelf 按 id 读取单个货架规则（含停用项，供后台编辑）。
func (s *Store) GetShelf(ctx context.Context, id int64) (Shelf, error) {
	row := s.DB.QueryRowContext(ctx, `SELECT `+shelfColumns+` FROM catalog.shelves WHERE id=$1`, id)
	return scanShelf(row.Scan)
}

func (s *Store) CreateShelf(ctx context.Context, in Shelf) (Shelf, error) {
	in.Slug = strings.TrimSpace(in.Slug)
	if in.Names == nil {
		in.Names = map[string]string{}
	}
	if in.Query.Fields == nil {
		in.Query.Fields = map[string][]string{}
	}
	if in.Query.VocabTerms == nil {
		in.Query.VocabTerms = map[string][]string{}
	}
	if in.Sort == "" {
		in.Sort = "updated"
	}
	if err := validateShelf(in); err != nil {
		return Shelf{}, err
	}
	names, _ := json.Marshal(in.Names)
	query, _ := json.Marshal(in.Query)
	var created Shelf
	err := s.write(ctx, func(tx *sql.Tx) error {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.shelves WHERE slug=$1)`, in.Slug).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("constraint_violation")
		}
		row := tx.QueryRowContext(ctx, `INSERT INTO catalog.shelves(slug,names,name_zh,name_en,query,sort,icon,is_enabled,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+shelfColumns,
			in.Slug, string(names), in.Names["zh-CN"], in.Names["en-US"], string(query), in.Sort, in.Icon, in.Enabled, in.SortOrder)
		e, err := scanShelf(row.Scan)
		if err != nil {
			return err
		}
		created = e
		return nil
	})
	return created, err
}

// UpdateShelf 更新货架规则；slug 不可改（作为前端路由与外链的稳定标识）。
func (s *Store) UpdateShelf(ctx context.Context, id int64, in Shelf) (Shelf, error) {
	if in.Names == nil {
		in.Names = map[string]string{}
	}
	if in.Query.Fields == nil {
		in.Query.Fields = map[string][]string{}
	}
	if in.Query.VocabTerms == nil {
		in.Query.VocabTerms = map[string][]string{}
	}
	if in.Sort == "" {
		in.Sort = "updated"
	}
	// slug 取库内值参与校验，保证不可改。
	var slug string
	if err := s.DB.QueryRowContext(ctx, `SELECT slug FROM catalog.shelves WHERE id=$1`, id).Scan(&slug); err != nil {
		return Shelf{}, err
	}
	in.Slug = slug
	if err := validateShelf(in); err != nil {
		return Shelf{}, err
	}
	names, _ := json.Marshal(in.Names)
	query, _ := json.Marshal(in.Query)
	var updated Shelf
	err := s.write(ctx, func(tx *sql.Tx) error {
		row := tx.QueryRowContext(ctx, `UPDATE catalog.shelves SET names=$2,name_zh=$3,name_en=$4,query=$5,sort=$6,icon=$7,is_enabled=$8,sort_order=$9 WHERE id=$1 RETURNING `+shelfColumns,
			id, string(names), in.Names["zh-CN"], in.Names["en-US"], string(query), in.Sort, in.Icon, in.Enabled, in.SortOrder)
		e, err := scanShelf(row.Scan)
		if err != nil {
			return err
		}
		updated = e
		return nil
	})
	return updated, err
}

// DeleteShelf 删除货架规则。货架只是聚合视图，不承载实体数据，可直接删除。
func (s *Store) DeleteShelf(ctx context.Context, id int64) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM catalog.shelves WHERE id=$1`, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sql.ErrNoRows
		}
		return nil
	})
}

// seedShelves 写入首页货架默认规则；已存在的 slug 不覆盖（保留后台自定义），
// 新增的 slug 自动补齐。前后端共用同一规则，不再各自硬编码。
func seedShelves(ctx context.Context, tx *sql.Tx) error {
	defs := []Shelf{
		{Slug: "music", Names: map[string]string{"zh-CN": "音乐", "zh-TW": "音樂", "ja": "音楽", "ja-JP": "音楽", "en-US": "Music"}, Query: ShelfQuery{Types: []string{"music", "song", "album"}}, Sort: "updated", Icon: "Disc", Enabled: true, SortOrder: 10},
		{Slug: "anime", Names: map[string]string{"zh-CN": "动画", "zh-TW": "動畫", "ja": "アニメ", "ja-JP": "アニメ", "en-US": "Anime"}, Query: ShelfQuery{Types: []string{"animation"}}, Sort: "updated", Icon: "Tv", Enabled: true, SortOrder: 20},
		{Slug: "films", Names: map[string]string{"zh-CN": "电影", "zh-TW": "電影", "ja": "映画", "ja-JP": "映画", "en-US": "Films"}, Query: ShelfQuery{Types: []string{"film"}}, Sort: "updated", Icon: "Film", Enabled: true, SortOrder: 30},
		{Slug: "novels", Names: map[string]string{"zh-CN": "小说", "zh-TW": "小說", "ja": "小説", "ja-JP": "小説", "en-US": "Novels"}, Query: ShelfQuery{Types: []string{"novel"}}, Sort: "updated", Icon: "BookOpen", Enabled: true, SortOrder: 40},
		{Slug: "games", Names: map[string]string{"zh-CN": "游戏", "zh-TW": "遊戲", "ja": "ゲーム", "ja-JP": "ゲーム", "en-US": "Games"}, Query: ShelfQuery{Types: []string{"game", "indie_game", "visual_novel"}}, Sort: "updated", Icon: "Gamepad2", Enabled: true, SortOrder: 50},
		{Slug: "creations", Names: map[string]string{"zh-CN": "个人创作", "zh-TW": "個人創作", "ja": "個人創作", "ja-JP": "個人創作", "en-US": "Creations"}, Query: ShelfQuery{Types: []string{"personal", "photobook"}}, Sort: "updated", Icon: "Camera", Enabled: true, SortOrder: 60},
	}
	for _, d := range defs {
		names, _ := json.Marshal(d.Names)
		query, _ := json.Marshal(d.Query)
		if _, err := tx.ExecContext(ctx, `INSERT INTO catalog.shelves(slug,names,name_zh,name_en,query,sort,icon,is_enabled,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (slug) DO NOTHING`,
			d.Slug, string(names), d.Names["zh-CN"], d.Names["en-US"], string(query), d.Sort, d.Icon, d.Enabled, d.SortOrder); err != nil {
			return err
		}
	}
	return nil
}
