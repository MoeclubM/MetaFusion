package catalog

// DLsite 端到端落库回归：用 httptest 提供商品页 HTML，经 previewDLsite 预览后
// 模拟前端把预览转成 Import 请求并真正写入隔离 PostgreSQL，验证：
//   - work 落 dlsite 外部 ID 与 dlsite:work:RJ… 幂等键；
//   - 社团落 dlsite_maker(RG) 外部 ID 与 dlsite:circle:RG… 幂等键；
//   - release / medium 落库；
//   - 同一来源重复导入幂等（返回同一 WorkID，不新增实体）。

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// staffFromPreview 模拟前端 OmniImportModal 把预览 artists 转成 staff_associations。
func staffFromPreview(artists []ImporterArtistPreview) []ImporterStaffAssociation {
	out := make([]ImporterStaffAssociation, 0, len(artists))
	for _, a := range artists {
		out = append(out, ImporterStaffAssociation{
			ParsedName:     a.Name,
			ParsedOriginal: a.OriginalName,
			ParsedRole:     a.Role,
			EntityType:     a.EntityType,
			Action:         "create",
			Language:       a.Language,
			AvatarURL:      a.AvatarURL,
			ExternalIDs:    a.ExternalIDs,
			RelationType:   a.RelationType,
		})
	}
	return out
}

func TestDLsiteEndToEndImport(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(dlsiteHTMLFixture))
	}))
	defer srv.Close()
	old := dlsiteWWWBase
	dlsiteWWWBase = srv.URL
	defer func() { dlsiteWWWBase = old }()

	f := newFixture(t)
	ref := dlsiteRef{Site: "maniax", ProductID: "RJ01234567"}
	preview, err := previewDLsite(context.Background(), ref)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	req := ImporterImportRequest{
		EntityType:        "work",
		Source:            "dlsite",
		URLOrID:           preview.ExternalURL,
		Work:              preview.Work,
		Release:           preview.Release,
		Mediums:           preview.Mediums,
		StaffAssociations: staffFromPreview(preview.Artists),
		EditNote:          "dlsite e2e",
		SourceURLs:        []string{preview.ExternalURL},
	}

	// 第一次导入：work + 社团 + 分职个人 + release + medium 全部落库。
	first, err := f.s.Import(context.Background(), req, f.u)
	if err != nil {
		t.Fatalf("first import: %v", err)
	}
	if first.WorkID == "" {
		t.Fatalf("missing WorkID: %+v", first)
	}
	if n := countEntities(t, f, "work"); n != 1 {
		t.Errorf("work count=%d, want 1", n)
	}
	// 社团 1 个 organization；4 个分职署名都是同名"如月十二"，落库合并为 1 个 person。
	if n := countEntities(t, f, "agent"); n != 2 {
		t.Errorf("agent count=%d, want 2 (1 circle + 1 merged person)", n)
	}
	if n := countEntities(t, f, "release"); n != 1 {
		t.Errorf("release count=%d, want 1", n)
	}
	if n := countEntities(t, f, "medium"); n != 1 {
		t.Errorf("medium count=%d, want 1", n)
	}

	// 外部 ID 与导入幂等键都落在 entities.document->'external_ids'。
	check := func(label, sql string) {
		var n int
		if err := f.s.DB.QueryRowContext(context.Background(), sql).Scan(&n); err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		if n != 1 {
			t.Errorf("%s count=%d, want 1", label, n)
		}
	}
	check("dlsite work external id",
		`SELECT count(*) FROM catalog.entities WHERE kind='work' AND document->'external_ids'->>'dlsite'='RJ01234567'`)
	check("work import key",
		`SELECT count(*) FROM catalog.entities WHERE kind='work' AND document->'external_ids'->>'metafusion_import'='dlsite:work:RJ01234567'`)
	check("dlsite_maker external id",
		`SELECT count(*) FROM catalog.entities WHERE kind='agent' AND document->'external_ids'->>'dlsite_maker'='RG12345'`)
	check("circle import key",
		`SELECT count(*) FROM catalog.entities WHERE kind='agent' AND document->'external_ids'->>'metafusion_import'='dlsite:circle:RG12345'`)

	// 第二次导入同一来源：必须幂等，返回同一 WorkID，不新增实体。
	second, err := f.s.Import(context.Background(), req, f.u)
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	if second.WorkID != first.WorkID {
		t.Errorf("idempotent import changed WorkID: %s -> %s", first.WorkID, second.WorkID)
	}
	if n := countEntities(t, f, "work"); n != 1 {
		t.Errorf("after re-import work count=%d, want 1", n)
	}
	if n := countEntities(t, f, "agent"); n != 2 {
		t.Errorf("after re-import agent count=%d, want 2", n)
	}
	if second.RedirectURL == "" {
		t.Errorf("empty redirect on re-import")
	}
}
