package catalog

// 旧前端 /works/[id] 页兼容层：新轨没有 /catalog/works/:id 系列路由，而导入器
// 返回的落点与页面数据源都指到这里。把新轨 Work 实体、关系与内容树映射为旧
// Work / WorkContentsResponse / graph JSON 形状，只读不写；页面整体迁移到
// /catalog/entities 数据源后删除本文件。

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

// agentCompatType 把 agent definitions 类型映射到旧前端 entity_type 词表；
// StaffCharacterSection 以 virtual_character 识别角色卡。
func agentCompatType(a Entity) string {
	for _, t := range a.Types {
		if t == "character" {
			return "virtual_character"
		}
	}
	if len(a.Types) > 0 {
		return a.Types[0]
	}
	return "person"
}

func entityCover(e Entity) string {
	if len(e.Pictures) > 0 {
		return e.Pictures[0].URL
	}
	return ""
}

// entitySummary 取原语言简介，缺失时回退任一非空简介；新轨没有顶层 summary。
func entitySummary(e Entity) string {
	if e.OriginalLanguage != "" {
		if tr, ok := e.Translations[e.OriginalLanguage]; ok && tr.Summary != "" {
			return tr.Summary
		}
	}
	for _, tr := range e.Translations {
		if tr.Summary != "" {
			return tr.Summary
		}
	}
	return ""
}

func entityTranslationsArray(e Entity) []map[string]any {
	locales := make([]string, 0, len(e.Translations))
	for loc := range e.Translations {
		locales = append(locales, loc)
	}
	sort.Strings(locales)
	out := make([]map[string]any, 0, len(locales))
	for _, loc := range locales {
		tr := e.Translations[loc]
		m := map[string]any{"locale": loc, "title": tr.Title}
		if tr.Summary != "" {
			m["summary"] = tr.Summary
		}
		if len(tr.Aliases) > 0 {
			m["aliases"] = tr.Aliases
		}
		out = append(out, m)
	}
	return out
}

// resolveRelated 批量解析关系对端实体（上限 n），失败的对端跳过。
// u 用请求方身份，保证草稿实体的创建者/管理员能看到自己的关系对端。
func (h HTTP) resolveRelated(ctx context.Context, selfID string, rels []Relation, n int, u *User) map[string]Entity {
	out := map[string]Entity{}
	ids := make([]string, 0, len(rels))
	seen := map[string]bool{selfID: true}
	for _, r := range rels {
		other := r.TargetID
		if r.SourceID != selfID {
			other = r.SourceID
		}
		if other == "" || seen[other] {
			continue
		}
		seen[other] = true
		ids = append(ids, other)
	}
	for i, id := range ids {
		if i >= n {
			break
		}
		if e, err := h.Store.Get(ctx, id, u); err == nil {
			out[id] = e
		}
	}
	return out
}

func (h HTTP) resolveWork(c *gin.Context) (Entity, bool) {
	e, err := h.Store.Resolve(c.Request.Context(), c.Param("id"), user(c))
	if err != nil {
		respond(c, nil, err)
		return Entity{}, false
	}
	if e.Kind != "work" {
		respond(c, nil, fmt.Errorf("invalid_kind"))
		return Entity{}, false
	}
	return e, true
}

func (h HTTP) worksDetail(c *gin.Context) {
	e, ok := h.resolveWork(c)
	if !ok {
		return
	}
	rels, err := h.Store.Relations(c.Request.Context(), e.ID, user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	others := h.resolveRelated(c.Request.Context(), e.ID, rels, 30, user(c))
	respond(c, workCompatPayload(e, rels, others, h.relationLabels(c.Request.Context(), requestLocale(c))), nil)
}

// relationLabels 把关系 code 映射为服务端 definitions 的本地化名称，供旧前端展示；
// 未命中保留 code（不虚构译名）。locale 精确匹配优先，再按 zh-CN/en-US 回退。
func (h HTTP) relationLabels(ctx context.Context, locale string) map[string]string {
	out := map[string]string{}
	d, err := h.Store.Definitions(ctx)
	if err != nil {
		return out
	}
	pick := func(n Names) string {
		for _, key := range []string{locale, "zh-CN", "en-US"} {
			if key != "" {
				if v := strings.TrimSpace(n[key]); v != "" {
					return v
				}
			}
		}
		return ""
	}
	for code, r := range d.Document.Relations {
		if name := pick(r.Names); name != "" {
			out[code] = name
		}
	}
	return out
}

// requestLocale 取 Accept-Language 主标签，如 "zh-CN,zh;q=0.9" → "zh-CN"。
func requestLocale(c *gin.Context) string {
	v := c.GetHeader("Accept-Language")
	if i := strings.IndexAny(v, ",;"); i >= 0 {
		v = v[:i]
	}
	return strings.TrimSpace(v)
}

// workCompatPayload 把新轨 Work 实体与关系映射为旧 Work JSON 形状（纯函数，便于测试）。
// labels 为关系 code → 本地化名称；缺省回退 code。
func workCompatPayload(e Entity, rels []Relation, others map[string]Entity, labels map[string]string) map[string]any {
	relName := func(code string) string {
		if labels != nil {
			if n, ok := labels[code]; ok && n != "" {
				return n
			}
		}
		return code
	}
	artistRels := []map[string]any{}
	connected := []map[string]any{}
	for _, r := range rels {
		if r.SourceID == e.ID {
			if target, ok := others[r.TargetID]; ok && target.Kind == "agent" {
				role := relName(r.Type)
				if r.Type == "voiced_by" {
					if ch, _ := r.Attributes["character"].(string); strings.TrimSpace(ch) != "" {
						// 旧前端 StaffCharacterSection 以 "配演: <角色>" 正则配对角色与声优
						role = "配音: 配演: " + ch
					}
				}
				artistRels = append(artistRels, map[string]any{
					"id": r.ID, "work_id": e.ID, "artist_id": r.TargetID, "role": role,
					"artist": map[string]any{
						"id": target.ID, "name": target.Title,
						"avatar_url": entityCover(target), "entity_type": agentCompatType(target),
					},
				})
			}
		}
		otherID, direction := r.TargetID, "forward"
		if r.SourceID != e.ID {
			otherID, direction = r.SourceID, "reverse"
		}
		if other, ok := others[otherID]; ok {
			connected = append(connected, map[string]any{
				"entity_id": otherID, "entity_name": other.Title, "entity_type": other.Kind,
				"relationship_type": r.Type, "relationship_name": relName(r.Type),
				"direction": direction, "label": relName(r.Type),
			})
		}
	}

	return map[string]any{
		"id": e.ID, "title": e.Title, "status": e.Status,
		"original_language":  e.OriginalLanguage,
		"summary":            entitySummary(e),
		"cover_image_url":    entityCover(e),
		"view_count":         0,
		"external_ids":       e.ExternalIDs,
		"attributes":         e.Attributes,
		"catalog_metadata":   e.Attributes["catalog_metadata"],
		"tags":               []any{},
		"translations":       entityTranslationsArray(e),
		"artist_relations":   artistRels,
		"connected_entities": connected,
		"created_by":         e.CreatedBy,
		"updated_at":         e.UpdatedAt,
	}
}

func (h HTTP) worksGraph(c *gin.Context) {
	e, ok := h.resolveWork(c)
	if !ok {
		return
	}
	rels, err := h.Store.Relations(c.Request.Context(), e.ID, user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	others := h.resolveRelated(c.Request.Context(), e.ID, rels, 30, user(c))
	labels := h.relationLabels(c.Request.Context(), requestLocale(c))

	nodes := []map[string]any{
		{"id": e.ID, "name": e.Title, "type": "work", "category": "work", "level": 0, "cover_image_url": entityCover(e), "status": e.Status},
	}
	links := []map[string]any{}
	inGraph := map[string]bool{e.ID: true}
	for _, r := range rels {
		otherID, srcID, tgtID := r.TargetID, r.SourceID, r.TargetID
		if r.SourceID != e.ID {
			otherID, srcID, tgtID = r.SourceID, r.SourceID, e.ID
		}
		other, ok := others[otherID]
		if !ok {
			continue
		}
		if !inGraph[otherID] {
			inGraph[otherID] = true
			nodes = append(nodes, map[string]any{
				"id": otherID, "name": other.Title, "type": other.Kind, "category": other.Kind,
				"level": 1, "cover_image_url": entityCover(other), "status": other.Status,
			})
		}
		label := r.Type
		if n, ok := labels[r.Type]; ok && n != "" {
			label = n
		}
		links = append(links, map[string]any{
			"source": srcID, "target": tgtID, "type": r.Type, "label": label,
			"source_type": "work", "target_type": other.Kind,
		})
	}
	respond(c, gin.H{"nodes": nodes, "links": links}, nil)
}

func (h HTTP) worksContents(c *gin.Context) {
	e, ok := h.resolveWork(c)
	if !ok {
		return
	}
	units, err := h.Store.ListAll(c.Request.Context(), ListOptions{Kind: "content_unit", WorkID: e.ID, Limit: 1000}, user(c))
	if err != nil {
		respond(c, nil, err)
		return
	}
	kind := "content_unit"
	if len(units) == 0 {
		// 无卷章树的 Work（如 OST）回退列 expression，页面仍有内容可看。
		units, err = h.Store.ListAll(c.Request.Context(), ListOptions{Kind: "expression", WorkID: e.ID, Limit: 1000}, user(c))
		if err != nil {
			respond(c, nil, err)
			return
		}
		kind = "expression"
	}
	items := make([]map[string]any, 0, len(units))
	for _, u := range units {
		translations := map[string]any{}
		for loc, tr := range u.Translations {
			translations[loc] = map[string]any{"title": tr.Title}
		}
		role, _ := u.Attributes["role"].(string)
		items = append(items, map[string]any{
			"id": u.ID, "parent_id": u.ParentID, "position": u.Position,
			"number": u.Number, "entry_role": role, "kind": kind,
			"original_language": u.OriginalLanguage, "title": u.Title,
			"translations": translations,
			"duration":     u.Attributes["duration"],
		})
	}
	respond(c, gin.H{"items": items, "total": len(items)}, nil)
}
