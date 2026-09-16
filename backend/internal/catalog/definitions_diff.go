package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

// 版本间差异：通用 JSON 路径遍历 + 四种变更类型。
// 七个分区（types / fields / vocabularies / relations / templates / schemes / structure）在文档里
// 只有 map / array / 标量三种形态，因此这里只写一个通用比较器，不为任何分区手写比较逻辑；
// 分区名只用于计数汇总。
const (
	definitionChangeAdded   = "added"
	definitionChangeRemoved = "removed"
	definitionChangeChanged = "changed"
	definitionChangeToggled = "toggled"
)

// definitionDiffMaxValue 是单个值进响应的字节上限：超过即截断成字符串前缀并置 truncated。
// 这个端点的意义是"不返回整份 document"，单个新增的大子树也不能把它拉回 MB 级。
const definitionDiffMaxValue = 512

// 计数汇总的固定键：为 0 也给出，客户端不必判断键是否存在。
var (
	definitionDiffSections = []string{"types", "fields", "vocabularies", "relations", "templates", "schemes", "structure"}
	definitionDiffKinds    = []string{definitionChangeAdded, definitionChangeRemoved, definitionChangeChanged, definitionChangeToggled}
)

// DefinitionDiff 读两个定义版本并比较：against<=0 时与自身的 base_version 比（即"与上一版比"）。
// 任一侧版本不存在都返回 sql.ErrNoRows（HTTP 404）；响应里不含任何一侧的 document。
func (s *Store) DefinitionDiff(ctx context.Context, id, against int64) (DefinitionDiff, error) {
	cur, err := s.definitionVersion(ctx, id)
	if err != nil {
		return DefinitionDiff{}, err
	}
	if against <= 0 {
		against = cur.BaseVersion
	}
	base, err := s.definitionVersion(ctx, against)
	if err != nil {
		return DefinitionDiff{}, err
	}
	return definitionDiff(cur.ID, against, cur.BaseVersion, base.Document, cur.Document), nil
}

// definitionDiff 是纯比较，不碰库：逻辑用例可以直接喂两份文档。
func definitionDiff(id, against, baseVersion int64, before, after Definitions) DefinitionDiff {
	changes := []DefinitionChange{}
	definitionDiffValue("", definitionDiffJSON(before), definitionDiffJSON(after), &changes)
	summary := DefinitionDiffSummary{Total: len(changes), BySection: map[string]int{}, ByChange: map[string]int{}}
	for _, section := range definitionDiffSections {
		summary.BySection[section] = 0
	}
	for _, kind := range definitionDiffKinds {
		summary.ByChange[kind] = 0
	}
	for _, c := range changes {
		summary.BySection[c.Section]++
		summary.ByChange[c.Change]++
	}
	return DefinitionDiff{ID: id, Against: against, BaseVersion: baseVersion, Changes: changes, Summary: summary}
}

// definitionDiffJSON 把文档往返成通用 JSON 形态（map[string]any / []any / 标量），与 encode 同一
// 序列化口径（json.Marshal 对键排序），比较器只认这一种形态；同时丢掉 map 里的 null 值：
// omitempty 的指针/切片字段在两侧会分别以 null 与整键缺席出现，留着会让"两边都没值"变成变更。
func definitionDiffJSON(d Definitions) any {
	var out any
	if err := json.Unmarshal([]byte(encode(d)), &out); err != nil {
		return nil
	}
	return definitionDiffPrune(out)
}

func definitionDiffPrune(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for key, item := range t {
			if item == nil {
				delete(t, key)
				continue
			}
			t[key] = definitionDiffPrune(item)
		}
	case []any:
		for i, item := range t {
			t[i] = definitionDiffPrune(item)
		}
	}
	return v
}

// definitionDiffValue 递归比较两个 JSON 值：map 逐键、array 逐项（顺序不参与判定）、
// 标量记值变更，bool 标量记开关翻转。path 是键路径前缀（空串表示根）。
func definitionDiffValue(path string, before, after any, out *[]DefinitionChange) {
	bm, bok := before.(map[string]any)
	am, aok := after.(map[string]any)
	if bok && aok {
		for _, key := range definitionDiffKeys(bm, am) {
			bv, hasBefore := bm[key]
			av, hasAfter := am[key]
			child := key
			if path != "" {
				child = path + "." + key
			}
			switch {
			case !hasBefore:
				definitionDiffPresence(out, child, definitionChangeAdded, av)
			case !hasAfter:
				definitionDiffPresence(out, child, definitionChangeRemoved, bv)
			default:
				definitionDiffValue(child, bv, av, out)
			}
		}
		return
	}
	bs, bok := before.([]any)
	as, aok := after.([]any)
	if bok && aok {
		definitionDiffArray(path, bs, as, out)
		return
	}
	if encode(before) == encode(after) {
		return
	}
	kind := definitionChangeChanged
	if _, isBool := before.(bool); isBool {
		if _, isBool := after.(bool); isBool {
			kind = definitionChangeToggled
		}
	}
	definitionDiffEmit(out, path, kind, before, after)
}

// definitionDiffPresence 处理"键只在一侧出现"。JSON 往返里 omitempty 会把 false/""/0/空容器
// 整键丢掉，所以两侧的"缺键"与"零值"是同一种状态：零值不报变更；布尔真值出现或消失按开关翻转
// 报（缺键即 false），其余整棵子树作为一条新增/删除条目——键级粒度，不逐叶展开。
func definitionDiffPresence(out *[]DefinitionChange, path, kind string, value any) {
	if definitionDiffZero(value) {
		return
	}
	if _, ok := value.(bool); ok {
		if kind == definitionChangeAdded {
			definitionDiffEmit(out, path, definitionChangeToggled, false, true)
		} else {
			definitionDiffEmit(out, path, definitionChangeToggled, true, false)
		}
		return
	}
	if kind == definitionChangeAdded {
		definitionDiffEmit(out, path, kind, nil, value)
	} else {
		definitionDiffEmit(out, path, kind, value, nil)
	}
}

// definitionDiffZero 判断值是否等价于"没有这个键"：encode 的 omitempty 会把它们整键丢掉，
// 因此"缺键"与"零值"不算变更。
func definitionDiffZero(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case bool:
		return !t
	case string:
		return t == ""
	case float64:
		return t == 0
	case []any:
		return len(t) == 0
	case map[string]any:
		return len(t) == 0
	}
	return false
}

// definitionDiffArray 比较两个数组。顺序不参与判定：两侧多重集相同即无变更（"仅顺序不同不算变更"）；
// 否则按下标逐项比，多出来的一侧按下标记新增/删除。
func definitionDiffArray(path string, before, after []any, out *[]DefinitionChange) {
	if definitionDiffSameMultiset(before, after) {
		return
	}
	n := len(before)
	if len(after) < n {
		n = len(after)
	}
	for i := 0; i < n; i++ {
		definitionDiffValue(fmt.Sprintf("%s[%d]", path, i), before[i], after[i], out)
	}
	for i := n; i < len(before); i++ {
		definitionDiffEmit(out, fmt.Sprintf("%s[%d]", path, i), definitionChangeRemoved, before[i], nil)
	}
	for i := n; i < len(after); i++ {
		definitionDiffEmit(out, fmt.Sprintf("%s[%d]", path, i), definitionChangeAdded, nil, after[i])
	}
}

// definitionDiffSameMultiset 按 encode 的规范形态（键排序）比较多重集，忽略顺序。
func definitionDiffSameMultiset(a, b []any) bool {
	if len(a) != len(b) {
		return false
	}
	counts := map[string]int{}
	for _, v := range a {
		counts[encode(v)]++
	}
	for _, v := range b {
		counts[encode(v)]--
	}
	for _, n := range counts {
		if n != 0 {
			return false
		}
	}
	return true
}

// definitionDiffKeys 是两张 map 的键并集，排序后返回：遍历顺序固定，输出可断言。
func definitionDiffKeys(a, b map[string]any) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(a)+len(b))
	for _, m := range []map[string]any{a, b} {
		for key := range m {
			if !seen[key] {
				seen[key] = true
				out = append(out, key)
			}
		}
	}
	sort.Strings(out)
	return out
}

// definitionDiffSection 取路径首段作为分区名：分区就是文档的顶层键。
func definitionDiffSection(path string) string {
	if i := strings.IndexAny(path, ".["); i >= 0 {
		return path[:i]
	}
	return path
}

// definitionDiffEmit 追加一条差异。path 为空说明差异落在根上（正常文档不会有），跳过。
func definitionDiffEmit(out *[]DefinitionChange, path, kind string, from, to any) {
	if path == "" {
		return
	}
	fromValue, fromCut := definitionDiffLimit(from)
	toValue, toCut := definitionDiffLimit(to)
	*out = append(*out, DefinitionChange{
		Path:      path,
		Section:   definitionDiffSection(path),
		Change:    kind,
		From:      fromValue,
		To:        toValue,
		Truncated: fromCut || toCut,
	})
}

// definitionDiffLimit 截断超限值：字符串按自身截（类型不变），其它形态取序列化前缀字符串。
// nil 表示"这一侧没有值"（added 无 from、removed 无 to），JSON 里整个键省略。
func definitionDiffLimit(v any) (any, bool) {
	switch t := v.(type) {
	case nil:
		return nil, false
	case string:
		if len(t) <= definitionDiffMaxValue {
			return t, false
		}
		return definitionDiffPrefix(t), true
	}
	raw := encode(v)
	if len(raw) <= definitionDiffMaxValue {
		return v, false
	}
	return definitionDiffPrefix(raw), true
}

// definitionDiffPrefix 按上限截断，并保证不把多字节字符切成两半。
func definitionDiffPrefix(s string) string {
	if len(s) <= definitionDiffMaxValue {
		return s
	}
	cut := s[:definitionDiffMaxValue]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut
}
