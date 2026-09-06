// Package catalogv2 owns metadata only. Optional modules consume its DTOs and events.
package catalogv2

import (
	"encoding/json"
	"time"
)

var Kinds = []string{"agent", "collection", "work", "content_unit", "expression", "release", "medium", "track"}

type Names map[string]string
type Translation struct {
	Title   string   `json:"title"`
	Summary string   `json:"summary,omitempty"`
	Aliases []string `json:"aliases,omitempty"`
}
type Source struct {
	Kind     string `json:"kind"`
	Citation string `json:"citation"`
	URL      string `json:"url,omitempty"`
}
type Picture struct {
	URL     string `json:"url"`
	Caption Names  `json:"caption"`
	Source  Source `json:"source"`
}
type Locator struct {
	RelativeTo string `json:"relative_to,omitempty"`
	PageStart  *int64 `json:"page_start,omitempty"`
	PageEnd    *int64 `json:"page_end,omitempty"`
	TimeStart  *int64 `json:"time_start_ms,omitempty"`
	TimeEnd    *int64 `json:"time_end_ms,omitempty"`
	Path       string `json:"path,omitempty"`
	Chapter    string `json:"chapter,omitempty"`
}
type Inclusion struct {
	ExpressionID string  `json:"expression_id"`
	Position     int     `json:"position"`
	Locator      Locator `json:"locator"`
}
type Subject struct {
	WorkID   string `json:"work_id"`
	Role     string `json:"role"`
	Position int    `json:"position"`
}
type Entity struct {
	ID               string                 `json:"id"`
	Kind             string                 `json:"kind"`
	Version          int64                  `json:"version"`
	Title            string                 `json:"title"`
	OriginalLanguage string                 `json:"original_language"`
	Translations     map[string]Translation `json:"translations"`
	Types            []string               `json:"types"`
	Attributes       map[string]any         `json:"attributes"`
	ExternalIDs      map[string]string      `json:"external_ids"`
	Pictures         []Picture              `json:"pictures"`
	Status           string                 `json:"status"`
	CreatedBy        string                 `json:"created_by"`
	RedirectID       string                 `json:"redirect_id,omitempty"`
	WorkID           string                 `json:"work_id,omitempty"`
	ContentUnitID    string                 `json:"content_unit_id,omitempty"`
	ReleaseID        string                 `json:"release_id,omitempty"`
	MediumID         string                 `json:"medium_id,omitempty"`
	ParentID         string                 `json:"parent_id,omitempty"`
	Position         int                    `json:"position"`
	Number           string                 `json:"number"`
	Contents         []Inclusion            `json:"contents"`
	Subjects         []Subject              `json:"subjects"`
	UpdatedAt        time.Time              `json:"updated_at"`
}
type Edit struct {
	Entity          Entity   `json:"entity"`
	ExpectedVersion int64    `json:"expected_version"`
	EditNote        string   `json:"edit_note"`
	Sources         []Source `json:"sources"`
}
type Relation struct {
	ID         string         `json:"id"`
	Version    int64          `json:"version"`
	Type       string         `json:"type"`
	SourceID   string         `json:"source_id"`
	TargetID   string         `json:"target_id"`
	Position   int            `json:"position"`
	Attributes map[string]any `json:"attributes"`
}
type RelationEdit struct {
	Relation        Relation `json:"relation"`
	ExpectedVersion int64    `json:"expected_version"`
	EditNote        string   `json:"edit_note"`
	Sources         []Source `json:"sources"`
}
type TypeDefinition struct {
	Names    Names    `json:"names"`
	Kinds    []string `json:"kinds"`
	Fields   []string `json:"fields"`
	Template string   `json:"template"`
	Enabled  bool     `json:"enabled"`
}
type Field struct {
	Names      Names            `json:"names"`
	Type       string           `json:"type"`
	Unit       Names            `json:"unit"`
	Required   bool             `json:"required"`
	Enabled    bool             `json:"enabled"`
	Searchable bool             `json:"searchable"`
	Comparable bool             `json:"comparable"`
	Vocabulary string           `json:"vocabulary,omitempty"`
	Kinds      []string         `json:"kinds,omitempty"`
	Fields     map[string]Field `json:"fields,omitempty"`
	Items      *Field           `json:"items,omitempty"`
	Min        *float64         `json:"min,omitempty"`
	Max        *float64         `json:"max,omitempty"`
}
type Term struct {
	Names   Names `json:"names"`
	Enabled bool  `json:"enabled"`
}
type Vocabulary struct {
	Names Names           `json:"names"`
	Terms map[string]Term `json:"terms"`
}
type RelationDefinition struct {
	Names        Names    `json:"names"`
	ReverseNames Names    `json:"reverse_names"`
	SourceKinds  []string `json:"source_kinds"`
	TargetKinds  []string `json:"target_kinds"`
	SourceTypes  []string `json:"source_types"`
	TargetTypes  []string `json:"target_types"`
	Fields       []string `json:"fields"`
	Symmetric    bool     `json:"symmetric"`
	Acyclic      bool     `json:"acyclic"`
	MaxOutgoing  int      `json:"max_outgoing"`
	MaxIncoming  int      `json:"max_incoming"`
	Group        string   `json:"group"`
	GroupNames   Names    `json:"group_names,omitempty"`
	Enabled      bool     `json:"enabled"`
}
type Section struct {
	Names  Names    `json:"names"`
	Fields []string `json:"fields"`
}
type Template struct {
	Names          Names     `json:"names"`
	Sections       []Section `json:"sections"`
	Columns        []string  `json:"columns"`
	RelationGroups []string  `json:"relation_groups"`
	Directory      string    `json:"directory"`
	Modules        []string  `json:"modules"`
}
type Definitions struct {
	Types        map[string]TypeDefinition     `json:"types"`
	Fields       map[string]Field              `json:"fields"`
	Vocabularies map[string]Vocabulary         `json:"vocabularies"`
	Relations    map[string]RelationDefinition `json:"relations"`
	Templates    map[string]Template           `json:"templates"`
}
type DefinitionVersion struct {
	ID          int64       `json:"id"`
	State       string      `json:"state"`
	BaseVersion int64       `json:"base_version"`
	Document    Definitions `json:"document"`
	CreatedAt   time.Time   `json:"created_at"`
}
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}
type Event struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	EntityID  string          `json:"entity_id"`
	Version   int64           `json:"version"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"created_at"`
}

func contains(values []string, v string) bool {
	for _, x := range values {
		if x == v {
			return true
		}
	}
	return false
}
