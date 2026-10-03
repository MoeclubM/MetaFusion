-- Additive upgrade: existing identities, inclusion order, locators and revision
-- snapshots remain unchanged. Older clients may omit sources.
ALTER TABLE catalog.track_contents ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE catalog.track_contents ADD CONSTRAINT track_contents_sources_array CHECK (jsonb_typeof(sources) = 'array');
CREATE INDEX IF NOT EXISTS relations_rule_scope ON catalog.relations(type,source_id,target_id);
CREATE INDEX IF NOT EXISTS relations_target_rule ON catalog.relations(target_id,type,source_id);
-- Definitions are upgraded by the explicit mf-migrate seed job. HTTP startup
-- never writes definitions; no edition/composition edges are guessed here.
