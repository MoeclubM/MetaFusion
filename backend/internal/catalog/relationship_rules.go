package catalog

import "sort"

// RelationshipRule describes one readable edge. Fixed structural rules are
// read-only views over their existing foreign keys or inclusion tables; ordinary
// relations remain governed by the published definitions document.
type RelationshipRule struct {
	Code         string   `json:"code"`
	Class        string   `json:"class"`
	Names        Names    `json:"names"`
	ReverseNames Names    `json:"reverse_names"`
	SourceKinds  []string `json:"source_kinds"`
	TargetKinds  []string `json:"target_kinds"`
	MaxIncoming  int      `json:"max_incoming"`
	MaxOutgoing  int      `json:"max_outgoing"`
	Ordered      bool     `json:"ordered"`
	Scope        string   `json:"scope,omitempty"`
	ReadOnly     bool     `json:"read_only"`
	Enabled      bool     `json:"enabled"`
}

func fixedRelationshipRules() []RelationshipRule {
	row := func(code, class, source, target string, names, reverse Names, maxIncoming int, ordered bool, scope string) RelationshipRule {
		return RelationshipRule{
			Code: "structure:" + code, Class: class, Names: names, ReverseNames: reverse,
			SourceKinds: []string{source}, TargetKinds: []string{target},
			MaxIncoming: maxIncoming, Ordered: ordered, Scope: scope, ReadOnly: true, Enabled: true,
		}
	}
	return []RelationshipRule{
		row("work_content_unit", "ownership", "work", "content_unit", names4("包含内容单元", "包含內容單元", "内容単位を含む", "Contains content unit"), names4("属于作品", "屬於作品", "作品に属する", "Belongs to work"), 1, true, "work"),
		row("work_expression", "ownership", "work", "expression", names4("具有内容表达", "具有內容表達", "表現を持つ", "Has expression"), names4("表达作品", "表達作品", "作品を表現する", "Expression of work"), 1, true, "work"),
		row("release_medium", "ownership", "release", "medium", names4("包含载体", "包含載體", "媒体を含む", "Contains medium"), names4("属于发行版", "屬於發行版", "リリースに属する", "Belongs to release"), 1, true, "release"),
		row("medium_track", "ownership", "medium", "track", names4("包含收录位置", "包含收錄位置", "収録位置を含む", "Contains track"), names4("属于载体", "屬於載體", "媒体に属する", "Belongs to medium"), 1, true, "medium"),
		row("content_unit_parent", "placement", "content_unit", "content_unit", names4("包含下级内容单元", "包含下級內容單元", "下位内容単位を含む", "Contains child content unit"), names4("位于上级内容单元", "位於上級內容單元", "上位内容単位に属する", "Within parent content unit"), 1, true, "work"),
		row("content_unit_expression", "placement", "content_unit", "expression", names4("承载内容表达", "承載內容表達", "表現を持つ", "Hosts expression"), names4("属于内容单元", "屬於內容單元", "内容単位に属する", "Within content unit"), 1, true, "work"),
		row("medium_parent", "placement", "medium", "medium", names4("包含下级载体", "包含下級載體", "下位媒体を含む", "Contains child medium"), names4("位于上级载体", "位於上級載體", "上位媒体に属する", "Within parent medium"), 1, true, "release"),
		row("track_parent", "placement", "track", "track", names4("包含下级收录位置", "包含下級收錄位置", "下位収録位置を含む", "Contains child track"), names4("位于上级收录位置", "位於上級收錄位置", "上位収録位置に属する", "Within parent track"), 1, true, "medium"),
		row("release_subject", "inclusion", "release", "work", names4("发行作品", "發行作品", "作品をリリースする", "Releases work"), names4("由发行版收录", "由發行版收錄", "リリースに収録される", "Subject of release"), 0, true, ""),
		row("track_content", "inclusion", "track", "expression", names4("收录内容表达", "收錄內容表達", "表現を収録する", "Includes expression"), names4("被收录于轨位", "被收錄於軌位", "トラックに収録される", "Included in track"), 0, true, ""),
	}
}

// RelationshipRules is the single public registry for structural and semantic
// edge codes. A structure: code cannot collide with an administrator's relation
// code; reverse names are presentation labels rather than second edge types.
func RelationshipRules(d Definitions) []RelationshipRule {
	out := fixedRelationshipRules()
	codes := make([]string, 0, len(d.Relations))
	for code := range d.Relations {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	for _, code := range codes {
		r := d.Relations[code]
		out = append(out, RelationshipRule{
			Code: "relation:" + code, Class: "semantic", Names: r.Names, ReverseNames: r.ReverseNames,
			SourceKinds: r.SourceKinds, TargetKinds: r.TargetKinds,
			MaxIncoming: r.MaxIncoming, MaxOutgoing: r.MaxOutgoing, Ordered: true, Enabled: r.Enabled,
		})
	}
	return out
}
