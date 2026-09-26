package catalog

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// 体检（Store.DanglingReferences，命令入口 mf-migrate check-refs）必须一次列全库里指向
// 不存在行的引用：entity 型属性取值与关系端点都要覆盖，并且不能把正常引用误报成悬挂。
// 取态与 impact 一致：悬挂引用是**数据欠账**（警告 / 体检失败），不是定义非法（阻断发布）。
func TestPostgresDanglingReferencesReport(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := f.s.DB.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}

	// 反例：正常引用现有实体，体检必须 0 条（否则报告没有可用性）。
	agent := f.save(Entity{Kind: "agent", Title: "发行主体", Types: []string{"organization"}})
	f.save(Entity{Kind: "release", Title: "正常发行版", Types: []string{"release"}, Attributes: map[string]any{"publisher": agent.ID}})
	report, err := f.s.DanglingReferences(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Items) != 0 {
		t.Fatalf("干净库被报出悬挂引用：%+v", report.Items)
	}
	if report.DefinitionETag == "" {
		t.Fatal("体检报告必须带上判定基准的定义版本 id")
	}

	// 正例 1（事故形态）：attributes.publisher 指向的行已经被删除。
	gone := f.save(Entity{Kind: "agent", Title: "将被删除的发行主体", Types: []string{"organization"}})
	damaged := f.save(Entity{Kind: "release", Title: "悬挂引用发行版", Types: []string{"release"}, Attributes: map[string]any{"publisher": gone.ID}})
	// 删行走 SQL：写路径今天会拒绝一个指向不存在行的取值，所以这种数据只可能是存量欠账。
	exec("DELETE FROM catalog.entities WHERE id=$1", gone.ID)

	// 正例 2：取值根本不是 uuid，指向不了任何行。
	garbage := f.save(Entity{Kind: "release", Title: "垃圾取值发行版", Types: []string{"release"}, Attributes: map[string]any{"publisher": agent.ID}})
	exec("UPDATE catalog.entities SET document = jsonb_set(document, '{attributes,publisher}', to_jsonb('not-a-uuid'::text)) WHERE id=$1", garbage.ID)

	// 正例 3：关系的目标端点行不存在。两端有外键，正常路径下插不出这种行，
	// 因此这里显式去掉约束来证明体检**确实覆盖关系端点**（外键被绕过、或早期数据就是这样）。
	exec("ALTER TABLE catalog.relations DROP CONSTRAINT relations_target_id_fkey")
	src := f.save(Entity{Kind: "work", Title: "关系源作品", Types: []string{"animation"}})
	missing := uuid.NewString()
	relID := uuid.NewString()
	rel := Relation{ID: relID, Version: 1, Type: "member_of", SourceID: src.ID, TargetID: missing, Attributes: map[string]any{}}
	exec("INSERT INTO catalog.relations(id,version,type,source_id,target_id,document) VALUES($1,$2,$3,$4,$5,$6)", rel.ID, rel.Version, rel.Type, rel.SourceID, rel.TargetID, encode(rel))

	report, err = f.s.DanglingReferences(ctx)
	if err != nil {
		t.Fatal(err)
	}
	find := func(scope, id, field string) *DanglingReference {
		t.Helper()
		for i := range report.Items {
			x := report.Items[i]
			if x.Scope == scope && x.ID == id && x.Field == field {
				return &report.Items[i]
			}
		}
		return nil
	}
	if x := find("entity", damaged.ID, "publisher"); x == nil {
		t.Fatalf("未列出被删除目标行的属性引用：%+v", report.Items)
	} else if x.Reason != reasonMissing || x.Value != gone.ID || x.Kind != kindAttribute {
		t.Fatalf("悬挂属性引用定位不完整：%+v", *x)
	}
	if x := find("entity", garbage.ID, "publisher"); x == nil {
		t.Fatalf("未列出非 uuid 取值：%+v", report.Items)
	} else if x.Reason != reasonInvalidID || x.Value != "not-a-uuid" {
		t.Fatalf("垃圾取值应报 invalid_id：%+v", *x)
	}
	if x := find("relation", relID, "target_id"); x == nil {
		t.Fatalf("未列出悬挂的关系端点：%+v", report.Items)
	} else if x.Reason != reasonMissing || x.Value != missing || x.Kind != kindRelationEndpoint || x.RelationType != "member_of" {
		t.Fatalf("悬挂关系端点定位不完整：%+v", *x)
	}
	// 正常引用不得进报告：报告要能直接照着改数据，混入噪音等于不可用。
	if x := find("entity", agent.ID, "publisher"); x != nil {
		t.Fatalf("正常引用被误报：%+v", *x)
	}

	// 体检命令用 -json 输出这份报告：键名是机器读取契约，锁住它。
	b, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err = json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"definition_id", "seed_added", "references"} {
		if _, ok := raw[k]; !ok {
			t.Fatalf("体检报告缺 %s 键：%s", k, string(b))
		}
	}
	if !strings.Contains(string(b), "\"reason\"") || !strings.Contains(string(b), "\"field\"") {
		t.Fatalf("每条悬挂引用必须带 reason 与 field：%s", string(b))
	}
}

// impact 的口径：同一批悬挂数据只进 Dangling（警告），绝不进 Issues（阻断）——这正是
// 2026-09 事故的判据错误（把数据欠账当成定义非法，于是发布失败 + 启动 CrashLoop）。
func TestPostgresImpactWarnsInsteadOfBlockingOnDanglingReferences(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	gone := f.save(Entity{Kind: "agent", Title: "将被删除的发行主体", Types: []string{"organization"}})
	f.save(Entity{Kind: "release", Title: "悬挂引用发行版", Types: []string{"release"}, Attributes: map[string]any{"publisher": gone.ID}})
	if _, err := f.s.DB.ExecContext(ctx, "DELETE FROM catalog.entities WHERE id=$1", gone.ID); err != nil {
		t.Fatal(err)
	}

	v, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	probe, err := f.s.DefinitionImpactFor(ctx, v.Document, f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(probe.Issues) != 0 {
		t.Fatalf("悬挂引用被当成阻断项：%v", probe.Issues)
	}
	if len(probe.Dangling) == 0 {
		t.Fatal("悬挂引用没有进警告报告（不许静默吞掉）")
	}

	// 定义非法仍然必须阻断，而且要与悬挂引用**分开列**：给实体塞一个没有任何类型声明的
	// 属性键（存量脏数据的另一种形态），Issues 必须非空——它不可能靠修数据之外的方式绕过。
	if _, err = f.s.DB.ExecContext(ctx, "UPDATE catalog.entities SET document = jsonb_set(document, '{attributes,publisher}', to_jsonb('not-a-uuid'::text)) WHERE document->'attributes'->>'publisher' = $1", gone.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.s.DB.ExecContext(ctx, "UPDATE catalog.entities SET document = jsonb_set(document, '{attributes,legacy_orphan_key}', to_jsonb('x'::text)) WHERE document->'attributes'->>'publisher' = 'not-a-uuid'"); err != nil {
		t.Fatal(err)
	}
	probe, err = f.s.DefinitionImpactFor(ctx, v.Document, f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(probe.Issues) == 0 {
		t.Fatalf("未声明的属性键是定义冲突，必须进阻断项：%+v", probe)
	}
	if !strings.Contains(strings.Join(probe.Issues, " "), "unknown_field") {
		t.Fatalf("阻断项应指出 unknown_field：%v", probe.Issues)
	}
	if len(probe.Dangling) == 0 {
		t.Fatal("阻断项与警告项要同时给出，便于一次看清数据与定义各自欠什么")
	}

	// 阻断的最终口径在 Publish 上：拿一份**自身合法**的定义去发布，只要与存量数据冲突就发不出去。
	d := v.Document
	d.Types["dangling_test_type"] = TypeDefinition{Names: names("悬挂测试类型", "Dangling test type"), Kinds: []string{"work"}, Template: "generic", Enabled: true}
	if _, err := f.s.SaveDefinitions(ctx, d, v.ETag, f.u, "publish with conflicting data", fixtureSources()); err == nil {
		t.Fatal("与存量数据冲突的定义被发布了")
	} else if !strings.Contains(err.Error(), "definition_impact") {
		t.Fatalf("阻断错误码应为 definition_impact：%v", err)
	}
}
