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

// floatPtr 便于在字段定义里声明 Min/Max 边界。
func floatPtr(v float64) *float64 { return &v }

// PrimaryDateField 返回某类型所属模板声明的主日期字段码（作品首发/发行日期）。
// 代码不硬编码 edition_date：模板改 primary_date_field 即改变语义，
// 未声明或类型未知时返回空，调用方不写日期（不虚构）。
func (d Definitions) PrimaryDateField(typeCode string) string {
	t, ok := d.Types[typeCode]
	if !ok {
		return ""
	}
	tpl, ok := d.Templates[t.Template]
	if !ok {
		return ""
	}
	return tpl.PrimaryDateField
}

// KindNames 是固定八实体骨架的**多语言显示名**（服务端唯一来源）。
//
// 为什么不放在前端字典里：kind 是领域模型的组成部分（不是界面装饰），它的名称属于"服务端定义的名称"，
// 必须和类型/字段/关系名一样可多语言、可被任何客户端（Web / Agent / 第三方）取用；
// 前端字典只保留兜底，服务端给了就以服务端为准。
//
// 四语齐备（zh-CN / zh-TW / ja-JP / en-US）：缺哪一语都会让该语种用户看到英文占位。
//
// KindRecord 是对外载荷形状：与 definitions 里其它名称对象一致，统一放在 names 键下，
// 以后要加 icon/order 之类字段也有位置（前端 KindDef 与之对应）。
type KindRecord struct {
	Names Names `json:"names"`
}

// KindNameRecords 把骨架名称包成对外形状，供 /api/catalog/definitions 的 kinds 字段使用。
func KindNameRecords() map[string]KindRecord {
	out := map[string]KindRecord{}
	for k, n := range KindNames() {
		out[k] = KindRecord{Names: n}
	}
	return out
}

func KindNames() map[string]Names {
	out := map[string]Names{}
	for _, x := range [][5]string{
		{"agent", "主体", "主體", "主体", "Agents"},
		{"collection", "集合", "集合", "コレクション", "Collections"},
		{"work", "作品", "作品", "作品", "Works"},
		{"content_unit", "内容单元", "內容單元", "コンテンツ単位", "Content units"},
		{"expression", "内容表达", "內容表達", "内容表現", "Expressions"},
		{"release", "发行版本", "發行版本", "リリース", "Releases"},
		{"medium", "载体", "載體", "キャリア", "Media (carrier)"},
		{"track", "收录位置", "收錄位置", "収録位置", "Tracks"},
	} {
		out[x[0]] = names4(x[1], x[2], x[3], x[4])
	}
	return out
}
func Defaults() Definitions {
	d := Definitions{Types: map[string]TypeDefinition{}, Fields: map[string]Field{}, Vocabularies: map[string]Vocabulary{}, Relations: map[string]RelationDefinition{}, Templates: map[string]Template{}}
	field := func(code, zh, en, typ string) {
		d.Fields[code] = Field{Names: names(zh, en), Type: typ, Enabled: true, Searchable: true, Comparable: true}
	}
	for _, x := range [][4]string{{"catalog_number", "品番", "Catalog number", "text"}, {"barcode", "条码 / ISBN", "Barcode / ISBN", "text"}, {"isbn", "ISBN", "ISBN", "text"}, {"edition_date", "发行日期", "Release date", "date"}, {"country", "发行地区", "Territory", "text"}, {"language", "内容语言", "Content language", "text"}, {"duration", "时长（秒）", "Duration (seconds)", "number"}, {"version_label", "表达版本", "Expression version", "text"}, {"format", "载体格式", "Medium format", "enum"}, {"packaging", "包装", "Packaging", "enum"}, {"edition_type", "版本类别", "Edition category", "enum"}, {"edition_batch", "发行批次", "Edition batch", "enum"}, {"distribution_channel", "发行渠道", "Distribution channel", "enum"}, {"platform", "平台", "Platform", "text"}, {"episodes", "话数", "Episodes", "number"}, {"volume_count", "卷数", "Volumes", "number"}, {"broadcast_start", "放送开始", "Broadcast start", "date"}, {"broadcast_weekday", "放送星期", "Broadcast weekday", "text"}, {"broadcast_end", "放送结束", "Broadcast end", "date"}, {"air_network", "放送电视台", "Broadcast network", "text"}, {"copyright", "版权标示", "Copyright", "text"}, {"author", "作者", "Author", "text"}, {"magazine", "连载杂志", "Magazine", "text"}, {"imdb", "IMDb", "IMDb", "text"}, {"isrc", "ISRC", "ISRC", "text"}, {"role", "内容用途", "Content role", "enum"}, {"entry_role", "篇目类型", "Entry role", "enum"}, {"credit_role", "署名职位", "Credit role", "text"}, {"character", "所饰角色", "Character", "entity"}, {"context", "适用作品或篇目", "Context", "entity"}, {"begin_date", "开始日期", "Begin date", "date"}, {"end_date", "结束日期", "End date", "date"}, {"scope", "适用范围说明", "Scope description", "text"}, {"publisher", "发行主体", "Publisher", "entity"}, {"attachments", "包装附件", "Package attachments", "list"}, {"store_bonuses", "渠道特典", "Retailer bonuses", "list"}, {"events", "发布与放送事件", "Release and broadcast events", "list"}} {
		field(x[0], x[1], x[2], x[3])
	}
	// 标签：值域开放（上游标签随作品而定），故为字符串列表而非受控词表；
	// 存于 attributes.tags，按容器包含（@>）过滤——结构基线为该 JSON 路径
	// 建了函数 GIN 索引，保证按标签检索走索引而非全表扫描。
	// Hidden：详情页有专用标签区块，不再进信息面板，避免与 JSON 原文重复。
	d.Fields["tags"] = Field{Names: names("标签", "Tags"), Type: "list", Enabled: true, Searchable: true, Hidden: true, Items: &Field{Names: names("标签", "Tag"), Type: "text", Enabled: true}}
	// infobox 原始条目：上游资料表的完整快照，保留键值原文以便追溯与后续映射。
	// Hidden：仅供检索与存档，不进信息面板，避免把不规范的键名直接暴露给用户。
	d.Fields["infobox"] = Field{Names: names("资料表原始条目", "Raw infobox entries"), Type: "list", Enabled: true, Searchable: true, Hidden: true,
		Items: &Field{Names: names("条目", "Entry"), Type: "group", Enabled: true, Fields: map[string]Field{
			"key":   {Names: names("键", "Key"), Type: "text", Required: true, Enabled: true},
			"value": {Names: names("值", "Value"), Type: "text", Required: true, Enabled: true},
		}}}
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
		// 篇目类型：区分本篇与 OP/ED/预告等附加篇目。集数编号在本篇与 OP 各自从 1 起算，
		// 仅凭编号/标题无法区分，必须单独记录。
		{"entry_role", "篇目类型", "Entry roles", [][3]string{{"main", "本篇", "Main"}, {"opening", "片头曲", "Opening"}, {"ending", "片尾曲", "Ending"}, {"trailer", "预告 / 宣传", "Trailer"}, {"extra", "其它附加", "Extra"}, {"other", "其它", "Other"}}},
		{"release_role", "发行对象用途", "Release subject roles", [][3]string{{"primary", "主作品", "Primary"}, {"compilation", "汇编作品", "Compilation"}, {"supplement", "附加作品", "Supplement"}}},
		// 版本维度按"可同时成立"拆开：类别（普通/限定/豪华/套盒）、批次（通常/初回/再版/重印）
		// 是各自独立的维度，地区归 country、渠道归 distribution_channel。
		// 原先把限定/初回/地区/再版/数字塞进一个互斥枚举，导致"日本初回限定再版"
		// 这类真实组合无法表达——只能三选一，丢掉另外两个维度。
		{"edition_type", "版本类别", "Edition categories", [][3]string{{"standard", "普通版", "Standard edition"}, {"limited", "限定版", "Limited edition"}, {"deluxe", "豪华版", "Deluxe edition"}, {"boxset", "套盒", "Box set"}}},
		{"edition_batch", "发行批次", "Edition batches", [][3]string{{"regular", "通常发行", "Regular release"}, {"first_press", "初回发行", "First press"}, {"reissue", "再版 / 重发", "Reissue"}, {"reprint", "重印", "Reprint"}}},
		{"distribution_channel", "发行渠道", "Distribution channels", [][3]string{{"mixed", "混合", "Mixed"}, {"physical", "实体", "Physical"}, {"digital", "数字", "Digital"}, {"web", "网络配信", "Web distribution"}}},
		{"locator_reference", "定位参照", "Locator reference", [][3]string{{"track", "整条音轨", "Whole track"}, {"medium", "整张载体", "Whole medium"}}},
	} {
		v := Vocabulary{Names: names(x.zh, x.en), Terms: map[string]Term{}}
		for _, t := range x.terms {
			v.Terms[t[0]] = Term{Names: names(t[1], t[2]), Enabled: true}
		}
		d.Vocabularies[x.code] = v
	}
	for _, k := range []string{"format", "packaging", "role", "edition_type", "edition_batch", "distribution_channel", "entry_role"} {
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
	// duration_source：该时长来自哪份录音（实体引用，仅 expression 可写）。
	// 含义=同一 expression 在不同版本中的时长差异由引用来源解释，
	// 不在 duration 数值旁另立口径。
	d.Fields["duration_source"] = Field{Names: names("时长来源", "Duration source"), Type: "entity", Kinds: []string{"expression"}, Enabled: true}
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
			// 渠道特典与发行事件进一步结构化的落点（全部走 definitions，
			// 不加硬编码列）：店铺/发行主体、随附内容引用、示意图、售价与来源。
			// store 是实体引用（零售店/出版社等 Agent）；content 引用随附的
			// 作品/表达（特典 CD 里的实际内容不能只剩"赠 CD"三个字）。
			"store":      {Names: names("店铺 / 发行主体", "Store / distributor"), Type: "entity", Kinds: []string{"agent"}, Enabled: true},
			"content":    {Names: names("随附内容", "Included content"), Type: "entity", Kinds: []string{"work", "expression", "content_unit", "release", "medium"}, Enabled: true},
			"image":      {Names: names("示意图", "Image"), Type: "url", Enabled: true},
			"amount":     {Names: names("金额", "Amount"), Type: "number", Min: floatPtr(0), Enabled: true},
			"currency":   {Names: names("币种", "Currency"), Type: "text", Enabled: true},
			"source_url": {Names: names("来源链接", "Source link"), Type: "url", Enabled: true},
		}}
		d.Fields[k] = f
	}
	// 记录级动态模式：收录位置（locator）与收录/发行对象的附加属性。
	// 这些是**媒体差异最集中**的地方（书籍按页、音视频按时间码、文件按路径），
	// 因此不定义专用 Go 字段/数据库列，而是与其他字段同机制走 definitions，
	// 后台可增删子字段。种子值即历史硬编码的那几种定位方式，保证存量数据仍合法。
	//
	// semantics 声明子字段在对比中的语义（闭集，见 Field.Semantics）：
	// 页码/路径/章节是**本版定位**（同一正文换排版页数会变，不能据此判断内容变化）；
	// 时间码是**内容范围**（同一份录音的固定时长内的截取范围，长度变化即内容变化）。
	// 对比不再按字段名或区间长度猜测，只认这份声明。
	d.Fields["locator"] = Field{
		Names: names("定位", "Locator"), Type: "group", Enabled: true, Searchable: true, Comparable: true,
		AnchorKey: "relative_to",
		Fields: map[string]Field{
			"relative_to":   {Names: names("定位参照", "Relative to"), Type: "enum", Vocabulary: "locator_reference", Enabled: true, Semantics: "locating"},
			"page_start":    {Names: names("起始页", "Start page"), Type: "number", Min: floatPtr(1), Enabled: true, Semantics: "locating"},
			"page_end":      {Names: names("结束页", "End page"), Type: "number", Min: floatPtr(1), Enabled: true, Semantics: "locating", RangeStart: "page_start"},
			"time_start_ms": {Names: names("起始时间（毫秒）", "Start time (ms)"), Type: "number", Min: floatPtr(0), Enabled: true, Semantics: "content"},
			"time_end_ms":   {Names: names("结束时间（毫秒）", "End time (ms)"), Type: "number", Min: floatPtr(0), Enabled: true, Semantics: "content", RangeStart: "time_start_ms"},
			"path":          {Names: names("文件路径", "File path"), Type: "text", Enabled: true, Semantics: "locating"},
			"chapter":       {Names: names("章节", "Chapter"), Type: "text", Enabled: true, Semantics: "locating"},
		},
	}
	// 收录关系 / 发行对象的附加属性：默认不声明任何子字段（即不允许额外值），
	// 需要时在后台加子字段即刻生效——这就是"其余全部动态"的落点。
	d.Fields["inclusion_attributes"] = Field{Names: names("收录附加属性", "Inclusion attributes"), Type: "group", Enabled: true, Fields: map[string]Field{}}
	d.Fields["subject_attributes"] = Field{Names: names("发行对象附加属性", "Subject attributes"), Type: "group", Enabled: true, Fields: map[string]Field{}}
	// 作品展示分区：每个媒体场景各自声明，只列该场景真实会写、且用户会看的字段。
	// 全部为 definitions 里的动态字段；infobox 原始条目故意不进分区（仅存档与检索用）。
	// 若某场景写了分区未列的字段，WorkFacts 会在"其它信息"兜底展示，不会丢数据。
	commonSections := func(extra ...Section) []Section {
		return append(append([]Section{}, extra...),
			Section{Names: names("创作与权利", "Credits & rights"), Fields: []string{"author", "copyright", "imdb"}},
			Section{Names: names("首发与收录", "Premiere & inclusion"), Fields: []string{"edition_date", "events"}},
		)
	}
	for _, x := range []struct {
		code, zh, en string
		sections     []Section
	}{
		{"music", "音乐", "Music", commonSections(Section{Names: names("基本信息", "Basics"), Fields: []string{"language", "duration", "duration_source"}})},
		{"literature", "文学", "Literature", commonSections(Section{Names: names("基本信息", "Basics"), Fields: []string{"language", "volume_count", "magazine"}})},
		{"screen", "影视", "Screen", commonSections(
			Section{Names: names("基本信息", "Basics"), Fields: []string{"language", "episodes", "platform"}},
			Section{Names: names("放送信息", "Broadcast"), Fields: []string{"broadcast_start", "broadcast_weekday", "broadcast_end", "air_network"}},
		)},
		{"photography", "写真", "Photography", commonSections(Section{Names: names("基本信息", "Basics"), Fields: []string{"language", "volume_count"}})},
		{"game", "游戏", "Games", commonSections(Section{Names: names("基本信息", "Basics"), Fields: []string{"language", "platform", "episodes", "volume_count"}})},
		{"generic", "通用", "General", commonSections(Section{Names: names("基本信息", "Basics"), Fields: []string{"language", "duration"}})},
	} {
		d.Templates[x.code] = Template{Names: names(x.zh, x.en), Directory: "tree", Sections: x.sections,
			Columns: []string{"edition_date"}, RelationGroups: []string{"credits", "creative", "membership"}, PrimaryDateField: "edition_date", BadgeFields: []string{"platform", "episodes", "volume_count", "air_network"}}
	}
	// 作品类型可写的字段集：与所属模板分区声明的字段保持一致，避免"声明了却没权限写"。
	// 按媒体场景分别声明，而不是一份大字段集全类型共用——否则歌曲编辑页会出现
	// ISBN/出版社这类出版字段，制片信息也会出现在专辑上。
	// 归属原则：作品层只写"创作身份"（语言、时长、连载/放送信息、原始署名）；
	// 品番、条码、ISBN、发行日期、出版社等**具体产品标识**归 Release/Medium。
	commonWorkFields := []string{"language", "edition_date", "copyright", "imdb", "tags", "infobox", "events"}
	workFieldsByType := map[string][]string{
		// 音乐作品：时长、时长来源与词曲署名；专辑/歌曲不写出版与放送字段。
		"music": {"duration", "duration_source", "author"},
		"song":  {"duration", "duration_source", "author"},
		"album": {"duration", "duration_source", "author"},
		// 文学：卷数、连载杂志、原始署名文本。
		"novel": {"volume_count", "magazine", "author"},
		// 影视动画：话数、放送周期与电视台、平台。
		"animation": {"episodes", "platform", "broadcast_start", "broadcast_weekday", "broadcast_end", "air_network"},
		"film":      {"duration", "platform"},
		// 写真集：卷数 + 摄影署名（作者文本字段承载原始署名）。
		"photobook": {"volume_count", "author"},
		// 游戏：平台与话数/卷数均可能。
		"indie_game":   {"platform", "episodes"},
		"visual_novel": {"platform", "episodes", "volume_count"},
		"personal":     {"duration"},
	}
	for _, x := range [][4]string{{"music", "音乐作品", "Music work", "music"}, {"song", "歌曲", "Song", "music"}, {"album", "专辑", "Album", "music"}, {"novel", "小说", "Novel", "literature"}, {"animation", "动画", "Animation", "screen"}, {"film", "电影", "Film", "screen"}, {"photobook", "写真集", "Photobook", "photography"}, {"indie_game", "独立游戏", "Independent game", "game"}, {"visual_novel", "视觉小说", "Visual novel", "game"}, {"personal", "个人创作", "Personal creation", "generic"}} {
		// edition_date 用于承载作品首发/出版日期（列表与详情展示）；发行版自身的日期仍在 release.edition_date。
		fields := append(append([]string{}, workFieldsByType[x[0]]...), commonWorkFields...)
		d.Types[x[0]] = TypeDefinition{Names: names(x[1], x[2]), Kinds: []string{"work"}, Fields: fields, Template: x[3], Enabled: true}
	}
	for _, x := range [][3]string{{"person", "个人", "Person"}, {"organization", "组织", "Organization"}, {"group", "团体", "Group"}, {"character", "虚构角色", "Fictional character"}} {
		d.Types[x[0]] = TypeDefinition{Names: names(x[1], x[2]), Kinds: []string{"agent"}, Fields: []string{}, Template: "generic", Enabled: true}
	}
	for _, k := range []string{"collection", "content_unit", "expression", "release", "medium", "track"} {
		keys := []string{"language"}
		switch k {
		case "content_unit":
			// entry_role 记录篇目类型（本篇/OP/ED/预告）：集数编号在各类型间各自起算，
			// 不记录就无法区分"第1话"与"第1首片头曲"。
			keys = []string{"language", "entry_role"}
		case "expression":
			keys = []string{"language", "duration", "version_label", "isrc", "events"}
		case "release":
			keys = []string{"catalog_number", "barcode", "isbn", "edition_date", "edition_type", "edition_batch", "country", "publisher", "packaging", "distribution_channel", "platform", "attachments", "store_bonuses", "events"}
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
		en := map[string]string{"collection": "Collection", "content_unit": "Content unit", "expression": "Expression", "release": "Release", "medium": "Medium", "track": "Track"}[k]
		// 发行版有专用模板：其"属性分区"与"列表列"是发行这一媒体特有的编排，
		// 由模板声明（可在后台改），避免把 edition_type/country/packaging… 写进代码。
		tpl := "generic"
		if k == "release" {
			d.Templates["release"] = Template{
				Names: names("发行版", "Release"), Directory: "tree",
				Sections: []Section{
					{Names: names("版本信息", "Edition"), Fields: []string{"edition_type", "edition_batch", "edition_date", "country", "distribution_channel", "platform"}},
					{Names: names("载体与包装", "Carrier & packaging"), Fields: []string{"catalog_number", "barcode", "isbn", "packaging", "publisher"}},
					{Names: names("附加内容", "Extras"), Fields: []string{"attachments", "store_bonuses", "events"}},
				},
				Columns:          []string{"edition_type", "edition_batch", "country", "packaging", "catalog_number", "edition_date"},
				PrimaryDateField: "edition_date",
				BadgeFields:      []string{"edition_type", "edition_batch", "country"},
				FacetFields:      []string{"edition_type", "edition_batch", "format", "country"},
				RelationGroups:   []string{"credits", "creative", "membership"},
			}
			tpl = "release"
		}
		d.Types[k] = TypeDefinition{Names: names(zh, en), Kinds: []string{k}, Fields: keys, Template: tpl, Enabled: true}
	}
	addRel := func(code, zh, en, rzh, ren string, src, tgt []string, group string, acyclic bool) {
		d.Relations[code] = RelationDefinition{Names: names(zh, en), ReverseNames: names(rzh, ren), SourceKinds: src, TargetKinds: tgt, Fields: []string{"role", "credit_role", "context", "character", "language", "begin_date", "end_date", "scope"}, Group: group, GroupNames: names(map[string]string{"credits": "署名", "creative": "创作关系", "membership": "组成与成员"}[group], map[string]string{"credits": "Credits", "creative": "Creative relations", "membership": "Membership"}[group]), Acyclic: acyclic, Enabled: true}
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
	for _, x := range [][5]string{{"adaptation_of", "改编自", "Adaptation of", "被改编为", "Adapted as"}, {"sequel_of", "续作于", "Sequel of", "作为前作", "Prequel of"}, {"spin_off_of", "外传自", "Spin-off of", "衍生出", "Spun off as"}, {"soundtrack_of", "配乐用于", "Soundtrack of", "配乐作品", "Soundtrack"}} {
		addRel(x[0], x[1], x[2], x[3], x[4], []string{"work"}, []string{"work"}, "creative", true)
	}
	for _, x := range [][5]string{{"translation_of", "翻译自", "Translation of", "被翻译为", "Translated as"}, {"revision_of", "修订自", "Revision of", "被修订为", "Revised as"}, {"cover_of", "翻唱自", "Cover of", "被翻唱为", "Covered as"}, {"alternate_take_of", "别版取自", "Alternate take of", "被用作别版", "Used as alternate take"}} {
		addRel(x[0], x[1], x[2], x[3], x[4], []string{"expression"}, []string{"expression"}, "creative", true)
	}
	addRel("pressing_of", "再版自", "Pressing of", "被再版为", "Repressed as", []string{"release"}, []string{"release"}, "creative", true)
	addRel("bonus_included_in", "特典收录于", "Bonus included in", "收录特典", "Includes bonus", []string{"expression"}, []string{"release", "medium"}, "membership", true)
	addRel("store_bonus_for", "渠道特典归属", "Store bonus for", "拥有渠道特典", "Has store bonus", []string{"expression", "release"}, []string{"agent"}, "membership", true)
	addRel("includes", "组成包含", "Includes", "组成属于", "Included in", []string{"collection", "work"}, []string{"work", "collection"}, "membership", true)
	// 角色登场：虚构角色/团体 → 作品或集合。方向为 agent → work，
	// 同一角色跨作品算多条边（AGENTS.md 语义）。
	// 番位（主角/配角）目前用 credit_role（自由文本）承载：role 字段绑的是内容用途词表
	// （primary/supplement/side/extra/commentary），里面没有番位词项，写"main"会被判 invalid_term。
	// 若要结构化番位，应在后台为它单开一个词表，而不是借用 role。
	addRel("character_in", "角色登场", "Character in", "登场角色", "Characters in", []string{"agent"}, []string{"work", "collection"}, "credits", false)
	// 通用署名兜底：外部来源的职位文本没有贴切既有关系码时（分镜、企画、制作、
	// 制片人等），用它承载"谁参与了这部作品"，职位原文落在 credit_role。
	// 有精确关系码时不使用，避免同一署名重复两条边。
	addRel("credit_for", "参与制作", "Credited in", "署名人员", "Credits", []string{"work", "content_unit", "expression", "release"}, []string{"agent"}, "credits", false)
	// 译者关系：若默认信用关系里缺译者（translated_by 或等价）则补一个，
	// group=credits，翻译作品的译者署名不再挤进通用兜底。
	if _, ok := d.Relations["translated_by"]; !ok {
		hasTranslator := false
		for code := range d.Relations {
			if code == "translator_of" || code == "translate_by" {
				hasTranslator = true
				break
			}
		}
		if !hasTranslator {
			addRel("translated_by", "译者", "Translated by", "翻译了", "Translator of", []string{"work", "content_unit", "expression"}, []string{"agent"}, "credits", false)
		}
	}
	// 场景示例（纯示范，默认关闭，供后台按需启用或扩展）：黑胶上下文 locator 只收敛到唱片面相关子集。
	// 默认设为 Enabled: false，避免未经 Medium 介质格式细分前误伤其他媒体（如纸书页码、音视频时间码）。
	d.Schemes = map[string]Scheme{
		"vinyl_track_locator": {
			Names: names("黑胶定位", "Vinyl locator"), Slot: "locator",
			Kinds:   []string{"track"},
			Fields:  []string{"relative_to", "chapter", "path"},
			Enabled: false,
		},
	}
	return d
}
