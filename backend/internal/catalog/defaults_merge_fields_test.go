package catalog

import (
	"context"
	"testing"
)

// 合并必须把种子新增的字段**同时**补进"字段表"和"已存在类型的字段集"：
// 只补字段表时，写实体仍会因 unknown_field 拒绝该字段（属性键取自类型声明的字段集），
// 即"字段补了却用不上"。content_unit 的 air_date（篇目放送日）是本用例的实例。
func TestMergeSeedDefinitionsAddsFieldsToExistingTypes(t *testing.T) {
	seed := Defaults()
	cur := Defaults()
	// 现状：旧文档里 content_unit 只声明 language/entry_role，字段表也没有 air_date。
	delete(cur.Fields, "air_date")
	cu := cur.Types["content_unit"]
	cu.Fields = []string{"language", "entry_role"}
	cur.Types["content_unit"] = cu
	// 人工调整：动画类型上多加一个自定义字段码，合并只增不改，不能覆盖或删除它。
	anime := cur.Types["animation"]
	anime.Fields = append(append([]string{}, anime.Fields...), "custom_local_field")
	cur.Types["animation"] = anime

	merged, added := mergeSeedDefinitions(cur, seed)
	if _, ok := merged.Fields["air_date"]; !ok {
		t.Fatal("字段表未补入 air_date")
	}
	if !contains(merged.Types["content_unit"].Fields, "air_date") {
		t.Fatalf("content_unit 字段集未补入 air_date：%v", merged.Types["content_unit"].Fields)
	}
	if !contains(merged.Types["animation"].Fields, "custom_local_field") {
		t.Fatalf("人工新增的字段码被覆盖：%v", merged.Types["animation"].Fields)
	}
	found := false
	for _, a := range added {
		if a == "types.content_unit.fields.air_date" {
			found = true
		}
	}
	if !found {
		t.Fatalf("类型字段集的补丁未记入新增项（审计说明会漏）：%v", added)
	}
	// 幂等：把合并结果再合并一次，不应再有任何新增。
	if _, again := mergeSeedDefinitions(merged, seed); len(again) != 0 {
		t.Fatalf("第二次合并不应有新增，实际 %v", again)
	}
}

// 真库：存量实例（已发布定义里没有 air_date）经 EnsureSeedDefinitions 后，
// 新字段出现在存量文档里并能真正写进篇目；重复合并不产生第二个定义版本。
func TestPostgresSeedMergeBackfillsAirDateIntoExistingDocument(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	definitionsCount := func() int {
		t.Helper()
		var n int
		if err := f.s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog.definition_config").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// 存量文档：把当前已发布定义退回"没有 air_date"的样子（字段表 + content_unit 字段集），再发布一版。
	v, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	old := v.Document
	delete(old.Fields, "air_date")
	cu := old.Types["content_unit"]
	cu.Fields = []string{"language", "entry_role"}
	old.Types["content_unit"] = cu
	f.publish(old, v.ETag)

	work := f.save(Entity{Kind: "work", Title: "动画作品", Types: []string{"animation"}})
	newUnit := func() Entity {
		return Entity{Kind: "content_unit", WorkID: work.ID, Title: "第1话", Number: "1", Position: 1,
			Status: "published", Types: []string{"content_unit"},
			Translations: map[string]Translation{"ja": {Title: "第1话"}},
			Attributes:   map[string]any{"language": "ja", "entry_role": "main", "air_date": "2017-01-21"}}
	}
	// 反证：合并之前写 air_date 必须被校验拒绝，否则本用例证明不了合并的作用。
	if _, err := f.s.Save(ctx, Edit{Entity: newUnit(), EditNote: "写未声明字段", Sources: fixtureSources()}, f.u); err == nil {
		t.Fatal("存量文档未声明 air_date 时，写入篇目属性本应被 unknown_field 拒绝")
	}

	if err := f.s.EnsureSeedDefinitions(ctx); err != nil {
		t.Fatal(err)
	}
	v2, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if v2.ETag == v.ETag {
		t.Fatal("合并后应产生新的定义版本")
	}
	if _, ok := v2.Document.Fields["air_date"]; !ok {
		t.Fatal("合并后存量文档的字段表里没有 air_date")
	}
	if !contains(v2.Document.Types["content_unit"].Fields, "air_date") {
		t.Fatalf("合并后 content_unit 字段集里没有 air_date：%v", v2.Document.Types["content_unit"].Fields)
	}

	// 合并之后同一份载荷必须真的能落库并读回。
	saved, err := f.s.Save(ctx, Edit{Entity: newUnit(), EditNote: "回填放送日", Sources: fixtureSources()}, f.u)
	if err != nil {
		t.Fatalf("合并后写入带 air_date 的篇目失败：%v", err)
	}
	got, err := f.s.Get(ctx, saved.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if got.Attributes["air_date"] != "2017-01-21" {
		t.Fatalf("air_date 未落库：%v", got.Attributes)
	}

	// 幂等：再合并一次既没有新增项，也不产生第二个定义版本。
	before := definitionsCount()
	if err := f.s.EnsureSeedDefinitions(ctx); err != nil {
		t.Fatal(err)
	}
	v3, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if v3.ETag != v2.ETag {
		t.Fatalf("重复合并换了 etag：%s -> %s", v2.ETag, v3.ETag)
	}
	if after := definitionsCount(); after != before {
		t.Fatalf("重复合并新增了定义行：%d -> %d", before, after)
	}
}
