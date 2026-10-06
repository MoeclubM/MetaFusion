-- Current query paths: parent traversal and definition-driven reverse references.
CREATE INDEX entities_attributes_lookup ON catalog.entities USING gin ((document->'attributes'));
CREATE INDEX release_subjects_attributes_lookup ON catalog.release_subjects USING gin (attributes);
CREATE INDEX track_contents_locator_lookup ON catalog.track_contents USING gin (locator);
CREATE INDEX track_contents_attributes_lookup ON catalog.track_contents USING gin (attributes);
CREATE INDEX content_units_parent ON catalog.content_units(parent_id, id) WHERE parent_id IS NOT NULL;
CREATE INDEX mediums_parent ON catalog.mediums(parent_id, id) WHERE parent_id IS NOT NULL;
CREATE INDEX tracks_parent ON catalog.tracks(parent_id, id) WHERE parent_id IS NOT NULL;
CREATE INDEX entities_public_recent ON catalog.entities(updated_at DESC, id) WHERE status='published';
