package catalog

import (
	"context"
	"encoding/json"
	"testing"
)

// 非法 entity_type 此前两侧口径不一致：/importer/preview 明确报 invalid_entity_type，
// /importer/import 却吞掉错误回落成 work（同一份载荷"预览拒、落库照建作品"）。
// 现在两侧共用 normalizeImporterEntityType，错误码一致，且都在零写入阶段失败。
func TestImporterInvalidEntityTypeRejectedOnBothEndpoints(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	baseline := countEntities(t, f, "")
	for _, entityType := range []string{"album", "release", "medium", "track", "subject", "person"} {
		t.Run(entityType, func(t *testing.T) {
			req := importerValuePayload()
			req.EntityType = entityType
			_, ierr := f.s.Import(ctx, req, f.u)
			if ierr == nil || ierr.Error() != "invalid_entity_type" {
				t.Fatalf("import 必须与 preview 同码拒绝非法 entity_type：%v", ierr)
			}
			// preview 的归一化发生在出站抓取之前：非法类型不触网，也不触库。
			_, perr := f.s.Preview(ctx, "bangumi", "7", entityType)
			if perr == nil || perr.Error() != "invalid_entity_type" {
				t.Fatalf("preview 必须拒绝非法 entity_type：%v", perr)
			}
			if ierr.Error() != perr.Error() {
				t.Fatalf("两侧错误码必须一致：import=%q preview=%q", ierr.Error(), perr.Error())
			}
			if after := countEntities(t, f, ""); after != baseline {
				t.Fatalf("拒绝必须零写入：实体总数 %d -> %d", baseline, after)
			}
		})
	}
}

// 同一份载荷的两侧判断必须一致（本批第 4 项）：把 /importer/preview 的响应按其契约转成
// /importer/import 的输入（含 JSON 往返，覆盖 int→float64 这类形态差异），预览接受的载荷
// 落库也必须接受，且兑现路径的回读值与声明一致。
//
// 已记录的差异只有一条：预览不产出 release/mediums（审计 P2-9 未修），发行层由调用方补——
// 这里显式断言该差异，避免它被当成"两侧不一致"反复重查；字段级的 unsupported_field_for_entity_type
// 只可能出现在 import 侧（预览请求本身没有载荷），同一来源的预览→导入往返不会触发它。
func TestImporterPreviewAndImportAgreeOnSamePayload(t *testing.T) {
	stubBangumi(t)
	f := newFixture(t)
	ctx := context.Background()

	preview, err := f.s.Preview(ctx, "bangumi", "7", "work")
	if err != nil {
		t.Fatal(err)
	}
	if preview.Release != nil || len(preview.Mediums) != 0 {
		t.Fatalf("预览不该产出 release/mediums（该差异已记录）：release=%+v mediums=%d", preview.Release, len(preview.Mediums))
	}
	raw, err := json.Marshal(preview)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		EntityType       string                          `json:"entity_type"`
		Source           string                          `json:"source"`
		ExternalID       string                          `json:"external_id"`
		Work             *ImporterWorkPreview            `json:"work"`
		CanonicalEntries []ImporterCanonicalEntryPreview `json:"canonical_entries"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	req := ImporterImportRequest{
		EntityType:       wire.EntityType,
		Source:           wire.Source,
		URLOrID:          wire.ExternalID,
		Work:             wire.Work,
		CanonicalEntries: wire.CanonicalEntries,
		Release: &ImporterReleasePreview{
			EditionName:      "初回限定版",
			CatalogNumber:    "TEST-001",
			CoverImageURL:    "https://example.com/rel-cover.jpg",
			OriginalLanguage: "ja",
			Translations:     []ImporterTranslationItem{{Locale: "ja", Title: "初回限定版"}},
		},
		Mediums: []ImporterMediumPreview{{Position: 0, Name: "Disc 1", Format: "cd",
			Tracks: []ImporterTrackPreview{{Position: 1, Title: "テスト音源"}}}},
		EditNote:   "预览→导入往返一致性",
		SourceURLs: []string{preview.ExternalURL},
	}
	out, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatalf("预览接受的来源与实体类型，落库必须同样接受：%v", err)
	}
	if out.WorkID == "" || out.ReleaseID == "" {
		t.Fatalf("作品与发行都应落库：%+v", out)
	}
	release, err := f.s.Get(ctx, out.ReleaseID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	// 兑现路径的回读值：发行封面写 Picture（同一口径的发行语言走 original_language）。
	if len(release.Pictures) != 1 || release.Pictures[0].URL != "https://example.com/rel-cover.jpg" {
		t.Fatalf("发行封面应回读为声明值：%+v", release.Pictures)
	}
	if release.OriginalLanguage != "ja" {
		t.Fatalf("发行原语言应回读为声明值：%q", release.OriginalLanguage)
	}
	work, err := f.s.Get(ctx, out.WorkID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(work.Pictures) != 1 || work.Pictures[0].URL != "https://example.com/cover.jpg" {
		t.Fatalf("预览带回的作品封面照旧落库（不被发行封面挤掉）：%+v", work.Pictures)
	}
}
