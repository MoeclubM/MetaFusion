-- Published names may have been edited since migration; dropping them loses user data.
DO $$ BEGIN RAISE EXCEPTION '000017_editable_structure_names is irreversible'; END $$;
