package catalog

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// importerValuePayload 是一份"多对象"合法载荷：work + 发行 + 载体 + 曲目 + 两个篇目。
// 用例只改其中一处（含**最后一个**对象），验证取值类校验已在零写入的预检阶段完成。
func importerValuePayload() ImporterImportRequest {
	return ImporterImportRequest{
		EntityType: "work", Source: "bangumi", URLOrID: "https://bgm.tv/subject/7",
		Work: &ImporterWorkPreview{
			Title: "预检取值作品", OriginalLanguage: "ja",
			CatalogMetadata: map[string]any{"bangumi_type": float64(2)},
			Translations:    []ImporterTranslationItem{{Locale: "ja", Title: "預検作品"}},
		},
		Release: &ImporterReleasePreview{EditionName: "初回版", CatalogNumber: "ABC-001"},
		Mediums: []ImporterMediumPreview{{Position: 0, Name: "Disc 1", Format: "cd", Tracks: []ImporterTrackPreview{{Position: 1, Title: "第一话"}}}},
		CanonicalEntries: []ImporterCanonicalEntryPreview{
			{Title: "第一话", EntryKind: "content_unit", Number: "1", OriginalLanguage: "ja"},
			{Title: "第二话", EntryKind: "content_unit", Number: "2", OriginalLanguage: "ja"},
		},
		EditNote: "预检取值探针", SourceURLs: []string{"https://bgm.tv/subject/7"},
	}
}

// countEntities 直接数库里的实体条数（kind 为空串表示全部）：预检"零写入"的判据不看响应，
// 只看真库行数，避免"返回失败但其实已经写了一半"。
func countEntities(t *testing.T, f fixture, kind string) int {
	t.Helper()
	var n int
	if err := f.s.DB.QueryRowContext(context.Background(), `SELECT count(*) FROM catalog.entities WHERE ($1 = '' OR kind = $1)`, kind).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", kind, err)
	}
	return n
}

func assertImportError(t *testing.T, err error, wantSubstrings []string) {
	t.Helper()
	if err == nil {
		t.Fatal("非法载荷必须让导入失败，实际成功")
	}
	for _, want := range wantSubstrings {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("错误信息要能定位（缺 %q），实际：%v", want, err)
		}
	}
}

// 多对象载荷里**最后一个**对象的属性取值不在词表内（写路径要到该对象 Save 时才报
// invalid_term）：预检必须在零写入阶段失败，不留"前面对象已落库"的半成品。
func TestImporterPreflightLateAttributeValueKeepsZeroWrites(t *testing.T) {
	f := newFixture(t)
	last := len(importerValuePayload().CanonicalEntries) - 1
	req := importerValuePayload()
	// entry_role 是词表字段（main/opening/ending/trailer/extra/other），"special" 不在其中。
	req.CanonicalEntries[last].Attributes = map[string]any{"entry_role": "special"}

	before := countEntities(t, f, "")
	_, err := f.s.Import(context.Background(), req, f.u)
	assertImportError(t, err, []string{
		"invalid_attribute_value", fmt.Sprintf("canonical_entries[%d]", last), "entry_role", `"special"`, "invalid_term",
	})
	if after := countEntities(t, f, ""); after != before {
		t.Fatalf("预检失败必须零写入：实体总数 %d -> %d", before, after)
	}
	if works := countEntities(t, f, "work"); works != 0 {
		t.Fatalf("工作条数必须为 0，实际 %d", works)
	}
	for _, kind := range []string{"expression", "content_unit", "release", "medium", "track"} {
		if n := countEntities(t, f, kind); n != 0 {
			t.Fatalf("%s 条数必须为 0，实际 %d", kind, n)
		}
	}
}

// 取值与声明类预检：属性值词表/字段码、原语言、翻译行、日期都在零写入阶段失败，
// 错误码沿用 Save 的原始码，并带上对象标识 + 字段码 + 具体值。
func TestImporterPreflightRejectsDeclaredValues(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*ImporterImportRequest)
		want   []string
	}{
		{"未知字段码", func(r *ImporterImportRequest) {
			r.Work.Fields = map[string]any{"no_such_field": "x"}
		}, []string{"unknown_field", "work.no_such_field", `"x"`}},
		{"原语言非法", func(r *ImporterImportRequest) { r.Work.OriginalLanguage = "jp" },
			[]string{"invalid_locale", "work.original_language", `"jp"`}},
		{"条目原语言非法", func(r *ImporterImportRequest) { r.CanonicalEntries[0].OriginalLanguage = "jp" },
			[]string{"invalid_locale", "canonical_entries[0].original_language", `"jp"`}},
		{"翻译行缺题名", func(r *ImporterImportRequest) {
			r.Work.Translations = []ImporterTranslationItem{{Locale: "zh-CN", Title: " "}}
		}, []string{"invalid_translation", "work.translations[zh-CN]", `title=""`}},
		{"条目翻译行缺题名", func(r *ImporterImportRequest) {
			r.CanonicalEntries[0].Translations = []ImporterTranslationItem{{Locale: "zh-CN", Title: ""}}
		}, []string{"invalid_translation", "canonical_entries[0].translations[zh-CN]"}},
		{"日期非法（作品动态字段）", func(r *ImporterImportRequest) {
			r.Work.Fields = map[string]any{"broadcast_start": "2024-13-45"}
		}, []string{"invalid_attribute_value", "work.broadcast_start", "invalid_date", "2024-13-45"}},
		{"日期非法（发行版本）", func(r *ImporterImportRequest) { r.Release.EditionDate = "2024-13-45" },
			[]string{"invalid_attribute_value", "release.edition_date", "invalid_date"}},
		{"条目属性取值词表不匹配", func(r *ImporterImportRequest) {
			r.CanonicalEntries[0].Attributes = map[string]any{"entry_role": "special"}
		}, []string{"invalid_attribute_value", "canonical_entries[0].entry_role", "invalid_term"}},
		{"载荷属性非本 kind 适用字段", func(r *ImporterImportRequest) {
			// 表达条目无时长时类型为空，属性按 kind 回退校验（duration 这类本 kind 字段可写，
			// 见 validation.go 的 attributeKeys）；catalog_number 只属 release，在 expression
			// 上仍是 unknown_field（写路径同口径）。结构预检先于取值预检，这里走前者。
			r.CanonicalEntries[0].EntryKind = "expression"
			r.CanonicalEntries[0].Attributes = map[string]any{"catalog_number": "X-001"}
		}, []string{"unknown_field", "catalog_number"}},
	}
	// 同一个夹具顺序执行：每个用例都必须"失败且不多写一行"，累计条数不变。
	f := newFixture(t)
	baseline := countEntities(t, f, "")
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := importerValuePayload()
			tc.mutate(&req)
			_, err := f.s.Import(context.Background(), req, f.u)
			assertImportError(t, err, tc.want)
			if after := countEntities(t, f, ""); after != baseline {
				t.Fatalf("预检失败必须零写入：实体总数 %d -> %d", baseline, after)
			}
		})
	}
}

// 反证用（正例）：合法载荷照常成功，取值确实落库——预检不误伤。
func TestImporterPreflightAcceptsValidPayload(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	req := importerValuePayload()
	req.CanonicalEntries[0].Attributes = map[string]any{"entry_role": "main"}
	req.Work.Fields = map[string]any{"broadcast_start": "2024-04-05"}
	req.StaffAssociations = []ImporterStaffAssociation{{
		ParsedName: "甲", ParsedRole: "监督", EntityType: "person", Action: "create", RelationType: "directed_by",
	}}
	out, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatalf("合法载荷必须成功：%v", err)
	}
	if out.ReleaseID == "" || out.ImportedCounts.Mediums == 0 || out.ImportedCounts.Tracks == 0 || out.ImportedCounts.Relations == 0 {
		t.Fatalf("发行链与关联应完整落库：%+v", out.ImportedCounts)
	}
	work, err := f.s.Get(ctx, out.WorkID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if got := work.Attributes["broadcast_start"]; got != "2024-04-05" {
		t.Fatalf("作品日期字段应落库：%v", got)
	}
	units := mustList(t, f, ListOptions{Kind: "content_unit", WorkID: out.WorkID})
	var role any
	for _, u := range units {
		if u.Title == "第一话" {
			role = u.Attributes["entry_role"]
		}
	}
	if role != "main" {
		t.Fatalf("篇目 entry_role 应落库：%v", role)
	}
	release, err := f.s.Get(ctx, out.ReleaseID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if release.Attributes["edition_date"] != nil && release.Attributes["edition_date"] != "" {
		t.Fatalf("载荷未声明发行日期时不应有值：%v", release.Attributes["edition_date"])
	}
}

// 停用词表项（enabled=false）：Save 里由 retiredEntity/retiredAttributes 拦下（新建实体/边无
// 旧值可比），预检必须同样拦，否则后台停用一个词表项后仍会写到一半才失败。
func TestImporterPreflightRejectsRetiredValues(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	v, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	d := v.Document
	vocab := d.Vocabularies["entry_role"]
	vocab.Terms["main"] = Term{Names: vocab.Terms["main"].Names, Enabled: false}
	d.Vocabularies["entry_role"] = vocab
	f.publish(d, v.ETag)

	req := importerValuePayload()
	req.CanonicalEntries[0].Attributes = map[string]any{"entry_role": "main"}
	before := countEntities(t, f, "")
	_, ierr := f.s.Import(ctx, req, f.u)
	assertImportError(t, ierr, []string{"invalid_attribute_value", "canonical_entries[0].entry_role", `"main"`, "disabled_term"})
	if after := countEntities(t, f, ""); after != before {
		t.Fatalf("预检失败必须零写入：实体总数 %d -> %d", before, after)
	}
}

// 关系边的属性取值同样前移：关系定义不再声明 credit_role 时，预检在零写入阶段拦下，
// 而不是先把 work 与 agent 建好、到关系落库才报 unknown_field。
func TestImporterPreflightRelationAttributes(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	v, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	d := v.Document
	rel := d.Relations["directed_by"]
	fields := []string{}
	for _, code := range rel.Fields {
		if code != "credit_role" {
			fields = append(fields, code)
		}
	}
	rel.Fields = fields
	d.Relations["directed_by"] = rel
	f.publish(d, v.ETag)

	req := importerValuePayload()
	req.StaffAssociations = []ImporterStaffAssociation{{
		ParsedName: "甲", ParsedRole: "监督", EntityType: "person", Action: "create", RelationType: "directed_by",
	}}
	before := countEntities(t, f, "")
	_, ierr := f.s.Import(ctx, req, f.u)
	assertImportError(t, ierr, []string{"invalid_attribute_value", "staff_associations[0]", "credit_role", "unknown_field"})
	if after := countEntities(t, f, ""); after != before {
		t.Fatalf("预检失败必须零写入：实体总数 %d -> %d", before, after)
	}
}
