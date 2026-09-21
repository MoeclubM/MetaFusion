package catalog

import (
	"context"
	"strings"
	"testing"
)

// 署名槽位是闭集：拼错的槽位在 Validate 即拦截，不等发布后展示端静默丢署名。
func TestRelationParticipantSlotValidation(t *testing.T) {
	d := Defaults()
	bad := d.Relations["voiced_by"]
	bad.ParticipantSlot = "boss"
	d.Relations["voiced_by"] = bad
	if err := d.Validate(); err == nil || !strings.Contains(err.Error(), "invalid_participant_slot") {
		t.Fatalf("拼错的 participant_slot 应报 invalid_participant_slot，实际 %v", err)
	}
	for _, slot := range []string{"", "person", "character", "peer"} {
		ok := Defaults()
		rt := ok.Relations["voiced_by"]
		rt.ParticipantSlot = slot
		ok.Relations["voiced_by"] = rt
		if err := ok.Validate(); err != nil {
			t.Fatalf("合法槽位 %q 应放行：%v", slot, err)
		}
	}
}

// D1 贯通：新增自定义关系（录音工程师）从起草→发布→署名聚合全链路只靠
// participant_slot / counts_as_credit 两条声明，不增加任何专用关系码分支。
// 刻意把分组放在 membership（而非 credits）：若聚合仍命中，即证明口径来自声明而非分组。
func TestPostgresCustomCreditRelationEndToEnd(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	v, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	d := v.Document
	code := "sound_engineered_by"
	if _, exists := d.Relations[code]; exists {
		t.Fatalf("自定义关系码 %q 已被种子占用，换一个码再测", code)
	}
	d.Relations[code] = RelationDefinition{
		Names:          names("录音工程师", "Recording engineer"),
		ReverseNames:   names("担任录音工程师", "Engineered"),
		SourceKinds:    []string{"expression"},
		TargetKinds:    []string{"agent"},
		Fields:         []string{"credit_role"},
		ParticipantSlot: "person",
		CountsAsCredit:  true,
		Group:          "membership",
		Enabled:        true,
	}
	if err := d.Validate(); err != nil {
		t.Fatalf("自定义署名关系应通过定义校验：%v", err)
	}
	f.publish(d, v.ID)
	nv, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(creditRelationTypes(nv.Document), code) {
		t.Fatalf("发布后署名聚合应包含自定义关系 %q，实际 %v", code, creditRelationTypes(nv.Document))
	}
	work := f.save(Entity{Kind: "work", Title: "贯通专辑"})
	expr := Entity{Kind: "expression", Title: "贯通录音", WorkID: work.ID}
	expr = f.save(expr)
	engineer := f.save(Entity{Kind: "agent", Title: "贯通工程师"})
	if _, err := f.s.SaveRelation(ctx, RelationEdit{
		Relation: Relation{Type: code, SourceID: expr.ID, TargetID: engineer.ID, Attributes: map[string]any{"credit_role": "录音"}},
		EditNote: "d1 fixture", Sources: fixtureSources(),
	}, f.u); err != nil {
		t.Fatalf("自定义关系边应可写入：%v", err)
	}
	out, err := f.s.ExpressionDetailsBatch(ctx, []string{expr.ID}, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if got := out.Items[expr.ID].CreditTitle; got != "贯通工程师" {
		t.Fatalf("署名聚合应显示自定义关系对端，实际 %q", got)
	}
	// 停用后即退出聚合：同一声明口径的反向证明。
	nv2, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	disabled := nv2.Document
	rt := disabled.Relations[code]
	rt.Enabled = false
	disabled.Relations[code] = rt
	f.publish(disabled, nv2.ID)
	nv3, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if contains(creditRelationTypes(nv3.Document), code) {
		t.Fatalf("停用后署名聚合不应再包含 %q", code)
	}
}
