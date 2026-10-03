-- 回滚 000008：查询索引只影响性能，删索引即回滚；重建方式为 `mf-migrate up`。
DROP INDEX IF EXISTS catalog.entities_redirect_lookup;
