-- ==============================================================================
-- 000003_temporal_lifecycle.up.sql
-- LRM 时序生命周期：实体 begin/end/ended、关系时序列、时序索引
-- 全幂等（IF NOT EXISTS），与 database/patches.go 兜底语义一致。
-- ==============================================================================

-- 1. relation_types 时序治理开关
ALTER TABLE relation_types ADD COLUMN IF NOT EXISTS is_temporal BOOLEAN DEFAULT FALSE NOT NULL;

-- 2. entity_relationships 关系边时序列
ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(64);
ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS begin_date VARCHAR(16);
ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS end_date VARCHAR(16);
ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS ended BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

-- 旧列 relation_type 向 relationship_type 回填（仅当新列全空且旧列有值时）
UPDATE entity_relationships SET relationship_type = relation_type
WHERE relationship_type IS NULL AND relation_type IS NOT NULL;

-- 3. 实体存续区间列
ALTER TABLE works ADD COLUMN IF NOT EXISTS begin_date VARCHAR(16);
ALTER TABLE works ADD COLUMN IF NOT EXISTS end_date VARCHAR(16);
ALTER TABLE works ADD COLUMN IF NOT EXISTS ended BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS begin_date VARCHAR(16);
ALTER TABLE artists ADD COLUMN IF NOT EXISTS end_date VARCHAR(16);
ALTER TABLE artists ADD COLUMN IF NOT EXISTS ended BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE franchises ADD COLUMN IF NOT EXISTS begin_date VARCHAR(16);
ALTER TABLE franchises ADD COLUMN IF NOT EXISTS end_date VARCHAR(16);
ALTER TABLE franchises ADD COLUMN IF NOT EXISTS ended BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE canonical_entries ADD COLUMN IF NOT EXISTS recording_date VARCHAR(16);

-- 4. 时序与排序索引
CREATE INDEX IF NOT EXISTS idx_entity_rel_temporal ON entity_relationships(source_id, relationship_type, ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_entity_rel_target_temporal ON entity_relationships(target_id, relationship_type, ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_artists_temporal ON artists(ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_works_temporal ON works(ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_works_release_date ON works(release_date);
CREATE INDEX IF NOT EXISTS idx_releases_edition_date ON releases(edition_date);

-- 5. 时序语义标定：任期/隶属/合约类关系展示 begin/end/ended 输入
UPDATE relation_types SET is_temporal = TRUE WHERE code IN (
    'member_of', 'voice_actor_of', 'character_in', 'performer', 'producer',
    'collaborates_with', 'signed_with', 'represented_by', 'subsidiary_of',
    'creator_of', 'imprint_of', 'director', 'composer', 'author', 'lyricist',
    'arranger', 'illustrator', 'vocaloid_tuner', 'real_counterpart_of', 'founded_by'
);
UPDATE relation_types SET is_temporal = FALSE WHERE code IN (
    'adapted_from', 'sequel_of', 'spin_off_of', 'unofficial_of', 'expansion_of',
    'soundtrack_of', 'included_in', 'crossover_with', 'alternate_form_of',
    'part_of_franchise', 'remake_of', 'prequel_of'
);
