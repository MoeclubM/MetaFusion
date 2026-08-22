package database

import (
	"log"

	"gorm.io/gorm"
)

// applySchemaPatches runs idempotent ALTERs so existing volumes pick up schema
// that AutoMigrate cannot express (CHECK drops, unique rebuilds).
func applySchemaPatches(db *gorm.DB) {
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
