DO $$ BEGIN
  RAISE EXCEPTION '000020_retire_obsolete_catalog_indexes is irreversible; restore a verified release and backup instead of restoring obsolete search paths';
END $$;
