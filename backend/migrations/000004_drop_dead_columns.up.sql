-- 清理零读写列与零命中索引（只读审计结论，有行号证据）：
-- - catalog.deliveries.delivered_at：仅 DEFAULT 填充，从无 SELECT/INSERT 显式读写；
-- - catalog.user_preferences.updated_at：只写不读（读只取 home_shelves）；
-- - catalog.entities.redirect_id：只写不读（读走 document.redirect_id 镜像）；
-- - entities_search：to_tsvector GIN 索引，但检索走 title ILIKE，从无全文查询；
-- - entities_document：根 document 级 @>/@?/@@ 查询为零（命中全在子路径表达式索引）。
-- 保留：侧表伴随列 kind/work_kind/release_kind（复合外键靠 DEFAULT 被动填生效）。
ALTER TABLE IF EXISTS catalog.deliveries DROP COLUMN IF EXISTS delivered_at;
ALTER TABLE IF EXISTS catalog.user_preferences DROP COLUMN IF EXISTS updated_at;
ALTER TABLE IF EXISTS catalog.entities DROP COLUMN IF EXISTS redirect_id;
DROP INDEX IF EXISTS catalog.entities_search;
DROP INDEX IF EXISTS catalog.entities_document;
