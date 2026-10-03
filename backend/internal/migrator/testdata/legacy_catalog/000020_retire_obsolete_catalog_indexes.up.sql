-- These indexes belonged to retired search paths. Current keyword searches
-- use PostgreSQL ILIKE or OpenSearch candidates; attribute containment uses
-- the targeted entities_attribute_tags index. Neither old index is referenced
-- by a constraint. Keep entity documents, revisions and migration history.
DROP INDEX IF EXISTS catalog.entities_search;
DROP INDEX IF EXISTS catalog.entities_document;
