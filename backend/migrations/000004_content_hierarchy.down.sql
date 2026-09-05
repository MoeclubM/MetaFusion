DROP TRIGGER IF EXISTS canonical_content_tree_guard ON canonical_entries;
DROP FUNCTION IF EXISTS enforce_canonical_content_tree();
ALTER TABLE canonical_entries DROP CONSTRAINT IF EXISTS canonical_contents_parent;
ALTER TABLE canonical_entries DROP CONSTRAINT IF EXISTS canonical_contents_shape;
DROP INDEX IF EXISTS idx_canonical_entries_contents;
DROP INDEX IF EXISTS idx_canonical_entries_id_work;
ALTER TABLE canonical_entries DROP COLUMN IF EXISTS parent_id, DROP COLUMN IF EXISTS position, DROP COLUMN IF EXISTS number, DROP COLUMN IF EXISTS entry_role, DROP COLUMN IF EXISTS original_language, DROP COLUMN IF EXISTS version_label, DROP COLUMN IF EXISTS translations;
