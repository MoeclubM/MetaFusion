package database

import (
	"encoding/json"
	"log"
	"strings"

	"github.com/lib/pq"
	"gorm.io/gorm"
)

// applySchemaPatches runs idempotent ALTERs so existing volumes pick up schema
// that AutoMigrate cannot express (CHECK drops, unique rebuilds).
func applySchemaPatches(db *gorm.DB) {
	migrateHardClassificationToTags(db)
	restoreSeedShelfQueryTagsIfClobbered(db)
	migrateCarrierTagsOffWorks(db)
	migrateLegacyExternalIDs(db)
	migrateMultilingualJSONBFields(db)

	stmts := []string{
		`ALTER TABLE virtual_shelves ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE virtual_shelves ADD COLUMN IF NOT EXISTS descriptions JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE user_custom_shelves ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE user_custom_shelves ADD COLUMN IF NOT EXISTS descriptions JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE forum_boards ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE forum_boards ADD COLUMN IF NOT EXISTS descriptions JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE entity_type_definitions ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE relation_types ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE external_database_definitions ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS qualifier VARCHAR(64) NOT NULL DEFAULT ''`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS country VARCHAR(64) DEFAULT ''`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS language VARCHAR(64) DEFAULT ''`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS distribution_channel VARCHAR(32) DEFAULT 'mixed' NOT NULL`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS catalog_metadata JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS external_ids JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE works ALTER COLUMN category_code DROP NOT NULL`,
		`ALTER TABLE works ALTER COLUMN category_code SET DEFAULT ''`,
		`ALTER TABLE works ADD COLUMN IF NOT EXISTS external_ids JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE artists ADD COLUMN IF NOT EXISTS language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL`,
		`ALTER TABLE franchises ADD COLUMN IF NOT EXISTS language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL`,
		`ALTER TABLE works ADD COLUMN IF NOT EXISTS cover_aspect VARCHAR(8) DEFAULT '' NOT NULL`,
		`ALTER TABLE system_plugins ADD COLUMN IF NOT EXISTS dependencies JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE works ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE artists ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE mediums ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE franchises ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE canonical_entries ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_custom_shelves_owner_slug ON user_custom_shelves(owner_id, slug)`,
		`CREATE INDEX IF NOT EXISTS idx_works_external_ids_gin ON works USING GIN (external_ids)`,
		`CREATE INDEX IF NOT EXISTS idx_releases_external_ids_gin ON releases USING GIN (external_ids)`,
		`CREATE INDEX IF NOT EXISTS idx_works_attributes_gin ON works USING GIN (attributes)`,
		`CREATE INDEX IF NOT EXISTS idx_artists_attributes_gin ON artists USING GIN (attributes)`,
		`CREATE INDEX IF NOT EXISTS idx_releases_attributes_gin ON releases USING GIN (attributes)`,
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			log.Printf("schema patch skipped: %v", err)
		}
	}

	_ = db.Exec(`
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'artists'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%entity_type%'
    LOOP
        EXECUTE format('ALTER TABLE artists DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
EXCEPTION WHEN OTHERS THEN NULL;
END $$`).Error

	_ = db.Exec(`
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_artists_entity_type') THEN
        ALTER TABLE artists ADD CONSTRAINT fk_artists_entity_type
            FOREIGN KEY (entity_type) REFERENCES entity_type_definitions(code)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$`).Error

	_ = db.Exec(`
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'entity_relationships'::regclass AND contype = 'u'
    LOOP
        EXECUTE format('ALTER TABLE entity_relationships DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
EXCEPTION WHEN OTHERS THEN NULL;
END $$`).Error

	_ = db.Exec(`
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'entity_relationships_edge_unique' AND conrelid = 'entity_relationships'::regclass
    ) THEN
        ALTER TABLE entity_relationships ADD CONSTRAINT entity_relationships_edge_unique
            UNIQUE (source_type, source_id, target_type, target_id, relationship_type, qualifier);
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$`).Error
}

func columnExists(db *gorm.DB, table, col string) bool {
	var n int64
	_ = db.Raw(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`, table, col).Scan(&n).Error
	return n > 0
}

// formatTagsForLegacyMediaCode maps leftover works.media_type / shelf media_type
// onto existing format tags (游戏/动画/专辑/电影…). Aggregates only used when a
// shelf has no query_tags yet.
func formatTagsForLegacyMediaCode(code, nameZh string) []string {
	code = strings.TrimSpace(strings.ToLower(code))
	seen := map[string]bool{}
	out := make([]string, 0, 4)
	add := func(names ...string) {
		for _, n := range names {
			n = strings.TrimSpace(n)
			if n == "" || seen[n] {
				continue
			}
			seen[n] = true
			out = append(out, n)
		}
	}
	if nameZh != "" {
		add(nameZh)
	}
	switch code {
	case "movie":
		add("电影")
	case "tv_series":
		add("剧集")
	case "anime":
		add("动画")
	case "music":
		add("专辑")
	case "audiobook":
		add("有声书")
	case "novel":
		add("图书")
	case "comic":
		add("漫画")
	case "gallery":
		add("画集")
	case "game":
		add("游戏")
	case "podcast":
		add("播客")
	case "software":
		add("软件")
	case "performance":
		add("现场演出")
	case "video":
		add("电影", "剧集", "动画")
	case "audio":
		add("音乐", "专辑", "有声书")
	case "text":
		add("图书")
	case "graphic":
		add("漫画", "画集")
	}
	return out
}

func ensureFormatTag(db *gorm.DB, name string) {
	name = strings.TrimSpace(name)
	if name == "" {
		return
	}
	_ = db.Exec(`INSERT INTO tags (name, group_type, category_scope) VALUES (?, 'format', '{}') ON CONFLICT (name) DO NOTHING`, name).Error
}

func mergeTagNames(existing []string, extra []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(existing)+len(extra))
	for _, n := range append(existing, extra...) {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}

// migrateHardClassificationToTags copies works.media_type / shelf media_type
// into work_tag_relations / query_tags, then drops those columns.
func migrateHardClassificationToTags(db *gorm.DB) {
	worksHas := columnExists(db, "works", "media_type")
	shelfHas := columnExists(db, "virtual_shelves", "media_type")
	customHas := columnExists(db, "user_custom_shelves", "media_type")
	if !worksHas && !shelfHas && !customHas {
		return
	}

	nameByCode := map[string]string{}
	if columnExists(db, "media_types", "code") {
		type mtRow struct {
			Code   string
			NameZh string
		}
		var rows []mtRow
		_ = db.Raw(`SELECT code, name_zh FROM media_types`).Scan(&rows).Error
		for _, r := range rows {
			nameByCode[strings.ToLower(r.Code)] = r.NameZh
		}
	}

	if worksHas {
		type workRow struct {
			ID        string
			MediaType string
		}
		var works []workRow
		_ = db.Raw(`SELECT id::text AS id, media_type FROM works WHERE media_type IS NOT NULL AND btrim(media_type) <> '' AND media_type <> 'all'`).Scan(&works).Error
		for _, w := range works {
			for _, tagName := range formatTagsForLegacyMediaCode(w.MediaType, nameByCode[strings.ToLower(w.MediaType)]) {
				ensureFormatTag(db, tagName)
				_ = db.Exec(`INSERT INTO work_tag_relations (work_id, tag_id) SELECT ?::uuid, id FROM tags WHERE name = ? ON CONFLICT DO NOTHING`, w.ID, tagName).Error
			}
		}
	}

	shelfOK := true
	if shelfHas {
		if err := migrateShelfQueryTags(db, "virtual_shelves", "slug", nameByCode); err != nil {
			log.Printf("virtual_shelves media_type tag copy failed: %v", err)
			shelfOK = false
		}
	}
	customOK := true
	if customHas {
		if err := migrateShelfQueryTags(db, "user_custom_shelves", "id", nameByCode); err != nil {
			log.Printf("user_custom_shelves media_type tag copy failed: %v", err)
			customOK = false
		}
	}

	drops := []string{
		`ALTER TABLE works DROP CONSTRAINT IF EXISTS fk_works_media_type`,
		`DROP INDEX IF EXISTS idx_works_media_type`,
		`ALTER TABLE works DROP COLUMN IF EXISTS media_type`,
	}
	if shelfOK {
		drops = append(drops, `ALTER TABLE virtual_shelves DROP COLUMN IF EXISTS media_type`)
	}
	if customOK {
		drops = append(drops, `ALTER TABLE user_custom_shelves DROP COLUMN IF EXISTS media_type`)
	}
	for _, s := range drops {
		if err := db.Exec(s).Error; err != nil {
			log.Printf("media_type drop skipped: %v", err)
		}
	}
	log.Printf("migrated hard classification columns to tags")
}

func decodeJSONStringArray(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

func migrateShelfQueryTags(db *gorm.DB, table, idCol string, nameByCode map[string]string) error {
	if !columnExists(db, table, "media_type") || !columnExists(db, table, "query_tags") {
		return nil
	}
	type shelfRow struct {
		ID        string
		MediaType string
		QueryTags string
	}
	var rows []shelfRow
	if err := db.Raw(`SELECT `+idCol+`::text AS id, media_type, COALESCE(array_to_json(query_tags), '[]')::text AS query_tags FROM `+table+` WHERE media_type IS NOT NULL AND btrim(media_type) <> '' AND media_type <> 'all'`).Scan(&rows).Error; err != nil {
		return err
	}
	for _, r := range rows {
		existing := decodeJSONStringArray(r.QueryTags)
		mt := strings.ToLower(strings.TrimSpace(r.MediaType))
		extra := formatTagsForLegacyMediaCode(mt, nameByCode[mt])
		isAgg := mt == "video" || mt == "audio" || mt == "text" || mt == "graphic"
		if isAgg && len(existing) > 0 {
			continue
		}
		merged := mergeTagNames(existing, extra)
		if len(merged) == len(existing) {
			same := true
			for i := range merged {
				if merged[i] != existing[i] {
					same = false
					break
				}
			}
			if same {
				continue
			}
		}
		for _, n := range merged {
			ensureFormatTag(db, n)
		}
		if err := db.Exec(`UPDATE `+table+` SET query_tags = ? WHERE `+idCol+`::text = ?`, pq.Array(merged), r.ID).Error; err != nil {
			return err
		}
	}
	return nil
}

type seedShelfQuerySpec struct {
	Slug    string
	Seed    []string
	Clobber []string
}

// restoreSeedShelfQueryTagsIfClobbered undoes a prior bug: GORM failed to scan
// TEXT[] query_tags as empty, then aggregate media_type (video/audio/text/graphic)
// overwrote curated shelf tags. Only rewrites rows that still match the clobber.
func restoreSeedShelfQueryTagsIfClobbered(db *gorm.DB) {
	if !columnExists(db, "virtual_shelves", "query_tags") {
		return
	}
	video := []string{"电影", "剧集", "动画"}
	audio := []string{"音乐", "专辑", "有声书"}
	text := []string{"图书"}
	graphic := []string{"漫画", "画集"}
	specs := []seedShelfQuerySpec{
		{Slug: "movies", Seed: []string{"电影", "长片"}, Clobber: video},
		{Slug: "anime-movies", Seed: []string{"电影", "动画"}, Clobber: video},
		{Slug: "feature-films", Seed: []string{"电影", "实拍"}, Clobber: video},
		{Slug: "doc-films", Seed: []string{"电影", "纪录"}, Clobber: video},
		{Slug: "series", Seed: []string{"剧集", "连续剧"}, Clobber: video},
		{Slug: "anime-series", Seed: []string{"剧集", "动画"}, Clobber: video},
		{Slug: "live-series", Seed: []string{"剧集", "实拍"}, Clobber: video},
		{Slug: "music", Seed: []string{"音乐", "专辑", "原声"}, Clobber: audio},
		{Slug: "soundtracks", Seed: []string{"原声"}, Clobber: audio},
		{Slug: "classical", Seed: []string{"古典"}, Clobber: audio},
		{Slug: "audiobooks", Seed: []string{"广播剧", "有声书"}, Clobber: audio},
		{Slug: "books", Seed: []string{"图书", "小说", "名著"}, Clobber: text},
		{Slug: "scifi-books", Seed: []string{"科幻"}, Clobber: text},
		{Slug: "literature-books", Seed: []string{"文学", "名著"}, Clobber: text},
		{Slug: "comics", Seed: []string{"漫画", "画集", "设定集"}, Clobber: graphic},
		{Slug: "manga", Seed: []string{"漫画"}, Clobber: graphic},
		{Slug: "artbooks", Seed: []string{"画集", "设定集"}, Clobber: graphic},
	}
	restored := 0
	for _, spec := range specs {
		res := db.Exec(`UPDATE virtual_shelves SET query_tags = ? WHERE slug = ? AND query_tags = ?`, pq.Array(spec.Seed), spec.Slug, pq.Array(spec.Clobber))
		if res.Error != nil {
			log.Printf("restore virtual_shelves %s: %v", spec.Slug, res.Error)
		} else {
			restored += int(res.RowsAffected)
		}
		if columnExists(db, "user_custom_shelves", "query_tags") {
			res = db.Exec(`UPDATE user_custom_shelves SET query_tags = ? WHERE slug = ? AND query_tags = ?`, pq.Array(spec.Seed), spec.Slug, pq.Array(spec.Clobber))
			if res.Error != nil {
				log.Printf("restore user_custom_shelves %s: %v", spec.Slug, res.Error)
				continue
			}
			restored += int(res.RowsAffected)
		}
	}
	if restored > 0 {
		log.Printf("restored %d clobbered shelf query_tags from seed", restored)
	}
}

func stripCarrierNamesFromTextArray(db *gorm.DB, table, column string) {
	_ = db.Exec(`
UPDATE `+table+` AS s
SET `+column+` = COALESCE((
	SELECT ARRAY_AGG(x)
	FROM unnest(s.`+column+`) AS x
	WHERE x NOT IN (SELECT name FROM tags WHERE group_type = 'spec')
), '{}')
WHERE EXISTS (
	SELECT 1 FROM unnest(s.`+column+`) AS x
	JOIN tags t ON t.name = x AND t.group_type = 'spec'
)`).Error
}

// migrateCarrierTagsOffWorks strips group_type=spec tags from works/franchises/shelves.
// 规格 is Release/Medium/AssetFile metadata, not a tag; leftover spec rows stay unused.
func migrateCarrierTagsOffWorks(db *gorm.DB) {
	_ = db.Exec(`DELETE FROM work_tag_relations WHERE tag_id IN (SELECT id FROM tags WHERE group_type = 'spec')`).Error
	_ = db.Exec(`DELETE FROM franchise_tag_relations WHERE tag_id IN (SELECT id FROM tags WHERE group_type = 'spec')`).Error
	_ = db.Exec(`DROP TABLE IF EXISTS release_tag_relations`).Error

	if columnExists(db, "virtual_shelves", "query_tags") {
		stripCarrierNamesFromTextArray(db, "virtual_shelves", "query_tags")
		stripCarrierNamesFromTextArray(db, "virtual_shelves", "exclude_tags")
	}
	if columnExists(db, "user_custom_shelves", "query_tags") {
		stripCarrierNamesFromTextArray(db, "user_custom_shelves", "query_tags")
		stripCarrierNamesFromTextArray(db, "user_custom_shelves", "exclude_tags")
	}

	_ = db.Exec(`DELETE FROM virtual_shelves WHERE slug = 'special-hires'`).Error
	_ = db.Exec(`DELETE FROM user_custom_shelves WHERE slug = 'special-hires'`).Error
	_ = db.Exec(`DELETE FROM tag_translations WHERE tag_id IN (SELECT id FROM tags WHERE group_type = 'spec')`).Error
	_ = db.Exec(`DELETE FROM tags WHERE group_type = 'spec'`).Error
	_ = db.Exec(`
UPDATE user_home_layouts
SET order_json = COALESCE((
	SELECT jsonb_agg(elem)
	FROM jsonb_array_elements_text(order_json) AS elem
	WHERE elem <> 'special-hires'
), '[]'::jsonb)
WHERE order_json @> '["special-hires"]'::jsonb`).Error
}

func migrateLegacyExternalIDs(db *gorm.DB) {
	if columnExists(db, "works", "external_ids") && columnExists(db, "works", "catalog_metadata") {
		_ = db.Exec(`
			UPDATE works
			SET external_ids = catalog_metadata->'external_ids'
			WHERE (external_ids = '{}'::jsonb OR external_ids IS NULL)
			  AND catalog_metadata ? 'external_ids'
			  AND jsonb_typeof(catalog_metadata->'external_ids') = 'object'
			  AND catalog_metadata->'external_ids' <> '{}'::jsonb
		`).Error
	}
	if columnExists(db, "releases", "external_ids") && columnExists(db, "releases", "catalog_metadata") {
		_ = db.Exec(`
			UPDATE releases
			SET external_ids = catalog_metadata->'external_ids'
			WHERE (external_ids = '{}'::jsonb OR external_ids IS NULL)
			  AND catalog_metadata ? 'external_ids'
			  AND jsonb_typeof(catalog_metadata->'external_ids') = 'object'
			  AND catalog_metadata->'external_ids' <> '{}'::jsonb
		`).Error
	}
}

// migrateMultilingualJSONBFields scans legacy name_zh / name_en columns and populates names JSONB with clean UTF-8
func migrateMultilingualJSONBFields(db *gorm.DB) {
	// 修复 virtual_shelves 默认多语言及乱码
	type shelfData struct {
		Slug   string
		NameZh string
		NameEn string
		Ja     string
	}
	standardShelves := []shelfData{
		{Slug: "movies", NameZh: "电影与长片", NameEn: "Movies & Films", Ja: "映画・長編"},
		{Slug: "anime-movies", NameZh: "动画剧场版", NameEn: "Anime Movies", Ja: "劇場アニメ"},
		{Slug: "feature-films", NameZh: "院线故事片", NameEn: "Feature Films", Ja: "長編映画"},
		{Slug: "doc-films", NameZh: "纪录电影", NameEn: "Documentary Films", Ja: "ドキュメンタリー"},
		{Slug: "series", NameZh: "剧集与节目", NameEn: "Series & Shows", Ja: "ドラマ・番組"},
		{Slug: "anime-series", NameZh: "TV 动画番剧", NameEn: "Anime Series", Ja: "TVアニメ"},
		{Slug: "live-series", NameZh: "电视连续剧", NameEn: "Drama Series", Ja: "テレビドラマ"},
		{Slug: "anime-hub", NameZh: "动漫专区", NameEn: "Anime Hub", Ja: "アニメ特設"},
		{Slug: "music", NameZh: "音乐与声音", NameEn: "Music & Audio", Ja: "音楽・サウンド"},
		{Slug: "soundtracks", NameZh: "影视与游戏原声", NameEn: "Soundtracks & OST", Ja: "サントラ・劇伴"},
		{Slug: "classical", NameZh: "古典交响乐", NameEn: "Classical", Ja: "クラシック"},
		{Slug: "audiobooks", NameZh: "广播剧与有声书", NameEn: "Audio Drama", Ja: "ボイスドラマ・オーディオブック"},
		{Slug: "books", NameZh: "图书与文献", NameEn: "Books & Literature", Ja: "書籍・文学"},
		{Slug: "scifi-books", NameZh: "科幻与奇幻文学", NameEn: "Sci-Fi & Fantasy", Ja: "SF・ファンタジー文学"},
		{Slug: "literature-books", NameZh: "经典文学名著", NameEn: "World Literature", Ja: "世界文学・名著"},
		{Slug: "comics", NameZh: "漫画与画集", NameEn: "Comics & Visual Arts", Ja: "マンガ・画集"},
		{Slug: "manga", NameZh: "连载漫画", NameEn: "Manga & Comics", Ja: "マンガ"},
		{Slug: "artbooks", NameZh: "原画与美术设定集", NameEn: "Artbooks & Gallery", Ja: "画集・設定資料集"},
		{Slug: "special-ghibli", NameZh: "吉卜力工作室专题", NameEn: "Studio Ghibli Archive", Ja: "スタジオジブリ特集"},
	}

	for _, s := range standardShelves {
		namesMap := map[string]string{
			"zh-CN": s.NameZh,
			"en-US": s.NameEn,
			"ja":    s.Ja,
		}
		namesJSON, _ := json.Marshal(namesMap)
		_ = db.Exec(`
			UPDATE virtual_shelves
			SET name_zh = CASE WHEN name_zh LIKE '%?%' OR name_zh = '' THEN ? ELSE name_zh END,
			    name_en = CASE WHEN name_en = '' THEN ? ELSE name_en END,
			    names = CASE WHEN names = '{}'::jsonb OR names IS NULL OR (names->>'zh-CN') LIKE '%?%' THEN ?::jsonb ELSE names END
			WHERE slug = ?
		`, s.NameZh, s.NameEn, string(namesJSON), s.Slug).Error
	}

	// 自动合并其他 virtual_shelves 的 names
	_ = db.Exec(`
		UPDATE virtual_shelves
		SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', COALESCE(NULLIF(name_en, ''), name_zh))
		WHERE (names = '{}'::jsonb OR names IS NULL) AND name_zh NOT LIKE '%?%'
	`).Error

	// 自动合并 user_custom_shelves 的 names
	_ = db.Exec(`
		UPDATE user_custom_shelves
		SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', COALESCE(NULLIF(name_en, ''), name_zh))
		WHERE (names = '{}'::jsonb OR names IS NULL) AND name_zh NOT LIKE '%?%'
	`).Error

	// 自动合并 entity_type_definitions 的 names
	_ = db.Exec(`
		UPDATE entity_type_definitions
		SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', COALESCE(NULLIF(name_en, ''), name_zh))
		WHERE (names = '{}'::jsonb OR names IS NULL) AND name_zh NOT LIKE '%?%'
	`).Error

	// 自动合并 relation_types 的 names
	_ = db.Exec(`
		UPDATE relation_types
		SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', COALESCE(NULLIF(name_en, ''), name_zh))
		WHERE (names = '{}'::jsonb OR names IS NULL) AND name_zh NOT LIKE '%?%'
	`).Error

	// 自动合并 external_database_definitions 的 names
	_ = db.Exec(`
		UPDATE external_database_definitions
		SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', COALESCE(NULLIF(name_en, ''), name_zh))
		WHERE (names = '{}'::jsonb OR names IS NULL) AND name_zh NOT LIKE '%?%'
	`).Error

	// 修复与补齐 forum_boards 的 names 与 descriptions 多语言预设
	type boardSeedData struct {
		Code   string
		NameZh string
		NameEn string
		DescZh string
		DescEn string
	}
	standardBoards := []boardSeedData{
		{Code: "general", NameZh: "综合讨论", NameEn: "General", DescZh: "跨媒介作品探讨、平台使用交流与自由闲聊", DescEn: "Cross-media discussions, platform usage, and casual chat"},
		{Code: "curation", NameZh: "编目治理", NameEn: "Catalog Curation", DescZh: "元数据校勘、LRM 关系拓扑审议与规范制定", DescEn: "Metadata curation, LRM topology review, and cataloging standards"},
		{Code: "announcements", NameZh: "官方公告", NameEn: "Announcements", DescZh: "系统版本更新、维护通知与开放计划", DescEn: "System updates, maintenance notices, and platform roadmap"},
		{Code: "announcement", NameZh: "站点公告", NameEn: "Announcements", DescZh: "站点公告与运营通知", DescEn: "Announcements and operations"},
		{Code: "casual", NameZh: "闲聊杂谈", NameEn: "Casual Chat", DescZh: "轻松闲聊与站内日常交流", DescEn: "Casual chat and daily discussions"},
		{Code: "qa", NameZh: "求助答疑", NameEn: "Q&A", DescZh: "使用问题、编目与功能答疑", DescEn: "Questions, cataloging help, and Q&A"},
		{Code: "reviews", NameZh: "考据评注", NameEn: "Archive Reviews", DescZh: "版本考证、原盘评析与文献释读", DescEn: "Edition analysis, disc reviews, and archive study"},
		{Code: "bug_report", NameZh: "反馈与建议", NameEn: "Feedback & Bug Reports", DescZh: "缺陷反馈、功能建议与复现信息", DescEn: "Bug reports, feature requests, and reproduction info"},
		{Code: "comment", NameZh: "评论专用", NameEn: "Comments", DescZh: "作品与讨论的评论承载区，不进入信息流与全站聚合", DescEn: "Comment carrier for works and topics, excluded from feeds"},
	}
	for _, b := range standardBoards {
		namesMap := map[string]string{"zh-CN": b.NameZh, "en-US": b.NameEn}
		descsMap := map[string]string{"zh-CN": b.DescZh, "en-US": b.DescEn}
		namesJSON, _ := json.Marshal(namesMap)
		descsJSON, _ := json.Marshal(descsMap)
		_ = db.Exec(`
			UPDATE forum_boards
			SET name_zh = CASE WHEN name_zh LIKE '%?%' OR name_zh = '' THEN ? ELSE name_zh END,
			    name_en = CASE WHEN name_en = '' THEN ? ELSE name_en END,
			    names = CASE WHEN names = '{}'::jsonb OR names IS NULL OR (names->>'zh-CN') LIKE '%?%' THEN ?::jsonb ELSE names END,
			    description = CASE WHEN description = '' THEN ? ELSE description END,
			    descriptions = CASE WHEN descriptions = '{}'::jsonb OR descriptions IS NULL THEN ?::jsonb ELSE descriptions END
			WHERE code = ?
		`, b.NameZh, b.NameEn, string(namesJSON), b.DescZh, string(descsJSON), b.Code).Error
	}

	// 自动合并其他 forum_boards 的 names 与 descriptions
	_ = db.Exec(`
		UPDATE forum_boards
		SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', COALESCE(NULLIF(name_en, ''), name_zh))
		WHERE (names = '{}'::jsonb OR names IS NULL) AND name_zh != ''
	`).Error
	_ = db.Exec(`
		UPDATE forum_boards
		SET descriptions = jsonb_build_object('zh-CN', description, 'en-US', description)
		WHERE (descriptions = '{}'::jsonb OR descriptions IS NULL) AND description != ''
	`).Error
}
