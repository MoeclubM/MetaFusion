-- ==============================================================================
-- 000003_temporal_lifecycle.down.sql
-- 仅移除索引与治理开关列；时序数据列予以保留以防数据丢失。
-- ==============================================================================

DROP INDEX IF EXISTS idx_releases_edition_date;
DROP INDEX IF EXISTS idx_works_release_date;
DROP INDEX IF EXISTS idx_works_temporal;
DROP INDEX IF EXISTS idx_artists_temporal;
DROP INDEX IF EXISTS idx_entity_rel_target_temporal;
DROP INDEX IF EXISTS idx_entity_rel_temporal;
ALTER TABLE relation_types DROP COLUMN IF EXISTS is_temporal;
