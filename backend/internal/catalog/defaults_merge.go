package catalog

import "sort"

// mergeSeedDefinitions 把种子里**新增**的定义并进当前定义：只补当前缺失的键，
// 已存在的类型/字段/词表/关系/模板/方案一律原样保留。
//
// 为什么需要它：定义种子原先只在空库播种，存量实例拿不到新版本新增的关系码与字段，
// 只能靠导入预检兜底。但"只空库播种"的初衷是怕覆盖人工编目决策（禁用某关系码、
// 词表降级等），而不是拒绝新增——只增不改同样能满足这个初衷。
// 返回合并结果与被新增的键（"relations.member_of" 形式），供调用方写审计说明。
func mergeSeedDefinitions(current, seed Definitions) (Definitions, []string) {
	out := Definitions{
		Types:        make(map[string]TypeDefinition, len(current.Types)),
		Fields:       make(map[string]Field, len(current.Fields)),
		Vocabularies: make(map[string]Vocabulary, len(current.Vocabularies)),
		Relations:    make(map[string]RelationDefinition, len(current.Relations)),
		Templates:    make(map[string]Template, len(current.Templates)),
		Schemes:      make(map[string]Scheme, len(current.Schemes)),
	}
	for k, v := range current.Types {
		out.Types[k] = v
	}
	for k, v := range current.Fields {
		out.Fields[k] = v
	}
	for k, v := range current.Vocabularies {
		out.Vocabularies[k] = v
	}
	for k, v := range current.Relations {
		out.Relations[k] = v
	}
	for k, v := range current.Templates {
		out.Templates[k] = v
	}
	for k, v := range current.Schemes {
		out.Schemes[k] = v
	}

	var added []string
	for k, v := range seed.Types {
		if _, ok := out.Types[k]; !ok {
			out.Types[k] = v
			added = append(added, "types."+k)
		}
	}
	for k, v := range seed.Fields {
		if _, ok := out.Fields[k]; !ok {
			out.Fields[k] = v
			added = append(added, "fields."+k)
		}
	}
	for k, v := range seed.Vocabularies {
		if _, ok := out.Vocabularies[k]; !ok {
			out.Vocabularies[k] = v
			added = append(added, "vocabularies."+k)
		}
	}
	for k, v := range seed.Relations {
		if _, ok := out.Relations[k]; !ok {
			out.Relations[k] = v
			added = append(added, "relations."+k)
		}
	}
	for k, v := range seed.Templates {
		if _, ok := out.Templates[k]; !ok {
			out.Templates[k] = v
			added = append(added, "templates."+k)
		}
	}
	for k, v := range seed.Schemes {
		if _, ok := out.Schemes[k]; !ok {
			out.Schemes[k] = v
			added = append(added, "schemes."+k)
		}
	}
	sort.Strings(added)
	return out, added
}
