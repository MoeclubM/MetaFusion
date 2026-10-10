DO $$ BEGIN
    RAISE EXCEPTION '000025_catalog_commits is irreversible: preserve pushed commits and revision provenance';
END $$;
