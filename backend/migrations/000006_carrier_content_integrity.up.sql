-- Keep legacy entry_number data readable, but remove its obsolete per-work
-- uniqueness rule. Content ordering is now represented by position/parent_id.
ALTER TABLE canonical_entries DROP CONSTRAINT IF EXISTS uni_work_entry_num;
DROP INDEX IF EXISTS uni_work_entry_num;

CREATE OR REPLACE FUNCTION enforce_track_work_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    expected_work UUID;
    content_work UUID;
BEGIN
    SELECT r.work_id INTO expected_work
    FROM mediums m
    JOIN releases r ON r.id = m.release_id
    WHERE m.id = NEW.medium_id;

    IF expected_work IS NULL THEN
        RAISE EXCEPTION 'track medium has no release work' USING ERRCODE = '23514';
    END IF;

    IF NEW.work_id IS NOT NULL AND NEW.work_id <> expected_work THEN
        RAISE EXCEPTION 'track work must match release work' USING ERRCODE = '23514';
    END IF;

    IF NEW.canonical_entry_id IS NOT NULL THEN
        SELECT work_id INTO content_work FROM canonical_entries WHERE id = NEW.canonical_entry_id;
        IF content_work IS NULL OR content_work <> expected_work THEN
            RAISE EXCEPTION 'track content must match release work' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS track_work_consistency_guard ON tracks;
CREATE TRIGGER track_work_consistency_guard
BEFORE INSERT OR UPDATE OF medium_id, work_id, canonical_entry_id ON tracks
FOR EACH ROW EXECUTE FUNCTION enforce_track_work_consistency();

CREATE OR REPLACE FUNCTION enforce_track_content_work_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    expected_work UUID;
    content_work UUID;
BEGIN
    SELECT r.work_id INTO expected_work
    FROM tracks t
    JOIN mediums m ON m.id = t.medium_id
    JOIN releases r ON r.id = m.release_id
    WHERE t.id = NEW.track_id;
    SELECT work_id INTO content_work FROM canonical_entries WHERE id = NEW.canonical_entry_id;

    IF expected_work IS NULL OR content_work IS NULL OR content_work <> expected_work THEN
        RAISE EXCEPTION 'track content must match release work' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS track_content_work_consistency_guard ON track_contents;
CREATE TRIGGER track_content_work_consistency_guard
BEFORE INSERT OR UPDATE OF track_id, canonical_entry_id ON track_contents
FOR EACH ROW EXECUTE FUNCTION enforce_track_content_work_consistency();
