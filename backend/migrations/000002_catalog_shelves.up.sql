-- 首页货架与探索页共用的聚合规则：前后端共用同一规则，不再各自硬编码。
-- query 为收录规则（types/fields/vocab_terms/relations，AND 语义）；
-- sort/icon/enabled 描述展示方式。names 为四语名称映射（zh-CN/en-US/zh-TW/ja-JP）。
CREATE TABLE IF NOT EXISTS catalog.shelves (
 id bigserial PRIMARY KEY,
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
 names jsonb NOT NULL DEFAULT '{}',
 query jsonb NOT NULL DEFAULT '{}',
 sort text NOT NULL DEFAULT 'updated',
 icon text NOT NULL DEFAULT '',
 is_enabled boolean NOT NULL DEFAULT true,
 sort_order int NOT NULL DEFAULT 0
);
