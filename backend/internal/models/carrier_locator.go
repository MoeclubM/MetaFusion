package models

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// ValidateCarrierLocator accepts inclusive page ranges and half-open millisecond
// ranges; chapter and path preserve the carrier's own navigation identifiers.
func ValidateCarrierLocator(locator JSONB) error {
	numbers := map[string]float64{}
	for key, value := range locator {
		switch key {
		case "page_start", "page_end", "time_start_ms", "time_end_ms":
			var n float64
			switch v := value.(type) {
			case float64:
				n = v
			case int:
				n = float64(v)
			case int64:
				n = float64(v)
			case json.Number:
				var err error
				n, err = v.Float64()
				if err != nil {
					return fmt.Errorf("invalid locator %s", key)
				}
			default:
				return fmt.Errorf("invalid locator %s", key)
			}
			minimum := float64(0)
			if strings.HasPrefix(key, "page_") {
				minimum = 1
			}
			if math.IsNaN(n) || math.IsInf(n, 0) || n < minimum || n > 9007199254740991 || math.Trunc(n) != n {
				return fmt.Errorf("invalid locator %s", key)
			}
			numbers[key] = n
		case "chapter", "path":
			v, ok := value.(string)
			if !ok || strings.TrimSpace(v) == "" {
				return fmt.Errorf("invalid locator %s", key)
			}
		default:
			return fmt.Errorf("unknown locator field %s", key)
		}
	}
	for _, kind := range []string{"page", "time"} {
		start, end := "page_start", "page_end"
		if kind == "time" {
			start, end = "time_start_ms", "time_end_ms"
		}
		a, hasStart := numbers[start]
		b, hasEnd := numbers[end]
		if hasEnd && (!hasStart || b < a || kind == "time" && b == a) {
			return fmt.Errorf("invalid locator %s range", kind)
		}
	}
	return nil
}
