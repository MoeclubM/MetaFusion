-- 外部权威库目录（catalog.external_databases）此前只存在于 schema.sql 终态快照，
-- 走 mf-migrate up 的存量库永远得不到该表。本迁移补齐，使版本轨道与 Initialize() 终态一致。
CREATE TABLE IF NOT EXISTS catalog.external_databases (
 code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,64}$'),
 names jsonb NOT NULL DEFAULT '{}',
 category text NOT NULL DEFAULT 'all'
  CHECK (category IN ('all','agent','collection','work','content_unit','expression','release','medium','track')),
 url_pattern text NOT NULL CHECK (length(trim(url_pattern))>0),
 icon text NOT NULL DEFAULT 'Globe',
 icon_url text NOT NULL DEFAULT '',
 validation_regex text NOT NULL DEFAULT '',
 description text NOT NULL DEFAULT '',
 sort_order int NOT NULL DEFAULT 0,
 is_enabled boolean NOT NULL DEFAULT true,
 is_system boolean NOT NULL DEFAULT false
);
