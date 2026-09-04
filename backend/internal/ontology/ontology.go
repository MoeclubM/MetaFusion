package ontology

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

var hubTypes = map[string]bool{
	"work": true, "artist": true, "release": true, "franchise": true, "canonical_entry": true,
}

var validDistributionChannels = map[string]bool{
	"physical": true, "digital": true, "web": true, "mixed": true, "": true,
}

func NormalizeDistributionChannel(v string) string {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" {
		return "mixed"
	}
	if validDistributionChannels[v] {
		return v
	}
	return ""
}

func IsEnabledEntityType(db *gorm.DB, code string) bool {
	if code == "" {
		return false
	}
	var total int64
	db.Model(&models.EntityTypeDefinition{}).Count(&total)
	if total == 0 {
		return true
	}
	var n int64
	db.Model(&models.EntityTypeDefinition{}).Where("code = ? AND is_enabled = ?", code, true).Count(&n)
	return n > 0
}

func IsEnabledWorkRole(db *gorm.DB, code string) bool {
	if code == "" {
		return false
	}
	var rt models.RelationType
	if err := db.Where("code = ? AND is_enabled = ?", code, true).First(&rt).Error; err != nil {
		return false
	}
	if len(rt.AllowedTargetTypes) == 0 {
		return true
	}
	for _, t := range rt.AllowedTargetTypes {
		if t == "work" {
			return true
		}
	}
	return false
}

func IsEnabledRelationType(db *gorm.DB, code string) bool {
	if code == "" {
		return false
	}
	var rt models.RelationType
	if err := db.Where("code = ? AND is_enabled = ?", code, true).First(&rt).Error; err != nil {
		return false
	}
	return true
}

type EdgeSpec struct {
	SourceType       string
	SourceID         uuid.UUID
	TargetType       string
	TargetID         uuid.UUID
	RelationshipType string
	Qualifier        string
}

func ValidateRelationEdge(db *gorm.DB, spec EdgeSpec) error {
	spec.SourceType = strings.ToLower(strings.TrimSpace(spec.SourceType))
	spec.TargetType = strings.ToLower(strings.TrimSpace(spec.TargetType))
	spec.RelationshipType = strings.ToLower(strings.TrimSpace(spec.RelationshipType))
	spec.Qualifier = strings.TrimSpace(spec.Qualifier)

	if spec.SourceID == spec.TargetID && spec.SourceType == spec.TargetType {
		return fmt.Errorf("relationship cannot target the same entity")
	}

	var rt models.RelationType
	if err := db.Where("code = ? AND is_enabled = ?", spec.RelationshipType, true).First(&rt).Error; err != nil {
		return fmt.Errorf("invalid or disabled relationship type: %s", spec.RelationshipType)
	}

	if err := assertEndpointExists(db, spec.SourceType, spec.SourceID); err != nil {
		return err
	}
	if err := assertEndpointExists(db, spec.TargetType, spec.TargetID); err != nil {
		return err
	}

	srcCodes, err := endpointTypeCodes(db, spec.SourceType, spec.SourceID)
	if err != nil {
		return err
	}
	tgtCodes, err := endpointTypeCodes(db, spec.TargetType, spec.TargetID)
	if err != nil {
		return err
	}
	if !typesAllowed(rt.AllowedSourceTypes, srcCodes) {
		return fmt.Errorf("source type not allowed for %s", spec.RelationshipType)
	}
	if !typesAllowed(rt.AllowedTargetTypes, tgtCodes) {
		return fmt.Errorf("target type not allowed for %s", spec.RelationshipType)
	}

	if rt.IsHierarchical {
		if wouldCycle(db, spec) {
			return fmt.Errorf("hierarchical relationship would create a cycle")
		}
	}
	return nil
}

func assertEndpointExists(db *gorm.DB, typ string, id uuid.UUID) error {
	var n int64
	switch typ {
	case "work":
		db.Model(&models.Work{}).Where("id = ?", id).Count(&n)
	case "artist":
		db.Model(&models.Artist{}).Where("id = ?", id).Count(&n)
	case "release":
		db.Model(&models.Release{}).Where("id = ?", id).Count(&n)
	case "franchise":
		db.Model(&models.Franchise{}).Where("id = ?", id).Count(&n)
	case "canonical_entry":
		db.Model(&models.CanonicalEntry{}).Where("id = ?", id).Count(&n)
	default:
		return fmt.Errorf("unsupported entity type: %s", typ)
	}
	if n == 0 {
		return fmt.Errorf("%s not found", typ)
	}
	return nil
}

func endpointTypeCodes(db *gorm.DB, typ string, id uuid.UUID) ([]string, error) {
	codes := []string{typ}
	if typ == "artist" {
		var a models.Artist
		if err := db.Select("entity_type").Where("id = ?", id).First(&a).Error; err != nil {
			return nil, err
		}
		if a.EntityType != "" {
			codes = append(codes, a.EntityType)
		}
	}
	return codes, nil
}

func typesAllowed(allowed []string, actual []string) bool {
	if len(allowed) == 0 {
		return true
	}
	set := map[string]bool{}
	for _, a := range allowed {
		set[strings.ToLower(strings.TrimSpace(a))] = true
	}
	for _, c := range actual {
		if set[strings.ToLower(c)] {
			return true
		}
	}
	return false
}

func wouldCycle(db *gorm.DB, spec EdgeSpec) bool {
	type hop struct {
		typ string
		id  uuid.UUID
	}
	visited := map[string]bool{}
	queue := []hop{{typ: spec.TargetType, id: spec.TargetID}}
	srcKey := spec.SourceType + ":" + spec.SourceID.String()
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		key := cur.typ + ":" + cur.id.String()
		if key == srcKey {
			return true
		}
		if visited[key] {
			continue
		}
		visited[key] = true
		var rows []models.EntityRelationship
		db.Where("source_type = ? AND source_id = ? AND relationship_type = ?", cur.typ, cur.id, spec.RelationshipType).
			Limit(64).Find(&rows)
		for _, r := range rows {
			queue = append(queue, hop{typ: r.TargetType, id: r.TargetID})
		}
	}
	return false
}

// LocaleText is a catalog translation row without parent FKs, for list/relation payloads.
type LocaleText struct {
	Locale    string `json:"locale"`
	Title     string `json:"title,omitempty"`
	Name      string `json:"name,omitempty"`
	Summary   string `json:"summary,omitempty"`
	Biography string `json:"biography,omitempty"`
}

// EntityLabel is the default display name plus original + translation packs.
type EntityLabel struct {
	Name             string
	OriginalName     string
	OriginalLanguage string
	Translations     []LocaleText
}

func LookupName(db *gorm.DB, typ string, id uuid.UUID) (name string, ok bool) {
	switch typ {
	case "work":
		var w models.Work
		if err := db.Select("title").Where("id = ?", id).First(&w).Error; err == nil {
			return w.Title, true
		}
	case "artist":
		var a models.Artist
		if err := db.Select("name").Where("id = ?", id).First(&a).Error; err == nil {
			return a.Name, true
		}
	case "release":
		var r models.Release
		if err := db.Select("edition_name").Where("id = ?", id).First(&r).Error; err == nil {
			return r.EditionName, true
		}
	case "franchise":
		var f models.Franchise
		if err := db.Select("title").Where("id = ?", id).First(&f).Error; err == nil {
			return f.Title, true
		}
	case "canonical_entry":
		var e models.CanonicalEntry
		if err := db.Select("title").Where("id = ?", id).First(&e).Error; err == nil {
			return e.Title, true
		}
	}
	return "", false
}

func LookupDisplay(db *gorm.DB, typ string, id uuid.UUID) (EntityLabel, bool) {
	switch typ {
	case "work":
		var w models.Work
		if err := db.Preload("Translations").Where("id = ?", id).First(&w).Error; err != nil {
			return EntityLabel{}, false
		}
		texts := make([]LocaleText, 0, len(w.Translations))
		for _, t := range w.Translations {
			texts = append(texts, LocaleText{Locale: t.Locale, Title: t.Title, Summary: t.Summary})
		}
		return EntityLabel{Name: w.Title, OriginalName: w.OriginalTitle, OriginalLanguage: w.OriginalLanguage, Translations: texts}, true
	case "artist":
		var a models.Artist
		if err := db.Preload("Translations").Where("id = ?", id).First(&a).Error; err != nil {
			return EntityLabel{}, false
		}
		texts := make([]LocaleText, 0, len(a.Translations))
		for _, t := range a.Translations {
			texts = append(texts, LocaleText{Locale: t.Locale, Name: t.Name, Title: t.Name, Biography: t.Biography, Summary: t.Biography})
		}
		return EntityLabel{Name: a.Name, OriginalName: a.OriginalName, Translations: texts}, true
	case "release":
		var r models.Release
		if err := db.Select("edition_name").Where("id = ?", id).First(&r).Error; err != nil {
			return EntityLabel{}, false
		}
		return EntityLabel{Name: r.EditionName}, true
	case "franchise":
		var f models.Franchise
		if err := db.Preload("Translations").Where("id = ?", id).First(&f).Error; err != nil {
			return EntityLabel{}, false
		}
		texts := make([]LocaleText, 0, len(f.Translations))
		for _, t := range f.Translations {
			texts = append(texts, LocaleText{Locale: t.Locale, Title: t.Title, Summary: t.Summary})
		}
		return EntityLabel{Name: f.Title, OriginalName: f.OriginalTitle, Translations: texts}, true
	case "canonical_entry":
		var e models.CanonicalEntry
		if err := db.Select("title").Where("id = ?", id).First(&e).Error; err != nil {
			return EntityLabel{}, false
		}
		return EntityLabel{Name: e.Title}, true
	}
	return EntityLabel{}, false
}

func HubTypes() map[string]bool { return hubTypes }

// NodeMeta contains visual metadata for catalog relation graph nodes
type NodeMeta struct {
	Name           string `json:"name"`
	OriginalName   string `json:"original_name,omitempty"`
	CoverImageURL  string `json:"cover_image_url,omitempty"`
	Disambiguation string `json:"disambiguation,omitempty"`
	Country        string `json:"country,omitempty"`
	Category       string `json:"category,omitempty"`
	Status         string `json:"status,omitempty"`
}

// LookupNodeMeta retrieves rich node information for graph visualization
func LookupNodeMeta(db *gorm.DB, typ string, id uuid.UUID) (NodeMeta, bool) {
	switch typ {
	case "work":
		var w models.Work
		if err := db.Select("id, title, original_title, cover_image_url, country, status").Where("id = ?", id).First(&w).Error; err == nil {
			return NodeMeta{
				Name:          w.Title,
				OriginalName:  w.OriginalTitle,
				CoverImageURL: w.CoverImageURL,
				Country:       w.Country,
				Status:        w.Status,
			}, true
		}
	case "artist":
		var a models.Artist
		if err := db.Select("id, name, original_name, disambiguation, country, entity_type").Where("id = ?", id).First(&a).Error; err == nil {
			return NodeMeta{
				Name:           a.Name,
				OriginalName:   a.OriginalName,
				Disambiguation: a.Disambiguation,
				Country:        a.Country,
				Category:       a.EntityType,
			}, true
		}
	case "release":
		var r models.Release
		if err := db.Select("id, edition_name, country").Where("id = ?", id).First(&r).Error; err == nil {
			return NodeMeta{
				Name:    r.EditionName,
				Country: r.Country,
			}, true
		}
	case "franchise":
		var f models.Franchise
		if err := db.Select("id, title, original_title, cover_image_url, country, disambiguation").Where("id = ?", id).First(&f).Error; err == nil {
			return NodeMeta{
				Name:           f.Title,
				OriginalName:   f.OriginalTitle,
				CoverImageURL:  f.CoverImageURL,
				Country:        f.Country,
				Disambiguation: f.Disambiguation,
			}, true
		}
	case "canonical_entry":
		var e models.CanonicalEntry
		if err := db.Select("id, title").Where("id = ?", id).First(&e).Error; err == nil {
			return NodeMeta{
				Name: e.Title,
			}, true
		}
	}
	return NodeMeta{}, false
}

// OntologyTerm represents a multilingual ontology dictionary term
type OntologyTerm struct {
	ID     string            `json:"id"`
	NameZh string            `json:"name_zh"`
	NameEn string            `json:"name_en"`
	Names  map[string]string `json:"names,omitempty"`
	DescZh string            `json:"desc_zh,omitempty"`
	DescEn string            `json:"desc_en,omitempty"`
}

func (t OntologyTerm) ToDictMap(locale string) map[string]string {
	loc := models.NormalizeLocale(locale)
	name := t.NameZh
	if loc == "en-US" && t.NameEn != "" {
		name = t.NameEn
	}
	if t.Names != nil {
		if v, ok := t.Names[loc]; ok && v != "" {
			name = v
		}
	}
	desc := t.DescZh
	if loc == "en-US" && t.DescEn != "" {
		desc = t.DescEn
	}
	return map[string]string{
		"id":      t.ID,
		"name":    name,
		"name_zh": t.NameZh,
		"name_en": t.NameEn,
		"desc":    desc,
		"desc_zh": t.DescZh,
		"desc_en": t.DescEn,
	}
}

func StandardPackagings(locale string) []map[string]string {
	terms := []OntologyTerm{
		{ID: "jewel_case", NameZh: "标准珠宝盒 (Jewel Case)", NameEn: "Jewel Case", Names: map[string]string{"zh-CN": "标准珠宝盒 (Jewel Case)", "en-US": "Jewel Case", "ja": "ジュエルケース"}},
		{ID: "digipak", NameZh: "纸套包装 (Digipak)", NameEn: "Digipak", Names: map[string]string{"zh-CN": "纸套包装 (Digipak)", "en-US": "Digipak", "ja": "デジパック"}},
		{ID: "steelbook", NameZh: "限量铁盒 (Steelbook)", NameEn: "Steelbook", Names: map[string]string{"zh-CN": "限量铁盒 (Steelbook)", "en-US": "Steelbook", "ja": "スチールブック"}},
		{ID: "box_set", NameZh: "豪华精装盒 (Box Set)", NameEn: "Box Set", Names: map[string]string{"zh-CN": "豪华精装盒 (Box Set)", "en-US": "Box Set", "ja": "ボックスセット"}},
		{ID: "gatefold", NameZh: "黑胶折页 (Gatefold)", NameEn: "Gatefold", Names: map[string]string{"zh-CN": "黑胶折页 (Gatefold)", "en-US": "Gatefold", "ja": "見開きジャケット"}},
		{ID: "slipcase", NameZh: "考据收藏盒 (Slipcase)", NameEn: "Slipcase", Names: map[string]string{"zh-CN": "考据收藏盒 (Slipcase)", "en-US": "Slipcase", "ja": "スリップケース"}},
		{ID: "paperback", NameZh: "平装单行本 (Paperback)", NameEn: "Paperback", Names: map[string]string{"zh-CN": "平装单行本", "en-US": "Paperback", "ja": "ペーパーバック"}},
		{ID: "hardcover", NameZh: "精装典藏本 (Hardcover)", NameEn: "Hardcover", Names: map[string]string{"zh-CN": "精装典藏本", "en-US": "Hardcover", "ja": "ハードカバー"}},
		{ID: "digital", NameZh: "高解析数字母带 (Digital Master)", NameEn: "Digital Master", Names: map[string]string{"zh-CN": "高解析数字母带 (Digital Master)", "en-US": "Digital Master", "ja": "デジタルマスター"}},
	}
	out := make([]map[string]string, 0, len(terms))
	for _, t := range terms {
		out = append(out, t.ToDictMap(locale))
	}
	return out
}

func StandardMediumFormats(locale string) []map[string]string {
	terms := []OntologyTerm{
		{ID: "cd", NameZh: "CD (Compact Disc)", NameEn: "CD (Compact Disc)", Names: map[string]string{"zh-CN": "CD (Compact Disc)", "en-US": "CD (Compact Disc)", "ja": "CD (コンパクトディスク)"}},
		{ID: "blu-ray", NameZh: "Blu-ray (蓝光光盘)", NameEn: "Blu-ray (BDMV)", Names: map[string]string{"zh-CN": "Blu-ray (蓝光光盘)", "en-US": "Blu-ray (BDMV)", "ja": "Blu-ray (ブルーレイ)"}},
		{ID: "4k ultra hd blu-ray", NameZh: "4K UHD 蓝光", NameEn: "4K Ultra HD Blu-ray", Names: map[string]string{"zh-CN": "4K UHD 蓝光", "en-US": "4K Ultra HD Blu-ray", "ja": "4K Ultra HD Blu-ray"}},
		{ID: "dvd-video", NameZh: "DVD 影碟", NameEn: "DVD-Video", Names: map[string]string{"zh-CN": "DVD 影碟", "en-US": "DVD-Video", "ja": "DVD-Video"}},
		{ID: "vinyl", NameZh: "Vinyl (黑胶唱片)", NameEn: "Vinyl (12\" LP)", Names: map[string]string{"zh-CN": "Vinyl (黑胶唱片)", "en-US": "Vinyl (12\" LP)", "ja": "アナログ盤 (12\" LP)"}},
		{ID: "sacd", NameZh: "SACD / DSD 高解析", NameEn: "SACD / DSD ISO", Names: map[string]string{"zh-CN": "SACD / DSD 高解析", "en-US": "SACD / DSD ISO", "ja": "SACD / DSD ISO"}},
		{ID: "hi-res flac", NameZh: "Hi-Res FLAC 无损", NameEn: "Hi-Res FLAC (24/192)", Names: map[string]string{"zh-CN": "Hi-Res FLAC 无损", "en-US": "Hi-Res FLAC (24/192)", "ja": "Hi-Res FLAC (24/192)"}},
		{ID: "cassette", NameZh: "磁带 (Cassette Tape)", NameEn: "Cassette Tape", Names: map[string]string{"zh-CN": "磁带 (Cassette Tape)", "en-US": "Cassette Tape", "ja": "カセットテープ"}},
		{ID: "epub/pdf", NameZh: "EPUB / PDF 电子书", NameEn: "EPUB / PDF", Names: map[string]string{"zh-CN": "EPUB / PDF 电子书", "en-US": "EPUB / PDF", "ja": "EPUB / PDF 電子書籍"}},
		{ID: "paperback", NameZh: "平装单行本", NameEn: "Paperback", Names: map[string]string{"zh-CN": "平装单行本", "en-US": "Paperback", "ja": "ペーパーバック"}},
		{ID: "hardcover", NameZh: "精装典藏本", NameEn: "Hardcover", Names: map[string]string{"zh-CN": "精装典藏本", "en-US": "Hardcover", "ja": "ハードカバー"}},
		{ID: "digital", NameZh: "数字发行 / 母带", NameEn: "Digital Master", Names: map[string]string{"zh-CN": "数字发行 / 母带", "en-US": "Digital Master", "ja": "デジタル配信 / マスター"}},
		{ID: "stream", NameZh: "网络流媒体", NameEn: "Streaming", Names: map[string]string{"zh-CN": "网络流媒体", "en-US": "Streaming", "ja": "ストリーミング配信"}},
		{ID: "broadcast", NameZh: "电视首播 / 广播", NameEn: "TV / Radio Broadcast", Names: map[string]string{"zh-CN": "电视首播 / 广播", "en-US": "TV / Radio Broadcast", "ja": "放送 / ラジオ"}},
		{ID: "web", NameZh: "网络发布", NameEn: "Web", Names: map[string]string{"zh-CN": "网络发布", "en-US": "Web", "ja": "Web配信"}},
	}
	out := make([]map[string]string, 0, len(terms))
	for _, t := range terms {
		out = append(out, t.ToDictMap(locale))
	}
	return out
}

func StandardMediaCategories(locale string) []map[string]string {
	terms := []OntologyTerm{
		{ID: "audio", NameZh: "音频", NameEn: "Audio", Names: map[string]string{"zh-CN": "音频", "en-US": "Audio", "ja": "オーディオ"}},
		{ID: "video", NameZh: "视频", NameEn: "Video", Names: map[string]string{"zh-CN": "视频", "en-US": "Video", "ja": "ビデオ"}},
		{ID: "book", NameZh: "图书", NameEn: "Book", Names: map[string]string{"zh-CN": "图书", "en-US": "Book", "ja": "書籍"}},
		{ID: "document", NameZh: "文档", NameEn: "Document", Names: map[string]string{"zh-CN": "文档", "en-US": "Document", "ja": "ドキュメント"}},
		{ID: "comic", NameZh: "漫画", NameEn: "Comic", Names: map[string]string{"zh-CN": "漫画", "en-US": "Comic", "ja": "コミック"}},
		{ID: "image", NameZh: "画集 / 图册", NameEn: "Artbook / Gallery", Names: map[string]string{"zh-CN": "画集 / 图册", "en-US": "Artbook / Gallery", "ja": "画集 / ギャラリー"}},
		{ID: "picture", NameZh: "图片", NameEn: "Picture", Names: map[string]string{"zh-CN": "图片", "en-US": "Picture", "ja": "画像"}},
		{ID: "software", NameZh: "程序", NameEn: "Software", Names: map[string]string{"zh-CN": "程序", "en-US": "Software", "ja": "ソフトウェア"}},
		{ID: "game", NameZh: "交互程序", NameEn: "Interactive Game", Names: map[string]string{"zh-CN": "交互程序", "en-US": "Interactive Game", "ja": "ゲーム"}},
		{ID: "disc", NameZh: "实体光盘", NameEn: "Physical Disc", Names: map[string]string{"zh-CN": "实体光盘", "en-US": "Physical Disc", "ja": "フィジカルディスク"}},
		{ID: "digital", NameZh: "数字母带", NameEn: "Digital Master", Names: map[string]string{"zh-CN": "数字母带", "en-US": "Digital Master", "ja": "デジタルマスター"}},
		{ID: "broadcast", NameZh: "电视首播 / 广播", NameEn: "TV / Radio Broadcast", Names: map[string]string{"zh-CN": "电视首播 / 广播", "en-US": "TV / Radio Broadcast", "ja": "放送"}},
		{ID: "stream", NameZh: "网络流媒体", NameEn: "Streaming", Names: map[string]string{"zh-CN": "网络流媒体", "en-US": "Streaming", "ja": "ストリーミング"}},
		{ID: "web", NameZh: "网络发布", NameEn: "Web", Names: map[string]string{"zh-CN": "网络发布", "en-US": "Web", "ja": "Web"}},
		{ID: "paperback", NameZh: "平装", NameEn: "Paperback", Names: map[string]string{"zh-CN": "平装", "en-US": "Paperback", "ja": "ペーパーバック"}},
		{ID: "hardcover", NameZh: "精装", NameEn: "Hardcover", Names: map[string]string{"zh-CN": "精装", "en-US": "Hardcover", "ja": "ハードカバー"}},
	}
	out := make([]map[string]string, 0, len(terms))
	for _, t := range terms {
		out = append(out, t.ToDictMap(locale))
	}
	return out
}
