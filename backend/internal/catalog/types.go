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
	// Hidden 表示该字段可写、可检索，但不进详情信息面板（存档/机器用途），
	// 例如资料表原始条目与标签——它们由页面上的专用区块呈现，避免原文 JSON 直出。
	Hidden bool `json:"hidden,omitempty"`
	// Semantics 声明子字段在"对比"中的语义，取值受限于系统支持的规则集合（闭集）：
	//   "content" 描述"实际引用的内容片段范围"（如截取的页段/时间段），参与内容身份对齐；
	//   空值（默认）表示"本版定位"（页码、时间码、文件路径、EPUB 锚点），只反映排版与载体差异。
	// 对比规则据此判定，不按字段名或区间长度猜测内容是否变化。
	Semantics string `json:"semantics,omitempty"`
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
	// FacetFields 指定列表页可用于筛选的字段码（通常是枚举字段）。
	// 取代代码里硬编码 edition_type/format/country 三个下拉；顺序即展示顺序。
	FacetFields []string `json:"facet_fields,omitempty"`
}
// Scheme 是"按使用场景配置"的有限声明式规则：locator / inclusion_attributes /
// subject_attributes 是全局结构，纸书要页码、EPUB 要路径锚点、黑胶要唱片面，
// 必填、排序、范围约束与展示收敛都由它声明，不新增核心实体种类。
//   - Slot 闭集三选一：locator / inclusion_attributes / subject_attributes；
//   - Kinds 拥有者 kind 白名单，空=不限；Types 拥有者动态业务类型白名单，空=不限；
//   - Fields 该上下文可用子字段码（必须已在全局组声明），顺序即展示编辑顺序；
//   - Required ⊆ Fields；RequireRange 仅 locator 有意义，要求至少一个
//     semantics=content 的子字段有值；Enabled 关闭即不参与匹配，可被后台删除。
type Scheme struct {
	Names        Names    `json:"names"`
	Slot         string   `json:"slot"`
	Kinds        []string `json:"kinds,omitempty"`
	Types        []string `json:"types,omitempty"`
	Fields       []string `json:"fields"`
	Required     []string `json:"required,omitempty"`
	RequireRange bool     `json:"require_range,omitempty"`
	Enabled      bool     `json:"enabled"`
}
type Definitions struct {
	Types        map[string]TypeDefinition     `json:"types"`
	Fields       map[string]Field              `json:"fields"`
	Vocabularies map[string]Vocabulary         `json:"vocabularies"`
	Relations    map[string]RelationDefinition `json:"relations"`
	Templates    map[string]Template           `json:"templates"`
	// Schemes 可缺省：旧已发布定义文档没有该键时解码为 nil，实体校验回退全局组，
	// 保持向后兼容；新文档即使空 map 也合法。
	Schemes map[string]Scheme `json:"schemes,omitempty"`
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
