-- 回滚即整段丢弃目录 schema。目录数据不跨 schema，其他服务的数据不受影响。
-- 重建方式：`mf-migrate up`（结构）+ 目录服务启动（播种 definitions/shelves/external_databases）。

DROP SCHEMA IF EXISTS catalog CASCADE;
