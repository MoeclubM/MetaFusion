package catalog

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestPictureFromRemote(t *testing.T) {
	// 正常远端封面：Kind=url、citation 非空、Source.URL 用条目页
	p, ok := pictureFromRemote("https://lain.bgm.tv/pic/cover/l/ab.jpg", "Bangumi 条目封面", "bangumi:subject:428735", true)
	if !ok {
		t.Fatal("valid remote picture rejected")
	}
	if p.URL != "https://lain.bgm.tv/pic/cover/l/ab.jpg" || p.Source.Kind != "url" ||
		p.Source.URL != "https://bgm.tv/subject/428735" || p.Source.Citation == "" {
		t.Errorf("picture = %+v", p)
	}
	if err := validateSources("picture", []Source{p.Source}); err != nil {
		t.Errorf("picture source must satisfy evidence rules: %v", err)
	}
	if cn, ok := pictureFromRemote("https://lain.bgm.tv/pic/c.jpg", "Bangumi 头像", "bangumi:character:200841", true); !ok ||
		cn.Source.URL != "https://bgm.tv/character/200841" {
		t.Errorf("character picture = %+v ok=%v", cn, ok)
	}
	// 空/非法 URL 不写图，不伪造占位
	if _, ok := pictureFromRemote("   ", "x", "", false); ok {
		t.Error("empty image url accepted")
	}
	if _, ok := pictureFromRemote("javascript:alert(1)", "x", "", false); ok {
		t.Error("unsafe image url accepted")
	}
}

func TestDefaultsCreditRelations(t *testing.T) {
	d := Defaults()
	if err := d.Validate(); err != nil {
		t.Fatalf("defaults invalid: %v", err)
	}
	for _, code := range []string{"composed_by", "lyricist_of", "arranged_by", "directed_by", "written_by", "illustrated_by", "narrated_by"} {
		r, ok := d.Relations[code]
		if !ok {
			t.Errorf("missing credit relation %s", code)
			continue
		}
		if r.Group != "credits" || len(r.TargetKinds) != 1 || r.TargetKinds[0] != "agent" || !r.Enabled {
			t.Errorf("%s: group=%q targets=%v enabled=%v", code, r.Group, r.TargetKinds, r.Enabled)
		}
		if len(r.SourceKinds) == 0 {
			t.Errorf("%s has no source kinds", code)
		}
	}
}

// TestStringScalarMapKeepsIntIDs 回归：预览 DTO 用 Go int 装 ID，
// stringScalarMap 若只认 float64 会静默丢弃外部 ID。
func TestStringScalarMapKeepsIntIDs(t *testing.T) {
	got := stringScalarMap(map[string]any{
		"bangumi_person":    45638,
		"bangumi_character": int64(200841),
		"bangumi":           float64(428735),
		"text":              "keep",
		"flag":              true,
	})
	want := map[string]string{
		"bangumi_person":    "45638",
		"bangumi_character": "200841",
		"bangumi":           "428735",
		"text":              "keep",
		"flag":              "true",
	}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s: got %q want %q", k, got[k], v)
		}
	}
}

// catalog_metadata 声明为 any：HTTP JSON 往返后是 float64，同进程直传保留 int。
// 两种形态都必须还原类型，否则类型丢失会让该类型允许的字段被判成未知字段。
func TestWorkTypeFromMetadataAcceptsIntAndFloat(t *testing.T) {
	cases := []struct {
		name string
		meta any
		want string
	}{
		{"float64(HTTP JSON)", map[string]any{"bangumi_type": float64(2)}, "animation"},
		{"int(同进程直传)", map[string]any{"bangumi_type": 2}, "animation"},
		{"int64", map[string]any{"bangumi_type": int64(3)}, "music"},
		{"未识别类型码", map[string]any{"bangumi_type": 5}, ""},
		{"缺字段", map[string]any{}, ""},
		{"非对象", "animation", ""},
	}
	for _, c := range cases {
		if got := workTypeFromMetadata(c.meta); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

// 类型未识别时不能写入任何属性：edition_date 只在 workType 非空时落库，
// 否则校验会以 unknown_field 拒绝整条导入。
func TestBuildWorkEntityOmitsAttributesWithoutType(t *testing.T) {
	w := &ImporterWorkPreview{Title: "无类型作品", ReleaseDate: "2002-09-27"}
	e, err := buildWorkEntity(w, "", "bangumi", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Types) != 0 {
		t.Fatalf("unexpected types: %v", e.Types)
	}
	if len(e.Attributes) != 0 {
		t.Fatalf("attributes written without a type: %v", e.Attributes)
	}

	typed, err := buildWorkEntity(w, "animation", "bangumi", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if typed.Attributes["edition_date"] != "2002-09-27" {
		t.Fatalf("edition_date not kept for typed work: %v", typed.Attributes)
	}
}

// Bangumi relation 中文职位文本 → definitions 关系码。无贴切码时返回空，
// 由 credit_role 承载原文，避免硬塞语义不符的关系。
func TestBangumiCreditRelationMapping(t *testing.T) {
	cases := map[string]string{
		"导演":   "directed_by",
		"CG 导演": "directed_by",
		"脚本":   "written_by",
		"系列构成": "written_by",
		"插入歌作词": "lyricist_of",
		"插入歌作曲": "composed_by",
		"人物设定":  "illustrated_by",
		"摄影监督":  "photographed_by",
		"旁白":    "narrated_by",
		"配音":    "voiced_by",
		// 无对应语义关系：保持为空，不虚构
		"製片人": "",
		"企画":  "",
		"制作":  "",
	}
	for in, want := range cases {
		if got := bangumiCreditRelation(in); got != want {
			t.Errorf("%s: got %q want %q", in, got, want)
		}
	}
}

// persons 端点 type：1=个人 2=公司 3=组合。
func TestBangumiPersonTypeAgent(t *testing.T) {
	for in, want := range map[int]string{1: "person", 2: "organization", 3: "group", 9: "person"} {
		if got := bangumiPersonTypeAgent(in); got != want {
			t.Errorf("type %d: got %q want %q", in, got, want)
		}
	}
}

// 角色番位映射：主角=primary、配角=supplement、客串/闲角=extra，其余为空。
func TestBangumiCharacterRankRole(t *testing.T) {
	for in, want := range map[string]string{
		"主角": "primary", "主人公": "primary",
		"配角": "supplement",
		"客串": "extra", "闲角": "extra",
		"旁白": "",
	} {
		if got := bangumiCharacterRankRole(in); got != want {
			t.Errorf("%s: got %q want %q", in, got, want)
		}
	}
}

// 关联项去重键：优先自有导入键，其次名称+类型；同人物跨职位应合并为一个 agent。
func TestAssocAgentDedup(t *testing.T) {
	withKey := ImporterStaffAssociation{
		ParsedName: "北澤史隆", EntityType: "person",
		ExternalIDs: map[string]any{"bangumi_person": 43041},
	}
	if got := assocAgentDedup(withKey); got != "bangumi_person:43041" {
		t.Fatalf("keyed dedup: %q", got)
	}
	// 同一人物两个职位（导演 + 脚本）→ 同一去重键
	same1 := ImporterStaffAssociation{ParsedName: "test", EntityType: "person", ExternalIDs: map[string]any{"bangumi_person": 7}}
	same2 := ImporterStaffAssociation{ParsedName: "test", EntityType: "person", ExternalIDs: map[string]any{"bangumi_person": 7}}
	if assocAgentDedup(same1) != assocAgentDedup(same2) {
		t.Fatal("same person across roles must dedup to one agent")
	}
	noKey := ImporterStaffAssociation{ParsedName: "Somebody", EntityType: "person"}
	if got := assocAgentDedup(noKey); got != "name:somebody|person" {
		t.Fatalf("name dedup: %q", got)
	}
}

// 关系写入的既定跳过集合应覆盖外部数据形态问题，但不得吞掉服务端故障。
func TestImporterRelationSkippable(t *testing.T) {
	for _, ok := range []string{"duplicate_relation", "invalid_endpoint_types", "cardinality_exceeded", "relation_cycle"} {
		if !importerRelationSkippable(errString(ok)) {
			t.Errorf("%s should be skippable", ok)
		}
	}
	for _, bad := range []string{"forbidden", "invalid_field", "db down"} {
		if importerRelationSkippable(errString(bad)) {
			t.Errorf("%s must not be swallowed", bad)
		}
	}
	if importerRelationSkippable(nil) {
		t.Error("nil error must not be skippable")
	}
}

type errString string

func (e errString) Error() string { return string(e) }

// subject 预览必须带出两层以内的关联 agent（演职人员 + 角色 + 声优），
// 并为每个关联给出关系码；前端据此生成 staff_associations。
func TestPreviewSubjectCollectsRelations(t *testing.T) {
	dir := replaySnapshotDir(t)
	stubBangumiReplay(t, dir)
	ctx := context.Background()
	s := &Store{}

	pv, err := s.Preview(ctx, "bangumi", "https://bgm.tv/subject/428735", "work")
	if err != nil {
		t.Fatal(err)
	}
	if len(pv.Artists) == 0 {
		t.Fatal("subject preview returned no related artists")
	}

	var persons, characters, actors, unmapped int
	byType := map[string]int{}
	for _, a := range pv.Artists {
		byType[a.EntityType]++
		switch {
		case a.RelationType == "character_in":
			characters++
			// 词表番位可能为空（如"旁白"），但原始番位文本必须保留在 Role 里不丢。
			if a.RelationRole == "" && strings.TrimSpace(a.Role) == "" {
				t.Errorf("character %s lost its rank entirely", a.Name)
			}
		case a.RelationType == "voiced_by":
			actors++
			if a.CharacterName == "" {
				t.Errorf("voice actor %s missing character link", a.Name)
			}
		case a.RelationType == "credit_for":
			unmapped++
		default:
			persons++
		}
		if a.ExternalIDs["metafusion_import"] == nil {
			t.Errorf("%s missing import key", a.Name)
		}
	}
	if characters == 0 || actors == 0 {
		t.Fatalf("expected characters and voice actors, got chars=%d actors=%d", characters, actors)
	}
	// 无贴切关系码的职位必须兜底到 credit_for，而不是留下无关系的孤儿实体。
	if unmapped == 0 {
		t.Errorf("expected fallback credit_for entries for unmapped roles; byType=%v", byType)
	}
	t.Logf("relations: credited=%d characters=%d voiceActors=%d fallback=%d types=%v",
		persons, characters, actors, unmapped, byType)
}

// 关联端点缺失（如上游只提供主条目）时必须优雅降级为空，不得报错。
func TestPreviewSubjectRelationsDegradeWhenAbsent(t *testing.T) {
	stubBangumi(t) // 该桩只覆盖 /subjects/7 等三个端点，无关联端点
	ctx := context.Background()
	s := &Store{}
	pv, err := s.Preview(ctx, "bangumi", "7", "work")
	if err != nil {
		t.Fatalf("preview must not fail when relation endpoints are absent: %v", err)
	}
	if len(pv.Artists) != 0 {
		t.Fatalf("expected no related artists, got %d", len(pv.Artists))
	}
}

// infobox 解析：值既可能是标量字符串，也可能是 [{"v":...}] 列表；
// 别名要去掉与主标题/原题名重复的项。
func TestBangumiInfoboxParsing(t *testing.T) {
	raw := `{
		"id": 428735, "type": 2, "name": "BanG Dream! It's MyGO!!!!!", "name_cn": "",
		"infobox": [
			{"key": "别名", "value": [{"k": "大陆版权译", "v": "迷途之子!!!!!"}, {"v": "BanG Dream! 迷途之子!!!!!"}]},
			{"key": "话数", "value": "13"},
			{"key": "官方网站", "value": "https://anime.bang-dream.com/mygo/"},
			{"key": "商品编号", "value": "KSLA-0004～0005"}
		]
	}`
	var sub bangumiSubject
	if err := json.Unmarshal([]byte(raw), &sub); err != nil {
		t.Fatal(err)
	}
	if got := sub.infoboxString("话数"); got != "13" {
		t.Errorf("scalar infobox: got %q", got)
	}
	if got := sub.infoboxString("官方网站"); got != "https://anime.bang-dream.com/mygo/" {
		t.Errorf("website: got %q", got)
	}
	aliases := sub.bangumiInfoboxAliases("BanG Dream! It's MyGO!!!!!", "BanG Dream! It's MyGO!!!!!")
	if len(aliases) != 2 || aliases[0] != "迷途之子!!!!!" {
		t.Errorf("aliases: %v", aliases)
	}
	// 与主标题重复的别名应被剔除
	if got := sub.bangumiInfoboxAliases("迷途之子!!!!!", ""); len(got) != 1 || got[0] != "BanG Dream! 迷途之子!!!!!" {
		t.Errorf("alias dedup failed: %v", got)
	}
}

// 假名是日文原文的可靠信号；纯汉字/拉丁不猜。
func TestDetectJapaneseScript(t *testing.T) {
	for in, want := range map[string]string{
		"とある魔術の禁書目録":   "ja",
		"BanG Dream! It's MyGO!!!!!": "",
		"魔法禁书目录":            "",
		"アイドルマスター":         "ja",
		"":                  "",
	} {
		if got := detectJapaneseScript(in); got != want {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
}

// 增量补录：只填补缺失元数据，绝不覆盖已有值（保护人工编辑）。
func TestMergeWorkMetadataNoOverwrite(t *testing.T) {
	existing := Entity{
		Kind: "work", Title: "作品", Status: "published",
		OriginalLanguage: "ja",
		Types:            []string{"animation"},
		Translations: map[string]Translation{
			"ja": {Title: "自定日文名", Summary: "自定简介", Aliases: []string{"已有别名"}},
		},
		Attributes:  map[string]any{"edition_date": "2001-01-01"},
		ExternalIDs: map[string]string{"official_website": "https://manual.example/"},
		Pictures:    []Picture{{URL: "https://manual.example/cover.jpg"}},
	}
	w := &ImporterWorkPreview{
		Title: "作品", OriginalTitle: "作品",
		ReleaseDate:      "2023-06-29",
		OriginalLanguage: "ja",
		Aliases:          []string{"已有别名", "新别名"},
		CoverImageURL:    "https://lain.bgm.tv/pic/cover/l/new.jpg",
		CatalogMetadata: map[string]any{
			"bangumi_type":     float64(2),
			"official_website": "https://imported.example/",
			"catalog_number":   "NEW-001",
		},
	}
	got, changed := mergeWorkMetadata(existing, w)
	// 已有值不得被覆盖
	if got.Attributes["edition_date"] != "2001-01-01" {
		t.Errorf("edition_date overwritten: %v", got.Attributes["edition_date"])
	}
	if got.ExternalIDs["official_website"] != "https://manual.example/" {
		t.Errorf("official_website overwritten: %v", got.ExternalIDs["official_website"])
	}
	if len(got.Pictures) != 1 || got.Pictures[0].URL != "https://manual.example/cover.jpg" {
		t.Errorf("picture overwritten: %v", got.Pictures)
	}
	if got.Translations["ja"].Title != "自定日文名" {
		t.Errorf("translation title overwritten: %v", got.Translations["ja"])
	}
	// 缺失项必须补齐，且别名按自身语种分派
	if got.Attributes["catalog_number"] != "NEW-001" {
		t.Errorf("catalog_number not backfilled: %v", got.Attributes)
	}
	// "新别名" 是纯汉字 → zh-CN 行；ja 行只保留原有别名
	if ja := got.Translations["ja"].Aliases; len(ja) != 1 || ja[0] != "已有别名" {
		t.Errorf("ja aliases = %v, want [已有别名]", ja)
	}
	if zh := got.Translations["zh-CN"].Aliases; !contains(zh, "新别名") {
		t.Errorf("zh-CN aliases = %v, want to contain 新别名", zh)
	}
	if !changed {
		t.Error("changed should be true when backfilling")
	}
}

// 别名按文字特征分派：假名→ja，含汉字→zh-CN，拉丁丢弃（不猜语种）。
func TestApplyAliasesByScript(t *testing.T) {
	e := Entity{Kind: "work", Title: "作品", Translations: map[string]Translation{"ja": {Title: "作品"}}}
	if !applyAliasesByScript(&e, []string{"迷途之子", "バンドリ", "LatinAlias", "作品"}) {
		t.Fatal("expected change")
	}
	if got := e.Translations["ja"].Aliases; len(got) != 1 || got[0] != "バンドリ" {
		t.Errorf("ja aliases = %v, want [バンドリ]", got)
	}
	// 新建语种行时首个别名充当标题（校验要求标题非空）
	if got := e.Translations["zh-CN"].Title; got != "迷途之子" {
		t.Errorf("zh-CN title = %q, want 迷途之子", got)
	}
	for loc, tr := range e.Translations {
		for _, a := range tr.Aliases {
			if a == "LatinAlias" {
				t.Errorf("latin alias leaked into %s", loc)
			}
			if a == "作品" {
				t.Errorf("alias equal to title leaked into %s", loc)
			}
		}
	}
}

// person type 判定：上游 type 为权威（2=公司 3=组合），type=1 时用自述文本纠正。
func TestBangumiPersonAgentType(t *testing.T) {
	orgSummary := "株式会社ブシロードは、東京都中野区に所在する企業。"
	voiceSummary := "尾崎由香（おざき ゆか）は、日本の女性声優。研音所属。"
	bandSummary := "现实与虚拟同步的全新乐队。"
	cases := []struct {
		name    string
		typeID  int
		summary string
		want    string
	}{
		{"上游标公司", 2, "", "organization"},
		{"上游标组合", 3, "", "group"},
		{"企业自述('株式会社Xは、' 模式)", 1, orgSummary, "organization"},
		{"企业自述('を主な事業内容とする')", 1, "アニメーションの企画・制作を主な事業内容とする日本の企業。", "organization"},
		{"企业自述('是一家…公司')", 1, "于1990年成立，是日本一家专门从事动画美术背景的公司。", "organization"},
		// 声优简介常出现"所属"，不得误判为公司
		{"声优(含'所属')", 1, voiceSummary, "person"},
		{"乐队描述但不是 type=3", 1, bandSummary, "person"},
		{"空简介", 1, "", "person"},
	}
	for _, c := range cases {
		if got := bangumiPersonAgentType(c.typeID, c.summary); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

// 语言推断：名称优先，名称无信号时看简介；都无信号留空。
func TestDetectEntityLanguage(t *testing.T) {
	cases := []struct{ name, summary, want string }{
		{"とある魔術の禁書目録", "", "ja"},
		{"BanG Dream! It's MyGO!!!!!", "现实与虚拟同步的乐队", ""},         // 标题拉丁、简介中文 → 不猜日文
		{"AIR Original SoundTrack", "ゲーム中に使用されたＢＧＭ全23曲", "ja"}, // 标题拉丁、简介日文
		{"魔法禁书目录", "", ""},                                    // 纯汉字不猜
		{"ブシロード", "株式会社ブシロード", "ja"},
	}
	for _, c := range cases {
		if got := detectEntityLanguage(c.name, c.summary); got != c.want {
			t.Errorf("name=%q summary=%q: got %q want %q", c.name, c.summary, got, c.want)
		}
	}
}

// 已存在 agent 的补齐：纠正 person→organization、补简介/语言/封面，不覆盖已有值。
func TestMergeAgentMetadata(t *testing.T) {
	existing := Entity{
		Kind: "agent", Title: "ブシロード", Status: "published",
		Types:            []string{"person"},
		OriginalLanguage: "",
		Translations:     map[string]Translation{},
	}
	assoc := ImporterStaffAssociation{
		ParsedName: "ブシロード",
		EntityType: "organization",
		Language:   "ja",
		Biography:  "株式会社ブシロードは、東京都中野区に所在する企業。",
		AvatarURL:  "https://lain.bgm.tv/pic/crt/l/71/12/10556_prsn_hlm7H.jpg",
	}
	got, changed := mergeAgentMetadata(existing, assoc)
	if !changed {
		t.Fatal("expected change")
	}
	if len(got.Types) != 1 || got.Types[0] != "organization" {
		t.Errorf("type not corrected: %v", got.Types)
	}
	if got.OriginalLanguage != "ja" {
		t.Errorf("language not filled: %q", got.OriginalLanguage)
	}
	if !agentHasSummary(got) {
		t.Errorf("summary not applied: %v", got.Translations)
	}
	if len(got.Pictures) != 1 {
		t.Errorf("picture not filled: %v", got.Pictures)
	}
	// 已有简介/语言时不得覆盖
	keep := got
	assoc2 := ImporterStaffAssociation{EntityType: "group", Language: "zh-CN", Biography: "另一个简介"}
	got2, _ := mergeAgentMetadata(keep, assoc2)
	if got2.OriginalLanguage != "ja" {
		t.Errorf("language overwritten: %q", got2.OriginalLanguage)
	}
	if got2.Types[0] != "organization" {
		t.Errorf("org must not be downgraded to group by title match: %v", got2.Types)
	}
}
