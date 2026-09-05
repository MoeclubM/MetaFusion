package catalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"golang.org/x/text/language"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func localizedCarrierValue(values models.JSONB, locale, fallback, field string) string {
	for _, key := range []string{locale, "en-US", fallback} {
		if key == "" {
			continue
		}
		row, ok := values[key].(map[string]interface{})
		if !ok {
			continue
		}
		if value, ok := row[field].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func localizeRelease(release *models.Release, locale string) {
	release.LocalizedEditionName = localizedCarrierValue(release.Translations, locale, release.OriginalLanguage, "edition_name")
	release.LocalizedNotes = localizedCarrierValue(release.Translations, locale, release.OriginalLanguage, "notes")
	if release.LocalizedEditionName == "" {
		release.LocalizedEditionName = release.EditionName
	}
	if release.LocalizedNotes == "" {
		release.LocalizedNotes = release.Notes
	}
}

func localizeMedium(medium *models.Medium, locale string) {
	medium.LocalizedName = localizedCarrierValue(medium.Translations, locale, medium.OriginalLanguage, "name")
	if medium.LocalizedName == "" {
		medium.LocalizedName = medium.Name
	}
	for i := range medium.Tracks {
		localizeTrack(&medium.Tracks[i], locale)
	}
}

func localizeTrack(track *models.Track, locale string) {
	track.LocalizedTitle = localizedCarrierValue(track.Translations, locale, track.OriginalLanguage, "title")
	if track.LocalizedTitle == "" {
		track.LocalizedTitle = track.Title
	}
	for i := range track.Contents {
		if track.Contents[i].CanonicalEntry != nil {
			localizeContent(track.Contents[i].CanonicalEntry, locale)
		}
	}
}

type MediumWriteInput struct {
	ReleaseID        uuid.UUID    `json:"release_id"`
	ParentID         *uuid.UUID   `json:"parent_id"`
	Position         int          `json:"position"`
	Number           string       `json:"number"`
	Name             string       `json:"name"`
	Format           string       `json:"format"`
	MediaCategory    string       `json:"media_category"`
	Role             string       `json:"role"`
	OriginalLanguage string       `json:"original_language"`
	Translations     models.JSONB `json:"translations"`
	Attributes       models.JSONB `json:"attributes"`
	EditNote         string       `json:"edit_note"`
	SourceURLs       []string     `json:"source_urls"`
}

type TrackWriteInput struct {
	MediumID         uuid.UUID             `json:"medium_id"`
	ParentID         *uuid.UUID            `json:"parent_id"`
	Position         int                   `json:"position"`
	Number           string                `json:"number"`
	Title            string                `json:"title"`
	TitleOverride    string                `json:"title_override"`
	WorkID           *uuid.UUID            `json:"work_id"`
	CanonicalEntryID *uuid.UUID            `json:"canonical_entry_id"`
	Contents         []models.TrackContent `json:"contents"`
	OriginalLanguage string                `json:"original_language"`
	Translations     models.JSONB          `json:"translations"`
	Locator          models.JSONB          `json:"locator"`
	Attributes       models.JSONB          `json:"attributes"`
	DurationSeconds  int                   `json:"duration_seconds"`
	ISRC             string                `json:"isrc"`
	ArtistCredit     string                `json:"artist_credit"`
	AirDate          string                `json:"air_date"`
	EditNote         string                `json:"edit_note"`
	SourceURLs       []string              `json:"source_urls"`
}

func validateCarrierEvidence(note string, sources []string) error {
	if strings.TrimSpace(note) == "" || len(sources) == 0 {
		return errors.New("catalog.carrier_evidence_required")
	}
	for _, source := range sources {
		u, err := url.Parse(source)
		if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return errors.New("catalog.carrier_evidence_required")
		}
	}
	return nil
}

func validateReleaseEvidence(note string, sources []string) error {
	if err := validateCarrierEvidence(note, sources); err != nil {
		return errors.New("catalog.release_evidence_required")
	}
	return nil
}

func validateReleaseTranslations(translations models.JSONB) error {
	for locale, value := range translations {
		if _, err := language.Parse(locale); err != nil {
			return errors.New("catalog.release_invalid_translations")
		}
		fields, ok := value.(map[string]interface{})
		if !ok {
			return errors.New("catalog.release_invalid_translations")
		}
		for key, text := range fields {
			if key != "edition_name" && key != "notes" {
				return errors.New("catalog.release_invalid_translations")
			}
			if _, ok := text.(string); !ok {
				return errors.New("catalog.release_invalid_translations")
			}
		}
	}
	return nil
}

func validateCarrierTranslations(translations models.JSONB, field string) error {
	for locale, value := range translations {
		if strings.TrimSpace(locale) == "" {
			return errors.New("catalog.carrier_invalid_translations")
		}
		if _, err := language.Parse(locale); err != nil {
			return errors.New("catalog.carrier_invalid_translations")
		}
		fields, ok := value.(map[string]interface{})
		if !ok {
			return errors.New("catalog.carrier_invalid_translations")
		}
		for key, text := range fields {
			if key != field {
				return errors.New("catalog.carrier_invalid_translations")
			}
			if _, ok := text.(string); !ok {
				return errors.New("catalog.carrier_invalid_translations")
			}
		}
	}
	return nil
}

// The release row is locked before changing either hierarchy, serializing parent
// changes so concurrent valid moves cannot jointly introduce a cycle.
func validateCarrierParent(db *gorm.DB, table, containerColumn string, id, container uuid.UUID, parent *uuid.UUID) error {
	seen := map[uuid.UUID]bool{id: true}
	for parent != nil {
		if seen[*parent] {
			return errors.New("catalog.carrier_invalid_parent")
		}
		seen[*parent] = true
		var row struct {
			ID       uuid.UUID
			ParentID *uuid.UUID
		}
		if err := db.Table(table).Select("id, parent_id").Where("id = ? AND "+containerColumn+" = ?", *parent, container).Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("catalog.carrier_invalid_parent")
			}
			return err
		}
		parent = row.ParentID
	}
	return nil
}

func normalizeTrackContents(track *models.Track) error {
	if err := models.ValidateCarrierLocator(track.Locator); err != nil {
		return errors.New("catalog.carrier_invalid_locator")
	}
	positions := map[int]bool{}
	for i := range track.Contents {
		content := &track.Contents[i]
		if content.CanonicalEntryID == uuid.Nil || content.Position < 1 || positions[content.Position] {
			return errors.New("catalog.carrier_invalid_contents")
		}
		positions[content.Position] = true
		if err := models.ValidateCarrierLocator(content.Locator); err != nil {
			return errors.New("catalog.carrier_invalid_locator")
		}
		content.ID = uuid.New()
		content.TrackID = track.ID
		content.CanonicalEntry = nil
	}
	if len(track.Contents) > 0 {
		if track.CanonicalEntryID != nil && (len(track.Contents) != 1 || *track.CanonicalEntryID != track.Contents[0].CanonicalEntryID) {
			return errors.New("catalog.carrier_invalid_contents")
		}
		track.CanonicalEntryID = nil
		if len(track.Contents) == 1 {
			id := track.Contents[0].CanonicalEntryID
			track.CanonicalEntryID = &id
		}
	}
	return nil
}

func validateTrackContentWorks(tx *gorm.DB, releaseWorkID uuid.UUID, track *models.Track) error {
	ids := map[uuid.UUID]bool{}
	if track.CanonicalEntryID != nil {
		ids[*track.CanonicalEntryID] = true
	}
	for _, content := range track.Contents {
		ids[content.CanonicalEntryID] = true
	}
	if len(ids) == 0 {
		return nil
	}
	entryIDs := make([]uuid.UUID, 0, len(ids))
	for id := range ids {
		entryIDs = append(entryIDs, id)
	}
	var entries []models.CanonicalEntry
	if err := tx.Select("id, work_id").Where("id IN ?", entryIDs).Find(&entries).Error; err != nil {
		return err
	}
	if len(entries) != len(ids) {
		return errors.New("catalog.canonical_not_found")
	}
	for _, entry := range entries {
		if entry.WorkID == nil || *entry.WorkID != releaseWorkID {
			return errors.New("catalog.carrier_cross_work")
		}
	}
	if track.WorkID != nil && *track.WorkID != releaseWorkID {
		return errors.New("catalog.carrier_cross_work")
	}
	track.WorkID = &releaseWorkID
	return nil
}

func carrierSnapshot(value interface{}) map[string]interface{} {
	b, _ := json.Marshal(value)
	var result map[string]interface{}
	_ = json.Unmarshal(b, &result)
	return result
}

func recordCarrierRevision(db *gorm.DB, c *gin.Context, kind string, id uuid.UUID, note string, sources []string, before, after map[string]interface{}) error {
	action := "create"
	if before != nil {
		action = "update"
	}
	if err := recordRevisionDB(db, kind, id, currentUserID(c), action, "", note, sources, before, after); err != nil {
		return err
	}
	role, _ := c.Get("role")
	return db.Create(&models.AdminAuditLog{ActorID: currentUserID(c), ActorRole: fmt.Sprint(role), Action: "catalog." + action, TargetType: kind, TargetID: id.String(), Detail: models.JSONB{"edit_note": note, "source_urls": sources}, IP: c.ClientIP(), UserAgent: c.Request.UserAgent()}).Error
}

func carrierCanEdit(c *gin.Context, release models.Release) bool {
	uid := currentUserID(c)
	role, _ := c.Get("role")
	return uid != nil && (release.IsMasterVerified || role == "admin" || role == "archivist" || release.UploaderID != nil && *release.UploaderID == *uid)
}

func carrierWriteError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	if strings.HasPrefix(err.Error(), "catalog.") {
		status = http.StatusBadRequest
	}
	if err.Error() == "catalog.forbidden_attach_pending" {
		status = http.StatusForbidden
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		status = http.StatusNotFound
	}
	c.JSON(status, gin.H{"error": backendi18n.T(c, err.Error())})
}

func (s *CatalogService) CreateMediumForMember(c *gin.Context) { s.writeMedium(c, false) }
func (s *CatalogService) UpdateMediumForMember(c *gin.Context) { s.writeMedium(c, true) }

func (s *CatalogService) writeMedium(c *gin.Context, update bool) {
	if currentUserID(c) == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	var input MediumWriteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateCarrierEvidence(input.EditNote, input.SourceURLs); err != nil {
		carrierWriteError(c, err)
		return
	}
	if input.Role == "" {
		input.Role = "primary"
	}
	if input.ReleaseID == uuid.Nil || input.Position < 1 || strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Format) == "" || (input.Role != "primary" && input.Role != "supplement") {
		carrierWriteError(c, errors.New("catalog.carrier_invalid_medium"))
		return
	}
	if err := validateCarrierTranslations(input.Translations, "name"); err != nil {
		carrierWriteError(c, err)
		return
	}
	if input.OriginalLanguage != "" {
		if _, err := language.Parse(input.OriginalLanguage); err != nil {
			carrierWriteError(c, errors.New("catalog.carrier_invalid_translations"))
			return
		}
	}
	medium := models.Medium{ID: uuid.New(), ReleaseID: input.ReleaseID, ParentID: input.ParentID, Position: input.Position, Number: input.Number, Name: input.Name, Format: input.Format, MediaCategory: input.MediaCategory, Role: input.Role, OriginalLanguage: input.OriginalLanguage, Translations: input.Translations, Attributes: input.Attributes}
	if update {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			carrierWriteError(c, errors.New("catalog.invalid_medium_id"))
			return
		}
		medium.ID = id
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var release models.Release
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&release, "id = ?", input.ReleaseID).Error; err != nil {
			return err
		}
		if !carrierCanEdit(c, release) {
			return errors.New("catalog.forbidden_attach_pending")
		}
		var before map[string]interface{}
		if update {
			var previous models.Medium
			if err := tx.First(&previous, "id = ? AND release_id = ?", medium.ID, input.ReleaseID).Error; err != nil {
				return err
			}
			before = carrierSnapshot(previous)
			medium.TrackCount = previous.TrackCount
		}
		if err := validateCarrierParent(tx, "mediums", "release_id", medium.ID, medium.ReleaseID, medium.ParentID); err != nil {
			return err
		}
		if update {
			if err := tx.Omit(clause.Associations).Save(&medium).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Omit(clause.Associations).Create(&medium).Error; err != nil {
				return err
			}
		}
		return recordCarrierRevision(tx, c, "medium", medium.ID, input.EditNote, input.SourceURLs, before, carrierSnapshot(medium))
	})
	if err != nil {
		carrierWriteError(c, err)
		return
	}
	status := http.StatusCreated
	if update {
		status = http.StatusOK
	}
	c.JSON(status, medium)
}

func (s *CatalogService) CreateTrackForMember(c *gin.Context) { s.writeTrack(c, false) }
func (s *CatalogService) UpdateTrackForMember(c *gin.Context) { s.writeTrack(c, true) }

func (s *CatalogService) writeTrack(c *gin.Context, update bool) {
	if currentUserID(c) == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": backendi18n.T(c, "catalog.not_logged_in")})
		return
	}
	var input TrackWriteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateCarrierEvidence(input.EditNote, input.SourceURLs); err != nil {
		carrierWriteError(c, err)
		return
	}
	if input.MediumID == uuid.Nil || input.Position < 1 || input.DurationSeconds < 0 {
		carrierWriteError(c, errors.New("catalog.carrier_invalid_track"))
		return
	}
	if err := validateCarrierTranslations(input.Translations, "title"); err != nil {
		carrierWriteError(c, err)
		return
	}
	if input.OriginalLanguage != "" {
		if _, err := language.Parse(input.OriginalLanguage); err != nil {
			carrierWriteError(c, errors.New("catalog.carrier_invalid_translations"))
			return
		}
	}
	track := models.Track{ID: uuid.New(), MediumID: input.MediumID, ParentID: input.ParentID, Position: input.Position, Number: input.Number, Title: input.Title, TitleOverride: input.TitleOverride, WorkID: input.WorkID, CanonicalEntryID: input.CanonicalEntryID, Contents: input.Contents, OriginalLanguage: input.OriginalLanguage, Translations: input.Translations, Locator: input.Locator, Attributes: input.Attributes, DurationSeconds: input.DurationSeconds, ISRC: input.ISRC, ArtistCredit: input.ArtistCredit, AirDate: input.AirDate}
	if update {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			carrierWriteError(c, errors.New("catalog.carrier_invalid_track"))
			return
		}
		track.ID = id
	}
	if err := normalizeTrackContents(&track); err != nil {
		carrierWriteError(c, err)
		return
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var medium models.Medium
		if err := tx.First(&medium, "id = ?", track.MediumID).Error; err != nil {
			return err
		}
		var release models.Release
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&release, "id = ?", medium.ReleaseID).Error; err != nil {
			return err
		}
		if !carrierCanEdit(c, release) {
			return errors.New("catalog.forbidden_attach_pending")
		}
		var before map[string]interface{}
		if update {
			var previous models.Track
			if err := tx.Preload("Contents").First(&previous, "id = ? AND medium_id = ?", track.ID, track.MediumID).Error; err != nil {
				return err
			}
			before = carrierSnapshot(previous)
		}
		if err := validateCarrierParent(tx, "tracks", "medium_id", track.ID, track.MediumID, track.ParentID); err != nil {
			return err
		}
		if err := validateTrackContentWorks(tx, release.WorkID, &track); err != nil {
			return err
		}
		if strings.TrimSpace(track.Title) == "" {
			if len(track.Contents) == 0 && track.CanonicalEntryID == nil {
				return errors.New("catalog.carrier_invalid_track")
			}
			canonicalID := uuid.Nil
			if track.CanonicalEntryID != nil {
				canonicalID = *track.CanonicalEntryID
			} else {
				canonicalID = track.Contents[0].CanonicalEntryID
			}
			var canonical models.CanonicalEntry
			if err := tx.Select("title").First(&canonical, "id = ?", canonicalID).Error; err != nil {
				return err
			}
			track.Title = canonical.Title
		}
		if update {
			if err := tx.Omit(clause.Associations).Save(&track).Error; err != nil {
				return err
			}
			if err := tx.Where("track_id = ?", track.ID).Delete(&models.TrackContent{}).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Omit(clause.Associations).Create(&track).Error; err != nil {
				return err
			}
		}
		if len(track.Contents) > 0 {
			if err := tx.Omit(clause.Associations).Create(&track.Contents).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&models.Medium{}).Where("id = ?", medium.ID).Update("track_count", gorm.Expr("(SELECT COUNT(*) FROM tracks WHERE medium_id = ?)", medium.ID)).Error; err != nil {
			return err
		}
		return recordCarrierRevision(tx, c, "track", track.ID, input.EditNote, input.SourceURLs, before, carrierSnapshot(track))
	})
	if err != nil {
		carrierWriteError(c, err)
		return
	}
	status := http.StatusCreated
	if update {
		status = http.StatusOK
	}
	c.JSON(status, track)
}
