package database

import (
	"github.com/lib/pq"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func seedRelationTypes(db *gorm.DB) {
	rows := []models.RelationType{
		{
			Code: "part_of_franchise", Domain: "work_franchise",
			NameZh: "企划归属", NameEn: "Part of Franchise",
			Names: models.JSONB{"zh-CN": "企划归属", "en-US": "Part of Franchise"},
			Description: "作品、子企划或主体归属于某跨媒介企划/世界观",
			ForwardLabelZh: "属于企划", ReverseLabelZh: "企划包含",
			ForwardLabelEn: "is part of franchise", ReverseLabelEn: "contains",
			AllowedSourceTypes: pq.StringArray{"work", "franchise", "artist", "person", "group", "fictional_band", "virtual_character", "label", "studio", "publisher", "circle"},
			AllowedTargetTypes: pq.StringArray{"franchise"},
			IsHierarchical: true, Color: "indigo", Icon: "Layers", SortOrder: 306, IsSystem: true, IsEnabled: true,
		},
		{
			Code: "unofficial_of", Domain: "work_work",
			NameZh: "非官方 / 同人衍生", NameEn: "Unofficial Of",
			Names: models.JSONB{"zh-CN": "非官方衍生", "en-US": "Unofficial Of"},
			Description: "网络上传、未出版或同人作品相对于官方作品",
			ForwardLabelZh: "为该作的非官方衍生", ReverseLabelZh: "拥有非官方衍生",
			ForwardLabelEn: "is unofficial of", ReverseLabelEn: "has unofficial derivative",
			AllowedSourceTypes: pq.StringArray{"work"}, AllowedTargetTypes: pq.StringArray{"work"},
			Color: "rose", Icon: "GitFork", SortOrder: 335, IsSystem: true, IsEnabled: true,
		},
		{
			Code: "imprint_of", Domain: "agent_franchise",
			NameZh: "企划子厂牌 / 品牌", NameEn: "Imprint Of",
			Names: models.JSONB{"zh-CN": "企划子厂牌", "en-US": "Imprint Of"},
			Description: "音乐厂牌或子品牌隶属于某跨媒介企划",
			ForwardLabelZh: "为该企划的厂牌/品牌", ReverseLabelZh: "旗下厂牌",
			ForwardLabelEn: "is imprint of", ReverseLabelEn: "has imprint",
			AllowedSourceTypes: pq.StringArray{"label", "publisher", "studio", "artist"},
			AllowedTargetTypes: pq.StringArray{"franchise"},
			IsHierarchical: true, Color: "teal", Icon: "Disc", SortOrder: 55, IsSystem: true, IsEnabled: true,
		},
		{
			Code: "alternate_form_of", Domain: "agent_agent",
			NameZh: "角色变体 / 形态", NameEn: "Alternate Form Of",
			Names: models.JSONB{"zh-CN": "角色变体", "en-US": "Alternate Form Of"},
			Description: "同一角色的不同形态",
			ForwardLabelZh: "为该角色的变体", ReverseLabelZh: "拥有变体形态",
			ForwardLabelEn: "is alternate form of", ReverseLabelEn: "has alternate form",
			AllowedSourceTypes: pq.StringArray{"virtual_character"}, AllowedTargetTypes: pq.StringArray{"virtual_character"},
			Color: "purple", Icon: "Sparkles", SortOrder: 37, IsSystem: true, IsEnabled: true,
		},
		{
			Code: "crossover_with", Domain: "work_work",
			NameZh: "跨界联动", NameEn: "Crossover With",
			Names: models.JSONB{"zh-CN": "跨界联动", "en-US": "Crossover With"},
			Description: "作品或企划之间的联动活动",
			ForwardLabelZh: "联动于", ReverseLabelZh: "联动于",
			ForwardLabelEn: "crossovers with", ReverseLabelEn: "crossovers with",
			AllowedSourceTypes: pq.StringArray{"work", "franchise"}, AllowedTargetTypes: pq.StringArray{"work", "franchise"},
			IsSymmetric: true, Color: "amber", Icon: "Handshake", SortOrder: 336, IsSystem: true, IsEnabled: true,
		},
		{
			Code: "creator_of", Domain: "agent_franchise",
			NameZh: "世界观原作 / 创企划", NameEn: "Creator Of Franchise",
			Names: models.JSONB{"zh-CN": "创企划", "en-US": "Creator Of"},
			Description: "作者或团队创立可被衍生的世界观/企划",
			ForwardLabelZh: "创立了企划", ReverseLabelZh: "企划原作为",
			ForwardLabelEn: "created franchise", ReverseLabelEn: "was created by",
			AllowedSourceTypes: pq.StringArray{"person", "group", "studio", "circle", "artist"},
			AllowedTargetTypes: pq.StringArray{"franchise"},
			Color: "emerald", Icon: "Award", SortOrder: 38, IsSystem: true, IsEnabled: true,
		},
		{
			Code: "included_in", Domain: "work_work",
			NameZh: "收录于", NameEn: "Included In",
			Names: models.JSONB{"zh-CN": "收录于", "en-US": "Included In"},
			Description: "单曲或曲目母版被专辑/合集收录",
			ForwardLabelZh: "收录于", ReverseLabelZh: "收录了",
			ForwardLabelEn: "is included in", ReverseLabelEn: "includes",
			AllowedSourceTypes: pq.StringArray{"work", "canonical_entry"}, AllowedTargetTypes: pq.StringArray{"work"},
			Color: "cyan", Icon: "Disc", SortOrder: 337, IsSystem: true, IsEnabled: true,
		},
		{
			Code: "expansion_of", Domain: "work_work",
			NameZh: "资料片 / 扩展", NameEn: "Expansion Of",
			Names: models.JSONB{"zh-CN": "资料片", "en-US": "Expansion Of"},
			Description: "独立发售的 DLC/资料片相对于本体作品",
			ForwardLabelZh: "为该作的资料片", ReverseLabelZh: "拥有资料片",
			ForwardLabelEn: "is expansion of", ReverseLabelEn: "has expansion",
			AllowedSourceTypes: pq.StringArray{"work"}, AllowedTargetTypes: pq.StringArray{"work"},
			Color: "sky", Icon: "PackagePlus", SortOrder: 338, IsSystem: true, IsEnabled: true,
		},
	}
	for _, row := range rows {
		_ = db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "code"}},
			UpdateAll: true,
		}).Create(&row).Error
	}
	_ = db.Model(&models.RelationType{}).Where("code = ?", "member_of").Updates(map[string]interface{}{
		"allowed_source_types": pq.StringArray{"person", "virtual_character"},
		"allowed_target_types": pq.StringArray{"group", "orchestra", "studio", "circle", "publisher", "fictional_band"},
	}).Error
	_ = db.Model(&models.RelationType{}).Where("code = ?", "character_in").Updates(map[string]interface{}{
		"allowed_source_types": pq.StringArray{"virtual_character"},
		"allowed_target_types": pq.StringArray{"work", "franchise"},
	}).Error
	_ = db.Model(&models.RelationType{}).Where("code = ?", "collaborates_with").Updates(map[string]interface{}{
		"allowed_source_types": pq.StringArray{"person", "group", "orchestra", "studio", "publisher", "circle", "label", "fictional_band", "virtual_character"},
		"allowed_target_types": pq.StringArray{"person", "group", "orchestra", "studio", "publisher", "circle", "label", "fictional_band", "virtual_character"},
	}).Error
	_ = db.Exec(`UPDATE relation_types SET attribute_schema = $1::jsonb, updated_at = NOW() WHERE code = 'voice_actor_of'`,
		`[{"key": "locale", "type": "string", "label": "配音语种"}, {"key": "region", "type": "string", "label": "地区"}, {"key": "character_name", "type": "string", "label": "角色全名"}, {"key": "is_original_cast", "type": "boolean", "label": "初代/原案声优"}]`).Error
	_ = db.Model(&models.RelationType{}).Where("code = ?", "producer").Updates(map[string]interface{}{
		"allowed_source_types": pq.StringArray{"person", "studio", "publisher", "label"},
	}).Error
	_ = db.Model(&models.RelationType{}).Where("code = ?", "performer").Updates(map[string]interface{}{
		"allowed_source_types": pq.StringArray{"person", "group", "orchestra", "label", "fictional_band"},
	}).Error
	_ = db.Model(&models.RelationType{}).Where("code = ?", "member_of").Updates(map[string]interface{}{
		"allowed_source_types": pq.StringArray{"person", "virtual_character"},
		"allowed_target_types": pq.StringArray{"group", "orchestra", "studio", "circle", "publisher", "fictional_band"},
	}).Error
}

func seedExternalDatabaseDefinitions(db *gorm.DB) {
	defs := []models.ExternalDatabaseDefinition{
		{
			Code: "wikipedia", NameZh: "维基百科", NameEn: "Wikipedia",
			Names: models.JSONB{"zh-CN": "维基百科", "en-US": "Wikipedia", "ja": "ウィキペディア"},
			Category: "all", URLPattern: "https://zh.wikipedia.org/wiki/{id}",
			Icon: "Globe", ValidationRegex: "",
			Description: "全球多语言自由百科全书（填词条标题或完整 URL）",
			SortOrder: 10, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "wikidata", NameZh: "维基数据", NameEn: "Wikidata",
			Names: models.JSONB{"zh-CN": "维基数据", "en-US": "Wikidata"},
			Category: "all", URLPattern: "https://www.wikidata.org/wiki/{id}",
			Icon: "Database", ValidationRegex: `^Q\d+$`,
			Description: "维基媒体结构化知识图谱实体项 (如 Q11303)",
			SortOrder: 20, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "musicbrainz", NameZh: "MusicBrainz", NameEn: "MusicBrainz",
			Names: models.JSONB{"zh-CN": "MusicBrainz", "en-US": "MusicBrainz"},
			Category: "all", URLPattern: "https://musicbrainz.org/release-group/{id}",
			Icon: "Disc3", ValidationRegex: `^[0-9a-fA-F\-]{36}$`,
			Description: "开放音乐元数据百科全书 (MBID UUID)",
			SortOrder: 30, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "discogs", NameZh: "Discogs", NameEn: "Discogs",
			Names: models.JSONB{"zh-CN": "Discogs", "en-US": "Discogs"},
			Category: "all", URLPattern: "https://www.discogs.com/master/{id}",
			Icon: "Disc", ValidationRegex: `^\d+$`,
			Description: "全球权威黑胶与实体唱片数据库 (Master/Release ID)",
			SortOrder: 40, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "vgmdb", NameZh: "VGMdb", NameEn: "VGMdb",
			Names: models.JSONB{"zh-CN": "VGMdb", "en-US": "VGMdb"},
			Category: "all", URLPattern: "https://vgmdb.net/album/{id}",
			Icon: "Music2", ValidationRegex: `^\d+$`,
			Description: "电子游戏与动漫原声音乐专题数据库",
			SortOrder: 50, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "spotify", NameZh: "Spotify", NameEn: "Spotify",
			Names: models.JSONB{"zh-CN": "Spotify", "en-US": "Spotify"},
			Category: "all", URLPattern: "https://open.spotify.com/album/{id}",
			Icon: "PlayCircle", ValidationRegex: `^[0-9A-Za-z]{22}$`,
			Description: "全球流媒体音乐服务平台 (Album / Artist ID)",
			SortOrder: 60, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "apple_music", NameZh: "Apple Music", NameEn: "Apple Music",
			Names: models.JSONB{"zh-CN": "Apple Music", "en-US": "Apple Music"},
			Category: "all", URLPattern: "https://music.apple.com/album/{id}",
			Icon: "Apple", ValidationRegex: `^\d+$`,
			Description: "苹果音乐数字专辑与创作者页面",
			SortOrder: 70, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "imdb", NameZh: "IMDb", NameEn: "IMDb",
			Names: models.JSONB{"zh-CN": "IMDb 互联网电影资料库", "en-US": "IMDb"},
			Category: "work", URLPattern: "https://www.imdb.com/title/{id}/",
			Icon: "Film", ValidationRegex: `^tt\d+$`,
			Description: "全球权威互联网电影资料库 (如 tt0816692 / nm0000001)",
			SortOrder: 80, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "tmdb", NameZh: "TMDB", NameEn: "The Movie Database",
			Names: models.JSONB{"zh-CN": "TMDB 影视数据库", "en-US": "The Movie Database"},
			Category: "work", URLPattern: "https://www.themoviedb.org/movie/{id}",
			Icon: "Clapperboard", ValidationRegex: `^\d+$`,
			Description: "开放社区影视元数据与海报媒体库",
			SortOrder: 90, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "douban_movie", NameZh: "豆瓣电影", NameEn: "Douban Movie",
			Names: models.JSONB{"zh-CN": "豆瓣电影", "en-US": "Douban Movie"},
			Category: "work", URLPattern: "https://movie.douban.com/subject/{id}/",
			Icon: "Tv", ValidationRegex: `^\d+$`,
			Description: "中文影视与文化评论社区 (条目 ID)",
			SortOrder: 100, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "bangumi", NameZh: "Bangumi 番组计划", NameEn: "Bangumi",
			Names: models.JSONB{"zh-CN": "Bangumi 番组计划", "en-US": "Bangumi"},
			Category: "all", URLPattern: "https://bgm.tv/subject/{id}",
			Icon: "Tv2", ValidationRegex: `^\d+$`,
			Description: "中文 ACG 二次元动画/漫画/游戏/音乐条目索引",
			SortOrder: 110, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "vndb", NameZh: "VNDB 视觉小说数据库", NameEn: "Visual Novel Database",
			Names: models.JSONB{"zh-CN": "VNDB 视觉小说数据库", "en-US": "VNDB"},
			Category: "work", URLPattern: "https://vndb.org/v{id}",
			Icon: "BookHeart", ValidationRegex: `^v?\d+$`,
			Description: "全球权威视觉小说条目数据库 (如 v17)",
			SortOrder: 120, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "steam", NameZh: "Steam", NameEn: "Steam",
			Names: models.JSONB{"zh-CN": "Steam 游戏商店", "en-US": "Steam"},
			Category: "work", URLPattern: "https://store.steampowered.com/app/{id}",
			Icon: "Gamepad2", ValidationRegex: `^\d+$`,
			Description: "Valve 旗下一体化数字游戏分发与社群平台 (App ID)",
			SortOrder: 130, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "anilist", NameZh: "AniList", NameEn: "AniList",
			Names: models.JSONB{"zh-CN": "AniList", "en-US": "AniList"},
			Category: "all", URLPattern: "https://anilist.co/anime/{id}",
			Icon: "Sparkles", ValidationRegex: `^\d+$`,
			Description: "现代动画与漫画社交追踪数据库",
			SortOrder: 140, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "goodreads", NameZh: "Goodreads", NameEn: "Goodreads",
			Names: models.JSONB{"zh-CN": "Goodreads", "en-US": "Goodreads"},
			Category: "work", URLPattern: "https://www.goodreads.com/book/show/{id}",
			Icon: "BookOpen", ValidationRegex: `^\d+.*$`,
			Description: "全球读者书评与阅读记录平台",
			SortOrder: 150, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "douban_book", NameZh: "豆瓣读书", NameEn: "Douban Book",
			Names: models.JSONB{"zh-CN": "豆瓣读书", "en-US": "Douban Book"},
			Category: "work", URLPattern: "https://book.douban.com/subject/{id}/",
			Icon: "Book", ValidationRegex: `^\d+$`,
			Description: "中文书籍条目与读书笔记社区",
			SortOrder: 160, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "isbndb", NameZh: "ISBNdb", NameEn: "ISBNdb",
			Names: models.JSONB{"zh-CN": "ISBNdb 国际标准书号库", "en-US": "ISBNdb"},
			Category: "release", URLPattern: "https://isbndb.com/book/{id}",
			Icon: "Barcode", ValidationRegex: `^[0-9\-]{10,17}$`,
			Description: "国际标准书号全球注册库 (ISBN-10 / ISBN-13)",
			SortOrder: 170, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "isni", NameZh: "ISNI 国际标准名称标识", NameEn: "ISNI",
			Names: models.JSONB{"zh-CN": "ISNI 国际标准名称标识", "en-US": "ISNI"},
			Category: "artist", URLPattern: "https://isni.org/isni/{id}",
			Icon: "UserCheck", ValidationRegex: `^\d{15}[\dX]$`,
			Description: "ISO 国际标准名称标识符 (16 位数字或 X)",
			SortOrder: 180, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "orcid", NameZh: "ORCID 学术学者标识", NameEn: "ORCID",
			Names: models.JSONB{"zh-CN": "ORCID 学者标识", "en-US": "ORCID"},
			Category: "artist", URLPattern: "https://orcid.org/{id}",
			Icon: "GraduationCap", ValidationRegex: `^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$`,
			Description: "全球科研人员与学者开放唯一标识符",
			SortOrder: 190, IsEnabled: true, IsSystem: true,
		},
		{
			Code: "twitter_x", NameZh: "X (Twitter)", NameEn: "X (Twitter)",
			Names: models.JSONB{"zh-CN": "X (原 Twitter)", "en-US": "X (Twitter)"},
			Category: "artist", URLPattern: "https://x.com/{id}",
			Icon: "AtSign", ValidationRegex: `^[A-Za-z0-9_]{1,15}$`,
			Description: "官方社交媒体账号 ID",
			SortOrder: 200, IsEnabled: true, IsSystem: true,
		},
	}
	for _, def := range defs {
		_ = db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "code"}},
			DoUpdates: clause.AssignmentColumns([]string{"name_zh", "name_en", "names", "category", "url_pattern", "icon", "validation_regex", "description", "sort_order", "is_system"}),
		}).Create(&def).Error
	}
}

func ApplyPatches(db *gorm.DB) {
	applySchemaPatches(db)
	seedRelationTypes(db)
	seedExternalDatabaseDefinitions(db)
}
