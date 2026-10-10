DO $$ BEGIN
    RAISE EXCEPTION '000026_catalog_concurrency is irreversible: restore database and matching server together';
END $$;
