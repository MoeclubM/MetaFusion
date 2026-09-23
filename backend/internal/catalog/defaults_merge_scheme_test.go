package catalog

import (
	"encoding/json"
	"testing"
)

func TestMergeSeedBackfillsMissingSchemeMediumFormats(t *testing.T) {
	seed := Defaults()
	vinyl := seed.Schemes["vinyl_track_locator"]
	vinyl.MediumFormats = nil // Simulate a previously published definition without this constraint.
	current := seed
	current.Schemes = map[string]Scheme{"vinyl_track_locator": vinyl}

	merged, added := mergeSeedDefinitions(current, seed)
	formats := merged.Schemes["vinyl_track_locator"].MediumFormats
	if formats == nil || len(*formats) != 1 || (*formats)[0] != "vinyl" {
		t.Fatalf("legacy scheme should inherit the seeded medium format constraint, got %#v", formats)
	}
	if !contains(added, "schemes.vinyl_track_locator.medium_formats") {
		t.Fatalf("backfilled setting should be listed in the merge report: %v", added)
	}
	if _, again := mergeSeedDefinitions(merged, seed); len(again) != 0 {
		t.Fatalf("repeated merge should be idempotent, added %v", again)
	}
}

func TestMergeSeedPreservesExplicitEmptySchemeMediumFormats(t *testing.T) {
	seed := Defaults()
	vinyl := seed.Schemes["vinyl_track_locator"]
	empty := []string{}
	vinyl.MediumFormats = &empty // An explicit empty list means all formats.
	current := seed
	current.Schemes = map[string]Scheme{"vinyl_track_locator": vinyl}

	merged, added := mergeSeedDefinitions(current, seed)
	formats := merged.Schemes["vinyl_track_locator"].MediumFormats
	if formats == nil || len(*formats) != 0 {
		t.Fatalf("explicit empty list should be preserved, got %#v", formats)
	}
	encoded, err := json.Marshal(merged.Schemes["vinyl_track_locator"])
	if err != nil {
		t.Fatalf("marshal merged scheme: %v", err)
	}
	var decoded Scheme
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal merged scheme: %v", err)
	}
	if decoded.MediumFormats == nil || len(*decoded.MediumFormats) != 0 {
		t.Fatalf("explicit empty list should survive JSON persistence, got %#v", decoded.MediumFormats)
	}
	if contains(added, "schemes.vinyl_track_locator.medium_formats") {
		t.Fatalf("explicit empty list must not be reported as a backfill: %v", added)
	}
	if _, again := mergeSeedDefinitions(merged, seed); len(again) != 0 {
		t.Fatalf("repeated merge should be idempotent, added %v", again)
	}
}
