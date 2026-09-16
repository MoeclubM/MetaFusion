package catalog

import (
	"context"
	"testing"
)

// 这批字段此前"声明了却不生效"（模型里没有对应落点，写路径也不读）：
//   - mediums[*].media_category：Entity 无此列，medium 字段集只有 catalog_number/format/role，
//     预览响应里的该字段因此恒为空串；
//   - release.cover_aspect：Picture 只有 url/caption/taken_at/source，比例是前端展示建议；
//   - release.notes / release.catalog_metadata：Entity 没有这两个字段，发行字段集也没有同义项
//     （作品路径的同名对象是来源结构载体，不是可存的值）；
//   - release.language：release 类型字段集不含 language，而 original_language 是另一个已兑现的槽位。
//
// 判据与上一批一致：兑现不了就零写入拒绝（错误码复用 unsupported_field_for_entity_type，
// field 带对象定位），不放宽 Save 校验、也不静默收下。
func TestImporterPreflightRejectsFieldsWithoutModelSlot(t *testing.T) {
	no := false
	cases := []struct {
		name      string
		mutate    func(*ImporterImportRequest)
		wantField string
	}{
		{"载体 media_category", func(r *ImporterImportRequest) { r.Mediums[0].MediaCategory = "cd" },
			"mediums[0].media_category"},
		{"第二个载体的 media_category", func(r *ImporterImportRequest) {
			r.Mediums = append(r.Mediums, ImporterMediumPreview{Position: 1, Name: "Disc 2", Format: "cd"})
			r.Mediums[1].MediaCategory = "dvd"
		}, "mediums[1].media_category"},
		{"发行封面比例", func(r *ImporterImportRequest) { r.Release.CoverAspect = "2:3" },
			"release.cover_aspect"},
		{"发行备注", func(r *ImporterImportRequest) { r.Release.Notes = "初回特典：海报" },
			"release.notes"},
		{"发行来源结构", func(r *ImporterImportRequest) {
			r.Release.CatalogMetadata = map[string]any{"bangumi_type": float64(3)}
		}, "release.catalog_metadata"},
		{"发行语言", func(r *ImporterImportRequest) { r.Release.Language = "ja" },
			"release.language"},
		// download_cover=false 只清空远端图引用，不清空"声明了但写不进去"的字段：
		// 封面比例没有落点，照样明确拒绝，而不是跟着封面一起被静默丢弃。
		{"封面比例（download_cover=false）", func(r *ImporterImportRequest) {
			r.Release.CoverAspect = "2:3"
			r.DownloadCover = &no
		}, "release.cover_aspect"},
	}
	f := newFixture(t)
	baseline := countEntities(t, f, "")
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := importerValuePayload()
			tc.mutate(&req)
			_, err := f.s.Import(context.Background(), req, f.u)
			assertImportError(t, err, []string{
				"unsupported_field_for_entity_type", "entity_type=work", "field=" + tc.wantField,
			})
			if after := countEntities(t, f, ""); after != baseline {
				t.Fatalf("预检失败必须零写入：实体总数 %d -> %d", baseline, after)
			}
			for _, kind := range []string{"work", "release", "medium", "track", "content_unit", "expression"} {
				if n := countEntities(t, f, kind); n != 0 {
					t.Fatalf("%s 条数必须为 0，实际 %d", kind, n)
				}
			}
		})
	}
}

// 空壳不算声明：空串/null/[]/{} 与"没传"同义。预览响应把 mediums[*].media_category 恒以空串
// 带回、前端原样转交，若把空值也算声明，正常的预览→导入往返会被自己拒掉。
func TestImporterAcceptsEmptyValuesForSlotlessFields(t *testing.T) {
	f := newFixture(t)
	req := importerValuePayload()
	req.Mediums[0].MediaCategory = ""
	req.Release.Language = ""
	req.Release.Notes = ""
	req.Release.CoverAspect = ""
	req.Release.CatalogMetadata = map[string]any{}
	out, err := f.s.Import(context.Background(), req, f.u)
	if err != nil {
		t.Fatalf("空值与未声明同义，不该拒绝：%v", err)
	}
	if out.ReleaseID == "" {
		t.Fatalf("发行链应照常落库：%+v", out)
	}
}

// 发行封面是"能按写路径兑现"的那一项：work 封面写 Picture，发行封面按同一口径落 release 实体的
// Picture（只引用远端 URL，不抓取、不转存）。三段覆盖两个分支：新建时落库、幂等复用（同一发行，
// 封面不进版本签名）时补齐缺失的图、已有图不被覆盖。
func TestImporterWritesReleaseCoverPicture(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	plain := importerValuePayload()
	out, err := f.s.Import(ctx, plain, f.u)
	if err != nil {
		t.Fatalf("合法载荷必须成功：%v", err)
	}
	release, err := f.s.Get(ctx, out.ReleaseID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(release.Pictures) != 0 {
		t.Fatalf("载荷未声明发行封面时不该凭空补图：%+v", release.Pictures)
	}

	withCover := importerValuePayload()
	withCover.Release.CoverImageURL = "https://example.com/rel-cover.jpg"
	retry, err := f.s.Import(ctx, withCover, f.u)
	if err != nil {
		t.Fatalf("带发行封面的载荷必须成功：%v", err)
	}
	if retry.ReleaseID != out.ReleaseID {
		t.Fatalf("封面不进发行版本签名，应复用同一发行：%s -> %s", out.ReleaseID, retry.ReleaseID)
	}
	release, err = f.s.Get(ctx, retry.ReleaseID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(release.Pictures) != 1 {
		t.Fatalf("发行封面应作为 Picture 落库：%+v", release.Pictures)
	}
	pic := release.Pictures[0]
	if pic.URL != "https://example.com/rel-cover.jpg" {
		t.Fatalf("发行封面 URL 应回读为载荷声明的地址：%q", pic.URL)
	}
	if pic.Source.URL != "https://bgm.tv/subject/7" || pic.Source.Citation == "" {
		t.Fatalf("远端封面必须可考据（来源页 + 引用说明）：%+v", pic.Source)
	}

	// 已有图不覆盖：换一张封面重导，回读仍是第一张（人工或上游换图不该被下一次导入改回去）。
	other := importerValuePayload()
	other.Release.CoverImageURL = "https://example.com/other-cover.jpg"
	if _, err := f.s.Import(ctx, other, f.u); err != nil {
		t.Fatalf("换封面重导必须成功：%v", err)
	}
	release, err = f.s.Get(ctx, out.ReleaseID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(release.Pictures) != 1 || release.Pictures[0].URL != "https://example.com/rel-cover.jpg" {
		t.Fatalf("已有发行封面不该被覆盖：%+v", release.Pictures)
	}
}

// download_cover 的既有口径对发行封面同样成立：显式 false 不写 Picture，未传保持远端引用。
func TestImporterReleaseCoverHonoursDownloadCoverSwitch(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	no := false

	off := importerValuePayload()
	off.URLOrID = "https://bgm.tv/subject/8"
	off.Release.CoverImageURL = "https://example.com/rel-off.jpg"
	off.DownloadCover = &no
	out, err := f.s.Import(ctx, off, f.u)
	if err != nil {
		t.Fatalf("download_cover=false 必须照常导入：%v", err)
	}
	release, err := f.s.Get(ctx, out.ReleaseID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(release.Pictures) != 0 {
		t.Fatalf("download_cover=false 不该写发行封面：%+v", release.Pictures)
	}

	on := importerValuePayload()
	on.URLOrID = "https://bgm.tv/subject/9"
	on.Release.CoverImageURL = "https://example.com/rel-on.jpg"
	out, err = f.s.Import(ctx, on, f.u)
	if err != nil {
		t.Fatalf("未传 download_cover 时保持透传：%v", err)
	}
	release, err = f.s.Get(ctx, out.ReleaseID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(release.Pictures) != 1 || release.Pictures[0].URL != "https://example.com/rel-on.jpg" {
		t.Fatalf("未传 download_cover 应保留发行封面引用：%+v", release.Pictures)
	}
}
