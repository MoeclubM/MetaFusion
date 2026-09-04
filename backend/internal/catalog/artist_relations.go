package catalog

import (
	"strings"

	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
	"gorm.io/gorm"
)

// 署名（credits）单轨化：作品「谁参与」的唯一事实源是 entity_relationships 图边
// （agent_work 域关系 + 导入器历史写入的 artist->work 兼容边）。
// work_artist_relations 旧表不再写入，读侧一律经此处投影为旧 JSON 形状
// （[]WorkArtistRelation：WorkID/ArtistID/Role/Artist），前端无需改动。

// 兼容边：导入器对声优/未匹配角色会写 artist->work 的 voice_actor_of / creator_of 边，
// 不在 agent_work 域内，但仍是署名语义，投影时并入。
var artistWorkCompatEdgeTypes = []string{"voice_actor_of", "creator_of"}

// AgentWorkRoleCodes 返回启用的 agent_work 域关系 code 集合（与 GetTaxonomy roles 字典同源），
// 附加导入器兼容边类型。结果已按 sort_order/code 排序，保持投影顺序稳定。
func AgentWorkRoleCodes(db *gorm.DB) []string {
	codes := make([]string, 0, 16)
	_ = db.Model(&models.RelationType{}).
		Where("domain = ? AND is_enabled = ?", "agent_work", true).
		Order("sort_order asc, code asc").
		Pluck("code", &codes).Error
	return append(codes, artistWorkCompatEdgeTypes...)
}

// artistWorkEdges 查询署名图边并按 (artist, 关系类型) 去重：
// 旧双轨期同一 person 可能同时存在 qualifier 为空（mirror 写入）与非空
// （导入器写入，保留「主角 / Voice Actor (as X)」等展示语义）的两条边，非空优先。
func artistWorkEdges(db *gorm.DB, workIDs []uuid.UUID, artistID *uuid.UUID) ([]models.EntityRelationship, error) {
	q := db.Where("source_type = 'artist' AND target_type = 'work' AND relationship_type IN ?", AgentWorkRoleCodes(db))
	if len(workIDs) == 1 {
		q = q.Where("target_id = ?", workIDs[0])
	} else if len(workIDs) > 1 {
		q = q.Where("target_id IN ?", workIDs)
	}
	if artistID != nil {
		q = q.Where("source_id = ?", *artistID)
	}
	var edges []models.EntityRelationship
	if err := q.Order("created_at asc").Find(&edges).Error; err != nil {
		return nil, err
	}

	type dedupKey struct {
		artist uuid.UUID
		code   string
	}
	seen := make(map[dedupKey]int, len(edges))
	out := edges[:0:0]
	for _, e := range edges {
		k := dedupKey{e.SourceID, e.RelationshipType}
		if idx, ok := seen[k]; ok {
			if strings.TrimSpace(out[idx].Qualifier) == "" && strings.TrimSpace(e.Qualifier) != "" {
				out[idx] = e
			}
			continue
		}
		seen[k] = len(out)
		out = append(out, e)
	}
	return out, nil
}

// EdgeDisplayRole 投影 Role 取值：qualifier 有值时优先——保留导入器写入的
// 「主角 / 配角 / Voice Actor (as X)」等展示语义（前端 isCastRole / 角色徽章依赖）；
// 否则回落 relationship_type（agent_work code，可被前端 roleLabel 本地化）。
func EdgeDisplayRole(e models.EntityRelationship) string {
	if q := strings.TrimSpace(e.Qualifier); q != "" {
		return q
	}
	return e.RelationshipType
}

// loadArtistsForEdges 批量加载署名边源实体（含多语言翻译，对齐旧 Preload 行为）
func loadArtistsForEdges(db *gorm.DB, edges []models.EntityRelationship) map[uuid.UUID]*models.Artist {
	ids := make([]uuid.UUID, 0, len(edges))
	seen := make(map[uuid.UUID]bool, len(edges))
	for _, e := range edges {
		if !seen[e.SourceID] {
			seen[e.SourceID] = true
			ids = append(ids, e.SourceID)
		}
	}
	artistMap := make(map[uuid.UUID]*models.Artist, len(ids))
	if len(ids) == 0 {
		return artistMap
	}
	var artists []models.Artist
	if err := db.Preload("Translations").Where("id IN ?", ids).Find(&artists).Error; err != nil {
		return artistMap
	}
	for i := range artists {
		a := artists[i]
		artistMap[a.ID] = &a
	}
	return artistMap
}

// ProjectWorkArtistRelations 把某作品的署名图边投影为旧版 artist_relations 形状。
func ProjectWorkArtistRelations(db *gorm.DB, workID uuid.UUID) []models.WorkArtistRelation {
	edges, err := artistWorkEdges(db, []uuid.UUID{workID}, nil)
	if err != nil {
		return []models.WorkArtistRelation{}
	}
	return projectRelations(db, edges, workID)
}

// projectRelations 将去重后的边转换为 WorkArtistRelation 切片（ID 为投影序号，仅用于前端 key）
func projectRelations(db *gorm.DB, edges []models.EntityRelationship, workID uuid.UUID) []models.WorkArtistRelation {
	artistMap := loadArtistsForEdges(db, edges)
	out := make([]models.WorkArtistRelation, 0, len(edges))
	for i, e := range edges {
		rel := models.WorkArtistRelation{
			ID:        uint(i + 1),
			WorkID:    workID,
			ArtistID:  e.SourceID,
			Role:      EdgeDisplayRole(e),
			BeginDate: e.BeginDate,
			EndDate:   e.EndDate,
			Ended:     e.Ended,
			Artist:    artistMap[e.SourceID],
		}
		out = append(out, rel)
	}
	return out
}

// AttachWorkArtistRelations 批量为值切片作品填充投影后的 artist_relations（单查询，避免 N+1）
func AttachWorkArtistRelations(db *gorm.DB, works []models.Work) {
	ptrs := make([]*models.Work, len(works))
	for i := range works {
		ptrs[i] = &works[i]
	}
	AttachWorkArtistRelationsPtr(db, ptrs)
}

// AttachWorkArtistRelationsPtr 指针版批量填充（用于嵌入在 Release 等结构里的 *Work）
func AttachWorkArtistRelationsPtr(db *gorm.DB, works []*models.Work) {
	if len(works) == 0 {
		return
	}
	ids := make([]uuid.UUID, 0, len(works))
	seen := make(map[uuid.UUID]bool, len(works))
	for _, w := range works {
		if w != nil && !seen[w.ID] {
			seen[w.ID] = true
			ids = append(ids, w.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	edges, err := artistWorkEdges(db, ids, nil)
	if err != nil {
		return
	}
	artistMap := loadArtistsForEdges(db, edges)
	byWork := make(map[uuid.UUID][]models.EntityRelationship, len(ids))
	for _, e := range edges {
		byWork[e.TargetID] = append(byWork[e.TargetID], e)
	}
	seq := 0
	for _, w := range works {
		if w == nil {
			continue
		}
		w.ArtistRelations = make([]models.WorkArtistRelation, 0, len(byWork[w.ID]))
		for _, e := range byWork[w.ID] {
			seq++
			w.ArtistRelations = append(w.ArtistRelations, models.WorkArtistRelation{
				ID:        uint(seq),
				WorkID:    w.ID,
				ArtistID:  e.SourceID,
				Role:      EdgeDisplayRole(e),
				BeginDate: e.BeginDate,
				EndDate:   e.EndDate,
				Ended:     e.Ended,
				Artist:    artistMap[e.SourceID],
			})
		}
	}
}

// WorkRelationInput 演职保存负载行（role 为 relation_types.code，时间可选）
type WorkRelationInput struct {
	ArtistID  uuid.UUID
	Role      string
	BeginDate string
	EndDate   string
	Ended     bool
}

// SyncWorkRelationEdges 全量同步某作品的 agent_work 署名图边（单轨化写路径）。
// 语义对齐旧「删除重建」：不在目标集合内的署名边（含导入器写入的带 qualifier 边）会被删除，
// 调用方需提交完整演职表；work_artist_relations 旧表的 DELETE 保留在调用处清理遗留数据。
// 重复边依赖 (source, target, type, qualifier) 先查后建幂等写入。
func SyncWorkRelationEdges(db *gorm.DB, workID uuid.UUID, relations []WorkRelationInput) error {
	desired := make([]WorkRelationInput, 0, len(relations))
	desiredKeys := make(map[string]bool, len(relations))
	for _, r := range relations {
		role := strings.ToLower(strings.TrimSpace(r.Role))
		key := r.ArtistID.String() + "|" + role
		if role == "" || desiredKeys[key] {
			continue
		}
		desiredKeys[key] = true
		begin, err := ontology.NormalizePartialDate(r.BeginDate)
		if err != nil {
			return err
		}
		end, err := ontology.NormalizePartialDate(r.EndDate)
		if err != nil {
			return err
		}
		if err := ontology.ValidateDateSpan(begin, end); err != nil {
			return err
		}
		desired = append(desired, WorkRelationInput{ArtistID: r.ArtistID, Role: role, BeginDate: begin, EndDate: end, Ended: r.Ended})
	}

	existing, err := artistWorkEdges(db, []uuid.UUID{workID}, nil)
	if err != nil {
		return err
	}
	for _, e := range existing {
		if !desiredKeys[e.SourceID.String()+"|"+e.RelationshipType] {
			if err := db.Delete(&models.EntityRelationship{}, e.ID).Error; err != nil {
				return err
			}
		}
	}
	for _, r := range desired {
		if err := UpsertArtistWorkEdge(db, r.ArtistID, workID, r.Role, r.BeginDate, r.EndDate, r.Ended); err != nil {
			return err
		}
	}
	return nil
}

// UpsertArtistWorkEdge 严格写入一条 artist->work 署名边：
// 先经 ontology.ValidateRelationEdge 校验（关系类型启用、端点存在、端点类型合法），
// 再按 (source, target, type, qualifier) 先查后建，保证重复写入幂等。
// 时间参数遵循模糊日期规约（YYYY / YYYY-MM / YYYY-MM-DD），空串表示未知。
func UpsertArtistWorkEdge(db *gorm.DB, artistID, workID uuid.UUID, role, begin, end string, ended bool) error {
	role = strings.ToLower(strings.TrimSpace(role))
	if role == "" {
		return nil
	}
	var err error
	if begin, err = ontology.NormalizePartialDate(begin); err != nil {
		return err
	}
	if end, err = ontology.NormalizePartialDate(end); err != nil {
		return err
	}
	if err := ontology.ValidateDateSpan(begin, end); err != nil {
		return err
	}
	spec := ontology.EdgeSpec{
		SourceType:       "artist",
		SourceID:         artistID,
		TargetType:       "work",
		TargetID:         workID,
		RelationshipType: role,
	}
	if err := ontology.ValidateRelationEdge(db, spec); err != nil {
		return err
	}
	rel := models.EntityRelationship{
		SourceType:       "artist",
		SourceID:         artistID,
		TargetType:       "work",
		TargetID:         workID,
		RelationshipType: role,
		Qualifier:        "",
		BeginDate:        begin,
		EndDate:          end,
		Ended:            ended,
		Attributes:       models.JSONB{},
	}
	if err := db.Where(
		"source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relationship_type = ? AND qualifier = ?",
		rel.SourceType, rel.SourceID, rel.TargetType, rel.TargetID, rel.RelationshipType, rel.Qualifier,
	).Assign(models.EntityRelationship{
		BeginDate:  begin,
		EndDate:    end,
		Ended:      ended,
		Attributes: models.JSONB{},
	}).FirstOrCreate(&rel).Error; err != nil {
		return err
	}
	return nil
}
