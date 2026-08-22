package catalog

import (
	"strings"

	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
	"gorm.io/gorm"
)

// formatTagAliases maps common format tags onto media_types.code.
var formatTagAliases = map[string]string{
	"电影": "movie", "长片": "movie", "movie": "movie", "film": "movie",
	"剧集": "tv_series", "连续剧": "tv_series", "tv": "tv_series", "tv_series": "tv_series",
	"动画番剧": "anime", "anime": "anime",
	"专辑": "music", "单曲": "music", "音乐": "music", "music": "music",
	"有声书": "audiobook", "广播剧": "audiobook", "audiobook": "audiobook",
	"图书": "novel", "小说": "novel", "轻小说": "novel", "novel": "novel", "book": "novel",
	"漫画": "comic", "comic": "comic", "manga": "comic",
	"画集": "gallery", "设定集": "gallery", "gallery": "gallery", "artbook": "gallery",
	"游戏": "game", "game": "game",
	"播客": "podcast", "podcast": "podcast",
	"软件": "software", "software": "software",
	"现场演出": "performance", "performance": "performance",
}

func (s *CatalogService) resolveMediaType(explicit string, tagNames []string, tagIDs []uint) string {
	names := make([]string, 0, len(tagNames)+len(tagIDs))
	for _, n := range tagNames {
		if t := strings.TrimSpace(n); t != "" {
			names = append(names, t)
		}
	}
	if len(tagIDs) > 0 {
		var tags []models.Tag
		s.db.Where("id IN ?", tagIDs).Find(&tags)
		for _, t := range tags {
			names = append(names, t.Name)
		}
	}
	if inferred := matchMediaTypeFromTagNames(s.db, names); inferred != "" {
		return inferred
	}
	explicit = strings.TrimSpace(explicit)
	if explicit != "" && explicit != "all" && ontology.IsEnabledMediaType(s.db, explicit) {
		return explicit
	}
	return ""
}

func matchMediaTypeFromTagNames(db *gorm.DB, names []string) string {
	if len(names) == 0 {
		return ""
	}
	var rows []models.MediaType
	_ = db.Where("is_enabled = ?", true).Find(&rows).Error
	byCode := map[string]string{}
	byLabel := map[string]string{}
	for _, mt := range rows {
		code := strings.ToLower(mt.Code)
		byCode[code] = mt.Code
		if zh := strings.TrimSpace(mt.NameZh); zh != "" {
			byLabel[zh] = mt.Code
		}
		if en := strings.ToLower(strings.TrimSpace(mt.NameEn)); en != "" {
			byLabel[en] = mt.Code
		}
	}
	for _, raw := range names {
		n := strings.TrimSpace(raw)
		if n == "" {
			continue
		}
		low := strings.ToLower(n)
		if code, ok := byCode[low]; ok {
			return code
		}
		if code, ok := byLabel[n]; ok {
			return code
		}
		if code, ok := byLabel[low]; ok {
			return code
		}
		if code, ok := formatTagAliases[n]; ok {
			if _, enabled := byCode[code]; enabled || len(rows) == 0 {
				return code
			}
		}
		if code, ok := formatTagAliases[low]; ok {
			if _, enabled := byCode[code]; enabled || len(rows) == 0 {
				return code
			}
		}
	}
	return ""
}

func (s *CatalogService) replaceWorkTagsByName(work *models.Work, names []string) {
	if names == nil {
		return
	}
	tags := s.ensureTagsByName(names)
	_ = s.db.Model(work).Association("Tags").Replace(&tags)
}

func (s *CatalogService) replaceFranchiseTagsByName(fr *models.Franchise, names []string) {
	if names == nil {
		return
	}
	tags := s.ensureTagsByName(names)
	_ = s.db.Model(fr).Association("Tags").Replace(&tags)
}

func (s *CatalogService) ensureTagsByName(names []string) []models.Tag {
	var tags []models.Tag
	seen := map[string]bool{}
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		var tag models.Tag
		if err := s.db.Where("name = ?", n).First(&tag).Error; err != nil {
			tag = models.Tag{Name: n, GroupType: "general"}
			if err := s.db.Create(&tag).Error; err != nil {
				continue
			}
		}
		tags = append(tags, tag)
	}
	return tags
}
