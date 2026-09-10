package catalog

// 用户收藏：详情页收藏按钮与"我的收藏 / 用户收藏"列表。
// 前端 target_type 为既有词表（work/release/artist/franchise/canonical_entry），
// 落库/读取时映射到新轨实体 kind，并沿用实体可见性规则，避免收藏到不可见条目。

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
)

// favoriteTargetKinds 收藏目标类型 → 允许的新轨实体 kind。
// canonical_entry 在新轨可能落在 expression 或 content_unit，两者都接受。
var favoriteTargetKinds = map[string][]string{
	"work":            {"work"},
	"release":         {"release"},
	"artist":          {"agent"},
	"franchise":       {"collection"},
	"canonical_entry": {"expression", "content_unit"},
}

// Favorite 是一条收藏记录，附带已解析的目标实体摘要（供列表展示）。
type Favorite struct {
	ID         string    `json:"id"`
	TargetType string    `json:"target_type"`
	TargetID   string    `json:"target_id"`
	CreatedAt  time.Time `json:"created_at"`

	Work           *Entity `json:"work,omitempty"`
	Release        *Entity `json:"release,omitempty"`
	Artist         *Entity `json:"artist,omitempty"`
	Franchise      *Entity `json:"franchise,omitempty"`
	CanonicalEntry *Entity `json:"canonical_entry,omitempty"`
}

// resolveFavoriteTarget 校验 target_type 合法、目标实体存在且对 u 可见。
func (s *Store) resolveFavoriteTarget(ctx context.Context, targetType, targetID string, u *User) error {
	kinds, ok := favoriteTargetKinds[targetType]
	if !ok {
		return fmt.Errorf("invalid_target_type")
	}
	e, err := s.Get(ctx, targetID, u)
	if err != nil {
		return err
	}
	if !contains(kinds, e.Kind) {
		return fmt.Errorf("invalid_target_type")
	}
	return nil
}

// ToggleFavorite 切换收藏状态，返回切换后是否已收藏。
func (s *Store) ToggleFavorite(ctx context.Context, u User, targetType, targetID string) (bool, error) {
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	if err := s.resolveFavoriteTarget(ctx, targetType, targetID, &u); err != nil {
		return false, err
	}
	var favorited bool
	err := s.write(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "DELETE FROM catalog.favorites WHERE user_id=$1 AND target_type=$2 AND target_id=$3", u.ID, targetType, targetID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			favorited = false
			return nil
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO catalog.favorites(user_id,target_type,target_id) VALUES($1,$2,$3)", u.ID, targetType, targetID); err != nil {
			return err
		}
		favorited = true
		return nil
	})
	return favorited, err
}

// FavoriteStatus 返回 u 对给定 ID 集合中已收藏的部分（按 target_type 限定）。
func (s *Store) FavoriteStatus(ctx context.Context, u User, targetType string, targetIDs []string) ([]string, error) {
	if _, ok := favoriteTargetKinds[strings.TrimSpace(targetType)]; !ok {
		return nil, fmt.Errorf("invalid_target_type")
	}
	if len(targetIDs) == 0 {
		return []string{}, nil
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT target_id::text FROM catalog.favorites
		WHERE user_id=$1 AND target_type=$2 AND target_id = ANY($3::uuid[])`, u.ID, targetType, pq.Array(targetIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListFavorites 返回某用户的收藏，按收藏时间倒序；u 为请求方（用于实体可见性）。
// 目标实体已删除或不可见时跳过该条，不清空记录。
func (s *Store) ListFavorites(ctx context.Context, ownerID string, viewer *User, targetType string, limit, offset int) ([]Favorite, int, error) {
	if targetType != "" {
		if _, ok := favoriteTargetKinds[targetType]; !ok {
			return nil, 0, fmt.Errorf("invalid_target_type")
		}
	}
	args := []any{ownerID}
	where := "user_id=$1"
	if targetType != "" {
		args = append(args, targetType)
		where += fmt.Sprintf(" AND target_type=$%d", len(args))
	}
	var total int
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog.favorites WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	args = append(args, limit, offset)
	// 表主键是 (user_id,target_type,target_id)，没有独立 id 列；
	// 前端需要稳定 id，用三元组拼一个合成 ID。
	rows, err := s.DB.QueryContext(ctx, fmt.Sprintf(`SELECT target_type || ':' || target_id::text, target_type, target_id::text, created_at
		FROM catalog.favorites WHERE %s ORDER BY created_at DESC, target_id LIMIT $%d OFFSET $%d`, where, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []Favorite{}
	for rows.Next() {
		var f Favorite
		if err = rows.Scan(&f.ID, &f.TargetType, &f.TargetID, &f.CreatedAt); err != nil {
			return nil, 0, err
		}
		e, gerr := s.Get(ctx, f.TargetID, viewer)
		if gerr != nil {
			continue // 目标不可见/已删除：跳过，不泄露存在性
		}
		switch f.TargetType {
		case "work":
			f.Work = &e
		case "release":
			f.Release = &e
		case "artist":
			f.Artist = &e
		case "franchise":
			f.Franchise = &e
		case "canonical_entry":
			f.CanonicalEntry = &e
		}
		items = append(items, f)
	}
	return items, total, rows.Err()
}
