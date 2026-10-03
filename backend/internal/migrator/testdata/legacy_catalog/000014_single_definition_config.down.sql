DO $$ BEGIN
  RAISE EXCEPTION '000014 is irreversible: retired definition versions cannot be reconstructed';
END $$;
