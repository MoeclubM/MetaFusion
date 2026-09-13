-- 回滚 000012：只删本迁移建的索引，不碰任何数据，可重复执行。
-- 撤销后：重复边拦截退回应用层 validateRelation（API 行为不变，
-- 只是少了直接 SQL 写入时的最后一道拦网）；反向查询退回全表扫描。

DROP INDEX IF EXISTS catalog.relations_no_exact_dup;
DROP INDEX IF EXISTS catalog.content_units_work;
DROP INDEX IF EXISTS catalog.expressions_work;
DROP INDEX IF EXISTS catalog.expressions_content_unit;
DROP INDEX IF EXISTS catalog.mediums_release;
DROP INDEX IF EXISTS catalog.tracks_medium;
DROP INDEX IF EXISTS catalog.release_subjects_work;
