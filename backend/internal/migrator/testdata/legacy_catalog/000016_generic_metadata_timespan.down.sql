-- Business types and their exact original assignments cannot be reconstructed
-- after the one-way cutover. Do not fabricate categories or discard spans.
DO $$ BEGIN RAISE EXCEPTION '000016_generic_metadata_timespan is irreversible'; END $$;
