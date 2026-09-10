package catalog

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"golang.org/x/text/language"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var codePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
var reserved = map[string]bool{"id": true, "kind": true, "version": true, "status": true, "created_by": true, "work_id": true, "parent_id": true, "release_id": true, "medium_id": true, "content_unit_id": true, "contents": true, "subjects": true, "redirect_id": true}

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

// validateGroupOrder 对命名成对的区间字段做通用顺序校验：
// `X` 与 `X_end` / `X_end_ms` / `X_max` 同时存在时，前者不得大于后者。
// 这套约定取代原先硬编码 page/time 的规则，新增成对字段无需改代码。
// validateGroupOrder 对命名成对的区间字段做通用顺序校验：
//   1) `X_start…` 与 `X_end…`（含 `_start_ms`/`_end_ms`）：替换 start→end 找配对；
//   2) `X_begin` 与 `X_end`；
//   3) `X` 与 `X_end` / `X_end_ms` / `X_max` / `X_until`（追加后缀）。
// 同时存在时前者不得大于后者。这套约定取代原先硬编码 page/time 的规则，
// 新增成对字段无需改代码，只要命名遵循上述约定即自动生效。
func validateGroupOrder(m map[string]any, f Field) error {
	pairs := [][2]string{}
	has := func(k string) bool { _, ok := f.Fields[k]; return ok }
	for key, child := range f.Fields {
		if !numericField(child) {
			continue
		}
		// 命名替换：start→end、begin→end
		for _, marker := range [][2]string{{"start", "end"}, {"begin", "end"}} {
			if idx := strings.Index(key, marker[0]); idx >= 0 {
				cand := key[:idx] + marker[1] + key[idx+len(marker[0]):]
				if cand != key && has(cand) {
					pairs = append(pairs, [2]string{key, cand})
				}
				break
			}
		}
		// 后缀追加
		for _, suffix := range []string{"_end", "_end_ms", "_max", "_until"} {
			if cand := key + suffix; has(cand) {
				pairs = append(pairs, [2]string{key, cand})
			}
		}
	}
	for _, p := range pairs {
		sv, sok := toFloat(m[p[0]])
		ev, eok := toFloat(m[p[1]])
		if sok && eok && sv > ev {
			return fmt.Errorf("invalid_range: %s", p[0])
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
	}
	return nil
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
	default:
		return fmt.Errorf("invalid_field_type")
	}
	return nil
}
func (d Definitions) value(f Field, v any, reference func(string, []string) error, historical bool) error {
	if v == nil || v == "" {
		if f.Required {
			return fmt.Errorf("required_field")
		}
		return nil
	}
	switch f.Type {
	case "text":
		if _, ok := v.(string); !ok {
			return fmt.Errorf("expected_text")
		}
	case "url":
		s, ok := v.(string)
		if !ok || !validURL(s) {
			return fmt.Errorf("invalid_url")
		}
	case "date":
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("invalid_date")
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
		for k, x := range m {
			if _, e := language.Parse(k); e != nil {
				return fmt.Errorf("invalid_locale")
			}
			if _, ok := x.(string); !ok {
				return fmt.Errorf("expected_text")
			}
		}
	case "enum":
		s, ok := v.(string)
		t, exists := d.Vocabularies[f.Vocabulary].Terms[s]
		if !ok || !exists || !historical && !t.Enabled {
			return fmt.Errorf("invalid_term")
		}
	case "entity":
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("invalid_reference")
		}
		return reference(s, f.Kinds)
	case "list":
		items, ok := v.([]any)
		if !ok || len(items) > 1000 {
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
	}
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
	for _, s := range e.Subjects {
		if s.Position < 0 {
			return fmt.Errorf("invalid_position")
		}
		term, ok := d.Vocabularies["release_role"].Terms[s.Role]
		if !ok || !historical && !term.Enabled {
			return fmt.Errorf("invalid_term")
		}
		if err := reference(s.WorkID, []string{"work"}); err != nil {
			return err
		}
		// 发行对象附加属性：由 definitions 的 subject_attributes 组字段校验，
		// 后台可为其增删子字段，无需改代码或迁移。
		if err := d.value(d.Fields["subject_attributes"], s.Attributes, reference, historical); err != nil {
			return fmt.Errorf("subject_attributes: %w", err)
		}
	}
	positions := map[int]bool{}
	for _, c := range e.Contents {
		if c.Position < 0 || positions[c.Position] {
			return fmt.Errorf("duplicate_position")
		}
		positions[c.Position] = true
		if err := reference(c.ExpressionID, []string{"expression"}); err != nil {
			return err
		}
		// 定位方案（页码/时间码/路径/章节…）与收录附加属性同样走 definitions，
		// 不再为每种媒体硬编码字段；locator 允许为空（如整轨收录）。
		if err := d.value(d.Fields["locator"], map[string]any(c.Locator), reference, historical); err != nil {
			return fmt.Errorf("locator: %w", err)
		}
		if err := d.value(d.Fields["inclusion_attributes"], c.Attributes, reference, historical); err != nil {
			return fmt.Errorf("inclusion_attributes: %w", err)
		}
	}
	return nil
}
