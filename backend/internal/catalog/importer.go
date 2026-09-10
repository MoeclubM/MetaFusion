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
	Artists   int `json:"artists"`
	Relations int `json:"relations"`
	Mediums   int `json:"mediums"`
	Tracks    int `json:"tracks"`
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

// previewBangumiSubjectRelations 拉取条目的关联演职人员与角色，组装为可导入的
// agent 预览（两层以内关联实体）。任一端点失败只返回已取到的部分——关联数据
// 是增强项，不应让主条目导入失败。
func previewBangumiSubjectRelations(ctx context.Context, subjectID int) []ImporterArtistPreview {
	out := []ImporterArtistPreview{}

	var persons []bangumiSubjectPerson
	if err := fetchBangumi(ctx, "/v0/subjects/"+strconv.Itoa(subjectID)+"/persons", &persons); err == nil {
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
			out = append(out, ImporterArtistPreview{
				Name:         name,
				OriginalName: name,
				Role:         role,
				EntityType:   bangumiPersonTypeAgent(p.Type),
				AvatarURL:    bangumiAvatarURL(p.Images),
				ExternalIDs:  map[string]any{"bangumi_person": p.ID, "metafusion_import": "bangumi:person:" + strconv.Itoa(p.ID)},
				// 职位文本保真：语义明确时给关系码，否则由 credit_role 承载原文。
				RelationType: rel,
			})
		}
	}

	var chars []bangumiSubjectCharacter
	if err := fetchBangumi(ctx, "/v0/subjects/"+strconv.Itoa(subjectID)+"/characters", &chars); err == nil {
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
				out = append(out, ImporterArtistPreview{
					Name:          an,
					OriginalName:  an,
					Role:          "配音",
					EntityType:    bangumiPersonTypeAgent(a.Type),
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
	// 无可靠信号时留空（不虚构），展示回退链仍可工作。
	origLang := detectJapaneseScript(sub.Name)
	// infobox 补充官方字段：官网、品番、别名、出版社等（键名随媒体类型不同）。
	aliases := sub.bangumiInfoboxAliases(title, original)
	website := firstNonEmpty(sub.infoboxString("官方网站"), sub.infoboxString("官方網站"), sub.infoboxString("官网"))
	catalogNo := firstNonEmpty(sub.infoboxString("商品编号"), sub.infoboxString("商品編號"), sub.infoboxString("品番"))
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
		},
		Tags: tags,
		// 两层以内的关联演职人员与角色：前端把 artists 转成 staff_associations 提交，
		// 落库时建 agent 实体并把关系挂到作品上。
		Artists: previewBangumiSubjectRelations(ctx, sub.ID),
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

// assocImportKey 取关联项的自有导入键（bangumi_person / bangumi_character），
// 供同一人物在多职位间去重；无键返回空。
func assocImportKey(externalIDs map[string]any) string {
	for _, k := range []string{"bangumi_character", "bangumi_person"} {
		if v, ok := externalIDs[k]; ok {
			if s := strings.TrimSpace(fmt.Sprint(v)); s != "" {
				return k + ":" + s
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
		// 与实体主标题、该语种标题、已有别名重复的一律跳过。
		if a == e.Title || a == tr.Title || contains(tr.Aliases, a) {
			continue
		}
		tr.Aliases = append(tr.Aliases, a)
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

// mergeWorkMetadata 为已存在的 work 补齐缺失元数据；返回合并结果与是否有变化。
// 只在原值为空时填入，绝不覆盖已有值（保护人工编辑）。封面同理：无图才补。
func mergeWorkMetadata(existing Entity, w *ImporterWorkPreview) (Entity, bool) {
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
	if _, ok := existing.Attributes["edition_date"]; !ok {
		if d := cleanImporterDate(w.ReleaseDate); d != "" {
			existing.Attributes["edition_date"] = d
			changed = true
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
	// 属性只能落在类型声明的字段集内：类型未识别时保持属性为空，
	// 否则校验会把未知字段判为错误、整条导入失败。
	if workType != "" {
		e.Types = []string{workType}
		if lang := strings.TrimSpace(w.Language); lang != "" {
			e.Attributes["language"] = lang
		}
		// 作品首发/出版日期：写入 work.edition_date，供列表与详情展示。
		// 预览的 release_date 此前被丢弃，导致列表只能回退到 updated_at（时间显示错误）。
		if d := cleanImporterDate(w.ReleaseDate); d != "" {
			e.Attributes["edition_date"] = d
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
	// 幂等：已导入过同一外部条目时复用该 work，但**不再提前返回**——
	// 否则再次导入无法为已有作品补齐关联演职员/角色与关系（增量补录场景）。
	var savedWork Entity
	if hasKey {
		if existing, ok := s.findImported(ctx, key, &actor); ok && existing.Kind == "work" {
			// 已导入过：补齐**当时缺失**的元数据（原语言/别名/官网/品番/日期），
			// 便于老条目增量补录；已有值一律不覆盖，避免抹掉人工编辑。
			merged, changed := mergeWorkMetadata(existing, req.Work)
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
		work, err := buildWorkEntity(req.Work, workType, source, key, req.ExternalID, hasKey)
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
				agentByKey[dedup] = existing
				if strings.TrimSpace(assoc.RelationType) == "character_in" {
					characterByName[strings.ToLower(name)] = existing
				}
				continue
			}
		} else if existing, ok := s.findAgentByTitle(ctx, name, &actor); ok {
			// 无外部键的关联（手工载荷）按标题复用，避免重复导入产生同名 agent。
			agentByKey[dedup] = existing
			if strings.TrimSpace(assoc.RelationType) == "character_in" {
				characterByName[strings.ToLower(name)] = existing
			}
			continue
		}
		staff := Entity{
			Kind:             "agent",
			Title:            name,
			OriginalLanguage: originalLanguageOrEmpty(assoc.Country),
			Translations:     toEntityTranslations(assoc.Translations),
			Types:            []string{entityType},
			Attributes:       map[string]any{},
			ExternalIDs:      stringScalarMap(assoc.ExternalIDs),
		}
		if p, ok := pictureFromRemote(assoc.AvatarURL, "Bangumi 头像", "", false); ok {
			staff.Pictures = []Picture{p}
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
			continue
		}
		relType := strings.TrimSpace(assoc.RelationType)
		if relType == "" {
			continue
		}
		if _, ok := relDefs.Document.Relations[relType]; !ok {
			continue // 无此关系定义：不虚构，跳过
		}
		agent, ok := agentByKey[assocAgentDedup(assoc)]
		if !ok {
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
				continue
			}
			return ImporterImportResponse{}, rerr
		}
		counts.Relations++
	}
	out.ImportedCounts.Artists = counts.Artists
	out.ImportedCounts.Relations = counts.Relations
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
	// 发行链统计需保留已建的关联计数，否则响应会把关联上报成 0。
	rcounts.Artists = counts.Artists
	rcounts.Relations = counts.Relations
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
