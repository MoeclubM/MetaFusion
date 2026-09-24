package catalog

import (
	"sort"
	"strings"
	"time"
)

type searchDocument struct {
	RecordType       string    `json:"record_type"`
	EntityID         string    `json:"entity_id"`
	EntityVersion    int64     `json:"entity_version"`
	Kind             string    `json:"kind"`
	Status           string    `json:"status"`
	CreatedBy        string    `json:"created_by"`
	Types            []string  `json:"types"`
	Tags             []string  `json:"tags"`
	OriginalLanguage string    `json:"original_language"`
	WorkID           string    `json:"work_id"`
	ContentUnitID    string    `json:"content_unit_id"`
	ReleaseID        string    `json:"release_id"`
	MediumID         string    `json:"medium_id"`
	ParentID         string    `json:"parent_id"`
	HasPictures      bool      `json:"has_pictures"`
	UpdatedAt        time.Time `json:"updated_at"`
	TitleText        []string  `json:"title_text"`
	SearchText       []string  `json:"search_text"`
	SearchTextExact  []string  `json:"search_text_exact"`
}

func makeSearchDocument(e Entity) searchDocument {
	titles := make([]string, 0, len(e.Translations)+1)
	text := make([]string, 0, 1+len(e.Translations)*3)
	exact := make([]string, 0, 1+len(e.Translations)*3)
	add := func(dst *[]string, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if len(value) > 4096 {
			value = string([]rune(value)[:4096])
		}
		*dst = append(*dst, value)
	}
	addText := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		add(&text, value)
		exact = append(exact, splitSearchText(value)...)
	}
	add(&titles, e.Title)
	addText(e.Title)
	locales := make([]string, 0, len(e.Translations))
	for locale := range e.Translations {
		locales = append(locales, locale)
	}
	sort.Strings(locales)
	for _, locale := range locales {
		translation := e.Translations[locale]
		add(&titles, translation.Title)
		addText(translation.Title)
		addText(translation.Summary)
		for _, alias := range translation.Aliases {
			addText(alias)
		}
	}

	// External IDs are searchable alongside titles, aliases, and summaries. Keep them
	// in the existing analyzed fields so older indexes remain compatible while an
	// entity is reindexed after this change.
	externalKeys := make([]string, 0, len(e.ExternalIDs))
	for key := range e.ExternalIDs {
		externalKeys = append(externalKeys, key)
	}
	sort.Strings(externalKeys)
	for _, key := range externalKeys {
		value := strings.TrimSpace(e.ExternalIDs[key])
		if value == "" {
			continue
		}
		addText(key + ":" + value)
		addText(value)
	}
	return searchDocument{
		RecordType:       "entity",
		EntityID:         e.ID,
		EntityVersion:    e.Version,
		Kind:             e.Kind,
		Status:           e.Status,
		CreatedBy:        e.CreatedBy,
		Types:            e.Types,
		Tags:             searchTags(e.Attributes["tags"]),
		OriginalLanguage: e.OriginalLanguage,
		WorkID:           e.WorkID,
		ContentUnitID:    e.ContentUnitID,
		ReleaseID:        e.ReleaseID,
		MediumID:         e.MediumID,
		ParentID:         e.ParentID,
		HasPictures:      len(e.Pictures) > 0,
		UpdatedAt:        e.UpdatedAt,
		TitleText:        titles,
		SearchText:       text,
		SearchTextExact:  exact,
	}
}

// Keyword values are split into overlapping chunks so the exact substring
// fallback can cover long summaries without OpenSearch's per-term size limit.
func splitSearchText(value string) []string {
	runes := []rune(value)
	const chunkSize, overlap = 2048, 255
	chunks := make([]string, 0, len(runes)/chunkSize+1)
	for start := 0; start < len(runes); {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
		if end == len(runes) {
			break
		}
		start = end - overlap
	}
	return chunks
}

func searchTags(value any) []string {
	switch tags := value.(type) {
	case []string:
		return tags
	case []any:
		out := make([]string, 0, len(tags))
		for _, tag := range tags {
			if value, ok := tag.(string); ok {
				out = append(out, value)
			}
		}
		return out
	default:
		return nil
	}
}
