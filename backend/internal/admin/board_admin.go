package admin

import (
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/models"
)

var validBoardCodeRe = regexp.MustCompile(`^[a-z0-9_]{2,32}$`)

// BoardListItem enriches ForumBoard with live topic count for admin UI.
type BoardListItem struct {
	models.ForumBoard
	TopicCount int64 `json:"topic_count"`
}

func (s *AdminService) ListBoardsAdmin(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	includeDisabled := c.Query("include_disabled") != "false"
	query := s.db.Model(&models.ForumBoard{})
	if !includeDisabled {
		query = query.Where("is_enabled = true")
	}
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("code ILIKE ? OR name_zh ILIKE ? OR description ILIKE ?", like, like, like)
	}
	var boards []models.ForumBoard
	if err := query.Order("sort_order asc, code asc").Find(&boards).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Attach topic counts (lightweight per-board count; boards are few so N+1 is fine)
	items := make([]BoardListItem, 0, len(boards))
	for _, b := range boards {
		var cnt int64
		s.db.Model(&models.DiscussionTopic{}).Where("board_code = ?", b.Code).Count(&cnt)
		items = append(items, BoardListItem{ForumBoard: b, TopicCount: cnt})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

func (s *AdminService) UpsertBoard(c *gin.Context) {
	var input models.ForumBoard
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.Code = strings.TrimSpace(input.Code)
	input.NameZh = strings.TrimSpace(input.NameZh)
	if input.Code == "" || input.NameZh == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.code_name_required")})
		return
	}
	if input.Code == "all" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.all_virtual_forbidden")})
		return
	}
	if !validBoardCodeRe.MatchString(input.Code) {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.code_format")})
		return
	}
	if input.Color != "" && !models.ValidBoardColors[input.Color] {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.invalid_color")})
		return
	}
	if input.Icon != "" && !models.ValidBoardIcons[input.Icon] {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.invalid_icon")})
		return
	}
	if input.Color == "" {
		input.Color = "emerald"
	}
	if input.Icon == "" {
		input.Icon = "BookOpen"
	}
	if input.Code == "comment" {
		input.ShowInFeed = false
	}
	// Sync bilingual names JSONB so localized name stays consistent
	input.NameEn = strings.TrimSpace(input.NameEn)
	if input.Names == nil {
		input.Names = make(models.JSONB)
	}
	if input.NameZh != "" {
		input.Names["zh-CN"] = input.NameZh
	}
	if input.NameEn != "" {
		input.Names["en-US"] = input.NameEn
	} else if input.NameZh != "" {
		input.Names["en-US"] = input.NameZh
	}
	input.UpdatedAt = time.Now()
	// Preserve created_at on update: GORM Save will do upsert; ensure not zeroing it unintentionally
	var existing models.ForumBoard
	if err := s.db.Where("code = ?", input.Code).First(&existing).Error; err == nil {
		input.CreatedAt = existing.CreatedAt
	}
	if err := s.db.Save(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	writeAudit(s.db, c, "board.upsert", "board", input.Code, map[string]interface{}{"name_zh": input.NameZh, "color": input.Color})
	c.JSON(http.StatusOK, input)
}

// UpdateBoard handles PUT /admin/boards/:code — full replace keyed by URL param.
func (s *AdminService) UpdateBoard(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.code_required")})
		return
	}
	if code == "all" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.all_no_delete")})
		return
	}
	var existing models.ForumBoard
	if err := s.db.Where("code = ?", code).First(&existing).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "board.not_found")})
		return
	}
	var input models.ForumBoard
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// If body carries a different code, reject — code is immutable via this endpoint
	if input.Code != "" && input.Code != code {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code in body must match URL or be omitted"})
		return
	}
	input.Code = code
	if strings.TrimSpace(input.NameZh) == "" {
		// keep existing name if not provided
		input.NameZh = existing.NameZh
	}
	input.NameZh = strings.TrimSpace(input.NameZh)
	input.NameEn = strings.TrimSpace(input.NameEn)
	if input.Color == "" {
		input.Color = existing.Color
	}
	if input.Icon == "" {
		input.Icon = existing.Icon
	}
	if input.Color != "" && !models.ValidBoardColors[input.Color] {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.invalid_color")})
		return
	}
	if input.Icon != "" && !models.ValidBoardIcons[input.Icon] {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.invalid_icon")})
		return
	}
	if code == "comment" {
		input.ShowInFeed = false
	}
	// Sync names JSONB
	if input.Names == nil {
		input.Names = make(models.JSONB)
		// carry over existing names then override
		for k, v := range existing.Names {
			input.Names[k] = v
		}
	}
	input.Names["zh-CN"] = input.NameZh
	if input.NameEn != "" {
		input.Names["en-US"] = input.NameEn
	}
	input.CreatedAt = existing.CreatedAt
	input.UpdatedAt = time.Now()
	// Preserve description if not set explicitly — detect via raw map
	if input.Description == "" && existing.Description != "" {
		// Only keep if caller didn't send description field; we can't distinguish empty vs omitted with struct,
		// so we conservatively keep existing when body description is empty and existing had value.
		// Caller wanting to clear must use PATCH with explicit empty.
	}

	if err := s.db.Model(&existing).Updates(map[string]interface{}{
		"name_zh":      input.NameZh,
		"name_en":      input.NameEn,
		"names":        input.Names,
		"description":  input.Description,
		"color":        input.Color,
		"icon":         input.Icon,
		"sort_order":   input.SortOrder,
		"is_enabled":   input.IsEnabled,
		"show_in_feed": input.ShowInFeed,
		"updated_at":   input.UpdatedAt,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var updated models.ForumBoard
	s.db.Where("code = ?", code).First(&updated)
	writeAudit(s.db, c, "board.update", "board", code, map[string]interface{}{"name_zh": input.NameZh})
	c.JSON(http.StatusOK, updated)
}

// PatchBoard handles PATCH /admin/boards/:code — partial update (name/description/sort/is_enabled/show_in_feed/color/icon)
func (s *AdminService) PatchBoard(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" || code == "all" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.code_required")})
		return
	}
	var existing models.ForumBoard
	if err := s.db.Where("code = ?", code).First(&existing).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "board.not_found")})
		return
	}
	var raw map[string]interface{}
	if err := c.ShouldBindJSON(&raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	allowed := map[string]bool{
		"name_zh": true, "name_en": true, "names": true,
		"description": true, "color": true, "icon": true,
		"sort_order": true, "is_enabled": true, "show_in_feed": true,
	}
	updates := map[string]interface{}{}
	for k, v := range raw {
		if allowed[k] {
			updates[k] = v
		}
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid fields"})
		return
	}
	if code == "comment" {
		if _, ok := updates["show_in_feed"]; ok {
			updates["show_in_feed"] = false
		}
	}
	if v, ok := updates["color"]; ok {
		if s, ok := v.(string); ok && s != "" && !models.ValidBoardColors[s] {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.invalid_color")})
			return
		}
	}
	if v, ok := updates["icon"]; ok {
		if s, ok := v.(string); ok && s != "" && !models.ValidBoardIcons[s] {
			c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.invalid_icon")})
			return
		}
	}
	// Keep names JSONB in sync when name_zh/name_en patched
	if _, hasZh := updates["name_zh"]; hasZh {
		if existing.Names == nil {
			existing.Names = make(models.JSONB)
		}
		if zh, ok := updates["name_zh"].(string); ok {
			existing.Names["zh-CN"] = strings.TrimSpace(zh)
		}
		updates["names"] = existing.Names
	}
	if _, hasEn := updates["name_en"]; hasEn {
		if existing.Names == nil {
			existing.Names = make(models.JSONB)
		}
		if en, ok := updates["name_en"].(string); ok && strings.TrimSpace(en) != "" {
			existing.Names["en-US"] = strings.TrimSpace(en)
			updates["names"] = existing.Names
		}
	}
	updates["updated_at"] = time.Now()
	if err := s.db.Model(&models.ForumBoard{}).Where("code = ?", code).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var updated models.ForumBoard
	s.db.Where("code = ?", code).First(&updated)
	writeAudit(s.db, c, "board.patch", "board", code, updates)
	c.JSON(http.StatusOK, updated)
}

func (s *AdminService) DeleteBoard(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.code_required")})
		return
	}
	if code == "announcement" || code == "comment" {
		c.JSON(http.StatusBadRequest, gin.H{"error": code + backendi18n.T(c, "board.code_reserved")})
		return
	}
	if code == "all" {
		c.JSON(http.StatusBadRequest, gin.H{"error": backendi18n.T(c, "board.all_no_delete")})
		return
	}
	var existing models.ForumBoard
	if err := s.db.Where("code = ?", code).First(&existing).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": backendi18n.T(c, "board.not_found")})
		return
	}

	tx := s.db.Begin()
	if err := tx.Model(&models.DiscussionTopic{}).Where("board_code = ?", code).Update("board_code", "announcement").Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	migrated := tx.RowsAffected

	if err := tx.Where("code = ?", code).Delete(&models.ForumBoard{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tx.Commit()
	writeAudit(s.db, c, "board.delete", "board", code, map[string]interface{}{"migrated_to": "announcement", "migrated_count": migrated})
	c.JSON(http.StatusOK, gin.H{"status": "success", "migrated_to": "announcement", "migrated_count": migrated})
}

