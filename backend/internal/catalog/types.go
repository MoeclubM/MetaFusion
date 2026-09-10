// Package catalog owns metadata only. Optional modules consume its DTOs and events.
package catalog

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
// Locator 描述"该内容位于载体的何处"：页码、时间码、文件路径、章节……
// 不同媒体的定位方式差异极大（书籍按页、音视频按时间、文件按路径），
// 因此键集合**不硬编码**：由 definitions 的 locator 组字段声明，后台可增删。
type Locator map[string]any

// Inclusion（收录关系）与 Subject（发行对象）除结构性的引用与次序外，
// 其余描述全部走 definitions 校验的动态 attributes，不再为每种媒体加专用字段。
type Inclusion struct {
	ExpressionID string         `json:"expression_id"`
	Position     int            `json:"position"`
	Locator      Locator        `json:"locator"`
	Attributes   map[string]any `json:"attributes,omitempty"`
}
type Subject struct {
	WorkID     string         `json:"work_id"`
	Role       string         `json:"role"`
	Position   int            `json:"position"`
	Attributes map[string]any `json:"attributes,omitempty"`
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
	// AnchorKey 仅用于 group 字段：组内任一其它子字段有值时，该锚点子字段必须同时有值。
	// 例：定位组声明 anchor=relative_to，避免出现"有页码却不知相对谁"的悬空定位。
	AnchorKey string `json:"anchor_key,omitempty"`
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
	// PrimaryDateField 指定该模板下代表"作品首发/发行日期"的字段码，
	// 供列表与排序使用。取代代码里硬编码 edition_date 的语义；为空则不展示日期。
	PrimaryDateField string `json:"primary_date_field,omitempty"`
	// BadgeFields 指定在详情页标题旁以徽章形式突出的字段码（如载体格式、平台）。
	// 取代代码里硬编码 format/platform 的做法；顺序即展示顺序。
	BadgeFields []string `json:"badge_fields,omitempty"`
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
	Email    string `json:"email"`
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
