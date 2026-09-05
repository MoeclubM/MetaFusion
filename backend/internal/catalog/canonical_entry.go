package catalog

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
	"gorm.io/gorm"
)

// CanonicalEntryDetailResponse 典范篇目详情响应体
type CanonicalEntryDetailResponse struct {
	models.CanonicalEntry
	Releases          []ReleaseSummaryItem        `json:"releases"`
	Tracks            []models.Track              `json:"tracks"`
	AssetFiles        []AssetResourceItem         `json:"asset_files,omitempty"`
	ConnectedEntities []ConnectedEntityItem       `json:"connected_entities"`
	ExternalLinks     []models.ExternalLinkItem   `json:"external_links"`
	Relations         []models.EntityRelationship `json:"relations,omitempty"`
	Revisions         []models.EntityRevision     `json:"revisions,omitempty"`
}

// ReleaseSummaryItem 篇目所收录的 Release 简要信息
type ReleaseSummaryItem struct {
	ReleaseID       uuid.UUID      `json:"release_id"`
	EditionName     string         `json:"edition_name"`
	CoverImageURL   string         `json:"cover_image_url,omitempty"`
	CoverAspect     string         `json:"cover_aspect,omitempty"`
	EditionDate     *time.Time     `json:"edition_date,omitempty"`
	Country         string         `json:"country,omitempty"`
	Publisher       string         `json:"publisher,omitempty"`
	PublisherEntity *models.Artist `json:"publisher_entity,omitempty"`
	MediumName      string         `json:"medium_name"`
	MediumFormat    string         `json:"medium_format"`
	MediaCategory   string         `json:"media_category"`
	MediumPosition  int            `json:"medium_position"`
	TrackPosition   int            `json:"track_position"`
	TrackTitle      string         `json:"track_title"`
	DurationSeconds int            `json:"duration_seconds"`
	ISRC            string         `json:"isrc,omitempty"`
	ArtistCredit    string         `json:"artist_credit,omitempty"`
}

// GetCanonicalEntryDetail 获取单典范篇目(LRM-E2 Expression)详情及收录的 Release、Tracks 与图谱关联
func (s *CatalogService) GetCanonicalEntryDetail(c *gin.Context) {
	idStr := c.Param("id")
	entryID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid canonical entry ID"})
		return
	}

	var entry models.CanonicalEntry
	if err := s.db.
		Preload("Work").
		Preload("Work.Translations").
		Preload("Work.Tags").
		Where("id = ?", entryID).
		First(&entry).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Canonical entry not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	localizeContent(&entry, backendi18n.LocaleFromContext(c))
	// 署名单轨化：Work.ArtistRelations 由图边读时投影
	if entry.Work != nil {
		AttachWorkArtistRelationsPtr(s.db, []*models.Work{entry.Work})
	}

	// 查询引用此篇目的所有 Tracks 及对应的 Medium 与 Release
	var tracks []models.Track
	_ = s.db.
		Preload("Contents").
		Preload("Contents.CanonicalEntry").
		Preload("Contents.CanonicalEntry.Work").
		Where("canonical_entry_id = ? OR id IN (SELECT track_id FROM track_contents WHERE canonical_entry_id = ?)", entryID, entryID).
		Order("position asc").
		Find(&tracks).Error

	var mediumIDs []uuid.UUID
	for _, tr := range tracks {
		mediumIDs = append(mediumIDs, tr.MediumID)
	}

	var mediums []models.Medium
	if len(mediumIDs) > 0 {
		_ = s.db.
			Where("id IN ?", mediumIDs).
			Find(&mediums).Error
	}

	mediumMap := make(map[uuid.UUID]models.Medium)
	var releaseIDs []uuid.UUID
	for _, m := range mediums {
		mediumMap[m.ID] = m
		releaseIDs = append(releaseIDs, m.ReleaseID)
	}

	var releases []models.Release
	if len(releaseIDs) > 0 {
		uid := currentUserID(c)
		rq := applyReleaseVisibility(s.db.Model(&models.Release{}), uid)
		_ = rq.
			Preload("Work").
			Preload("PublisherEntity").
			Preload("PublisherEntity.Translations").
			Where("id IN ?", releaseIDs).
			Find(&releases).Error
	}
	locale := backendi18n.LocaleFromContext(c)
	for i := range releases {
		localizeRelease(&releases[i], locale)
	}

	releaseMap := make(map[uuid.UUID]models.Release)
	for _, r := range releases {
		releaseMap[r.ID] = r
	}

	releaseSummaries := make([]ReleaseSummaryItem, 0, len(tracks))
	for _, tr := range tracks {
		med, hasMed := mediumMap[tr.MediumID]
		if !hasMed {
			continue
		}
		rel, hasRel := releaseMap[med.ReleaseID]
		if !hasRel {
			continue
		}
		localizeMedium(&med, locale)
		localizeTrack(&tr, locale)

		coverURL := rel.CoverImageURL
		coverAspect := rel.CoverAspect
		if coverURL == "" && rel.Work != nil {
			coverURL = rel.Work.CoverImageURL
		}
		if coverAspect == "" && rel.Work != nil {
			coverAspect = rel.Work.CoverAspect
		}

		dur := tr.DurationSeconds
		if dur == 0 {
			dur = entry.Duration
		}

		isrc := tr.ISRC
		if isrc == "" {
			isrc = entry.ISRC
		}

		artistCredit := tr.ArtistCredit
		if artistCredit == "" {
			artistCredit = entry.ArtistCredit
		}

		releaseSummaries = append(releaseSummaries, ReleaseSummaryItem{
			ReleaseID:       rel.ID,
			EditionName:     rel.LocalizedEditionName,
			CoverImageURL:   coverURL,
			CoverAspect:     coverAspect,
			EditionDate:     rel.EditionDate,
			Country:         rel.Country,
			Publisher:       rel.Publisher,
			PublisherEntity: rel.PublisherEntity,
			MediumName:      med.LocalizedName,
			MediumFormat:    med.Format,
			MediaCategory:   med.MediaCategory,
			MediumPosition:  med.Position,
			TrackPosition:   tr.Position,
			TrackTitle:      tr.LocalizedTitle,
			DurationSeconds: dur,
			ISRC:            isrc,
			ArtistCredit:    artistCredit,
		})
	}

	// 语义关系边
	var rels []models.EntityRelationship
	s.db.Where("(source_type = 'canonical_entry' AND source_id = ?) OR (target_type = 'canonical_entry' AND target_id = ?)", entryID, entryID).
		Order("created_at desc").Limit(50).Find(&rels)

	connected := s.connectedFromRels(locale, rels, "canonical_entry", entryID)

	inc := parseInc(c.Query("inc"))
	resp := CanonicalEntryDetailResponse{
		CanonicalEntry:    entry,
		Releases:          releaseSummaries,
		Tracks:            tracks,
		AssetFiles:        ProjectAssetResourcesForTarget(s.db, "canonical_entry", entry.ID),
		ConnectedEntities: connected,
		ExternalLinks:     s.buildExternalLinks(locale, "canonical_entry", entry.ExternalIDs),
	}

	if inc["relations"] || inc["rels"] {
		resp.Relations = rels
	}

	if inc["revisions"] {
		var revs []models.EntityRevision
		_ = s.db.Where("target_type = 'canonical_entry' AND target_id = ?", entryID).Order("created_at desc").Limit(20).Find(&revs).Error
		resp.Revisions = revs
	}

	c.JSON(http.StatusOK, resp)
}

// GetCanonicalEntryGraph 获取典范篇目的关系网络
func (s *CatalogService) GetCanonicalEntryGraph(c *gin.Context) {
	entryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid canonical entry ID"})
		return
	}

	var entry models.CanonicalEntry
	if err := s.db.Preload("Work").Where("id = ?", entryID).First(&entry).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Canonical entry not found"})
		return
	}

	var allRelTypes []models.RelationType
	s.db.Find(&allRelTypes)
	relTypeMap := make(map[string]models.RelationType)
	for _, rt := range allRelTypes {
		relTypeMap[rt.Code] = rt
	}
	locale := backendi18n.LocaleFromContext(c)

	nodes := []GraphNode{
		{
			ID:       entry.ID.String(),
			Name:     entry.Title,
			Type:     "canonical_entry",
			Category: "expression",
			Level:    1,
		},
	}
	nodeSet := map[string]bool{entry.ID.String(): true}
	links := []GraphLink{}

	// 1. 所属主作品 Work
	if entry.Work != nil {
		if !nodeSet[entry.Work.ID.String()] {
			nodeSet[entry.Work.ID.String()] = true
			nodes = append(nodes, GraphNode{
				ID:            entry.Work.ID.String(),
				Name:          entry.Work.Title,
				OriginalName:  entry.Work.OriginalTitle,
				Type:          "work",
				Category:      "main_work",
				Level:         0,
				CoverImageURL: entry.Work.CoverImageURL,
				Country:       entry.Work.Country,
				Status:        entry.Work.Status,
			})
		}
		links = append(links, GraphLink{
			Source:     entry.Work.ID.String(),
			Target:     entry.ID.String(),
			SourceType: "work",
			TargetType: "canonical_entry",
			Type:       "expression_of",
			Label:      "母体作品",
			Color:      "amber",
		})
	}

	// 2. 跨实体语义边 (EntityRelationship)
	var crossRels []models.EntityRelationship
	s.db.Where("source_id = ? OR target_id = ?", entryID, entryID).Find(&crossRels)

	for _, cr := range crossRels {
		otherID := cr.TargetID
		otherType := cr.TargetType
		dir := "forward"
		if cr.TargetID == entryID {
			otherID = cr.SourceID
			otherType = cr.SourceType
			dir = "reverse"
		}

		if !nodeSet[otherID.String()] {
			nodeSet[otherID.String()] = true
			meta, _ := ontology.LookupNodeMeta(s.db, otherType, otherID)
			nodes = append(nodes, GraphNode{
				ID:             otherID.String(),
				Name:           meta.Name,
				OriginalName:   meta.OriginalName,
				Type:           otherType,
				Category:       cr.RelationshipType,
				CoverImageURL:  meta.CoverImageURL,
				Disambiguation: meta.Disambiguation,
				Country:        meta.Country,
				Status:         meta.Status,
				Level:          2,
			})
		}

		relLabel := cr.RelationshipType
		color := "sky"
		isHier := false
		if rt, ok := relTypeMap[cr.RelationshipType]; ok {
			color = rt.Color
			isHier = rt.IsHierarchical
			if dir == "forward" {
				relLabel = rt.LocalizedForwardLabel(locale)
			} else {
				relLabel = rt.LocalizedReverseLabel(locale)
			}
		}

		links = append(links, GraphLink{
			ID:             cr.ID.String(),
			Source:         cr.SourceID.String(),
			Target:         cr.TargetID.String(),
			SourceType:     cr.SourceType,
			TargetType:     cr.TargetType,
			Type:           cr.RelationshipType,
			Label:          relLabel,
			Qualifier:      cr.Qualifier,
			Color:          color,
			Attributes:     cr.Attributes,
			BeginDate:      cr.BeginDate,
			EndDate:        cr.EndDate,
			Ended:          cr.Ended,
			IsHierarchical: isHier,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"nodes": nodes,
		"links": links,
	})
}
