package catalog

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
)

type CreateFranchiseInput struct {
	Title           string                 `json:"title"`
	OriginalTitle   string                 `json:"original_title"`
	Aliases         []string               `json:"aliases"`
	Disambiguation  string                 `json:"disambiguation"`
	Summary         string                 `json:"summary"`
	CoverImageURL   string                 `json:"cover_image_url"`
	BeginDate       string                 `json:"begin_date"`
	EndDate         string                 `json:"end_date"`
	Ended           bool                   `json:"ended"`
	Country         string                 `json:"country"`
	Language        string                 `json:"language"`
	ExternalIDs     map[string]interface{} `json:"external_ids"`
	CatalogMetadata map[string]interface{} `json:"catalog_metadata"`
	TagIDs          []uint                 `json:"tag_ids"`
	Tags            []string               `json:"tags"`
	Translations    []LocaleTextInput      `json:"translations"`
}

func (s *CatalogService) ListFranchises(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "24"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 24
	}
	q := strings.TrimSpace(c.Query("q"))
	tag := strings.TrimSpace(c.Query("tag"))
	tagsCSV := strings.TrimSpace(c.Query("tags"))

	query := s.db.Model(&models.Franchise{})
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("title ILIKE ? OR original_title ILIKE ? OR disambiguation ILIKE ? OR array_to_string(aliases, ' ') ILIKE ?", like, like, like, like)
	}
	if tag != "" {
		query = query.Where("id IN (SELECT franchise_id FROM franchise_tag_relations ftr JOIN tags t ON t.id = ftr.tag_id WHERE t.name = ?)", tag)
	}
	if tagsCSV != "" {
		for _, t := range strings.Split(tagsCSV, ",") {
			t = strings.TrimSpace(t)
			if t == "" {
				continue
			}
			query = query.Where("id IN (SELECT franchise_id FROM franchise_tag_relations ftr JOIN tags tg ON tg.id = ftr.tag_id WHERE tg.name = ?)", t)
		}
	}

	var total int64
	query.Count(&total)
	var items []models.Franchise
	if err := query.Preload("Tags").Preload("Translations").Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

func (s *CatalogService) GetFranchiseDetail(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid franchise ID"})
		return
	}
	var fr models.Franchise
	if err := s.db.Preload("Tags").Preload("Translations").Where("id = ?", id).First(&fr).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Franchise not found"})
		return
	}
	var favCount int64
	s.db.Model(&models.Favorite{}).Where("target_type = ? AND target_id = ?", "franchise", id).Count(&favCount)
	fr.FavoriteCount = favCount

	locale := backendi18n.LocaleFromContext(c)
	var rels []models.EntityRelationship
	s.db.Where("(source_type = 'franchise' AND source_id = ?) OR (target_type = 'franchise' AND target_id = ?)", id, id).
		Order("created_at desc").Find(&rels)

	parents := s.franchiseAncestors(id)

	var children []models.Franchise
	var works []models.Work
	var agents []models.Artist
	workSeen := map[uuid.UUID]bool{}
	agentSeen := map[uuid.UUID]bool{}

	for _, r := range rels {
		if r.RelationshipType == "part_of_franchise" {
			if r.SourceType == "franchise" && r.TargetID == id {
				var ch models.Franchise
				if err := s.db.Preload("Translations").Where("id = ?", r.SourceID).First(&ch).Error; err == nil {
					children = append(children, ch)
				}
			}
			if r.SourceType == "work" && r.TargetID == id && !workSeen[r.SourceID] {
				var w models.Work
				if err := s.db.Preload("Translations").Where("id = ?", r.SourceID).First(&w).Error; err == nil {
					works = append(works, w)
					workSeen[w.ID] = true
				}
			}
			if r.SourceType == "artist" && r.TargetID == id && !agentSeen[r.SourceID] {
				var a models.Artist
				if err := s.db.Preload("Translations").Where("id = ?", r.SourceID).First(&a).Error; err == nil {
					agents = append(agents, a)
					agentSeen[a.ID] = true
				}
			}
		}
		if r.RelationshipType == "character_in" && r.SourceType == "artist" && r.TargetID == id && !agentSeen[r.SourceID] {
			var a models.Artist
			if err := s.db.Preload("Translations").Where("id = ?", r.SourceID).First(&a).Error; err == nil {
				agents = append(agents, a)
				agentSeen[a.ID] = true
			}
		}
		if (r.RelationshipType == "imprint_of" || r.RelationshipType == "creator_of") && r.TargetID == id && r.SourceType == "artist" && !agentSeen[r.SourceID] {
			var a models.Artist
			if err := s.db.Preload("Translations").Where("id = ?", r.SourceID).First(&a).Error; err == nil {
				agents = append(agents, a)
				agentSeen[a.ID] = true
			}
		}
	}

	connected := s.connectedFromRels(locale, rels, "franchise", id)

	inc := parseInc(c.Query("inc"))
	out := gin.H{
		"franchise":          fr,
		"parents":            parents,
		"children":           children,
		"works":              works,
		"agents":             agents,
		"connected_entities": connected,
		"external_links":     s.buildExternalLinks(locale, "franchise", fr.ExternalIDs),
	}
	if inc["relations"] || inc["rels"] {
		out["relations"] = rels
	}
	c.JSON(http.StatusOK, out)
}

func (s *CatalogService) GetFranchiseGraph(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid franchise ID"})
		return
	}
	var fr models.Franchise
	if err := s.db.Where("id = ?", id).First(&fr).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Franchise not found"})
		return
	}
	locale := backendi18n.LocaleFromContext(c)
	var allRelTypes []models.RelationType
	s.db.Find(&allRelTypes)
	relTypeMap := make(map[string]models.RelationType)
	for _, rt := range allRelTypes {
		relTypeMap[rt.Code] = rt
	}

	nodes := []GraphNode{{ID: fr.ID.String(), Name: fr.Title, Type: "franchise", Category: "franchise", Level: 0}}
	nodeSet := map[string]bool{fr.ID.String(): true}
	links := []GraphLink{}

	var rels []models.EntityRelationship
	s.db.Where("(source_type = 'franchise' AND source_id = ?) OR (target_type = 'franchise' AND target_id = ?)", id, id).Find(&rels)

	for _, er := range rels {
		otherType, otherID := er.TargetType, er.TargetID
		dir := "forward"
		if er.TargetID == id && er.TargetType == "franchise" {
			otherType, otherID = er.SourceType, er.SourceID
			dir = "reverse"
		}
		name, ok := ontology.LookupName(s.db, otherType, otherID)
		if !ok {
			continue
		}
		if !nodeSet[otherID.String()] {
			nodeSet[otherID.String()] = true
			level := 1
			if otherType == "franchise" && dir == "forward" {
				level = -1
			}
			nodes = append(nodes, GraphNode{ID: otherID.String(), Name: name, Type: otherType, Category: er.RelationshipType, Level: level})
		}
		label := er.RelationshipType
		color := "indigo"
		if rt, ok := relTypeMap[er.RelationshipType]; ok {
			color = rt.Color
			if dir == "forward" {
				label = rt.LocalizedForwardLabel(locale)
			} else {
				label = rt.LocalizedReverseLabel(locale)
			}
		}
		links = append(links, GraphLink{
			Source: er.SourceID.String(), Target: er.TargetID.String(),
			Type: er.RelationshipType, Label: label, Color: color, Attributes: er.Attributes,
		})
	}

	ancestors := s.franchiseAncestors(id)
	prevID := id
	for i := len(ancestors) - 1; i >= 0; i-- {
		p := ancestors[i]
		if !nodeSet[p.ID.String()] {
			nodeSet[p.ID.String()] = true
			nodes = append(nodes, GraphNode{ID: p.ID.String(), Name: p.Title, Type: "franchise", Category: "franchise", Level: -(len(ancestors) - i)})
		}
		links = append(links, GraphLink{
			Source: prevID.String(), Target: p.ID.String(),
			Type: "part_of_franchise", Label: "part_of_franchise", Color: "indigo",
		})
		prevID = p.ID
	}

	c.JSON(http.StatusOK, gin.H{"nodes": nodes, "links": links})
}

func (s *CatalogService) CreateFranchiseForMember(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	var input CreateFranchiseInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateCoverURL(input.CoverImageURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ext := models.JSONB{}
	if input.ExternalIDs != nil {
		ext = models.JSONB(input.ExternalIDs)
	}
	meta := models.JSONB{}
	if input.CatalogMetadata != nil {
		meta = models.JSONB(input.CatalogMetadata)
	}
	fr := models.Franchise{
		Title:           strings.TrimSpace(input.Title),
		OriginalTitle:   strings.TrimSpace(input.OriginalTitle),
		Aliases:         pq.StringArray(input.Aliases),
		Disambiguation:  strings.TrimSpace(input.Disambiguation),
		Summary:         input.Summary,
		CoverImageURL:   input.CoverImageURL,
		BeginDate:       input.BeginDate,
		EndDate:         input.EndDate,
		Ended:           input.Ended,
		Country:         strings.TrimSpace(input.Country),
		Language:        input.Language,
		ExternalIDs:     ext,
		CatalogMetadata: meta,
		CreatedBy:       uid,
	}
	items := applyFranchiseLocaleDefaults(&fr, input.Translations, input.Language)
	if strings.TrimSpace(fr.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title required"})
		return
	}
	if err := s.db.Create(&fr).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tagNames := input.Tags
	if len(input.TagIDs) > 0 {
		var byID []models.Tag
		s.db.Where("id IN ?", input.TagIDs).Find(&byID)
		for _, t := range byID {
			tagNames = append(tagNames, t.Name)
		}
	}
	s.replaceFranchiseTagsByName(&fr, tagNames)
	s.upsertFranchiseTranslations(fr.ID, items)
	_ = s.db.Preload("Tags").Preload("Translations").First(&fr, fr.ID).Error
	c.JSON(http.StatusCreated, fr)
}

func (s *CatalogService) UpdateFranchiseForMember(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid franchise ID"})
		return
	}
	var fr models.Franchise
	if err := s.db.Where("id = ?", id).First(&fr).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Franchise not found"})
		return
	}
	var input CreateFranchiseInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateCoverURL(input.CoverImageURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	before := map[string]interface{}{"title": fr.Title, "original_title": fr.OriginalTitle, "summary": fr.Summary}
	fr.Title = strings.TrimSpace(input.Title)
	fr.OriginalTitle = strings.TrimSpace(input.OriginalTitle)
	if input.Aliases != nil {
		fr.Aliases = pq.StringArray(input.Aliases)
	}
	fr.Disambiguation = strings.TrimSpace(input.Disambiguation)
	fr.Summary = input.Summary
	fr.CoverImageURL = input.CoverImageURL
	fr.BeginDate = input.BeginDate
	fr.EndDate = input.EndDate
	fr.Ended = input.Ended
	fr.Country = strings.TrimSpace(input.Country)
	if input.ExternalIDs != nil {
		fr.ExternalIDs = models.JSONB(input.ExternalIDs)
	}
	if input.CatalogMetadata != nil {
		fr.CatalogMetadata = models.JSONB(input.CatalogMetadata)
	}
	items := applyFranchiseLocaleDefaults(&fr, input.Translations, input.Language)
	if strings.TrimSpace(fr.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title required"})
		return
	}
	if err := s.db.Save(&fr).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	after := map[string]interface{}{"title": fr.Title, "original_title": fr.OriginalTitle, "summary": fr.Summary}
	s.recordRevision("franchise", fr.ID, &userID, "update", "更新企划", "", nil, before, after)
	s.replaceFranchiseTagsByName(&fr, input.Tags)
	s.upsertFranchiseTranslations(fr.ID, items)
	_ = s.db.Preload("Tags").Preload("Translations").First(&fr, fr.ID).Error
	c.JSON(http.StatusOK, gin.H{"status": "success", "franchise": fr})
}

func (s *CatalogService) connectedFromRels(locale string, rels []models.EntityRelationship, selfType string, selfID uuid.UUID) []ConnectedEntityItem {
	var allRelTypes []models.RelationType
	s.db.Find(&allRelTypes)
	relTypeMap := make(map[string]models.RelationType)
	for _, rt := range allRelTypes {
		relTypeMap[rt.Code] = rt
	}
	out := make([]ConnectedEntityItem, 0)
	for _, er := range rels {
		otherType, otherID, dir := er.TargetType, er.TargetID, "forward"
		if er.TargetType == selfType && er.TargetID == selfID {
			otherType, otherID, dir = er.SourceType, er.SourceID, "reverse"
		}
		pack, ok := ontology.LookupDisplay(s.db, otherType, otherID)
		if !ok {
			continue
		}
		label := er.RelationshipType
		relName := er.RelationshipType
		color := "sky"
		icon := "Link"
		if rt, hit := relTypeMap[er.RelationshipType]; hit {
			relName = rt.LocalizedName(locale)
			color = rt.Color
			icon = rt.Icon
			if dir == "forward" {
				label = rt.LocalizedForwardLabel(locale)
			} else {
				label = rt.LocalizedReverseLabel(locale)
			}
		}
		out = append(out, ConnectedEntityItem{
			EntityID:         otherID.String(),
			EntityName:       pack.Name,
			OriginalName:     pack.OriginalName,
			OriginalLanguage: pack.OriginalLanguage,
			Translations:     pack.Translations,
			EntityType:       otherType,
			RelationshipType: er.RelationshipType,
			Qualifier:        er.Qualifier,
			RelationshipName: relName,
			Direction:        dir,
			Label:            label,
			BeginDate:        er.BeginDate,
			EndDate:          er.EndDate,
			Ended:            er.Ended,
			IsCurrent:        er.IsCurrent(),
			DateSpan:         er.DateSpan(),
			Attributes:       er.Attributes,
			Color:            color,
			Icon:             icon,
		})
	}
	return out
}

func (s *CatalogService) franchiseAncestors(id uuid.UUID) []models.Franchise {
	var chain []models.Franchise
	seen := map[uuid.UUID]bool{id: true}
	cur := id
	for i := 0; i < 8; i++ {
		var rel models.EntityRelationship
		if err := s.db.Where(
			"source_type = 'franchise' AND source_id = ? AND relationship_type = 'part_of_franchise' AND target_type = 'franchise'",
			cur,
		).First(&rel).Error; err != nil {
			break
		}
		if seen[rel.TargetID] {
			break
		}
		var p models.Franchise
		if err := s.db.Preload("Translations").Where("id = ?", rel.TargetID).First(&p).Error; err != nil {
			break
		}
		chain = append([]models.Franchise{p}, chain...)
		seen[rel.TargetID] = true
		cur = rel.TargetID
	}
	return chain
}


