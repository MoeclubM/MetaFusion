-- Rolling back would erase the direct evidence on inclusion records.
DO $$ BEGIN RAISE EXCEPTION '000019_catalog_composition_rules is irreversible'; END $$;
