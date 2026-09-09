package catalog

import "fmt"

// Retirement prevents new use without making unrelated edits to existing records fail.
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
	return d.retiredAttributes(e.Attributes, old.Attributes)
}
