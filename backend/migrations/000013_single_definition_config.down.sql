DO $$ BEGIN
  RAISE EXCEPTION '000013 is irreversible: retired definition versions cannot be reconstructed';
END $$;
