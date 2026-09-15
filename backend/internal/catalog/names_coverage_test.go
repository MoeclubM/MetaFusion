package catalog

import (
	"sort"
	"testing"
)

// isPlaceholder 判断一条名称是否仍把英文当繁体中文/日文用。
// names() 的历史实现就是这样占位的，读起来"有值"，实际是未翻译。
func isPlaceholder(n Names) bool {
	en := n["en-US"]
	return n["zh-TW"] == en || n["ja-JP"] == en || n["ja"] == en
}

// seededNames 收集所有"种子名称"（类型/字段/词表及词项/关系及反向名/模板与分区/结构方案）。
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
		add("field", code, f.Names)
		if f.Items != nil {
			add("field-item", code, f.Items.Names)
		}
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

// placeholderBudget 是"仍把英文当繁中/日文用"的历史欠账上限（棘轮）。
// 只允许下降：补完一批就调小这个数字；任何新增名称都必须四语齐备（用 names4）。
// 当前实测：235 条种子名称全部还是英文占位（首批翻译完成前先冻在这里，只准往下调）。
const placeholderBudget = 235

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
