-- 回滚 000013：只删本迁移建的幂等键唯一索引，不碰任何数据，可重复执行。
-- 撤销后：幂等并发拦截退回应用层 findImported 先查后建（API 行为不变，
-- 只是并发双写可能再产生重复，需调用方重试确认）。

DROP INDEX IF EXISTS catalog.entities_metafusion_import_key;
