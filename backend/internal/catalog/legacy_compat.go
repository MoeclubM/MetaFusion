package catalog

// 旧前端其余详情页的只读兼容层：新轨只注册 /catalog/entities 与 /catalog/works/:id，
// 但 /artists/[id]、/franchises/[id]、/mediums/[id]、/canonical-entries/[id] 等页面
// 仍调用旧接口，线上实测 404。这里把新轨 agent / collection / medium / content_unit /
// expression 实体与 definitions 映射为旧 DTO 形状，全部只读；页面整体迁移到
// /catalog/entities 数据源后删除本文件。

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

// ---- 通用映射辅助 ----

func sortedStringKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// localizedName 按请求语言 → zh-CN → en-US → 任意非空取值表名称。
func localizedName(n Names, locale string) string {
	for _, key := range []string{locale, "zh-CN", "en-US"} {
		if key == "" {
			continue
		}
		if v := strings.TrimSpace(n[key]); v != "" {
			return v
		}
	}
	for _, v := range n {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// localizedEntityTitle 按请求语言取实体题名，缺翻译时回退基础题名。
func localizedEntityTitle(e Entity, locale string) string {
	for _, key := range []string{locale, "zh-CN", "en-US", e.OriginalLanguage} {
		if key == "" {
			continue
		}
		if tr, ok := e.Translations[key]; ok {
			if t := strings.TrimSpace(tr.Title); t != "" {
				return t
			}
		}
	}
	return e.Title
}

func originalTitleOf(e Entity) string {
	if tr, ok := e.Translations[e.OriginalLanguage]; ok && strings.TrimSpace(tr.Title) != "" {
		return tr.Title
	}
	return e.Title
}

// originalTitleIfDifferent 仅在原语言题名与基础题名不同时返回，避免旧前端重复展示。
func originalTitleIfDifferent(e Entity) string {
	if t := originalTitleOf(e); t != "" && t != e.Title {
		return t
	}
	return ""
}

// dictTerm 生成旧 DictTerm 形状；name 按 locale 本地化，name_zh/name_en 固定双语。
func dictTerm(id string, n Names, locale string) map[string]any {
	return map[string]any{
		"id":      id,
		"name":    localizedName(n, locale),
		"name_zh": n["zh-CN"],
		"name_en": n["en-US"],
	}
}

// entityTranslationTitles 生成 CanonicalEntry 形状的 translations 对象（按 locale 分组）。
func entityTranslationTitles(e Entity) map[string]any {
	out := map[string]any{}
	for loc, tr := range e.Translations {
		if t := strings.TrimSpace(tr.Title); t != "" {
			out[loc] = map[string]any{"title": t}
		}
	}
	return out
}

// entityTranslationNames 生成 Medium 形状的 translations 对象（按 locale 分组）。
func entityTranslationNames(e Entity) map[string]any {
	out := map[string]any{}
	for loc, tr := range e.Translations {
		if t := strings.TrimSpace(tr.Title); t != "" {
			out[loc] = map[string]any{"name": t}
		}
	}
	return out
}

func emptyToNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func stringAttr(e Entity, key string) string {
	v, _ := e.Attributes[key].(string)
	return v
}

// artistCompatEntityType 按新轨 agent types 映射旧 entity_type 词表。
func artistCompatEntityType(e Entity) string {
	for _, t := range e.Types {
		switch t {
		case "character":
			return "virtual_character"
		case "group":
			return "group"
		case "organization":
			return "organization"
		}
	}
	return "person"
}

// workCompatShort 旧页面只读简版 Work，translations 保持数组以配合前端 pickLocalized。
func workCompatShort(e Entity) map[string]any {
	return map[string]any{
		"id":                e.ID,
		"title":             e.Title,
		"original_title":    originalTitleIfDifferent(e),
		"cover_image_url":   entityCover(e),
		"cover_aspect":      "",
		"summary":           entitySummary(e),
		"status":            e.Status,
		"original_language": e.OriginalLanguage,
		"translations":      entityTranslationsArray(e),
		"tags":              []any{},
		"artist_relations":  []any{},
	}
}

// connectedCompatItem 旧 ConnectedEntityItem 形状。
func connectedCompatItem(other Entity, r Relation, direction, label string) map[string]any {
	return map[string]any{
		"entity_id":         other.ID,
		"entity_name":       other.Title,
		"entity_type":       other.Kind,
		"cover_url":         entityCover(other),
		"relationship_type": r.Type,
		"relationship_name": label,
		"direction":         direction,
		"label":             label,
		"is_current":        true,
		"attributes":        map[string]any{},
		"color":             "",
		"icon":              "",
	}
}

// relationPair 给出关系对端实体与方向（forward = 本实体为 source）。
func relationPair(self Entity, r Relation, others map[string]Entity) (Entity, string, bool) {
	otherID, direction := r.TargetID, "forward"
	if r.SourceID != self.ID {
		otherID, direction = r.SourceID, "reverse"
	}
	other, ok := others[otherID]
	return other, direction, ok
}

func relationLabel(labels map[string]string, code string) string {
	if n := labels[code]; n != "" {
		return n
	}
	return code
}

// ---- 词表与字典 ----

func languageDisplayName(code string) string {
	switch code {
	case "zh-CN":
		return "简体中文"
	case "zh-TW", "zh-Hant":
		return "繁體中文"
	case "zh":
		return "中文"
	case "ja", "ja-JP":
		return "日本語"
	case "ko":
		return "한국어"
	case "en-US":
		return "English"
	}
	return code
}

func (h HTTP) taxonomyCompat(c *gin.Context) {
	d, err := h.Store.Definitions(c.Request.Context())
	if err != nil {
		respond(c, nil, err)
		return
	}
	doc := d.Document
	locale := requestLocale(c)

	mediaTypes, entityTypes := []map[string]any{}, []map[string]any{}
	for _, code := range sortedStringKeys(doc.Types) {
		t := doc.Types[code]
		if !t.Enabled {
			continue
		}
		switch {
		case contains(t.Kinds, "work"):
			mediaTypes = append(mediaTypes, dictTerm(code, t.Names, locale))
		case contains(t.Kinds, "agent"):
			entityTypes = append(entityTypes, dictTerm(code, t.Names, locale))
		}
	}
	vocab := func(code string) []map[string]any {
		v, ok := doc.Vocabularies[code]
		if !ok {
			return []map[string]any{}
		}
		out := []map[string]any{}
		for _, term := range sortedStringKeys(v.Terms) {
			t := v.Terms[term]
			if !t.Enabled {
				continue
			}
			out = append(out, dictTerm(term, t.Names, locale))
		}
		return out
	}
	roles := vocab("role")
	packagings := vocab("packaging")
	formats := vocab("format")

	// languages：汇总 definitions 出现过的 locale（词表/类型/关系名），补常见项。
	langSet := map[string]bool{"zh-CN": true, "zh-TW": true, "ja": true, "en-US": true}
	addNames := func(n Names) {
		for k := range n {
			if strings.TrimSpace(k) != "" {
				langSet[k] = true
			}
		}
	}
	for _, t := range doc.Types {
		addNames(t.Names)
	}
	for _, v := range doc.Vocabularies {
		addNames(v.Names)
		for _, t := range v.Terms {
			addNames(t.Names)
		}
	}
	for _, r := range doc.Relations {
		addNames(r.Names)
		addNames(r.ReverseNames)
		addNames(r.GroupNames)
	}
	languages := []map[string]any{}
	for _, code := range sortedStringKeys(langSet) {
		languages = append(languages, map[string]any{"code": code, "name": languageDisplayName(code)})
	}

	respond(c, gin.H{
		"media_types":      mediaTypes,
		"media_categories": mediaTypes,
		"entity_types":     entityTypes,
		"roles":            roles,
		"packagings":       packagings,
		"packaging_types":  packagings,
		"formats":          formats,
		"medium_formats":   formats,
		"languages":        languages,
	}, nil)
}

func (h HTTP) tagsCompat(c *gin.Context) {
	// 新轨无标签字典；返回空集合，不造假数据。
	respond(c, gin.H{"items": []any{}, "total": 0}, nil)
}

func (h HTTP) relationTypesCompat(c *gin.Context) {
	d, err := h.Store.Definitions(c.Request.Context())
	if err != nil {
		respond(c, nil, err)
		return
	}
	domain := strings.TrimSpace(c.Query("domain"))
	items := []map[string]any{}
	for i, code := range sortedStringKeys(d.Document.Relations) {
		r := d.Document.Relations[code]
		if !r.Enabled {
			continue
		}
		if domain != "" && r.Group != domain {
			continue
		}
		isTemporal := contains(r.Fields, "begin_date") || contains(r.Fields, "end_date")
		items = append(items, map[string]any{
			"code":                 code,
			"domain":               r.Group,
			"name_zh":              r.Names["zh-CN"],
			"name_en":              r.Names["en-US"],
			"names":                r.Names,
			"description":          "",
			"forward_label_zh":     r.Names["zh-CN"],
			"reverse_label_zh":     r.ReverseNames["zh-CN"],
			"forward_label_en":     r.Names["en-US"],
			"reverse_label_en":     r.ReverseNames["en-US"],
			"allowed_source_types": r.SourceKinds,
			"allowed_target_types": r.TargetKinds,
			"is_symmetric":         r.Symmetric,
			"is_hierarchical":      r.Acyclic,
			"is_temporal":          isTemporal,
			"attribute_schema":     map[string]any{"fields": r.Fields},
			"color":                "",
			"icon":                 "",
			"sort_order":           i,
			"is_system":            true,
			"is_enabled":           r.Enabled,
			"display_name":         localizedName(r.Names, requestLocale(c)),
			"forward_label":        r.Names["zh-CN"],
			"reverse_label":        r.ReverseNames["zh-CN"],
		})
	}
	respond(c, gin.H{"items": items, "total": len(items)}, nil)
}

// ---- Artist ----

func (h HTTP) artistsCompat(c *gin.Context) {
	ctx := c.Request.Context()
	e, err := h.Store.Resolve(ctx, c.Param("id"), user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	if e.Kind != "agent" {
		respond(c, nil, fmt.Errorf("invalid_kind"))
		return
	}
	rels, err := h.Store.Relations(ctx, e.ID, user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	others := h.resolveRelated(ctx, e.ID, rels, user(c))
	labels := h.relationLabels(ctx, requestLocale(c))

	works := []map[string]any{}
	connected := []map[string]any{}
	for _, r := range rels {
		other, direction, ok := relationPair(e, r, others)
		if !ok {
			continue
		}
		label := relationLabel(labels, r.Type)
		connected = append(connected, connectedCompatItem(other, r, direction, label))
		if other.Kind == "work" {
			w := workCompatShort(other)
			w["role"] = label
			w["release_date"] = other.Attributes["edition_date"]
			w["view_count"] = 0
			works = append(works, w)
		}
	}

	artist := map[string]any{
		"id":                e.ID,
		"name":              e.Title,
		"original_name":     originalTitleIfDifferent(e),
		"disambiguation":    stringAttr(e, "disambiguation"),
		"entity_type":       artistCompatEntityType(e),
		"avatar_url":        entityCover(e),
		"country":           stringAttr(e, "country"),
		"biography":         entitySummary(e),
		"original_language": e.OriginalLanguage,
		"external_ids":      e.ExternalIDs,
		"attributes":        e.Attributes,
		"translations":      entityTranslationsArray(e),
		"tags":              []any{},
		"created_at":        createdOrUpdated(e),
		"updated_at":        e.UpdatedAt,
	}
	respond(c, gin.H{
		"artist":             artist,
		"works":              works,
		"releases":           []any{},
		"connected_entities": connected,
		"external_links":     []any{},
	}, nil)
}

// createdOrUpdated 新轨 Entity 无独立 created_at 列，读属性回退 updated_at。
func createdOrUpdated(e Entity) any {
	if v, ok := e.Attributes["created_at"]; ok && v != nil {
		return v
	}
	return e.UpdatedAt
}

// ---- Franchise ----

func (h HTTP) franchisesCompat(c *gin.Context) {
	ctx := c.Request.Context()
	e, err := h.Store.Resolve(ctx, c.Param("id"), user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	if e.Kind != "collection" {
		respond(c, nil, fmt.Errorf("invalid_kind"))
		return
	}
	rels, err := h.Store.Relations(ctx, e.ID, user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	others := h.resolveRelated(ctx, e.ID, rels, user(c))
	labels := h.relationLabels(ctx, requestLocale(c))

	parents, children, works, agents, connected := []map[string]any{}, []map[string]any{}, []map[string]any{}, []map[string]any{}, []map[string]any{}
	for _, r := range rels {
		other, direction, ok := relationPair(e, r, others)
		if !ok {
			continue
		}
		label := relationLabel(labels, r.Type)
		connected = append(connected, connectedCompatItem(other, r, direction, label))
		switch other.Kind {
		case "collection":
			item := map[string]any{"id": other.ID, "title": other.Title, "original_title": originalTitleIfDifferent(other)}
			if direction == "forward" {
				children = append(children, item)
			} else {
				parents = append(parents, item)
			}
		case "work":
			works = append(works, workCompatShort(other))
		case "agent":
			agents = append(agents, map[string]any{
				"id": other.ID, "name": other.Title,
				"original_name": originalTitleIfDifferent(other),
				"entity_type":   artistCompatEntityType(other),
				"avatar_url":    entityCover(other),
			})
		}
	}

	franchise := map[string]any{
		"id":                e.ID,
		"title":             e.Title,
		"original_title":    originalTitleIfDifferent(e),
		"summary":           entitySummary(e),
		"cover_image_url":   entityCover(e),
		"original_language": e.OriginalLanguage,
		"external_ids":      e.ExternalIDs,
		"attributes":        e.Attributes,
		"translations":      entityTranslationsArray(e),
		"tags":              []any{},
		"created_at":        createdOrUpdated(e),
	}
	respond(c, gin.H{
		"franchise":          franchise,
		"parents":            parents,
		"children":           children,
		"works":              works,
		"agents":             agents,
		"connected_entities": connected,
		"relations":          []any{},
	}, nil)
}

// ---- Medium ----

func (h HTTP) mediumsCompat(c *gin.Context) {
	ctx := c.Request.Context()
	e, err := h.Store.Resolve(ctx, c.Param("id"), user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	if e.Kind != "medium" {
		respond(c, nil, fmt.Errorf("invalid_kind"))
		return
	}
	locale := requestLocale(c)
	trackEntities, err := h.Store.ListAll(ctx, ListOptions{Kind: "track", MediumID: e.ID, Limit: 1000}, user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	tracks := []map[string]any{}
	for _, t := range trackEntities {
		track := map[string]any{
			"id":                t.ID,
			"medium_id":         t.MediumID,
			"parent_id":         emptyToNil(t.ParentID),
			"position":          t.Position,
			"number":            t.Number,
			"title":             t.Title,
			"original_language": t.OriginalLanguage,
			"translations":      entityTranslationTitles(t),
			"localized_title":   localizedEntityTitle(t, locale),
			"duration_seconds":  t.Attributes["duration"],
			"artist_credit":     stringAttr(t, "artist_credit"),
			"isrc":              stringAttr(t, "isrc"),
		}
		contents := []map[string]any{}
		for _, inc := range t.Contents {
			ex, err := h.Store.Get(ctx, inc.ExpressionID, user(c))
			if err != nil {
				continue
			}
			contents = append(contents, map[string]any{
				"id":                 inc.ExpressionID,
				"track_id":           t.ID,
				"canonical_entry_id": inc.ExpressionID,
				"position":           inc.Position,
				"locator":            inc.Locator,
				"canonical_entry":    canonicalEntryCompatPayload(ex),
			})
		}
		track["contents"] = contents
		tracks = append(tracks, track)
	}

	medium := map[string]any{
		"id":                e.ID,
		"release_id":        e.ReleaseID,
		"parent_id":         emptyToNil(e.ParentID),
		"position":          e.Position,
		"number":            e.Number,
		"name":              e.Title,
		"format":            stringAttr(e, "format"),
		"role":              stringAttr(e, "role"),
		"media_category":    "",
		"track_count":       len(tracks),
		"original_language": e.OriginalLanguage,
		"translations":      entityTranslationNames(e),
		"localized_name":    localizedEntityTitle(e, locale),
		"attributes":        e.Attributes,
		"tracks":            tracks,
	}

	release := map[string]any{}
	if e.ReleaseID != "" {
		if rel, err := h.Store.Get(ctx, e.ReleaseID, user(c)); err == nil {
			release = h.releaseCompatPayload(ctx, rel, user(c), locale)
		}
	}
	respond(c, gin.H{"medium": medium, "release": release}, nil)
}

func (h HTTP) releaseCompatPayload(ctx context.Context, rel Entity, u *User, locale string) map[string]any {
	out := map[string]any{
		"id":                     rel.ID,
		"edition_name":           rel.Title,
		"localized_edition_name": localizedEntityTitle(rel, locale),
		"cover_image_url":        entityCover(rel),
		"original_language":      rel.OriginalLanguage,
		"external_ids":           rel.ExternalIDs,
		"attributes":             rel.Attributes,
		"translations":           entityTranslationNames(rel),
		"work_id":                "",
		"work":                   map[string]any{},
	}
	// release 的 WorkID 在落库时清空，唯一来源是 release_subjects。
	if len(rel.Subjects) > 0 {
		out["work_id"] = rel.Subjects[0].WorkID
		if w, err := h.Store.Get(ctx, rel.Subjects[0].WorkID, u); err == nil {
			out["work"] = workCompatShort(w)
		}
	}
	return out
}

// ---- CanonicalEntry (content_unit / expression) ----

func canonicalEntryCompatPayload(e Entity) map[string]any {
	role, _ := e.Attributes["role"].(string)
	return map[string]any{
		"id":                e.ID,
		"kind":              e.Kind,
		"parent_id":         emptyToNil(e.ParentID),
		"position":          e.Position,
		"number":            e.Number,
		"title":             e.Title,
		"original_title":    originalTitleIfDifferent(e),
		"entry_role":        role,
		"original_language": e.OriginalLanguage,
		"translations":      entityTranslationTitles(e),
		"work_id":           e.WorkID,
		"duration":          e.Attributes["duration"],
		"duration_seconds":  e.Attributes["duration"],
		"isrc":              stringAttr(e, "isrc"),
		"isbn":              stringAttr(e, "isbn"),
		"artist_credit":     stringAttr(e, "artist_credit"),
		"attributes":        e.Attributes,
		"external_ids":      e.ExternalIDs,
		"contents":          []any{},
	}
}

func (h HTTP) canonicalEntriesCompat(c *gin.Context) {
	ctx := c.Request.Context()
	e, err := h.Store.Resolve(ctx, c.Param("id"), user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	if e.Kind != "content_unit" && e.Kind != "expression" {
		respond(c, nil, fmt.Errorf("invalid_kind"))
		return
	}
	entry := canonicalEntryCompatPayload(e)

	// 只有 content_unit 承载下级目录；expression 的 contents 为空。
	contents := []map[string]any{}
	if e.Kind == "content_unit" {
		children, err := h.Store.ListAll(ctx, ListOptions{Kind: "content_unit", ParentID: e.ID, Limit: 1000}, user(c))
		if err != nil {
			respond(c, nil, err)
			return
		}
		for _, ch := range children {
			contents = append(contents, canonicalEntryCompatPayload(ch))
		}
		exprs, err := h.Store.ListAll(ctx, ListOptions{Kind: "expression", ContentUnitID: e.ID, Limit: 1000}, user(c))
		if err != nil {
			respond(c, nil, err)
			return
		}
		for _, ex := range exprs {
			contents = append(contents, canonicalEntryCompatPayload(ex))
		}
	}
	entry["contents"] = contents

	work := map[string]any{}
	if e.WorkID != "" {
		if w, err := h.Store.Get(ctx, e.WorkID, user(c)); err == nil {
			work = workCompatShort(w)
		}
	}
	entry["work"] = work

	relEntities, err := h.Store.Relations(ctx, e.ID, user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	others := h.resolveRelated(ctx, e.ID, relEntities, user(c))
	labels := h.relationLabels(ctx, requestLocale(c))
	connected := []map[string]any{}
	for _, r := range relEntities {
		other, direction, ok := relationPair(e, r, others)
		if !ok {
			continue
		}
		connected = append(connected, connectedCompatItem(other, r, direction, relationLabel(labels, r.Type)))
	}
	entry["connected_entities"] = connected
	entry["releases"] = []any{}
	entry["tracks"] = []any{}
	entry["relations"] = []any{}
	entry["revisions"] = []any{}
	entry["external_links"] = []any{}
	respond(c, entry, nil)
}

// ---- 占位 ----

func (h HTTP) worksCommentsCompat(c *gin.Context) {
	// 新轨评论走 /community/entities/:id/posts；此处仅占位，避免旧页面 404 崩页。
	respond(c, []any{}, nil)
}
