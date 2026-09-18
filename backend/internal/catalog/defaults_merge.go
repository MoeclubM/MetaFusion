package catalog

import "sort"

// mergeSeedDefinitions 把种子里**新增**的定义并进当前定义：只补当前缺失的键
// （含已存在类型缺失的字段码），已存在的类型/字段/词表/关系/模板/方案一律原样保留。
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
		Structure:    make(map[string]StructureRule, len(current.Structure)),
	}
	for k, v := range current.Structure {
		out.Structure[k] = v
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
	// 已存在类型的**字段集**同样只做补缺：种子新增的字段码并进当前类型，既有字段与顺序原样保留。
	// 只补 fields 表不够——写实体时属性键取自所属类型的字段集，存量类型缺新字段码时，
	// 新字段在存量实例上仍然写不进去（unknown_field），"补了字段却用不上"。
	// 只追加缺失的码：停用某字段的既有做法是把 fields.<code>.enabled 置假（本函数不碰），
	// 不靠从类型字段集里删码，因此补缺不会与"停用"混淆。
	for code, st := range seed.Types {
		cur, ok := out.Types[code]
		if !ok {
			continue // 缺失的类型已在上面补过
		}
		var missing []string
		for _, f := range st.Fields {
			if !contains(cur.Fields, f) {
				missing = append(missing, f)
			}
		}
		if len(missing) == 0 {
			continue
		}
		cur.Fields = append(append([]string{}, cur.Fields...), missing...)
		out.Types[code] = cur
		for _, f := range missing {
			added = append(added, "types."+code+".fields."+f)
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
	// 种子声明的**开关**只做"打开"：Aggregate 这类标记若种子为真、当前为假，说明当前文档是
	// 旧版本（还没这个声明），补上即可；种子为假时不动——那可能是后台有意关掉的。
	// 仍属"只增不改"：只会新增能力，不会覆盖人工决定。
	for code, sr := range seed.Relations {
		cur, ok := out.Relations[code]
		if !ok {
			continue // 缺失的关系已在上面补过
		}
		if sr.Aggregate && !cur.Aggregate {
			cur.Aggregate = true
			out.Relations[code] = cur
			added = append(added, "relations."+code+".aggregate")
		}
		// ParticipantSlot 同理：老文档没有该声明，补上即可（客户端据此判定"是否演职"）。
		// 已有值时不覆盖——后台可以按需要改写槽位，种子不夺回控制权。
		if sr.ParticipantSlot != "" && cur.ParticipantSlot == "" {
			cur.ParticipantSlot = sr.ParticipantSlot
			out.Relations[code] = cur
			added = append(added, "relations."+code+".participant_slot")
		}
	}
	for k, v := range seed.Structure {
		if _, ok := out.Structure[k]; !ok {
			out.Structure[k] = v
			added = append(added, "structure."+k)
		}
	}
	// 名称译文补丁：只填仍是英文占位的语种（见 mergeNames 注释），不覆盖已有译文。
	added = append(added, backfillTranslations(&out, seed)...)
	sort.Strings(added)
	return out, added
}
