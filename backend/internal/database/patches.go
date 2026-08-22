package database

import (
	"log"
	"strings"

	"github.com/lib/pq"
	"gorm.io/gorm"
)

// applySchemaPatches runs idempotent ALTERs so existing volumes pick up schema
// that AutoMigrate cannot express (CHECK drops, unique rebuilds).
func applySchemaPatches(db *gorm.DB) {
	migrateHardClassificationToTags(db)

	stmts := []string{
		`ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS qualifier VARCHAR(64) NOT NULL DEFAULT ''`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS country VARCHAR(64) DEFAULT ''`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS language VARCHAR(64) DEFAULT ''`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS distribution_channel VARCHAR(32) DEFAULT 'mixed' NOT NULL`,
		`ALTER TABLE releases ADD COLUMN IF NOT EXISTS catalog_metadata JSONB DEFAULT '{}'::jsonb NOT NULL`,
		`ALTER TABLE works ALTER COLUMN category_code DROP NOT NULL`,
		`ALTER TABLE works ALTER COLUMN category_code SET DEFAULT ''`,
		`ALTER TABLE artists ADD COLUMN IF NOT EXISTS language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL`,
		`ALTER TABLE franchises ADD COLUMN IF NOT EXISTS language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_custom_shelves_owner_slug ON user_custom_shelves(owner_id, slug)`,
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

	migrateShelfQueryTags := func(table, idCol string) {
		if !columnExists(db, table, "media_type") || !columnExists(db, table, "query_tags") {
			return
		}
		type shelfRow struct {
			ID        string
			MediaType string
			QueryTags pq.StringArray
		}
		var rows []shelfRow
		_ = db.Raw(`SELECT `+idCol+`::text AS id, media_type, query_tags FROM `+table+` WHERE media_type IS NOT NULL AND btrim(media_type) <> '' AND media_type <> 'all'`).Scan(&rows).Error
		for _, r := range rows {
			mt := strings.ToLower(strings.TrimSpace(r.MediaType))
			extra := formatTagsForLegacyMediaCode(mt, nameByCode[mt])
			isAgg := mt == "video" || mt == "audio" || mt == "text" || mt == "graphic"
			if isAgg && len(r.QueryTags) > 0 {
				continue
			}
			merged := mergeTagNames(r.QueryTags, extra)
			if len(merged) == len(r.QueryTags) {
				same := true
				for i := range merged {
					if merged[i] != r.QueryTags[i] {
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
			_ = db.Exec(`UPDATE `+table+` SET query_tags = ? WHERE `+idCol+`::text = ?`, pq.Array(merged), r.ID).Error
		}
	}
	if shelfHas {
		migrateShelfQueryTags("virtual_shelves", "slug")
	}
	if customHas {
		migrateShelfQueryTags("user_custom_shelves", "id")
	}

	drops := []string{
		`ALTER TABLE works DROP CONSTRAINT IF EXISTS fk_works_media_type`,
		`DROP INDEX IF EXISTS idx_works_media_type`,
		`ALTER TABLE works DROP COLUMN IF EXISTS media_type`,
		`ALTER TABLE virtual_shelves DROP COLUMN IF EXISTS media_type`,
		`ALTER TABLE user_custom_shelves DROP COLUMN IF EXISTS media_type`,
	}
	for _, s := range drops {
		if err := db.Exec(s).Error; err != nil {
			log.Printf("media_type drop skipped: %v", err)
		}
	}
	log.Printf("migrated hard classification columns to tags")
}
