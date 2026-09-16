package catalog

import (
	"context"
	"fmt"
	"testing"
)

// 上一批（6b5f307）在报告 §8 记下的残留：has_release 未声明、载荷带非空 release、mediums 为空时，
// importNewWork 走"无发行链"分支（篇目至多走 importExpressionsOnly），release 对象没有任何读取点
// → 发行被静默丢弃。
//
// 语义判定（本文件钉住的口径）：这是**调用方漏声明**，不是"合法无载体发行草稿"。依据三条：
//  1. 写路径里 mediums 才是发行链的写指令：importNewWork 以 mediums 为空作为分支条件，
//     与 release 对象本身无关；
//  2. 同一份载荷把声明位补成 has_release=true 时，既有预检已经明确拒绝
//     （invalid_payload: has_release=true requires mediums，见 importerApplyFieldSwitches）——
//     而 has_release 在 JSON 里缺省与 false 不可区分、预览响应也从不产出它，调用方实际会漏的
//     正是这个声明；两条规则必须同向，否则"多写一个 true 报错、不写反而静默丢发行"；
//  3. 无载体发行在模型里合法，但不是没有出口：link_mode=append_release_to_work 显式挂靠已有
//     work 只建发行链，它不依赖 mediums（TestImporterAppendModeHonoursCarrierlessRelease 回读证实）。
//
// 因此按项目既定口径在**零写入预检**里拒绝（invalid_payload: release requires mediums，
// 与 has_release=true 那条同一错误族），不放宽 Save 校验、也不静默丢弃。
func importerReleaseOnlyPayload() ImporterImportRequest {
	return ImporterImportRequest{
		EntityType: "work", Source: "bangumi", URLOrID: "https://bgm.tv/subject/7",
		Work: &ImporterWorkPreview{
			Title: "无载体发行作品", OriginalLanguage: "ja",
			CatalogMetadata: map[string]any{"bangumi_type": float64(2)},
		},
		Release:    &ImporterReleasePreview{EditionName: "初回版", CatalogNumber: "ABC-001"},
		EditNote:   "无载体发行探针",
		SourceURLs: []string{"https://bgm.tv/subject/7"},
	}
}

// firstWorkToWorkRelation 从已发布定义里取一个 work→work 关系码：关系码可被后台改名/停用，
// 用例不写死（写死会让无关的类型调整把这条用例打红）。
func firstWorkToWorkRelation(t *testing.T, f fixture) string {
	t.Helper()
	defs, err := f.s.Definitions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range sortedKeys(defs.Document.Relations) {
		rel := defs.Document.Relations[code]
		if rel.Enabled && contains(rel.SourceKinds, "work") && contains(rel.TargetKinds, "work") {
			return code
		}
	}
	t.Fatal("已发布定义里没有可用的 work→work 关系码")
	return ""
}

// release 带了数据（版名/品番）却没有 mediums：new_work 与 create_relation 都走 importNewWork，
// 发行链不会被调用 → 必须零写入失败，而不是"作品建好、发行悄悄消失"。
func TestImporterRejectsReleaseWithoutMediums(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	baseline := countEntities(t, f, "")
	if baseline != 0 {
		t.Fatalf("夹具应为空库，实际 %d 条实体", baseline)
	}
	cases := []struct {
		name   string
		mutate func(*ImporterImportRequest)
	}{
		{"只有作品与发行，无篇目", func(r *ImporterImportRequest) {}},
		{"有篇目（走无发行链的 expression 分支）", func(r *ImporterImportRequest) {
			r.CanonicalEntries = []ImporterCanonicalEntryPreview{{Title: "第一话", Position: 1}}
		}},
		{"显式空 mediums 数组", func(r *ImporterImportRequest) {
			r.Mediums = []ImporterMediumPreview{}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := importerReleaseOnlyPayload()
			tc.mutate(&req)
			_, err := f.s.Import(ctx, req, f.u)
			assertImportError(t, err, []string{"invalid_payload", "release requires mediums"})
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

// create_relation 模式的写路径同样是 importNewWork（发行链依旧以 mediums 为写指令）：
// 同一份载荷在这条模式也必须零写入失败——作品、发行、关系边一个都不该多出来。
func TestImporterCreateRelationRejectsReleaseWithoutMediums(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	target := f.save(Entity{Kind: "work", Title: "关系目标作品"})
	before := countEntities(t, f, "")
	req := importerReleaseOnlyPayload()
	req.LinkMode = "create_relation"
	req.TargetWorkID = target.ID
	req.RelationType = firstWorkToWorkRelation(t, f)
	_, err := f.s.Import(ctx, req, f.u)
	assertImportError(t, err, []string{"invalid_payload", "release requires mediums"})
	if after := countEntities(t, f, ""); after != before {
		t.Fatalf("预检失败必须零写入：实体总数 %d -> %d", before, after)
	}
	if n := countEntities(t, f, "release"); n != 0 {
		t.Fatalf("不该建发行：%d", n)
	}
	rels, rerr := f.s.Relations(ctx, target.ID, &f.u)
	if rerr != nil {
		t.Fatal(rerr)
	}
	if len(rels) != 0 {
		t.Fatalf("不该建关系边：%+v", rels)
	}
}

// 空壳与"没传"同义（前一批确立的口径）：release=null / {} / 全空串字段都不算声明，不被新规则误伤。
// 前端 OmniImportModal 在 has_release===false 时正是发 release:null + mediums:[]，预览响应也从不
// 产出 release/mediums，把空壳当声明会把正常的预览→导入往返自己拒掉。
func TestImporterReleaseEmptyShellMeansAbsent(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	cases := []struct {
		name   string
		mutate func(*ImporterImportRequest)
	}{
		{"release=null + mediums 缺省", func(r *ImporterImportRequest) {
			r.Release = nil
			r.Mediums = nil
		}},
		{"release={} + mediums=[]", func(r *ImporterImportRequest) {
			r.Release = &ImporterReleasePreview{}
			r.Mediums = []ImporterMediumPreview{}
		}},
		{"release 全是空串字段", func(r *ImporterImportRequest) {
			r.Release = &ImporterReleasePreview{EditionName: "", CatalogNumber: "", Barcode: "", Country: "", Packaging: ""}
			r.Mediums = []ImporterMediumPreview{}
		}},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := importerReleaseOnlyPayload()
			req.URLOrID = fmt.Sprintf("https://bgm.tv/subject/%d", 100+i)
			tc.mutate(&req)
			out, err := f.s.Import(ctx, req, f.u)
			if err != nil {
				t.Fatalf("空壳与没传同义，不该拒绝：%v", err)
			}
			if out.WorkID == "" {
				t.Fatalf("作品应照常落库：%+v", out)
			}
			if out.ReleaseID != "" {
				t.Fatalf("空壳 release 不该建发行链：%s", out.ReleaseID)
			}
			if n := len(mustList(t, f, ListOptions{Kind: "release"})); n != 0 {
				t.Fatalf("库里不该有发行：%d", n)
			}
		})
	}
}

// 兑现路径：无载体发行在 new_work 模式没有落点，但 append_release_to_work 会真的把它写进去
// （该模式不依赖 mediums）。这既是"要表达无载体发行"的既有出口，也是上一条判为"调用方漏声明"
// 而不是"合法草稿"的依据之一——拒绝 new_work 的歧义载荷不丢能力。
func TestImporterAppendModeHonoursCarrierlessRelease(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	target := f.save(Entity{Kind: "work", Title: "挂靠目标作品"})

	req := importerReleaseOnlyPayload()
	req.LinkMode = "append_release_to_work"
	req.TargetWorkID = target.ID
	req.Work = nil // 该模式不要求作品载荷，标题回退目标作品
	out, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatalf("append 模式必须兑现无载体发行：%v", err)
	}
	if out.ReleaseID == "" {
		t.Fatalf("append 模式应建出发行链：%+v", out)
	}
	release, gerr := f.s.Get(ctx, out.ReleaseID, &f.u)
	if gerr != nil {
		t.Fatal(gerr)
	}
	if release.Title != "初回版" {
		t.Fatalf("发行应回读到载荷的版名：%q", release.Title)
	}
	if got := release.Attributes["catalog_number"]; got != "ABC-001" {
		t.Fatalf("发行品番应回读到载荷声明值：%+v", release.Attributes)
	}
	if n := len(mustList(t, f, ListOptions{Kind: "medium", ReleaseID: release.ID})); n != 0 {
		t.Fatalf("无载体发行不该凭空造载体：%d", n)
	}
	declared := false
	for _, s := range release.Subjects {
		if s.WorkID == target.ID {
			declared = true
		}
	}
	if !declared {
		t.Fatalf("发行必须声明挂靠的作品：%+v", release.Subjects)
	}
}

// 既有行为（本批只核对、未改）：has_release=true 而 mediums 为空在**所有**模式都报
// invalid_payload: has_release=true requires mediums（判据在 importerApplyFieldSwitches，不看模式）。
// 它"明确报错"而非静默丢弃，符合"声明了就必须被兑现"；用例钉住它不被降级成静默忽略。
func TestImporterHasReleaseClaimWithoutMediumsStaysRejected(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	before := countEntities(t, f, "")
	modes := []struct {
		name   string
		mutate func(*ImporterImportRequest)
	}{
		{"new_work", func(r *ImporterImportRequest) {}},
		{"append_release_to_work", func(r *ImporterImportRequest) {
			r.LinkMode = "append_release_to_work"
			r.TargetWorkID = "00000000-0000-0000-0000-000000000000"
		}},
	}
	for _, m := range modes {
		t.Run(m.name, func(t *testing.T) {
			req := importerReleaseOnlyPayload()
			req.HasRelease = true
			m.mutate(&req)
			_, err := f.s.Import(ctx, req, f.u)
			assertImportError(t, err, []string{"invalid_payload", "has_release=true requires mediums"})
			if after := countEntities(t, f, ""); after != before {
				t.Fatalf("预检失败必须零写入：实体总数 %d -> %d", before, after)
			}
		})
	}
}

// 合法载荷（has_release=true + 有 mediums + 带数据的 release）不受本次收口影响：发行与载体都要
// 回读到载荷声明值（版名/品番、载体题名与 format 词表项），曲目仍挂在载体下。
func TestImporterReleaseWithMediumsStillImports(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	req := importerValuePayload()
	req.HasRelease = true
	out, err := f.s.Import(ctx, req, f.u)
	if err != nil {
		t.Fatalf("合法载荷（has_release=true + 有 mediums）必须成功：%v", err)
	}
	if out.ReleaseID == "" {
		t.Fatalf("合法载荷应建发行链：%+v", out)
	}
	release, gerr := f.s.Get(ctx, out.ReleaseID, &f.u)
	if gerr != nil {
		t.Fatal(gerr)
	}
	if release.Title != "初回版" {
		t.Fatalf("发行应回读到载荷的版名：%q", release.Title)
	}
	if got := release.Attributes["catalog_number"]; got != "ABC-001" {
		t.Fatalf("发行品番应回读到载荷声明值：%+v", release.Attributes)
	}
	mediums := mustList(t, f, ListOptions{Kind: "medium", ReleaseID: release.ID})
	if len(mediums) != 1 {
		t.Fatalf("应回读到 1 个载体，实际 %d", len(mediums))
	}
	if mediums[0].Title != "Disc 1" || mediums[0].Attributes["format"] != importerMediumFormats["cd"] {
		t.Fatalf("载体题名/format 应回读到载荷声明值：%+v", mediums[0])
	}
	tracks := mustList(t, f, ListOptions{Kind: "track", MediumID: mediums[0].ID})
	if len(tracks) != 1 || tracks[0].Title != "第一话" {
		t.Fatalf("曲目应挂在载体下：%+v", tracks)
	}
}
