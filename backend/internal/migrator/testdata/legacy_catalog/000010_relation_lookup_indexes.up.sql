CREATE INDEX IF NOT EXISTS relations_target_lookup ON catalog.relations(target_id,id);
CREATE INDEX IF NOT EXISTS relations_type_listing ON catalog.relations(type,id);
