package catalog

import "fmt"

// Retirement prevents new use without making unrelated edits to existing records fail.
//
// 关系端点业务类型停用同样覆盖：validateRelation 的 SourceTypes/TargetTypes
// 走 matches(allowed, actual)——停用类型后，新边挂到该类型端点上判
// invalid_endpoint_types；存量边因 SaveRelation 传 historical=true 且类型检查
// 不看 Enabled，原样更新不受影响。retiredAttributes 管"字段/词表"维度，
// 类型维度由 validateRelation 管，两者正交，见 SaveRelation 的调用顺序。
func (d Definitions) retiredValue(f Field, value, old any) error {
	if value == nil || value == "" {
		return nil
	}
	if !f.Enabled && encode(value) != encode(old) {
		return fmt.Errorf("disabled_field")
	}
	switch f.Type {
	case "enum":
		term, _ := value.(string)
		if !d.Vocabularies[f.Vocabulary].Terms[term].Enabled && encode(value) != encode(old) {
			return fmt.Errorf("disabled_term")
		}
	case "group":
		values, _ := value.(map[string]any)
		previous, _ := old.(map[string]any)
		for key, field := range f.Fields {
			if err := d.retiredValue(field, values[key], previous[key]); err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
		}
	case "list":
		values, _ := value.([]any)
		previous, _ := old.([]any)
		for i, item := range values {
			var prior any
			if i < len(previous) {
				prior = previous[i]
			}
			for _, candidate := range previous {
				if encode(item) == encode(candidate) {
					prior = candidate
					break
				}
			}
			if f.Items != nil {
				if err := d.retiredValue(*f.Items, item, prior); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func (d Definitions) retiredAttributes(values, old map[string]any) error {
	for key, value := range values {
		if err := d.retiredValue(d.Fields[key], value, old[key]); err != nil {
			return fmt.Errorf("%s: %w", key, err)
		}
	}
	return nil
}

func (d Definitions) retiredEntity(e, old Entity) error {
	for _, code := range e.Types {
		if !d.Types[code].Enabled && !contains(old.Types, code) {
			return fmt.Errorf("disabled_type: %s", code)
		}
	}
	for _, subject := range e.Subjects {
		if d.Vocabularies["release_role"].Terms[subject.Role].Enabled {
			continue
		}
		found := false
		for _, prior := range old.Subjects {
			found = found || prior.WorkID == subject.WorkID && prior.Role == subject.Role
		}
		if !found {
			return fmt.Errorf("disabled_term")
		}
	}
	// 记录级结构属性与普通属性同源（都由 definitions 声明），停用检查必须一致覆盖，
	// 否则"停用某子字段后仍能新增使用"会在这些落点上漏掉。
	for _, subject := range e.Subjects {
		if err := d.retiredValue(d.Fields["subject_attributes"], subject.Attributes, priorSubjectAttributes(old.Subjects, subject)); err != nil {
			return fmt.Errorf("subject_attributes: %w", err)
		}
	}
	for _, c := range e.Contents {
		prior := priorContent(old.Contents, c)
		if err := d.retiredValue(d.Fields["locator"], map[string]any(c.Locator), priorLocator(prior)); err != nil {
			return fmt.Errorf("locator: %w", err)
		}
		if err := d.retiredValue(d.Fields["inclusion_attributes"], c.Attributes, priorAttributes(prior)); err != nil {
			return fmt.Errorf("inclusion_attributes: %w", err)
		}
	}
	return d.retiredAttributes(e.Attributes, old.Attributes)
}

// 记录级属性的"旧值"按对应条目定位：发行对象按（作品，角色），收录按表达，
// 找不到时退回位置。找不到旧值即视为新增，停用字段/词表会被拒绝。
func priorSubjectAttributes(list []Subject, s Subject) any {
	for _, x := range list {
		if x.WorkID == s.WorkID && x.Role == s.Role {
			return x.Attributes
		}
	}
	for i, x := range list {
		if i == s.Position {
			return x.Attributes
		}
	}
	return nil
}

func priorContent(list []Inclusion, c Inclusion) *Inclusion {
	for i := range list {
		if list[i].ExpressionID != "" && list[i].ExpressionID == c.ExpressionID && list[i].Position == c.Position {
			return &list[i]
		}
	}
	for i := range list {
		if list[i].ExpressionID != "" && list[i].ExpressionID == c.ExpressionID {
			return &list[i]
		}
	}
	for i := range list {
		if list[i].Position == c.Position {
			return &list[i]
		}
	}
	return nil
}

func priorLocator(c *Inclusion) any {
	if c == nil {
		return nil
	}
	return map[string]any(c.Locator)
}

func priorAttributes(c *Inclusion) any {
	if c == nil {
		return nil
	}
	return c.Attributes
}
