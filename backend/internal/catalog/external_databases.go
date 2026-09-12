package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// ExternalDatabase 是后台可配的外部来源预设。
// 官方网站、Bushiroad、Bangumi 与 MusicBrainz 等在此同级定义：
// 前端统一渲染为同一组外链，后台可增删改，前端不 hardcode。
type ExternalDatabase struct {
	Code            string            `json:"code"`
	Names           map[string]string `json:"names"`
	Category        string            `json:"category"`
	URLPattern      string            `json:"url_pattern"`
	Icon            string            `json:"icon"`
	IconURL         string            `json:"icon_url"`
	ValidationRegex string            `json:"validation_regex"`
	Description     string            `json:"description"`
	SortOrder       int               `json:"sort_order"`
	IsEnabled       bool              `json:"is_enabled"`
	IsSystem        bool              `json:"is_system"`
}

// externalDatabaseCategories 允许的适用 kind：all 表示所有实体，其余为固定八实体 kind。
var externalDatabaseCategories = map[string]bool{
	"all": true, "agent": true, "collection": true, "work": true, "content_unit": true,
	"expression": true, "release": true, "medium": true, "track": true,
}

// LocalizedName 按请求语言解析多语言名称。
func (e ExternalDatabase) LocalizedName(locale string) string {
	loc := strings.TrimSpace(locale)
	if loc == "" {
		loc = "zh-CN"
	}
	if e.Names != nil {
		if v, ok := e.Names[loc]; ok && strings.TrimSpace(v) != "" {
			return v
		}
		if len(loc) >= 2 {
			prefix := loc[:2]
			for k, v := range e.Names {
				if strings.HasPrefix(k, prefix) && strings.TrimSpace(v) != "" {
					return v
				}
			}
		}
		if v, ok := e.Names["zh-CN"]; ok && strings.TrimSpace(v) != "" {
			return v
		}
		if v, ok := e.Names["en-US"]; ok && strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// BuildURL 把外部 ID 或完整 URL 拼成可跳转的目标地址。
// 本身已是 http(s) 的值直接透传，因此 official_website 这类存完整 URL 的来源也能同级接入。
func (e ExternalDatabase) BuildURL(idOrURL string) string {
	idOrURL = strings.TrimSpace(idOrURL)
	if idOrURL == "" {
		return ""
	}
	if strings.HasPrefix(idOrURL, "http://") || strings.HasPrefix(idOrURL, "https://") {
		return idOrURL
	}
	if e.URLPattern == "" {
		return ""
	}
	if strings.Contains(e.URLPattern, "{id}") {
		return strings.ReplaceAll(e.URLPattern, "{id}", idOrURL)
	}
	return e.URLPattern + idOrURL
}

var externalDatabaseCodePattern = regexp.MustCompile(`^[a-z0-9_]{2,64}$`)

func scanExternalDatabase(row func(...any) error) (ExternalDatabase, error) {
	var e ExternalDatabase
	var names []byte
	err := row(&e.Code, &names, &e.Category, &e.URLPattern,
		&e.Icon, &e.IconURL, &e.ValidationRegex, &e.Description, &e.SortOrder, &e.IsEnabled, &e.IsSystem)
	if err != nil {
		return e, err
	}
	e.Names = map[string]string{}
	if len(names) > 0 {
		_ = json.Unmarshal(names, &e.Names)
	}
	return e, nil
}

func validateExternalDatabase(e ExternalDatabase) error {
	if !externalDatabaseCodePattern.MatchString(e.Code) {
		return fmt.Errorf("invalid_code")
	}
	if strings.TrimSpace(e.Names["zh-CN"]) == "" {
		return fmt.Errorf("invalid_name")
	}
	if !externalDatabaseCategories[e.Category] {
		return fmt.Errorf("invalid_category")
	}
	if strings.TrimSpace(e.URLPattern) == "" {
		return fmt.Errorf("invalid_url_pattern")
	}
	if e.ValidationRegex != "" {
		if _, err := regexp.Compile(e.ValidationRegex); err != nil {
			return fmt.Errorf("invalid_validation_regex")
		}
	}
	return nil
}

// ListExternalDatabases 返回外部来源预设（按 sort_order 排序）。
// 公开接口只返回启用项；category 非空时同时返回该分类与 all。
func (s *Store) ListExternalDatabases(ctx context.Context, category string, enabledOnly bool) ([]ExternalDatabase, error) {
	q := `SELECT code,names,category,url_pattern,icon,icon_url,validation_regex,description,sort_order,is_enabled,is_system FROM catalog.external_databases`
	var args []any
	var conds []string
	if enabledOnly {
		conds = append(conds, `is_enabled`)
	}
	if strings.TrimSpace(category) != "" {
		conds = append(conds, `(category='all' OR category=$1)`)
		args = append(args, strings.TrimSpace(category))
	}
	if len(conds) > 0 {
		q += ` WHERE ` + strings.Join(conds, ` AND `)
	}
	q += ` ORDER BY sort_order,code`
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExternalDatabase{}
	for rows.Next() {
		e, err := scanExternalDatabase(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetExternalDatabase 按 code 读取单个预设（含停用项，供后台编辑）。
func (s *Store) GetExternalDatabase(ctx context.Context, code string) (ExternalDatabase, error) {
	row := s.DB.QueryRowContext(ctx, `SELECT code,names,category,url_pattern,icon,icon_url,validation_regex,description,sort_order,is_enabled,is_system FROM catalog.external_databases WHERE code=$1`, code)
	return scanExternalDatabase(row.Scan)
}

func (s *Store) CreateExternalDatabase(ctx context.Context, in ExternalDatabase) (ExternalDatabase, error) {
	in.Code = strings.TrimSpace(in.Code)
	if in.Category == "" {
		in.Category = "all"
	}
	if in.Icon == "" {
		in.Icon = "Globe"
	}
	if in.Names == nil {
		in.Names = map[string]string{}
	}
	if err := validateExternalDatabase(in); err != nil {
		return ExternalDatabase{}, err
	}
	names, _ := json.Marshal(in.Names)
	var created ExternalDatabase
	err := s.write(ctx, func(tx *sql.Tx) error {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.external_databases WHERE code=$1)`, in.Code).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("constraint_violation")
		}
		row := tx.QueryRowContext(ctx, `INSERT INTO catalog.external_databases(code,names,category,url_pattern,icon,icon_url,validation_regex,description,sort_order,is_enabled,is_system) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false) RETURNING code,names,category,url_pattern,icon,icon_url,validation_regex,description,sort_order,is_enabled,is_system`,
			in.Code, string(names), in.Category, in.URLPattern, in.Icon, in.IconURL, in.ValidationRegex, in.Description, in.SortOrder)
		e, err := scanExternalDatabase(row.Scan)
		if err != nil {
			return err
		}
		created = e
		return nil
	})
	return created, err
}

// UpdateExternalDatabase 更新预设；系统预设的 code 与 is_system 不可改，停用保留历史展示。
func (s *Store) UpdateExternalDatabase(ctx context.Context, code string, in ExternalDatabase) (ExternalDatabase, error) {
	in.Code = code
	if in.Category == "" {
		in.Category = "all"
	}
	if in.Icon == "" {
		in.Icon = "Globe"
	}
	if in.Names == nil {
		in.Names = map[string]string{}
	}
	if err := validateExternalDatabase(in); err != nil {
		return ExternalDatabase{}, err
	}
	names, _ := json.Marshal(in.Names)
	var updated ExternalDatabase
	err := s.write(ctx, func(tx *sql.Tx) error {
		var isSystem bool
		if err := tx.QueryRowContext(ctx, `SELECT is_system FROM catalog.external_databases WHERE code=$1`, code).Scan(&isSystem); err != nil {
			return err
		}
		row := tx.QueryRowContext(ctx, `UPDATE catalog.external_databases SET names=$2,category=$3,url_pattern=$4,icon=$5,icon_url=$6,validation_regex=$7,description=$8,sort_order=$9,is_enabled=$10 WHERE code=$1 RETURNING code,names,category,url_pattern,icon,icon_url,validation_regex,description,sort_order,is_enabled,is_system`,
			code, string(names), in.Category, in.URLPattern, in.Icon, in.IconURL, in.ValidationRegex, in.Description, in.SortOrder, in.IsEnabled)
		e, err := scanExternalDatabase(row.Scan)
		if err != nil {
			return err
		}
		updated = e
		return nil
	})
	return updated, err
}

// DeleteExternalDatabase 删除预设；系统预设只能停用不能删除，已有数据引用到的也建议停用而非删除。
func (s *Store) DeleteExternalDatabase(ctx context.Context, code string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var isSystem bool
		if err := tx.QueryRowContext(ctx, `SELECT is_system FROM catalog.external_databases WHERE code=$1`, code).Scan(&isSystem); err != nil {
			return err
		}
		if isSystem {
			return fmt.Errorf("system_protected")
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM catalog.external_databases WHERE code=$1`, code)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sql.ErrNoRows
		}
		return nil
	})
}

// seedExternalDatabases 写入系统预设；已存在的 code 不覆盖（保留后台自定义），
// 新增的 code 自动补齐。官网、Bangumi 单集、Bushiroad 与其它权威库同级存放。
func seedExternalDatabases(ctx context.Context, tx *sql.Tx) error {
	defs := []ExternalDatabase{
		{Code: "official_website", Names: map[string]string{"zh-CN": "官方网站", "en-US": "Official Website"}, Category: "all", URLPattern: "{id}", Icon: "Globe", Description: "作品 / 创作者 / 发行官方主页（存完整 URL）", SortOrder: 5, IsEnabled: true, IsSystem: true},
		{Code: "wikipedia", Names: map[string]string{"zh-CN": "维基百科", "en-US": "Wikipedia", "ja": "ウィキペディア"}, Category: "all", URLPattern: "https://zh.wikipedia.org/wiki/{id}", Icon: "Globe", Description: "全球多语言自由百科全书（填词条标题或完整 URL）", SortOrder: 10, IsEnabled: true, IsSystem: true},
		{Code: "wikidata", Names: map[string]string{"zh-CN": "维基数据", "en-US": "Wikidata"}, Category: "all", URLPattern: "https://www.wikidata.org/wiki/{id}", Icon: "Database", ValidationRegex: `^Q\d+$`, Description: "维基媒体结构化知识图谱实体项 (如 Q11303)", SortOrder: 20, IsEnabled: true, IsSystem: true},
		{Code: "musicbrainz", Names: map[string]string{"zh-CN": "MusicBrainz", "en-US": "MusicBrainz"}, Category: "all", URLPattern: "https://musicbrainz.org/release-group/{id}", Icon: "Disc3", ValidationRegex: `^[0-9a-fA-F\-]{36}$`, Description: "开放音乐元数据百科全书 (MBID UUID)", SortOrder: 30, IsEnabled: true, IsSystem: true},
		{Code: "discogs", Names: map[string]string{"zh-CN": "Discogs", "en-US": "Discogs"}, Category: "all", URLPattern: "https://www.discogs.com/master/{id}", Icon: "Disc", ValidationRegex: `^\d+$`, Description: "全球权威黑胶与实体唱片数据库 (Master/Release ID)", SortOrder: 40, IsEnabled: true, IsSystem: true},
		{Code: "vgmdb", Names: map[string]string{"zh-CN": "VGMdb", "en-US": "VGMdb"}, Category: "all", URLPattern: "https://vgmdb.net/album/{id}", Icon: "Music2", ValidationRegex: `^\d+$`, Description: "电子游戏与动漫原声音乐专题数据库", SortOrder: 50, IsEnabled: true, IsSystem: true},
		{Code: "bushiroad_music", Names: map[string]string{"zh-CN": "Bushiroad 官方唱片", "en-US": "Bushiroad Music"}, Category: "all", URLPattern: "https://bushiroad-music.com/musics/{id}/", Icon: "Disc", ValidationRegex: `^[a-z0-9_\-]+$`, Description: "Bushiroad 官方唱片发售页 slug", SortOrder: 55, IsEnabled: true, IsSystem: true},
		{Code: "spotify", Names: map[string]string{"zh-CN": "Spotify", "en-US": "Spotify"}, Category: "all", URLPattern: "https://open.spotify.com/album/{id}", Icon: "PlayCircle", ValidationRegex: `^[0-9A-Za-z]{22}$`, Description: "全球流媒体音乐服务平台 (Album / Artist ID)", SortOrder: 60, IsEnabled: true, IsSystem: true},
		{Code: "apple_music", Names: map[string]string{"zh-CN": "Apple Music", "en-US": "Apple Music"}, Category: "all", URLPattern: "https://music.apple.com/album/{id}", Icon: "Apple", ValidationRegex: `^\d+$`, Description: "苹果音乐数字专辑与创作者页面", SortOrder: 70, IsEnabled: true, IsSystem: true},
		{Code: "imdb", Names: map[string]string{"zh-CN": "IMDb 互联网电影资料库", "en-US": "IMDb"}, Category: "work", URLPattern: "https://www.imdb.com/title/{id}/", Icon: "Film", ValidationRegex: `^tt\d+$`, Description: "全球权威互联网电影资料库 (如 tt0816692 / nm0000001)", SortOrder: 80, IsEnabled: true, IsSystem: true},
		{Code: "tmdb", Names: map[string]string{"zh-CN": "TMDB 影视数据库", "en-US": "The Movie Database"}, Category: "work", URLPattern: "https://www.themoviedb.org/movie/{id}", Icon: "Clapperboard", ValidationRegex: `^\d+$`, Description: "开放社区影视元数据与海报媒体库", SortOrder: 90, IsEnabled: true, IsSystem: true},
		{Code: "douban_movie", Names: map[string]string{"zh-CN": "豆瓣电影", "en-US": "Douban Movie"}, Category: "work", URLPattern: "https://movie.douban.com/subject/{id}/", Icon: "Tv", ValidationRegex: `^\d+$`, Description: "中文影视与文化评论社区 (条目 ID)", SortOrder: 100, IsEnabled: true, IsSystem: true},
		{Code: "bangumi", Names: map[string]string{"zh-CN": "Bangumi 番组计划", "en-US": "Bangumi"}, Category: "all", URLPattern: "https://bgm.tv/subject/{id}", Icon: "Tv2", ValidationRegex: `^\d+$`, Description: "中文 ACG 二次元动画/漫画/游戏/音乐条目索引", SortOrder: 110, IsEnabled: true, IsSystem: true},
		{Code: "vndb", Names: map[string]string{"zh-CN": "VNDB 视觉小说数据库", "en-US": "VNDB"}, Category: "work", URLPattern: "https://vndb.org/v{id}", Icon: "BookHeart", ValidationRegex: `^v?\d+$`, Description: "全球权威视觉小说条目数据库 (如 v17)", SortOrder: 120, IsEnabled: true, IsSystem: true},
		{Code: "steam", Names: map[string]string{"zh-CN": "Steam 游戏商店", "en-US": "Steam"}, Category: "work", URLPattern: "https://store.steampowered.com/app/{id}", Icon: "Gamepad2", ValidationRegex: `^\d+$`, Description: "Valve 旗下一体化数字游戏分发与社群平台 (App ID)", SortOrder: 130, IsEnabled: true, IsSystem: true},
		{Code: "anilist", Names: map[string]string{"zh-CN": "AniList", "en-US": "AniList"}, Category: "all", URLPattern: "https://anilist.co/anime/{id}", Icon: "Sparkles", ValidationRegex: `^\d+$`, Description: "现代动画与漫画社交追踪数据库", SortOrder: 140, IsEnabled: true, IsSystem: true},
		{Code: "goodreads", Names: map[string]string{"zh-CN": "Goodreads", "en-US": "Goodreads"}, Category: "work", URLPattern: "https://www.goodreads.com/book/show/{id}", Icon: "BookOpen", ValidationRegex: `^\d+.*$`, Description: "全球读者书评与阅读记录平台", SortOrder: 150, IsEnabled: true, IsSystem: true},
		{Code: "douban_book", Names: map[string]string{"zh-CN": "豆瓣读书", "en-US": "Douban Book"}, Category: "work", URLPattern: "https://book.douban.com/subject/{id}/", Icon: "Book", ValidationRegex: `^\d+$`, Description: "中文书籍条目与读书笔记社区", SortOrder: 160, IsEnabled: true, IsSystem: true},
		{Code: "isbndb", Names: map[string]string{"zh-CN": "ISBNdb 国际标准书号库", "en-US": "ISBNdb"}, Category: "release", URLPattern: "https://isbndb.com/book/{id}", Icon: "Barcode", ValidationRegex: `^[0-9\-]{10,17}$`, Description: "国际标准书号全球注册库 (ISBN-10 / ISBN-13)", SortOrder: 170, IsEnabled: true, IsSystem: true},
		{Code: "isni", Names: map[string]string{"zh-CN": "ISNI 国际标准名称标识", "en-US": "ISNI"}, Category: "agent", URLPattern: "https://isni.org/isni/{id}", Icon: "UserCheck", ValidationRegex: `^\d{15}[\dX]$`, Description: "ISO 国际标准名称标识符 (16 位数字或 X)", SortOrder: 180, IsEnabled: true, IsSystem: true},
		{Code: "orcid", Names: map[string]string{"zh-CN": "ORCID 学者标识", "en-US": "ORCID"}, Category: "agent", URLPattern: "https://orcid.org/{id}", Icon: "GraduationCap", ValidationRegex: `^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$`, Description: "全球科研人员与学者开放唯一标识符", SortOrder: 190, IsEnabled: true, IsSystem: true},
		{Code: "twitter_x", Names: map[string]string{"zh-CN": "X (原 Twitter)", "en-US": "X (Twitter)"}, Category: "agent", URLPattern: "https://x.com/{id}", Icon: "AtSign", ValidationRegex: `^[A-Za-z0-9_]{1,15}$`, Description: "官方社交媒体账号 ID", SortOrder: 200, IsEnabled: true, IsSystem: true},
		{Code: "bangumi_person", Names: map[string]string{"zh-CN": "Bangumi 人物", "en-US": "Bangumi Person"}, Category: "agent", URLPattern: "https://bgm.tv/person/{id}", Icon: "User", ValidationRegex: `^\d+$`, Description: "Bangumi 创作者与演职员人物条目", SortOrder: 210, IsEnabled: true, IsSystem: true},
		{Code: "bangumi_ep", Names: map[string]string{"zh-CN": "Bangumi 单集", "en-US": "Bangumi Episode"}, Category: "work", URLPattern: "https://bgm.tv/ep/{id}", Icon: "Tv", ValidationRegex: `^\d+$`, Description: "Bangumi 动画单集条目", SortOrder: 215, IsEnabled: true, IsSystem: true},
		{Code: "bangumi_character", Names: map[string]string{"zh-CN": "Bangumi 角色", "en-US": "Bangumi Character"}, Category: "agent", URLPattern: "https://bgm.tv/character/{id}", Icon: "Smile", ValidationRegex: `^\d+$`, Description: "Bangumi 虚拟角色条目", SortOrder: 220, IsEnabled: true, IsSystem: true},
		{Code: "myanimelist", Names: map[string]string{"zh-CN": "MyAnimeList", "en-US": "MyAnimeList"}, Category: "work", URLPattern: "https://myanimelist.net/anime/{id}", Icon: "Tv", ValidationRegex: `^\d+$`, Description: "全球动画与漫画数据库 (MAL ID)", SortOrder: 230, IsEnabled: true, IsSystem: true},
		{Code: "mal_person", Names: map[string]string{"zh-CN": "MyAnimeList 影人", "en-US": "MyAnimeList Person"}, Category: "agent", URLPattern: "https://myanimelist.net/people/{id}", Icon: "User", ValidationRegex: `^\d+$`, Description: "MyAnimeList 创作者/声优档案", SortOrder: 240, IsEnabled: true, IsSystem: true},
		{Code: "mal_character", Names: map[string]string{"zh-CN": "MyAnimeList 角色", "en-US": "MyAnimeList Character"}, Category: "agent", URLPattern: "https://myanimelist.net/character/{id}", Icon: "Smile", ValidationRegex: `^\d+$`, Description: "MyAnimeList 角色档案", SortOrder: 250, IsEnabled: true, IsSystem: true},
		{Code: "tmdb_person", Names: map[string]string{"zh-CN": "TMDB 影人", "en-US": "TMDB Person"}, Category: "agent", URLPattern: "https://www.themoviedb.org/person/{id}", Icon: "User", ValidationRegex: `^\d+$`, Description: "The Movie Database 演职员条目", SortOrder: 260, IsEnabled: true, IsSystem: true},
		{Code: "imdb_person", Names: map[string]string{"zh-CN": "IMDb 影人", "en-US": "IMDb Person"}, Category: "agent", URLPattern: "https://www.imdb.com/name/{id}/", Icon: "User", ValidationRegex: `^nm\d+$`, Description: "IMDb 影人档案 (如 nm0000001)", SortOrder: 270, IsEnabled: true, IsSystem: true},
		{Code: "vndb_character", Names: map[string]string{"zh-CN": "VNDB 角色", "en-US": "VNDB Character"}, Category: "agent", URLPattern: "https://vndb.org/c{id}", Icon: "Smile", ValidationRegex: `^c?\d+$`, Description: "VNDB 视觉小说角色档案", SortOrder: 280, IsEnabled: true, IsSystem: true},
		{Code: "vndb_staff", Names: map[string]string{"zh-CN": "VNDB 职员", "en-US": "VNDB Staff"}, Category: "agent", URLPattern: "https://vndb.org/s{id}", Icon: "User", ValidationRegex: `^s?\d+$`, Description: "VNDB 制作人员档案", SortOrder: 290, IsEnabled: true, IsSystem: true},
	}
	for _, d := range defs {
		names, _ := json.Marshal(d.Names)
		if _, err := tx.ExecContext(ctx, `INSERT INTO catalog.external_databases(code,names,category,url_pattern,icon,icon_url,validation_regex,description,sort_order,is_enabled,is_system) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (code) DO NOTHING`,
			d.Code, string(names), d.Category, d.URLPattern, d.Icon, d.IconURL, d.ValidationRegex, d.Description, d.SortOrder, d.IsEnabled, d.IsSystem); err != nil {
			return err
		}
	}
	return nil
}
