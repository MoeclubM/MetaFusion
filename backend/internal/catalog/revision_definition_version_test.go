package catalog

import (
	"context"
	"testing"
)

// D4：每次写入的修订行绑定当时的已发布定义版本；定义发布后新修订跟新引用，
// 旧修订保持原引用（追溯不改写历史）。无 MF_V2_TEST_DSN 时跳过。
func TestPostgresRevisionBindsDefinitionVersion(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	v1, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	w := f.save(Entity{Kind: "work", Title: "版本绑定作品"})
	revs, err := f.s.Revisions(ctx, w.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(revs) == 0 {
		t.Fatal("新建应留下一条修订")
	}
	if got, ok := revs[0]["definition_version"].(int64); !ok || got != v1.ID {
		t.Fatalf("修订应绑定当前已发布定义 %d，实际 %v", v1.ID, revs[0]["definition_version"])
	}
	// 发布一个新定义版本后再写：新修订跟新引用，旧修订保持原引用。
	d := v1.Document
	d.Fields["d4_probe"] = Field{Names: names("探测", "Probe"), Type: "text", Enabled: true}
	song := d.Types["song"]
	song.Fields = append(append([]string{}, song.Fields...), "d4_probe")
	d.Types["song"] = song
	f.publish(d, v1.ID)
	v2, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if v2.ID == v1.ID {
		t.Fatal("发布后已发布定义版本应推进")
	}
	w.Title = "版本绑定作品改名"
	if _, err := f.s.Save(ctx, Edit{Entity: w, ExpectedVersion: w.Version, EditNote: "d4", Sources: fixtureSources()}, f.u); err != nil {
		t.Fatal(err)
	}
	revs, err = f.s.Revisions(ctx, w.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(revs) != 2 {
		t.Fatalf("应有两条修订，实际 %d", len(revs))
	}
	if got, ok := revs[0]["definition_version"].(int64); !ok || got != v2.ID {
		t.Fatalf("新修订应绑定新定义 %d，实际 %v", v2.ID, revs[0]["definition_version"])
	}
	if got, ok := revs[1]["definition_version"].(int64); !ok || got != v1.ID {
		t.Fatalf("旧修订应保持原定义引用 %d，实际 %v", v1.ID, revs[1]["definition_version"])
	}
}
