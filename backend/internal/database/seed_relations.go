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

func ApplyPatches(db *gorm.DB) {
	applySchemaPatches(db)
	seedRelationTypes(db)
}
