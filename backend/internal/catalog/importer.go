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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
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
	// Fields 是按 infobox 映射出的动态字段值（键为已声明的字段码）；
	// Infobox 是上游资料表的完整原文快照，用于追溯与后续补充映射。
	Fields  map[string]any   `json:"fields,omitempty"`
	Infobox []map[string]any `json:"infobox,omitempty"`
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
	// RelationType 是该关联应落到 definitions 的关系码（如 directed_by / voiced_by / character_in）；
	// RelationRole 是角色番位的词表项（primary/supplement/extra，用于 character_in）。
	RelationType string `json:"relation_type,omitempty"`
	RelationRole string `json:"relation_role,omitempty"`
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
	Language       string                    `json:"language,omitempty"`
	AvatarURL      string                    `json:"avatar_url,omitempty"`
	ExternalIDs    map[string]any            `json:"external_ids,omitempty"`
	Translations   []ImporterTranslationItem `json:"translations,omitempty"`
	RelationType   string                    `json:"relation_type,omitempty"`
	RelationRole   string                    `json:"relation_role,omitempty"`
}

type ImporterTrackPreview struct {
	Position        int     `json:"position"`
	Title           string  `json:"title"`
	DurationSeconds float64 `json:"duration_seconds"`
	ArtistCredit    string  `json:"artist_credit,omitempty"`
	ISRC            string  `json:"isrc,omitempty"`
	RecordingMBID   string  `json:"recording_mbid,omitempty"`
	// ExpressionID 显式复用的既有表达（用户在预览中手工匹配的录音），
	// 优先于自动对齐；校验必须属于同一 Work。
	ExpressionID string `json:"expression_id,omitempty"`
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
	// EntryKind 条目落库层级："content_unit"（篇目/分集，可带下级）或
	// "expression"（默认，录音/正文）。由来源结构决定，不由标题猜测。
	EntryKind string `json:"entry_kind,omitempty"`
	// ParentIndex 指向同一 canonical_entries 数组内父级条目的下标（-1/省略为顶层），
	// 用于表达章节树；仅在同 Work 内成立。
	ParentIndex *int `json:"parent_index,omitempty"`
	// ExpressionID 显式指定复用的既有表达（用户在预览中手工匹配），
	// 优先于自动对齐；校验必须存在、可见且属于同一 Work。
	ExpressionID string `json:"expression_id,omitempty"`
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
	// Warnings 记录来源抓取不完整等需要人工留意的情况（如分集总数与实取不符），
	// 前端据此提示，避免把不完整预览当成完整清单落库。
	Warnings []string `json:"warnings,omitempty"`
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
	Artists          int `json:"artists"`
	Relations        int `json:"relations"`
	SkippedRelations int `json:"skipped_relations"`
	Mediums          int `json:"mediums"`
	Tracks           int `json:"tracks"`
	ContentUnits     int `json:"content_units"`
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
	ID       int               `json:"id"`
	Type     int               `json:"type"`
	Name     string            `json:"name"`
	NameCN   string            `json:"name_cn"`
	Summary  string            `json:"summary"`
	Date     string            `json:"date"`
	Platform string            `json:"platform"`
	Images   bangumiImages     `json:"images"`
	Tags     []bangumiTag      `json:"tags"`
	Infobox  []bangumiInfoItem `json:"infobox"`
}

// bangumiInfoItem 是 Bangumi infobox 的一行。value 既可能是标量字符串，
// 也可能是 [{"v":"..."}] 形式的别名/版本列表（键名 k/v 或仅 v）。
type bangumiInfoItem struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

// bangumiEpisode 是 /v0/episodes 的一条（分集/篇目）。
type bangumiEpisode struct {
	ID      int    `json:"id"`
	Type    int    `json:"type"`
	Name    string `json:"name"`
	NameCN  string `json:"name_cn"`
	Sort    float64 `json:"sort"`
	Ep      float64 `json:"ep"`
	Airdate string `json:"airdate"`
	Duration string `json:"duration"`
}

// bangumiEpisodesResponse 是 /v0/episodes 的响应体（分页）。
type bangumiEpisodesResponse struct {
	Data  []bangumiEpisode `json:"data"`
	Total int              `json:"total"`
}

// infoboxStrings 把某键的值统一摊平为字符串列表；缺失返回空。
func (s bangumiSubject) infoboxStrings(key string) []string {
	for _, item := range s.Infobox {
		if strings.TrimSpace(item.Key) != key {
			continue
		}
		var single string
		if err := json.Unmarshal(item.Value, &single); err == nil {
			if v := strings.TrimSpace(single); v != "" {
				return []string{v}
			}
			return nil
		}
		var list []map[string]any
		if err := json.Unmarshal(item.Value, &list); err != nil {
			return nil
		}
		out := []string{}
		for _, m := range list {
			for _, k := range []string{"v", "value"} {
				if v, ok := m[k].(string); ok {
					if v = strings.TrimSpace(v); v != "" {
						out = append(out, v)
						break
					}
				}
			}
		}
		return out
	}
	return nil
}

// infoboxString 取某键的首个字符串值。
func (s bangumiSubject) infoboxString(key string) string {
	if v := s.infoboxStrings(key); len(v) > 0 {
		return v[0]
	}
	return ""
}

// bangumiInfoboxAliases 取"别名"行并去掉与主标题重复的项。
func (s bangumiSubject) bangumiInfoboxAliases(title, original string) []string {
	out := []string{}
	for _, v := range s.infoboxStrings("别名") {
		if v == title || v == original {
			continue
		}
		out = append(out, v)
	}
	return out
}

// infoboxFieldKeys 把 infobox 的（多语言）键名映射到已声明的动态字段码。
// 一个字段码可有多个上游键名；取第一个有值的。全部字段码都在 defaults.go 中声明，
// 因此不会写入未声明属性被校验拒绝。kind 决定取值归一化方式：上游数字/日期是
// 自由文本（如「13」「24(22+2)卷完结」「2023年6月29日」），直接落库会被
// invalid_number / invalid_date 拒绝。
var infoboxFieldKeys = []struct {
	field string
	kind  string
	keys  []string
}{
	{"episodes", "number", []string{"话数", "集数", "話數"}},
	{"volume_count", "number", []string{"册数", "卷数", "冊數", "巻数"}},
	{"broadcast_start", "date", []string{"放送开始", "放送開始", "开始"}},
	{"broadcast_weekday", "text", []string{"放送星期", "放送日"}},
	{"broadcast_end", "date", []string{"放送结束", "放送結束", "播放结束"}},
	{"air_network", "text", []string{"播放电视台", "放送局", "播放电视台"}},
	{"copyright", "text", []string{"Copyright", "©"}},
	{"isbn", "text", []string{"ISBN"}},
	{"author", "text", []string{"作者"}},
	{"magazine", "text", []string{"连载杂志", "連載雜誌"}},
	{"publisher_name", "text", []string{"出版社"}},
	{"imdb", "text", []string{"IMDb", "IMDB", "imdb"}},
	{"platform", "text", []string{"平台"}},
}

var (
	// 数字字段：取首个整数片段，「24(22+2)卷完结」→24。
	infoboxIntRE = regexp.MustCompile(`\d+`)
	// 日期字段：支持 2023-06-29 / 2023/6/29 / 2023年6月29日，可只到月或年。
	infoboxDateRE = regexp.MustCompile(`(\d{4})\s*[-/年.]?\s*(\d{1,2})?\s*[-/月.]?\s*(\d{1,2})?`)
)

// normalizeInfoboxValue 把上游原文归一化为字段类型可接受的值；无法解析时
// 返回 nil（丢弃该字段，但原文仍在 infobox 全量快照中可追溯）。
func normalizeInfoboxValue(raw, kind string) any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	switch kind {
	case "number":
		if m := infoboxIntRE.FindString(raw); m != "" {
			if n, err := strconv.Atoi(m); err == nil {
				return n
			}
		}
		return nil
	case "date":
		m := infoboxDateRE.FindStringSubmatch(raw)
		if m == nil {
			return nil
		}
		year := m[1]
		if m[2] == "" {
			return year
		}
		month := m[2]
		if len(month) == 1 {
			month = "0" + month
		}
		if m[3] == "" {
			return year + "-" + month
		}
		day := m[3]
		if len(day) == 1 {
			day = "0" + day
		}
		return year + "-" + month + "-" + day
	}
	return raw
}

// infoboxEntries 把上游 infobox 完整摊平为键值原文列表（保序、去空）。
// 这是"全量落库"的载体：即便某键尚未映射为一等字段，原文也留在实体上可追溯。
func (s bangumiSubject) infoboxEntries() []map[string]any {
	out := []map[string]any{}
	for _, item := range s.Infobox {
		key := strings.TrimSpace(item.Key)
		if key == "" {
			continue
		}
		vals := s.infoboxStrings(key)
		// 单值行也可能是标量字符串，infoboxStrings 已统一处理；逐行拆成
		// 独立的 key/value 对，保持原始顺序与重复行。
		for _, v := range vals {
			if v = strings.TrimSpace(v); v == "" {
				continue
			}
			out = append(out, map[string]any{"key": key, "value": v})
		}
	}
	return out
}

// infoboxValues 收集映射表中所有字段的值，只返回有值的键（已按字段类型归一化）。
func (s bangumiSubject) infoboxValues() map[string]any {
	out := map[string]any{}
	for _, m := range infoboxFieldKeys {
		for _, k := range m.keys {
			if v := s.infoboxString(k); v != "" {
				if nv := normalizeInfoboxValue(v, m.kind); nv != nil {
					out[m.field] = nv
				}
				break
			}
		}
	}
	return out
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
	Gender  *string       `json:"gender"`
	Summary string        `json:"summary"`
	Images  bangumiImages `json:"images"`
}

// /v0/subjects/{id}/persons：条目关联的演职人员（含公司/团体，type 2/3）。
type bangumiSubjectPerson struct {
	ID       int           `json:"id"`
	Name     string        `json:"name"`
	Type     int           `json:"type"`
	Relation string        `json:"relation"`
	Career   []string      `json:"career"`
	Images   bangumiImages `json:"images"`
}

// /v0/subjects/{id}/characters：条目关联角色，actors 为其声优（可多个）。
type bangumiSubjectCharacter struct {
	ID       int                   `json:"id"`
	Name     string                `json:"name"`
	Type     int                   `json:"type"`
	Relation string                `json:"relation"`
	Summary  string                `json:"summary"`
	Images   bangumiImages         `json:"images"`
	Actors   []bangumiSubjectActor `json:"actors"`
}

type bangumiSubjectActor struct {
	ID       int           `json:"id"`
	Name     string        `json:"name"`
	Type     int           `json:"type"`
	Career   []string      `json:"career"`
	Images   bangumiImages `json:"images"`
	Locked   bool          `json:"locked"`
	Summary  string        `json:"short_summary"`
}

// bangumiCreditRelation 把 Bangumi 的 relation 中文职位文本映射到 definitions 关系码。
// 返回空表示没有贴切的既有关系码：调用方仍建 agent 实体并把原始职位写进
// credit_role，而不是硬塞一个语义不符的关系码（不虚构）。
func bangumiCreditRelation(relation string) string {
	r := strings.TrimSpace(relation)
	switch {
	// 摄影/作画等复合职位要先于"监督/导演"判断，否则"摄影监督"会被
	// 更宽的"监督"规则抢先命中成 directed_by。
	case containsAny(r, "摄影", "攝影"):
		return "photographed_by"
	case containsAny(r, "作画", "作畫", "人物原案", "人物设定", "角色设计", "キャラクターデザイン", "插画", "插畫"):
		return "illustrated_by"
	case containsAny(r, "导演", "監督", "监督", "演出"):
		return "directed_by"
	case containsAny(r, "脚本", "编剧", "系列构成", "劇本"):
		return "written_by"
	case containsAny(r, "作词", "作詞"):
		return "lyricist_of"
	case containsAny(r, "作曲", "編曲", "编曲"):
		return "composed_by"
	case containsAny(r, "旁白", "ナレーション", "朗读", "朗読"):
		return "narrated_by"
	case containsAny(r, "配音", "声优", "声優", "CV"):
		return "voiced_by"
	}
	return ""
}

// bangumiAvatarURL 从 images 里取最佳头像（large→common→medium→grid→small）。
func bangumiAvatarURL(im bangumiImages) string {
	return im.best()
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if sub != "" && strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// bangumiPersonTypeAgent 把 /subjects/{id}/persons 的 type 映射到 agent 类型。
// 1=个人 2=公司 3=组合；其余保守按个人。
func bangumiPersonTypeAgent(t int) string {
	switch t {
	case 2:
		return "organization"
	case 3:
		return "group"
	default:
		return "person"
	}
}

// bangumiCharacterRankRole 把角色 relation 映射到 role 词表项。
// 主角=primary、配角=supplement、客串/闲角=extra，其余为空（不虚构番位）。
func bangumiCharacterRankRole(relation string) string {
	r := strings.TrimSpace(relation)
	switch {
	case containsAny(r, "主角", "主人公"):
		return "primary"
	case containsAny(r, "配角", "配角", "副角"):
		return "supplement"
	case containsAny(r, "客串", "闲角", "閑角", "路人"):
		return "extra"
	}
	return ""
}

// bangumiOrgSelfDescription 匹配"条目自述为公司/企业"的高精度模式。
// 经 116 条真实数据校准：零误判（不会把"某某所属"的声优误判为公司），
// 用于纠正 Bangumi 把企业 person 条目标成 type=1（个人）的情况。
var bangumiOrgSelfDescription = regexp.MustCompile(
	`^(株式会社|有限会社|合同会社)\S{1,40}(は|が)[、,。]` + // 日：株式会社Xは、…企業。
		`|を主な事業内容とする` + // 日：…を主な事業内容とする
		`|(企業|会社|法人)である` + // 日：…企業である
		`|(是一家|是日本一家|一家).{0,30}(公司|企业)` + // 中：…(是)一家…公司
		`|专门从事.{0,20}(公司|企业)`)

// bangumiPersonAgentType 判定 person 条目的 agent 类型。
// 上游 type 为权威：2=公司、3=组合；type=1（个人）时再用自述文本纠正
// （Bangumi 有把企业标成个人的数据，如 ブシロード）。
func bangumiPersonAgentType(typeID int, summary string) string {
	switch typeID {
	case 2:
		return "organization"
	case 3:
		return "group"
	}
	if bangumiOrgSelfDescription.MatchString(summary) {
		return "organization"
	}
	return "person"
}

// detectEntityLanguage 从名称与简介推断原语言。假名是日文的可靠信号，
// 标题无信号时看简介（来源原文，同为证据）；都无信号则留空不猜。
func detectEntityLanguage(name, summary string) string {
	if l := detectJapaneseScript(name); l != "" {
		return l
	}
	return detectJapaneseScript(summary)
}

// fetchBangumiPersonDetails 并发拉取 person 详情（含简介），带并发上限与失败降级。
// 列表端点不返回简介，只有详情端点有；失败/超时的条目在返回 map 中缺失，调用方降级。
func fetchBangumiPersonDetails(ctx context.Context, ids []int) map[int]bangumiPerson {
	out := map[int]bangumiPerson{}
	if len(ids) == 0 {
		return out
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8) // 并发上限：避免打爆上游与拖长导入
	for _, id := range ids {
		wg.Add(1)
		go func(pid int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var p bangumiPerson
			if err := fetchBangumi(ctx, "/v0/persons/"+strconv.Itoa(pid), &p); err != nil {
				return // 降级：调用方用列表里的简化数据
			}
			mu.Lock()
			out[pid] = p
			mu.Unlock()
		}(id)
	}
	wg.Wait()
	return out
}

// previewBangumiSubjectRelations 拉取条目的关联演职人员与角色，组装为可导入的
// agent 预览（两层以内关联实体）。任一端点失败只返回已取到的部分——关联数据
// 是增强项，不应让主条目导入失败。
func previewBangumiSubjectRelations(ctx context.Context, subjectID int) []ImporterArtistPreview {
	out := []ImporterArtistPreview{}

	var persons []bangumiSubjectPerson
	var chars []bangumiSubjectCharacter
	pErr := fetchBangumi(ctx, "/v0/subjects/"+strconv.Itoa(subjectID)+"/persons", &persons)
	cErr := fetchBangumi(ctx, "/v0/subjects/"+strconv.Itoa(subjectID)+"/characters", &chars)

	// 列表端点不含简介，而简介既是展示内容、也是"企业被误标为个人"的纠正依据、
	// 还是推断原语言的证据；因此并发拉取一次详情（失败则降级用列表数据）。
	personIDs := map[int]bool{}
	if pErr == nil {
		for _, p := range persons {
			personIDs[p.ID] = true
		}
	}
	if cErr == nil {
		for _, c := range chars {
			for _, a := range c.Actors {
				personIDs[a.ID] = true
			}
		}
	}
	ids := make([]int, 0, len(personIDs))
	for id := range personIDs {
		ids = append(ids, id)
	}
	details := fetchBangumiPersonDetails(ctx, ids)

	if pErr == nil {
		for _, p := range persons {
			name := strings.TrimSpace(p.Name)
			if name == "" {
				continue
			}
			role := strings.TrimSpace(p.Relation)
			// 语义明确时用精确关系码；否则落到通用署名关系并保留职位原文，
			// 避免有职位却无关系（实体成孤儿）导致关联信息丢失。
			rel := bangumiCreditRelation(role)
			if rel == "" && role != "" {
				rel = "credit_for"
			}
			// 详情里的 type/summary 更权威：摘要能纠正被误标成个人的企业。
			agentType := bangumiPersonTypeAgent(p.Type)
			biography := ""
			if d, ok := details[p.ID]; ok {
				agentType = bangumiPersonAgentType(d.Type.ID, d.Summary)
				biography = strings.TrimSpace(d.Summary)
			}
			out = append(out, ImporterArtistPreview{
				Name:         name,
				OriginalName: name,
				Role:         role,
				EntityType:   agentType,
				Biography:    biography,
				Language:     detectEntityLanguage(name, biography),
				AvatarURL:    bangumiAvatarURL(p.Images),
				ExternalIDs:  map[string]any{"bangumi_person": p.ID, "metafusion_import": "bangumi:person:" + strconv.Itoa(p.ID)},
				// 职位文本保真：语义明确时给关系码，否则由 credit_role 承载原文。
				RelationType: rel,
			})
		}
	}

	if cErr == nil {
		for _, c := range chars {
			name := strings.TrimSpace(c.Name)
			if name == "" {
				continue
			}
			rank := strings.TrimSpace(c.Relation)
			// 角色本体：character_in → 作品。番位词表项（主角/配角/客串）进 relation_role，
			// 原始文本（含"旁白""闲角"等词表未覆盖的）一律进 credit_role 保证无损。
			out = append(out, ImporterArtistPreview{
				Name:         name,
				OriginalName: name,
				Role:         rank,
				EntityType:   bangumiCharacterAgentType(nil, c.Summary),
				Biography:    strings.TrimSpace(c.Summary),
				Language:     detectEntityLanguage(name, c.Summary),
				AvatarURL:    bangumiAvatarURL(c.Images),
				ExternalIDs:  map[string]any{"bangumi_character": c.ID, "metafusion_import": "bangumi:character:" + strconv.Itoa(c.ID)},
				RelationType: "character_in",
				RelationRole: bangumiCharacterRankRole(rank),
			})
			// 声优：voiced_by → 作品，attributes.character 指向角色名（旧前端据此配对）。
			for _, a := range c.Actors {
				an := strings.TrimSpace(a.Name)
				if an == "" {
					continue
				}
				agentType := bangumiPersonTypeAgent(a.Type)
				biography := ""
				if d, ok := details[a.ID]; ok {
					agentType = bangumiPersonAgentType(d.Type.ID, d.Summary)
					biography = strings.TrimSpace(d.Summary)
				}
				out = append(out, ImporterArtistPreview{
					Name:          an,
					OriginalName:  an,
					Role:          "配音",
					EntityType:    agentType,
					Biography:     biography,
					Language:      detectEntityLanguage(an, biography),
					AvatarURL:     bangumiAvatarURL(a.Images),
					CharacterName: name,
					ExternalIDs:   map[string]any{"bangumi_person": a.ID, "metafusion_import": "bangumi:person:" + strconv.Itoa(a.ID)},
					RelationType:  "voiced_by",
				})
			}
		}
	}
	return out
}

// bangumiBandPattern 匹配简介中的乐队/组合类关键词；\b 限定英文 band 独立成词，
// 避免 husband 等误命中。
var bangumiBandPattern = regexp.MustCompile(`乐队|樂隊|バンド|\bband\b`)

// bangumiCharacterAgentType 把 Bangumi "角色"条目收敛到 agent 定义类型。
// Bangumi 把乐队/组合等虚构团体也挂在角色列表（如 MyGO!!!!! 是 subject 428735
// 角色表里的"配角"），API 没有类型字段；保守启发：无性别信息且简介含
// 乐队/band 类关键词才判 group，其余保持 character。误判可在后台编辑器改类型。
func bangumiCharacterAgentType(gender *string, summary string) string {
	if gender != nil && strings.TrimSpace(*gender) != "" {
		return "character"
	}
	if bangumiBandPattern.MatchString(strings.ToLower(summary)) {
		return "group"
	}
	return "character"
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

// bangumiEpisodeType 判定分集类型：0=本篇、1=SP、2=OP、3=ED、4=预告/其他。
// 本篇走 content_unit，其余作为附加内容同样保留层级，但标 entry_role。
func bangumiEpisodeRole(epType int) string {
	switch epType {
	case 0:
		return "main"
	case 2, 3:
		return "opening"
	case 4:
		return "trailer"
	default:
		return "extra"
	}
}

// bangumiDurationSeconds 把 "24m" / "1h2m" / "300" 之类的时长解析为秒；无信号返回 0。
func bangumiDurationSeconds(raw string) float64 {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return 0
	}
	var total float64
	var num strings.Builder
	flush := func(unit string) {
		if num.Len() == 0 {
			return
		}
		v, err := strconv.ParseFloat(num.String(), 64)
		num.Reset()
		if err != nil {
			return
		}
		switch unit {
		case "h":
			total += v * 3600
		case "m":
			total += v * 60
		default:
			total += v
		}
	}
	for _, ch := range s {
		switch {
		case ch >= '0' && ch <= '9' || ch == '.':
			num.WriteRune(ch)
		case ch == 'h' || ch == 'm' || ch == 's':
			flush(string(ch))
		case ch == ' ':
			// 忽略分隔
		default:
			// 未知单位：丢弃当前数字段，避免把 "24分" 误当秒
			num.Reset()
		}
	}
	flush("s")
	return total
}

// previewBangumiEpisodes 取分集列表并转换成 canonical entries（带 parent_index 树）。
// 篇目类型（本篇）落 content_unit 且可挂下级；SP/OP/ED 等作为附加内容平铺。
// 分集无名称时用"第N话"补齐（有来源编号，非虚构题名）。
// bangumiEpisodeTypes 是 Bangumi 分集端点的 type 取值：0 本篇、1 特别篇、2 OP、
// 3 ED、4 预告/宣传、5 MAD、6 其它。固定 type=0 会漏掉 SP/OP/ED 等，因此逐个抓取。
var bangumiEpisodeTypes = []int{0, 1, 2, 3, 4, 5, 6}

// previewBangumiEpisodes 抓取某条目的分集/篇目。遍历全部 type 并按 episode ID 去重
// （同一 episode 只落一条，role 由 bangumiEpisodeRole 依 type 决定），
// 某类抓取失败只跳过该类，不使整体失败。返回值第二项为抓取不完整时的告警。
func previewBangumiEpisodes(ctx context.Context, subjectID int) ([]ImporterCanonicalEntryPreview, []string) {
	out := []ImporterCanonicalEntryPreview{}
	warnings := []string{}
	seen := map[int]bool{}
	for _, epType := range bangumiEpisodeTypes {
		limit, offset := 100, 0
		fetched := 0
		expected := -1
		failed := false
		for {
			var resp bangumiEpisodesResponse
			path := "/v0/episodes?subject_id=" + strconv.Itoa(subjectID) + "&type=" + strconv.Itoa(epType) + "&limit=" + strconv.Itoa(limit) + "&offset=" + strconv.Itoa(offset)
			if err := fetchBangumi(ctx, path, &resp); err != nil {
				failed = true
				break
			}
			if expected < 0 {
				expected = resp.Total
			}
			if len(resp.Data) == 0 {
				break
			}
			for i, ep := range resp.Data {
				if seen[ep.ID] {
					continue
				}
				title := strings.TrimSpace(ep.NameCN)
				if title == "" {
					title = strings.TrimSpace(ep.Name)
				}
				number := ""
				if ep.Ep > 0 {
					number = strconv.FormatFloat(ep.Ep, 'f', -1, 64)
				} else if ep.Sort > 0 {
					number = strconv.FormatFloat(ep.Sort, 'f', -1, 64)
				}
				if title == "" {
					if number == "" {
						continue
					}
					title = "第" + number + "话"
				}
				pos := int(ep.Sort)
				if pos <= 0 {
					pos = offset + i + 1
				}
				entry := ImporterCanonicalEntryPreview{
					Title:           title,
					Translations:    bangumiTranslationItems(ep.Name, ep.NameCN, ""),
					Position:        pos,
					Number:          number,
					EntryRole:       bangumiEpisodeRole(ep.Type),
					EntryKind:       "content_unit",
					DurationSeconds: bangumiDurationSeconds(ep.Duration),
					ExternalIDs:     map[string]any{"bangumi_episode": ep.ID},
				}
				if strings.TrimSpace(ep.NameCN) != "" && strings.TrimSpace(ep.Name) != "" && ep.NameCN != ep.Name {
					entry.OriginalLanguage = detectJapaneseScript(ep.Name)
				}
				seen[ep.ID] = true
				fetched++
				out = append(out, entry)
			}
			if len(resp.Data) < limit {
				break
			}
			offset += limit
		}
		// 抓取数量与来源声明的 total 不符（含中途失败）→ 明确告警，不静默当作完整。
		if failed || (expected >= 0 && fetched < expected) {
			warnings = append(warnings, "bangumi_episodes_incomplete:type="+strconv.Itoa(epType))
		}
	}
	return out, warnings
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
	// 原语言推断：以官方原名（name）的语言为准，含假名可判定日文；
	// 标题无可判定信号时，退一步看来源简介（同样是来源原文，仍属证据而非猜测）。
	// 两者都无线索时留空（不虚构），展示回退链仍可工作。
	origLang := detectJapaneseScript(sub.Name)
	if origLang == "" {
		origLang = detectJapaneseScript(sub.Summary)
	}
	// infobox 补充官方字段：官网、品番、别名、出版社等（键名随媒体类型不同）。
	aliases := sub.bangumiInfoboxAliases(title, original)
	website := firstNonEmpty(sub.infoboxString("官方网站"), sub.infoboxString("官方網站"), sub.infoboxString("官网"))
	catalogNo := firstNonEmpty(sub.infoboxString("商品编号"), sub.infoboxString("商品編號"), sub.infoboxString("品番"))
	canonicalEntries, warnings := previewBangumiEpisodes(ctx, sub.ID)
	return ImporterPreviewResponse{
		Source:      source,
		EntityType:  "work",
		ExternalID:  strconv.Itoa(sub.ID),
		ExternalURL: "https://bgm.tv/subject/" + strconv.Itoa(sub.ID),
		MediaType:   mediaType,
		Work: &ImporterWorkPreview{
			Title:            title,
			OriginalTitle:    original,
			Aliases:          aliases,
			ReleaseDate:      strings.TrimSpace(sub.Date),
			Language:         origLang,
			OriginalLanguage: origLang,
			Summary:          sub.Summary,
			CoverImageURL:    sub.Images.best(),
			Tags:             tags,
			Translations:     bangumiTranslationItems(sub.Name, sub.NameCN, sub.Summary),
			CatalogMetadata: map[string]any{
				"bangumi_type":     sub.Type,
				"bangumi_platform": sub.Platform,
				"official_website": website,
				"catalog_number":   catalogNo,
			},
			Fields:  sub.infoboxValues(),
			Infobox: sub.infoboxEntries(),
		},
		Tags: tags,
		// 两层以内的关联演职人员与角色：前端把 artists 转成 staff_associations 提交，
		// 落库时建 agent 实体并把关系挂到作品上。
		Artists: previewBangumiSubjectRelations(ctx, sub.ID),
		// 分集/篇目：动画、剧集类条目有独立分集端点，落 content_unit 树；
		// 无分集（音乐/书籍等）时为空，前端不展示内容区，不用空数组造假。
		CanonicalEntries: canonicalEntries,
		Warnings:         warnings,
	}, nil
}

// firstNonEmpty 返回第一个非空字符串。
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

// scalarString 宽松取标量字符串值（属性经 JSON 往返后形态不定）。
func scalarString(v any) string {
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(x))
	}
}

// toAnySlice 把类型化切片转成 []any，以便作为 JSONB 值参与属性校验与落库。
func toAnySlice[T any](in []T) []any {
	out := make([]any, len(in))
	for i, v := range in {
		out[i] = v
	}
	return out
}

// dynamicFieldValue 判断动态字段值是否可落库，并保持原类型。
// 数值/日期字段由规格校验按类型判定，因此不能像文本那样统一转成字符串，
// 否则合法整数会被 stringify 成 "13" 而被 invalid_number 拒绝。
func dynamicFieldValue(v any) (any, bool) {
	switch x := v.(type) {
	case nil:
		return nil, false
	case string:
		if strings.TrimSpace(x) == "" {
			return nil, false
		}
		return strings.TrimSpace(x), true
	case []any:
		if len(x) == 0 {
			return nil, false
		}
		return x, true
	default:
		return v, true
	}
}

// detectJapaneseScript 用假名判定日文原文（假名是日文的可靠信号）。
// 纯汉字/拉丁文本存在简繁歧义，返回空而不猜，避免给条目写错原语言。
func detectJapaneseScript(s string) string {
	for _, r := range s {
		// 平假名 3040-309F、片假名 30A0-30FF（含半角片假名 FF66-FF9D 另计）
		if (r >= 0x3040 && r <= 0x30FF) || (r >= 0xFF66 && r <= 0xFF9D) {
			return "ja"
		}
	}
	return ""
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
	// 顶层 EntityType 保持 character：预览→导入回传与 dedup key 都以 URL 推断为准；
	// 乐队型条目的类型细化落在 Artist.EntityType，导入侧据此建 group agent。
	agentType := bangumiCharacterAgentType(ch.Gender, ch.Summary)
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
			EntityType:   agentType,
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

// importerTranslationsFromAny 归一化 canonical entry / 载体预览里的 translations：
// JSON 往返后可能是 []{locale,title,summary} 数组，也可能是 {locale:{title,summary}} 映射；
// 两种形态都收敛为 Entity.Translations，非法 locale 与空标题丢弃。
func importerTranslationsFromAny(v any) map[string]Translation {
	out := map[string]Translation{}
	add := func(loc, title, summary string) {
		loc = strings.TrimSpace(loc)
		title = strings.TrimSpace(title)
		if loc == "" || title == "" {
			return
		}
		if _, err := language.Parse(loc); err != nil {
			return
		}
		if _, exists := out[loc]; exists {
			return
		}
		out[loc] = Translation{Title: title, Summary: summary}
	}
	switch x := v.(type) {
	case nil:
		return out
	case []ImporterTranslationItem:
		for _, it := range x {
			add(it.Locale, it.Title, it.Summary)
		}
	case []any:
		for _, raw := range x {
			if m, ok := raw.(map[string]any); ok {
				add(scalarString(m["locale"]), scalarString(m["title"]), scalarString(m["summary"]))
			}
		}
	case map[string]any:
		for loc, raw := range x {
			switch e := raw.(type) {
			case map[string]any:
				add(loc, scalarString(e["title"]), scalarString(e["summary"]))
			case string:
				add(loc, e, "")
			}
		}
	case map[string]Translation:
		for loc, tr := range x {
			add(loc, tr.Title, tr.Summary)
		}
	}
	return out
}

// importerContentUnitIndex 索引既有篇目，供导入复用。以外部标识（如 bangumi_episode）
// 为第一身份；无来源 ID 时用 (父篇目, 规范化标题) 作键——不再整 Work 按标题去重，
// 否则"上篇/第一章"与"下篇/第一章"会被误并。编号键只在**无 entry_role** 的条目间
// 生效：本篇与 OP/ED 的集数各自从 1 起算，同父同号不同 role 会被误并（entry_role
// 未持久化，无法对既有篇目取 role，故带 role 的条目只按外部 ID/标题复用）。
type importerContentUnitIndex struct {
	byExternal map[string]string // 外部标识键 -> unit id
	byParentTitle map[string]string
	byParentNumber map[string]string
}

func newImporterContentUnitIndex(units []Entity) *importerContentUnitIndex {
	idx := &importerContentUnitIndex{byExternal: map[string]string{}, byParentTitle: map[string]string{}, byParentNumber: map[string]string{}}
	for _, u := range units {
		for k, v := range u.ExternalIDs {
			if v = strings.TrimSpace(v); v != "" {
				idx.byExternal[strings.ToLower(k)+"|"+strings.ToLower(v)] = u.ID
			}
		}
		if tk := normalizeImporterTitleKey(u.Title); tk != "" {
			key := u.ParentID + "\x00" + tk
			if _, ok := idx.byParentTitle[key]; !ok {
				idx.byParentTitle[key] = u.ID
			}
		}
		if num := strings.TrimSpace(u.Number); num != "" {
			key := u.ParentID + "\x00" + num
			if _, ok := idx.byParentNumber[key]; !ok {
				idx.byParentNumber[key] = u.ID
			}
		}
	}
	return idx
}

// lookup 按来源 ID → (父, 标题) → (父, 编号，仅无 role 条目) 依次匹配既有篇目。
func (x *importerContentUnitIndex) lookup(ce ImporterCanonicalEntryPreview, parentID string) (string, bool) {
	for k, v := range stringScalarMap(ce.ExternalIDs) {
		if v = strings.TrimSpace(v); v == "" {
			continue
		}
		if id, ok := x.byExternal[strings.ToLower(k)+"|"+strings.ToLower(v)]; ok {
			return id, true
		}
	}
	if tk := normalizeImporterTitleKey(ce.Title); tk != "" {
		if id, ok := x.byParentTitle[parentID+"\x00"+tk]; ok {
			return id, true
		}
	}
	if num := strings.TrimSpace(ce.Number); num != "" && strings.TrimSpace(ce.EntryRole) == "" {
		if id, ok := x.byParentNumber[parentID+"\x00"+num]; ok {
			return id, true
		}
	}
	return "", false
}

func (x *importerContentUnitIndex) remember(ce ImporterCanonicalEntryPreview, parentID, id string) {
	for k, v := range stringScalarMap(ce.ExternalIDs) {
		if v = strings.TrimSpace(v); v != "" {
			x.byExternal[strings.ToLower(k)+"|"+strings.ToLower(v)] = id
		}
	}
	if tk := normalizeImporterTitleKey(ce.Title); tk != "" {
		key := parentID + "\x00" + tk
		if _, ok := x.byParentTitle[key]; !ok {
			x.byParentTitle[key] = id
		}
	}
	if num := strings.TrimSpace(ce.Number); num != "" && strings.TrimSpace(ce.EntryRole) == "" {
		key := parentID + "\x00" + num
		if _, ok := x.byParentNumber[key]; !ok {
			x.byParentNumber[key] = id
		}
	}
}

// validateImporterEntryTree 校验 canonical entries 的 parent_index：只允许指向
// **前面**的条目（顺序即拓扑序，先父后子）。越界、负数、自指、指向后继都报错，
// 不再静默把节点降为顶层（那会丢失层级且无告警）。
func validateImporterEntryTree(entries []ImporterCanonicalEntryPreview) error {
	for i, ce := range entries {
		if ce.ParentIndex == nil {
			continue
		}
		idx := *ce.ParentIndex
		if idx < 0 {
			continue // -1 表示顶层，合法
		}
		if idx >= len(entries) {
			return fmt.Errorf("invalid_parent_index")
		}
		if idx >= i {
			// 指向自身或后继：顺序不构成有效拓扑序（先子后父）。
			return fmt.Errorf("invalid_parent_index")
		}
		if strings.TrimSpace(entries[idx].EntryKind) != "content_unit" {
			return fmt.Errorf("invalid_parent_index")
		}
	}
	return nil
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
// int/int64 也收录：预览 DTO 以 Go 结构体构造时 ID 是 int，
// 若只认 float64 会静默丢弃外部 ID（JSON 往返场景才会变成 float64）。
func stringScalarMap(in map[string]any) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		switch x := v.(type) {
		case string:
			out[k] = x
		case float64:
			out[k] = strconv.FormatFloat(x, 'f', -1, 64)
		case int:
			out[k] = strconv.Itoa(x)
		case int64:
			out[k] = strconv.FormatInt(x, 10)
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

// findAgentByTitle 按标题精确匹配已有可见 agent（无外部键的手工载荷去重用）。
func (s *Store) findAgentByTitle(ctx context.Context, title string, actor *User) (Entity, bool) {
	title = strings.TrimSpace(title)
	if title == "" {
		return Entity{}, false
	}
	var id string
	if err := s.DB.QueryRowContext(ctx, `SELECT id FROM catalog.entities WHERE kind='agent' AND title=$1 AND status NOT IN ('deleted','merged') LIMIT 1`, title).Scan(&id); err != nil {
		return Entity{}, false
	}
	e, err := s.Get(ctx, id, actor)
	if err != nil {
		return Entity{}, false
	}
	return e, true
}

func (s *Store) importerSave(ctx context.Context, e Entity, actor User, note string, sources []Source) (Entity, error) {
	return s.importerSaveVersioned(ctx, e, 0, actor, note, sources)
}

// importerSaveVersioned 与 importerSave 相同，但显式带乐观锁版本。
// 更新已存在实体时必须传其当前版本，否则 Save 会以 version_conflict 拒绝。
func (s *Store) importerSaveVersioned(ctx context.Context, e Entity, expectedVersion int64, actor User, note string, sources []Source) (Entity, error) {
	if e.Translations == nil {
		e.Translations = map[string]Translation{}
	}
	if e.Attributes == nil {
		e.Attributes = map[string]any{}
	}
	if e.ExternalIDs == nil {
		e.ExternalIDs = map[string]string{}
	}
	return s.Save(ctx, Edit{Entity: e, ExpectedVersion: expectedVersion, EditNote: note, Sources: sources}, actor)
}

// assocImportKey 取关联项的导入键，**必须与落库的 external_ids.metafusion_import 格式一致**
// （findImported 按该字段查询）。预览已带 metafusion_import 时直接用；否则由
// bangumi_person/character 拼成 `bangumi:{kind}:{id}`（与落库格式一致）。
// 曾因返回 `bangumi_person:{id}`（下划线）与落库的 `bangumi:person:{id}` 不匹配，
// 导致重复导入每次都新建一份实体。
func assocImportKey(externalIDs map[string]any) string {
	if v, ok := externalIDs["metafusion_import"]; ok {
		if s := strings.TrimSpace(fmt.Sprint(v)); s != "" {
			return s
		}
	}
	for _, k := range []string{"bangumi_character", "bangumi_person"} {
		if v, ok := externalIDs[k]; ok {
			if s := strings.TrimSpace(fmt.Sprint(v)); s != "" {
				return "bangumi:" + strings.TrimPrefix(k, "bangumi_") + ":" + s
			}
		}
	}
	return ""
}

// assocAgentDedup 复算第一趟使用的去重键，保证两趟指向同一 agent。
func assocAgentDedup(a ImporterStaffAssociation) string {
	if tid := strings.TrimSpace(a.TargetArtistID); tid != "" {
		return "id:" + tid
	}
	if k := assocImportKey(a.ExternalIDs); k != "" {
		return k
	}
	return "name:" + strings.ToLower(strings.TrimSpace(a.ParsedName)) + "|" + staffAgentType(a.EntityType)
}

// importerRelationSkippable 判断关系写入失败是否属于外部数据形态导致的既定跳过
// （重复边、端点类型不出现在该关系定义内等），而非服务端故障。
func importerRelationSkippable(err error) bool {
	if err == nil {
		return false
	}
	switch err.Error() {
	case "duplicate_relation", "invalid_endpoint_types", "invalid_endpoints",
		"invalid_relation_type", "cardinality_exceeded", "relation_cycle":
		return true
	}
	return false
}

// workTypeFromMetadata 从预览回带 catalog_metadata 还原 Bangumi 条目类型，
// 手工拼装的载荷没有该字段时返回空（不虚构类型）。
//
// catalog_metadata 声明为 any：走 HTTP JSON 往返后数值是 float64，
// 而同进程直接调用（预览结果原样传给 Import）保留 Go int。两种形态都要接受，
// 否则会静默丢失类型、进而把该类型允许的字段判成未知字段。
func workTypeFromMetadata(v any) string {
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	switch t := m["bangumi_type"].(type) {
	case float64:
		return bangumiWorkType(int(t))
	case int:
		return bangumiWorkType(t)
	case int64:
		return bangumiWorkType(int(t))
	}
	return ""
}

func applyWorkSummary(e *Entity, summary string) {
	summary = strings.TrimSpace(summary)
	if summary == "" {
		return
	}
	// Entity 没有简介列，简介只能落在翻译行。
	if e.Translations == nil {
		e.Translations = map[string]Translation{}
	}
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
		return
	}
	// 实体原语言未知且没有可归属的翻译行时（常见于导入的 agent），
	// 按简介**自身文字**选择语种行：假名→ja、汉字→zh-CN。
	// 这里只决定简介存放在哪一行，不改写 original_language（不把"简介的语言"
	// 冒充成实体原语言）；实在无法判定才放弃，避免丢失上游已有的简介。
	loc := detectTextLocale(summary)
	if loc == "" {
		return
	}
	tr := e.Translations[loc]
	if tr.Title == "" {
		tr.Title = e.Title
	}
	tr.Summary = summary
	e.Translations[loc] = tr
}

// detectTextLocale 按文本自身文字判断语种：含假名→ja，含汉字→zh-CN，其余为空。
// 仅用于给简介找一个存放的翻译行，不代表实体原语言。
func detectTextLocale(s string) string {
	if detectJapaneseScript(s) == "ja" {
		return "ja"
	}
	if hasHan(s) {
		return "zh-CN"
	}
	return ""
}

// pictureFromRemote 把外部目录的远端图片 URL 透传为 Picture（不抓取、不转存）。
// Source.URL 优先用对应条目的公开页面（可考据），取不到时回退图片 URL。
func pictureFromRemote(imageURL, citation, key string, hasKey bool) (Picture, bool) {
	imageURL = strings.TrimSpace(imageURL)
	if imageURL == "" || !validURL(imageURL) {
		return Picture{}, false
	}
	pageURL := imageURL
	if hasKey {
		if kind, id := splitDedupKey(key); id != "" {
			switch kind {
			case "subject":
				pageURL = "https://bgm.tv/subject/" + id
			case "character":
				pageURL = "https://bgm.tv/character/" + id
			case "person":
				pageURL = "https://bgm.tv/person/" + id
			}
		}
	}
	if !validURL(pageURL) {
		pageURL = imageURL
	}
	return Picture{URL: imageURL, Caption: Names{}, Source: Source{Kind: "url", Citation: citation, URL: pageURL}}, true
}

// applyAliasesByScript 把异名按自身文字特征归入对应语种翻译行并返回是否有变化。
// 假名 → ja；含汉字 → zh-CN；拉丁/无法判定 → 跳过（不硬塞进任何语种，遵循
// AGENTS.md：不能把其它语种题名塞进原语言行）。已存在的标题与别名去重。
func applyAliasesByScript(e *Entity, aliases []string) bool {
	if e == nil || len(aliases) == 0 {
		return false
	}
	if e.Translations == nil {
		e.Translations = map[string]Translation{}
	}
	changed := false
	for _, a := range aliases {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		loc := ""
		switch {
		case detectJapaneseScript(a) == "ja":
			loc = "ja"
		case hasHan(a):
			loc = "zh-CN"
		default:
			continue // 拉丁等无法判定语种，丢弃而不猜
		}
		tr := e.Translations[loc]
		// 该语种即实体原语言时，实体标题就是它的主标题，别名不得顶替。
		if strings.TrimSpace(tr.Title) == "" && loc == e.OriginalLanguage {
			tr.Title = e.Title
		}
		// 与实体主标题、该语种标题、已有别名重复的一律跳过。
		if a == e.Title || a == tr.Title || contains(tr.Aliases, a) {
			continue
		}
		// 校验要求每个语种行标题非空：该语种还没有标题时，用首个异名充当其主标题
		//（Bangumi 别名里常含该语种的正式译名），否则整条校验会以 invalid_translation 拒绝。
		if strings.TrimSpace(tr.Title) == "" {
			tr.Title = a
		} else {
			tr.Aliases = append(tr.Aliases, a)
		}
		e.Translations[loc] = tr
		changed = true
	}
	return changed
}

// hasHan 判断是否含CJK统一表意文字（用于把纯汉字异名归入中文行）。
func hasHan(s string) bool {
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}

// mergeAgentMetadata 为已存在的 agent 补齐/纠正元数据，返回结果与是否有变化。
// 只在原值为空时补齐；类型只做"person → organization/group"的纠正（上游把企业
// 标成个人是已知数据问题），不把组织降级成个人。简介与语言同理只在缺失时写。
func mergeAgentMetadata(existing Entity, assoc ImporterStaffAssociation) (Entity, bool) {
	changed := false
	// 类型纠正：现有是 person 且新判定更具体（organization/group）时覆盖。
	want := staffAgentType(assoc.EntityType)
	if want != "" && want != "person" && (len(existing.Types) == 0 || contains(existing.Types, "person")) && !contains(existing.Types, want) {
		existing.Types = []string{want}
		changed = true
	}
	if existing.OriginalLanguage == "" {
		if lang := originalLanguageOrEmpty(assoc.Language); lang != "" {
			existing.OriginalLanguage = lang
			changed = true
		}
	}
	if strings.TrimSpace(assoc.Biography) != "" {
		if !agentHasSummary(existing) {
			applyWorkSummary(&existing, assoc.Biography)
			changed = true
		}
	}
	if len(existing.Pictures) == 0 {
		if p, ok := pictureFromRemote(assoc.AvatarURL, "Bangumi 头像", "", false); ok {
			existing.Pictures = []Picture{p}
			changed = true
		}
	}
	return existing, changed
}

// agentHasSummary 判断 agent 是否已有任何简介（任一翻译行的 summary 非空）。
func agentHasSummary(e Entity) bool {
	for _, tr := range e.Translations {
		if strings.TrimSpace(tr.Summary) != "" {
			return true
		}
	}
	return false
}

// mergeWorkMetadata 为已存在的 work 补齐缺失元数据；返回合并结果与是否有变化。
// 只在原值为空时填入，绝不覆盖已有值（保护人工编辑）。封面同理：无图才补。
func mergeWorkMetadata(existing Entity, w *ImporterWorkPreview, dateField string) (Entity, bool) {
	if w == nil {
		return existing, false
	}
	changed := false
	if existing.OriginalLanguage == "" {
		if lang := originalLanguageOrEmpty(w.OriginalLanguage); lang != "" {
			existing.OriginalLanguage = lang
			changed = true
		}
	}
	// 属性补齐：仅限类型已声明字段，且只在缺值时写入。
	workType := workTypeFromMetadata(w.CatalogMetadata)
	if workType != "" && len(existing.Types) == 0 {
		existing.Types = []string{workType}
		changed = true
	}
	if existing.Attributes == nil {
		existing.Attributes = map[string]any{}
	}
	if dateField != "" {
		if _, ok := existing.Attributes[dateField]; !ok {
			if d := cleanImporterDate(w.ReleaseDate); d != "" {
				existing.Attributes[dateField] = d
				changed = true
			}
		}
	}
	if v, ok := w.CatalogMetadata.(map[string]any); ok {
		if _, ok := existing.Attributes["catalog_number"]; !ok && workType != "" {
			if no := scalarString(v["catalog_number"]); no != "" {
				existing.Attributes["catalog_number"] = no
				changed = true
			}
		}
	}
	// 标签与 infobox 派生字段：只在缺失时补，绝不覆盖已编目的值。
	if workType != "" {
		if _, ok := existing.Attributes["tags"]; !ok && len(w.Tags) > 0 {
			existing.Attributes["tags"] = toAnySlice(w.Tags)
			changed = true
		}
		for k, v := range w.Fields {
			if _, ok := existing.Attributes[k]; ok {
				continue
			}
			if val, ok := dynamicFieldValue(v); ok {
				existing.Attributes[k] = val
				changed = true
			}
		}
		if _, ok := existing.Attributes["infobox"]; !ok && len(w.Infobox) > 0 {
			existing.Attributes["infobox"] = toAnySlice(w.Infobox)
			changed = true
		}
	}
	// 外部 ID：官网等只在缺失时补。
	if existing.ExternalIDs == nil {
		existing.ExternalIDs = map[string]string{}
	}
	if v, ok := w.CatalogMetadata.(map[string]any); ok {
		if _, ok := existing.ExternalIDs["official_website"]; !ok {
			if site := scalarString(v["official_website"]); site != "" {
				existing.ExternalIDs["official_website"] = site
				changed = true
			}
		}
	}
	// 翻译行：补原语言行标题；别名按语种分派（去重），不覆盖已有标题/简介。
	if lang := existing.OriginalLanguage; lang != "" {
		tr := existing.Translations[lang]
		if tr.Title == "" {
			tr.Title = existing.Title
			changed = true
		}
		existing.Translations[lang] = tr
	}
	changed = applyAliasesByScript(&existing, w.Aliases) || changed
	if len(existing.Pictures) == 0 {
		if p, ok := pictureFromRemote(w.CoverImageURL, "Bangumi 条目封面", "", false); ok {
			existing.Pictures = []Picture{p}
			changed = true
		}
	}
	return existing, changed
}

// buildWorkEntity 组装 work 实体。dateField 为该类型模板声明的主日期字段码
// （见 Definitions.PrimaryDateField），由调用方从 definitions 解析后传入，
// 避免把 edition_date 这类字段码硬编码进代码。
func buildWorkEntity(w *ImporterWorkPreview, workType, source, key, sourceID string, hasKey bool, dateField string) (Entity, error) {
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
	// 属性只能落在类型声明的字段集内：类型未识别时保持属性为空，
	// 否则校验会把未知字段判为错误、整条导入失败。
	if workType != "" {
		e.Types = []string{workType}
		if lang := strings.TrimSpace(w.Language); lang != "" {
			e.Attributes["language"] = lang
		}
		// 作品首发/出版日期：写入模板声明的主日期字段（默认 edition_date），
		// 供列表与详情展示。字段码来自 definitions，不在代码里写死。
		if d := cleanImporterDate(w.ReleaseDate); d != "" && dateField != "" {
			e.Attributes[dateField] = d
		}
		// 标签：以字符串列表落库，支持按标签检索（jsonb 容器包含走函数索引）。
		if len(w.Tags) > 0 {
			e.Attributes["tags"] = toAnySlice(w.Tags)
		}
			// infobox 映射出的动态字段：仅写入非空值，字段码均已在 defaults.go 声明。
			for k, v := range w.Fields {
				if val, ok := dynamicFieldValue(v); ok {
					e.Attributes[k] = val
				}
			}
		// infobox 原文快照：完整保留以便追溯，不参与展示分区。
		if len(w.Infobox) > 0 {
			e.Attributes["infobox"] = toAnySlice(w.Infobox)
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
	// 官网来自 infobox，落 external_ids（前端 official_website 读这里，可考据且不占用类型字段）。
	if v, ok := w.CatalogMetadata.(map[string]any); ok {
		if site := scalarString(v["official_website"]); site != "" {
			e.ExternalIDs["official_website"] = site
		}
		if no := scalarString(v["catalog_number"]); no != "" && workType != "" {
			e.Attributes["catalog_number"] = no
		}
	}
	// infobox 别名按**自身语种**归入对应翻译行：假名→ja，含汉字→中文行。
	// 不能无差别塞进原语言行，否则会把中日异名混在同一语种（AGENTS.md 语义）。
	applyAliasesByScript(&e, w.Aliases)
	applyWorkSummary(&e, w.Summary)
	if p, ok := pictureFromRemote(w.CoverImageURL, "Bangumi 条目封面", key, hasKey); ok {
		e.Pictures = []Picture{p}
	}
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
	e := Entity{
		Kind:             "agent",
		Title:            name,
		OriginalLanguage: originalLanguageOrEmpty(lang),
		Translations:     toEntityTranslations(translations),
		Types:            []string{agentType},
		ExternalIDs:      stringScalarMap(externalIDs),
		Attributes:       map[string]any{},
	}
	if p, ok := pictureFromRemote(avatarURL, "Bangumi 头像", key, hasKey); ok {
		e.Pictures = []Picture{p}
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

// normalizeImporterTitleKey 表达对齐的标题键：小写并折叠空白（含全角空格），
// 只用于匹配，不落库。
func normalizeImporterTitleKey(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

// listWorkExpressions 取全 work 下既有表达，供导入对齐复用，避免重复录音。
// 必须用 ListAll：底层 List 会把 >100 的 Limit 收敛为 50，直接传 500 并据长度
// 判断"取完"只会在 50 条处提前终止。
func (s *Store) listWorkExpressions(ctx context.Context, workID string, u *User) ([]Entity, error) {
	return s.ListAll(ctx, ListOptions{Kind: "expression", WorkID: workID}, u)
}

// listWorkContentUnits 取全 work 下既有篇目，供导入按标题去重（同样走 ListAll，
// 避免 List 的 Limit>100→50 收敛导致只看到前 50 条）。
func (s *Store) listWorkContentUnits(ctx context.Context, workID string, u *User) ([]Entity, error) {
	return s.ListAll(ctx, ListOptions{Kind: "content_unit", WorkID: workID}, u)
}

// createExpression 建单个 expression（canonical entry 或曲目回退）。
// contentUnitID 非空时表达归属该篇目（Work → ContentUnit → Expression）。
func (s *Store) createExpression(ctx context.Context, actor User, note string, sources []Source, workID, contentUnitID, title, number string, pos int, duration float64, externalIDs map[string]any) (Entity, error) {
	exprAttrs := map[string]any{}
	var exprTypes []string
	if duration > 0 {
		exprTypes = []string{"expression"}
		exprAttrs["duration"] = duration
	}
	return s.importerSave(ctx, Entity{
		Kind:          "expression",
		Title:         title,
		WorkID:        workID,
		ContentUnitID: contentUnitID,
		Number:        strings.TrimSpace(number),
		Position:      pos,
		Types:         exprTypes,
		Attributes:    exprAttrs,
		ExternalIDs:   stringScalarMap(externalIDs),
	}, actor, note, sources)
}

// createExpressionWithMeta 从 canonical entry 建表达，除标题/编号/时长/外部编号外
// 一并落多语言与原语言（旧实现漏掉这些字段，导致预览里已解析的翻译丢失）。
func (s *Store) createExpressionWithMeta(ctx context.Context, actor User, note string, sources []Source, workID, contentUnitID, title string, ce ImporterCanonicalEntryPreview, pos int) (Entity, error) {
	exprAttrs := map[string]any{}
	var exprTypes []string
	if ce.DurationSeconds > 0 {
		exprTypes = []string{"expression"}
		exprAttrs["duration"] = ce.DurationSeconds
	}
	return s.importerSave(ctx, Entity{
		Kind:             "expression",
		Title:            title,
		WorkID:           workID,
		ContentUnitID:    contentUnitID,
		Number:           strings.TrimSpace(ce.Number),
		Position:         pos,
		Types:            exprTypes,
		Attributes:       exprAttrs,
		ExternalIDs:      stringScalarMap(ce.ExternalIDs),
		Translations:     importerTranslationsFromAny(ce.Translations),
		OriginalLanguage: originalLanguageOrEmpty(ce.OriginalLanguage),
	}, actor, note, sources)
}

// importerReleaseAttrs 从预览计算发行版属性（不含 publisher：自由文本无法解析为
// Agent 引用；不含 edition_type：预览未携带，不虚构）。
func importerReleaseAttrs(rel *ImporterReleasePreview) map[string]any {
	out := map[string]any{}
	if rel == nil {
		return out
	}
	if v := strings.TrimSpace(rel.CatalogNumber); v != "" {
		out["catalog_number"] = v
	}
	if v := strings.TrimSpace(rel.Barcode); v != "" {
		out["barcode"] = v
	}
	if v := strings.TrimSpace(rel.Country); v != "" {
		out["country"] = v
	}
	if v := cleanImporterDate(rel.EditionDate); v != "" {
		out["edition_date"] = v
	}
	return out
}

// importerMediumAttrs 从预览计算载体属性（format 与 role 均须在词表内）。
func importerMediumAttrs(m ImporterMediumPreview) map[string]any {
	out := map[string]any{}
	if f, ok := importerMediumFormats[strings.ToLower(strings.TrimSpace(m.Format))]; ok {
		out["format"] = f
	}
	if r := importerEnum(m.Role, []string{"primary", "supplement", "side", "extra", "commentary"}); r != "" {
		out["role"] = r
	}
	return out
}

// importerTrackAttrs 从预览计算曲目属性。注意 ISRC 不在此处：它属于录音本体，
// 写入 expression.ExternalIDs；track 定义只声明 duration/role。
func importerTrackAttrs(t ImporterTrackPreview) map[string]any {
	out := map[string]any{}
	if t.DurationSeconds > 0 {
		out["duration"] = t.DurationSeconds
	}
	return out
}

// importerFieldSet 汇总某实体类型码声明的属性字段码白名单，用于写库前预检
// unknown_field，避免先建发行/载体再在曲目处失败留下半成品。
func importerFieldSet(defs Definitions, typeCode string) map[string]bool {
	set := map[string]bool{}
	if t, ok := defs.Types[typeCode]; ok {
		for _, f := range t.Fields {
			set[f] = true
		}
	}
	return set
}

// importerCheckAttrs 校验属性键都属于目标类型字段集；键为空集时放行。
func importerCheckAttrs(defs Definitions, typeCode string, attrs map[string]any) error {
	set := importerFieldSet(defs, typeCode)
	for k, v := range attrs {
		if v == nil {
			continue
		}
		if !set[k] {
			return fmt.Errorf("unknown_field: %s", k)
		}
	}
	return nil
}

// importerExplicitExpressions 解析载荷中所有显式指定的既有表达（canonical entries
// 与各轨），返回 id→实体。显式引用是用户选择，允许跨 Work（收录别的作品的录音），
// 只校验存在且 kind=expression。
func (s *Store) importerExplicitExpressions(ctx context.Context, actor User, entries []ImporterCanonicalEntryPreview, mediums []ImporterMediumPreview) (map[string]Entity, error) {
	out := map[string]Entity{}
	collect := func(raw string) error {
		id := strings.TrimSpace(raw)
		if id == "" {
			return nil
		}
		if _, ok := out[id]; ok {
			return nil
		}
		e, err := s.Get(ctx, id, &actor)
		if err != nil || e.Kind != "expression" {
			return fmt.Errorf("invalid_expression_reference")
		}
		out[id] = e
		return nil
	}
	for _, ce := range entries {
		if err := collect(ce.ExpressionID); err != nil {
			return nil, err
		}
	}
	for _, m := range mediums {
		for _, t := range m.Tracks {
			if err := collect(t.ExpressionID); err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}

// importerPreflight 在写库前只读校验整份载荷，保证校验失败时零写入：
//   - 章节树（parent_index）结构合法（顺序即拓扑序）；
//   - 显式表达引用（canonical entries 与各轨）必须存在且 kind=expression；
//   - 载荷声明的属性字段码、以及代码将写入的 release/medium/track 属性，
//     必须属于对应类型字段集（unknown_field 提前暴露）。
func (s *Store) importerPreflight(ctx context.Context, actor User, entries []ImporterCanonicalEntryPreview, rel *ImporterReleasePreview, mediums []ImporterMediumPreview) error {
	if err := validateImporterEntryTree(entries); err != nil {
		return err
	}
	if _, err := s.importerExplicitExpressions(ctx, actor, entries, mediums); err != nil {
		return err
	}
	defs, err := s.Definitions(ctx)
	if err != nil {
		return err
	}
	if err := importerCheckAttrs(defs.Document, "release", importerReleaseAttrs(rel)); err != nil {
		return err
	}
	for _, ce := range entries {
		kind := strings.TrimSpace(ce.EntryKind)
		if kind == "" {
			kind = "expression"
		}
		if err := importerCheckAttrs(defs.Document, kind, ce.Attributes); err != nil {
			return err
		}
	}
	for _, m := range mediums {
		if err := importerCheckAttrs(defs.Document, "medium", importerMediumAttrs(m)); err != nil {
			return err
		}
		for _, t := range m.Tracks {
			if err := importerCheckAttrs(defs.Document, "track", importerTrackAttrs(t)); err != nil {
				return err
			}
		}
	}
	return nil
}

// importExpressionsOnly 无发行版时只建表达，不建 release 链；entry_kind=content_unit
// 的条目先建章节树（parent_index 指父级），下级表达挂到所属单元。
// 与有发行路径同样先校验树、复用既有篇目（来源 ID/父+标题/父+编号），并写入多语言。
func (s *Store) importExpressionsOnly(ctx context.Context, actor User, note string, sources []Source, workID string, entries []ImporterCanonicalEntryPreview) (ImporterImportedCounts, error) {
	counts := ImporterImportedCounts{}
	if err := validateImporterEntryTree(entries); err != nil {
		return counts, err
	}
	existingUnits, err := s.listWorkContentUnits(ctx, workID, &actor)
	if err != nil {
		return counts, err
	}
	index := newImporterContentUnitIndex(existingUnits)
	unitIDs := make([]string, len(entries))
	for i, ce := range entries {
		title := strings.TrimSpace(ce.Title)
		if title == "" {
			return counts, fmt.Errorf("invalid_payload")
		}
		pos := sanitizePosition(ce.Position, i)
		parent := ""
		if ce.ParentIndex != nil && *ce.ParentIndex >= 0 && *ce.ParentIndex < len(entries) {
			parent = unitIDs[*ce.ParentIndex]
		}
		if strings.TrimSpace(ce.EntryKind) == "content_unit" {
			// 重复导入复用：来源 ID 优先，其次 (父篇目, 标题)/(父篇目, 编号)。
			if existingID, ok := index.lookup(ce, parent); ok {
				unitIDs[i] = existingID
				continue
			}
			unit, err := s.importerSave(ctx, Entity{
				Kind:             "content_unit",
				Title:            title,
				WorkID:           workID,
				ParentID:         parent,
				Number:           strings.TrimSpace(ce.Number),
				Position:         pos,
				Types:            []string{"content_unit"},
				ExternalIDs:      stringScalarMap(ce.ExternalIDs),
				Translations:     importerTranslationsFromAny(ce.Translations),
				OriginalLanguage: originalLanguageOrEmpty(ce.OriginalLanguage),
			}, actor, note, sources)
			if err != nil {
				return counts, err
			}
			unitIDs[i] = unit.ID
			index.remember(ce, parent, unit.ID)
			counts.ContentUnits++
			continue
		}
		// 手工匹配优先：显式指定的既有表达直接引用（允许跨 Work），
		// 只建立引用，不改动其原有章节归属。
		if explicit := strings.TrimSpace(ce.ExpressionID); explicit != "" {
			e, err := s.Get(ctx, explicit, &actor)
			if err != nil || e.Kind != "expression" {
				return counts, fmt.Errorf("invalid_expression_reference")
			}
			continue
		}
		if _, err := s.createExpressionWithMeta(ctx, actor, note, sources, workID, parent, title, ce, pos); err != nil {
			return counts, err
		}
	}
	return counts, nil
}

// importerReleaseVariantKey 在导入基础键上附加"发行内容签名"，用于区分
// 同一来源下的不同版本：同一份载荷重试得到同一键（幂等补齐），
// 追加另一个版本（不同版名/载体/曲目）则得到不同键（新建发行，不误并）。
// base 为空（来源无幂等键）时返回空，不做幂等。
func importerReleaseVariantKey(base string, rel *ImporterReleasePreview, mediums []ImporterMediumPreview) string {
	base = strings.TrimSpace(base)
	if base == "" {
		return ""
	}
	edition := ""
	if rel != nil {
		edition = strings.TrimSpace(rel.EditionName)
	}
	sig := strings.Builder{}
	sig.WriteString(edition)
	sig.WriteByte('\n')
	for _, m := range mediums {
		fmt.Fprintf(&sig, "%d|%s|%s|%s|%d\n", sanitizePosition(m.Position, -1), strings.TrimSpace(m.Format), strings.TrimSpace(m.Number), strings.TrimSpace(m.Name), len(m.Tracks))
		for _, t := range m.Tracks {
			fmt.Fprintf(&sig, "  %d|%s|%s\n", sanitizePosition(t.Position, -1), strings.TrimSpace(t.Title), strings.TrimSpace(t.ISRC))
		}
	}
	sum := sha256.Sum256([]byte(sig.String()))
	return base + ":r" + hex.EncodeToString(sum[:8])
}

// importReleaseChain 按 work → expression → release → medium → track 建链。
// 表达对齐只认权威依据：用户手工指定的 expression_id，或 recording_mbid/isrc 等
// 外部编号；标题、时长、轨号相近不再自动合并身份（同名录音室版/现场版会被误并），
// 交由预览中的候选选择或新建。多盘各自从 1 重排轨号，跨盘绝不按轨号对齐。
func (s *Store) importReleaseChain(ctx context.Context, actor User, note string, sources []Source, workID, workTitle string, entries []ImporterCanonicalEntryPreview, rel *ImporterReleasePreview, mediums []ImporterMediumPreview, releaseKey string) (Entity, ImporterImportedCounts, error) {
	counts := ImporterImportedCounts{}
	// 章节树先整体校验（越界/自指/指向后继/父级非篇目都拒绝），再做任何写入。
	if err := validateImporterEntryTree(entries); err != nil {
		return Entity{}, counts, err
	}
	// 发行链幂等：把传入的基础键按"发行内容签名"具体化为本版本的键，再按它复用。
	// 同一份载荷重试 → 同键 → 复用已建发行并继续补齐载体/曲目（上次可能中途失败）；
	// 追加另一个版本（不同版名/载体/曲目）→ 不同键 → 新建发行，不误并。
	releaseKey = importerReleaseVariantKey(releaseKey, rel, mediums)
	var existingRelease *Entity
	if strings.TrimSpace(releaseKey) != "" {
		if existing, ok := s.findImported(ctx, strings.TrimSpace(releaseKey), &actor); ok && existing.Kind == "release" {
			existingRelease = &existing
		}
	}
	// 权威标识索引：仅用于外部编号（recording_mbid/isrc）自动复用与显式引用解析。
	// 不再维护标题/位置索引——标题相近不再自动合并身份。
	type exprCandidate struct {
		id          string
		number      string
		externalIDs map[string]string
	}
	byID := map[string]exprCandidate{}
	byExternal := map[string]string{}
	register := func(c exprCandidate) {
		byID[c.id] = c
		for k, v := range c.externalIDs {
			if v = strings.TrimSpace(v); v != "" {
				byExternal[strings.ToLower(k)+"|"+strings.ToLower(v)] = c.id
			}
		}
	}
	// 显式引用解析：用户选择的既有表达，允许跨 Work；其所属 Work 需补进发行 subjects。
	explicitExprs, err := s.importerExplicitExpressions(ctx, actor, entries, mediums)
	if err != nil {
		return Entity{}, counts, err
	}
	// 被引用到的其它作品（非本发行主 Work）：落 subjects，满足
	// undeclared_release_subject 校验（收录的表达所属 Work 必须声明在发行上）。
	// 在创建发行前就要定稿，因此直接从显式引用集合推导（覆盖 canonical 与各轨）。
	referencedWorks := map[string]bool{}
	for _, e := range explicitExprs {
		if e.WorkID != "" && e.WorkID != workID {
			referencedWorks[e.WorkID] = true
		}
	}
	existingExprs, err := s.listWorkExpressions(ctx, workID, &actor)
	if err != nil {
		return Entity{}, counts, err
	}
	for _, e := range existingExprs {
		register(exprCandidate{id: e.ID, number: e.Number, externalIDs: e.ExternalIDs})
	}
	// 既有篇目索引：来源 ID / (父, 标题) / (父, 编号)，与无发行路径同一套去重语义。
	existingUnits, err := s.listWorkContentUnits(ctx, workID, &actor)
	if err != nil {
		return Entity{}, counts, err
	}
	unitIndex := newImporterContentUnitIndex(existingUnits)
	// 曲目挂载只按"本 Work 已建/已复用篇目"的标题匹配（同 Work 内结构归属）。
	unitByTitle := map[string]string{}
	for _, u := range existingUnits {
		if tk := normalizeImporterTitleKey(u.Title); tk != "" {
			if _, ok := unitByTitle[tk]; !ok {
				unitByTitle[tk] = u.ID
			}
		}
	}
	// 自动复用仅认权威标识：recording_mbid / isrc 等外部编号对得上才复用。
	// 标题、时长、轨号相近不再自动合并身份（同名录音室版/现场版会被误并），
	// 这类情况交给用户在预览中选择既有表达，或新建。
	lookupAuthoritative := func(external map[string]string) (exprCandidate, bool) {
		for k, v := range external {
			if v = strings.TrimSpace(v); v == "" {
				continue
			}
			if id, ok := byExternal[strings.ToLower(k)+"|"+strings.ToLower(v)]; ok {
				return byID[id], true
			}
		}
		return exprCandidate{}, false
	}
	// 本次载荷声明的 canonical 表达按标题建索引：曲目要绑定到"同一份清单里声明的"
	// 表达，这是同一次导入内的结构绑定，不是对库里既有实体的身份猜测。
	// 同名多个时视为歧义，不自动绑定（返回 false）。
	localByTitle := map[string][]exprCandidate{}
	registerLocal := func(c exprCandidate, title string) {
		if tk := normalizeImporterTitleKey(title); tk != "" {
			localByTitle[tk] = append(localByTitle[tk], c)
		}
	}
	lookupLocalTitle := func(title string) (exprCandidate, bool) {
		tk := normalizeImporterTitleKey(title)
		if tk == "" {
			return exprCandidate{}, false
		}
		cands := localByTitle[tk]
		if len(cands) != 1 {
			return exprCandidate{}, false
		}
		return cands[0], true
	}
	// 手工绑定表：canonical entry 显式指定的表达按其标题登记，供同标题曲目复用
	// （用户已声明"这一条就是那个表达"，属显式绑定而非猜测）。
	boundByTitle := map[string]string{}
	// canonical entries：entry_kind=content_unit 的先建章节树（parent_index 指父级），
	// 其余条目仅在显式引用或权威外部编号命中时复用，否则新建。树已在进入前校验。
	unitIDs := make([]string, len(entries))
	for i, ce := range entries {
		title := strings.TrimSpace(ce.Title)
		if title == "" {
			return Entity{}, counts, fmt.Errorf("invalid_payload")
		}
		pos := sanitizePosition(ce.Position, i)
		parent := ""
		if ce.ParentIndex != nil && *ce.ParentIndex >= 0 && *ce.ParentIndex < len(entries) {
			parent = unitIDs[*ce.ParentIndex]
		}
		if strings.TrimSpace(ce.EntryKind) == "content_unit" {
			// 重复导入复用：来源 ID 优先，其次 (父篇目, 标题)/(父篇目, 编号)。
			if existingID, ok := unitIndex.lookup(ce, parent); ok {
				unitIDs[i] = existingID
				if tk := normalizeImporterTitleKey(title); tk != "" {
					if _, ok := unitByTitle[tk]; !ok {
						unitByTitle[tk] = existingID
					}
				}
				continue
			}
			unit, err := s.importerSave(ctx, Entity{
				Kind:             "content_unit",
				Title:            title,
				WorkID:           workID,
				ParentID:         parent,
				Number:           strings.TrimSpace(ce.Number),
				Position:         pos,
				Types:            []string{"content_unit"},
				ExternalIDs:      stringScalarMap(ce.ExternalIDs),
				Translations:     importerTranslationsFromAny(ce.Translations),
				OriginalLanguage: originalLanguageOrEmpty(ce.OriginalLanguage),
			}, actor, note, sources)
			if err != nil {
				return Entity{}, counts, err
			}
			unitIDs[i] = unit.ID
			unitIndex.remember(ce, parent, unit.ID)
			if tk := normalizeImporterTitleKey(title); tk != "" {
				if _, ok := unitByTitle[tk]; !ok {
					unitByTitle[tk] = unit.ID
				}
			}
			counts.ContentUnits++
			continue
		}
		contentUnitID := parent
		// 手工绑定优先：显式 expression_id 命中既有表达即直接引用（允许跨 Work）。
		// 只登记绑定，不改动被复用表达原有的章节归属（复用只应建立引用）。
		if explicit := strings.TrimSpace(ce.ExpressionID); explicit != "" {
			e, ok := explicitExprs[explicit]
			if !ok {
				return Entity{}, counts, fmt.Errorf("invalid_expression_reference")
			}
			register(exprCandidate{id: e.ID, number: e.Number, externalIDs: e.ExternalIDs})
			registerLocal(exprCandidate{id: e.ID, number: e.Number, externalIDs: e.ExternalIDs}, title)
			if tk := normalizeImporterTitleKey(title); tk != "" {
				boundByTitle[tk] = e.ID
			}
			continue
		}
		if cand, ok := lookupAuthoritative(stringScalarMap(ce.ExternalIDs)); ok {
			registerLocal(cand, title)
			continue
		}
		saved, err := s.createExpressionWithMeta(ctx, actor, note, sources, workID, contentUnitID, title, ce, pos)
		if err != nil {
			return Entity{}, counts, err
		}
		register(exprCandidate{id: saved.ID, number: saved.Number, externalIDs: saved.ExternalIDs})
		registerLocal(exprCandidate{id: saved.ID, number: saved.Number, externalIDs: saved.ExternalIDs}, title)
	}
	releaseTitle := strings.TrimSpace(workTitle)
	if rel != nil && strings.TrimSpace(rel.EditionName) != "" {
		releaseTitle = strings.TrimSpace(rel.EditionName)
	}
	releaseAttrs := importerReleaseAttrs(rel)
	if releaseTitle == "" {
		return Entity{}, counts, fmt.Errorf("invalid_payload")
	}
	releaseExternalIDs := map[string]string{}
	if strings.TrimSpace(releaseKey) != "" {
		releaseExternalIDs["metafusion_import"] = strings.TrimSpace(releaseKey)
	}
	var release Entity
	if existingRelease != nil {
		// 复用已建发行，但**继续走载体/曲目循环**：上次导入可能中途失败，
		// 只建了部分结构，重试需要补齐，而不是整链跳过。
		// 复用时不改写既有 subjects（可能含管理员人工补充），仅记录本次是否需补声明。
		release = *existingRelease
	} else {
		subjects := []Subject{{WorkID: workID, Role: "primary", Position: 0}}
		// 跨作品收录：被引用作品的 Work 必须声明在发行上（release_role=compilation）。
		otherWorks := make([]string, 0, len(referencedWorks))
		for wid := range referencedWorks {
			otherWorks = append(otherWorks, wid)
		}
		sort.Strings(otherWorks)
		for idx, wid := range otherWorks {
			subjects = append(subjects, Subject{WorkID: wid, Role: "compilation", Position: idx + 1})
		}
		created, cerr := s.importerSave(ctx, Entity{
			Kind:        "release",
			Title:       releaseTitle,
			Types:       []string{"release"},
			Attributes:  releaseAttrs,
			ExternalIDs: releaseExternalIDs,
			Subjects:    subjects,
		}, actor, note, sources)
		if cerr != nil {
			return Entity{}, counts, cerr
		}
		release = created
	}
	for i, m := range mediums {
		mediumTitle := strings.TrimSpace(m.Name)
		if mediumTitle == "" {
			mediumTitle = "Disc " + strconv.Itoa(i+1)
		}
		mediumAttrs := importerMediumAttrs(m)
		medPos := sanitizePosition(m.Position, i)
		mediumKey := ""
		if rk := strings.TrimSpace(releaseKey); rk != "" {
			mediumKey = rk + ":m" + strconv.Itoa(medPos)
		}
		mediumExternal := map[string]string{}
		if mediumKey != "" {
			mediumExternal["metafusion_import"] = mediumKey
		}
		var medium Entity
		if mediumKey != "" {
			if ex, ok := s.findImported(ctx, mediumKey, &actor); ok && ex.Kind == "medium" && ex.ReleaseID == release.ID {
				medium = ex
			}
		}
		if medium.ID == "" {
			created, merr := s.importerSave(ctx, Entity{
				Kind:        "medium",
				Title:       mediumTitle,
				ReleaseID:   release.ID,
				Number:      strings.TrimSpace(m.Number),
				Position:    medPos,
				Types:       []string{"medium"},
				Attributes:  mediumAttrs,
				ExternalIDs: mediumExternal,
			}, actor, note, sources)
			if merr != nil {
				return Entity{}, counts, merr
			}
			medium = created
			counts.Mediums++
		}
		for j, t := range m.Tracks {
			trackTitle := strings.TrimSpace(t.Title)
			if trackTitle == "" {
				return Entity{}, counts, fmt.Errorf("invalid_payload")
			}
			pos := sanitizePosition(t.Position, j)
			trackExternal := map[string]string{}
			if v := strings.TrimSpace(t.RecordingMBID); v != "" {
				trackExternal["recording_mbid"] = v
			}
			if v := strings.TrimSpace(t.ISRC); v != "" {
				trackExternal["isrc"] = v
			}
			expressionID := ""
			number := ""
			// 手工匹配最先：显式指定的既有表达直接引用（允许跨 Work）。
			if explicit := strings.TrimSpace(t.ExpressionID); explicit != "" {
				e, ok := explicitExprs[explicit]
				if !ok {
					return Entity{}, counts, fmt.Errorf("invalid_expression_reference")
				}
				expressionID, number = e.ID, e.Number
			} else if bound, ok := boundByTitle[normalizeImporterTitleKey(trackTitle)]; ok {
				// canonical entry 已显式绑定该标题 → 曲目复用同一表达（用户声明的绑定，非猜测）。
				expressionID = bound
				if c, ok := byID[bound]; ok {
					number = c.number
				}
			} else if cand, ok := lookupAuthoritative(trackExternal); ok {
				// 权威外部编号（recording_mbid/isrc）命中即复用。
				expressionID, number = cand.id, cand.number
			} else if cand, ok := lookupLocalTitle(trackTitle); ok {
				// 同一份载荷中声明的 canonical 表达（唯一同名）→ 曲目引用之，
				// 这是同次导入的结构绑定，不是对库里既有实体的身份猜测。
				expressionID, number = cand.id, cand.number
			} else {
				externalAny := make(map[string]any, len(trackExternal))
				for k, v := range trackExternal {
					externalAny[k] = v
				}
				// 曲目标题命中同 Work 的篇目/分集时，新建的表达归属该单元
				// （分集录像/正文挂在对应篇目下），否则保持 Work 直接下属。
				cuID := ""
				if tk := normalizeImporterTitleKey(trackTitle); tk != "" {
					cuID = unitByTitle[tk]
				}
				expr, err := s.createExpression(ctx, actor, note, sources, workID, cuID, trackTitle, "", pos, t.DurationSeconds, externalAny)
				if err != nil {
					return Entity{}, counts, err
				}
				expressionID = expr.ID
				register(exprCandidate{id: expr.ID, number: expr.Number, externalIDs: expr.ExternalIDs})
			}
			trackAttrs := importerTrackAttrs(t)
			// ISRC 属于录音本体：已写入 expression.ExternalIDs（见上方 trackExternal），
			// track 定义只声明 duration/role，不能再写 isrc（会 unknown_field 拒绝）。
			trackNumber := number
			if trackNumber == "" && pos > 0 {
				trackNumber = strconv.Itoa(pos)
			}
			trackKey := ""
			if mediumKey != "" {
				trackKey = mediumKey + ":t" + strconv.Itoa(pos)
			}
			trackExternalIDs := map[string]string{}
			if trackKey != "" {
				trackExternalIDs["metafusion_import"] = trackKey
			}
			// 曲目级幂等：上次中断后重试时按轨位键复用，避免同一发行下重复建曲目。
			if trackKey != "" {
				if ex, ok := s.findImported(ctx, trackKey, &actor); ok && ex.Kind == "track" && ex.MediumID == medium.ID {
					continue
				}
			}
			if _, err := s.importerSave(ctx, Entity{
				Kind:        "track",
				Title:       trackTitle,
				MediumID:    medium.ID,
				Number:      trackNumber,
				Position:    pos,
				Types:       []string{"track"},
				Attributes:  trackAttrs,
				ExternalIDs: trackExternalIDs,
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
	// 先做纯参数校验（不触库），保持"非法载荷在写库前失败"的既有约定。
	switch mode {
	case "append_release_to_work", "merge_translations":
		if strings.TrimSpace(req.TargetWorkID) == "" {
			return ImporterImportResponse{}, fmt.Errorf("invalid_payload")
		}
	case "create_relation":
		if strings.TrimSpace(req.TargetWorkID) == "" || strings.TrimSpace(req.RelationType) == "" || req.Work == nil {
			return ImporterImportResponse{}, fmt.Errorf("invalid_payload")
		}
	}
	// 写库前整体预检：属性字段码与显式表达引用先校验，避免先建 work/release/medium
	// 再在某条曲目处 unknown_field 失败，留下半成品结构。
	if pfErr := s.importerPreflight(ctx, actor, req.CanonicalEntries, req.Release, req.Mediums); pfErr != nil {
		return ImporterImportResponse{}, pfErr
	}
	if mode == "append_release_to_work" || mode == "merge_translations" {
		target, gerr := s.Get(ctx, strings.TrimSpace(req.TargetWorkID), &actor)
		if gerr != nil || target.Kind != "work" {
			return ImporterImportResponse{}, fmt.Errorf("not_found")
		}
		workTitle := target.Title
		if req.Work != nil && strings.TrimSpace(req.Work.Title) != "" {
			workTitle = strings.TrimSpace(req.Work.Title)
		}
		// 挂靠已有 work 补发行链：幂等键从目标 work 的导入键派生，保证同一来源重复补链可复用。
		appendReleaseKey := ""
		if wk := strings.TrimSpace(target.ExternalIDs["metafusion_import"]); wk != "" {
			appendReleaseKey = wk + ":release"
		}
		release, counts, rerr := s.importReleaseChain(ctx, actor, note, sources, target.ID, buildReleaseTitle(workTitle, req.Release), req.CanonicalEntries, req.Release, req.Mediums, appendReleaseKey)
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
	// 幂等：已导入过同一外部条目时复用该 work，但**不再提前返回**——
	// 否则再次导入无法为已有作品补齐关联演职员/角色与关系（增量补录场景）。
	// 主日期字段码由模板声明（默认 edition_date）。过去这里误用"作品类型码"
	// 当字段名，会把 attributes["animation"] 之类的非法键写进去，导致增量补录
	// 被校验拒绝（unknown_field）。改为与新建路径同一来源。
	dateField := ""
	if defs, derr := s.Definitions(ctx); derr == nil {
		dateField = defs.Document.PrimaryDateField(workTypeFromMetadata(req.Work.CatalogMetadata))
	}
	var savedWork Entity
	if hasKey {
		if existing, ok := s.findImported(ctx, key, &actor); ok && existing.Kind == "work" {
			// 已导入过：补齐**当时缺失**的元数据（原语言/别名/官网/品番/日期/标签/
			// infobox 派生字段），便于老条目增量补录；已有值一律不覆盖。
			merged, changed := mergeWorkMetadata(existing, req.Work, dateField)
			if changed {
				updated, uerr := s.importerSaveVersioned(ctx, merged, existing.Version, actor, note, sources)
				if uerr != nil {
					return ImporterImportResponse{}, uerr
				}
				savedWork = updated
			} else {
				savedWork = existing
			}
		}
	}
	if savedWork.ID == "" {
		workType := workTypeFromMetadata(req.Work.CatalogMetadata)
		work, err := buildWorkEntity(req.Work, workType, source, key, req.ExternalID, hasKey, dateField)
		if err != nil {
			return ImporterImportResponse{}, err
		}
		savedWork, err = s.importerSave(ctx, work, actor, note, sources)
		if err != nil {
			return ImporterImportResponse{}, err
		}
	}
	out := ImporterImportResponse{
		Success: true, EntityType: "work",
		WorkID: savedWork.ID, Work: savedWork,
		RedirectURL: "/works/" + savedWork.ID,
	}
	counts := ImporterImportedCounts{}
	// 两趟：先生成/复用全部 agent（按导入键与名称去重，同一人物多职位只建一个实体），
	// 再建立关系。角色必须先建好，声优关系才能用它的实体 ID 填 character 引用。
	agentByKey := map[string]Entity{} // 导入键 → agent 实体
	characterByName := map[string]Entity{}
	for _, assoc := range req.StaffAssociations {
		if strings.ToLower(strings.TrimSpace(assoc.Action)) == "skip" {
			continue
		}
		if tid := strings.TrimSpace(assoc.TargetArtistID); tid != "" {
			if e, gerr := s.Get(ctx, tid, &actor); gerr == nil && e.Kind == "agent" {
				agentByKey["id:"+tid] = e
			}
			continue
		}
		name := strings.TrimSpace(assoc.ParsedName)
		if name == "" {
			continue
		}
		entityType := staffAgentType(assoc.EntityType)
		dedup := assocImportKey(assoc.ExternalIDs)
		if dedup == "" {
			dedup = "name:" + strings.ToLower(name) + "|" + entityType
		}
		if _, ok := agentByKey[dedup]; ok {
			continue
		}
		// 先按外部导入键复用已存在的 agent，避免重复导入产生同名副本。
		if iKey := assocImportKey(assoc.ExternalIDs); iKey != "" {
			if existing, ok := s.findImported(ctx, iKey, &actor); ok && existing.Kind == "agent" {
				// 已知 agent 补齐缺失元数据（类型纠正/简介/语言/封面），不覆盖已有值。
				if merged, changed := mergeAgentMetadata(existing, assoc); changed {
					if updated, uerr := s.importerSaveVersioned(ctx, merged, existing.Version, actor, note, sources); uerr == nil {
						existing = updated
						counts.Artists++
					}
				}
				agentByKey[dedup] = existing
				if strings.TrimSpace(assoc.RelationType) == "character_in" {
					characterByName[strings.ToLower(name)] = existing
				}
				continue
			}
		} else if existing, ok := s.findAgentByTitle(ctx, name, &actor); ok {
			// 无外部键的关联（手工载荷）按标题复用，避免重复导入产生同名 agent。
			if merged, changed := mergeAgentMetadata(existing, assoc); changed {
				if updated, uerr := s.importerSaveVersioned(ctx, merged, existing.Version, actor, note, sources); uerr == nil {
					existing = updated
				}
			}
			agentByKey[dedup] = existing
			if strings.TrimSpace(assoc.RelationType) == "character_in" {
				characterByName[strings.ToLower(name)] = existing
			}
			continue
		}
		staff := Entity{
			Kind:             "agent",
			Title:            name,
			OriginalLanguage: originalLanguageOrEmpty(assoc.Language),
			Translations:     toEntityTranslations(assoc.Translations),
			Types:            []string{entityType},
			Attributes:       map[string]any{},
			ExternalIDs:      stringScalarMap(assoc.ExternalIDs),
		}
		if p, ok := pictureFromRemote(assoc.AvatarURL, "Bangumi 头像", "", false); ok {
			staff.Pictures = []Picture{p}
		}
		if strings.TrimSpace(assoc.Biography) != "" {
			applyWorkSummary(&staff, assoc.Biography)
		}
		agent, aerr := s.importerSave(ctx, staff, actor, note, sources)
		if aerr != nil {
			return ImporterImportResponse{}, aerr
		}
		agentByKey[dedup] = agent
		counts.Artists++
		if strings.TrimSpace(assoc.RelationType) == "character_in" {
			characterByName[strings.ToLower(name)] = agent
		}
	}

	// 第二趟：把关联落到关系上。方向按 definitions 判定（character_in 是 agent → work，
	// 其余署名关系是 work → agent），因此不能写死。
	relDefs, derr := s.Definitions(ctx)
	if derr != nil {
		return ImporterImportResponse{}, derr
	}
	created := map[string]bool{}
	for _, assoc := range req.StaffAssociations {
		if strings.ToLower(strings.TrimSpace(assoc.Action)) == "skip" {
			counts.SkippedRelations++
			continue
		}
		relType := strings.TrimSpace(assoc.RelationType)
		if relType == "" {
			counts.SkippedRelations++
			continue
		}
		if _, ok := relDefs.Document.Relations[relType]; !ok {
			// 无此关系定义：不虚构，跳过并计数（响应不再静默丢边）。
			counts.SkippedRelations++
			continue
		}
		agent, ok := agentByKey[assocAgentDedup(assoc)]
		if !ok {
			counts.SkippedRelations++
			continue
		}
		attrs := map[string]any{}
		if cr := strings.TrimSpace(assoc.ParsedRole); cr != "" {
			attrs["credit_role"] = cr
		}
		if rr := strings.TrimSpace(assoc.RelationRole); rr != "" && relType == "character_in" {
			attrs["role"] = rr
		}
		if ch := strings.TrimSpace(assoc.CharacterName); ch != "" && relType == "voiced_by" {
			// character 是 entity 引用字段：填角色实体 ID，而非角色名。
			if ce, ok := characterByName[strings.ToLower(ch)]; ok {
				attrs["character"] = ce.ID
			} else {
				attrs["credit_role"] = "配音：" + ch
			}
		}
		src, tgt := savedWork.ID, agent.ID
		if contains(relDefs.Document.Relations[relType].SourceKinds, "agent") &&
			!contains(relDefs.Document.Relations[relType].SourceKinds, "work") {
			src, tgt = agent.ID, savedWork.ID
		}
		key := relType + "|" + src + "|" + tgt + "|" + encode(attrs)
		if created[key] {
			continue
		}
		created[key] = true
		if _, rerr := s.SaveRelation(ctx, RelationEdit{
			Relation: Relation{Type: relType, SourceID: src, TargetID: tgt, Attributes: attrs},
			EditNote: note, Sources: sources,
		}, actor); rerr != nil {
			if importerRelationSkippable(rerr) {
				counts.SkippedRelations++
				continue
			}
			return ImporterImportResponse{}, rerr
		}
		counts.Relations++
	}
	out.ImportedCounts.Artists = counts.Artists
	out.ImportedCounts.Relations = counts.Relations
	out.ImportedCounts.SkippedRelations = counts.SkippedRelations
	if len(req.Mediums) == 0 && len(req.CanonicalEntries) == 0 {
		return out, nil
	}
	if len(req.Mediums) == 0 {
		cuCounts, err := s.importExpressionsOnly(ctx, actor, note, sources, savedWork.ID, req.CanonicalEntries)
		if err != nil {
			return ImporterImportResponse{}, err
		}
		// 无发行链时也要把篇目计数并入响应，否则前端看不到导入的章节树。
		out.ImportedCounts.ContentUnits = cuCounts.ContentUnits
		return out, nil
	}
	releaseKey := ""
	if hasKey {
		releaseKey = key + ":release"
	}
	release, rcounts, rerr := s.importReleaseChain(ctx, actor, note, sources, savedWork.ID, req.Work.Title, req.CanonicalEntries, req.Release, req.Mediums, releaseKey)
	if rerr != nil {
		return ImporterImportResponse{}, rerr
	}
	// 发行链统计需保留已建的关联与篇目计数，否则响应会把关联上报成 0。
	rcounts.Artists = counts.Artists
	rcounts.Relations = counts.Relations
	rcounts.SkippedRelations = counts.SkippedRelations
	rcounts.ContentUnits = counts.ContentUnits
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
			// 顶层 agent 命中已存在：同样回填缺失元数据（简介/语言/封面/类型纠正），
			// 与 work 导入关联路径的增量补录对齐；已有值不覆盖。
			merged, changed := mergeAgentMetadata(existing, ImporterStaffAssociation{
				EntityType:  a.EntityType,
				Language:    a.Language,
				Biography:   a.Biography,
				AvatarURL:   a.AvatarURL,
				ExternalIDs: a.ExternalIDs,
			})
			if changed {
				if updated, uerr := s.importerSaveVersioned(ctx, merged, existing.Version, actor, note, sources); uerr == nil {
					existing = updated
				}
			}
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
	// 预览侧细化类型优先于 URL 推断：乐队型"角色"（如 MyGO!!!!!）在预览时
	// 识别为 group，导入保持 group agent；character 行为不变；
	// person 不覆盖请求推断（URL 推断的 artist/organization 语义更具体）。
	if et := agentTypeForPreviewValue(a.EntityType); et != "" && et != "person" {
		agent.Types = []string{et}
		entityType = et
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
