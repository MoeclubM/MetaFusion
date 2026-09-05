ALTER TABLE releases ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(512) NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN IF NOT EXISTS cover_aspect VARCHAR(8) NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN IF NOT EXISTS original_language VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE mediums ADD COLUMN IF NOT EXISTS parent_id UUID;
ALTER TABLE mediums ADD COLUMN IF NOT EXISTS number TEXT NOT NULL DEFAULT '';
ALTER TABLE mediums ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE mediums ADD COLUMN IF NOT EXISTS original_language VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE mediums ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS parent_id UUID;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS number TEXT NOT NULL DEFAULT '';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS original_language VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS locator JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS track_contents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    canonical_entry_id UUID NOT NULL REFERENCES canonical_entries(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL CHECK (position > 0),
    locator JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(locator) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_track_contents_track_position ON track_contents(track_id, position, id);
CREATE INDEX IF NOT EXISTS idx_track_contents_entry ON track_contents(canonical_entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_track_contents_track_position_unique ON track_contents(track_id, position);
CREATE INDEX IF NOT EXISTS idx_mediums_parent ON mediums(release_id, parent_id, position, id);
CREATE INDEX IF NOT EXISTS idx_tracks_parent ON tracks(medium_id, parent_id, position, id);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mediums_parent_same_release') THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mediums_id_release ON mediums(id, release_id);
        ALTER TABLE mediums ADD CONSTRAINT mediums_parent_same_release
            FOREIGN KEY (parent_id, release_id) REFERENCES mediums(id, release_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracks_parent_same_medium') THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_id_medium ON tracks(id, medium_id);
        ALTER TABLE tracks ADD CONSTRAINT tracks_parent_same_medium
            FOREIGN KEY (parent_id, medium_id) REFERENCES tracks(id, medium_id) ON DELETE RESTRICT;
    END IF;
END $$;
ALTER TABLE mediums DROP CONSTRAINT IF EXISTS mediums_role_valid;
ALTER TABLE mediums ADD CONSTRAINT mediums_role_valid CHECK (role IN ('primary', 'supplement'));
