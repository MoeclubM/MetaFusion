package catalog

// names builds bilingual names with reserved fallback keys.
//
// zh-CN/en-US are required by Definitions.Validate; zh-TW, ja and ja-JP carry
// the English text, so exact-locale and prefix lookups (ja-JP -> ja) resolve
// instead of falling through to an unrelated entry.
//
// 只给测试夹具用：种子定义必须走 names4，否则该条名称的繁中/日文就是英文占位，
// names_coverage_test 的棘轮（placeholderBudget = 0）会直接判失败。
func names(zh, en string) Names {
	return Names{"zh-CN": zh, "zh-TW": en, "ja": en, "ja-JP": en, "en-US": en}
}

// names4 builds names with explicit Traditional Chinese and Japanese text.
// zh-TW 用台湾常用译法、ja 用日语业界惯用说法；四语都是真实译文时才保证不留英文占位。
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

// fieldSeed 是字段种子的声明形状：四语名称（names4）+ 字段类型。
// 种子名不写死中英两语：缺 zh-TW/ja 时用户看到的是英文占位。
type fieldSeed struct {
	code  string
	typ   string
	names Names
}

// termSeed 是词表项的声明形状：四语名称（names4）。
type termSeed struct {
	code  string
	names Names
}

// typeSeed 是类型的声明形状：四语名称（names4）+ 归属展示模板。
type typeSeed struct {
	code     string
	names    Names
	template string
}

// relSeed 是一条关系的声明形状：关系码 + 正向名 + 反向名（均为四语 names4）。
type relSeed struct {
	code  string
	names Names
	rev   Names
}

func Defaults() Definitions {
	// 结构归属规则：哪些层级要挂上级、字段码指向哪些层级、是否必填、候选按哪个上级字段过滤。
	// 校验（validation.go）与前端编辑器共用这一份，前端不再自己写死"expression 挂在 work 下"。
	// TargetKinds 为空表示同层父节点（同域父节点）；Resources 表示该层级可挂资源文件。
	d := Definitions{Types: map[string]TypeDefinition{}, Fields: map[string]Field{}, Vocabularies: map[string]Vocabulary{},
		Structure: map[string]StructureRule{
			// 发行版没有上级，但有"发行对象"；收录位置额外有"收录内容"。两者都属于「所属与收录结构」，
			// 在这里声明后，前端不必再写死"只有 release 才有发行对象/只有 track 才有收录内容"。
			"release":      {Subjects: true},
			"content_unit": {Fields: []StructureField{{Code: "work_id", TargetKinds: []string{"work"}, Required: true}, {Code: "parent_id", ScopedBy: "work_id"}}},
			"expression":   {Fields: []StructureField{{Code: "work_id", TargetKinds: []string{"work"}, Required: true}, {Code: "content_unit_id", TargetKinds: []string{"content_unit"}, ScopedBy: "work_id"}}, Resources: true},
			"medium":       {Fields: []StructureField{{Code: "release_id", TargetKinds: []string{"release"}, Required: true}, {Code: "parent_id", ScopedBy: "release_id"}}, Resources: true},
			"track":        {Fields: []StructureField{{Code: "medium_id", TargetKinds: []string{"medium"}, Required: true}, {Code: "parent_id", ScopedBy: "medium_id"}}, Resources: true, Contents: true},
		},
		Relations: map[string]RelationDefinition{}, Templates: map[string]Template{}}
	field := func(code, typ string, n Names) {
		d.Fields[code] = Field{Names: n, Type: typ, Enabled: true, Searchable: true, Comparable: true}
	}
	for _, x := range []fieldSeed{
		{"catalog_number", "text", names4("品番", "唱片編號", "品番", "Catalog number")},
		{"barcode", "text", names4("条码 / ISBN", "條碼 / ISBN", "バーコード / ISBN", "Barcode / ISBN")},
		{"isbn", "text", names4("ISBN", "國際標準書號", "国際標準図書番号", "ISBN")},
		{"edition_date", "date", names4("发行日期", "發行日期", "発売日", "Release date")},
		{"country", "text", names4("发行地区", "發行地區", "発売地域", "Territory")},
		{"language", "text", names4("内容语言", "內容語言", "内容言語", "Content language")},
		{"duration", "number", names4("时长（秒）", "時長（秒）", "再生時間（秒）", "Duration (seconds)")},
		{"version_label", "text", names4("表达版本", "表達版本", "バージョン表記", "Expression version")},
		{"format", "enum", names4("载体格式", "載體格式", "メディア形式", "Medium format")},
		{"packaging", "enum", names4("包装", "包裝", "パッケージ", "Packaging")},
		{"edition_type", "enum", names4("版本类别", "版本類別", "版種別", "Edition category")},
		{"edition_batch", "enum", names4("发行批次", "發行批次", "発売区分", "Edition batch")},
		{"distribution_channel", "enum", names4("发行渠道", "發行通路", "流通チャネル", "Distribution channel")},
		{"platform", "text", names4("平台", "平台", "プラットフォーム", "Platform")},
		{"episodes", "number", names4("话数", "話數", "話数", "Episodes")},
		{"volume_count", "number", names4("卷数", "卷數", "巻数", "Volumes")},
		{"broadcast_start", "date", names4("放送开始", "放送開始", "放送開始", "Broadcast start")},
		{"broadcast_weekday", "text", names4("放送星期", "放送星期", "放送曜日", "Broadcast weekday")},
		{"broadcast_end", "date", names4("放送结束", "放送結束", "放送終了", "Broadcast end")},
		{"air_network", "text", names4("放送电视台", "放送電視台", "放送局", "Broadcast network")},
		{"copyright", "text", names4("版权标示", "版權標示", "権利表記", "Copyright")},
		{"author", "text", names4("作者", "作者", "作者", "Author")},
		{"magazine", "text", names4("连载杂志", "連載雜誌", "掲載誌", "Magazine")},
		{"imdb", "text", names4("IMDb", "IMDb 編號", "IMDb ID", "IMDb")},
		{"isrc", "text", names4("ISRC", "國際標準錄音代碼", "国際標準レコーディングコード", "ISRC")},
		{"role", "enum", names4("内容用途", "內容用途", "収録役割", "Content role")},
		{"entry_role", "enum", names4("篇目类型", "篇目類型", "収録種別", "Entry role")},
		// air_date 是**篇目级**放送日（逐话首播）：作品层的 broadcast_start 是整季开播日，
		// 两者层级不同；官网故事页不给逐话日期时由 Bangumi 单集条目补（不猜）。
		{"air_date", "date", names4("放送日期", "放送日期", "放送日", "Air date")},
		{"credit_role", "text", names4("署名职位", "署名職位", "クレジット表記", "Credit role")},
		{"character", "entity", names4("所饰角色", "所飾角色", "役名", "Character")},
		{"context", "entity", names4("适用作品或篇目", "適用作品或篇目", "対象作品・篇目", "Context")},
		{"begin_date", "date", names4("开始日期", "開始日期", "開始日", "Begin date")},
		{"end_date", "date", names4("结束日期", "結束日期", "終了日", "End date")},
		{"scope", "text", names4("适用范围说明", "適用範圍說明", "適用範囲の説明", "Scope description")},
		{"publisher", "entity", names4("发行主体", "發行主體", "発売元", "Publisher")},
		{"attachments", "list", names4("包装附件", "包裝附件", "同梱物", "Package attachments")},
		{"store_bonuses", "list", names4("渠道特典", "通路特典", "店舗特典", "Retailer bonuses")},
		{"events", "list", names4("发布与放送事件", "發布與放送事件", "発売・放送イベント", "Release and broadcast events")},
	} {
		field(x.code, x.typ, x.names)
	}
	// 标签：值域开放（上游标签随作品而定），故为字符串列表而非受控词表；
	// 存于 attributes.tags，按容器包含（@>）过滤——结构基线为该 JSON 路径
	// 建了函数 GIN 索引，保证按标签检索走索引而非全表扫描。
	// Hidden：详情页有专用标签区块，不再进信息面板，避免与 JSON 原文重复。
	d.Fields["tags"] = Field{Names: names4("标签", "標籤", "タグ", "Tags"), Type: "list", Enabled: true, Searchable: true, Hidden: true, Items: &Field{Names: names4("标签", "標籤", "タグ", "Tag"), Type: "text", Enabled: true}}
	// infobox 原始条目：上游资料表的完整快照，保留键值原文以便追溯与后续映射。
	// Hidden：仅供检索与存档，不进信息面板，避免把不规范的键名直接暴露给用户。
	d.Fields["infobox"] = Field{Names: names4("资料表原始条目", "資料表原始條目", "インフォボックス原文", "Raw infobox entries"), Type: "list", Enabled: true, Searchable: true, Hidden: true,
		Items: &Field{Names: names4("条目", "條目", "項目", "Entry"), Type: "group", Enabled: true, Fields: map[string]Field{
			"key":   {Names: names4("键", "鍵", "キー", "Key"), Type: "text", Required: true, Enabled: true},
			"value": {Names: names4("值", "值", "値", "Value"), Type: "text", Required: true, Enabled: true},
		}}}
	// country/region 保持 text 而未收敛为词表：取值是开放集合（地区代码、
	// 渠道/店铺名、放送地区），硬编码词表会阻塞编目。前端显示时优先查
	// 对应词表（distribution_channel 等），无词表命中则原样显示，不虚构映射。
	// 待 taxonomy 落定后再收敛为词表或格式校验，目前仅以字段说明约束。
	for _, x := range []struct {
		code  string
		names Names
		terms []termSeed
	}{
		{"format", names4("载体格式", "載體格式", "メディア形式", "Medium formats"), []termSeed{
			{"cd", names4("CD", "CD（雷射唱片）", "CD（コンパクトディスク）", "CD")},
			{"bd", names4("蓝光", "藍光", "ブルーレイ", "Blu-ray")},
			{"uhd_bd", names4("超高清蓝光", "超高畫質藍光", "Ultra HD ブルーレイ", "Ultra HD Blu-ray")},
			{"dvd", names4("DVD", "DVD（數位影音光碟）", "DVD（デジタル多用途ディスク）", "DVD")},
			{"vinyl", names4("黑胶", "黑膠", "アナログ盤", "Vinyl")},
			{"sacd", names4("SACD", "SACD（超級音頻光碟）", "SACD（スーパーオーディオCD）", "SACD")},
			{"cassette", names4("磁带", "磁帶", "カセットテープ", "Cassette")},
			{"paper", names4("纸质册", "紙質冊", "紙媒体", "Printed volume")},
			{"digital", names4("数字文件集", "數位檔案集", "デジタルファイル", "Digital collection")},
			{"web", names4("网络配信", "網路配信", "ネット配信", "Web distribution")},
		}},
		{"packaging", names4("包装", "包裝", "パッケージ", "Packaging"), []termSeed{
			{"standard", names4("标准包装", "標準包裝", "標準仕様", "Standard")},
			{"jewel", names4("Jewel Case", "CD 珠寶盒", "ジュエルケース", "Jewel case")},
			{"slipcase", names4("腰封 / 外封套", "外封套 / 書腰", "スリップケース", "Slipcase")},
			{"box", names4("盒装", "盒裝", "箱入り", "Box")},
			{"boxset", names4("套盒", "套盒", "ボックスセット", "Box set")},
			{"digipak", names4("Digipak", "紙盒裝", "デジパック", "Digipak")},
		}},
		{"role", names4("内容用途", "內容用途", "収録役割", "Content roles"), []termSeed{
			{"primary", names4("主要内容", "主要內容", "メイン", "Primary")},
			{"supplement", names4("附加内容", "附加內容", "特典", "Supplement")},
			{"side", names4("唱片面", "唱片面", "面", "Side")},
			{"extra", names4("额外收录", "額外收錄", "追加収録", "Extra")},
			{"commentary", names4("解说音轨", "解說音軌", "解説音声", "Commentary")},
		}},
		// 篇目类型：区分本篇与 OP/ED/预告等附加篇目。集数编号在本篇与 OP 各自从 1 起算，
		// 仅凭编号/标题无法区分，必须单独记录。
		{"entry_role", names4("篇目类型", "篇目類型", "収録種別", "Entry roles"), []termSeed{
			{"main", names4("本篇", "本篇", "本篇", "Main")},
			{"opening", names4("片头曲", "片頭曲", "オープニング", "Opening")},
			{"ending", names4("片尾曲", "片尾曲", "エンディング", "Ending")},
			{"trailer", names4("预告 / 宣传", "預告 / 宣傳", "予告・特報", "Trailer")},
			{"extra", names4("其它附加", "其它附加", "その他の特典", "Extra")},
			{"other", names4("其它", "其它", "その他", "Other")},
		}},
		{"release_role", names4("发行对象用途", "發行對象用途", "対象作品の用途", "Release subject roles"), []termSeed{
			{"primary", names4("主作品", "主作品", "メイン作品", "Primary")},
			{"compilation", names4("汇编作品", "合輯作品", "コンピレーション", "Compilation")},
			{"supplement", names4("附加作品", "附加作品", "特典作品", "Supplement")},
		}},
		// 版本维度按"可同时成立"拆开：类别（普通/限定/豪华/套盒）、批次（通常/初回/再版/重印）
		// 是各自独立的维度，地区归 country、渠道归 distribution_channel。
		// 原先把限定/初回/地区/再版/数字塞进一个互斥枚举，导致"日本初回限定再版"
		// 这类真实组合无法表达——只能三选一，丢掉另外两个维度。
		{"edition_type", names4("版本类别", "版本類別", "版種別", "Edition categories"), []termSeed{
			{"standard", names4("普通版", "普通版", "通常版", "Standard edition")},
			{"limited", names4("限定版", "限定版", "限定版", "Limited edition")},
			{"deluxe", names4("豪华版", "豪華版", "デラックス版", "Deluxe edition")},
			{"boxset", names4("套盒", "套盒", "ボックスセット", "Box set")},
		}},
		{"edition_batch", names4("发行批次", "發行批次", "発売区分", "Edition batches"), []termSeed{
			{"regular", names4("通常发行", "通常發行", "通常盤", "Regular release")},
			{"first_press", names4("初回发行", "初回發行", "初回盤", "First press")},
			{"reissue", names4("再版 / 重发", "再版 / 重發", "再発", "Reissue")},
			{"reprint", names4("重印", "重印", "重版", "Reprint")},
		}},
		{"distribution_channel", names4("发行渠道", "發行通路", "流通チャネル", "Distribution channels"), []termSeed{
			{"mixed", names4("混合", "混合", "併用", "Mixed")},
			{"physical", names4("实体", "實體", "フィジカル", "Physical")},
			{"digital", names4("数字", "數位", "デジタル", "Digital")},
			{"web", names4("网络配信", "網路配信", "配信", "Web distribution")},
		}},
		{"locator_reference", names4("定位参照", "定位參照", "位置の基準", "Locator reference"), []termSeed{
			{"track", names4("整条音轨", "整條音軌", "トラック全体", "Whole track")},
			{"medium", names4("整张载体", "整張載體", "メディア全体", "Whole medium")},
		}},
	} {
		v := Vocabulary{Names: x.names, Terms: map[string]Term{}}
		for _, t := range x.terms {
			v.Terms[t.code] = Term{Names: t.names, Enabled: true}
		}
		d.Vocabularies[x.code] = v
	}
	for _, k := range []string{"format", "packaging", "role", "edition_type", "edition_batch", "distribution_channel", "entry_role", "character_rank"} {
		f := d.Fields[k]
		f.Vocabulary = k
		d.Fields[k] = f
	}
	// 角色番位：此前借用 credit_role 自由文本，导致"主角/配角"既不可检索、也无法多语言
	// （各语种各写各的）。改成词表后，"这部作品的主角有谁""这个角色在别处是什么番位"都能查。
	// 四语名显式给出：番位词表不进上面的批量表，单独在此声明，避免英文占位。
	d.Fields["character_rank"] = Field{Names: names4("角色番位", "角色番位", "役割", "Character rank"), Type: "enum", Vocabulary: "character_rank", Enabled: true, Searchable: true, Comparable: true}
	d.Vocabularies["character_rank"] = Vocabulary{
		Names: names4("角色番位", "角色番位", "役割", "Character ranks"),
		Terms: map[string]Term{
			"main":       {Names: names4("主角", "主角", "主人公", "Main"), Enabled: true},
			"supporting": {Names: names4("配角", "配角", "脇役", "Supporting"), Enabled: true},
			"guest":      {Names: names4("客串 / 单集登场", "客串 / 單集登場", "ゲスト", "Guest"), Enabled: true},
			"ensemble":   {Names: names4("群像", "群像", "群像", "Ensemble"), Enabled: true},
			"narrator":   {Names: names4("旁白", "旁白", "ナレーター", "Narrator"), Enabled: true},
			"cameo":      {Names: names4("彩蛋登场", "彩蛋登場", "カメオ", "Cameo"), Enabled: true},
		},
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
	d.Fields["duration_source"] = Field{Names: names4("时长来源", "時長來源", "再生時間の参照元", "Duration source"), Type: "entity", Kinds: []string{"expression"}, Enabled: true}
	for _, k := range []string{"attachments", "store_bonuses", "events"} {
		f := d.Fields[k]
		f.Items = &Field{Names: names4("记录", "記錄", "レコード", "Record"), Type: "group", Enabled: true, Fields: map[string]Field{
			"label":     {Names: names4("说明", "說明", "説明", "Description"), Type: "multilingual", Required: true, Enabled: true},
			"quantity":  {Names: names4("数量", "數量", "数量", "Quantity"), Type: "number", Enabled: true},
			"date":      {Names: names4("日期", "日期", "日付", "Date"), Type: "date", Enabled: true},
			"channel":   {Names: names4("渠道 / 平台", "通路 / 平台", "流通 / プラットフォーム", "Channel / platform"), Type: "text", Enabled: true},
			"region":    {Names: names4("地区", "地區", "地域", "Region"), Type: "text", Enabled: true},
			"time_zone": {Names: names4("时区", "時區", "タイムゾーン", "Time zone"), Type: "text", Enabled: true},
			"condition": {Names: names4("批次 / 随机规则 / 条件", "批次 / 隨機規則 / 條件", "ロット / 抽選ルール / 条件", "Batch / random rule / condition"), Type: "text", Enabled: true},
			// 渠道特典与发行事件进一步结构化的落点（全部走 definitions，
			// 不加硬编码列）：店铺/发行主体、随附内容引用、示意图、售价与来源。
			// store 是实体引用（零售店/出版社等 Agent）；content 引用随附的
			// 作品/表达（特典 CD 里的实际内容不能只剩"赠 CD"三个字）。
			"store":      {Names: names4("店铺 / 发行主体", "店鋪 / 發行主體", "店舗 / 発売元", "Store / distributor"), Type: "entity", Kinds: []string{"agent"}, Enabled: true},
			"content":    {Names: names4("随附内容", "隨附內容", "同梱内容", "Included content"), Type: "entity", Kinds: []string{"work", "expression", "content_unit", "release", "medium"}, Enabled: true},
			"image":      {Names: names4("示意图", "示意圖", "参考画像", "Image"), Type: "url", Enabled: true},
			"amount":     {Names: names4("金额", "金額", "金額", "Amount"), Type: "number", Min: floatPtr(0), Enabled: true},
			"currency":   {Names: names4("币种", "幣別", "通貨", "Currency"), Type: "text", Enabled: true},
			"source_url": {Names: names4("来源链接", "來源連結", "出典リンク", "Source link"), Type: "url", Enabled: true},
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
		Names: names4("定位", "定位", "位置情報", "Locator"), Type: "group", Enabled: true, Searchable: true, Comparable: true,
		AnchorKey: "relative_to",
		Fields: map[string]Field{
			"relative_to":   {Names: names4("定位参照", "定位參照", "位置の基準", "Relative to"), Type: "enum", Vocabulary: "locator_reference", Enabled: true, Semantics: "locating"},
			"page_start":    {Names: names4("起始页", "起始頁", "開始ページ", "Start page"), Type: "number", Min: floatPtr(1), Enabled: true, Semantics: "locating"},
			"page_end":      {Names: names4("结束页", "結束頁", "終了ページ", "End page"), Type: "number", Min: floatPtr(1), Enabled: true, Semantics: "locating", RangeStart: "page_start"},
			"time_start_ms": {Names: names4("起始时间（毫秒）", "起始時間（毫秒）", "開始時間（ミリ秒）", "Start time (ms)"), Type: "number", Min: floatPtr(0), Enabled: true, Semantics: "content"},
			"time_end_ms":   {Names: names4("结束时间（毫秒）", "結束時間（毫秒）", "終了時間（ミリ秒）", "End time (ms)"), Type: "number", Min: floatPtr(0), Enabled: true, Semantics: "content", RangeStart: "time_start_ms"},
			"path":          {Names: names4("文件路径", "檔案路徑", "ファイルパス", "File path"), Type: "text", Enabled: true, Semantics: "locating"},
			"chapter":       {Names: names4("章节", "章節", "章", "Chapter"), Type: "text", Enabled: true, Semantics: "locating"},
		},
	}
	// 收录关系 / 发行对象的附加属性：默认不声明任何子字段（即不允许额外值），
	// 需要时在后台加子字段即刻生效——这就是"其余全部动态"的落点。
	d.Fields["inclusion_attributes"] = Field{Names: names4("收录附加属性", "收錄附加屬性", "収録属性", "Inclusion attributes"), Type: "group", Enabled: true, Fields: map[string]Field{}}
	d.Fields["subject_attributes"] = Field{Names: names4("发行对象附加属性", "發行對象附加屬性", "対象作品の属性", "Subject attributes"), Type: "group", Enabled: true, Fields: map[string]Field{}}
	// 作品展示分区：每个媒体场景各自声明，只列该场景真实会写、且用户会看的字段。
	// 全部为 definitions 里的动态字段；infobox 原始条目故意不进分区（仅存档与检索用）。
	// 若某场景写了分区未列的字段，WorkFacts 会在"其它信息"兜底展示，不会丢数据。
	commonSections := func(extra ...Section) []Section {
		return append(append([]Section{}, extra...),
			Section{Names: names4("创作与权利", "創作與權利", "制作・権利", "Credits & rights"), Fields: []string{"author", "copyright", "imdb"}},
			Section{Names: names4("首发与收录", "首發與收錄", "初出・収録", "Premiere & inclusion"), Fields: []string{"edition_date", "events"}},
		)
	}
	for _, x := range []struct {
		code     string
		names    Names
		sections []Section
	}{
		{"music", names4("音乐", "音樂", "音楽", "Music"), commonSections(Section{Names: names4("基本信息", "基本資訊", "基本情報", "Basics"), Fields: []string{"language", "duration", "duration_source"}})},
		{"literature", names4("文学", "文學", "文学", "Literature"), commonSections(Section{Names: names4("基本信息", "基本資訊", "基本情報", "Basics"), Fields: []string{"language", "volume_count", "magazine"}})},
		{"screen", names4("影视", "影視", "映像", "Screen"), commonSections(
			Section{Names: names4("基本信息", "基本資訊", "基本情報", "Basics"), Fields: []string{"language", "episodes", "platform"}},
			Section{Names: names4("放送信息", "放送資訊", "放送情報", "Broadcast"), Fields: []string{"broadcast_start", "broadcast_weekday", "broadcast_end", "air_network"}},
		)},
		{"photography", names4("写真", "寫真", "写真", "Photography"), commonSections(Section{Names: names4("基本信息", "基本資訊", "基本情報", "Basics"), Fields: []string{"language", "volume_count"}})},
		{"game", names4("游戏", "遊戲", "ゲーム", "Games"), commonSections(Section{Names: names4("基本信息", "基本資訊", "基本情報", "Basics"), Fields: []string{"language", "platform", "episodes", "volume_count"}})},
		{"generic", names4("通用", "通用", "汎用", "General"), commonSections(Section{Names: names4("基本信息", "基本資訊", "基本情報", "Basics"), Fields: []string{"language", "duration"}})},
	} {
		d.Templates[x.code] = Template{Names: x.names, Directory: "tree", Sections: x.sections,
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
	for _, x := range []typeSeed{
		{"music", names4("音乐作品", "音樂作品", "音楽作品", "Music work"), "music"},
		{"song", names4("歌曲", "歌曲", "楽曲", "Song"), "music"},
		{"album", names4("专辑", "專輯", "アルバム", "Album"), "music"},
		{"novel", names4("小说", "小說", "小説", "Novel"), "literature"},
		{"animation", names4("动画", "動畫", "アニメーション", "Animation"), "screen"},
		{"film", names4("电影", "電影", "映画", "Film"), "screen"},
		{"photobook", names4("写真集", "寫真集", "写真集", "Photobook"), "photography"},
		{"indie_game", names4("独立游戏", "獨立遊戲", "インディーゲーム", "Independent game"), "game"},
		{"visual_novel", names4("视觉小说", "視覺小說", "ビジュアルノベル", "Visual novel"), "game"},
		{"personal", names4("个人创作", "個人創作", "個人制作", "Personal creation"), "generic"},
	} {
		// edition_date 用于承载作品首发/出版日期（列表与详情展示）；发行版自身的日期仍在 release.edition_date。
		fields := append(append([]string{}, workFieldsByType[x.code]...), commonWorkFields...)
		d.Types[x.code] = TypeDefinition{Names: x.names, Kinds: []string{"work"}, Fields: fields, Template: x.template, Enabled: true}
	}
	for _, x := range []typeSeed{
		{"person", names4("个人", "個人", "個人", "Person"), "generic"},
		{"organization", names4("组织", "組織", "組織", "Organization"), "generic"},
		{"group", names4("团体", "團體", "グループ", "Group"), "generic"},
		{"character", names4("虚构角色", "虛構角色", "架空のキャラクター", "Fictional character"), "generic"},
	} {
		d.Types[x.code] = TypeDefinition{Names: x.names, Kinds: []string{"agent"}, Fields: []string{}, Template: x.template, Enabled: true}
	}
	// 骨架类型的显示名：四语齐备，与 KindNames()/Kinds 对齐，不再按 zh/en 两语构造。
	kindTypeNames := map[string]Names{
		"collection":   names4("集合", "集合", "コレクション", "Collection"),
		"content_unit": names4("内容单元", "內容單元", "コンテンツ単位", "Content unit"),
		"expression":   names4("内容表达", "內容表達", "内容表現", "Expression"),
		"release":      names4("发行版", "發行版", "リリース", "Release"),
		"medium":       names4("载体", "載體", "メディア", "Medium"),
		"track":        names4("收录位置", "收錄位置", "収録位置", "Track"),
	}

	for _, k := range []string{"collection", "content_unit", "expression", "release", "medium", "track"} {
		keys := []string{"language"}
		switch k {
		case "content_unit":
			// entry_role 记录篇目类型（本篇/OP/ED/预告）：集数编号在各类型间各自起算，
			// 不记录就无法区分"第1话"与"第1首片头曲"。
			// air_date 记录该篇目自身的放送日：集数编号相同但放送日期不同的话数靠它区分。
			keys = []string{"language", "entry_role", "air_date"}
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
		// 发行版有专用模板：其"属性分区"与"列表列"是发行这一媒体特有的编排，
		// 由模板声明（可在后台改），避免把 edition_type/country/packaging… 写进代码。
		tpl := "generic"
		if k == "release" {
			d.Templates["release"] = Template{
				Names: names4("发行版", "發行版", "リリース", "Release"), Directory: "tree",
				Sections: []Section{
					{Names: names4("版本信息", "版本資訊", "版情報", "Edition"), Fields: []string{"edition_type", "edition_batch", "edition_date", "country", "distribution_channel", "platform"}},
					{Names: names4("载体与包装", "載體與包裝", "メディア・パッケージ", "Carrier & packaging"), Fields: []string{"catalog_number", "barcode", "isbn", "packaging", "publisher"}},
					{Names: names4("附加内容", "附加內容", "特典・同梱物", "Extras"), Fields: []string{"attachments", "store_bonuses", "events"}},
				},
				Columns:          []string{"edition_type", "edition_batch", "country", "packaging", "catalog_number", "edition_date"},
				PrimaryDateField: "edition_date",
				BadgeFields:      []string{"edition_type", "edition_batch", "country"},
				FacetFields:      []string{"edition_type", "edition_batch", "format", "country"},
				RelationGroups:   []string{"credits", "creative", "membership"},
			}
			tpl = "release"
		}
		d.Types[k] = TypeDefinition{Names: kindTypeNames[k], Kinds: []string{k}, Fields: keys, Template: tpl, Enabled: true}
	}
	// 关系分组名：credits/creative/membership 三组，四语齐备（前端按组折叠展示）。
	groupNames := map[string]Names{
		"credits":    names4("署名", "署名", "クレジット", "Credits"),
		"creative":   names4("创作关系", "創作關係", "創作関連", "Creative relations"),
		"membership": names4("组成与成员", "組成與成員", "構成とメンバー", "Membership"),
	}

	addRel := func(code string, n, rev Names, src, tgt []string, group string, acyclic bool) {
		d.Relations[code] = RelationDefinition{Names: n, ReverseNames: rev, SourceKinds: src, TargetKinds: tgt, Fields: []string{"role", "credit_role", "character_rank", "context", "character", "language", "begin_date", "end_date", "scope"}, Group: group, GroupNames: groupNames[group], Acyclic: acyclic, Enabled: true}
	}
	for _, x := range []relSeed{
		{"created_by", names4("创作者", "創作者", "作者", "Created by"), names4("创作了", "創作了", "制作した", "Creator of")},
		{"performed_by", names4("表演者", "表演者", "歌唱・演奏", "Performed by"), names4("表演了", "表演了", "歌唱・演奏した", "Performer of")},
		{"photographed_by", names4("摄影者", "攝影者", "撮影", "Photographed by"), names4("拍摄了", "拍攝了", "撮影した", "Photographer of")},
		{"modeled_by", names4("出镜者", "出鏡者", "モデル", "Modeled by"), names4("出镜于", "出鏡於", "出演した", "Model in")},
		{"developed_by", names4("开发者", "開發者", "開発", "Developed by"), names4("开发了", "開發了", "開発した", "Developer of")},
		{"voiced_by", names4("配音者", "配音者", "声優", "Voiced by"), names4("配音于", "配音於", "声を担当した", "Voice actor in")},
	} {
		addRel(x.code, x.names, x.rev, []string{"work", "content_unit", "expression", "release"}, []string{"agent"}, "credits", false)
	}
	// 分媒介署名关系：音乐（作曲/作词/编曲）、影视与动画（导演/编剧）、书籍（插画/朗读）。
	// 均为 agent 目标、group=credits，后台 DefinitionsEditor 可继续增删改。
	for _, x := range []struct {
		code  string
		names Names
		rev   Names
		src   []string
	}{
		{"composed_by", names4("作曲者", "作曲者", "作曲", "Composed by"), names4("作曲了", "作曲了", "作曲した", "Composer of"), []string{"work", "content_unit", "expression"}},
		{"lyricist_of", names4("作词者", "作詞者", "作詞", "Lyricist of"), names4("作词了", "作詞了", "作詞した", "Lyricist for"), []string{"work", "content_unit", "expression"}},
		{"arranged_by", names4("编曲者", "編曲者", "編曲", "Arranged by"), names4("编曲了", "編曲了", "編曲した", "Arranger of"), []string{"work", "expression"}},
		{"directed_by", names4("导演", "導演", "監督", "Directed by"), names4("执导了", "執導了", "監督した", "Director of"), []string{"work", "content_unit"}},
		{"written_by", names4("编剧", "編劇", "脚本", "Written by"), names4("编写了", "編寫了", "脚本を書いた", "Writer of"), []string{"work", "content_unit"}},
		{"illustrated_by", names4("插画者", "插畫者", "イラスト", "Illustrated by"), names4("绘制了", "繪製了", "イラストを描いた", "Illustrator of"), []string{"work", "content_unit", "release"}},
		{"narrated_by", names4("朗读 / 旁白", "朗讀 / 旁白", "ナレーション", "Narrated by"), names4("朗读了", "朗讀了", "ナレーションを担当した", "Narrator of"), []string{"expression", "release"}},
	} {
		addRel(x.code, x.names, x.rev, x.src, []string{"agent"}, "credits", false)
	}
	for _, x := range []relSeed{
		{"adaptation_of", names4("改编自", "改編自", "翻案", "Adaptation of"), names4("被改编为", "被改編為", "翻案された", "Adapted as")},
		{"sequel_of", names4("续作于", "續作於", "続編", "Sequel of"), names4("作为前作", "作為前作", "前作", "Prequel of")},
		{"spin_off_of", names4("外传自", "外傳自", "スピンオフ", "Spin-off of"), names4("衍生出", "衍生出", "スピンオフ作品", "Spun off as")},
		{"soundtrack_of", names4("配乐用于", "配樂用於", "サウンドトラック", "Soundtrack of"), names4("配乐作品", "配樂作品", "劇中音楽", "Soundtrack")},
	} {
		addRel(x.code, x.names, x.rev, []string{"work"}, []string{"work"}, "creative", true)
	}
	for _, x := range []relSeed{
		{"translation_of", names4("翻译自", "翻譯自", "翻訳", "Translation of"), names4("被翻译为", "被翻譯為", "翻訳された", "Translated as")},
		{"revision_of", names4("修订自", "修訂自", "改訂", "Revision of"), names4("被修订为", "被修訂為", "改訂された", "Revised as")},
		{"cover_of", names4("翻唱自", "翻唱自", "カバー", "Cover of"), names4("被翻唱为", "被翻唱為", "カバーされた", "Covered as")},
		{"alternate_take_of", names4("别版取自", "別版取自", "別テイク", "Alternate take of"), names4("被用作别版", "被用作別版", "別テイクとして使用", "Used as alternate take")},
	} {
		addRel(x.code, x.names, x.rev, []string{"expression"}, []string{"expression"}, "creative", true)
	}
	addRel("pressing_of", names4("再版自", "再版自", "復刻", "Pressing of"), names4("被再版为", "被再版為", "復刻された", "Repressed as"), []string{"release"}, []string{"release"}, "creative", true)
	addRel("bonus_included_in", names4("特典收录于", "特典收錄於", "特典として収録", "Bonus included in"), names4("收录特典", "收錄特典", "特典を収録", "Includes bonus"), []string{"expression"}, []string{"release", "medium"}, "membership", true)
	addRel("store_bonus_for", names4("渠道特典归属", "通路特典歸屬", "店舗特典", "Store bonus for"), names4("拥有渠道特典", "擁有通路特典", "店舗特典を保有", "Has store bonus"), []string{"expression", "release"}, []string{"agent"}, "membership", true)
	addRel("includes", names4("组成包含", "組成包含", "収録", "Includes"), names4("组成属于", "組成屬於", "収録先", "Included in"), []string{"collection", "work"}, []string{"work", "collection"}, "membership", true)
	// 组成/聚合关系：声明 Aggregate，页面据此把它算作"组成作品"而不写死关系码。
	// 必须写在 addRel("includes", …) **之后**——写在前面时该关系还没进 map，永远设不上。
	if r, ok := d.Relations["includes"]; ok {
		r.Aggregate = true
		d.Relations["includes"] = r
	}
	// 成员关系：个人 ↔ 团体（乐队、组合、社团）。声优乐队这类现实团体需要
	// "谁是这个团体的成员"，职位原文（Vo./Gt./Ba. 等）落在 credit_role，不另造字段。
	addRel("member_of", names4("所属团体", "所屬團體", "所属グループ", "Member of"), names4("成员", "成員", "メンバー", "Members"), []string{"agent"}, []string{"agent"}, "membership", true)
	// 角色登场：虚构角色/团体 → 作品或集合。方向为 agent → work，
	// 同一角色跨作品算多条边（AGENTS.md 语义）。
	// 番位走 character_rank 词表（main/supporting/guest/ensemble/narrator/cameo）：可检索、可多语言。
	// 不再借 credit_role —— 那是"来源里的职位原文"，混用会导致番位既不可查也不能翻译。
	addRel("character_in", names4("角色登场", "角色登場", "登場", "Character in"), names4("登场角色", "登場角色", "登場キャラクター", "Characters in"), []string{"agent"}, []string{"work", "collection"}, "credits", false)
	// 通用署名兜底：外部来源的职位文本没有贴切既有关系码时（分镜、企画、制作、
	// 制片人等），用它承载"谁参与了这部作品"，职位原文落在 credit_role。
	// 有精确关系码时不使用，避免同一署名重复两条边。
	addRel("credit_for", names4("参与制作", "參與製作", "クレジット", "Credited in"), names4("署名人员", "署名人員", "クレジット担当", "Credits"), []string{"work", "content_unit", "expression", "release"}, []string{"agent"}, "credits", false)
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
			addRel("translated_by", names4("译者", "譯者", "翻訳者", "Translated by"), names4("翻译了", "翻譯了", "翻訳した", "Translator of"), []string{"work", "content_unit", "expression"}, []string{"agent"}, "credits", false)
		}
	}
	// 场景示例（纯示范，默认关闭，供后台按需启用或扩展）：黑胶上下文 locator 只收敛到唱片面相关子集。
	// 默认设为 Enabled: false，避免未经 Medium 介质格式细分前误伤其他媒体（如纸书页码、音视频时间码）。
	d.Schemes = map[string]Scheme{
		"vinyl_track_locator": {
			Names: names4("黑胶定位", "黑膠定位", "アナログ盤の位置情報", "Vinyl locator"), Slot: "locator",
			Kinds:   []string{"track"},
			Fields:  []string{"relative_to", "chapter", "path"},
			Enabled: false,
		},
	}
	return d
}
