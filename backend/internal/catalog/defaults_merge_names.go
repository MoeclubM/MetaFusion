package catalog

import "strings"

// mergeNames 把种子里已有的**真实译文**补进当前名称表。只填这两种情况：
//
//	· 当前缺该语种；
//	· 当前该语种的值等于英文（说明它仍是占位）。
//
// 其它情况一律不动——已有的人工译文不会被覆盖，所以这仍然符合"只增不改"的合并精神：
// 它只把"本来就是英文占位"的位置补成译文，不改变任何已经表达过意图的值。
//
// 为什么需要它：定义种子原先只管新库，存量实例的字段/类型/关系名会永远停在最早的英文占位
// （例如 character 字段的 ja/zh-TW 一直是 "Character"）。补完译文由调用方写进审计说明。
func mergeNames(prefix string, cur, seed Names, added *[]string) Names {
	if len(cur) == 0 || len(seed) == 0 {
		return cur
	}
	out := make(Names, len(cur))
	for k, v := range cur {
		out[k] = v
	}
	en := seed["en-US"]
	for loc, val := range seed {
		if loc == "en-US" || val == "" || val == en {
			continue // 种子该语种本身也没给出与英文不同的译文，没有可补的信息
		}
		if existing, ok := out[loc]; ok && existing != "" && existing != en {
			continue // 已是译文（人工改过或此前补过），不覆盖
		}
		out[loc] = val
		*added = append(*added, prefix+"."+loc)
	}
	return out
}

// backfillTranslations 按七个分区把种子译文补进当前定义，返回补丁清单。
func backfillTranslations(out *Definitions, seed Definitions) []string {
	var added []string
	for code, cur := range out.Fields {
		if se, ok := seed.Fields[code]; ok {
			c := cur
			mergeFieldNames("fields."+code, &c, &se, &added)
			out.Fields[code] = c
		}
	}
	// 类型
	for code, cur := range out.Types {
		if se, ok := seed.Types[code]; ok {
			cur.Names = mergeNames("types."+code, cur.Names, se.Names, &added)
			out.Types[code] = cur
		}
	}
	// 关系（正名 / 反向名 / 分组名）
	for code, cur := range out.Relations {
		if se, ok := seed.Relations[code]; ok {
			cur.Names = mergeNames("relations."+code+".names", cur.Names, se.Names, &added)
			cur.ReverseNames = mergeNames("relations."+code+".reverse_names", cur.ReverseNames, se.ReverseNames, &added)
			cur.GroupNames = mergeNames("relations."+code+".group_names", cur.GroupNames, se.GroupNames, &added)
			out.Relations[code] = cur
		}
	}
	// 词表与词项
	for code, cur := range out.Vocabularies {
		se, ok := seed.Vocabularies[code]
		if !ok {
			continue
		}
		cur.Names = mergeNames("vocabularies."+code, cur.Names, se.Names, &added)
		for term, tv := range cur.Terms {
			if st, ok := se.Terms[term]; ok {
				tv.Names = mergeNames("vocabularies."+code+".terms."+term, tv.Names, st.Names, &added)
				cur.Terms[term] = tv
			}
		}
		out.Vocabularies[code] = cur
	}
	// 模板与模板分区
	for code, cur := range out.Templates {
		se, ok := seed.Templates[code]
		if !ok {
			continue
		}
		cur.Names = mergeNames("templates."+code, cur.Names, se.Names, &added)
		// 分区只能按名称配对：Section 没有独立编码，按下标配会在后台调换或增删分区时
		// 把 A 分区的译文写到 B 分区头上（且越界分区永远补不到）。配对不上就不补：
		// 少补一条只是该分区留占位，补错一条会把繁体名写进日文位。
		seedSections := make(map[string]Names, len(se.Sections))
		for _, s := range se.Sections {
			if key := strings.TrimSpace(s.Names["en-US"]); key != "" {
				seedSections[key] = s.Names
			}
		}
		for i := range cur.Sections {
			key := strings.TrimSpace(cur.Sections[i].Names["en-US"])
			if seedNames, ok := seedSections[key]; ok {
				cur.Sections[i].Names = mergeNames("templates."+code+".sections."+key, cur.Sections[i].Names, seedNames, &added)
			}
		}
		out.Templates[code] = cur
	}
	// 场景方案
	for code, cur := range out.Schemes {
		if se, ok := seed.Schemes[code]; ok {
			cur.Names = mergeNames("schemes."+code, cur.Names, se.Names, &added)
			out.Schemes[code] = cur
		}
	}
	return added
}

// mergeFieldNames 递归补字段（含子字段与列表项）的名称与单位译文。
func mergeFieldNames(prefix string, cur, se *Field, added *[]string) {
	if cur == nil || se == nil {
		return
	}
	cur.Names = mergeNames(prefix+".names", cur.Names, se.Names, added)
	cur.Unit = mergeNames(prefix+".unit", cur.Unit, se.Unit, added)
	for code, f := range cur.Fields {
		if sf, ok := se.Fields[code]; ok {
			fc := f
			mergeFieldNames(prefix+".fields."+code, &fc, &sf, added)
			cur.Fields[code] = fc
		}
	}
	if cur.Items != nil && se.Items != nil {
		items := *cur.Items
		mergeFieldNames(prefix+".items", &items, se.Items, added)
		cur.Items = &items
	}
}
