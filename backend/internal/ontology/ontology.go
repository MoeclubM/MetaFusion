package ontology

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

var hubTypes = map[string]bool{
	"work": true, "artist": true, "release": true, "franchise": true, "canonical_entry": true,
}

var validDistributionChannels = map[string]bool{
	"physical": true, "digital": true, "web": true, "mixed": true, "": true,
}

func NormalizeDistributionChannel(v string) string {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" {
		return "mixed"
	}
	if validDistributionChannels[v] {
		return v
	}
	return ""
}

func IsEnabledEntityType(db *gorm.DB, code string) bool {
	if code == "" {
		return false
	}
	var total int64
	db.Model(&models.EntityTypeDefinition{}).Count(&total)
	if total == 0 {
		return true
	}
	var n int64
	db.Model(&models.EntityTypeDefinition{}).Where("code = ? AND is_enabled = ?", code, true).Count(&n)
	return n > 0
}

func IsEnabledWorkRole(db *gorm.DB, code string) bool {
	if code == "" {
		return false
	}
	var rt models.RelationType
	if err := db.Where("code = ? AND is_enabled = ?", code, true).First(&rt).Error; err != nil {
		return false
	}
	if len(rt.AllowedTargetTypes) == 0 {
		return true
	}
	for _, t := range rt.AllowedTargetTypes {
		if t == "work" {
			return true
		}
	}
	return false
}

type EdgeSpec struct {
	SourceType       string
	SourceID         uuid.UUID
	TargetType       string
	TargetID         uuid.UUID
	RelationshipType string
	Qualifier        string
}

func ValidateRelationEdge(db *gorm.DB, spec EdgeSpec) error {
	spec.SourceType = strings.ToLower(strings.TrimSpace(spec.SourceType))
	spec.TargetType = strings.ToLower(strings.TrimSpace(spec.TargetType))
	spec.RelationshipType = strings.ToLower(strings.TrimSpace(spec.RelationshipType))
	spec.Qualifier = strings.TrimSpace(spec.Qualifier)

	if spec.SourceID == spec.TargetID && spec.SourceType == spec.TargetType {
		return fmt.Errorf("relationship cannot target the same entity")
	}

	var rt models.RelationType
	if err := db.Where("code = ? AND is_enabled = ?", spec.RelationshipType, true).First(&rt).Error; err != nil {
		return fmt.Errorf("invalid or disabled relationship type: %s", spec.RelationshipType)
	}

	if err := assertEndpointExists(db, spec.SourceType, spec.SourceID); err != nil {
		return err
	}
	if err := assertEndpointExists(db, spec.TargetType, spec.TargetID); err != nil {
		return err
	}

	srcCodes, err := endpointTypeCodes(db, spec.SourceType, spec.SourceID)
	if err != nil {
		return err
	}
	tgtCodes, err := endpointTypeCodes(db, spec.TargetType, spec.TargetID)
	if err != nil {
		return err
	}
	if !typesAllowed(rt.AllowedSourceTypes, srcCodes) {
		return fmt.Errorf("source type not allowed for %s", spec.RelationshipType)
	}
	if !typesAllowed(rt.AllowedTargetTypes, tgtCodes) {
		return fmt.Errorf("target type not allowed for %s", spec.RelationshipType)
	}

	if rt.IsHierarchical {
		if wouldCycle(db, spec) {
			return fmt.Errorf("hierarchical relationship would create a cycle")
		}
	}
	return nil
}

func assertEndpointExists(db *gorm.DB, typ string, id uuid.UUID) error {
	var n int64
	switch typ {
	case "work":
		db.Model(&models.Work{}).Where("id = ?", id).Count(&n)
	case "artist":
		db.Model(&models.Artist{}).Where("id = ?", id).Count(&n)
	case "release":
		db.Model(&models.Release{}).Where("id = ?", id).Count(&n)
	case "franchise":
		db.Model(&models.Franchise{}).Where("id = ?", id).Count(&n)
	case "canonical_entry":
		db.Model(&models.CanonicalEntry{}).Where("id = ?", id).Count(&n)
	default:
		return fmt.Errorf("unsupported entity type: %s", typ)
	}
	if n == 0 {
		return fmt.Errorf("%s not found", typ)
	}
	return nil
}

func endpointTypeCodes(db *gorm.DB, typ string, id uuid.UUID) ([]string, error) {
	codes := []string{typ}
	if typ == "artist" {
		var a models.Artist
		if err := db.Select("entity_type").Where("id = ?", id).First(&a).Error; err != nil {
			return nil, err
		}
		if a.EntityType != "" {
			codes = append(codes, a.EntityType)
		}
	}
	return codes, nil
}

func typesAllowed(allowed []string, actual []string) bool {
	if len(allowed) == 0 {
		return true
	}
	set := map[string]bool{}
	for _, a := range allowed {
		set[strings.ToLower(strings.TrimSpace(a))] = true
	}
	for _, c := range actual {
		if set[strings.ToLower(c)] {
			return true
		}
	}
	return false
}

func wouldCycle(db *gorm.DB, spec EdgeSpec) bool {
	type hop struct {
		typ string
		id  uuid.UUID
	}
	visited := map[string]bool{}
	queue := []hop{{typ: spec.TargetType, id: spec.TargetID}}
	srcKey := spec.SourceType + ":" + spec.SourceID.String()
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		key := cur.typ + ":" + cur.id.String()
		if key == srcKey {
			return true
		}
		if visited[key] {
			continue
		}
		visited[key] = true
		var rows []models.EntityRelationship
		db.Where("source_type = ? AND source_id = ? AND relationship_type = ?", cur.typ, cur.id, spec.RelationshipType).
			Limit(64).Find(&rows)
		for _, r := range rows {
			queue = append(queue, hop{typ: r.TargetType, id: r.TargetID})
		}
	}
	return false
}

// LocaleText is a catalog translation row without parent FKs, for list/relation payloads.
type LocaleText struct {
	Locale    string `json:"locale"`
	Title     string `json:"title,omitempty"`
	Name      string `json:"name,omitempty"`
	Summary   string `json:"summary,omitempty"`
	Biography string `json:"biography,omitempty"`
}

// EntityLabel is the default display name plus original + translation packs.
type EntityLabel struct {
	Name             string
	OriginalName     string
	OriginalLanguage string
	Translations     []LocaleText
}

func LookupName(db *gorm.DB, typ string, id uuid.UUID) (name string, ok bool) {
	switch typ {
	case "work":
		var w models.Work
		if err := db.Select("title").Where("id = ?", id).First(&w).Error; err == nil {
			return w.Title, true
		}
	case "artist":
		var a models.Artist
		if err := db.Select("name").Where("id = ?", id).First(&a).Error; err == nil {
			return a.Name, true
		}
	case "release":
		var r models.Release
		if err := db.Select("edition_name").Where("id = ?", id).First(&r).Error; err == nil {
			return r.EditionName, true
		}
	case "franchise":
		var f models.Franchise
		if err := db.Select("title").Where("id = ?", id).First(&f).Error; err == nil {
			return f.Title, true
		}
	case "canonical_entry":
		var e models.CanonicalEntry
		if err := db.Select("title").Where("id = ?", id).First(&e).Error; err == nil {
			return e.Title, true
		}
	}
	return "", false
}

func LookupDisplay(db *gorm.DB, typ string, id uuid.UUID) (EntityLabel, bool) {
	switch typ {
	case "work":
		var w models.Work
		if err := db.Preload("Translations").Where("id = ?", id).First(&w).Error; err != nil {
			return EntityLabel{}, false
		}
		texts := make([]LocaleText, 0, len(w.Translations))
		for _, t := range w.Translations {
			texts = append(texts, LocaleText{Locale: t.Locale, Title: t.Title, Summary: t.Summary})
		}
		return EntityLabel{Name: w.Title, OriginalName: w.OriginalTitle, OriginalLanguage: w.OriginalLanguage, Translations: texts}, true
	case "artist":
		var a models.Artist
		if err := db.Preload("Translations").Where("id = ?", id).First(&a).Error; err != nil {
			return EntityLabel{}, false
		}
		texts := make([]LocaleText, 0, len(a.Translations))
		for _, t := range a.Translations {
			texts = append(texts, LocaleText{Locale: t.Locale, Name: t.Name, Title: t.Name, Biography: t.Biography, Summary: t.Biography})
		}
		return EntityLabel{Name: a.Name, OriginalName: a.OriginalName, Translations: texts}, true
	case "release":
		var r models.Release
		if err := db.Select("edition_name").Where("id = ?", id).First(&r).Error; err != nil {
			return EntityLabel{}, false
		}
		return EntityLabel{Name: r.EditionName}, true
	case "franchise":
		var f models.Franchise
		if err := db.Preload("Translations").Where("id = ?", id).First(&f).Error; err != nil {
			return EntityLabel{}, false
		}
		texts := make([]LocaleText, 0, len(f.Translations))
		for _, t := range f.Translations {
			texts = append(texts, LocaleText{Locale: t.Locale, Title: t.Title, Summary: t.Summary})
		}
		return EntityLabel{Name: f.Title, OriginalName: f.OriginalTitle, Translations: texts}, true
	case "canonical_entry":
		var e models.CanonicalEntry
		if err := db.Select("title").Where("id = ?", id).First(&e).Error; err != nil {
			return EntityLabel{}, false
		}
		return EntityLabel{Name: e.Title}, true
	}
	return EntityLabel{}, false
}

func HubTypes() map[string]bool { return hubTypes }
