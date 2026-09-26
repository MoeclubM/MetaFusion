-- The migration adds tags to existing works. Their prior absence cannot be
-- distinguished from contributor tags, so an automatic rollback is unsafe.
DO $$ BEGIN RAISE EXCEPTION '000015_shelf_open_tags is irreversible'; END $$;
