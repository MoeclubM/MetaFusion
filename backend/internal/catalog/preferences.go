package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// HomePreferences 是用户对首页推荐分区的自定义：展示顺序 + 隐藏项。
// 分区内容本身由 catalog.shelves 规则驱动，这里只记录"给谁看、按什么顺序"，
// 因此管理台调整规则时用户偏好无需迁移。
type HomePreferences struct {
	// Order 是用户排定的分区 slug 顺序；未列出的分区排在最后（保持默认序）。
	Order []string `json:"order"`
	// Hidden 是用户选择不展示的分区 slug。
	Hidden []string `json:"hidden"`
}

func (s *Store) GetHomePreferences(ctx context.Context, userID string) (HomePreferences, error) {
	out := HomePreferences{Order: []string{}, Hidden: []string{}}
	if userID == "" {
		return out, nil
	}
	var b []byte
	err := s.DB.QueryRowContext(ctx, `SELECT home_shelves FROM catalog.user_preferences WHERE user_id=$1`, userID).Scan(&b)
	if err == sql.ErrNoRows {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if len(b) == 0 {
		return out, nil
	}
	if err = json.Unmarshal(b, &out); err != nil {
		return HomePreferences{Order: []string{}, Hidden: []string{}}, nil
	}
	if out.Order == nil {
		out.Order = []string{}
	}
	if out.Hidden == nil {
		out.Hidden = []string{}
	}
	return out, nil
}

func (s *Store) SaveHomePreferences(ctx context.Context, userID string, in HomePreferences) (HomePreferences, error) {
	// 归一化：去空、去重，保持首次出现的顺序；隐藏项与顺序项都按 slug 白名单校验。
	order := dedupeSlugs(in.Order)
	hidden := dedupeSlugs(in.Hidden)
	known, err := s.ListShelves(ctx, false)
	if err != nil {
		return HomePreferences{}, err
	}
	valid := map[string]bool{}
	for _, sh := range known {
		valid[sh.Slug] = true
	}
	for _, v := range append(append([]string{}, order...), hidden...) {
		if !valid[v] {
			return HomePreferences{}, fmt.Errorf("unknown_shelf")
		}
	}
	out := HomePreferences{Order: order, Hidden: hidden}
	b, _ := json.Marshal(out)
	err = s.write(ctx, func(tx *sql.Tx) error {
		_, e := tx.ExecContext(ctx, `
			INSERT INTO catalog.user_preferences(user_id,home_shelves,updated_at)
			VALUES($1,$2,now())
			ON CONFLICT(user_id) DO UPDATE SET home_shelves=EXCLUDED.home_shelves, updated_at=now()`,
			userID, string(b))
		return e
	})
	return out, err
}

func dedupeSlugs(in []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, v := range in {
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

// applyHomePreferences 按用户偏好重排并过滤货架：Hidden 里的移除，Order 里列出
// 的按用户顺序置前，其余保持原有 sort_order 次序追加在后。未知 slug 直接忽略，
// 使管理台删除分区后旧偏好不会导致首页缺内容。
func applyHomePreferences(shelves []Shelf, p HomePreferences) []Shelf {
	if len(shelves) == 0 {
		return shelves
	}
	hidden := map[string]bool{}
	for _, s := range p.Hidden {
		hidden[s] = true
	}
	bySlug := map[string]Shelf{}
	for _, sh := range shelves {
		bySlug[sh.Slug] = sh
	}
	rank := map[string]int{}
	for i, s := range p.Order {
		rank[s] = i
	}
	out := make([]Shelf, 0, len(shelves))
	seen := map[string]bool{}
	// 先按用户顺序收录已具名的分区。
	for _, s := range p.Order {
		if hidden[s] || seen[s] {
			continue
		}
		if sh, ok := bySlug[s]; ok {
			out = append(out, sh)
			seen[s] = true
		}
	}
	// 其余分区按默认序追加；显式排过序的已处理过。
	for _, sh := range shelves {
		if hidden[sh.Slug] || seen[sh.Slug] {
			continue
		}
		out = append(out, sh)
		seen[sh.Slug] = true
	}
	return out
}
