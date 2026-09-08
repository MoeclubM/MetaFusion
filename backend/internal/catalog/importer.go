package catalog

// 外部目录导入器（OmniImportModal 后端最小实现）。
//
// 只实现 Bangumi 公开 API 的预览与落库；其余来源一律返回 not_supported，
// 不伪造数据。图片下载（download_cover）在本阶段显式忽略：只透传远端 URL，
// 不做抓取与转存，待资源/存储模块提供统一下载能力后再接线。
//
// 落库全部走 Store.Save / Store.SaveRelation，证据（edit_note + sources）必填；
// 幂等键 external_ids.metafusion_import=bangumi:{kind}:{id}，已存在直接返回旧 ID。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/language"
)

var (
	// bangumiAPIBase 允许单测替换为 httptest 服务；生产默认指向 Bangumi 公开 API。
	bangumiAPIBase     = "https://api.bgm.tv"
	importerHTTPClient = &http.Client{Timeout: 10 * time.Second}
)

const importerUserAgent = "MetaFusion/1.0 (catalog importer)"

// ---- 前端契约 DTO（字段与 frontend/src/lib/api.ts 逐一对齐） ----
// http.go 的 body() 使用 DisallowUnknownFields，缺字段会导致 invalid_payload，
// 因此请求结构必须包含前端可能发送的全部字段；松散对象统一用 any / map 承接。

type ImporterPreviewRequest struct {
	Source        string `json:"source"`
	URLOrID       string `json:"url_or_id"`
	EntityType    string `json:"entity_type"`
	MediaTypeHint string `json:"media_type_hint"`
}

type ImporterTranslationItem struct {
	Locale  string   `json:"locale"`
	Title   string   `json:"title"`
	Summary string   `json:"summary"`
	Aliases []string `json:"aliases,omitempty"`
}

type ImporterWorkPreview struct {
	Title            string                    `json:"title"`
	OriginalTitle    string                    `json:"original_title"`
	Aliases          []string                  `json:"aliases"`
	ReleaseDate      string                    `json:"release_date"`
	BeginDate        string                    `json:"begin_date,omitempty"`
	Country          string                    `json:"country"`
	Language         string                    `json:"language"`
	OriginalLanguage string                    `json:"original_language,omitempty"`
	Summary          string                    `json:"summary"`
	CoverImageURL    string                    `json:"cover_image_url"`
	CoverAspect      string                    `json:"cover_aspect"`
	ContentRating    string                    `json:"content_rating"`
	Tags             []string                  `json:"tags"`
	Translations     []ImporterTranslationItem `json:"translations"`
	CatalogMetadata  any                       `json:"catalog_metadata,omitempty"`
}

type ImporterArtistPreview struct {
	ID             string                    `json:"id,omitempty"`
	Name           string                    `json:"name"`
	OriginalName   string                    `json:"original_name,omitempty"`
	Role           string                    `json:"role"`
	EntityType     string                    `json:"entity_type"`
	Country        string                    `json:"country,omitempty"`
	Biography      string                    `json:"biography,omitempty"`
	Disambiguation string                    `json:"disambiguation,omitempty"`
	Language       string                    `json:"language,omitempty"`
	AvatarURL      string                    `json:"avatar_url,omitempty"`
	CharacterName  string                    `json:"character_name,omitempty"`
	Aliases        []string                  `json:"aliases,omitempty"`
	ExternalIDs    map[string]any            `json:"external_ids,omitempty"`
	Translations   []ImporterTranslationItem `json:"translations,omitempty"`
	MatchedArtist  any                       `json:"matched_artist,omitempty"`
}

type ImporterStaffAssociation struct {
	ParsedName     string                    `json:"parsed_name"`
	ParsedOriginal string                    `json:"parsed_original,omitempty"`
	ParsedRole     string                    `json:"parsed_role"`
	EntityType     string                    `json:"entity_type"`
	Action         string                    `json:"action"`
	TargetArtistID string                    `json:"target_artist_id,omitempty"`
	CustomRole     string                    `json:"custom_role,omitempty"`
	CharacterName  string                    `json:"character_name,omitempty"`
	Country        string                    `json:"country,omitempty"`
	Biography      string                    `json:"biography,omitempty"`
	AvatarURL      string                    `json:"avatar_url,omitempty"`
	ExternalIDs    map[string]any            `json:"external_ids,omitempty"`
	Translations   []ImporterTranslationItem `json:"translations,omitempty"`
}

type ImporterTrackPreview struct {
	Position        int     `json:"position"`
	Title           string  `json:"title"`
	DurationSeconds float64 `json:"duration_seconds"`
	ArtistCredit    string  `json:"artist_credit,omitempty"`
	ISRC            string  `json:"isrc,omitempty"`
	RecordingMBID   string  `json:"recording_mbid,omitempty"`
}

type ImporterMediumPreview struct {
	Position         int                    `json:"position"`
	Number           string                 `json:"number,omitempty"`
	Name             string                 `json:"name"`
	Format           string                 `json:"format"`
	MediaCategory    string                 `json:"media_category"`
	Role             string                 `json:"role,omitempty"`
	OriginalLanguage string                 `json:"original_language,omitempty"`
	Translations     any                    `json:"translations,omitempty"`
	Tracks           []ImporterTrackPreview `json:"tracks"`
}

type ImporterReleasePreview struct {
	CoverImageURL       string `json:"cover_image_url,omitempty"`
	CoverAspect         string `json:"cover_aspect,omitempty"`
	OriginalLanguage    string `json:"original_language,omitempty"`
	Translations        any    `json:"translations,omitempty"`
	EditionName         string `json:"edition_name"`
	CatalogNumber       string `json:"catalog_number,omitempty"`
	Barcode             string `json:"barcode,omitempty"`
	Publisher           string `json:"publisher,omitempty"`
	Packaging           string `json:"packaging,omitempty"`
	Country             string `json:"country,omitempty"`
	Language            string `json:"language,omitempty"`
	DistributionChannel string `json:"distribution_channel,omitempty"`
	EditionDate         string `json:"edition_date,omitempty"`
	Notes               string `json:"notes,omitempty"`
	CatalogMetadata     any    `json:"catalog_metadata,omitempty"`
}

type ImporterCanonicalEntryPreview struct {
	Title            string         `json:"title"`
	Translations     any            `json:"translations,omitempty"`
	Position         int            `json:"position"`
	Number           string         `json:"number,omitempty"`
	EntryRole        string         `json:"entry_role,omitempty"`
	OriginalLanguage string         `json:"original_language,omitempty"`
	DurationSeconds  float64        `json:"duration_seconds,omitempty"`
	Attributes       map[string]any `json:"attributes,omitempty"`
	ExternalIDs      map[string]any `json:"external_ids,omitempty"`
}

type ImporterPreviewResponse struct {
	Source           string                          `json:"source"`
	EntityType       string                          `json:"entity_type,omitempty"`
	ExternalID       string                          `json:"external_id"`
	ExternalURL      string                          `json:"external_url"`
	MediaType        string                          `json:"media_type"`
	Work             *ImporterWorkPreview            `json:"work,omitempty"`
	Artist           *ImporterArtistPreview          `json:"artist,omitempty"`
	Artists          []ImporterArtistPreview         `json:"artists,omitempty"`
	HasRelease       bool                            `json:"has_release,omitempty"`
	CanonicalEntries []ImporterCanonicalEntryPreview `json:"canonical_entries,omitempty"`
	Release          *ImporterReleasePreview         `json:"release,omitempty"`
	Mediums          []ImporterMediumPreview         `json:"mediums,omitempty"`
	Tags             []string                        `json:"tags"`
}

type ImporterImportRequest struct {
	EntityType        string                          `json:"entity_type,omitempty"`
	Source            string                          `json:"source,omitempty"`
	URLOrID           string                          `json:"url_or_id,omitempty"`
	ExternalID        string                          `json:"external_id,omitempty"`
	MediaTypeHint     string                          `json:"media_type_hint,omitempty"`
	Work              *ImporterWorkPreview            `json:"work,omitempty"`
	Artist            *ImporterArtistPreview          `json:"artist,omitempty"`
	Artists           []ImporterArtistPreview         `json:"artists,omitempty"`
	StaffAssociations []ImporterStaffAssociation      `json:"staff_associations,omitempty"`
	HasRelease        bool                            `json:"has_release,omitempty"`
	CanonicalEntries  []ImporterCanonicalEntryPreview `json:"canonical_entries,omitempty"`
	Release           *ImporterReleasePreview         `json:"release,omitempty"`
	Mediums           []ImporterMediumPreview         `json:"mediums,omitempty"`
	DownloadCover     bool                            `json:"download_cover,omitempty"`
	EditNote          string                          `json:"edit_note,omitempty"`
	SourceURLs        []string                        `json:"source_urls,omitempty"`
	IsMasterVerified  bool                            `json:"is_master_verified,omitempty"`
	TargetWorkID      string                          `json:"target_work_id,omitempty"`
	LinkMode          string                          `json:"link_mode,omitempty"`
	RelationType      string                          `json:"relation_type,omitempty"`
}

type ImporterImportedCounts struct {
	Artists int `json:"artists"`
	Mediums int `json:"mediums"`
	Tracks  int `json:"tracks"`
}

type ImporterImportResponse struct {
	Success        bool                   `json:"success"`
	EntityType     string                 `json:"entity_type,omitempty"`
	WorkID         string                 `json:"work_id,omitempty"`
	ReleaseID      string                 `json:"release_id,omitempty"`
	ArtistID       string                 `json:"artist_id,omitempty"`
	Work           Entity                 `json:"work,omitempty"`
	Release        Entity                 `json:"release,omitempty"`
	Artist         Entity                 `json:"artist,omitempty"`
	ImportedCounts ImporterImportedCounts `json:"imported_counts"`
	RedirectURL    string                 `json:"redirect_url"`
}

// ---- 参数归一化 ----

func normalizeImporterSource(source string) (string, error) {
	src := strings.ToLower(strings.TrimSpace(source))
	if src == "" {
		src = "auto"
	}
	if src == "auto" || src == "bangumi" {
		return "bangumi", nil
	}
	return "", fmt.Errorf("not_supported")
}

func normalizeImporterEntityType(entityType string) (string, error) {
	et := strings.ToLower(strings.TrimSpace(entityType))
	if et == "" {
		et = "work"
	}
	if !contains([]string{"work", "artist", "organization", "character"}, et) {
		return "", fmt.Errorf("invalid_entity_type")
	}
	return et, nil
}

func normalizeImporterLinkMode(mode string) (string, error) {
	m := strings.ToLower(strings.TrimSpace(mode))
	if m == "" {
		m = "new_work"
	}
	if !contains([]string{"new_work", "append_release_to_work", "merge_translations", "create_relation"}, m) {
		return "", fmt.Errorf("invalid_link_mode")
	}
	return m, nil
}

// ---- Bangumi ID 解析 ----

type bangumiRef struct {
	Kind string // subject | person | character
	ID   int
}

var bangumiKindSegments = map[string]string{
	"subject": "subject", "subjects": "subject",
	"person": "person", "persons": "person", "mono": "person",
	"character": "character", "characters": "character", "crt": "character",
}

func parseBangumiRef(raw string) (bangumiRef, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return bangumiRef{}, fmt.Errorf("invalid_payload")
	}
	if id, err := strconv.Atoi(s); err == nil && id > 0 {
		return bangumiRef{Kind: "subject", ID: id}, nil
	}
	normalized := s
	if !strings.Contains(normalized, "://") {
		normalized = "https://" + normalized
	}
	u, err := url.Parse(normalized)
	if err != nil || u.Host == "" {
		return bangumiRef{}, fmt.Errorf("invalid_payload")
	}
	host := strings.ToLower(u.Host)
	if !strings.Contains(host, "bgm.tv") && !strings.Contains(host, "bangumi.tv") && !strings.Contains(host, "chii.in") {
		return bangumiRef{}, fmt.Errorf("not_supported")
	}
	kind := ""
	id := 0
	expectID := false
	for _, seg := range strings.Split(u.Path, "/") {
		seg = strings.ToLower(strings.TrimSpace(seg))
		if seg == "" {
			continue
		}
		if k, ok := bangumiKindSegments[seg]; ok {
			kind = k
			// 只取种类段之后的第一段数字：/subject/7/ep/3 这类详情子路径
			// 的末段数字（ep 编号）不是条目 ID，必须忽略。
			expectID = id == 0
			continue
		}
		if n, err := strconv.Atoi(seg); err == nil && n > 0 {
			if expectID || id == 0 && kind == "" {
				id = n
				expectID = false
			}
		}
	}
	if id <= 0 {
		return bangumiRef{}, fmt.Errorf("invalid_payload")
	}
	if kind == "" {
		kind = "subject"
	}
	return bangumiRef{Kind: kind, ID: id}, nil
}

// resolveBangumiRef 在纯数字 ID 缺少路径种类的情况下，按实体类型改写目标端点。
func resolveBangumiRef(raw, entityType string) (bangumiRef, error) {
	ref, err := parseBangumiRef(raw)
	if err != nil {
		return ref, err
	}
	if _, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil {
		switch entityType {
		case "artist", "organization":
			ref.Kind = "person"
		case "character":
			ref.Kind = "character"
		}
	}
	return ref, nil
}

// ---- Bangumi 公开 API ----

func fetchBangumi(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, bangumiAPIBase+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", importerUserAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := importerHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("upstream_error")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("not_found")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upstream_error")
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("upstream_error")
	}
	return nil
}

type bangumiImages struct {
	Large  string `json:"large"`
	Common string `json:"common"`
	Medium string `json:"medium"`
	Small  string `json:"small"`
	Grid   string `json:"grid"`
}

func (im bangumiImages) best() string {
	for _, u := range []string{im.Large, im.Common, im.Medium, im.Small, im.Grid} {
		if strings.TrimSpace(u) != "" {
			return u
		}
	}
	return ""
}

type bangumiTag struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type bangumiSubject struct {
	ID       int           `json:"id"`
	Type     int           `json:"type"`
	Name     string        `json:"name"`
	NameCN   string        `json:"name_cn"`
	Summary  string        `json:"summary"`
	Date     string        `json:"date"`
	Platform string        `json:"platform"`
	Images   bangumiImages `json:"images"`
	Tags     []bangumiTag  `json:"tags"`
}

// persons 端点 type 字段存在 int 与 {id} 两种形态，做兼容解析。
type bangumiPersonType struct {
	ID int
}

func (t *bangumiPersonType) UnmarshalJSON(b []byte) error {
	var id int
	if err := json.Unmarshal(b, &id); err == nil {
		t.ID = id
		return nil
	}
	var obj struct {
		ID int `json:"id"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		return err
	}
	t.ID = obj.ID
	return nil
}

type bangumiPerson struct {
	ID      int               `json:"id"`
	Name    string            `json:"name"`
	NameCN  string            `json:"name_cn"`
	Type    bangumiPersonType `json:"type"`
	Career  []string          `json:"career"`
	Summary string            `json:"summary"`
	Images  bangumiImages     `json:"images"`
}

type bangumiCharacter struct {
	ID      int           `json:"id"`
	Name    string        `json:"name"`
	NameCN  string        `json:"name_cn"`
	Summary string        `json:"summary"`
	Images  bangumiImages `json:"images"`
}

// bangumiWorkType 把 subject type 映射到 definitions 现有 work 类型；
// 无法判断时返回空（调用方保持 Types 为空，不虚构类型）。
// Bangumi 文档：1=书籍 2=动画 3=音乐 4=游戏 6=三次元。
func bangumiWorkType(t int) string {
	switch t {
	case 1:
		return "novel"
	case 2:
		return "animation"
	case 3:
		return "music"
	case 4:
		return "indie_game"
	case 6:
		return "personal"
	default:
		return ""
	}
}

// bangumiAgentType 把 person type 映射到 definitions 现有 agent 类型。
// Bangumi 人物：1=个人 2=公司 3=组合。
func bangumiAgentType(t int) string {
	switch t {
	case 2:
		return "organization"
	case 3:
		return "group"
	default:
		return "person"
	}
}

func bangumiTags(tags []bangumiTag, limit int) []string {
	out := []string{}
	for _, t := range tags {
		name := strings.TrimSpace(t.Name)
		if name == "" {
			continue
		}
		out = append(out, name)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func bangumiTitlePair(name, nameCN string) (title, original string) {
	name = strings.TrimSpace(name)
	nameCN = strings.TrimSpace(nameCN)
	if nameCN != "" {
		return nameCN, name
	}
	return name, name
}

func bangumiTranslationItems(name, nameCN, summary string) []ImporterTranslationItem {
	items := []ImporterTranslationItem{}
	if strings.TrimSpace(nameCN) != "" && strings.TrimSpace(nameCN) != strings.TrimSpace(name) {
		items = append(items, ImporterTranslationItem{Locale: "zh-CN", Title: strings.TrimSpace(nameCN), Summary: summary})
	}
	if strings.TrimSpace(name) != "" {
		items = append(items, ImporterTranslationItem{Locale: "ja", Title: strings.TrimSpace(name)})
	}
	return items
}

// Preview 解析外部 ID 并抓取 Bangumi 公开 API 生成预览；非 Bangumi 来源返回 not_supported。
func (s *Store) Preview(ctx context.Context, source, urlOrID, entityType string) (ImporterPreviewResponse, error) {
	resolvedSource, err := normalizeImporterSource(source)
	if err != nil {
		return ImporterPreviewResponse{}, err
	}
	et, err := normalizeImporterEntityType(entityType)
	if err != nil {
		return ImporterPreviewResponse{}, err
	}
	ref, err := resolveBangumiRef(urlOrID, et)
	if err != nil {
		return ImporterPreviewResponse{}, err
	}
	switch ref.Kind {
	case "subject":
		return previewBangumiSubject(ctx, resolvedSource, ref.ID)
	case "person":
		return previewBangumiPerson(ctx, resolvedSource, ref.ID)
	case "character":
		return previewBangumiCharacter(ctx, resolvedSource, ref.ID)
	default:
		return ImporterPreviewResponse{}, fmt.Errorf("not_supported")
	}
}

func previewBangumiSubject(ctx context.Context, source string, id int) (ImporterPreviewResponse, error) {
	var sub bangumiSubject
	if err := fetchBangumi(ctx, "/v0/subjects/"+strconv.Itoa(id), &sub); err != nil {
		return ImporterPreviewResponse{}, err
	}
	if strings.TrimSpace(sub.Name) == "" {
		return ImporterPreviewResponse{}, fmt.Errorf("upstream_error")
	}
	title, original := bangumiTitlePair(sub.Name, sub.NameCN)
	workType := bangumiWorkType(sub.Type)
	mediaType := workType
	if mediaType == "" {
		mediaType = "unknown"
	}
	tags := bangumiTags(sub.Tags, 12)
	return ImporterPreviewResponse{
		Source:      source,
		EntityType:  "work",
		ExternalID:  strconv.Itoa(sub.ID),
		ExternalURL: "https://bgm.tv/subject/" + strconv.Itoa(sub.ID),
		MediaType:   mediaType,
		Work: &ImporterWorkPreview{
			Title:         title,
			OriginalTitle: original,
			Aliases:       []string{},
			ReleaseDate:   strings.TrimSpace(sub.Date),
			Summary:       sub.Summary,
			CoverImageURL: sub.Images.best(),
			Tags:          tags,
			Translations:  bangumiTranslationItems(sub.Name, sub.NameCN, sub.Summary),
			CatalogMetadata: map[string]any{
				"bangumi_type":     sub.Type,
				"bangumi_platform": sub.Platform,
			},
		},
		Tags: tags,
	}, nil
}

func previewBangumiPerson(ctx context.Context, source string, id int) (ImporterPreviewResponse, error) {
	var p bangumiPerson
	if err := fetchBangumi(ctx, "/v0/persons/"+strconv.Itoa(id), &p); err != nil {
		return ImporterPreviewResponse{}, err
	}
	if strings.TrimSpace(p.Name) == "" {
		return ImporterPreviewResponse{}, fmt.Errorf("upstream_error")
	}
	agentType := bangumiAgentType(p.Type.ID)
	entityType := "artist"
	if agentType == "organization" || agentType == "group" {
		entityType = "organization"
	}
	name, original := bangumiTitlePair(p.Name, p.NameCN)
	role := ""
	if len(p.Career) > 0 {
		role = strings.TrimSpace(p.Career[0])
	}
	return ImporterPreviewResponse{
		Source:      source,
		EntityType:  entityType,
		ExternalID:  strconv.Itoa(p.ID),
		ExternalURL: "https://bgm.tv/person/" + strconv.Itoa(p.ID),
		MediaType:   agentType,
		Artist: &ImporterArtistPreview{
			Name:         name,
			OriginalName: original,
			Role:         role,
			EntityType:   agentType,
			Biography:    p.Summary,
			AvatarURL:    p.Images.best(),
			Aliases:      []string{},
			ExternalIDs:  map[string]any{"bangumi_person": p.ID},
			Translations: bangumiTranslationItems(p.Name, p.NameCN, p.Summary),
		},
		Tags: []string{},
	}, nil
}

func previewBangumiCharacter(ctx context.Context, source string, id int) (ImporterPreviewResponse, error) {
	var ch bangumiCharacter
	if err := fetchBangumi(ctx, "/v0/characters/"+strconv.Itoa(id), &ch); err != nil {
		return ImporterPreviewResponse{}, err
	}
	if strings.TrimSpace(ch.Name) == "" {
		return ImporterPreviewResponse{}, fmt.Errorf("upstream_error")
	}
	name, original := bangumiTitlePair(ch.Name, ch.NameCN)
	return ImporterPreviewResponse{
		Source:      source,
		EntityType:  "character",
		ExternalID:  strconv.Itoa(ch.ID),
		ExternalURL: "https://bgm.tv/character/" + strconv.Itoa(ch.ID),
		MediaType:   "character",
		Artist: &ImporterArtistPreview{
			Name:         name,
			OriginalName: original,
			Role:         "Character",
			EntityType:   "character",
			Biography:    ch.Summary,
			AvatarURL:    ch.Images.best(),
			Aliases:      []string{},
			ExternalIDs:  map[string]any{"bangumi_character": ch.ID},
			Translations: bangumiTranslationItems(ch.Name, ch.NameCN, ch.Summary),
		},
		Tags: []string{},
	}, nil
}

// ---- 落库 ----

var importerDatePattern = regexp.MustCompile(`^\d{4}(-\d{2}(-\d{2})?)?$`)

func cleanImporterDate(v string) string {
	v = strings.TrimSpace(v)
	if !importerDatePattern.MatchString(v) {
		return ""
	}
	return v
}

func sanitizePosition(v, fallback int) int {
	if v < 0 {
		return fallback
	}
	return v
}

func toEntityTranslations(items []ImporterTranslationItem) map[string]Translation {
	out := map[string]Translation{}
	for _, it := range items {
		loc := strings.TrimSpace(it.Locale)
		title := strings.TrimSpace(it.Title)
		if loc == "" || title == "" {
			continue
		}
		if _, err := language.Parse(loc); err != nil {
			continue
		}
		out[loc] = Translation{Title: title, Summary: it.Summary, Aliases: it.Aliases}
	}
	return out
}

func originalLanguageOrEmpty(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if _, err := language.Parse(v); err != nil {
		return ""
	}
	return v
}

// stringScalarMap 只收录标量值，保证 Entity.ExternalIDs 全为字符串。
func stringScalarMap(in map[string]any) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		switch x := v.(type) {
		case string:
			out[k] = x
		case float64:
			out[k] = strconv.FormatFloat(x, 'f', -1, 64)
		case bool:
			out[k] = strconv.FormatBool(x)
		}
	}
	return out
}

func importerEvidence(req ImporterImportRequest, source string) (string, []Source) {
	note := strings.TrimSpace(req.EditNote)
	if note == "" {
		note = "从 " + source + " 导入"
		if id := strings.TrimSpace(req.URLOrID); id != "" {
			if len(id) > 120 {
				id = id[:120]
			}
			note += " " + id
		}
	}
	sources := []Source{}
	for _, raw := range req.SourceURLs {
		u := strings.TrimSpace(raw)
		if validURL(u) {
			sources = append(sources, Source{Kind: "url", Citation: u, URL: u})
		}
	}
	if len(sources) == 0 {
		sources = []Source{{Kind: "self", Citation: note}}
	}
	return note, sources
}

// importDedupKey 由 url_or_id 本地解析幂等键，不发网络请求。
func importDedupKey(source string, req ImporterImportRequest, entityType string) (string, bool) {
	if source != "bangumi" {
		return "", false
	}
	ref, err := resolveBangumiRef(req.URLOrID, entityType)
	if err != nil {
		return "", false
	}
	return "bangumi:" + ref.Kind + ":" + strconv.Itoa(ref.ID), true
}

func splitDedupKey(key string) (kind, id string) {
	parts := strings.Split(key, ":")
	if len(parts) != 3 {
		return "", ""
	}
	return parts[1], parts[2]
}

func (s *Store) findImported(ctx context.Context, key string, actor *User) (Entity, bool) {
	var id string
	if err := s.DB.QueryRowContext(ctx, `SELECT id FROM catalog.entities WHERE document->'external_ids'->>'metafusion_import'=$1 AND status NOT IN ('deleted','merged') LIMIT 1`, key).Scan(&id); err != nil {
		return Entity{}, false
	}
	e, err := s.Get(ctx, id, actor)
	if err != nil {
		return Entity{}, false
	}
	return e, true
}

func (s *Store) importerSave(ctx context.Context, e Entity, actor User, note string, sources []Source) (Entity, error) {
	if e.Translations == nil {
		e.Translations = map[string]Translation{}
	}
	if e.Attributes == nil {
		e.Attributes = map[string]any{}
	}
	if e.ExternalIDs == nil {
		e.ExternalIDs = map[string]string{}
	}
	return s.Save(ctx, Edit{Entity: e, ExpectedVersion: 0, EditNote: note, Sources: sources}, actor)
}

// workTypeFromMetadata 从预览回带 catalog_metadata 还原 Bangumi 条目类型，
// 手工拼装的载荷没有该字段时返回空（不虚构类型）。
func workTypeFromMetadata(v any) string {
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	f, ok := m["bangumi_type"].(float64)
	if !ok {
		return ""
	}
	return bangumiWorkType(int(f))
}

func applyWorkSummary(e *Entity, summary string) {
	summary = strings.TrimSpace(summary)
	if summary == "" {
		return
	}
	// Entity 没有简介列，简介只能落在翻译行；只在无歧义时填充，不猜语种。
	if e.OriginalLanguage != "" {
		tr := e.Translations[e.OriginalLanguage]
		if tr.Title == "" {
			tr.Title = e.Title
		}
		tr.Summary = summary
		e.Translations[e.OriginalLanguage] = tr
		return
	}
	if len(e.Translations) == 1 {
		for k, tr := range e.Translations {
			tr.Summary = summary
			e.Translations[k] = tr
		}
	}
}

func buildWorkEntity(w *ImporterWorkPreview, workType, source, key, sourceID string, hasKey bool) (Entity, error) {
	if w == nil || strings.TrimSpace(w.Title) == "" {
		return Entity{}, fmt.Errorf("invalid_payload")
	}
	e := Entity{
		Kind:             "work",
		Title:            strings.TrimSpace(w.Title),
		OriginalLanguage: originalLanguageOrEmpty(w.OriginalLanguage),
		Translations:     toEntityTranslations(w.Translations),
		ExternalIDs:      map[string]string{},
		Attributes:       map[string]any{},
	}
	if workType != "" {
		e.Types = []string{workType}
		if lang := strings.TrimSpace(w.Language); lang != "" {
			e.Attributes["language"] = lang
		}
	}
	if hasKey {
		e.ExternalIDs["metafusion_import"] = key
		if kind, id := splitDedupKey(key); kind == "subject" {
			e.ExternalIDs["bangumi"] = id
		} else if kind != "" && id != "" {
			e.ExternalIDs["bangumi_"+kind] = id
		}
	} else if strings.TrimSpace(sourceID) != "" {
		e.ExternalIDs[source] = strings.TrimSpace(sourceID)
	}
	applyWorkSummary(&e, w.Summary)
	return e, nil
}

func agentTypeForEntityType(entityType string) string {
	switch entityType {
	case "organization":
		return "organization"
	case "character":
		return "character"
	default:
		return "person"
	}
}

func agentTypeForPreviewValue(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "person", "organization", "group", "character":
		return strings.ToLower(strings.TrimSpace(v))
	case "studio", "publisher", "company", "label", "circle":
		return "organization"
	default:
		return ""
	}
}

func buildAgentEntity(name, originalName, biography, avatarURL, lang, entityType string, translations []ImporterTranslationItem, externalIDs map[string]any, key string, hasKey bool) (Entity, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Entity{}, fmt.Errorf("invalid_payload")
	}
	agentType := agentTypeForEntityType(entityType)
	if t := agentTypeForPreviewValue(entityType); t != "" {
		agentType = t
	}
	_ = avatarURL // 头像只做预览透传：本阶段不下载图片，不写入 pictures（需可考据来源）。
	e := Entity{
		Kind:             "agent",
		Title:            name,
		OriginalLanguage: originalLanguageOrEmpty(lang),
		Translations:     toEntityTranslations(translations),
		Types:            []string{agentType},
		ExternalIDs:      stringScalarMap(externalIDs),
		Attributes:       map[string]any{},
	}
	if strings.TrimSpace(originalName) != "" && strings.TrimSpace(originalName) != name {
		if e.OriginalLanguage != "" {
			tr := e.Translations[e.OriginalLanguage]
			if tr.Title == "" {
				tr.Title = originalName
				e.Translations[e.OriginalLanguage] = tr
			}
		}
	}
	if strings.TrimSpace(biography) != "" {
		applyWorkSummary(&e, biography)
	}
	if hasKey {
		e.ExternalIDs["metafusion_import"] = key
		if kind, id := splitDedupKey(key); kind != "" && id != "" {
			e.ExternalIDs["bangumi_"+kind] = id
		}
	}
	return e, nil
}

// staffAgentType 把演职员行的自由文本类型收敛到 agent 定义类型。
func staffAgentType(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "organization", "group", "character":
		return strings.ToLower(strings.TrimSpace(v))
	case "studio", "publisher", "company", "label", "circle":
		return "organization"
	default:
		return "person"
	}
}

var importerMediumFormats = map[string]string{
	"cd": "cd", "bd": "bd", "blu-ray": "bd", "bluray": "bd", "uhd_bd": "uhd_bd",
	"dvd": "dvd", "vinyl": "vinyl", "lp": "vinyl", "sacd": "sacd",
	"cassette": "cassette", "tape": "cassette", "paper": "paper", "book": "paper",
	"digital": "digital", "mp3": "digital", "flac": "digital", "web": "web",
}

func importerEnum(v string, allowed []string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	if contains(allowed, v) {
		return v
	}
	return ""
}

type canonicalLink struct {
	expressionID string
	number       string
}

// createExpression 建单个 expression（canonical entry 或曲目回退）。
func (s *Store) createExpression(ctx context.Context, actor User, note string, sources []Source, workID, title, number string, pos int, duration float64, externalIDs map[string]any) (Entity, error) {
	exprAttrs := map[string]any{}
	var exprTypes []string
	if duration > 0 {
		exprTypes = []string{"expression"}
		exprAttrs["duration"] = duration
	}
	return s.importerSave(ctx, Entity{
		Kind:        "expression",
		Title:       title,
		WorkID:      workID,
		Number:      strings.TrimSpace(number),
		Position:    pos,
		Types:       exprTypes,
		Attributes:  exprAttrs,
		ExternalIDs: stringScalarMap(externalIDs),
	}, actor, note, sources)
}

// importExpressionsOnly 无发行版时只建 expression，不建 release 链。
func (s *Store) importExpressionsOnly(ctx context.Context, actor User, note string, sources []Source, workID string, entries []ImporterCanonicalEntryPreview) error {
	for i, ce := range entries {
		title := strings.TrimSpace(ce.Title)
		if title == "" {
			return fmt.Errorf("invalid_payload")
		}
		if _, err := s.createExpression(ctx, actor, note, sources, workID, title, ce.Number, sanitizePosition(ce.Position, i), ce.DurationSeconds, ce.ExternalIDs); err != nil {
			return err
		}
	}
	return nil
}

// importReleaseChain 按 work → expression → release → medium → track 建链；
// canonical_entries 先建成 expression，曲目按 position 复用，缺失时按曲目新建。
func (s *Store) importReleaseChain(ctx context.Context, actor User, note string, sources []Source, workID, workTitle string, entries []ImporterCanonicalEntryPreview, rel *ImporterReleasePreview, mediums []ImporterMediumPreview) (Entity, ImporterImportedCounts, error) {
	counts := ImporterImportedCounts{}
	links := map[int]canonicalLink{}
	for i, ce := range entries {
		title := strings.TrimSpace(ce.Title)
		if title == "" {
			return Entity{}, counts, fmt.Errorf("invalid_payload")
		}
		pos := sanitizePosition(ce.Position, i)
		saved, err := s.createExpression(ctx, actor, note, sources, workID, title, ce.Number, pos, ce.DurationSeconds, ce.ExternalIDs)
		if err != nil {
			return Entity{}, counts, err
		}
		if _, ok := links[pos]; !ok {
			links[pos] = canonicalLink{expressionID: saved.ID, number: saved.Number}
		}
	}
	releaseTitle := strings.TrimSpace(workTitle)
	var releaseAttrs map[string]any
	releaseAttrs = map[string]any{}
	if rel != nil {
		if strings.TrimSpace(rel.EditionName) != "" {
			releaseTitle = strings.TrimSpace(rel.EditionName)
		}
		if v := strings.TrimSpace(rel.CatalogNumber); v != "" {
			releaseAttrs["catalog_number"] = v
		}
		if v := strings.TrimSpace(rel.Barcode); v != "" {
			releaseAttrs["barcode"] = v
		}
		if v := strings.TrimSpace(rel.Country); v != "" {
			releaseAttrs["country"] = v
		}
		if v := cleanImporterDate(rel.EditionDate); v != "" {
			releaseAttrs["edition_date"] = v
		}
		// publisher 为 entity 引用字段：预览只有自由文本名称，无法解析为 Agent，
		// 不写入 attributes，避免 invalid_reference。预览未携带 edition_type，
		// 不虚构版本类型。
	}
	if releaseTitle == "" {
		return Entity{}, counts, fmt.Errorf("invalid_payload")
	}
	release, err := s.importerSave(ctx, Entity{
		Kind:        "release",
		Title:       releaseTitle,
		Types:       []string{"release"},
		Attributes:  releaseAttrs,
		ExternalIDs: map[string]string{},
		Subjects:    []Subject{{WorkID: workID, Role: "primary", Position: 0}},
	}, actor, note, sources)
	if err != nil {
		return Entity{}, counts, err
	}
	for i, m := range mediums {
		mediumTitle := strings.TrimSpace(m.Name)
		if mediumTitle == "" {
			mediumTitle = "Disc " + strconv.Itoa(i+1)
		}
		mediumAttrs := map[string]any{}
		if f, ok := importerMediumFormats[strings.ToLower(strings.TrimSpace(m.Format))]; ok {
			mediumAttrs["format"] = f
		}
		if r := importerEnum(m.Role, []string{"primary", "supplement", "side", "extra", "commentary"}); r != "" {
			mediumAttrs["role"] = r
		}
		medium, err := s.importerSave(ctx, Entity{
			Kind:        "medium",
			Title:       mediumTitle,
			ReleaseID:   release.ID,
			Number:      strings.TrimSpace(m.Number),
			Position:    sanitizePosition(m.Position, i),
			Types:       []string{"medium"},
			Attributes:  mediumAttrs,
			ExternalIDs: map[string]string{},
		}, actor, note, sources)
		if err != nil {
			return Entity{}, counts, err
		}
		counts.Mediums++
		for j, t := range m.Tracks {
			trackTitle := strings.TrimSpace(t.Title)
			if trackTitle == "" {
				return Entity{}, counts, fmt.Errorf("invalid_payload")
			}
			pos := sanitizePosition(t.Position, j)
			expressionID := ""
			number := ""
			if link, ok := links[pos]; ok {
				expressionID, number = link.expressionID, link.number
			} else {
				exprAttrs := map[string]any{}
				var exprTypes []string
				if t.DurationSeconds > 0 {
					exprTypes = []string{"expression"}
					exprAttrs["duration"] = t.DurationSeconds
				}
				expr, err := s.importerSave(ctx, Entity{
					Kind:        "expression",
					Title:       trackTitle,
					WorkID:      workID,
					Position:    pos,
					Types:       exprTypes,
					Attributes:  exprAttrs,
					ExternalIDs: map[string]string{},
				}, actor, note, sources)
				if err != nil {
					return Entity{}, counts, err
				}
				expressionID = expr.ID
			}
			trackAttrs := map[string]any{}
			if t.DurationSeconds > 0 {
				trackAttrs["duration"] = t.DurationSeconds
			}
			trackNumber := number
			if trackNumber == "" && pos > 0 {
				trackNumber = strconv.Itoa(pos)
			}
			if _, err := s.importerSave(ctx, Entity{
				Kind:        "track",
				Title:       trackTitle,
				MediumID:    medium.ID,
				Number:      trackNumber,
				Position:    pos,
				Types:       []string{"track"},
				Attributes:  trackAttrs,
				ExternalIDs: map[string]string{},
				Contents:    []Inclusion{{ExpressionID: expressionID, Position: 0}},
			}, actor, note, sources); err != nil {
				return Entity{}, counts, err
			}
			counts.Tracks++
		}
	}
	return release, counts, nil
}

// buildReleaseTitle import 载荷可直接决定 release 标题；缺失时回退 work 标题。
func buildReleaseTitle(workTitle string, rel *ImporterReleasePreview) string {
	if rel != nil && strings.TrimSpace(rel.EditionName) != "" {
		return strings.TrimSpace(rel.EditionName)
	}
	return strings.TrimSpace(workTitle)
}

// Import 落库：work/artist 分支 + link_mode（new_work / append_release_to_work /
// create_relation / merge_translations 语义同前端：后者挂靠目标 work 只补发行链）。
func (s *Store) Import(ctx context.Context, req ImporterImportRequest, actor User) (ImporterImportResponse, error) {
	entityType, err := normalizeImporterEntityType(req.EntityType)
	if err != nil {
		entityType = "work"
	}
	source := strings.ToLower(strings.TrimSpace(req.Source))
	if source == "" {
		source = "bangumi"
	}
	if source != "bangumi" && source != "auto" {
		return ImporterImportResponse{}, fmt.Errorf("not_supported")
	}
	note, sources := importerEvidence(req, source)
	mode, err := normalizeImporterLinkMode(req.LinkMode)
	if err != nil {
		return ImporterImportResponse{}, err
	}
	if mode == "append_release_to_work" || mode == "merge_translations" {
		if strings.TrimSpace(req.TargetWorkID) == "" {
			return ImporterImportResponse{}, fmt.Errorf("invalid_payload")
		}
		target, gerr := s.Get(ctx, strings.TrimSpace(req.TargetWorkID), &actor)
		if gerr != nil || target.Kind != "work" {
			return ImporterImportResponse{}, fmt.Errorf("not_found")
		}
		workTitle := target.Title
		if req.Work != nil && strings.TrimSpace(req.Work.Title) != "" {
			workTitle = strings.TrimSpace(req.Work.Title)
		}
		release, counts, rerr := s.importReleaseChain(ctx, actor, note, sources, target.ID, buildReleaseTitle(workTitle, req.Release), req.CanonicalEntries, req.Release, req.Mediums)
		if rerr != nil {
			return ImporterImportResponse{}, rerr
		}
		return ImporterImportResponse{
			Success: true, EntityType: "work",
			WorkID: target.ID, ReleaseID: release.ID,
			Work: target, Release: release,
			ImportedCounts: counts,
			RedirectURL:    "/releases/" + release.ID,
		}, nil
	}
	if mode == "create_relation" {
		if strings.TrimSpace(req.TargetWorkID) == "" || strings.TrimSpace(req.RelationType) == "" || req.Work == nil {
			return ImporterImportResponse{}, fmt.Errorf("invalid_payload")
		}
		target, gerr := s.Get(ctx, strings.TrimSpace(req.TargetWorkID), &actor)
		if gerr != nil || target.Kind != "work" {
			return ImporterImportResponse{}, fmt.Errorf("not_found")
		}
		out, werr := s.importNewWork(ctx, actor, note, sources, source, req, entityType)
		if werr != nil {
			return ImporterImportResponse{}, werr
		}
		rel, rerr := s.SaveRelation(ctx, RelationEdit{
			Relation: Relation{Type: strings.TrimSpace(req.RelationType), SourceID: out.WorkID, TargetID: target.ID, Attributes: map[string]any{}},
			EditNote: note, Sources: sources,
		}, actor)
		if rerr != nil {
			return ImporterImportResponse{}, rerr
		}
		_ = rel
		out.RedirectURL = "/works/" + out.WorkID
		return out, nil
	}
	return s.importNewWork(ctx, actor, note, sources, source, req, entityType)
}

// importNewWork 新建 work（或 agent）并按需建发行链与演职员。
func (s *Store) importNewWork(ctx context.Context, actor User, note string, sources []Source, source string, req ImporterImportRequest, entityType string) (ImporterImportResponse, error) {
	if entityType != "work" {
		return s.importNewAgent(ctx, actor, note, sources, source, req, entityType)
	}
	if req.Work == nil {
		return ImporterImportResponse{}, fmt.Errorf("invalid_payload")
	}
	key, hasKey := importDedupKey(source, req, entityType)
	if hasKey {
		if existing, ok := s.findImported(ctx, key, &actor); ok && existing.Kind == "work" {
			return ImporterImportResponse{
				Success: true, EntityType: "work",
				WorkID:      existing.ID,
				Work:        existing,
				RedirectURL: "/works/" + existing.ID,
			}, nil
		}
	}
	workType := workTypeFromMetadata(req.Work.CatalogMetadata)
	work, err := buildWorkEntity(req.Work, workType, source, key, req.ExternalID, hasKey)
	if err != nil {
		return ImporterImportResponse{}, err
	}
	savedWork, err := s.importerSave(ctx, work, actor, note, sources)
	if err != nil {
		return ImporterImportResponse{}, err
	}
	out := ImporterImportResponse{
		Success: true, EntityType: "work",
		WorkID: savedWork.ID, Work: savedWork,
		RedirectURL: "/works/" + savedWork.ID,
	}
	counts := ImporterImportedCounts{}
	staffIDs := map[string]bool{}
	for _, assoc := range req.StaffAssociations {
		if strings.ToLower(strings.TrimSpace(assoc.Action)) == "skip" {
			continue
		}
		if strings.TrimSpace(assoc.TargetArtistID) != "" {
			if !staffIDs[assoc.TargetArtistID] {
				staffIDs[assoc.TargetArtistID] = true
			}
			continue
		}
		name := strings.TrimSpace(assoc.ParsedName)
		if name == "" {
			continue
		}
		agent, aerr := s.importerSave(ctx, Entity{
			Kind:             "agent",
			Title:            name,
			OriginalLanguage: originalLanguageOrEmpty(assoc.Country),
			Translations:     toEntityTranslations(assoc.Translations),
			Types:            []string{staffAgentType(assoc.EntityType)},
			Attributes:       map[string]any{},
			ExternalIDs:      stringScalarMap(assoc.ExternalIDs),
		}, actor, note, sources)
		if aerr != nil {
			return ImporterImportResponse{}, aerr
		}
		counts.Artists++
		staffIDs[agent.ID] = true
	}
	out.ImportedCounts.Artists = counts.Artists
	if len(req.Mediums) == 0 && len(req.CanonicalEntries) == 0 {
		return out, nil
	}
	if len(req.Mediums) == 0 {
		if err := s.importExpressionsOnly(ctx, actor, note, sources, savedWork.ID, req.CanonicalEntries); err != nil {
			return ImporterImportResponse{}, err
		}
		return out, nil
	}
	release, rcounts, rerr := s.importReleaseChain(ctx, actor, note, sources, savedWork.ID, req.Work.Title, req.CanonicalEntries, req.Release, req.Mediums)
	if rerr != nil {
		return ImporterImportResponse{}, rerr
	}
	rcounts.Artists = counts.Artists
	out.ReleaseID, out.Release = release.ID, release
	out.ImportedCounts = rcounts
	out.RedirectURL = "/releases/" + release.ID
	return out, nil
}

// importNewAgent 新建 agent（artist / organization / character）。
func (s *Store) importNewAgent(ctx context.Context, actor User, note string, sources []Source, source string, req ImporterImportRequest, entityType string) (ImporterImportResponse, error) {
	var a *ImporterArtistPreview
	var lang string
	switch {
	case req.Artist != nil:
		a = req.Artist
	case len(req.Artists) > 0:
		a = &req.Artists[0]
	}
	if a == nil {
		return ImporterImportResponse{}, fmt.Errorf("invalid_payload")
	}
	lang = a.Language
	key, hasKey := importDedupKey(source, req, entityType)
	if hasKey {
		if existing, ok := s.findImported(ctx, key, &actor); ok && existing.Kind == "agent" {
			return ImporterImportResponse{
				Success: true, EntityType: entityType,
				ArtistID: existing.ID, Artist: existing,
				RedirectURL: "/artists/" + existing.ID,
			}, nil
		}
	}
	agent, err := buildAgentEntity(a.Name, a.OriginalName, a.Biography, a.AvatarURL, lang, entityType, a.Translations, a.ExternalIDs, key, hasKey)
	if err != nil {
		return ImporterImportResponse{}, err
	}
	if et := agentTypeForPreviewValue(a.EntityType); et == "character" {
		agent.Types = []string{"character"}
		entityType = "character"
	}
	saved, serr := s.importerSave(ctx, agent, actor, note, sources)
	if serr != nil {
		return ImporterImportResponse{}, serr
	}
	return ImporterImportResponse{
		Success: true, EntityType: entityType,
		ArtistID: saved.ID, Artist: saved,
		ImportedCounts: ImporterImportedCounts{Artists: 1},
		RedirectURL:    "/artists/" + saved.ID,
	}, nil
}
