package catalog

import (
	"context"
	"testing"
)

// agentImportPayload 是一份"只建 agent"的合法载荷；用例往上面挂 canonical_entries /
// mediums / release，验证这些在 agent 路径上没有落点的对象不会被收下。
func agentImportPayload() ImporterImportRequest {
	return ImporterImportRequest{
		EntityType: "artist", Source: "bangumi", URLOrID: "https://bgm.tv/person/9",
		Artist:   &ImporterArtistPreview{Name: "约翰", OriginalName: "John Doe", EntityType: "person", Language: "en-US"},
		EditNote: "非 work 载荷字段探针", SourceURLs: []string{"https://bgm.tv/person/9"},
	}
}

// importNewAgent 只建一个 agent，不做创作层级（Work→ContentUnit→Expression）也不做发行承载
// （Work→Release→Medium→Track）：agent 载荷里的 canonical_entries / mediums / release 没有落点。
// 收下就是丢数据（调用方以为结构写进去了），因此必须在零写入的预检里带对象标识 + 字段码报错。
func TestImporterPreflightRejectsFieldsUnsupportedForEntityType(t *testing.T) {
	cases := []struct {
		name       string
		entityType string
		mutate     func(*ImporterImportRequest)
		wantField  string
	}{
		{"artist+canonical_entries", "artist", func(r *ImporterImportRequest) {
			r.CanonicalEntries = []ImporterCanonicalEntryPreview{{Title: "第一话", EntryKind: "content_unit", Number: "1"}}
		}, "canonical_entries"},
		{"artist+mediums", "artist", func(r *ImporterImportRequest) {
			r.Mediums = []ImporterMediumPreview{{Position: 0, Name: "Disc 1", Format: "cd", Tracks: []ImporterTrackPreview{{Position: 1, Title: "第一话"}}}}
		}, "mediums"},
		{"artist+release", "artist", func(r *ImporterImportRequest) {
			r.Release = &ImporterReleasePreview{EditionName: "初回版"}
		}, "release"},
		{"character+mediums", "character", func(r *ImporterImportRequest) {
			r.Mediums = []ImporterMediumPreview{{Position: 0, Name: "Disc 1", Format: "cd"}}
		}, "mediums"},
		{"organization+release", "organization", func(r *ImporterImportRequest) {
			r.Release = &ImporterReleasePreview{EditionName: "Box"}
		}, "release"},
	}
	// 同一个夹具顺序执行：每次失败后实体总数都不能变化（预检失败 = 零写入）。
	f := newFixture(t)
	baseline := countEntities(t, f, "")
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := agentImportPayload()
			req.EntityType = tc.entityType
			tc.mutate(&req)
			_, err := f.s.Import(context.Background(), req, f.u)
			assertImportError(t, err, []string{
				"unsupported_field_for_entity_type", "entity_type=" + tc.entityType, "field=" + tc.wantField,
			})
			if after := countEntities(t, f, ""); after != baseline {
				t.Fatalf("预检失败必须零写入：实体总数 %d -> %d", baseline, after)
			}
			if agents := countEntities(t, f, "agent"); agents != 0 {
				t.Fatalf("agent 条数必须为 0，实际 %d", agents)
			}
		})
	}
	// 同一份载荷在 work 类型下照常成立：这三项在 work 路径上有落点（不是"一律禁用的字段"），
	// 顺带确认 work 分支没有被新校验误伤。
	if _, err := f.s.Import(context.Background(), importerValuePayload(), f.u); err != nil {
		t.Fatalf("work 载荷（含 canonical_entries/mediums/release）必须成功：%v", err)
	}
}

// 空壳不算声明：null / [] / {} 与"没传"同义（前端为作品导入无条件带 release/mediums 键，
// 手工载荷也可能带空对象），只有带内容的对象才拒——否则会把合法 agent 导入误伤成 400。
func TestImporterAcceptsEmptyPayloadShellsForAgent(t *testing.T) {
	f := newFixture(t)
	req := agentImportPayload()
	req.Mediums = []ImporterMediumPreview{}
	req.Release = &ImporterReleasePreview{}
	out, err := f.s.Import(context.Background(), req, f.u)
	if err != nil {
		t.Fatalf("空壳 mediums/release 不该拒绝 agent 导入：%v", err)
	}
	if out.ArtistID == "" || out.RedirectURL != "/artists/"+out.ArtistID {
		t.Fatalf("agent 应照常落库：%+v", out)
	}
}
