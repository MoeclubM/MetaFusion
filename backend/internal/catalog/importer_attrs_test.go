package catalog

import "testing"

// ISRC 只能落在录音本体（expression.ExternalIDs），不能进 track.attributes：
// 默认 track 定义只声明 duration/role，写 isrc 会被 unknown_field 拒绝。
func TestImporterTrackAttrsOmitsISRC(t *testing.T) {
	attrs := importerTrackAttrs(ImporterTrackPreview{DurationSeconds: 215, ISRC: "JPXX12345678"})
	if _, ok := attrs["isrc"]; ok {
		t.Fatalf("track attributes must not carry isrc: %#v", attrs)
	}
	if attrs["duration"] != float64(215) {
		t.Fatalf("duration missing: %#v", attrs)
	}
	defs := Defaults()
	if err := importerCheckAttrs(defs, "track", attrs); err != nil {
		t.Fatalf("default track attrs rejected: %v", err)
	}
}

// 预检必须提前拦下 unknown_field，否则会先建发行/载体再在曲目处失败。
func TestImporterCheckAttrsRejectsUnknown(t *testing.T) {
	defs := Defaults()
	if err := importerCheckAttrs(defs, "track", map[string]any{"isrc": "JPXX12345678"}); err == nil {
		t.Fatal("unknown track field accepted")
	}
	if err := importerCheckAttrs(defs, "medium", importerMediumAttrs(ImporterMediumPreview{Format: "CD"})); err != nil {
		t.Fatalf("mapped medium format rejected: %v", err)
	}
	// 未在词表内的 format 不写入属性，因此不会触发 unknown_field。
	if attrs := importerMediumAttrs(ImporterMediumPreview{Format: "laser-disc"}); len(attrs) != 0 {
		t.Fatalf("unmapped format should be dropped: %#v", attrs)
	}
}

func TestImporterReleaseAttrsOnlyKnownFields(t *testing.T) {
	attrs := importerReleaseAttrs(&ImporterReleasePreview{
		CatalogNumber: "ABC-1",
		Country:       "JP",
		EditionDate:   "2024-01-05",
		Publisher:     "某出版社",
	})
	if _, ok := attrs["publisher"]; ok {
		t.Fatalf("free-text publisher must not be written as attribute: %#v", attrs)
	}
	if attrs["catalog_number"] != "ABC-1" || attrs["country"] != "JP" {
		t.Fatalf("known fields missing: %#v", attrs)
	}
	if err := importerCheckAttrs(Defaults(), "release", attrs); err != nil {
		t.Fatalf("release attrs rejected: %v", err)
	}
}
