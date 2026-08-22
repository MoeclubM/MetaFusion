package catalog

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-_]{1,63}$`)

func validateCustomShelfInput(slug string, queryTags, excludeTags []string, db *gorm.DB) error {
	if slug != "" && !slugRe.MatchString(slug) {
		return &fieldError{"slug", "slug must be 2-64 chars, lowercase letters/digits/_/-"}
	}
	for _, t := range queryTags {
		trimmed := strings.TrimSpace(t)
		if trimmed == "" {
			continue
		}
		if len(trimmed) > 64 {
			return &fieldError{"query_tags", "tag too long (max 64 chars): " + t}
		}
		var cnt int64
		db.Model(&models.Tag{}).Where("name = ?", trimmed).Count(&cnt)
		if cnt == 0 {
			_ = db.Create(&models.Tag{Name: trimmed, GroupType: "general"}).Error
		}
	}
	for _, t := range excludeTags {
		trimmed := strings.TrimSpace(t)
		if trimmed == "" {
			continue
		}
		if len(trimmed) > 64 {
			return &fieldError{"exclude_tags", "tag too long (max 64 chars): " + t}
		}
		var cnt int64
		db.Model(&models.Tag{}).Where("name = ?", trimmed).Count(&cnt)
		if cnt == 0 {
			_ = db.Create(&models.Tag{Name: trimmed, GroupType: "general"}).Error
		}
	}
	return nil
}

type fieldError struct {
	Field string
	Msg   string
}

func (e *fieldError) Error() string { return e.Msg }

// ListCustomShelves GET /shelves/custom?scope=own|public|all&q=&page=&page_size=
func (s *CatalogService) ListCustomShelves(c *gin.Context) {
	scope := c.DefaultQuery("scope", "own")
	q := strings.TrimSpace(c.Query("q"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize
	uid := currentUserID(c)

	switch scope {
	case "own":
		if uid == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
			return
		}
		var total int64
		s.db.Model(&models.UserCustomShelf{}).Where("owner_id = ?", *uid).Count(&total)
		if total == 0 && q == "" {
			items, _, err := InitUserDefaultShelves(s.db, *uid)
			if err != nil || items == nil {
				items = []models.UserCustomShelf{}
			}
			c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items), "page": 1, "page_size": pageSize})
			return
		}
		query := s.db.Where("owner_id = ?", *uid)
		if q != "" {
			like := "%" + q + "%"
			query = query.Where("name_zh ILIKE ? OR name_en ILIKE ? OR slug ILIKE ?", like, like, like)
		}
		var items []models.UserCustomShelf
		query.Order("sort_order asc, created_at desc").Offset(offset).Limit(pageSize).Find(&items)
		c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
		return
	case "public":
		query := s.db.Where("is_public = ?", true)
		if q != "" {
			like := "%" + q + "%"
			query = query.Where("name_zh ILIKE ? OR name_en ILIKE ? OR slug ILIKE ?", like, like, like)
		}
		var total int64
		query.Model(&models.UserCustomShelf{}).Count(&total)
		var items []models.UserCustomShelf
		query.Order("view_count desc, created_at desc").Offset(offset).Limit(pageSize).Find(&items)
		c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
		return
	case "all":
		// own + public (dedup)
		var items []models.UserCustomShelf
		var total int64
		if uid != nil {
			query := s.db.Where("is_public = ? OR owner_id = ?", true, *uid)
			if q != "" {
				like := "%" + q + "%"
				query = query.Where("(name_zh ILIKE ? OR name_en ILIKE ? OR slug ILIKE ?)", like, like, like)
			}
			query.Model(&models.UserCustomShelf{}).Count(&total)
			query.Order("is_public asc, sort_order asc, created_at desc").Offset(offset).Limit(pageSize).Find(&items)
		} else {
			query := s.db.Where("is_public = ?", true)
			if q != "" {
				like := "%" + q + "%"
				query = query.Where("name_zh ILIKE ? OR name_en ILIKE ? OR slug ILIKE ?", like, like, like)
			}
			query.Model(&models.UserCustomShelf{}).Count(&total)
			query.Order("view_count desc, created_at desc").Offset(offset).Limit(pageSize).Find(&items)
		}
		c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
		return
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scope, use own|public|all"})
		return
	}
}

// CreateCustomShelf POST /shelves/custom
func (s *CatalogService) CreateCustomShelf(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		return
	}
	var input struct {
		Slug           string   `json:"slug" binding:"required"`
		NameZh         string   `json:"name_zh" binding:"required"`
		NameEn         string   `json:"name_en"`
		Description    string   `json:"description"`
		Icon           string   `json:"icon"`
		QueryTags      []string `json:"query_tags"`
		RequireAllTags bool     `json:"require_all_tags"`
		ExcludeTags    []string `json:"exclude_tags"`
		IsPublic       bool     `json:"is_public"`
		SortOrder      *int     `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.Slug = strings.ToLower(strings.TrimSpace(input.Slug))
	input.NameZh = strings.TrimSpace(input.NameZh)
	input.NameEn = strings.TrimSpace(input.NameEn)
	if input.Icon == "" {
		input.Icon = "Sparkles"
	}
	// normalize tags
	var qTags []string
	for _, t := range input.QueryTags {
		trimmed := strings.TrimSpace(t)
		if trimmed != "" {
			qTags = append(qTags, trimmed)
		}
	}
	var exTags []string
	for _, t := range input.ExcludeTags {
		trimmed := strings.TrimSpace(t)
		if trimmed != "" {
			exTags = append(exTags, trimmed)
		}
	}
	if err := validateCustomShelfInput(input.Slug, qTags, exTags, s.db); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// uniqueness per owner
	var cnt int64
	s.db.Model(&models.UserCustomShelf{}).Where("owner_id = ? AND slug = ?", *uid, input.Slug).Count(&cnt)
	if cnt > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "slug already exists for this user"})
		return
	}
	sortOrder := 0
	if input.SortOrder != nil {
		sortOrder = *input.SortOrder
	} else {
		var maxOrder *int
		s.db.Model(&models.UserCustomShelf{}).Where("owner_id = ?", *uid).Select("MAX(sort_order)").Row().Scan(&maxOrder)
		if maxOrder != nil {
			sortOrder = *maxOrder + 10
		} else {
			sortOrder = 10
		}
	}
	shelf := models.UserCustomShelf{
		OwnerID:        *uid,
		Slug:           input.Slug,
		NameZh:         input.NameZh,
		NameEn:         input.NameEn,
		Description:    input.Description,
		Icon:           input.Icon,
		SortOrder:      sortOrder,
		QueryTags:      pq.StringArray(qTags),
		RequireAllTags: input.RequireAllTags,
		ExcludeTags:    pq.StringArray(exTags),
		IsPublic:       input.IsPublic,
	}
	if err := s.db.Create(&shelf).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, shelf)
}

// GetCustomShelf GET /shelves/custom/:id
func (s *CatalogService) GetCustomShelf(c *gin.Context) {
	idStr := c.Param("id")
	shelfID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var shelf models.UserCustomShelf
	if err := s.db.Where("id = ?", shelfID).First(&shelf).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "custom shelf not found"})
		return
	}
	uid := currentUserID(c)
	role, _ := c.Get("role")
	isAdmin := role == "admin" || role == "archivist"
	isOwner := uid != nil && shelf.OwnerID == *uid
	if !shelf.IsPublic && !isOwner && !isAdmin {
		c.JSON(http.StatusNotFound, gin.H{"error": "custom shelf not found"})
		return
	}
	if shelf.IsPublic {
		_ = s.db.Model(&shelf).UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error
		shelf.ViewCount++
	}
	c.JSON(http.StatusOK, shelf)
}

// UpdateCustomShelf PUT /shelves/custom/:id
func (s *CatalogService) UpdateCustomShelf(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		return
	}
	idStr := c.Param("id")
	shelfID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var shelf models.UserCustomShelf
	if err := s.db.Where("id = ?", shelfID).First(&shelf).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "custom shelf not found"})
		return
	}
	if shelf.OwnerID != *uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "only owner can update"})
		return
	}
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// handle is_public rate limit
	if v, ok := input["is_public"]; ok {
		if b, ok := v.(bool); ok && b != shelf.IsPublic {
			if time.Since(shelf.UpdatedAt) < time.Minute {
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "please wait a minute before toggling visibility"})
				return
			}
		}
	}
	// prepare updates with validation
	updates := map[string]interface{}{}
	if v, ok := input["slug"]; ok {
		if slugStr, ok := v.(string); ok {
			slug := strings.ToLower(strings.TrimSpace(slugStr))
			if !slugRe.MatchString(slug) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid slug"})
				return
			}
			if slug != shelf.Slug {
				var cnt int64
				s.db.Model(&models.UserCustomShelf{}).Where("owner_id = ? AND slug = ? AND id != ?", *uid, slug, shelfID).Count(&cnt)
				if cnt > 0 {
					c.JSON(http.StatusConflict, gin.H{"error": "slug already exists"})
					return
				}
				updates["slug"] = slug
			}
		}
	}
	if v, ok := input["name_zh"]; ok {
		if nameZhStr, ok := v.(string); ok {
			trimmed := strings.TrimSpace(nameZhStr)
			if trimmed == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "name_zh required"})
				return
			}
			updates["name_zh"] = trimmed
		}
	}
	if v, ok := input["name_en"]; ok {
		if nameEnStr, ok := v.(string); ok {
			updates["name_en"] = strings.TrimSpace(nameEnStr)
		}
	}
	if v, ok := input["description"]; ok {
		if descStr, ok := v.(string); ok {
			updates["description"] = descStr
		}
	}
	if v, ok := input["icon"]; ok {
		if iconStr, ok := v.(string); ok && strings.TrimSpace(iconStr) != "" {
			updates["icon"] = strings.TrimSpace(iconStr)
		}
	}
	// tags need existence check
	if v, ok := input["query_tags"]; ok {
		var tags []string
		switch arr := v.(type) {
		case []interface{}:
			for _, e := range arr {
				if tagStr, ok := e.(string); ok && strings.TrimSpace(tagStr) != "" {
					tags = append(tags, strings.TrimSpace(tagStr))
				}
			}
		case []string:
			for _, tagVal := range arr {
				if strings.TrimSpace(tagVal) != "" {
					tags = append(tags, strings.TrimSpace(tagVal))
				}
			}
		}
		if err := validateCustomShelfInput("", tags, nil, s.db); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		updates["query_tags"] = pq.Array(tags)
	}
	if v, ok := input["exclude_tags"]; ok {
		var tags []string
		switch arr := v.(type) {
		case []interface{}:
			for _, e := range arr {
				if tagStr, ok := e.(string); ok && strings.TrimSpace(tagStr) != "" {
					tags = append(tags, strings.TrimSpace(tagStr))
				}
			}
		case []string:
			for _, tagVal := range arr {
				if strings.TrimSpace(tagVal) != "" {
					tags = append(tags, strings.TrimSpace(tagVal))
				}
			}
		}
		if err := validateCustomShelfInput("", nil, tags, s.db); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		updates["exclude_tags"] = pq.Array(tags)
	}
	if v, ok := input["require_all_tags"]; ok {
		if b, ok := v.(bool); ok {
			updates["require_all_tags"] = b
		}
	}
	if v, ok := input["is_public"]; ok {
		if b, ok := v.(bool); ok {
			updates["is_public"] = b
		}
	}
	if v, ok := input["sort_order"]; ok {
		switch n := v.(type) {
		case float64:
			updates["sort_order"] = int(n)
		case int:
			updates["sort_order"] = n
		}
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no valid fields"})
		return
	}
	if err := s.db.Model(&models.UserCustomShelf{}).Where("id = ?", shelfID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var updated models.UserCustomShelf
	s.db.Where("id = ?", shelfID).First(&updated)
	c.JSON(http.StatusOK, updated)
}

// DeleteCustomShelf DELETE /shelves/custom/:id
func (s *CatalogService) DeleteCustomShelf(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		return
	}
	idStr := c.Param("id")
	shelfID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var shelf models.UserCustomShelf
	if err := s.db.Where("id = ?", shelfID).First(&shelf).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "custom shelf not found"})
		return
	}
	if shelf.OwnerID != *uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "only owner can delete"})
		return
	}
	if err := s.db.Where("id = ?", shelfID).Delete(&models.UserCustomShelf{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// clean order_json for all layouts that reference this custom shelf
	customKey := "custom:" + shelfID.String()
	var layouts []models.UserHomeLayout
	s.db.Find(&layouts)
	for _, l := range layouts {
		needsUpdate := false
		// OrderJSON is stored as JSONB array; handle both []string via map conversion
		var arr []string
		if l.OrderJSON != nil {
			// JSONB is map[string]interface{} in current model, but may hold array as []interface{}
			// try to extract array via type assertion through JSON marshal roundtrip
			// simplest: try to parse as []string from raw DB value via query
			var raw string
			s.db.Raw("SELECT order_json::text FROM user_home_layouts WHERE user_id = ?", l.UserID).Row().Scan(&raw)
			// raw like '["movies","custom:xxx"]' or '[]'
			if raw != "" && raw != "[]" {
				// parse via helper
				arr = parseOrderJSONRaw(raw)
				filtered := make([]string, 0, len(arr))
				for _, v := range arr {
					if v != customKey {
						filtered = append(filtered, v)
					} else {
						needsUpdate = true
					}
				}
				if needsUpdate {
					// update via raw JSON
					_ = s.db.Model(&models.UserHomeLayout{}).Where("user_id = ?", l.UserID).Update("order_json", pq.Array(filtered)).Error
					// fallback: if above fails due to type, try JSON marshal
					// ensure correct JSONB: use gorm update with string
					// we already attempted; if not updated, try alternative
					var check int64
					s.db.Raw("SELECT 1 FROM user_home_layouts WHERE user_id = ? AND order_json::text LIKE ?", l.UserID, "%"+shelfID.String()+"%").Count(&check)
					if check > 0 {
						// rewrite via raw SQL filtering
						s.db.Exec("UPDATE user_home_layouts SET order_json = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(order_json) AS elem WHERE elem <> ?) WHERE user_id = ?", customKey, l.UserID)
					}
				}
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func parseOrderJSONRaw(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return nil
	}
	// remove brackets and split
	// fallback simple parser for '["a","b"]'
	var out []string
	// use strings to extract quoted values
	inQuote := false
	var cur strings.Builder
	for _, ch := range raw {
		if ch == '"' {
			if inQuote {
				out = append(out, cur.String())
				cur.Reset()
				inQuote = false
			} else {
				inQuote = true
			}
			continue
		}
		if inQuote {
			cur.WriteRune(ch)
		}
	}
	return out
}

// GetHomeLayout GET /home/layout
func (s *CatalogService) GetHomeLayout(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		return
	}
	items, order, err := InitUserDefaultShelves(s.db, *uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []models.UserCustomShelf{}
	}
	if order == nil {
		order = []string{}
	}
	hidden := []string{}
	var layout models.UserHomeLayout
	if err := s.db.Where("user_id = ?", *uid).First(&layout).Error; err == nil {
		hidden = []string(layout.HiddenSystemSlugs)
		if hidden == nil {
			hidden = []string{}
		}
	}
	c.JSON(http.StatusOK, gin.H{"hidden_system_slugs": hidden, "order_json": order, "items": items})
}

// PutHomeLayout PUT /home/layout
func (s *CatalogService) PutHomeLayout(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		return
	}
	var input struct {
		HiddenSystemSlugs []string `json:"hidden_system_slugs"`
		OrderJSON         []string `json:"order_json"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// validate hidden slugs exist in virtual_shelves
	if len(input.HiddenSystemSlugs) > 0 {
		for _, slug := range input.HiddenSystemSlugs {
			var cnt int64
			s.db.Model(&models.VirtualShelf{}).Where("slug = ?", slug).Count(&cnt)
			if cnt == 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "unknown system shelf: " + slug})
				return
			}
		}
	}
	// validate order_json: user shelves only (custom:<uuid>, or legacy system slug mapped by user's copy)
	seen := map[string]bool{}
	deduped := []string{}
	for _, entry := range input.OrderJSON {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" {
			continue
		}
		var key string
		if strings.HasPrefix(trimmed, "custom:") {
			idStr := strings.TrimPrefix(trimmed, "custom:")
			cid, err := uuid.Parse(idStr)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid custom shelf id: " + trimmed})
				return
			}
			var cs models.UserCustomShelf
			if err := s.db.Where("id = ?", cid).First(&cs).Error; err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "custom shelf not found: " + trimmed})
				return
			}
			isOwner := cs.OwnerID == *uid
			if !cs.IsPublic && !isOwner {
				role, _ := c.Get("role")
				if role != "admin" && role != "archivist" {
					c.JSON(http.StatusBadRequest, gin.H{"error": "custom shelf not accessible: " + trimmed})
					return
				}
			}
			key = "custom:" + cs.ID.String()
		} else {
			var cs models.UserCustomShelf
			if err := s.db.Where("owner_id = ? AND slug = ?", *uid, trimmed).First(&cs).Error; err != nil {
				continue
			}
			key = "custom:" + cs.ID.String()
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		deduped = append(deduped, key)
	}
	// dedup hidden
	hiddenSeen := map[string]bool{}
	hiddenDeduped := []string{}
	for _, h := range input.HiddenSystemSlugs {
		trimmed := strings.TrimSpace(h)
		if trimmed == "" || hiddenSeen[trimmed] {
			continue
		}
		hiddenSeen[trimmed] = true
		hiddenDeduped = append(hiddenDeduped, trimmed)
	}
	// upsert
	var layout models.UserHomeLayout
	err := s.db.Where("user_id = ?", *uid).First(&layout).Error
	if err != nil {
		// create
		layout = models.UserHomeLayout{
			UserID:            *uid,
			HiddenSystemSlugs: pq.StringArray(hiddenDeduped),
			UpdatedAt:         time.Now(),
		}
		// store order_json as JSONB array via raw SQL to avoid GORM map type issue
		// create row first with empty, then update via Exec
		if err := s.db.Create(&layout).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// update order_json
		orderJSONStr := toJSONArray(deduped)
		s.db.Exec("UPDATE user_home_layouts SET order_json = ?::jsonb, updated_at = NOW() WHERE user_id = ?", orderJSONStr, *uid)
	} else {
		orderJSONStr := toJSONArray(deduped)
		if err := s.db.Exec("UPDATE user_home_layouts SET hidden_system_slugs = ?, order_json = ?::jsonb, updated_at = NOW() WHERE user_id = ?", pq.Array(hiddenDeduped), orderJSONStr, *uid).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	// return updated
	var raw string
	s.db.Raw("SELECT order_json::text FROM user_home_layouts WHERE user_id = ?", *uid).Row().Scan(&raw)
	order := parseOrderJSONRaw(raw)
	var hidden []string
	s.db.Raw("SELECT hidden_system_slugs FROM user_home_layouts WHERE user_id = ?", *uid).Row().Scan(pq.Array(&hidden))
	if hidden == nil {
		hidden = []string{}
	}
	if order == nil {
		order = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"hidden_system_slugs": hidden, "order_json": order})
}

func toJSONArray(arr []string) string {
	if len(arr) == 0 {
		return "[]"
	}
	var b strings.Builder
	b.WriteString("[")
	for i, v := range arr {
		if i > 0 {
			b.WriteString(",")
		}
		// escape quotes
		escaped := strings.ReplaceAll(v, "\"", "\\\"")
		b.WriteString("\"")
		b.WriteString(escaped)
		b.WriteString("\"")
	}
	b.WriteString("]")
	return b.String()
}

// SyncPresetShelves POST /shelves/custom/sync-presets
func (s *CatalogService) SyncPresetShelves(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		return
	}

	var input struct {
		Overwrite bool `json:"overwrite"`
	}
	_ = c.ShouldBindJSON(&input)

	// Fetch all system virtual shelves
	var systemShelves []models.VirtualShelf
	if err := s.db.Order("sort_order asc").Find(&systemShelves).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load system shelves"})
		return
	}

	// Fetch existing user custom shelves
	var userShelves []models.UserCustomShelf
	s.db.Where("owner_id = ?", *uid).Order("sort_order asc, created_at desc").Find(&userShelves)
	userSlugMap := make(map[string]*models.UserCustomShelf)
	for i := range userShelves {
		userSlugMap[userShelves[i].Slug] = &userShelves[i]
	}

	var resultOrder []string

	for _, sys := range systemShelves {
		existing, found := userSlugMap[sys.Slug]
		if found && !input.Overwrite {
			resultOrder = append(resultOrder, "custom:"+existing.ID.String())
			continue
		}

		if found && input.Overwrite {
			// update existing
			existing.NameZh = sys.NameZh
			existing.NameEn = sys.NameEn
			existing.Description = sys.Description
			existing.Icon = sys.Icon
			existing.SortOrder = sys.SortOrder
			existing.QueryTags = sys.QueryTags
			existing.RequireAllTags = sys.RequireAllTags
			existing.ExcludeTags = sys.ExcludeTags
			existing.UpdatedAt = time.Now()
			s.db.Save(existing)
			resultOrder = append(resultOrder, "custom:"+existing.ID.String())
		} else {
			// create new custom shelf cloned from preset
			newShelf := models.UserCustomShelf{
				ID:             uuid.New(),
				OwnerID:        *uid,
				Slug:           sys.Slug,
				NameZh:         sys.NameZh,
				NameEn:         sys.NameEn,
				Description:    sys.Description,
				Icon:           sys.Icon,
				SortOrder:      sys.SortOrder,
				QueryTags:      sys.QueryTags,
				RequireAllTags: sys.RequireAllTags,
				ExcludeTags:    sys.ExcludeTags,
				IsPublic:       false,
				CreatedAt:      time.Now(),
				UpdatedAt:      time.Now(),
			}
			if err := s.db.Create(&newShelf).Error; err == nil {
				userSlugMap[newShelf.Slug] = &newShelf
				resultOrder = append(resultOrder, "custom:"+newShelf.ID.String())
			}
		}
	}

	// Append any custom shelves that weren't system presets
	for _, cs := range userShelves {
		key := "custom:" + cs.ID.String()
		contains := false
		for _, k := range resultOrder {
			if k == key {
				contains = true
				break
			}
		}
		if !contains {
			resultOrder = append(resultOrder, key)
		}
	}

	// Update user's home layout order
	orderJSONStr := toJSONArray(resultOrder)
	var layout models.UserHomeLayout
	if err := s.db.Where("user_id = ?", *uid).First(&layout).Error; err != nil {
		layout = models.UserHomeLayout{
			UserID:            *uid,
			HiddenSystemSlugs: pq.StringArray{},
			UpdatedAt:         time.Now(),
		}
		s.db.Create(&layout)
	}
	s.db.Exec("UPDATE user_home_layouts SET hidden_system_slugs = '{}', order_json = ?::jsonb, updated_at = NOW() WHERE user_id = ?", orderJSONStr, *uid)

	// Fetch refreshed user shelves
	var finalShelves []models.UserCustomShelf
	s.db.Where("owner_id = ?", *uid).Order("sort_order asc, created_at desc").Find(&finalShelves)

	c.JSON(http.StatusOK, gin.H{
		"items": finalShelves,
		"order": resultOrder,
	})
}

// ForkPresetShelf POST /shelves/custom/fork/:slug
func (s *CatalogService) ForkPresetShelf(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		return
	}
	slug := strings.TrimSpace(c.Param("slug"))
	var sys models.VirtualShelf
	if err := s.db.Where("slug = ?", slug).First(&sys).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "preset shelf not found"})
		return
	}

	// Ensure unique slug for user
	targetSlug := sys.Slug
	var count int64
	s.db.Model(&models.UserCustomShelf{}).Where("owner_id = ? AND slug = ?", *uid, targetSlug).Count(&count)
	if count > 0 {
		targetSlug = targetSlug + "-custom"
	}

	newShelf := models.UserCustomShelf{
		ID:             uuid.New(),
		OwnerID:        *uid,
		Slug:           targetSlug,
		NameZh:         sys.NameZh,
		NameEn:         sys.NameEn,
		Description:    sys.Description,
		Icon:           sys.Icon,
		SortOrder:      sys.SortOrder,
		QueryTags:      sys.QueryTags,
		RequireAllTags: sys.RequireAllTags,
		ExcludeTags:    sys.ExcludeTags,
		IsPublic:       false,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	if err := s.db.Create(&newShelf).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fork shelf: " + err.Error()})
		return
	}

	// Replace sys.Slug in layout order with custom:<id>
	var raw string
	s.db.Raw("SELECT order_json::text FROM user_home_layouts WHERE user_id = ?", *uid).Row().Scan(&raw)
	currentOrder := parseOrderJSONRaw(raw)
	customKey := "custom:" + newShelf.ID.String()
	var newOrder []string
	replaced := false
	for _, k := range currentOrder {
		if k == sys.Slug {
			newOrder = append(newOrder, customKey)
			replaced = true
		} else {
			newOrder = append(newOrder, k)
		}
	}
	if !replaced {
		newOrder = append(newOrder, customKey)
	}
	orderJSONStr := toJSONArray(newOrder)
	s.db.Exec("UPDATE user_home_layouts SET order_json = ?::jsonb, updated_at = NOW() WHERE user_id = ?", orderJSONStr, *uid)

	c.JSON(http.StatusOK, gin.H{
		"shelf": newShelf,
		"order": newOrder,
	})
}

func customShelfKey(id uuid.UUID) string {
	return "custom:" + id.String()
}

func advisoryLockKey(userID uuid.UUID) int64 {
	var n uint64
	for i := 0; i < 8; i++ {
		n = (n << 8) | uint64(userID[i])
	}
	return int64(n)
}

func lockUserShelfTx(tx *gorm.DB, userID uuid.UUID) error {
	return tx.Exec("SELECT pg_advisory_xact_lock(?)", advisoryLockKey(userID)).Error
}

func loadUserCustomShelves(tx *gorm.DB, userID uuid.UUID) ([]models.UserCustomShelf, error) {
	var items []models.UserCustomShelf
	err := tx.Where("owner_id = ?", userID).Order("sort_order asc, created_at asc").Find(&items).Error
	return items, err
}

func loadLayoutOrder(tx *gorm.DB, userID uuid.UUID) []string {
	var raw string
	_ = tx.Raw("SELECT order_json::text FROM user_home_layouts WHERE user_id = ?", userID).Scan(&raw)
	return parseOrderJSONRaw(raw)
}

func stringSlicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func upsertLayoutOrder(tx *gorm.DB, userID uuid.UUID, order []string) error {
	if order == nil {
		order = []string{}
	}
	var layout models.UserHomeLayout
	if err := tx.Where("user_id = ?", userID).First(&layout).Error; err != nil {
		layout = models.UserHomeLayout{
			UserID:            userID,
			HiddenSystemSlugs: pq.StringArray{},
			UpdatedAt:         time.Now(),
		}
		_ = tx.Create(&layout).Error
	}
	return tx.Exec(
		"UPDATE user_home_layouts SET hidden_system_slugs = '{}', order_json = ?::jsonb, updated_at = NOW() WHERE user_id = ?",
		toJSONArray(order), userID,
	).Error
}

// normalizeUserShelfOrder maps a mixed/legacy layout onto the user's shelves only.
// System slugs are rewritten to custom:<id> when the user already has a copy with that slug.
func normalizeUserShelfOrder(order []string, shelves []models.UserCustomShelf) []string {
	byID := make(map[string]struct{}, len(shelves))
	bySlug := make(map[string]uuid.UUID, len(shelves))
	for _, s := range shelves {
		byID[s.ID.String()] = struct{}{}
		bySlug[s.Slug] = s.ID
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(shelves))
	for _, k := range order {
		trimmed := strings.TrimSpace(k)
		if trimmed == "" {
			continue
		}
		var id string
		if strings.HasPrefix(trimmed, "custom:") {
			id = strings.TrimPrefix(trimmed, "custom:")
			if _, ok := byID[id]; !ok {
				continue
			}
		} else if mapped, ok := bySlug[trimmed]; ok {
			id = mapped.String()
		} else {
			continue
		}
		key := "custom:" + id
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	for _, s := range shelves {
		key := customShelfKey(s.ID)
		if !seen[key] {
			out = append(out, key)
			seen[key] = true
		}
	}
	return out
}

func cloneVirtualShelf(sys models.VirtualShelf, userID uuid.UUID) models.UserCustomShelf {
	qTags := sys.QueryTags
	if qTags == nil {
		qTags = pq.StringArray{}
	}
	exTags := sys.ExcludeTags
	if exTags == nil {
		exTags = pq.StringArray{}
	}
	return models.UserCustomShelf{
		ID:             uuid.New(),
		OwnerID:        userID,
		Slug:           sys.Slug,
		NameZh:         sys.NameZh,
		NameEn:         sys.NameEn,
		Description:    sys.Description,
		Icon:           sys.Icon,
		SortOrder:      sys.SortOrder,
		QueryTags:      qTags,
		RequireAllTags: sys.RequireAllTags,
		ExcludeTags:    exTags,
		IsPublic:       false,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
}

func copySystemShelvesToUser(tx *gorm.DB, userID uuid.UUID) ([]models.UserCustomShelf, []string, error) {
	var systemShelves []models.VirtualShelf
	if err := tx.Order("sort_order asc").Find(&systemShelves).Error; err != nil {
		return nil, nil, err
	}
	var resultShelves []models.UserCustomShelf
	var resultOrder []string
	for _, sys := range systemShelves {
		newShelf := cloneVirtualShelf(sys, userID)
		if err := tx.Create(&newShelf).Error; err != nil {
			continue
		}
		resultShelves = append(resultShelves, newShelf)
		resultOrder = append(resultOrder, customShelfKey(newShelf.ID))
	}
	if resultShelves == nil {
		resultShelves = []models.UserCustomShelf{}
	}
	if resultOrder == nil {
		resultOrder = []string{}
	}
	if err := upsertLayoutOrder(tx, userID, resultOrder); err != nil {
		return resultShelves, resultOrder, err
	}
	return resultShelves, resultOrder, nil
}

func existingUserShelfState(db *gorm.DB, userID uuid.UUID, existing []models.UserCustomShelf) ([]models.UserCustomShelf, []string) {
	prev := loadLayoutOrder(db, userID)
	order := normalizeUserShelfOrder(prev, existing)
	if !stringSlicesEqual(prev, order) {
		_ = upsertLayoutOrder(db, userID, order)
	}
	return existing, order
}

// InitUserDefaultShelves copies system virtual_shelves into the user's config
// once. Later calls return the existing user shelves (no dual-track, no overwrite).
func InitUserDefaultShelves(db *gorm.DB, userID uuid.UUID) ([]models.UserCustomShelf, []string, error) {
	existing, err := loadUserCustomShelves(db, userID)
	if err != nil {
		return nil, nil, err
	}
	if len(existing) > 0 {
		items, order := existingUserShelfState(db, userID, existing)
		return items, order, nil
	}

	var resultShelves []models.UserCustomShelf
	var resultOrder []string
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := lockUserShelfTx(tx, userID); err != nil {
			return err
		}
		again, err := loadUserCustomShelves(tx, userID)
		if err != nil {
			return err
		}
		if len(again) > 0 {
			items, order := existingUserShelfState(tx, userID, again)
			resultShelves = items
			resultOrder = order
			return nil
		}
		copied, order, err := copySystemShelvesToUser(tx, userID)
		if err != nil {
			return err
		}
		resultShelves = copied
		resultOrder = order
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	if resultShelves == nil {
		resultShelves = []models.UserCustomShelf{}
	}
	if resultOrder == nil {
		resultOrder = []string{}
	}
	return resultShelves, resultOrder, nil
}

// EnsureDefaultShelves POST /shelves/custom/ensure-defaults
func (s *CatalogService) EnsureDefaultShelves(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		return
	}
	items, order, err := InitUserDefaultShelves(s.db, *uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to ensure shelves: " + err.Error()})
		return
	}
	if items == nil {
		items = []models.UserCustomShelf{}
	}
	if order == nil {
		order = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "order": order})
}

func resetUserDefaultShelves(db *gorm.DB, userID uuid.UUID) ([]models.UserCustomShelf, []string, error) {
	var resultShelves []models.UserCustomShelf
	var resultOrder []string
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := lockUserShelfTx(tx, userID); err != nil {
			return err
		}
		if err := tx.Where("owner_id = ?", userID).Delete(&models.UserCustomShelf{}).Error; err != nil {
			return err
		}
		copied, order, err := copySystemShelvesToUser(tx, userID)
		if err != nil {
			return err
		}
		resultShelves = copied
		resultOrder = order
		return nil
	})
	return resultShelves, resultOrder, err
}

// ResetDefaultShelves POST /shelves/custom/reset-defaults
func (s *CatalogService) ResetDefaultShelves(c *gin.Context) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "login required"})
		return
	}

	shelves, order, err := resetUserDefaultShelves(s.db, *uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset shelves: " + err.Error()})
		return
	}
	if shelves == nil {
		shelves = []models.UserCustomShelf{}
	}
	if order == nil {
		order = []string{}
	}

	c.JSON(http.StatusOK, gin.H{
		"items": shelves,
		"order": order,
	})
}


