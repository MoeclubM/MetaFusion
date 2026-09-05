package catalog

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ontology"
	"golang.org/x/text/language"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func localizeContent(entry *models.CanonicalEntry, locale string) {
	entry.LocalizedTitle, entry.LocalizedVersionLabel = entry.Title, entry.VersionLabel
	for _, field := range []string{"title", "version_label"} {
		for _, lang := range []string{locale, "en-US", entry.OriginalLanguage} {
			translation, ok := entry.Translations[lang].(map[string]interface{})
			if !ok {
				continue
			}
			value, ok := translation[field].(string)
			if !ok || strings.TrimSpace(value) == "" {
				continue
			}
			if field == "title" {
				entry.LocalizedTitle = value
			} else {
				entry.LocalizedVersionLabel = value
			}
			break
		}
	}
}

func (s *CatalogService) ListCanonicalEntriesPublic(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "24"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 24
	}
	visibleWorks := applyWorkVisibility(s.db.Model(&models.Work{}), currentUserID(c)).Select("works.id")
	query := s.db.Model(&models.CanonicalEntry{}).
		Where("canonical_entries.work_id IN (?)", visibleWorks).
		Preload("Work").Preload("Work.Translations")
	if raw := c.Query("work_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			c.JSON(400, gin.H{"error": backendi18n.T(c, "catalog.invalid_work_id")})
			return
		}
		query = query.Where("work_id = ?", id)
	}
	if raw, exists := c.GetQuery("parent_id"); exists {
		if raw == "root" || raw == "null" {
			query = query.Where("parent_id IS NULL")
		} else {
			id, err := uuid.Parse(raw)
			if err != nil {
				c.JSON(400, gin.H{"error": backendi18n.T(c, "catalog.content_invalid")})
				return
			}
			query = query.Where("parent_id = ?", id)
		}
	}
	if q := c.Query("q"); q != "" {
		like := "%" + q + "%"
		query = query.Where("(title ILIKE ? OR isrc ILIKE ? OR isbn ILIKE ? OR artist_credit ILIKE ? OR translations::text ILIKE ?)", like, like, like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(500, gin.H{"error": backendi18n.T(c, "catalog.content_load_failed")})
		return
	}
	entries := []models.CanonicalEntry{}
	if err := query.Order("position ASC, created_at ASC, id ASC").Offset((page - 1) * size).Limit(size).Find(&entries).Error; err != nil {
		c.JSON(500, gin.H{"error": backendi18n.T(c, "catalog.content_load_failed")})
		return
	}
	for i := range entries {
		localizeContent(&entries[i], backendi18n.LocaleFromContext(c))
	}
	c.JSON(200, gin.H{"items": entries, "total": total, "page": page, "page_size": size})
}

// GetWorkContents returns the complete flat tree, independent of release inventory.
func (s *CatalogService) GetWorkContents(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": backendi18n.T(c, "catalog.invalid_work_id")})
		return
	}
	var work models.Work
	if err := applyWorkVisibility(s.db.Model(&models.Work{}), currentUserID(c)).Select("id").First(&work, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": backendi18n.T(c, "catalog.work_not_found")})
		} else {
			c.JSON(500, gin.H{"error": backendi18n.T(c, "catalog.content_load_failed")})
		}
		return
	}
	entries := []models.CanonicalEntry{}
	if err := s.db.Where("work_id = ?", id).Order("position ASC, created_at ASC, id ASC").Find(&entries).Error; err != nil {
		c.JSON(500, gin.H{"error": backendi18n.T(c, "catalog.content_load_failed")})
		return
	}
	for i := range entries {
		localizeContent(&entries[i], backendi18n.LocaleFromContext(c))
	}
	c.JSON(200, gin.H{"items": entries, "total": len(entries)})
}

func validateContent(entry *models.CanonicalEntry) error {
	if entry.WorkID == nil || *entry.WorkID == uuid.Nil || strings.TrimSpace(entry.Title) == "" || entry.Position < 0 || entry.Duration < 0 {
		return errors.New("catalog.content_invalid")
	}
	if entry.EntryRole != "main" && entry.EntryRole != "extra" && entry.EntryRole != "group" {
		return errors.New("catalog.content_invalid")
	}
	if entry.OriginalLanguage != "" {
		if _, err := language.Parse(entry.OriginalLanguage); err != nil {
			return errors.New("catalog.content_invalid")
		}
	}
	for locale, raw := range entry.Translations {
		if _, err := language.Parse(locale); err != nil {
			return errors.New("catalog.content_invalid")
		}
		values, ok := raw.(map[string]interface{})
		if !ok {
			return errors.New("catalog.content_invalid")
		}
		for field, value := range values {
			if field != "title" && field != "version_label" {
				return errors.New("catalog.content_invalid")
			}
			if _, ok := value.(string); !ok {
				return errors.New("catalog.content_invalid")
			}
		}
	}
	date, err := ontology.NormalizePartialDate(entry.RecordingDate)
	if err != nil {
		return errors.New("catalog.content_invalid")
	}
	entry.RecordingDate = date
	entry.Title = strings.TrimSpace(entry.Title)
	return nil
}

func validateContentAudit(note string, sources []string) error {
	if strings.TrimSpace(note) == "" || len(sources) == 0 {
		return errors.New("catalog.content_audit_required")
	}
	for _, source := range sources {
		u, err := url.Parse(source)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
			return errors.New("catalog.content_audit_required")
		}
	}
	return nil
}

func validateContentParent(tx *gorm.DB, entry models.CanonicalEntry) error {
	seen := map[uuid.UUID]bool{entry.ID: true}
	for parent := entry.ParentID; parent != nil; {
		if seen[*parent] {
			return errors.New("catalog.content_parent_invalid")
		}
		seen[*parent] = true
		var ancestor models.CanonicalEntry
		if err := tx.Select("id", "work_id", "parent_id").First(&ancestor, "id = ?", *parent).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("catalog.content_parent_invalid")
			}
			return err
		}
		if entry.WorkID == nil || ancestor.WorkID == nil || *entry.WorkID != *ancestor.WorkID {
			return errors.New("catalog.content_parent_invalid")
		}
		parent = ancestor.ParentID
	}
	return nil
}

func (s *CatalogService) CreateCanonicalEntryForMember(c *gin.Context) { s.writeContent(c, true) }
func (s *CatalogService) UpdateCanonicalEntryForMember(c *gin.Context) { s.writeContent(c, false) }

func (s *CatalogService) writeContent(c *gin.Context, create bool) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(401, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	id := uuid.New()
	if !create {
		var err error
		id, err = uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": backendi18n.T(c, "catalog.content_invalid")})
			return
		}
	}
	var input map[string]json.RawMessage
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": backendi18n.T(c, "catalog.content_invalid")})
		return
	}
	var audit struct {
		EditNote   string   `json:"edit_note"`
		SourceURLs []string `json:"source_urls"`
	}
	body, _ := json.Marshal(input)
	if err := json.Unmarshal(body, &audit); err != nil {
		c.JSON(400, gin.H{"error": backendi18n.T(c, "catalog.content_invalid")})
		return
	}
	if err := validateContentAudit(audit.EditNote, audit.SourceURLs); err != nil {
		c.JSON(400, gin.H{"error": backendi18n.T(c, err.Error())})
		return
	}
	fields := []string{"title", "sort_title", "duration_seconds", "isrc", "isbn", "artist_credit", "recording_date", "work_id", "parent_id", "position", "number", "entry_role", "original_language", "version_label", "translations", "external_ids", "attributes"}
	patch := map[string]json.RawMessage{}
	for _, field := range fields {
		if value, ok := input[field]; ok {
			if string(value) == "null" && field != "parent_id" {
				c.JSON(400, gin.H{"error": backendi18n.T(c, "catalog.content_invalid")})
				return
			}
			patch[field] = value
		}
	}
	data, _ := json.Marshal(patch)
	entry := models.CanonicalEntry{ID: id, EntryRole: "main", Translations: models.JSONB{}}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var before map[string]interface{}
		if !create {
			// Lock before reading the snapshot so concurrent edits cannot overwrite each other.
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&entry, "id = ?", id).Error; err != nil {
				return err
			}
			snapshot, _ := json.Marshal(entry)
			if err := json.Unmarshal(snapshot, &before); err != nil {
				return err
			}
		}
		oldWork := entry.WorkID
		if err := json.Unmarshal(data, &entry); err != nil {
			return errors.New("catalog.content_invalid")
		}
		if !create && ((oldWork == nil) != (entry.WorkID == nil) || oldWork != nil && *oldWork != *entry.WorkID) {
			return errors.New("catalog.content_work_change")
		}
		if create && entry.WorkID == nil {
			return errors.New("catalog.invalid_work_id")
		}
		if err := validateContent(&entry); err != nil {
			return err
		}
		if entry.WorkID != nil {
			// All hierarchy writers lock the Work; parent checks see a serial order of edits.
			var work models.Work
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&work, "id = ?", entry.WorkID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errors.New("catalog.work_not_found")
				}
				return err
			}
		}
		if err := validateContentParent(tx, entry); err != nil {
			return err
		}
		action := "update"
		if create {
			action = "create"
			if err := tx.Omit(clause.Associations).Create(&entry).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Omit(clause.Associations).Save(&entry).Error; err != nil {
				return err
			}
		}
		snapshot, _ := json.Marshal(entry)
		var after map[string]interface{}
		if err := json.Unmarshal(snapshot, &after); err != nil {
			return err
		}
		return recordRevisionDB(tx, "canonical_entry", entry.ID, uid, action, "catalog.canonical_entry."+action, audit.EditNote, audit.SourceURLs, before, after)
	})
	if err != nil {
		status, key := 500, "catalog.content_save_failed"
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status, key = 404, "catalog.canonical_not_found"
		} else if strings.HasPrefix(err.Error(), "catalog.") {
			status, key = 400, err.Error()
		}
		c.JSON(status, gin.H{"error": backendi18n.T(c, key)})
		return
	}
	localizeContent(&entry, backendi18n.LocaleFromContext(c))
	status := http.StatusOK
	if create {
		status = http.StatusCreated
	}
	c.JSON(status, entry)
}
