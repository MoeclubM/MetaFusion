package catalog

import "fmt"

var TemplateBlocks = []string{"directory", "composition", "editions", "occurrences", "credits", "relations", "resources"}

func (d Definitions) validateTemplateRules(code string, t Template) error {
	if len(t.Kinds) > 0 {
		if err := validateKinds(t.Kinds); err != nil {
			return err
		}
	}
	if t.Blocks != nil {
		seen := map[string]bool{}
		for _, block := range *t.Blocks {
			if !contains(TemplateBlocks, block) || seen[block] {
				return fmt.Errorf("invalid_template_block: %s", code)
			}
			seen[block] = true
		}
	}
	if t.Match == nil {
		return nil
	}
	for _, condition := range *t.Match {
		f, ok := d.Fields[condition.Field]
		if !ok || len(f.ApplicableKinds) == 0 {
			return fmt.Errorf("invalid_template_match: %s", code)
		}
		for _, kind := range t.Kinds {
			if !contains(f.ApplicableKinds, kind) {
				return fmt.Errorf("invalid_template_match: %s", code)
			}
		}
		valueField := f
		switch condition.Operator {
		case "exists":
			if condition.Value != nil {
				return fmt.Errorf("invalid_template_match: %s", code)
			}
			continue
		case "equals":
		case "contains":
			if f.Type != "list" || f.Items == nil {
				return fmt.Errorf("invalid_template_match: %s", code)
			}
			valueField = *f.Items
		default:
			return fmt.Errorf("invalid_template_match: %s", code)
		}
		if !contains([]string{"text", "number", "boolean", "enum", "date"}, valueField.Type) ||
			condition.Value == nil || d.value(valueField, condition.Value, func(string, []string) error { return nil }, true) != nil {
			return fmt.Errorf("invalid_template_match: %s", code)
		}
	}
	return nil
}
