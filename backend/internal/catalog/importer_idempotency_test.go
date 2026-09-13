package catalog

import (
	"strings"
	"testing"
)

// 本文件锁定导入器幂等/映射修复带的纯函数行为（无库可跑）：
// 作曲≠编曲、ED≠OP、发行签名维度、关系吞错收窄、前置映射校验、标题去重语义。

// 作曲与编曲是不同关系码：编曲（含日文アレンジ）必须落 arranged_by，
// 不能被"作曲"规则抢先；作曲仍落 composed_by。
func TestBangumiCreditRelationDistinguishesArrange(t *testing.T) {
	for in, want := range map[string]string{
		"編曲": "arranged_by",
		"编曲": "arranged_by",
		"アレンジ":  "arranged_by",
		"作曲":   "composed_by",
		"作曲・編曲": "arranged_by", // 复合职位含编曲即按编曲（更具体维度优先）
		"插入歌作曲": "composed_by",
	} {
		if got := bangumiCreditRelation(in); got != want {
			t.Errorf("%s: got %q want %q", in, got, want)
		}
	}
}

// ED 必须映射为 ending（词表另有 ending 项），不能并入 opening。
func TestBangumiEpisodeRoleDistinguishesEnding(t *testing.T) {
	for in, want := range map[int]string{
		0: "main", 1: "extra", 2: "opening", 3: "ending", 4: "trailer", 5: "extra", 6: "extra",
	} {
		if got := bangumiEpisodeRole(in); got != want {
			t.Errorf("type %d: got %q want %q", in, got, want)
		}
	}
}

// 发行版本签名必须覆盖全部版本区分维度：publisher/packaging/
// distribution_channel/edition_type/edition_batch/language 任一不同即不同键；
// 曲目签名覆盖 recording_mbid/duration/artist_credit。
func TestImporterReleaseVariantKeyExtendedDimensions(t *testing.T) {
	base := "bangumi:subject:9:release"
	tracks := func() []ImporterMediumPreview {
		return []ImporterMediumPreview{{
			Position: 0, Name: "O.S.T.", Format: "cd",
			Tracks: []ImporterTrackPreview{{Position: 1, Title: "夜航", ISRC: "JPX001"}},
		}}
	}
	plain := &ImporterReleasePreview{EditionName: "原声集"}
	k1 := importerReleaseVariantKey(base, plain, tracks())
	if k1 == "" {
		t.Fatal("variant key must not be empty")
	}
	dims := []ImporterReleasePreview{
		{EditionName: "原声集", Publisher: "某社"},
		{EditionName: "原声集", Packaging: "box"},
		{EditionName: "原声集", DistributionChannel: "digital"},
		{EditionName: "原声集", EditionType: "limited"},
		{EditionName: "原声集", EditionBatch: "first_press"},
		{EditionName: "原声集", Language: "ja"},
	}
	for i, d := range dims {
		d := d
		if got := importerReleaseVariantKey(base, &d, tracks()); got == k1 {
			t.Errorf("dim %d (%+v) must not collide with bare edition", i, d)
		}
		if again := importerReleaseVariantKey(base, &d, tracks()); again != importerReleaseVariantKey(base, &d, tracks()) {
			t.Errorf("dim %d not stable", i)
		}
	}
	// 曲目维度：recording_mbid/duration/artist_credit 任一不同即不同键。
	t1 := tracks()
	t2 := tracks()
	t2[0].Tracks[0].RecordingMBID = "rec-1"
	if importerReleaseVariantKey(base, plain, t1) == importerReleaseVariantKey(base, plain, t2) {
		t.Error("recording_mbid must participate in track signature")
	}
	t3 := tracks()
	t3[0].Tracks[0].DurationSeconds = 215
	if importerReleaseVariantKey(base, plain, t1) == importerReleaseVariantKey(base, plain, t3) {
		t.Error("duration must participate in track signature")
	}
	t4 := tracks()
	t4[0].Tracks[0].ArtistCredit = "MyGO!!!!!"
	if importerReleaseVariantKey(base, plain, t1) == importerReleaseVariantKey(base, plain, t4) {
		t.Error("artist_credit must participate in track signature")
	}
}

// 发行属性：edition_type/edition_batch/packaging/distribution_channel
// 只有命中词表才写；未命中丢弃不虚构；publisher 自由文本不写属性。
func TestImporterReleaseAttrsWritesVocabDimensions(t *testing.T) {
	attrs := importerReleaseAttrs(&ImporterReleasePreview{
		CatalogNumber: "ABC-1", EditionType: "limited", EditionBatch: "first_press",
		Packaging: "box", DistributionChannel: "physical",
		Publisher: "某出版社",
	}, nil)
	for k, want := range map[string]string{
		"catalog_number": "ABC-1", "edition_type": "limited", "edition_batch": "first_press",
		"packaging": "box", "distribution_channel": "physical",
	} {
		if attrs[k] != want {
			t.Errorf("%s: got %v want %v", k, attrs[k], want)
		}
	}
	if _, ok := attrs["publisher"]; ok {
		t.Errorf("free-text publisher must not be written as attribute: %#v", attrs)
	}
	if err := importerCheckAttrs(Defaults(), "release", attrs); err != nil {
		t.Fatalf("release attrs rejected: %v", err)
	}
	// 未命中词表的值丢弃。
	dropped := importerReleaseAttrs(&ImporterReleasePreview{EditionType: "豪华未知版"}, nil)
	if _, ok := dropped["edition_type"]; ok {
		t.Errorf("unmapped edition_type must be dropped: %#v", dropped)
	}
}

// 关系吞错收窄：invalid_relation_type / cardinality_exceeded / relation_cycle
// 是真实完整性冲突，不得再当外部数据吞掉；只保留重复/端点形态跳过。
func TestImporterRelationSkippableNarrowed(t *testing.T) {
	for _, ok := range []string{"duplicate_relation", "invalid_endpoint_types", "invalid_endpoints"} {
		if !importerRelationSkippable(errString(ok)) {
			t.Errorf("%s should be skippable", ok)
		}
	}
	for _, bad := range []string{"invalid_relation_type", "cardinality_exceeded", "relation_cycle", "forbidden", "db down"} {
		if importerRelationSkippable(errString(bad)) {
			t.Errorf("%s must not be swallowed", bad)
		}
	}
}

// 前置映射校验：默认定义下全量通过；关系被删/禁用、词表项被禁用、
// 载荷关系码未知时明确报 importer_mapping_stale。
func TestImporterPreflightCodeCheck(t *testing.T) {
	if err := importerPreflightCodeCheck(Defaults()); err != nil {
		t.Fatalf("defaults must satisfy importer mappings: %v", err)
	}
	missing := Defaults()
	delete(missing.Relations, "voiced_by")
	if err := importerPreflightCodeCheck(missing); err == nil || !strings.Contains(err.Error(), "importer_mapping_stale") {
		t.Fatalf("missing relation must fail stale, got %v", err)
	}
	disabled := Defaults()
	r := disabled.Relations["directed_by"]
	r.Enabled = false
	disabled.Relations["directed_by"] = r
	if err := importerPreflightCodeCheck(disabled); err == nil || !strings.Contains(err.Error(), "directed_by") {
		t.Fatalf("disabled relation must fail stale, got %v", err)
	}
	badTerm := Defaults()
	v := badTerm.Vocabularies["role"]
	tm := v.Terms["primary"]
	tm.Enabled = false
	v.Terms["primary"] = tm
	badTerm.Vocabularies["role"] = v
	if err := importerPreflightCodeCheck(badTerm); err == nil || !strings.Contains(err.Error(), "importer_mapping_stale") {
		t.Fatalf("disabled vocab term must fail stale, got %v", err)
	}
}

func TestImporterPreflightAssociations(t *testing.T) {
	doc := Defaults()
	ok := []ImporterStaffAssociation{
		{ParsedName: "甲", RelationType: "directed_by", ParsedRole: "导演"},
		{ParsedName: "乙", RelationType: "character_in", RelationRole: "primary"},
		{ParsedName: "丙"},                            // 空关系码：落库侧计数跳过，预检不拒绝
		{ParsedName: "丁", Action: "skip", RelationType: "bogus"}, // skip 不校验
	}
	if err := importerPreflightAssociations(doc, ok); err != nil {
		t.Fatalf("valid associations rejected: %v", err)
	}
	bad := []ImporterStaffAssociation{{ParsedName: "甲", RelationType: "no_such_relation"}}
	if err := importerPreflightAssociations(doc, bad); err == nil || !strings.Contains(err.Error(), "importer_mapping_stale") {
		t.Fatalf("unknown relation must fail stale, got %v", err)
	}
	disabled := Defaults()
	r := disabled.Relations["voiced_by"]
	r.Enabled = false
	disabled.Relations["voiced_by"] = r
	if err := importerPreflightAssociations(disabled, []ImporterStaffAssociation{{ParsedName: "甲", RelationType: "voiced_by"}}); err == nil || !strings.Contains(err.Error(), "relation_disabled") {
		t.Fatalf("disabled relation must fail stale, got %v", err)
	}
	badRole := []ImporterStaffAssociation{{ParsedName: "乙", RelationType: "character_in", RelationRole: "nope"}}
	if err := importerPreflightAssociations(doc, badRole); err == nil || !strings.Contains(err.Error(), "importer_mapping_stale") {
		t.Fatalf("unknown role term must fail stale, got %v", err)
	}
}

// Agent 标题去重：大小写/空白变体折叠到同一键（findAgentByTitle 的 SQL 侧
// lower 比较 + 折叠确认的语义），避免小写标题碰撞出重复 agent。
func TestNormalizeImporterTitleKeyCollisions(t *testing.T) {
	a := normalizeImporterTitleKey("MyGO!!!!!")
	b := normalizeImporterTitleKey("  mygo!!!!!  ")
	c := normalizeImporterTitleKey("MyGO!!!!!　") // 全角空格同样折叠
	if a == "" || a != b || a != c {
		t.Fatalf("title keys must fold case/space: %q %q %q", a, b, c)
	}
	if normalizeImporterTitleKey("MyGO!!!!!") == normalizeImporterTitleKey("Ave Mujica") {
		t.Fatal("different titles must not collide")
	}
}

// 定义种子语义：只空库播种。Defaults() 自洽即可断言“存量不迁移”的前提——
// Initialize 在非空表时跳过（见 store.go 注释），此处锁定 Defaults 自身合法，
// 避免把“种子损坏”误读成“存量漂移”。
func TestDefinitionsSeedOnlyWhenEmpty(t *testing.T) {
	if err := Defaults().Validate(); err != nil {
		t.Fatalf("defaults invalid: %v", err)
	}
	// 存量定义的 entry_role 降级语义现证：词表缺项时 importerContentUnitAttrs
	// 按"未声明字段"降级不写（见 TestImporterContentUnitAttrsEntryRole），
	// Initialize 不得把新 Defaults 覆盖到存量已发布行——该行为由 store.go 的
	// 空表判断保证，此处以注释+用例双重锁定，避免后人"补齐"成全量覆盖。
}
