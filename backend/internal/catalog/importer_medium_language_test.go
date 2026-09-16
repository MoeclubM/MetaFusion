package catalog

import (
	"context"
	"testing"
)

// 载体与发行本体的 original_language / translations 此前"声明了却写路径不读取"：
// 现在随各自实体落库；幂等命中（第二次导入同一载荷）走复用分支时补齐缺失行、不覆盖已有行，
// 避免"首次写进去、重试被丢掉"。
func TestImporterWritesMediumAndReleaseLanguageFields(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	req := importerValuePayload()
	req.Release.OriginalLanguage = "ja"
	req.Release.Translations = []ImporterTranslationItem{
		{Locale: "ja", Title: "初回版"},
		{Locale: "zh-CN", Title: "初回版", Summary: "首发限定"},
	}
	req.Mediums[0].OriginalLanguage = "ja"
	// 两种载荷形态并用：载体走语种映射、发行走条目数组。
	req.Mediums[0].Translations = map[string]any{
		"ja":    map[string]any{"title": "ディスク1"},
		"zh-CN": map[string]any{"title": "第一碟"},
	}

	out, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatalf("合法载荷必须成功：%v", err)
	}
	release, err := f.s.Get(ctx, out.ReleaseID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if release.OriginalLanguage != "ja" {
		t.Fatalf("发行原语言应落库：%q", release.OriginalLanguage)
	}
	if got := release.Translations["zh-CN"].Title; got != "初回版" {
		t.Fatalf("发行翻译行应落库：%+v", release.Translations)
	}
	mediums := mustList(t, f, ListOptions{Kind: "medium", ReleaseID: out.ReleaseID})
	if len(mediums) != 1 {
		t.Fatalf("应建出 1 个载体，实际 %d", len(mediums))
	}
	medium := mediums[0]
	if medium.OriginalLanguage != "ja" {
		t.Fatalf("载体原语言应落库：%q", medium.OriginalLanguage)
	}
	if medium.Translations["ja"].Title != "ディスク1" || medium.Translations["zh-CN"].Title != "第一碟" {
		t.Fatalf("载体翻译行应落库：%+v", medium.Translations)
	}

	// 幂等重试：同一发行内容签名 → 复用同一个发行/载体，载荷新增语种行补齐、已有行不被覆盖。
	req.Release.Translations = []ImporterTranslationItem{
		{Locale: "ja", Title: "初回版(改)"},
		{Locale: "en-US", Title: "First press"},
	}
	req.Mediums[0].Translations = map[string]any{
		"ja":    map[string]any{"title": "ディスク1(改)"},
		"en-US": map[string]any{"title": "Disc 1"},
	}
	retry, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatalf("同一载荷重试必须成功：%v", err)
	}
	if retry.ReleaseID != out.ReleaseID {
		t.Fatalf("同一载荷重试应复用同一发行：%s -> %s", out.ReleaseID, retry.ReleaseID)
	}
	release2, err := f.s.Get(ctx, retry.ReleaseID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if got := release2.Translations["ja"].Title; got != "初回版" {
		t.Fatalf("已有翻译行不该被覆盖：%q", got)
	}
	if got := release2.Translations["en-US"].Title; got != "First press" {
		t.Fatalf("新增翻译行应补齐：%+v", release2.Translations)
	}
	mediums2 := mustList(t, f, ListOptions{Kind: "medium", ReleaseID: retry.ReleaseID})
	if len(mediums2) != 1 {
		t.Fatalf("重试应复用既有载体，实际 %d 个", len(mediums2))
	}
	if got := mediums2[0].Translations["ja"].Title; got != "ディスク1" {
		t.Fatalf("载体已有翻译行不该被覆盖：%q", got)
	}
	if got := mediums2[0].Translations["en-US"].Title; got != "Disc 1" {
		t.Fatalf("载体新增翻译行应补齐：%+v", mediums2[0].Translations)
	}
}

// 兑现意味着这些字段必须预检：非法 locale / 空标题翻译行若放过，就会在 medium/release
// 落库时才被 Save 拒绝，留下半成品。错误码与定位沿用既有那批（invalid_locale / invalid_translation）。
func TestImporterPreflightRejectsMediumReleaseLanguageValues(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*ImporterImportRequest)
		want   []string
	}{
		{"载体原语言非法", func(r *ImporterImportRequest) { r.Mediums[0].OriginalLanguage = "jp" },
			[]string{"invalid_locale", "mediums[0].original_language", "\"jp\""}},
		{"载体翻译行缺题名", func(r *ImporterImportRequest) {
			r.Mediums[0].Translations = []ImporterTranslationItem{{Locale: "zh-CN", Title: " "}}
		}, []string{"invalid_translation", "mediums[0].translations[zh-CN]", "title="}},
		{"发行原语言非法", func(r *ImporterImportRequest) { r.Release.OriginalLanguage = "jp" },
			[]string{"invalid_locale", "release.original_language", "\"jp\""}},
		{"发行翻译行缺题名", func(r *ImporterImportRequest) {
			r.Release.Translations = map[string]any{"zh-CN": map[string]any{"title": ""}}
		}, []string{"invalid_translation", "release.translations[zh-CN]"}},
	}
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
