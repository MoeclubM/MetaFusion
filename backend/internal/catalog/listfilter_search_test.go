package catalog

import (
	"context"
	"strings"
	"testing"
)

// listFilterSearchDefinitions 构造覆盖全部新语法的 definitions 快照：
// 实体 attributes 内的 group（pack）、list（attachments/store_bonuses），
// 以及 locator / inclusion_attributes / subject_attributes 三个结构入口。
// 叶子默认 searchable+enabled，个别用例单独关掉以断言拒绝路径。
func listFilterSearchDefinitions() Definitions {
	d := Defaults()
	// 实体 attributes 演示：group 中途节点（pack）与 list 中途节点（attachments）。
	d.Fields["pack"] = Field{Names: names("包装组", "Pack group"), Type: "group", Enabled: true, Searchable: true, Fields: map[string]Field{
		"format": {Names: names("格式", "Format"), Type: "text", Enabled: true, Searchable: true},
	}}
	att := d.Fields["attachments"]
	items := *att.Items
	fields := map[string]Field{}
	for k, v := range items.Fields {
		fields[k] = v
	}
	fields["store"] = Field{Names: names("店铺", "Store"), Type: "text", Enabled: true, Searchable: true}
	items.Fields = fields
	items.Enabled = true
	items.Searchable = true
	att.Items = &items
	att.Enabled = true
	att.Searchable = true
	d.Fields["attachments"] = att
	// 结构属性入口：locator 叶子（path）与收录/发行对象附加属性叶子。
	loc := d.Fields["locator"]
	loc.Fields["path"] = Field{Names: names("文件路径", "File path"), Type: "text", Enabled: true, Searchable: true}
	d.Fields["locator"] = loc
	inc := d.Fields["inclusion_attributes"]
	inc.Fields["translator"] = Field{Names: names("译者", "Translator"), Type: "text", Enabled: true, Searchable: true}
	d.Fields["inclusion_attributes"] = inc
	sub := d.Fields["subject_attributes"]
	sub.Fields["seq"] = Field{Names: names("序号", "Sequence"), Type: "text", Enabled: true, Searchable: true}
	d.Fields["subject_attributes"] = sub
	return d
}

func listFilterSearchCtx(d Definitions) context.Context {
	return withListFilterDefinitions(context.Background(), d)
}

func listFilterSearchSQL(t *testing.T, d Definitions, o ListOptions) (string, []any) {
	t.Helper()
	args := []any{}
	parts, err := listFilter(listFilterSearchCtx(d), &Store{}, o, nil, &args)
	if err != nil {
		t.Fatal(err)
	}
	return strings.Join(parts, " AND "), args
}

// 点分 group 路径逐层下钻，叶子保持等值语义。
func TestListFilterDottedGroupPath(t *testing.T) {
	joined, args := listFilterSearchSQL(t, listFilterSearchDefinitions(),
		ListOptions{Field: "pack.format", Value: "bd"})
	if !strings.Contains(joined, "document->'attributes'->'pack'->>'format'=$1") {
		t.Fatalf("group path must drill with -> and compare leaf with ->>, got: %s", joined)
	}
	if len(args) != 1 || args[0] != "bd" {
		t.Fatalf("value must be a single bound arg, got %v", args)
	}
}

// 实体 attributes 内的 list 中途节点按"任一元素命中"编译成 EXISTS。
func TestListFilterListMidpointExists(t *testing.T) {
	joined, args := listFilterSearchSQL(t, listFilterSearchDefinitions(),
		ListOptions{Field: "attachments.store", Value: "animate"})
	if !strings.Contains(joined, "jsonb_array_elements(") || !strings.Contains(joined, "EXISTS(SELECT 1 FROM ") {
		t.Fatalf("list midpoint must use EXISTS over jsonb_array_elements, got: %s", joined)
	}
	if !strings.Contains(joined, "->>'store'=$1") {
		t.Fatalf("leaf must keep ->> equality, got: %s", joined)
	}
	if len(args) != 1 || args[0] != "animate" {
		t.Fatalf("value must be a single bound arg, got %v", args)
	}
}

// locator 伪字段命中 track_contents 的 EXISTS 子查询。
func TestListFilterLocatorPseudoField(t *testing.T) {
	joined, _ := listFilterSearchSQL(t, listFilterSearchDefinitions(),
		ListOptions{Kind: "track", Field: "locator.path", Value: "/disc1"})
	if !strings.Contains(joined, "catalog.track_contents") {
		t.Fatalf("locator must query catalog.track_contents, got: %s", joined)
	}
	if !strings.Contains(joined, "EXISTS(SELECT 1 FROM ") {
		t.Fatalf("locator must compile to EXISTS, got: %s", joined)
	}
}

// inclusion_attributes 伪字段同样命中 track_contents。
func TestListFilterInclusionAttributesPseudoField(t *testing.T) {
	joined, _ := listFilterSearchSQL(t, listFilterSearchDefinitions(),
		ListOptions{Kind: "track", Field: "inclusion_attributes.translator", Value: "translator-a"})
	if !strings.Contains(joined, "catalog.track_contents") {
		t.Fatalf("inclusion_attributes must query catalog.track_contents, got: %s", joined)
	}
}

// subject_attributes 伪字段命中 release_subjects。
func TestListFilterSubjectAttributesPseudoField(t *testing.T) {
	joined, _ := listFilterSearchSQL(t, listFilterSearchDefinitions(),
		ListOptions{Kind: "release", Field: "subject_attributes.seq", Value: "1"})
	if !strings.Contains(joined, "catalog.release_subjects") {
		t.Fatalf("subject_attributes must query catalog.release_subjects, got: %s", joined)
	}
}

// 结构伪字段在 kind 显式不匹配时恒假（返回空集）而不是报错。
// kind 本身仍按常规占一位绑定参数；取值参数不再绑定（谓词恒假无需比较）。
func TestListFilterStructuralKindMismatchIsEmpty(t *testing.T) {
	joined, args := listFilterSearchSQL(t, listFilterSearchDefinitions(),
		ListOptions{Kind: "release", Field: "locator.path", Value: "/disc1"})
	if !strings.Contains(joined, "1=0") {
		t.Fatalf("kind-mismatched structural predicate must be constantly false, got: %s", joined)
	}
	for _, a := range args {
		if a == "/disc1" {
			t.Fatalf("constantly-false predicate must not bind the value arg, got %v", args)
		}
	}
}

// kind 未指定时结构伪字段按 EXISTS 自然过滤，不恒假。
func TestListFilterStructuralWithoutKindUsesExists(t *testing.T) {
	joined, _ := listFilterSearchSQL(t, listFilterSearchDefinitions(),
		ListOptions{Field: "locator.path", Value: "/disc1"})
	if strings.Contains(joined, "1=0") {
		t.Fatalf("unscoped structural predicate must not be constantly false, got: %s", joined)
	}
	if !strings.Contains(joined, "catalog.track_contents") {
		t.Fatalf("unscoped locator must still query track_contents, got: %s", joined)
	}
}

// 不可检索的叶子（Searchable=false）必须被拒绝。
func TestListFilterUnsearchableLeafRejected(t *testing.T) {
	d := listFilterSearchDefinitions()
	loc := d.Fields["locator"]
	path := loc.Fields["path"]
	path.Searchable = false
	loc.Fields["path"] = path
	d.Fields["locator"] = loc
	args := []any{}
	if _, err := listFilter(listFilterSearchCtx(d), &Store{}, ListOptions{Kind: "track", Field: "locator.path", Value: "x"}, nil, &args); err == nil || err.Error() != "field_not_searchable" {
		t.Fatalf("unsearchable leaf must fail with field_not_searchable, got %v", err)
	}
}

// 链路上任一字段 disabled 也必须被拒绝。
func TestListFilterDisabledChainRejected(t *testing.T) {
	d := listFilterSearchDefinitions()
	att := d.Fields["attachments"]
	att.Enabled = false
	d.Fields["attachments"] = att
	args := []any{}
	if _, err := listFilter(listFilterSearchCtx(d), &Store{}, ListOptions{Field: "attachments.store", Value: "x"}, nil, &args); err == nil || err.Error() != "field_not_searchable" {
		t.Fatalf("disabled chain must fail with field_not_searchable, got %v", err)
	}
}

// 未知路径返回 unknown_field。
func TestListFilterUnknownPathRejected(t *testing.T) {
	for _, field := range []string{"pack.no_such_leaf", "no_such_root.format", "attachments.store.deeper", "locator.no_such_key"} {
		args := []any{}
		_, err := listFilter(listFilterSearchCtx(listFilterSearchDefinitions()), &Store{}, ListOptions{Field: field, Value: "x"}, nil, &args)
		if err == nil || err.Error() != "unknown_field" {
			t.Fatalf("field %q must fail with unknown_field, got %v", field, err)
		}
	}
}

// 单层 field=value 行为保持不变：字段名与取值双绑定、->> 等值。
func TestListFilterSingleFieldUnchanged(t *testing.T) {
	d := listFilterSearchDefinitions()
	args := []any{}
	parts, err := listFilter(listFilterSearchCtx(d), &Store{}, ListOptions{Field: "format", Value: "bd"}, nil, &args)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(parts, " AND ")
	if !strings.Contains(joined, "document->'attributes'->>$1=$2") {
		t.Fatalf("single field must keep document->'attributes'->>$1=$2, got: %s", joined)
	}
	if len(args) < 2 || args[len(args)-2] != "format" || args[len(args)-1] != "bd" {
		t.Fatalf("single field must bind field name and value, got %v", args)
	}
}
