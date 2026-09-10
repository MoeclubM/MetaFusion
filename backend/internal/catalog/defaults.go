package catalog

// names builds bilingual names with reserved fallback keys.
//
// zh-CN/en-US are required by Definitions.Validate; zh-TW, ja and ja-JP carry
// the English text until proper translations land, so exact-locale and prefix
// lookups (ja-JP -> ja) resolve instead of falling through to an unrelated entry.
// Use names4 when Traditional Chinese or Japanese text is available.
func names(zh, en string) Names {
	return Names{"zh-CN": zh, "zh-TW": en, "ja": en, "ja-JP": en, "en-US": en}
}

// names4 builds names with explicit Traditional Chinese and Japanese text.
// Reserve ja/ja-JP and zh-TW keys even when only an English fallback exists.
func names4(zhCN, zhTW, ja, en string) Names {
	return Names{"zh-CN": zhCN, "zh-TW": zhTW, "ja": ja, "ja-JP": ja, "en-US": en}
}
func Defaults() Definitions {
	d := Definitions{Types: map[string]TypeDefinition{}, Fields: map[string]Field{}, Vocabularies: map[string]Vocabulary{}, Relations: map[string]RelationDefinition{}, Templates: map[string]Template{}}
	field := func(code, zh, en, typ string) {
		d.Fields[code] = Field{Names: names(zh, en), Type: typ, Enabled: true, Searchable: true, Comparable: true}
	}
	for _, x := range [][4]string{{"catalog_number", "品番", "Catalog number", "text"}, {"barcode", "条码 / ISBN", "Barcode / ISBN", "text"}, {"edition_date", "发行日期", "Release date", "date"}, {"country", "发行地区", "Territory", "text"}, {"language", "内容语言", "Content language", "text"}, {"duration", "时长（秒）", "Duration (seconds)", "number"}, {"version_label", "表达版本", "Expression version", "text"}, {"format", "载体格式", "Medium format", "enum"}, {"packaging", "包装", "Packaging", "enum"}, {"edition_type", "版本类型", "Edition type", "enum"}, {"distribution_channel", "发行渠道", "Distribution channel", "enum"}, {"platform", "平台", "Platform", "text"}, {"isrc", "ISRC", "ISRC", "text"}, {"role", "内容用途", "Content role", "enum"}, {"character", "所饰角色", "Character", "entity"}, {"context", "适用作品或篇目", "Context", "entity"}, {"begin_date", "开始日期", "Begin date", "date"}, {"end_date", "结束日期", "End date", "date"}, {"scope", "适用范围说明", "Scope description", "text"}, {"publisher", "发行主体", "Publisher", "entity"}, {"attachments", "包装附件", "Package attachments", "list"}, {"store_bonuses", "渠道特典", "Retailer bonuses", "list"}, {"events", "发布与放送事件", "Release and broadcast events", "list"}} {
		field(x[0], x[1], x[2], x[3])
	}
	// country/region 保持 text 而未收敛为词表：取值是开放集合（地区代码、
	// 渠道/店铺名、放送地区），硬编码词表会阻塞编目。前端显示时优先查
	// 对应词表（distribution_channel 等），无词表命中则原样显示，不虚构映射。
	// 待 taxonomy 落定后再收敛为词表或格式校验，目前仅以字段说明约束。
	for _, x := range []struct {
		code, zh, en string
		terms        [][3]string
	}{
		{"format", "载体格式", "Medium formats", [][3]string{{"cd", "CD", "CD"}, {"bd", "蓝光", "Blu-ray"}, {"uhd_bd", "超高清蓝光", "Ultra HD Blu-ray"}, {"dvd", "DVD", "DVD"}, {"vinyl", "黑胶", "Vinyl"}, {"sacd", "SACD", "SACD"}, {"cassette", "磁带", "Cassette"}, {"paper", "纸质册", "Printed volume"}, {"digital", "数字文件集", "Digital collection"}, {"web", "网络配信", "Web distribution"}}},
		{"packaging", "包装", "Packaging", [][3]string{{"standard", "标准包装", "Standard"}, {"jewel", "Jewel Case", "Jewel case"}, {"slipcase", "腰封 / 外封套", "Slipcase"}, {"box", "盒装", "Box"}, {"boxset", "套盒", "Box set"}, {"digipak", "Digipak", "Digipak"}}},
		{"role", "内容用途", "Content roles", [][3]string{{"primary", "主要内容", "Primary"}, {"supplement", "附加内容", "Supplement"}, {"side", "唱片面", "Side"}, {"extra", "额外收录", "Extra"}, {"commentary", "解说音轨", "Commentary"}}},
		{"release_role", "发行对象用途", "Release subject roles", [][3]string{{"primary", "主作品", "Primary"}, {"compilation", "汇编作品", "Compilation"}, {"supplement", "附加作品", "Supplement"}}},
		{"edition_type", "版本类型", "Edition types", [][3]string{{"standard", "普通版", "Standard edition"}, {"limited", "限定版", "Limited edition"}, {"first_press", "初回版", "First press"}, {"regional", "地区版", "Regional edition"}, {"reissue", "再版", "Reissue"}, {"digital", "数字版", "Digital edition"}, {"deluxe", "豪华版", "Deluxe edition"}, {"boxset", "套盒", "Box set"}}},
		{"distribution_channel", "发行渠道", "Distribution channels", [][3]string{{"mixed", "混合", "Mixed"}, {"physical", "实体", "Physical"}, {"digital", "数字", "Digital"}, {"web", "网络配信", "Web distribution"}}},
	} {
		v := Vocabulary{Names: names(x.zh, x.en), Terms: map[string]Term{}}
		for _, t := range x.terms {
			v.Terms[t[0]] = Term{Names: names(t[1], t[2]), Enabled: true}
		}
		d.Vocabularies[x.code] = v
	}
	for _, k := range []string{"format", "packaging", "role", "edition_type", "distribution_channel"} {
		f := d.Fields[k]
		f.Vocabulary = k
		d.Fields[k] = f
	}
	for _, k := range []string{"character", "publisher"} {
		f := d.Fields[k]
		f.Kinds = []string{"agent"}
		d.Fields[k] = f
	}
	f := d.Fields["context"]
	f.Kinds = []string{"work", "content_unit", "expression", "release"}
	d.Fields["context"] = f
	for _, k := range []string{"attachments", "store_bonuses", "events"} {
		f := d.Fields[k]
		f.Items = &Field{Names: names("记录", "Record"), Type: "group", Enabled: true, Fields: map[string]Field{
			"label":     {Names: names("说明", "Description"), Type: "multilingual", Required: true, Enabled: true},
			"quantity":  {Names: names("数量", "Quantity"), Type: "number", Enabled: true},
			"date":      {Names: names("日期", "Date"), Type: "date", Enabled: true},
			"channel":   {Names: names("渠道 / 平台", "Channel / platform"), Type: "text", Enabled: true},
			"region":    {Names: names("地区", "Region"), Type: "text", Enabled: true},
			"time_zone": {Names: names("时区", "Time zone"), Type: "text", Enabled: true},
			"condition": {Names: names("批次 / 随机规则 / 条件", "Batch / random rule / condition"), Type: "text", Enabled: true},
		}}
		d.Fields[k] = f
	}
	for _, x := range [][3]string{{"music", "音乐", "Music"}, {"literature", "文学", "Literature"}, {"screen", "影视", "Screen"}, {"photography", "写真", "Photography"}, {"game", "游戏", "Games"}, {"generic", "通用", "General"}} {
		d.Templates[x[0]] = Template{Names: names(x[1], x[2]), Directory: "tree", Sections: []Section{{Names: names("详细信息", "Details"), Fields: []string{"language", "version_label", "duration", "platform"}}}, Columns: []string{"edition_date", "catalog_number"}, RelationGroups: []string{"credits", "creative", "membership"}}
	}
	for _, x := range [][4]string{{"music", "音乐作品", "Music work", "music"}, {"song", "歌曲", "Song", "music"}, {"album", "专辑", "Album", "music"}, {"novel", "小说", "Novel", "literature"}, {"animation", "动画", "Animation", "screen"}, {"film", "电影", "Film", "screen"}, {"photobook", "写真集", "Photobook", "photography"}, {"indie_game", "独立游戏", "Independent game", "game"}, {"visual_novel", "视觉小说", "Visual novel", "game"}, {"personal", "个人创作", "Personal creation", "generic"}} {
		// edition_date 用于承载作品首发/出版日期（列表与详情展示）；发行版自身的日期仍在 release.edition_date。
		d.Types[x[0]] = TypeDefinition{Names: names(x[1], x[2]), Kinds: []string{"work"}, Fields: []string{"language", "platform", "events", "edition_date"}, Template: x[3], Enabled: true}
	}
	for _, x := range [][3]string{{"person", "个人", "Person"}, {"organization", "组织", "Organization"}, {"group", "团体", "Group"}, {"character", "虚构角色", "Fictional character"}} {
		d.Types[x[0]] = TypeDefinition{Names: names(x[1], x[2]), Kinds: []string{"agent"}, Fields: []string{}, Template: "generic", Enabled: true}
	}
	for _, k := range []string{"collection", "content_unit", "expression", "release", "medium", "track"} {
		keys := []string{"language"}
		switch k {
		case "expression":
			keys = []string{"language", "duration", "version_label", "isrc", "events"}
		case "release":
			keys = []string{"catalog_number", "barcode", "edition_date", "edition_type", "country", "publisher", "packaging", "distribution_channel", "platform", "attachments", "store_bonuses", "events"}
		case "medium":
			// catalog_number 复用 release 级同名字段：多碟装各自品番落在 medium.attributes，
			// release.attributes 只保留总品番/代表品番。
			keys = []string{"catalog_number", "format", "role"}
		case "track":
			// Entity 无 title_override 列：同一 expression 在不同版本中的时长/署名差异
			// 由各 pressing 下自建的 track.attributes（duration/role）承载，
			// 通过 TrackContent 引用同一 CanonicalEntry/Expression 实现复用。
			keys = []string{"duration", "role"}
		}
		zh := map[string]string{"collection": "集合", "content_unit": "内容单元", "expression": "内容表达", "release": "发行版", "medium": "载体", "track": "收录位置"}[k]
		d.Types[k] = TypeDefinition{Names: names(zh, map[string]string{"collection": "Collection", "content_unit": "Content unit", "expression": "Expression", "release": "Release", "medium": "Medium", "track": "Track"}[k]), Kinds: []string{k}, Fields: keys, Template: "generic", Enabled: true}
	}
	addRel := func(code, zh, en, rzh, ren string, src, tgt []string, group string, acyclic bool) {
		d.Relations[code] = RelationDefinition{Names: names(zh, en), ReverseNames: names(rzh, ren), SourceKinds: src, TargetKinds: tgt, Fields: []string{"context", "character", "language", "begin_date", "end_date", "scope"}, Group: group, GroupNames: names(map[string]string{"credits": "署名", "creative": "创作关系", "membership": "组成与成员"}[group], map[string]string{"credits": "Credits", "creative": "Creative relations", "membership": "Membership"}[group]), Acyclic: acyclic, Enabled: true}
	}
	for _, x := range [][5]string{{"created_by", "创作者", "Created by", "创作了", "Creator of"}, {"performed_by", "表演者", "Performed by", "表演了", "Performer of"}, {"photographed_by", "摄影者", "Photographed by", "拍摄了", "Photographer of"}, {"modeled_by", "出镜者", "Modeled by", "出镜于", "Model in"}, {"developed_by", "开发者", "Developed by", "开发了", "Developer of"}, {"voiced_by", "配音者", "Voiced by", "配音于", "Voice actor in"}} {
		addRel(x[0], x[1], x[2], x[3], x[4], []string{"work", "content_unit", "expression", "release"}, []string{"agent"}, "credits", false)
	}
	// 分媒介署名关系：音乐（作曲/作词/编曲）、影视与动画（导演/编剧）、书籍（插画/朗读）。
	// 均为 agent 目标、group=credits，后台 DefinitionsEditor 可继续增删改。
	for _, x := range []struct {
		code, zh, en, rzh, ren string
		src                    []string
	}{
		{"composed_by", "作曲者", "Composed by", "作曲了", "Composer of", []string{"work", "content_unit", "expression"}},
		{"lyricist_of", "作词者", "Lyricist of", "作词了", "Lyricist for", []string{"work", "content_unit", "expression"}},
		{"arranged_by", "编曲者", "Arranged by", "编曲了", "Arranger of", []string{"work", "expression"}},
		{"directed_by", "导演", "Directed by", "执导了", "Director of", []string{"work", "content_unit"}},
		{"written_by", "编剧", "Written by", "编写了", "Writer of", []string{"work", "content_unit"}},
		{"illustrated_by", "插画者", "Illustrated by", "绘制了", "Illustrator of", []string{"work", "content_unit", "release"}},
		{"narrated_by", "朗读 / 旁白", "Narrated by", "朗读了", "Narrator of", []string{"expression", "release"}},
	} {
		addRel(x.code, x.zh, x.en, x.rzh, x.ren, x.src, []string{"agent"}, "credits", false)
	}
	for _, x := range [][5]string{{"adaptation_of", "改编自", "Adaptation of", "被改编为", "Adapted as"}, {"sequel_of", "续作于", "Sequel of", "前作于", "Prequel of"}, {"soundtrack_of", "配乐用于", "Soundtrack of", "配乐作品", "Soundtrack"}} {
		addRel(x[0], x[1], x[2], x[3], x[4], []string{"work"}, []string{"work"}, "creative", true)
	}
	for _, x := range [][5]string{{"translation_of", "翻译自", "Translation of", "被翻译为", "Translated as"}, {"revision_of", "修订自", "Revision of", "被修订为", "Revised as"}, {"cover_of", "翻唱自", "Cover of", "被翻唱为", "Covered as"}, {"alternate_take_of", "别版取自", "Alternate take of", "被用作别版", "Used as alternate take"}} {
		addRel(x[0], x[1], x[2], x[3], x[4], []string{"expression"}, []string{"expression"}, "creative", true)
	}
	addRel("pressing_of", "再版自", "Pressing of", "被再版为", "Repressed as", []string{"release"}, []string{"release"}, "creative", true)
	addRel("bonus_included_in", "特典收录于", "Bonus included in", "收录特典", "Includes bonus", []string{"expression"}, []string{"release", "medium"}, "membership", true)
	addRel("store_bonus_for", "渠道特典归属", "Store bonus for", "拥有渠道特典", "Has store bonus", []string{"expression", "release"}, []string{"agent"}, "membership", true)
	addRel("includes", "组成包含", "Includes", "组成属于", "Included in", []string{"collection", "work"}, []string{"work", "collection"}, "membership", true)
	return d
}
