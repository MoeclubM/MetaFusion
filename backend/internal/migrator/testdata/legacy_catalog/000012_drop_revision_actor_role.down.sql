ALTER TABLE catalog.revisions ADD COLUMN IF NOT EXISTS actor_role text NOT NULL DEFAULT '';
