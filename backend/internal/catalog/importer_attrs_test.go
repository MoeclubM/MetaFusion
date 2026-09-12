package catalog

import (
	"context"
	"strings"
	"testing"
)

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

// 发行版本签名：同一份载荷重试必须得到同一子键（幂等补齐），
// 追加另一个版本必须得到不同子键（不误并）。
func TestImporterReleaseVariantKey(t *testing.T) {
	base := "bangumi:subject:7:release"
	rel := &ImporterReleasePreview{EditionName: "初回版"}
	disc1 := []ImporterMediumPreview{{Position: 0, Name: "Disc 1", Format: "cd", Tracks: []ImporterTrackPreview{{Position: 1, Title: "第一话", ISRC: "JPX001"}}}}
	disc2 := []ImporterMediumPreview{{Position: 0, Name: "Disc 2", Format: "dvd", Tracks: []ImporterTrackPreview{{Position: 1, Title: "第一话"}}}}

	k1 := importerReleaseVariantKey(base, rel, disc1)
	if k1 == "" || k1 == base {
		t.Fatalf("variant key must be derived from base: %q", k1)
	}
	if again := importerReleaseVariantKey(base, rel, disc1); again != k1 {
		t.Fatalf("same payload must yield same variant key: %q vs %q", again, k1)
	}
	if other := importerReleaseVariantKey(base, rel, disc2); other == k1 {
		t.Fatalf("different medium payload must yield different key: %q", other)
	}
	if renamed := importerReleaseVariantKey(base, &ImporterReleasePreview{EditionName: "通常版"}, disc1); renamed == k1 {
		t.Fatalf("different edition name must yield different key: %q", renamed)
	}
	// 无来源幂等键时不做幂等：返回空串。
	if empty := importerReleaseVariantKey("", rel, disc1); empty != "" {
		t.Fatalf("empty base must stay empty, got %q", empty)
	}
}

// 发行身份不止版名：版名与曲目结构完全一致、但品番/条码/地区/发行日期不同的
// 两个版本（如日本版 JP-001 与台湾版 TW-002）必须得到不同键，不能误并成同一发行。
func TestImporterReleaseVariantKeyIdentityFields(t *testing.T) {
	base := "bangumi:subject:9:release"
	tracks := []ImporterMediumPreview{{
		Position: 0, Name: "O.S.T.", Format: "cd",
		Tracks: []ImporterTrackPreview{{Position: 1, Title: "夜航"}, {Position: 2, Title: "幕间映像"}},
	}}
	name := "原声集"
	jp := importerReleaseVariantKey(base, &ImporterReleasePreview{EditionName: name, CatalogNumber: "JP-001", Country: "JP", Barcode: "4512345678901", EditionDate: "2024-05-20"}, tracks)
	tw := importerReleaseVariantKey(base, &ImporterReleasePreview{EditionName: name, CatalogNumber: "TW-002", Country: "TW"}, tracks)
	if jp == tw {
		t.Fatalf("different region/catalog identity must not collide: %q", jp)
	}
	if again := importerReleaseVariantKey(base, &ImporterReleasePreview{EditionName: name, CatalogNumber: "JP-001", Country: "JP", Barcode: "4512345678901", EditionDate: "2024-05-20"}, tracks); again != jp {
		t.Fatalf("identical identity payload must stay idempotent: %q vs %q", again, jp)
	}
	// 载荷未声明任何身份数据时（仅版名），签名仍应稳定可复现。
	bare1 := importerReleaseVariantKey(base, &ImporterReleasePreview{EditionName: name}, tracks)
	bare2 := importerReleaseVariantKey(base, &ImporterReleasePreview{EditionName: name}, tracks)
	if bare1 == "" || bare1 != bare2 {
		t.Fatalf("bare edition key must stay stable: %q vs %q", bare1, bare2)
	}
}

// 章节树必须先是合法拓扑序：越界、自指、指向后继、父级非篇目都要拒绝，
// 不能静默把节点降为顶层。
func TestValidateImporterEntryTree(t *testing.T) {
	unit := func(parent *int) ImporterCanonicalEntryPreview {
		return ImporterCanonicalEntryPreview{Title: "章节", EntryKind: "content_unit", ParentIndex: parent}
	}
	expr := func(parent *int) ImporterCanonicalEntryPreview {
		return ImporterCanonicalEntryPreview{Title: "正文", ParentIndex: parent}
	}
	five := 5
	zero := 0
	one := 1
	cases := []struct {
		name    string
		entries []ImporterCanonicalEntryPreview
		wantErr bool
	}{
		{"valid nested", []ImporterCanonicalEntryPreview{unit(nil), expr(&zero), expr(nil)}, false},
		{"negative is top level", []ImporterCanonicalEntryPreview{{Title: "顶层", ParentIndex: &five}}, true}, // 5 越界
		{"out of range", []ImporterCanonicalEntryPreview{unit(nil), unit(&five)}, true},
		{"self reference", []ImporterCanonicalEntryPreview{unit(nil), unit(&one)}, true},
		{"points to later node", []ImporterCanonicalEntryPreview{unit(&zero), unit(nil)}, true},
		{"parent not content unit", []ImporterCanonicalEntryPreview{expr(nil), unit(&zero)}, true},
	}
	for _, tc := range cases {
		if err := validateImporterEntryTree(tc.entries); (err != nil) != tc.wantErr {
			t.Errorf("%s: err=%v wantErr=%v", tc.name, err, tc.wantErr)
		}
	}
}

// 篇目去重键：(父, 标题) 与 (父, 编号) 分命名空间，来源 ID 优先；
// 不同父节点下的同名"第一章"不得互相命中。
func TestImporterContentUnitIndexScoping(t *testing.T) {
	partA := "unit-a"
	partB := "unit-b"
	units := []Entity{
		{ID: partA, Title: "上篇", Types: []string{"content_unit"}},
		{ID: partB, Title: "下篇", Types: []string{"content_unit"}},
		{ID: "ch-a1", Title: "第一章", Number: "1", ParentID: partA, Types: []string{"content_unit"}},
		{ID: "ch-b1", Title: "第一章", Number: "1", ParentID: partB, Types: []string{"content_unit"}},
		{ID: "ep-101", Title: "第一话", Number: "1", ExternalIDs: map[string]string{"bangumi_episode": "101"}, Types: []string{"content_unit"}},
	}
	idx := newImporterContentUnitIndex(units)

	if id, ok := idx.lookup(ImporterCanonicalEntryPreview{Title: "第一章", Number: "1"}, partA); !ok || id != "ch-a1" {
		t.Fatalf("part A chapter lookup: %q %v", id, ok)
	}
	if id, ok := idx.lookup(ImporterCanonicalEntryPreview{Title: "第一章", Number: "1"}, partB); !ok || id != "ch-b1" {
		t.Fatalf("part B chapter lookup must not reuse part A: %q %v", id, ok)
	}
	// 来源 ID 优先于标题。
	if id, ok := idx.lookup(ImporterCanonicalEntryPreview{Title: "别的标题", ExternalIDs: map[string]any{"bangumi_episode": 101}}, ""); !ok || id != "ep-101" {
		t.Fatalf("external id lookup must win: %q %v", id, ok)
	}
	// 未知篇目不误命中。
	if _, ok := idx.lookup(ImporterCanonicalEntryPreview{Title: "第三章", Number: "3"}, partA); ok {
		t.Fatal("unknown chapter matched an existing unit")
	}
}

// translations 两种载荷形态都要能落库，非法 locale / 空标题丢弃。
func TestImporterTranslationsFromAny(t *testing.T) {
	arr := importerTranslationsFromAny([]ImporterTranslationItem{{Locale: "zh-CN", Title: "第一话"}, {Locale: "ja", Title: "第一話"}})
	if arr["zh-CN"].Title != "第一话" || arr["ja"].Title != "第一話" {
		t.Fatalf("slice form not normalized: %#v", arr)
	}
	mapped := importerTranslationsFromAny([]any{map[string]any{"locale": "zh-CN", "title": "第一话"}, map[string]any{"locale": "not a locale", "title": "x"}, map[string]any{"locale": "ja", "title": "  "}})
	if len(mapped) != 1 || mapped["zh-CN"].Title != "第一话" {
		t.Fatalf("map form not normalized/filtered: %#v", mapped)
	}
	obj := importerTranslationsFromAny(map[string]any{"zh-CN": map[string]any{"title": "第一话"}})
	if obj["zh-CN"].Title != "第一话" {
		t.Fatalf("object form not normalized: %#v", obj)
	}
	if got := importerTranslationsFromAny(nil); len(got) != 0 {
		t.Fatalf("nil should yield empty map, got %#v", got)
	}
}

// Bangumi 分集请求必须覆盖全部 type，且对不完整结果给出告警。
func TestPreviewBangumiEpisodesCoversAllTypes(t *testing.T) {
	stubBangumi(t)
	ctx := context.Background()
	entries, warnings := previewBangumiEpisodes(ctx, 7)
	if len(entries) != 3 {
		t.Fatalf("expected 3 episodes across types, got %d", len(entries))
	}
	if len(warnings) != 0 {
		t.Fatalf("complete stub should not warn: %v", warnings)
	}
	for _, w := range warnings {
		if !strings.Contains(w, "incomplete") {
			t.Fatalf("unexpected warning: %q", w)
		}
	}
}
