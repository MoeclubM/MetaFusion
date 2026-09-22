package catalog

import (
	"context"
	"encoding/json"
	"testing"
)

// 版本读闭环：修订行绑定的 definition_version 必须能按版本读回当时的定义文档，
// 而不是只能看到当前标签。证据链：写时绑定（见 TestPostgresRevisionBindsDefinitionVersion）+
// 本用例的按版本读回（旧修订的 definition_version 读出 v1 文档，与当前已发布文档不同）。
func TestPostgresRevisionHistoryResolvesContemporaryDefinition(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	v1, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	w := f.save(Entity{Kind: "work", Title: "闭环验证作品"})
	// 发布新定义版本：新增一个字段并挂到 song 类型上。
	var d Definitions
	if err := json.Unmarshal([]byte(encode(v1.Document)), &d); err != nil {
		t.Fatal(err)
	}
	d.Fields["closed_loop_probe"] = Field{Names: names("探测", "Probe"), Type: "text", Enabled: true}
	song := d.Types["song"]
	song.Fields = append(append([]string{}, song.Fields...), "closed_loop_probe")
	d.Types["song"] = song
	f.publish(d, v1.ID)
	v2, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if v2.ID == v1.ID {
		t.Fatal("发布后已发布定义版本应推进")
	}
	revs, err := f.s.Revisions(ctx, w.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	if len(revs) == 0 {
		t.Fatal("新建应留下一条修订")
	}
	defVer, ok := revs[0]["definition_version"].(int64)
	if !ok || defVer != v1.ID {
		t.Fatalf("修订应绑定写时的定义版本 %d，实际 %v", v1.ID, revs[0]["definition_version"])
	}
	// 按修订绑定的版本读回当时文档：应与 v1 一致（含无探测字段），与当前标签不同。
	contemporary, err := f.s.DefinitionDetail(ctx, defVer)
	if err != nil {
		t.Fatalf("修订绑定的定义版本应可读回：%v", err)
	}
	if _, exists := contemporary.Document.Fields["closed_loop_probe"]; exists {
		t.Fatal("按旧 definition_version 读回的不应含新字段")
	}
	if encode(contemporary.Document) != encode(v1.Document) {
		t.Fatal("按旧 definition_version 读回的文档应与写时一致")
	}
	if _, exists := v2.Document.Fields["closed_loop_probe"]; !exists {
		t.Fatal("测试前提漂移：当前已发布定义应含新字段")
	}
}
