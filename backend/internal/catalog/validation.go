package catalog

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"golang.org/x/text/language"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

var codePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
var reserved = map[string]bool{"id": true, "kind": true, "version": true, "status": true, "created_by": true, "work_id": true, "parent_id": true, "release_id": true, "medium_id": true, "content_unit_id": true, "contents": true, "subjects": true, "redirect_id": true}

// StructuralAttributeFields 是"记录级动态结构"的入口字段码：收录位置（locator）、
// 收录附加属性、发行对象附加属性。它们不是普通实体属性，没有独立 Go 字段或数据库列，
// 全靠 definitions 声明子字段。因此入口本身属于固定契约：允许删除或改成非 group 类型，
// 会让校验空转——取不到定义时未声明的数据反而被放过。入口常驻，内部子字段仍由后台扩展。
var StructuralAttributeFields = []string{"locator", "inclusion_attributes", "subject_attributes"}

// structuralFieldsPresent 校验结构属性入口存在且仍为 group 类型。
func (d Definitions) structuralFieldsPresent() error {
	for _, code := range StructuralAttributeFields {
		f, ok := d.Fields[code]
		if !ok {
			return fmt.Errorf("structural_field_required: %s", code)
		}
		if f.Type != "group" {
			return fmt.Errorf("structural_field_type: %s", code)
		}
	}
	return nil
}

func validURL(s string) bool {
	u, e := url.Parse(s)
	return e == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil
}

// toFloat 把数值统一为 float64：JSON 往返是 float64，而代码内部构造的属性
// （如 track duration）可能是 int/int64，两者都必须接受。
func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		n, err := x.Float64()
		return n, err == nil
	}
	return 0, false
}

// numericField 判断字段是否数值型（无词表、无枚举约束也可比较大小）。
func numericField(f Field) bool { return f.Type == "number" }

// sortedFieldKeys 返回组内子字段码的字典序，用于让校验报错稳定可复现。
func sortedFieldKeys(f Field) []string {
	keys := make([]string, 0, len(f.Fields))
	for k := range f.Fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// validateGroupRanges 校验显式区间声明：range_start 只能写在 number 子字段上，
// 必须指向同组另一个 number 子字段，且两者不能再各自声明区间（拒绝链式与自环）。
func validateGroupRanges(f Field) error {
	for _, key := range sortedFieldKeys(f) {
		child := f.Fields[key]
		if child.RangeStart == "" {
			continue
		}
		if child.Type != "number" {
			return fmt.Errorf("range_start_not_number: %s", key)
		}
		if child.RangeStart == key {
			return fmt.Errorf("range_start_self: %s", key)
		}
		start, ok := f.Fields[child.RangeStart]
		if !ok {
			return fmt.Errorf("range_start_unknown: %s", child.RangeStart)
		}
		if start.Type != "number" {
			return fmt.Errorf("range_start_not_number: %s", child.RangeStart)
		}
		if start.RangeStart != "" {
			return fmt.Errorf("range_start_chain: %s", key)
		}
	}
	return nil
}

// validateGroupOrder 校验组内声明的区间顺序与锚点：range_start 显式声明
// "终点子字段 → 起点子字段"的配对，只有显式声明的区间才比较大小。
// 不再按字段名（start/end、begin/end、_max…）猜测配对：那会让后台新加的两个
// 数字字段在没有任何配置的情况下触发隐含规则，规则来源不可见也不可控。
// 子字段码按字典序遍历，保证多条违规时报错稳定。
func validateGroupOrder(m map[string]any, f Field) error {
	for _, key := range sortedFieldKeys(f) {
		child := f.Fields[key]
		if child.RangeStart == "" {
			continue
		}
		sv, sok := toFloat(m[child.RangeStart])
		ev, eok := toFloat(m[key])
		if sok && eok && sv > ev {
			return fmt.Errorf("invalid_range: %s", child.RangeStart)
		}
	}
	// 锚点规则：组内任一其它子字段有值，锚点子字段必须有值。
	if f.AnchorKey != "" {
		anchorSet := !isEmptyValue(m[f.AnchorKey])
		anyOther := false
		for k, v := range m {
			if k == f.AnchorKey {
				continue
			}
			if !isEmptyValue(v) {
				anyOther = true
				break
			}
		}
		if anyOther && !anchorSet {
			return fmt.Errorf("anchor_required: %s", f.AnchorKey)
		}
	}
	return nil
}

// isEmptyValue 判断属性值是否"未提供"（nil、空串、空数组、空对象）。
func isEmptyValue(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(x) == ""
	case []any:
		return len(x) == 0
	case map[string]any:
		return len(x) == 0
	}
	return false
}
func validateSources(note string, sources []Source) error {
	if strings.TrimSpace(note) == "" || len(sources) == 0 {
		return fmt.Errorf("evidence_required")
	}
	for _, s := range sources {
		if !contains([]string{"url", "publication", "self"}, s.Kind) || strings.TrimSpace(s.Citation) == "" || (s.Kind == "url" && !validURL(s.URL)) || (s.URL != "" && !validURL(s.URL)) {
			return fmt.Errorf("invalid_source")
		}
	}
	return nil
}
func validateNames(n Names) error {
	if strings.TrimSpace(n["zh-CN"]) == "" || strings.TrimSpace(n["en-US"]) == "" {
		return fmt.Errorf("bilingual_names_required")
	}
	for k := range n {
		if _, e := language.Parse(k); e != nil {
			return fmt.Errorf("invalid_locale")
		}
	}
	return nil
}
func validateKinds(kinds []string) error {
	if len(kinds) == 0 {
		return fmt.Errorf("kinds_required")
	}
	for _, k := range kinds {
		if !contains(Kinds, k) {
			return fmt.Errorf("invalid_kind")
		}
	}
	return nil
}
func (d Definitions) Validate() error {
	if len(d.Types) == 0 || d.Fields == nil || d.Relations == nil || d.Vocabularies == nil || d.Templates == nil {
		return fmt.Errorf("definitions_required")
	}
	fields := func(keys []string) error {
		for _, k := range keys {
			if _, ok := d.Fields[k]; !ok {
				return fmt.Errorf("unknown_field: %s", k)
			}
		}
		return nil
	}
	// 结构属性入口属于固定契约：常驻且必须仍是 group，否则校验会因取不到定义而空转。
	if err := d.structuralFieldsPresent(); err != nil {
		return err
	}
	for code, v := range d.Vocabularies {
		if !codePattern.MatchString(code) {
			return fmt.Errorf("invalid_code")
		}
		if e := validateNames(v.Names); e != nil {
			return e
		}
		for k, t := range v.Terms {
			if !codePattern.MatchString(k) {
				return fmt.Errorf("invalid_code")
			}
			if e := validateNames(t.Names); e != nil {
				return e
			}
		}
	}
	for code, f := range d.Fields {
		if !codePattern.MatchString(code) || reserved[code] {
			return fmt.Errorf("reserved_field: %s", code)
		}
		if e := d.validateField(f, 0); e != nil {
			return fmt.Errorf("%s: %w", code, e)
		}
	}
	for code, t := range d.Types {
		if !codePattern.MatchString(code) {
			return fmt.Errorf("invalid_code")
		}
		if e := validateNames(t.Names); e != nil {
			return e
		}
		if e := validateKinds(t.Kinds); e != nil {
			return e
		}
		if e := fields(t.Fields); e != nil {
			return e
		}
		if t.Template != "" {
			if _, ok := d.Templates[t.Template]; !ok {
				return fmt.Errorf("unknown_template")
			}
		}
	}
	for code, r := range d.Relations {
		if !codePattern.MatchString(code) {
			return fmt.Errorf("invalid_code")
		}
		if e := validateNames(r.Names); e != nil {
			return e
		}
		if e := validateNames(r.ReverseNames); e != nil {
			return e
		}
		if e := validateKinds(r.SourceKinds); e != nil {
			return e
		}
		if e := validateKinds(r.TargetKinds); e != nil {
			return e
		}
		if r.Symmetric && r.Acyclic {
			return fmt.Errorf("symmetric_acyclic_conflict")
		}
		if r.MaxIncoming < 0 || r.MaxOutgoing < 0 {
			return fmt.Errorf("invalid_cardinality")
		}
		if e := fields(r.Fields); e != nil {
			return e
		}
		for _, c := range append(append([]string{}, r.SourceTypes...), r.TargetTypes...) {
			if _, ok := d.Types[c]; !ok {
				return fmt.Errorf("unknown_type")
			}
		}
	}
	for code, s := range d.Schemes {
		if err := d.validateScheme(code, s); err != nil {
			return err
		}
	}
	for code, t := range d.Templates {
		if !codePattern.MatchString(code) {
			return fmt.Errorf("invalid_code")
		}
		if e := validateNames(t.Names); e != nil {
			return e
		}
		if !contains([]string{"tree", "list", "discs"}, t.Directory) {
			return fmt.Errorf("invalid_directory")
		}
		if e := fields(t.Columns); e != nil {
			return e
		}
		for _, s := range t.Sections {
			if e := validateNames(s.Names); e != nil {
				return e
			}
			if e := fields(s.Fields); e != nil {
				return e
			}
		}
		// 模板声明的主日期/徽章字段必须真实存在，否则展示层会取到空值而不报错。
		if t.PrimaryDateField != "" {
			if _, ok := d.Fields[t.PrimaryDateField]; !ok {
				return fmt.Errorf("unknown_field: %s", t.PrimaryDateField)
			}
		}
		if e := fields(t.BadgeFields); e != nil {
			return e
		}
		if e := fields(t.FacetFields); e != nil {
			return e
		}
	}
	return nil
}

// validateScheme 校验单个场景声明：码合规、slot 命中结构入口、
// fields 全部已在全局组声明、required ⊆ fields、names 双语；类型错一律拒绝。
func (d Definitions) validateScheme(code string, s Scheme) error {
	if !codePattern.MatchString(code) {
		return fmt.Errorf("invalid_code")
	}
	if !contains(StructuralAttributeFields, s.Slot) {
		return fmt.Errorf("%s: %w", code, fmt.Errorf("invalid_slot"))
	}
	if err := validateNames(s.Names); err != nil {
		return fmt.Errorf("%s: %w", code, err)
	}
	for _, k := range s.Kinds {
		if !contains(Kinds, k) {
			return fmt.Errorf("%s: %w", code, fmt.Errorf("invalid_kind"))
		}
	}
	for _, t := range s.Types {
		if _, ok := d.Types[t]; !ok {
			return fmt.Errorf("%s: %w", code, fmt.Errorf("unknown_type"))
		}
	}
	group, ok := d.Fields[s.Slot]
	if !ok || group.Type != "group" {
		return fmt.Errorf("%s: %w", code, fmt.Errorf("structural_field_type: %s", s.Slot))
	}
	declared := map[string]bool{}
	for k := range group.Fields {
		declared[k] = true
	}
	for _, k := range s.Fields {
		if !declared[k] {
			return fmt.Errorf("%s: %w", code, fmt.Errorf("unknown_field: %s", k))
		}
	}
		allowed := map[string]bool{}
		for _, k := range s.Fields {
			allowed[k] = true
		}
		for _, k := range s.Required {
			if !allowed[k] {
				return fmt.Errorf("%s: %w", code, fmt.Errorf("required_outside_fields: %s", k))
			}
		}
		// 若全局组声明了 AnchorKey（如 relative_to），方案字段集必须包含该锚点，
		// 否则录入时会陷入“不填报缺锚点、填了报未知字段”的死锁。
		if group.AnchorKey != "" && !allowed[group.AnchorKey] {
			return fmt.Errorf("%s: %w", code, fmt.Errorf("scheme_missing_anchor: %s", group.AnchorKey))
		}
		return nil
}

// matchSchemes 找出与拥有者匹配的场景：slot 相同、kinds 命中拥有者 kind
// （空=命中）、types 与拥有者 types 有交集（空=命中）且 enabled。
func (d Definitions) matchSchemes(slot, ownerKind string, ownerTypes []string) []Scheme {
	var out []Scheme
	for _, s := range d.Schemes {
		if !s.Enabled || s.Slot != slot {
			continue
		}
		if len(s.Kinds) > 0 && !contains(s.Kinds, ownerKind) {
			continue
		}
		if len(s.Types) > 0 {
			hit := false
			for _, t := range ownerTypes {
				if contains(s.Types, t) {
					hit = true
					break
				}
			}
			if !hit {
				continue
			}
		}
		out = append(out, s)
	}
	return out
}

// effectiveGroupField 用"并集 fields"构造有效组定义：拷贝全局组定义、
// Fields 过滤到并集、Required 按并集 required 设置；无匹配时回退全局组。
// 入口缺失时返回零值 Field：调用方 value 的 default 分支报 unknown_field_type
// 而非静默放过——入口缺失是固定契约被破坏，定义层由 structuralFieldsPresent
// 在 Validate 拒绝；实体层此处同样失败（空数据已被 isEmptyValue 提前放行，
// 见 TestStructuralEntryMissingRejectsEntityData）。
func (d Definitions) effectiveGroupField(slot, ownerKind string, ownerTypes []string) Field {
	group, ok := d.Fields[slot]
	if !ok {
		return Field{}
	}
	matched := d.matchSchemes(slot, ownerKind, ownerTypes)
	if len(matched) == 0 {
		return group
	}
	union := map[string]bool{}
	required := map[string]bool{}
	order := []string{}
		for _, s := range matched {
			for _, k := range s.Fields {
				if !union[k] {
					union[k] = true
					order = append(order, k)
				}
			}
			for _, k := range s.Required {
				required[k] = true
			}
		}
		// 若全局组有 AnchorKey，自动确保 effectiveGroup 包含该锚点字段定义，双重保障
		if group.AnchorKey != "" && group.Fields[group.AnchorKey].Enabled && !union[group.AnchorKey] {
			union[group.AnchorKey] = true
			order = append(order, group.AnchorKey)
		}
		eff := group
	eff.Fields = map[string]Field{}
	for k, c := range group.Fields {
		if union[k] {
			if required[k] {
				c.Required = true
			} else {
				c.Required = false
			}
			eff.Fields[k] = c
		}
	}
	_ = order
	return eff
}

// requireRangeSchemes 返回匹配场景中 require_range 为 true 的那些（仅 locator 有意义）。
func requireRangeSchemes(matched []Scheme) bool {
	for _, s := range matched {
		if s.RequireRange {
			return true
		}
	}
	return false
}

// checkRangeRequired 要求 locator 至少一个 semantics=content 的子字段非空。
func checkRangeRequired(group Field, m map[string]any) error {
	for k, c := range group.Fields {
		if c.Semantics == "content" && !isEmptyValue(m[k]) {
			return nil
		}
	}
	return fmt.Errorf("range_required")
}

func (d Definitions) validateField(f Field, depth int) error {
	if depth > 4 {
		return fmt.Errorf("field_nesting_limit")
	}
	if e := validateNames(f.Names); e != nil {
		return e
	}
	if f.Min != nil && f.Max != nil && *f.Min > *f.Max {
		return fmt.Errorf("invalid_range")
	}
	// 对比语义是有限声明的闭集：后台只能选择系统真正支持的规则，
	// 不允许自由填写（避免出现"配置了但没有任何运行时效果"的选项）。
	if f.Semantics != "" && f.Semantics != "content" && f.Semantics != "locating" {
		return fmt.Errorf("invalid_semantics")
	}
	switch f.Type {
	case "text", "multilingual", "number", "date", "boolean", "url":
	case "enum":
		if _, ok := d.Vocabularies[f.Vocabulary]; !ok {
			return fmt.Errorf("unknown_vocabulary")
		}
	case "entity":
		return validateKinds(f.Kinds)
	case "list":
		if f.Items == nil {
			return fmt.Errorf("items_required")
		}
		return d.validateField(*f.Items, depth+1)
	case "group":
		for k, c := range f.Fields {
			if !codePattern.MatchString(k) || reserved[k] {
				return fmt.Errorf("invalid_field")
			}
			if e := d.validateField(c, depth+1); e != nil {
				return e
			}
		}
		if e := validateGroupRanges(f); e != nil {
			return e
		}
	default:
		return fmt.Errorf("invalid_field_type")
	}
	return nil
}
// text/url 长度上限：标题外最长的自由文本（简介、引用、URL）统一截断口径，
// 防止超大载荷进 JSONB 拖慢索引与 revisions 快照。数值/日期走各自格式校验。
const (
	maxTextLen = 20000
	maxURLLen  = 4000
)

func (d Definitions) value(f Field, v any, reference func(string, []string) error, historical bool) error {
	// nil 视为未提供：仅在必填或 group 包含必填子字段时拒绝，其余类型非必填放行。
	if v == nil {
		if f.Required {
			return fmt.Errorf("required_field")
		}
		if f.Type == "group" {
			for _, c := range f.Fields {
				if c.Required {
					return fmt.Errorf("required_field")
				}
			}
		}
		return nil
	}
	// 零值 Field（如 effectiveGroupField 入口缺失）：空数据放行（整轨收录不受影响），
	// 携带数据则落入 default 报 unknown_field_type 拦截。
	if f.Type == "" && isEmptyValue(v) {
		return nil
	}
	// 先验类型（Type-check first）：绝不能在类型判断前将空数组 [] 或空对象 {}
	// 误判为数值、布尔等类型的空值放行（防止数字字段接受 []、列表字段接受 {} 导致前端崩溃）。
	switch f.Type {
	case "text":
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("expected_text")
		}
		if strings.TrimSpace(s) == "" {
			if f.Required {
				return fmt.Errorf("required_field")
			}
			return nil
		}
		if len(s) > maxTextLen {
			return fmt.Errorf("text_too_long")
		}
	case "url":
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("invalid_url")
		}
		if strings.TrimSpace(s) == "" {
			if f.Required {
				return fmt.Errorf("required_field")
			}
			return nil
		}
		if len(s) > maxURLLen || !validURL(s) {
			return fmt.Errorf("invalid_url")
		}
	case "date":
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("invalid_date")
		}
		if strings.TrimSpace(s) == "" {
			if f.Required {
				return fmt.Errorf("required_field")
			}
			return nil
		}
		layout := "2006-01-02"
		if len(s) == 4 {
			layout = "2006"
		} else if len(s) == 7 {
			layout = "2006-01"
		}
		if _, e := time.Parse(layout, s); e != nil {
			return fmt.Errorf("invalid_date")
		}
	case "number":
		// Number 必须能转为合法数值（拒绝 []、{}、非数值字符串等）
		n, ok := toFloat(v)
		if !ok || math.IsInf(n, 0) || math.IsNaN(n) || f.Min != nil && n < *f.Min || f.Max != nil && n > *f.Max {
			return fmt.Errorf("invalid_number")
		}
	case "boolean":
		if _, ok := v.(bool); !ok {
			return fmt.Errorf("expected_boolean")
		}
	case "multilingual":
		m, ok := v.(map[string]any)
		if !ok {
			return fmt.Errorf("expected_object")
		}
		if len(m) == 0 {
			if f.Required {
				return fmt.Errorf("required_field")
			}
			return nil
		}
		for k, x := range m {
			if _, e := language.Parse(k); e != nil {
				return fmt.Errorf("invalid_locale")
			}
			s, ok := x.(string)
			if !ok {
				return fmt.Errorf("expected_text")
			}
			if len(s) > maxTextLen {
				return fmt.Errorf("text_too_long")
			}
		}
	case "enum":
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("invalid_term")
		}
		if strings.TrimSpace(s) == "" {
			if f.Required {
				return fmt.Errorf("required_field")
			}
			return nil
		}
		t, exists := d.Vocabularies[f.Vocabulary].Terms[s]
		if !exists || !historical && !t.Enabled {
			return fmt.Errorf("invalid_term")
		}
	case "entity":
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("invalid_reference")
		}
		if strings.TrimSpace(s) == "" {
			if f.Required {
				return fmt.Errorf("required_field")
			}
			return nil
		}
		return reference(s, f.Kinds)
	case "list":
		items, ok := v.([]any)
		if !ok {
			return fmt.Errorf("invalid_list")
		}
		if len(items) == 0 {
			if f.Required {
				return fmt.Errorf("required_field")
			}
			return nil
		}
		if len(items) > 1000 {
			return fmt.Errorf("invalid_list")
		}
		for _, x := range items {
			if e := d.value(*f.Items, x, reference, historical); e != nil {
				return e
			}
		}
	case "group":
		m, ok := v.(map[string]any)
		if !ok {
			return fmt.Errorf("expected_object")
		}
		if len(m) == 0 && f.Required {
			return fmt.Errorf("required_field")
		}
		for k := range m {
			if _, ok := f.Fields[k]; !ok {
				return fmt.Errorf("unknown_field: %s", k)
			}
		}
		for k, c := range f.Fields {
			if e := d.value(c, m[k], reference, historical); e != nil {
				return e
			}
		}
		if e := validateGroupOrder(m, f); e != nil {
			return e
		}
	default:
		return fmt.Errorf("unknown_field_type: %s", f.Type)
	}
	return nil
}
func (d Definitions) attributes(keys []string, values map[string]any, reference func(string, []string) error, historical bool) error {
	for k := range values {
		if !contains(keys, k) {
			return fmt.Errorf("unknown_field: %s", k)
		}
	}
	for _, k := range keys {
		f, ok := d.Fields[k]
		if !ok {
			return fmt.Errorf("unknown_field: %s", k)
		}
		if !historical && !f.Enabled && values[k] != nil {
			return fmt.Errorf("disabled_field: %s", k)
		}
		if e := d.value(f, values[k], reference, historical); e != nil {
			return fmt.Errorf("%s: %w", k, e)
		}
	}
	return nil
}
// importerInternalKeys 是仅 importer 内部写的键：手工 POST/PUT 携带一律拒绝，
// 防止伪造幂等键劫持他人条目。C 路若已做同口径校验则复用此处错误码，不重复建表。
var importerInternalKeys = map[string]bool{"metafusion_import": true}

// validImportKey 校验幂等键格式：bangumi:{subject|person|character}:{数字id}
// 允许派生后缀（:release、:r{hash}、:m{n}、:t{n}、:e{hash}），与 importer.go 的
// importDedupKey/importReleaseChain/importerEntryExprKey 键格式一致。
var importKeyPattern = regexp.MustCompile(`^bangumi:(subject|person|character):[1-9][0-9]*(:e[0-9a-f]+|(:release)?(:r[0-9a-f]+)?(:m[0-9]+(:t[0-9]+)?)?)?$`)

func validImportKey(s string) bool { return importKeyPattern.MatchString(strings.TrimSpace(s)) }

// validateExternalIDs 校验 external_ids：
//   - 键必须符合 codePattern（与 external_databases.code 的库约束同口径）；
//     具体"是否存在+正则+分类"由 Store.Save 经 validateExternalIDsAgainstDB
//     按预设表复核（需读库，此处无库）；
//   - 值非空、长度收敛；metafusion_import 内部键只验格式（invalid_import_key）。
func (d Definitions) validateExternalIDs(e Entity) error {
	if len(e.ExternalIDs) == 0 {
		return nil
	}
	for k, v := range e.ExternalIDs {
		v = strings.TrimSpace(v)
		if v == "" {
			return fmt.Errorf("invalid_external_id: %s", k)
		}
		if len(k) > 64 || len(v) > 2000 {
			return fmt.Errorf("invalid_external_id: %s", k)
		}
		if importerInternalKeys[k] {
			if !validImportKey(v) {
				return fmt.Errorf("invalid_import_key")
			}
			continue
		}
		if !codePattern.MatchString(k) {
			return fmt.Errorf("invalid_external_key: %s", k)
		}
	}
	return nil
}

func (d Definitions) validateEntity(e Entity, reference func(string, []string) error, historical bool) error {
	if !contains(Kinds, e.Kind) || strings.TrimSpace(e.Title) == "" || len(e.Title) > 2000 || e.Position < 0 {
		return fmt.Errorf("invalid_entity")
	}
	if !contains([]string{"draft", "pending_review", "published", "deleted", "merged"}, e.Status) {
		return fmt.Errorf("invalid_status")
	}
	if e.OriginalLanguage != "" {
		if _, err := language.Parse(e.OriginalLanguage); err != nil {
			return fmt.Errorf("invalid_locale")
		}
	}
	for loc, tr := range e.Translations {
		if _, err := language.Parse(loc); err != nil || strings.TrimSpace(tr.Title) == "" {
			return fmt.Errorf("invalid_translation")
		}
		if len(tr.Title) > 2000 || len(tr.Summary) > maxTextLen {
			return fmt.Errorf("translation_too_long")
		}
		for _, a := range tr.Aliases {
			if len(a) > 500 {
				return fmt.Errorf("translation_too_long")
			}
		}
	}
	// 零翻译发布由 Store.Save 显式拦截（translation_required），此处不重复：
	// validateEntity 统一 historical=true（存量/impact 宽容）。保留注释以防回退。
	var keys []string
	seen := map[string]bool{}
	for _, code := range e.Types {
		t, ok := d.Types[code]
		if !ok || !historical && !t.Enabled || !contains(t.Kinds, e.Kind) || seen[code] {
			return fmt.Errorf("invalid_type: %s", code)
		}
		seen[code] = true
		for _, f := range t.Fields {
			if !contains(keys, f) {
				keys = append(keys, f)
			}
		}
	}
	if err := d.attributes(keys, e.Attributes, reference, historical); err != nil {
		return err
	}
	for _, p := range e.Pictures {
		if !validURL(p.URL) {
			return fmt.Errorf("invalid_picture")
		}
		if err := validateSources("picture", []Source{p.Source}); err != nil {
			return err
		}
	}
	allowed := map[string][]string{"content_unit": {"work_id", "parent_id"}, "expression": {"work_id", "content_unit_id"}, "medium": {"release_id", "parent_id"}, "track": {"medium_id", "parent_id"}}
	refs := map[string]string{"work_id": e.WorkID, "parent_id": e.ParentID, "content_unit_id": e.ContentUnitID, "release_id": e.ReleaseID, "medium_id": e.MediumID}
	for k, v := range refs {
		if v != "" && !contains(allowed[e.Kind], k) {
			return fmt.Errorf("invalid_structural_field: %s", k)
		}
		if v != "" {
			if _, err := uuid.Parse(v); err != nil {
				return fmt.Errorf("invalid_id")
			}
		}
	}
	if (e.Kind == "expression" || e.Kind == "content_unit") && e.WorkID == "" || e.Kind == "medium" && e.ReleaseID == "" || e.Kind == "track" && e.MediumID == "" {
		return fmt.Errorf("parent_required")
	}
	if e.Kind != "release" && len(e.Subjects) > 0 || e.Kind != "track" && len(e.Contents) > 0 {
		return fmt.Errorf("invalid_structural_field")
	}
	// Subjects 应用层去重键为（work, role）：同一作品同一角色只允许一条，
	// position 不同也不行（position 是展示序，不是身份）。DB 主键
	// release_subjects(release_id,work_id,role) 同口径，应用层先拦。
	seenSubject := map[string]bool{}
	for _, s := range e.Subjects {
		if s.Position < 0 {
			return fmt.Errorf("invalid_position")
		}
		key := s.WorkID + "\x00" + s.Role
		if seenSubject[key] {
			return fmt.Errorf("duplicate_subject")
		}
		seenSubject[key] = true
		term, ok := d.Vocabularies["release_role"].Terms[s.Role]
		if !ok || !historical && !term.Enabled {
			return fmt.Errorf("invalid_term")
		}
		if err := reference(s.WorkID, []string{"work"}); err != nil {
			return err
		}
		// 发行对象附加属性：有匹配 scheme 时按并集收敛到场景子集，
		// 无匹配时回退全局组（旧文档无 schemes 键时 nil map 即回退）。
		if err := d.value(d.effectiveGroupField("subject_attributes", e.Kind, e.Types), s.Attributes, reference, historical); err != nil {
			return fmt.Errorf("subject_attributes: %w", err)
		}
	}
	positions := map[int]bool{}
	// 同一 Track 允许多次引用同一 Expression（如混音轨分别引用 0-30 秒与 60-90 秒切片）；
	// 仅当 ExpressionID 与 Locator 定位切片完全相同时，才判定为无意义的重复收录报 duplicate_content。
	seenExprLoc := map[string]bool{}
	for _, c := range e.Contents {
		if c.Position < 0 || positions[c.Position] {
			return fmt.Errorf("duplicate_position")
		}
		positions[c.Position] = true
		exprLocKey := c.ExpressionID + "\x00" + encode(c.Locator)
		if seenExprLoc[exprLocKey] {
			return fmt.Errorf("duplicate_content")
		}
		seenExprLoc[exprLocKey] = true
		if err := reference(c.ExpressionID, []string{"expression"}); err != nil {
			return err
		}
		// 定位方案（页码/时间码/路径/章节…）与收录附加属性同样走 definitions，
		// 不再为每种媒体硬编码字段；locator 允许为空（如整轨收录）。
		// 有匹配 scheme 时按场景并集收敛，无匹配回退全局组；匹配场景任一
		// require_range 时 locator 至少一个 content 语义子字段非空。
		locatorField := d.effectiveGroupField("locator", e.Kind, e.Types)
		if err := d.value(locatorField, map[string]any(c.Locator), reference, historical); err != nil {
			return fmt.Errorf("locator: %w", err)
		}
		if requireRangeSchemes(d.matchSchemes("locator", e.Kind, e.Types)) {
			if err := checkRangeRequired(d.Fields["locator"], map[string]any(c.Locator)); err != nil {
				return fmt.Errorf("locator: %w", err)
			}
		}
		if err := d.value(d.effectiveGroupField("inclusion_attributes", e.Kind, e.Types), c.Attributes, reference, historical); err != nil {
			return fmt.Errorf("inclusion_attributes: %w", err)
		}
	}
	return nil
}
