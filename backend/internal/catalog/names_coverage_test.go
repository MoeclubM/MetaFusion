package catalog

import (
	"sort"
	"testing"
)

// isPlaceholder 判断一条名称是否仍把英文当繁体中文/日文用。
// names() 就是这样的占位实现（现在只留给测试夹具），读起来"有值"，实际是未翻译。
func isPlaceholder(n Names) bool {
	en := n["en-US"]
	return n["zh-TW"] == en || n["ja-JP"] == en || n["ja"] == en
}

// collectFieldNames 递归收集字段及其嵌套子字段、列表项的名称与单位名。
//
// 必须递归：种子里的 locator、attachments.items、infobox 的 key/value 都是嵌套名称，
// 只收顶层会让这些名称变成"怎么写都不会被发现"的盲区（曾经有 22 条不在棘轮内）。
func collectFieldNames(path string, f Field, add func(prefix, code string, n Names)) {
	add("field", path, f.Names)
	if len(f.Unit) > 0 {
		add("field-unit", path, f.Unit)
	}
	if f.Items != nil {
		collectFieldNames(path+".items", *f.Items, add)
	}
	for code, child := range f.Fields {
		collectFieldNames(path+"."+code, child, add)
	}
}

// seededNames 收集所有"种子名称"（类型/字段及嵌套子字段与单位/词表及词项/关系及正反名与分组名/模板与分区/场景方案）。
func seededNames(d Definitions) map[string]Names {
	out := map[string]Names{}
	add := func(prefix, code string, n Names) {
		if len(n) > 0 {
			out[prefix+":"+code] = n
		}
	}
	for code, t := range d.Types {
		add("type", code, t.Names)
	}
	for code, f := range d.Fields {
		collectFieldNames(code, f, add)
	}
	for code, v := range d.Vocabularies {
		add("vocabulary", code, v.Names)
		for term, tv := range v.Terms {
			add("term", code+"."+term, tv.Names)
		}
	}
	for code, r := range d.Relations {
		add("relation", code, r.Names)
		add("relation-reverse", code, r.ReverseNames)
		if len(r.GroupNames) > 0 {
			add("relation-group", code, r.GroupNames)
		}
	}
	for code, tpl := range d.Templates {
		add("template", code, tpl.Names)
		for i, s := range tpl.Sections {
			add("section", code+"#"+string(rune('a'+i)), s.Names)
		}
	}
	for code, s := range d.Schemes {
		add("scheme", code, s.Names)
	}
	return out
}

// TestSeededNamesCoverAllLocales 断言**所有**种子名称（含货架与外部权威库、含嵌套子字段）
// 四语齐备，判据直接复用写路径的 validateNames —— 测试与线上闸门同一套规则，
// 不会出现"测试过了但接口拒收"或反之。
// 这里只查"键在且非空"：专有名词（MusicBrainz / ISBNdb / CD）在几种文字里本就同形，
// 强行要求互不相同会把合法名称判成违规；"是否真译文"由下面的占位棘轮看守。
func TestSeededNamesCoverAllLocales(t *testing.T) {
	names := seededNames(Defaults())
	for code, n := range KindNames() {
		names["kind:"+code] = n
	}
	for _, s := range shelfSeeds() {
		names["shelf:"+s.Slug] = s.Names
	}
	for _, e := range externalDatabaseSeeds() {
		names["external-database:"+e.Code] = e.Names
	}
	var missing []string
	for key, n := range names {
		if err := validateNames(n); err != nil {
			missing = append(missing, key+" -> "+err.Error())
		}
	}
	sort.Strings(missing)
	t.Logf("种子名称 %d 条，四语缺失 %d 条", len(names), len(missing))
	if len(missing) > 0 {
		t.Errorf("种子名称必须四语齐备（%d 条缺语种）：%v", len(missing), missing)
	}
}

// placeholderBudget 是"仍把英文当繁中/日文用"的欠账上限（棘轮）。
// 历史欠账已全部补完并冻结在 0：任何新增名称都必须四语齐备（用 names4），
// 拿 names() 顶替繁中/日文会立刻把计数顶上去、判这条测试失败。
const placeholderBudget = 0

// TestSeededNamesPlaceholderBudget：种子名称的多语言覆盖率棘轮。
// 目标（用户明确要求）：所有名称在 zh-CN / zh-TW / ja-JP / en-US 四语下都是真实译文。
// 一次性翻译完不现实，因此这里锁定"不得新增欠账"，并列出剩余清单便于分批还债。
func TestSeededNamesPlaceholderBudget(t *testing.T) {
	names := seededNames(Defaults())
	var placeholders []string
	for key, n := range names {
		if isPlaceholder(n) {
			placeholders = append(placeholders, key)
		}
	}
	sort.Strings(placeholders)
	t.Logf("种子名称 %d 条，其中 %d 条繁中/日文仍是英文占位", len(names), len(placeholders))
	if len(placeholders) > placeholderBudget {
		t.Errorf("英文占位的种子名称从 %d 涨到 %d 条：新增名称必须四语齐备（names4）", placeholderBudget, len(placeholders))
	}
	if testing.Verbose() && len(placeholders) > 0 {
		t.Logf("待翻译清单：%v", placeholders)
	}
}
