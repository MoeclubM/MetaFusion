-- Existing expressions remain unsequenced roots until an editor supplies evidence.
ALTER TABLE canonical_entries ADD COLUMN IF NOT EXISTS parent_id UUID;
ALTER TABLE canonical_entries ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canonical_entries ADD COLUMN IF NOT EXISTS number TEXT NOT NULL DEFAULT '';
ALTER TABLE canonical_entries ADD COLUMN IF NOT EXISTS entry_role TEXT NOT NULL DEFAULT 'main';
ALTER TABLE canonical_entries ADD COLUMN IF NOT EXISTS original_language TEXT NOT NULL DEFAULT '';
ALTER TABLE canonical_entries ADD COLUMN IF NOT EXISTS version_label TEXT NOT NULL DEFAULT '';
ALTER TABLE canonical_entries ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_canonical_entries_contents ON canonical_entries(work_id, parent_id, position, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_entries_id_work ON canonical_entries(id, work_id);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'canonical_contents_parent') THEN
  ALTER TABLE canonical_entries ADD CONSTRAINT canonical_contents_parent FOREIGN KEY(parent_id, work_id) REFERENCES canonical_entries(id, work_id) ON DELETE RESTRICT;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'canonical_contents_shape') THEN
  ALTER TABLE canonical_entries ADD CONSTRAINT canonical_contents_shape CHECK (
   position >= 0 AND entry_role IN ('main', 'extra', 'group') AND
   (parent_id IS NULL OR (work_id IS NOT NULL AND parent_id <> id)) AND jsonb_typeof(translations) = 'object'
  );
 END IF;
END $$;
CREATE OR REPLACE FUNCTION enforce_canonical_content_tree() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
 PERFORM id FROM works WHERE id = NEW.work_id FOR UPDATE;
 IF EXISTS (
  WITH RECURSIVE ancestors AS (
   SELECT id, parent_id FROM canonical_entries WHERE id = NEW.parent_id
   UNION
   SELECT c.id, c.parent_id FROM canonical_entries c JOIN ancestors a ON c.id = a.parent_id
  ) SELECT 1 FROM ancestors WHERE id = NEW.id
 ) THEN RAISE EXCEPTION 'canonical content cycle' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS canonical_content_tree_guard ON canonical_entries;
CREATE TRIGGER canonical_content_tree_guard BEFORE INSERT OR UPDATE OF parent_id, work_id ON canonical_entries FOR EACH ROW EXECUTE FUNCTION enforce_canonical_content_tree();
